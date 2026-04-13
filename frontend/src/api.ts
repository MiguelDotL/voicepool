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

export async function refreshAccounts(): Promise<RefreshResponse> {
  const res = await fetch("/api/accounts/refresh", { method: "POST" });
  return handleResponse<RefreshResponse>(res);
}
