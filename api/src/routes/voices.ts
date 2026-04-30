import { Router, Request, Response } from "express";
import { query, queryOne, run, runChanges } from "../db/index.js";

const router = Router();

interface VoiceRow {
  id: number;
  account_id: number;
  account_label: string;
  voice_name: string;
  voice_id: string;
  created_at: string;
}

router.get("/", (_req: Request, res: Response): void => {
  const rows = query<VoiceRow>(`
    SELECT av.id, av.account_id, a.label as account_label, av.voice_name, av.voice_id, av.created_at
    FROM account_voices av
    JOIN accounts a ON a.id = av.account_id
    ORDER BY av.voice_name, av.account_id
  `);
  res.json(rows);
});

router.post("/", (req: Request, res: Response): void => {
  const { account_id, voice_name, voice_id } = req.body as {
    account_id?: number;
    voice_name?: string;
    voice_id?: string;
  };

  if (account_id === undefined || !voice_name || !voice_id) {
    res.status(400).json({ error: "missing_fields" });
    return;
  }

  try {
    const insertedId = run(
      `INSERT INTO account_voices (account_id, voice_name, voice_id) VALUES (?, ?, ?)`,
      [account_id, voice_name, voice_id]
    );
    const row = queryOne<VoiceRow>(
      `SELECT av.id, av.account_id, a.label as account_label, av.voice_name, av.voice_id, av.created_at
       FROM account_voices av
       JOIN accounts a ON a.id = av.account_id
       WHERE av.id = ?`,
      [insertedId]
    );
    res.status(201).json(row);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE constraint failed")) {
      res.status(409).json({ error: "already_exists" });
      return;
    }
    throw err;
  }
});

router.delete("/:id", (req: Request, res: Response): void => {
  const id = Number(req.params.id);
  const changed = runChanges(`DELETE FROM account_voices WHERE id = ?`, [id]);
  if (changed === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.status(204).send();
});

export default router;
