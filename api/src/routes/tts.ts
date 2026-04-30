import { Router, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { query, queryOne } from "../db/index.js";
import { decrypt } from "../services/encryption.js";
import {
  getUserInfo,
  synthesize,
  ElevenLabsError,
} from "../services/elevenlabs.js";
import {
  insertSnapshot,
  latestSnapshotForAccount,
  AccountRow,
} from "./accounts.js";

const router = Router();

const MAX_TEXT_LENGTH = 3000;
const MAX_TOTAL_ATTEMPTS = 6;

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

const blacklist = new Map<number, { reason: string; until: number }>();
const voiceUnavailable = new Set<string>();
const accountMutex = new Map<number, Promise<void>>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SnapshotRow {
  character_count: number;
  character_limit: number;
  next_reset_unix: number;
  tier: string;
  status: string;
  fetched_at: string;
}

interface CandidateAccount {
  id: number;
  label: string;
  apiKey: string;
  remaining: number;
  next_reset_unix: number;
  tier: string;
  status: string;
  resolvedVoiceId: string;
}

async function withAccountMutex<T>(accountId: number, fn: () => Promise<T>): Promise<T> {
  const prev = accountMutex.get(accountId) ?? Promise.resolve();
  let resolve!: () => void;
  const next = new Promise<void>((r) => { resolve = r; });
  accountMutex.set(accountId, next);
  await prev;
  try {
    return await fn();
  } finally {
    resolve();
  }
}

function getCandidates(textLength: number, voiceId?: string, voiceName?: string): CandidateAccount[] {
  const now = Math.floor(Date.now() / 1000);
  const rows = query<AccountRow>("SELECT id, label, api_key, created_at FROM accounts ORDER BY id");

  const candidates: CandidateAccount[] = [];

  for (const row of rows) {
    const bl = blacklist.get(row.id);
    if (bl && bl.until > now) continue;

    let resolvedVoiceId: string;
    if (voiceName) {
      const mapping = queryOne<{ voice_id: string }>(
        `SELECT voice_id FROM account_voices WHERE account_id = ? AND voice_name = ?`,
        [row.id, voiceName]
      );
      if (!mapping) continue;
      resolvedVoiceId = mapping.voice_id;
    } else {
      resolvedVoiceId = voiceId!;
    }

    if (voiceUnavailable.has(`${row.id}:${resolvedVoiceId}`)) continue;

    const snap = queryOne<SnapshotRow>(
      `SELECT character_count, character_limit, next_reset_unix, tier, status, fetched_at
       FROM usage_snapshots
       WHERE account_id = ?
       ORDER BY fetched_at DESC
       LIMIT 1`,
      [row.id]
    );
    if (!snap) continue;

    const remaining = now >= snap.next_reset_unix
      ? snap.character_limit
      : snap.character_limit - snap.character_count;

    if (remaining < textLength) continue;

    let apiKey: string;
    try {
      apiKey = decrypt(row.api_key);
    } catch {
      continue;
    }

    candidates.push({
      id: row.id,
      label: row.label,
      apiKey,
      remaining,
      next_reset_unix: snap.next_reset_unix,
      tier: snap.tier,
      status: snap.status,
      resolvedVoiceId,
    });
  }

  candidates.sort((a, b) => a.remaining - b.remaining || a.id - b.id);
  return candidates;
}

// ---------------------------------------------------------------------------
// POST /api/tts
// ---------------------------------------------------------------------------

router.post("/", async (req: Request, res: Response): Promise<void> => {
  const { voice_id, voice_name, text, model_id, account_id, output_format, voice_settings } =
    req.body as {
      voice_id?: string;
      voice_name?: string;
      text?: string;
      model_id?: string;
      account_id?: number;
      output_format?: string;
      voice_settings?: Record<string, unknown>;
    };

  if (!text || (!voice_id && !voice_name)) {
    res.status(400).json({ error: "missing_fields" });
    return;
  }

  if (text.trim().length === 0) {
    res.status(400).json({ error: "empty_text" });
    return;
  }

  if (text.length > MAX_TEXT_LENGTH) {
    res.status(400).json({ error: "text_too_long", max: MAX_TEXT_LENGTH });
    return;
  }

  const requestId = randomUUID();

  // Manual account_id override path
  if (account_id !== undefined) {
    const row = queryOne<AccountRow>(
      "SELECT id, label, api_key, created_at FROM accounts WHERE id = ?",
      [account_id]
    );
    if (!row) {
      res.status(404).json({ error: "account_not_found" });
      return;
    }

    let apiKey: string;
    try {
      apiKey = decrypt(row.api_key);
    } catch {
      res.status(502).json({ error: "upstream", details: "Decryption failed" });
      return;
    }

    let resolvedVoiceId = voice_id;
    if (!resolvedVoiceId && voice_name) {
      const mapping = queryOne<{ voice_id: string }>(
        `SELECT voice_id FROM account_voices WHERE account_id = ? AND voice_name = ?`,
        [row.id, voice_name]
      );
      if (!mapping) {
        res.status(404).json({ error: "voice_mapping_not_found" });
        return;
      }
      resolvedVoiceId = mapping.voice_id;
    }

    let audio: Buffer;
    try {
      audio = await withAccountMutex(row.id, () =>
        synthesize({ apiKey, voiceId: resolvedVoiceId!, text, modelId: model_id, voiceSettings: voice_settings, outputFormat: output_format })
      );
    } catch (err) {
      if (err instanceof ElevenLabsError) {
        res.status(502).json({ error: "upstream", details: err.message });
        return;
      }
      res.status(502).json({ error: "upstream", details: "Unknown error" });
      return;
    }

    refreshSnapshot(row.id, apiKey, text.length);

    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Length": String(audio.length),
      "X-Request-Id": requestId,
      "X-Voicepool-Account-Id": String(row.id),
      "X-Voicepool-Characters-Used": String(text.length),
    });
    res.send(audio);
    return;
  }

  // Auto selection path
  const allAccounts = query<AccountRow>("SELECT id FROM accounts ORDER BY id");
  if (allAccounts.length === 0) {
    res.status(503).json({ error: "no_accounts" });
    return;
  }

  const candidates = getCandidates(text.length, voice_id, voice_name);
  if (candidates.length === 0) {
    const now = Math.floor(Date.now() / 1000);
    const nextReset = findEarliestReset(now);
    res.status(429).json({ error: "pool_exhausted", ...(nextReset ? { next_reset_unix: nextReset } : {}) });
    if (nextReset) res.setHeader("Retry-After", String(nextReset - now));
    return;
  }

  let attempts = 0;
  let lastError = "";
  let usedAccountId: number | null = null;
  let audio: Buffer | null = null;

  for (const candidate of candidates) {
    if (attempts >= MAX_TOTAL_ATTEMPTS) break;
    attempts++;

    try {
      const result = await withAccountMutex(candidate.id, () =>
        synthesize({
          apiKey: candidate.apiKey,
          voiceId: candidate.resolvedVoiceId,
          text,
          modelId: model_id,
          voiceSettings: voice_settings,
          outputFormat: output_format,
        })
      );
      audio = result;
      usedAccountId = candidate.id;
      break;
    } catch (err) {
      if (err instanceof ElevenLabsError) {
        lastError = err.message;
        if (err.statusCode === 401) {
          blacklist.set(candidate.id, { reason: "Invalid API key", until: Math.floor(Date.now() / 1000) + 300 });
          continue;
        }
        if (err.statusCode === 422) {
          voiceUnavailable.add(`${candidate.id}:${candidate.resolvedVoiceId}`);
          continue;
        }
        if (err.statusCode === 429) {
          blacklist.set(candidate.id, { reason: "Rate limited", until: Math.floor(Date.now() / 1000) + 60 });
          continue;
        }
        if (err.statusCode >= 500) {
          continue;
        }
        res.status(502).json({ error: "upstream", details: err.message });
        return;
      }
      lastError = String(err);
      continue;
    }
  }

  if (!audio || usedAccountId === null) {
    const remainingCandidates = getCandidates(text.length, voice_id, voice_name);
    if (remainingCandidates.length === 0) {
      res.status(429).json({ error: "pool_exhausted" });
    } else {
      res.status(502).json({ error: "upstream", details: lastError || "All attempts failed" });
    }
    return;
  }

  refreshSnapshot(usedAccountId, getCandidateApiKey(usedAccountId), text.length);

  res.set({
    "Content-Type": "audio/mpeg",
    "Content-Length": String(audio.length),
    "X-Request-Id": requestId,
    "X-Voicepool-Account-Id": String(usedAccountId),
    "X-Voicepool-Characters-Used": String(text.length),
  });
  res.send(audio);
});

