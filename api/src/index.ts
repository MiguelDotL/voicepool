import express from "express";
import cors from "cors";
import { initDatabase } from "./db/index.js";
import accountsRouter from "./routes/accounts.js";

const PORT = Number(process.env.PORT) || 3500;

async function main(): Promise<void> {
  // Initialize SQLite (loads WASM, runs migrations)
  await initDatabase();
  console.log("Database initialized.");

  const app = express();

  app.use(cors());
  app.use(express.json());

  // Mount routes
  app.use("/api/accounts", accountsRouter);

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.listen(PORT, () => {
    console.log(`Voicepool API listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
