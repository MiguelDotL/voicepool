import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import express, { type Application } from "express";
import cors from "cors";
import { initDatabase, query } from "./db/index.js";
import accountsRouter from "./routes/accounts.js";
import ttsRouter from "./routes/tts.js";
import voicesRouter from "./routes/voices.js";
import signupsRouter from "./routes/signups.js";
import { startPolling, stopPolling } from "./services/signups.js";
import { disconnect as imapDisconnect } from "./services/imap.js";
import { shutdown as automationShutdown, isAutomationEnabled } from "./services/elAutomation.js";

const PORT = Number(process.env.PORT) || 3500;

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

async function main(): Promise<void> {
  await initDatabase();

  const accountCount = (query<{ c: number }>("SELECT COUNT(*) as c FROM accounts")[0]?.c) ?? 0;
  console.log(`Database initialized. Accounts loaded: ${accountCount}`);

  const app: Application = express();

  const allowedOrigins = process.env.ALLOWED_ORIGINS;
  if (allowedOrigins) {
    const origins = allowedOrigins.split(",").map((o) => o.trim());
    app.use(cors({ origin: origins }));
  } else {
    app.use(cors());
  }

  app.use(express.json({ limit: "256kb" }));

  app.use("/api/accounts", accountsRouter);
  app.use("/api/tts", ttsRouter);
  app.use("/api/voices", voicesRouter);
  app.use("/api/signups", signupsRouter);

  app.get("/api/config", (_req, res) => {
    res.json({
      mail_enabled: Boolean(process.env.MAIL_DOMAIN && process.env.IMAP_USER),
      automation_enabled: isAutomationEnabled(),
    });
  });

  app.get("/api/health", (_req, res) => {
    const rows = query<{ c: number }>("SELECT COUNT(*) as c FROM accounts");
    const accounts = rows[0]?.c ?? 0;

    const snapRows = query<{ remaining: number }>(
      `SELECT SUM(character_limit - character_count) as remaining
       FROM usage_snapshots
       WHERE id IN (
         SELECT MAX(id) FROM usage_snapshots GROUP BY account_id
       )`
    );
    const pool_chars_remaining = snapRows[0]?.remaining ?? 0;

    res.json({ ok: true, accounts, pool_chars_remaining });
  });

  const server = app.listen(PORT, () => {
    console.log(`Voicepool API listening on http://localhost:${PORT}`);
  });

  startPolling();

  process.on("SIGTERM", () => {
    console.log("SIGTERM received. Shutting down gracefully...");
    stopPolling();
    void imapDisconnect();
    void automationShutdown();
    server.close(() => {
      console.log("Server closed.");
      process.exit(0);
    });
    setTimeout(() => {
      console.error("Forced shutdown after 30s timeout.");
      process.exit(1);
    }, 30_000).unref();
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
