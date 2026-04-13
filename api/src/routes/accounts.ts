import { Router, Request, Response } from "express";
import { run, runChanges, query, queryOne } from "../db/index.js";
import { encrypt, decrypt } from "../services/encryption.js";
import {
  getSubscription,
  ElevenLabsError,
} from "../services/elevenlabs.js";

const router = Router();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AccountRow {
  id: number;
  label: string;
  api_key: string;
  created_at: string;
}

interface SnapshotRow {
  character_count: number;
  character_limit: number;
  next_reset_unix: number;
  tier: string;
  status: string;
  fetched_at: string;
}

interface AccountWithUsage {
  id: number;
  label: string;
  created_at: string;
  usage: SnapshotRow | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function latestSnapshotForAccount(accountId: number): SnapshotRow | null {
  return (
    queryOne<SnapshotRow>(
      `SELECT character_count, character_limit, next_reset_unix, tier, status, fetched_at
       FROM usage_snapshots
       WHERE account_id = ?
       ORDER BY fetched_at DESC
       LIMIT 1`,
      [accountId]
    ) ?? null
  );
}

function insertSnapshot(
  accountId: number,
  data: {
    character_count: number;
    character_limit: number;
    next_reset_unix: number;
    tier: string;
    status: string;
  }
): void {
  run(
    `INSERT INTO usage_snapshots (account_id, character_count, character_limit, next_reset_unix, tier, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      accountId,
      data.character_count,
      data.character_limit,
      data.next_reset_unix,
      data.tier,
      data.status,
    ]
  );
}

// ---------------------------------------------------------------------------
// POST /api/accounts — Add a new account
// ---------------------------------------------------------------------------

router.post("/", async (req: Request, res: Response): Promise<void> => {
  const { label, apiKey } = req.body as { label?: string; apiKey?: string };

  if (!label || !apiKey) {
    res.status(400).json({ error: "label and apiKey are required" });
    return;
  }

  // Validate the key against ElevenLabs
  let subscription;
  try {
    subscription = await getSubscription(apiKey);
  } catch (err) {
    if (err instanceof ElevenLabsError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    res.status(502).json({ error: "Failed to reach ElevenLabs API" });
    return;
  }

  // Encrypt and store
  const encryptedKey = encrypt(apiKey);
  const accountId = run(
    "INSERT INTO accounts (label, api_key) VALUES (?, ?)",
    [label, encryptedKey]
  );

  // Store initial usage snapshot
  insertSnapshot(accountId, {
    character_count: subscription.character_count,
    character_limit: subscription.character_limit,
    next_reset_unix: subscription.next_character_count_reset_unix,
    tier: subscription.tier,
    status: subscription.status,
  });

  const usage = latestSnapshotForAccount(accountId);

  res.status(201).json({
    id: accountId,
    label,
    created_at: new Date().toISOString(),
    usage,
  });
});

// ---------------------------------------------------------------------------
// GET /api/accounts — List all accounts with latest usage
// ---------------------------------------------------------------------------

router.get("/", (_req: Request, res: Response): void => {
  const rows = query<AccountRow>(
    "SELECT id, label, api_key, created_at FROM accounts ORDER BY id"
  );

  const accounts: AccountWithUsage[] = rows.map((row) => ({
    id: row.id,
    label: row.label,
    created_at: row.created_at,
    usage: latestSnapshotForAccount(row.id),
  }));

  res.json(accounts);
});

// ---------------------------------------------------------------------------
// DELETE /api/accounts/:id — Remove an account and its snapshots
// ---------------------------------------------------------------------------

router.delete("/:id", (req: Request, res: Response): void => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid account id" });
    return;
  }

  // Delete snapshots first (foreign key), then the account
  runChanges("DELETE FROM usage_snapshots WHERE account_id = ?", [id]);
  const changes = runChanges("DELETE FROM accounts WHERE id = ?", [id]);

  if (changes === 0) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  res.status(204).end();
});

// ---------------------------------------------------------------------------
// POST /api/accounts/refresh — Poll EL API for all accounts, store snapshots
// ---------------------------------------------------------------------------

router.post("/refresh", async (_req: Request, res: Response): Promise<void> => {
  const rows = query<AccountRow>(
    "SELECT id, label, api_key, created_at FROM accounts ORDER BY id"
  );

  const results: AccountWithUsage[] = [];
  const errors: { id: number; label: string; error: string }[] = [];

  for (const row of rows) {
    let apiKey: string;
    try {
      apiKey = decrypt(row.api_key);
    } catch {
      errors.push({ id: row.id, label: row.label, error: "Decryption failed" });
      continue;
    }

    try {
      const sub = await getSubscription(apiKey);
      insertSnapshot(row.id, {
        character_count: sub.character_count,
        character_limit: sub.character_limit,
        next_reset_unix: sub.next_character_count_reset_unix,
        tier: sub.tier,
        status: sub.status,
      });
    } catch (err) {
      const message =
        err instanceof ElevenLabsError
          ? err.message
          : "Failed to reach ElevenLabs API";
      errors.push({ id: row.id, label: row.label, error: message });
    }

    results.push({
      id: row.id,
      label: row.label,
      created_at: row.created_at,
      usage: latestSnapshotForAccount(row.id),
    });
  }

  res.json({ accounts: results, errors });
});

export default router;
