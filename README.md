# Voicepool

Open-source ElevenLabs fleet dashboard. Tracks usage and reset schedules across many accounts, routes TTS calls to the account with the most capacity, and provisions new accounts end-to-end with one click.

## What it does

- **Fleet dashboard** — usage bars, remaining characters, reset countdown, sortable columns, double-click to rename.
- **TTS routing** — `POST /api/tts` picks the account with the most capacity available, falls over on rate limits, transparently retries.
- **Per-account voice mapping** — keep a list of which voices each account has installed; the TTS route only picks accounts that own the requested voice.
- **One-click provisioning** — generates a unique `vp-…@yourdomain.com` email, opens a Playwright window, auto-fills + auto-clicks Sign Up, watches IMAP for the verification email, drives EL's verify + onboarding + API-key flow, registers the account, and adds your default voice. Hidden behind `EL_AUTOMATION_ENABLED` because it requires a browser binary.
- **Live branch indicator** in the header via [branch-beacon](https://www.npmjs.com/package/branch-beacon) (a separate OSS package extracted from this project). Hides itself in production.

## Setup

```bash
npm run install:all
cp .env.example .env
# Generate an encryption key:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Paste it as ENCRYPTION_KEY in .env
```

Optional one-time setup for the automated provisioning flow:

```bash
cd api && npx playwright install chromium
```

## Run

```bash
npm run dev          # both servers
npm run dev:api      # backend on :3500
npm run dev:frontend # frontend on :3501
```

Frontend proxies `/api/*` to the backend.

## Configuration

All settings live in `.env`. Only `ENCRYPTION_KEY` is required.

### Core

| Variable | Required | Notes |
|---|---|---|
| `ENCRYPTION_KEY` | yes | 32-byte hex. AES-256-GCM key for API keys at rest. |
| `PORT` | no | Backend port. Default: `3500`. |

### Email automation (the `▸ PROVISION NODE` panel)

The panel only renders if `MAIL_DOMAIN` is set.

| Variable | Notes |
|---|---|
| `MAIL_DOMAIN` | Catch-all domain Voicepool generates signup emails on (e.g. `yourdomain.com`). |
| `IMAP_HOST` / `IMAP_PORT` / `IMAP_USER` / `IMAP_PASS` | Inbox the catch-all forwards into. For Gmail: enable 2FA, create an app password at https://myaccount.google.com/apppasswords. |

You'll need a domain with catch-all email forwarding to a personal inbox you control. Free options: [ImprovMX](https://improvmx.com), [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/).

**Gmail Spam gotcha** — ElevenLabs verification emails sometimes land in Spam, and Voicepool only polls `INBOX`. Add a Gmail filter pinning `from:elevenlabs.io` to Inbox: Settings → Filters → Create new filter → From: `elevenlabs.io` → Apply: "Never send to Spam".

### Full signup automation (Playwright)

Layered on top of email automation. Adds a headed Chromium worker that drives the signup form, verification, onboarding wizard, API key creation, and voice add. Manual paste flow still available as fallback.

| Variable | Notes |
|---|---|
| `EL_AUTOMATION_ENABLED` | `true` to enable the worker. Default: `false`. |
| `EL_SHARED_PASSWORD` | Reused across every auto-generated account (free EL accounts only). Encrypted per-row in the DB. |
| `EL_DEFAULT_VOICES` | Comma-separated voice names auto-added to each new account, e.g. `Declan Sage`. |

Captcha caveat: the automation does not solve hCaptcha. The hybrid flow has the user submit the signup form themselves in the visible browser to dodge bot detection; everything after the verify email is fully automated.

## API

| Endpoint | Purpose |
|---|---|
| `POST /api/tts` | Generate TTS. Body: `{ text, voice_id, model_id?, output_format? }`. Picks the account with the most remaining characters that owns the voice; retries on rate limits. |
| `GET /api/accounts` | List accounts with usage snapshots. |
| `POST /api/accounts` | Add an EL account by API key. Validates and captures usage. |
| `PATCH /api/accounts/:id` | Rename. |
| `DELETE /api/accounts/:id` | Remove. |
| `POST /api/accounts/refresh` | Poll EL `/v1/user` for every account, store fresh usage snapshots. |
| `GET /api/accounts/available?voice_id=…` | Accounts owning a voice with capacity remaining. |
| `GET /api/voices` / `POST /api/voices` / `DELETE /api/voices/:id` | Per-account voice mapping CRUD. |
| `GET /api/signups` / `POST /api/signups` | Signup row CRUD (provisioning state machine). |
| `POST /api/signups/:id/auto-enroll` | Kick the Playwright worker. |
| `POST /api/signups/:id/open-incognito` | Launch the headed signup window. |
| `POST /api/signups/:id/link-account` | Manual fallback: paste an API key for a verified signup. |
| `GET /api/dev/git-branch` | Pure dev readout for the [branch-beacon](https://www.npmjs.com/package/branch-beacon) indicator. Hidden in prod. |

## Stack

- Backend: Express + TypeScript + sql.js (pure-JS SQLite via WASM), Playwright for signup automation, imapflow + mailparser for the verify-email watcher.
- Frontend: React 19 + Vite + Tailwind 4.
- Encryption: AES-256-GCM via `node:crypto` for API keys + signup passwords at rest.

## Branching

`feat/*` or `fix/*` → `dev` → `main`. PRs target `dev`; releases promote `dev → main`.