// ---------------------------------------------------------------------------
// Helpers used after synthesis
// ---------------------------------------------------------------------------

function getCandidateApiKey(accountId: number): string {
  const row = queryOne<AccountRow>(
    "SELECT api_key FROM accounts WHERE id = ?",
    [accountId]
  );
  if (!row) return "";
  try {
    return decrypt(row.api_key);
  } catch {
    return "";
  }
}

function findEarliestReset(now: number): number | null {
  const rows = query<{ next_reset_unix: number }>(
    `SELECT MIN(next_reset_unix) as next_reset_unix
     FROM usage_snapshots
     WHERE id IN (
       SELECT MAX(id) FROM usage_snapshots GROUP BY account_id
     ) AND next_reset_unix > ?`,
    [now]
  );
  return rows[0]?.next_reset_unix ?? null;
}

function refreshSnapshot(accountId: number, apiKey: string, charsUsed: number): void {
  getUserInfo(apiKey)
    .then((info) => {
      const sub = info.subscription;
      insertSnapshot(accountId, {
        character_count: sub.character_count,
        character_limit: sub.character_limit,
        next_reset_unix: sub.next_character_count_reset_unix,
        tier: sub.tier,
        status: sub.status,
      });
    })
    .catch(() => {
      const snap = latestSnapshotForAccount(accountId);
      if (snap) {
        insertSnapshot(accountId, {
          character_count: snap.character_count + charsUsed,
          character_limit: snap.character_limit,
          next_reset_unix: snap.next_reset_unix,
          tier: snap.tier,
          status: snap.status,
        });
      }
    });
}

export default router;
