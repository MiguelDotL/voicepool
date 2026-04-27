import { Router, Request, Response } from "express";
import { run, runChanges, query, queryOne } from "../db/index.js";
import { generateEmail, type SignupRow } from "../services/signups.js";
import { createAccountFromKey } from "./accounts.js";
import { ElevenLabsError } from "../services/elevenlabs.js";
import { encrypt, decrypt } from "../services/encryption.js";
import {
  enqueue as enqueueAutomation,
  isAutomationEnabled,
  openInteractiveSignup,
} from "../services/elAutomation.js";

const router = Router();

// Never return the encrypted password from any endpoint.
function publicShape(row: SignupRow) {
  return {
    id: row.id,
    email: row.email,
    status: row.status,
    verification_link: row.verification_link,
    account_id: row.account_id,
    created_at: row.created_at,
    verified_at: row.verified_at,
    automation_step: row.automation_step,
    automation_error: row.automation_error,
  };
}

// ---------------------------------------------------------------------------
// POST /api/signups — Generate a new signup email
// ---------------------------------------------------------------------------

router.post("/", (_req: Request, res: Response): void => {
  if (!process.env.MAIL_DOMAIN) {
    res.status(503).json({ error: "Email automation not configured" });
    return;
  }

  // Seed password from env so future automation runs can re-login if needed.
  // Encrypted at rest; never returned from any endpoint.
  const seedPassword = process.env.EL_SHARED_PASSWORD;
  const encryptedPassword = seedPassword ? encrypt(seedPassword) : null;

  // Up to 3 attempts in the unlikely event of a UNIQUE collision.
  for (let attempt = 0; attempt < 3; attempt++) {
    const email = generateEmail();
    try {
      run("INSERT INTO signups (email, password) VALUES (?, ?)", [email, encryptedPassword]);
      const row = queryOne<SignupRow>("SELECT * FROM signups WHERE email = ?", [email]);
      if (!row) {
        res.status(500).json({ error: "Signup row vanished after insert" });
        return;
      }
      res.status(201).json(publicShape(row));
      return;
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (!msg.toLowerCase().includes("unique")) {
        res.status(500).json({ error: msg || "Failed to create signup" });
        return;
      }
      // collision → loop and retry
    }
  }
  res.status(500).json({ error: "Could not generate a unique address after 3 attempts" });
});

// ---------------------------------------------------------------------------
// GET /api/signups — List all signups
// ---------------------------------------------------------------------------

router.get("/", (_req: Request, res: Response): void => {
  const rows = query<SignupRow>("SELECT * FROM signups ORDER BY id DESC");
  res.json(rows.map(publicShape));
});

// ---------------------------------------------------------------------------
// DELETE /api/signups/:id
// ---------------------------------------------------------------------------

router.delete("/:id", (req: Request, res: Response): void => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const changes = runChanges("DELETE FROM signups WHERE id = ?", [id]);
  if (changes === 0) {
    res.status(404).json({ error: "Signup not found" });
    return;
  }
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// POST /api/signups/:id/link-account — Create the EL account and mark verified
// ---------------------------------------------------------------------------

router.post("/:id/link-account", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { apiKey } = req.body as { apiKey?: string };
  if (!apiKey || !apiKey.trim()) {
    res.status(400).json({ error: "apiKey is required" });
    return;
  }

  const signup = queryOne<SignupRow>("SELECT * FROM signups WHERE id = ?", [id]);
  if (!signup) {
    res.status(404).json({ error: "Signup not found" });
    return;
  }
  if (signup.status === "verified") {
    res.status(409).json({ error: "Signup already verified" });
    return;
  }

  try {
    const account = await createAccountFromKey(apiKey.trim());
    runChanges(
      `UPDATE signups
         SET status = 'verified',
             account_id = ?,
             verified_at = datetime('now'),
             automation_error = NULL,
             automation_step = NULL
       WHERE id = ?`,
      [account.id, id]
    );
    res.status(201).json({ account, signup_id: id });
  } catch (err) {
    if (err instanceof ElevenLabsError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    res.status(502).json({ error: "Failed to reach ElevenLabs API" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/signups/:id/open-incognito — Launch a visible Playwright Chromium
// with a fresh context (no EL session) and pre-fill the row's email + password.
// User clicks Sign Up themselves so EL sees a human-driven submit.
// ---------------------------------------------------------------------------

router.post("/:id/open-incognito", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    // Fire-and-forget: respond immediately, browser launches async (~2s).
    void openInteractiveSignup(id).catch((err) => {
      console.error("[signups] interactive signup failed:", err);
    });
    res.status(202).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "launch failed" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/signups/:id/credentials — Decrypted email + password for clipboard.
// The frontend uses this to populate the user's clipboard so they can paste
// into EL's signup form. Never logged, never stored client-side.
// ---------------------------------------------------------------------------

router.get("/:id/credentials", (req: Request, res: Response): void => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const signup = queryOne<SignupRow>("SELECT * FROM signups WHERE id = ?", [id]);
  if (!signup) {
    res.status(404).json({ error: "Signup not found" });
    return;
  }
  if (!signup.password) {
    res.status(400).json({ error: "No stored password (was EL_SHARED_PASSWORD set when generated?)" });
    return;
  }
  res.json({ email: signup.email, password: decrypt(signup.password) });
});

// ---------------------------------------------------------------------------
// POST /api/signups/:id/auto-enroll — Kick off Playwright automation
// ---------------------------------------------------------------------------

router.post("/:id/auto-enroll", (req: Request, res: Response): void => {
  if (!isAutomationEnabled()) {
    res.status(503).json({ error: "Automation not enabled (set EL_AUTOMATION_ENABLED=true and EL_SHARED_PASSWORD)" });
    return;
  }

  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const signup = queryOne<SignupRow>("SELECT * FROM signups WHERE id = ?", [id]);
  if (!signup) {
    res.status(404).json({ error: "Signup not found" });
    return;
  }
  if (signup.status === "verified") {
    res.status(409).json({ error: "Signup already verified" });
    return;
  }
  if (signup.status === "automating") {
    res.status(409).json({ error: "Automation already running for this signup" });
    return;
  }
  // Reset failure state. Keep verification_link as-is — if signup already
  // went through EL once, we MUST NOT re-run stepSignup (EL would reject as
  // duplicate). Worker uses existing link; if it's spent, the user can click
  // EL's "Resend" and the IMAP poller will overwrite with a fresh link.
  if (signup.status === "failed") {
    const newStatus = signup.verification_link ? "verification_received" : "pending";
    runChanges(
      `UPDATE signups SET status = ?, automation_error = NULL WHERE id = ?`,
      [newStatus, id]
    );
  }
  if (!signup.password) {
    res.status(400).json({ error: "Signup has no stored password (was EL_SHARED_PASSWORD set when generated?)" });
    return;
  }

  enqueueAutomation(id);
  res.status(202).json({ accepted: true, signup_id: id });
});

export default router;
