import { randomBytes } from "node:crypto";
import { query, runChanges } from "../db/index.js";
import { fetchRecentElMessages, type InboundEmail } from "./imap.js";
import { enqueue as enqueueAutomation, isAutomationEnabled } from "./elAutomation.js";

const URL_RE = /https?:\/\/[^\s"'<>)]+/gi;
const VERIFY_HINT = /verify|confirm|validate|token|signup|signin/i;

export type SignupStatus =
  | "pending"
  | "verification_received"
  | "automating"
  | "verified"
  | "failed";

export interface SignupRow {
  id: number;
  email: string;
  status: SignupStatus;
  verification_link: string | null;
  account_id: number | null;
  created_at: string;
  verified_at: string | null;
  password: string | null;
  automation_step: string | null;
  automation_error: string | null;
}

export function generateEmail(): string {
  const slug = `vp-${randomBytes(4).toString("hex")}`;
  return `${slug}@${process.env.MAIL_DOMAIN}`;
}

function messageMatchesAddress(msg: InboundEmail, address: string): boolean {
  const lower = address.toLowerCase();
  if (msg.recipients.includes(lower)) return true;
  return msg.rawSource.toLowerCase().includes(lower);
}

function extractElVerificationUrl(msg: InboundEmail): string | null {
  const haystack = `${msg.text}\n${msg.html}`;
  const matches = haystack.match(URL_RE) ?? [];
  const elOnly = matches.filter((u) => u.includes("elevenlabs.io"));
  const verifyish = elOnly.find((u) => VERIFY_HINT.test(u));
  return verifyish ?? elOnly[0] ?? null;
}

let timer: NodeJS.Timeout | null = null;

export function startPolling(): void {
  if (timer) return;
  if (!process.env.MAIL_DOMAIN || !process.env.IMAP_USER) {
    console.log("[signups] MAIL_DOMAIN or IMAP_USER not set — poller disabled");
    return;
  }
  console.log("[signups] poller started (6s interval)");
  timer = setInterval(() => { void pollOnce(); }, 6_000);
  void pollOnce();
}

export function stopPolling(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

async function pollOnce(): Promise<void> {
  // Match both pending rows AND failed rows — the latter so we can refresh the
  // verify link when EL's "Resend verification" is clicked after a failed run.
  const watching = query<SignupRow>(
    `SELECT * FROM signups WHERE status IN ('pending', 'failed')`
  );
  console.log(`[signups] poll: ${watching.length} watched row(s)`);
  if (watching.length === 0) return;

  let messages: InboundEmail[];
  try {
    messages = await fetchRecentElMessages();
  } catch (err) {
    console.error("[signups] IMAP fetch failed:", err);
    return;
  }
  console.log(`[signups] poll: ${messages.length} EL message(s) in window`);

  for (const s of watching) {
    const m = messages.find((msg) => messageMatchesAddress(msg, s.email));
    if (!m) {
      console.log(`[signups] poll: no msg for ${s.email}`);
      continue;
    }
    const link = extractElVerificationUrl(m);
    if (!link) {
      console.log(`[signups] poll: matched ${s.email} but no verify URL`);
      continue;
    }
    // For pending rows we always update. For failed rows we only update if the
    // link is different from what's already there — that signals a fresh email
    // (e.g. from "Resend"), not the same one we already tried and spent.
    if (s.status === "failed" && s.verification_link === link) {
      continue;
    }
    const updated = runChanges(
      `UPDATE signups
         SET verification_link = ?, status = 'verification_received', automation_error = NULL
       WHERE id = ? AND status IN ('pending', 'failed')`,
      [link, s.id]
    );
    console.log(`[signups] poll: matched ${s.email}, updated=${updated}, link=${link}`);
    if (updated > 0 && isAutomationEnabled() && s.password) {
      console.log(`[signups] poll: enqueueing automation for signup ${s.id}`);
      enqueueAutomation(s.id);
    }
  }
}
