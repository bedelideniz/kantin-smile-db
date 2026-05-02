// Client wrapper for the `donation-manager-api` edge function (OTP-based donation manager auth).
const FN_NAME = "donation-manager-api";
const TOKEN_KEY = "kantinpay.donmgr.token";
const SESSION_KEY = "kantinpay.donmgr.session";

export interface DonationManagerSession {
  token: string;
  expires_at: string;
  manager: {
    id: string;
    full_name: string;
    school_id: string;
    school_name: string;
  };
}

export function getDmToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getDmSession(): DonationManagerSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as DonationManagerSession;
    if (new Date(s.expires_at) < new Date()) {
      clearDmSession();
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function saveDmSession(s: DonationManagerSession) {
  localStorage.setItem(TOKEN_KEY, s.token);
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

export function clearDmSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSION_KEY);
}

function functionUrl(): string {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID as string;
  return `https://${projectId}.functions.supabase.co/${FN_NAME}`;
}

export class DmApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function callDmApi<T = any>(op: string, params: Record<string, unknown> = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getDmToken();
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
    if (res.status === 401) clearDmSession();
    throw new DmApiError(res.status, msg);
  }
  return (json?.data ?? json) as T;
}
