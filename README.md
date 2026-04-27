# Voicepool

Open-source ElevenLabs fleet dashboard. Track usage, character limits, and reset schedules across multiple accounts; route TTS calls to the account with the most capacity; semi-automate signing up new accounts.

## Setup

```bash
npm run install:all
cp .env.example .env
# Generate an encryption key:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Paste it as ENCRYPTION_KEY in .env
```

## Run

```bash
npm run dev          # both servers
npm run dev:api      # backend on :3500
npm run dev:frontend # frontend on :3501
```

## Email automation (optional)

The `▸ ENROLL` panel automates the toilsome parts of creating new ElevenLabs accounts: it generates a unique address on your domain, watches your inbox for the verification email, and surfaces a one-click verify button + inline API-key input. The panel renders only if `MAIL_DOMAIN` is configured.

### What it needs

1. **A domain with catch-all email forwarding** to a personal inbox you control. Common setups: [ImprovMX](https://improvmx.com) (free), [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/) (free), or self-hosted.
2. **IMAP access to that personal inbox.** For Gmail: enable 2FA, then create an app password at https://myaccount.google.com/apppasswords.

### `.env` settings

```
MAIL_DOMAIN=yourdomain.com
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=you@gmail.com
IMAP_PASS=your-16-char-app-password
```

### Gotcha: Gmail Spam filter

ElevenLabs verification emails sometimes land in Spam. Voicepool only polls the `INBOX` folder. Add a Gmail filter pinning `from:elevenlabs.io` to Inbox:

1. Gmail → Settings → Filters and Blocked Addresses → Create new filter
2. From: `elevenlabs.io`
3. Apply: "Never send to Spam"

### What you still do by hand

- The signup CAPTCHA (no headless browser / CAPTCHA-solver in scope)
- Copying the API key from ElevenLabs → Settings into the inline `ADD NODE` input

The rest — generating the email, watching IMAP, extracting the verify link — runs in the background.
