# Voicepool

## What This Project Is
Standalone open-source ElevenLabs fleet dashboard. Track usage, character limits, and reset schedules across multiple ElevenLabs accounts from a single UI.

## Tech Stack
- **Backend:** Express + TypeScript + sql.js (pure JS SQLite via WASM)
- **Frontend:** React + Vite + TypeScript
- **Encryption:** AES-256-GCM via `node:crypto` for API keys at rest
- **HTTP:** Built-in `fetch` (Node 18+) for ElevenLabs API calls

## How to Run

### First-time setup
```bash
# Install all dependencies
npm run install:all

# Copy and configure environment
cp .env.example .env
# Edit .env and set ENCRYPTION_KEY (generate with the command in .env.example)
```

### Development
```bash
# Run both backend and frontend
npm run dev

# Or run individually
npm run dev:api       # Backend on port 3500
npm run dev:frontend  # Frontend on port 3501
```

### Production build
```bash
npm run build
```

## Port Configuration
| Service  | Port |
|----------|------|
| Backend  | 3500 |
| Frontend | 3501 |

Frontend proxies `/api` requests to the backend in development.

## Project Structure
```
api/
  src/
    db/         — SQLite database and migrations
    routes/     — Express route handlers
    services/   — Encryption, ElevenLabs client
    index.ts    — Server entry point
frontend/       — React + Vite app
```

## Conventions
- TypeScript strict mode everywhere
- Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`
- No AI/LLM libraries — this is a pure REST proxy to ElevenLabs
- API keys are encrypted at rest with AES-256-GCM
- Never return raw API keys from GET endpoints
