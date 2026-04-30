import { useState, useEffect, useCallback, useRef } from "react";
import {
  createSignup,
  listSignups,
  deleteSignup,
  linkSignupAccount,
  triggerAutoEnroll,
  fetchConfig,
  fetchSignupCredentials,
  openSignupIncognito,
  type Signup,
  type Account,
} from "../api";
import Panel from "./Panel";

interface Props {
  onAccountAdded: (account: Account) => void;
}

const POLL_MS = 4_000;
const EL_SIGNUP_URL = "https://elevenlabs.io/app/sign-up";

export default function SignupPanel({ onAccountAdded }: Props) {
  const [signups, setSignups] = useState<Signup[]>([]);
  const [offline, setOffline] = useState(false);
  const [automationEnabled, setAutomationEnabled] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [autoEnrolling, setAutoEnrolling] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [keyInputs, setKeyInputs] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState<Record<number, boolean>>({});
  const [errors, setErrors] = useState<Record<number, string | null>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch server config once (does the server have automation enabled?)
  useEffect(() => {
    void fetchConfig()
      .then((cfg) => {
        if (!cfg.mail_enabled) setOffline(true);
        setAutomationEnabled(cfg.automation_enabled);
      })
      .catch(() => { /* ignore — fall back to server-side checks */ });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await listSignups();
      setSignups(data);
    } catch {
      /* ignore — keep last known state */
    }
  }, []);

  // Initial load
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll while any row is in-progress (pending verification OR being automated)
  const visible = signups.filter((s) => s.status !== "verified");
  const anyPending = visible.some(
    (s) => s.status === "pending" || s.status === "automating"
  );

  useEffect(() => {
    if (!anyPending) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(() => { void refresh(); }, POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [anyPending, refresh]);

  // One-click provision: generate the email row, then immediately fire the
  // headed Playwright launch. The Playwright spawn is async/202; if it fails,
  // the row's RELAUNCH button is the recovery path.
  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setGenerateError(null);
    try {
      const fresh = await createSignup();
      setSignups((prev) => [fresh, ...prev]);
      try {
        await openSignupIncognito(fresh.id);
      } catch (err) {
        console.warn("auto-launch after generate failed:", err);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to generate";
      if (msg.toLowerCase().includes("not configured")) {
        setOffline(true);
      } else {
        setGenerateError(msg);
      }
    } finally {
      setGenerating(false);
    }
  }, []);

  // RETRY for a failed row — re-enqueues automation. Worker resets row state
  // server-side. Only useful when EL_AUTOMATION_ENABLED is true.
  const handleRetry = useCallback(async (id: number) => {
    setAutoEnrolling(true);
    try {
      await triggerAutoEnroll(id);
      void refresh();
    } catch (err) {
      setErrors((e) => ({ ...e, [id]: err instanceof Error ? err.message : "retry failed" }));
    } finally {
      setAutoEnrolling(false);
    }
  }, [refresh]);

  const handleCopyPassword = useCallback(async (id: number) => {
    try {
      const creds = await fetchSignupCredentials(id);
      await navigator.clipboard.writeText(creds.password);
    } catch {
      /* ignore — user can also see the row error if it's that bad */
    }
  }, []);

  // Backend launches a headed Playwright browser with email + password
  // pre-filled. User clicks Sign Up themselves so EL sees a human submit.
  const handleOpenSignup = useCallback(async (signupId: number) => {
    try {
      await openSignupIncognito(signupId);
    } catch (err) {
      console.warn("openSignupIncognito failed, falling back to clipboard:", err);
      try {
        await navigator.clipboard.writeText(EL_SIGNUP_URL);
      } catch { /* ignore */ }
    }
  }, []);

  const handleCopyEmail = useCallback(async (email: string) => {
    try { await navigator.clipboard.writeText(email); } catch { /* ignore */ }
  }, []);

  const handleSubmitKey = useCallback(
    async (id: number) => {
      const key = (keyInputs[id] ?? "").trim();
      if (!key) {
        setErrors((e) => ({ ...e, [id]: "API key required" }));
        return;
      }
      setSubmitting((s) => ({ ...s, [id]: true }));
      setErrors((e) => ({ ...e, [id]: null }));
      try {
        const { account } = await linkSignupAccount(id, key);
        onAccountAdded(account);
        // Remove this row from the visible list (DB still has the verified row).
        setSignups((prev) => prev.filter((s) => s.id !== id));
        setKeyInputs((m) => { const next = { ...m }; delete next[id]; return next; });
        setErrors((m) => { const next = { ...m }; delete next[id]; return next; });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to add account";
        setErrors((e) => ({ ...e, [id]: msg }));
      } finally {
        setSubmitting((s) => ({ ...s, [id]: false }));
      }
    },
    [keyInputs, onAccountAdded]
  );

  const handleDelete = useCallback(async (id: number) => {
    try {
      await deleteSignup(id);
      setSignups((prev) => prev.filter((s) => s.id !== id));
    } catch {
      /* ignore */
    }
  }, []);

  if (offline) {
    return (
      <Panel label="PROVISION NODE">
        <div className="px-4 py-3 text-[11px] font-mono uppercase tracking-widest text-rose-300/70">
          ▸ EMAIL AUTOMATION OFFLINE — set MAIL_DOMAIN + IMAP_* in .env
        </div>
      </Panel>
    );
  }

  return (
    <Panel label="PROVISION NODE">
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500">
            ▸ AUTO-CREATE NEW ELEVENLABS ACCOUNT + ATTACH VOICE
            {!automationEnabled && (
              <span className="ml-2 text-rose-300/60">[MANUAL FALLBACK]</span>
            )}
          </p>
          <button
            onClick={() => void handleGenerate()}
            disabled={generating || autoEnrolling}
            className="px-3 py-1.5 bg-cyan-300/10 hover:bg-cyan-300/15 border border-cyan-300/20 hover:border-cyan-300/40 text-cyan-200/90 text-xs font-mono font-medium uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {generating ? "› DEPLOYING" : "› DEPLOY"}
          </button>
        </div>

        {generateError && (
          <p className="text-rose-300/80 text-[11px] font-mono uppercase tracking-wider">
            ✕ {generateError}
          </p>
        )}

        {visible.length === 0 ? (
          <p className="text-gray-600 text-[11px] font-mono uppercase tracking-widest pt-1">
            [ NO PENDING ENROLLMENTS ]
          </p>
        ) : (
          <div className="space-y-2 pt-1">
            {visible.map((s) => (
              <SignupRow
                key={s.id}
                signup={s}
                apiKey={keyInputs[s.id] ?? ""}
                submitting={!!submitting[s.id]}
                error={errors[s.id] ?? null}
                automationEnabled={automationEnabled}
                onCopyEmail={handleCopyEmail}
                onCopyPassword={() => void handleCopyPassword(s.id)}
                onOpenSignup={handleOpenSignup}
                onApiKeyChange={(v) => setKeyInputs((m) => ({ ...m, [s.id]: v }))}
                onSubmitKey={() => void handleSubmitKey(s.id)}
                onDelete={() => void handleDelete(s.id)}
                onRetry={() => void handleRetry(s.id)}
              />
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

interface RowProps {
  signup: Signup;
  apiKey: string;
  submitting: boolean;
  error: string | null;
  automationEnabled: boolean;
  onCopyEmail: (email: string) => void;
  onCopyPassword: () => void;
  onOpenSignup: (signupId: number) => void;
  onApiKeyChange: (value: string) => void;
  onSubmitKey: () => void;
  onDelete: () => void;
  onRetry: () => void;
}

function SignupRow({
  signup,
  apiKey,
  submitting,
  error,
  automationEnabled,
  onCopyEmail,
  onCopyPassword,
  onOpenSignup,
  onApiKeyChange,
  onSubmitKey,
  onDelete,
  onRetry,
}: RowProps) {
  // Brief "copied!" flash on each clipboard button so user gets feedback.
  const [flash, setFlash] = useState<"email" | "pw" | "url" | null>(null);
  const flashCopy = useCallback((which: "email" | "pw" | "url") => {
    setFlash(which);
    setTimeout(() => setFlash((f) => (f === which ? null : f)), 1500);
  }, []);
  const isAutomating = signup.status === "automating";
  const isFailed = signup.status === "failed";
  // Manual UI shows whenever automation isn't running. After a failure we drop
  // back to whichever manual step matches current row state (link present →
  // verify+paste; no link → keep waiting for IMAP).
  // When automation is enabled, suppress the manual paste-key UI on failed
  // rows — RETRY is the preferred path, no need for two ways out.
  const isPending = signup.status === "pending" && !isAutomating;
  const hasLink =
    !isAutomating &&
    Boolean(signup.verification_link) &&
    (signup.status === "verification_received" ||
      (signup.status === "failed" && !automationEnabled));

  return (
    <div className="border border-cyan-300/[0.08] bg-white/[0.015] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-sm text-gray-200 font-mono truncate">{signup.email}</span>
          <button
            onClick={() => { onCopyEmail(signup.email); flashCopy("email"); }}
            title="Copy email"
            className={`text-xs flex-shrink-0 transition-colors ${flash === "email" ? "text-emerald-300" : "text-gray-500 hover:text-cyan-200"}`}
          >
            {flash === "email" ? "✓" : "⎘"}
          </button>
          <button
            onClick={() => { onCopyPassword(); flashCopy("pw"); }}
            title="Copy password to clipboard"
            className={`text-[10px] font-mono flex-shrink-0 transition-colors uppercase tracking-widest border px-1.5 py-0.5 ${flash === "pw" ? "text-emerald-300 border-emerald-300/40" : "text-gray-500 hover:text-cyan-200 border-gray-700 hover:border-cyan-300/40"}`}
          >
            {flash === "pw" ? "✓ PW" : "⎘ PW"}
          </button>
        </div>
        <button
          onClick={onDelete}
          title="Discard"
          className="text-gray-600 hover:text-rose-300 text-xs flex-shrink-0 transition-colors"
        >
          ✕
        </button>
      </div>

      {isAutomating && (
        <div className="mt-3 inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-emerald-300/70">
          <span className="hud-blink w-1.5 h-1.5 bg-emerald-300/80" />
          ▸ {(signup.automation_step ?? "running").toUpperCase()}
        </div>
      )}

      {isFailed && (
        <div className="mt-3 space-y-2">
          <div className="px-2 py-1.5 border border-rose-300/25 bg-rose-300/[0.04] text-[11px] font-mono text-rose-200/90">
            ✕ AUTOMATION FAILED — {signup.automation_error ?? "unknown error"}
          </div>
          {automationEnabled && (
            <button
              onClick={onRetry}
              className="px-3 py-1.5 bg-emerald-300/[0.06] hover:bg-emerald-300/[0.12] border border-emerald-300/25 hover:border-emerald-300/50 text-emerald-100 text-[11px] font-mono font-medium uppercase tracking-widest transition-colors"
            >
              › RETRY AUTOMATION
            </button>
          )}
        </div>
      )}

      {isPending && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            onClick={() => { onOpenSignup(signup.id); flashCopy("url"); }}
            title="Opens a new Chrome incognito window pointed at EL signup"
            className={`px-3 py-1.5 border text-[11px] font-mono font-medium uppercase tracking-widest transition-colors ${flash === "url" ? "bg-emerald-300/[0.12] border-emerald-300/50 text-emerald-100" : "bg-cyan-300/[0.06] hover:bg-cyan-300/[0.12] border-cyan-300/25 hover:border-cyan-300/50 text-cyan-100"}`}
          >
            {flash === "url" ? "✓ RELAUNCHED" : "› RELAUNCH BROWSER ↗"}
          </button>
          <span className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-cyan-300/50">
            <span className="hud-blink w-1.5 h-1.5 bg-cyan-300/70" />
            AWAITING SIGNUP
          </span>
        </div>
      )}

      {hasLink && (
        <div className="mt-3 space-y-2">
          <a
            href={signup.verification_link!}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block px-3 py-1.5 bg-cyan-300/[0.08] hover:bg-cyan-300/[0.16] border border-cyan-300/30 hover:border-cyan-300/60 text-cyan-100 text-[11px] font-mono font-medium uppercase tracking-widest transition-colors"
          >
            › OPEN VERIFY LINK ↗
          </a>
          <div className="flex items-stretch gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              placeholder="sk_••••••••••••"
              disabled={submitting}
              className="flex-1 bg-[#0b0d11] border border-cyan-300/15 px-3 py-2 text-sm text-gray-200 placeholder-gray-700 font-mono focus:outline-none focus:border-cyan-300/50 focus:ring-1 focus:ring-cyan-300/20 disabled:opacity-50 transition-colors"
            />
            <button
              onClick={onSubmitKey}
              disabled={submitting || !apiKey.trim()}
              className="px-4 py-2 bg-cyan-300/[0.06] hover:bg-cyan-300/[0.12] border border-cyan-300/30 hover:border-cyan-300/60 text-cyan-100 text-[11px] font-mono font-medium uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {submitting ? "› LINKING" : "› ADD NODE"}
            </button>
          </div>
          {error && (
            <p className="text-rose-300/80 text-[11px] font-mono uppercase tracking-wider">
              ✕ {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
