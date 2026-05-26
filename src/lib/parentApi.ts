// Client wrapper for the `parent-api` edge function (OTP-based parent auth).
const FN_NAME = "parent-api";
const TOKEN_KEY = "kantinpay.parent.token";
const SESSION_KEY = "kantinpay.parent.session";
const SELECTED_KEY = "kantinpay.parent.selectedStudent";

export interface ParentStudent {
  id: string;
  school_id: string;
  school_name: string;
  full_name: string;
  class_name: string | null;
  student_no: string | null;
  balance: number;
  photo_url?: string | null;
  card_lost?: boolean;
  has_card?: boolean;
  daily_spend_limit?: number | null;
  today_spent?: number;
}

export interface ParentSession {
  token: string;
  expires_at: string;
  phone: string;
  must_change?: boolean;
  students: ParentStudent[];
}

export function getParentToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getParentSession(): ParentSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as ParentSession;
    if (new Date(s.expires_at) < new Date()) {
      clearParentSession();
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function saveParentSession(s: ParentSession) {
  localStorage.setItem(TOKEN_KEY, s.token);
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

export function updateParentStudents(students: ParentStudent[]) {
  const cur = getParentSession();
  if (!cur) return;
  saveParentSession({ ...cur, students });
}

export function clearParentSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SELECTED_KEY);
}

export function getSelectedStudentId(): string | null {
  return localStorage.getItem(SELECTED_KEY);
}
export function setSelectedStudentId(id: string | null) {
  if (id) localStorage.setItem(SELECTED_KEY, id);
  else localStorage.removeItem(SELECTED_KEY);
}

function functionUrl(): string {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID as string;
  return `https://${projectId}.functions.supabase.co/${FN_NAME}`;
}

export class ParentApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function callParentApi<T = any>(op: string, params: Record<string, unknown> = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getParentToken();
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
    if (res.status === 401) clearParentSession();
    throw new ParentApiError(res.status, msg);
  }
  return (json?.data ?? json) as T;
}
