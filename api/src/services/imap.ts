import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";

export class ImapError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ImapError";
  }
}

export interface InboundEmail {
  recipients: string[];
  subject: string;
  text: string;
  html: string;
  rawSource: string;
}

// We deliberately do NOT reuse a long-lived client. Gmail's IMAP can return
// stale search results on a connection that has been open across new-mail
// arrivals — we observed verify emails sitting in INBOX while `c.search()`
// returned an older snapshot. A fresh connection per fetch is slower (~1s)
// but correct, and we only fetch on a 6s interval so the overhead is small.
async function newClient(): Promise<ImapFlow> {
  const c = new ImapFlow({
    host: process.env.IMAP_HOST!,
    port: Number(process.env.IMAP_PORT) || 993,
    secure: true,
    auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASS! },
    logger: false,
  });
  await c.connect();
  return c;
}

function flattenAddresses(field: AddressObject | AddressObject[] | undefined): string[] {
  if (!field) return [];
  const arr = Array.isArray(field) ? field : [field];
  return arr.flatMap((a) => a.value.map((v) => v.address ?? "")).filter(Boolean);
}

function splitHeaderList(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export async function fetchRecentElMessages(): Promise<InboundEmail[]> {
  const c = await newClient();
  try {
    const lock = await c.getMailboxLock("INBOX");
    try {
      const since = new Date(Date.now() - 30 * 60 * 1000);
      const uids = await c.search({ from: "elevenlabs.io", since });
      if (!uids || uids.length === 0) return [];

      const out: InboundEmail[] = [];
      for await (const msg of c.fetch(uids, { source: true })) {
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source);
        const recipients = [
          ...flattenAddresses(parsed.to),
          ...flattenAddresses(parsed.cc),
          ...flattenAddresses(parsed.bcc),
          ...splitHeaderList(parsed.headers.get("delivered-to")),
          ...splitHeaderList(parsed.headers.get("x-original-to")),
        ]
          .map((a) => a.toLowerCase())
          .filter(Boolean);

        out.push({
          recipients,
          subject: parsed.subject ?? "",
          text: parsed.text ?? "",
          html: typeof parsed.html === "string" ? parsed.html : "",
          rawSource: msg.source.toString("utf8"),
        });
      }
      return out;
    } finally {
      lock.release();
    }
  } finally {
    try { await c.logout(); } catch { /* ignore */ }
  }
}

// No-op kept for backward compat — the per-fetch client closes itself.
export async function disconnect(): Promise<void> { /* noop */ }
