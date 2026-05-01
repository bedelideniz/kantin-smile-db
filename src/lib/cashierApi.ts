// Client wrapper for the `cashier-api` edge function.
// Uses a custom opaque token (stored in localStorage) instead of Supabase Auth,
// because cashiers authenticate with phone+PIN.
const FN_NAME = "cashier-api";
const TOKEN_KEY = "kantinpay.cashier.token";
const SESSION_KEY = "kantinpay.cashier.session";

export interface CashierSession {
  token: string;
  expires_at: string;
  cashier: { id: string; full_name: string };
  school: { id: string; name: string };
}

export function getCashierToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getCashierSession(): CashierSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as CashierSession;
    if (new Date(s.expires_at) < new Date()) {
      clearCashierSession();
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function saveCashierSession(s: CashierSession) {
  localStorage.setItem(TOKEN_KEY, s.token);
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

export function clearCashierSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSION_KEY);
}

function functionUrl(): string {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID as string;
  return `https://${projectId}.functions.supabase.co/${FN_NAME}`;
}

export class CashierApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function callCashierApi<T = any>(op: string, params: Record<string, unknown> = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getCashierToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(functionUrl(), {
    method: "POST",
    headers,
    body: JSON.stringify({ op, params }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof json?.error === "string"
      ? json.error
      : (json?.error ? JSON.stringify(json.error) : `İstek başarısız (${res.status})`);
    if (res.status === 401) clearCashierSession();
    throw new CashierApiError(res.status, msg);
  }
  return (json?.data ?? json) as T;
}
