// ---------------------------------------------------------------------------
// Types matching the backend response shapes
// ---------------------------------------------------------------------------

export interface UsageSnapshot {
  character_count: number;
  character_limit: number;
  next_reset_unix: number;
  tier: string;
  status: string;
  fetched_at: string;
}

export interface Account {
  id: number;
  label: string;
  created_at: string;
  usage: UsageSnapshot | null;
}

export interface RefreshResponse {
  accounts: Account[];
  errors: { id: number; label: string; error: string }[];
}

export interface ApiError {
  error: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as ApiError;
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

export async function fetchAccounts(): Promise<Account[]> {
  const res = await fetch("/api/accounts");
  return handleResponse<Account[]>(res);
}

export async function addAccount(apiKey: string): Promise<Account> {
  const res = await fetch("/api/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  return handleResponse<Account>(res);
}

export async function deleteAccount(id: number): Promise<void> {
  const res = await fetch(`/api/accounts/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as ApiError;
    throw new Error(body.error ?? `Delete failed: ${res.status}`);
  }
}

export async function renameAccount(id: number, label: string): Promise<void> {
  const res = await fetch(`/api/accounts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as ApiError;
    throw new Error(body.error ?? `Rename failed: ${res.status}`);
  }
}

export async function refreshAccounts(): Promise<RefreshResponse> {
  const res = await fetch("/api/accounts/refresh", { method: "POST" });
  return handleResponse<RefreshResponse>(res);
}

// ---------------------------------------------------------------------------
// Signups (semi-auto ElevenLabs onboarding)
// ---------------------------------------------------------------------------

export interface Signup {
  id: number;
  email: string;
  status: "pending" | "verification_received" | "automating" | "verified" | "failed";
  verification_link: string | null;
  account_id: number | null;
  created_at: string;
  verified_at: string | null;
  automation_step: string | null;
  automation_error: string | null;
}

export interface AppConfig {
  mail_enabled: boolean;
  automation_enabled: boolean;
}

export async function fetchConfig(): Promise<AppConfig> {
  const res = await fetch("/api/config");
  return handleResponse<AppConfig>(res);
}

export interface LinkAccountResponse {
  account: Account;
  signup_id: number;
}

export async function createSignup(): Promise<Signup> {
  const res = await fetch("/api/signups", { method: "POST" });
  return handleResponse<Signup>(res);
}

export async function listSignups(): Promise<Signup[]> {
  const res = await fetch("/api/signups");
  return handleResponse<Signup[]>(res);
}

export async function deleteSignup(id: number): Promise<void> {
  const res = await fetch(`/api/signups/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as ApiError;
    throw new Error(body.error ?? `Delete failed: ${res.status}`);
  }
}

export async function linkSignupAccount(
  id: number,
  apiKey: string
): Promise<LinkAccountResponse> {
  const res = await fetch(`/api/signups/${id}/link-account`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  return handleResponse<LinkAccountResponse>(res);
}

export async function triggerAutoEnroll(id: number): Promise<void> {
  const res = await fetch(`/api/signups/${id}/auto-enroll`, { method: "POST" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as ApiError;
    throw new Error(body.error ?? `Auto-enroll failed: ${res.status}`);
  }
}

export async function fetchSignupCredentials(
  id: number
): Promise<{ email: string; password: string }> {
  const res = await fetch(`/api/signups/${id}/credentials`);
  return handleResponse<{ email: string; password: string }>(res);
}

export async function openSignupIncognito(id: number): Promise<void> {
  const res = await fetch(`/api/signups/${id}/open-incognito`, { method: "POST" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as ApiError;
    throw new Error(body.error ?? `Failed to open incognito: ${res.status}`);
  }
}
