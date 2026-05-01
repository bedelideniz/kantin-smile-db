// Shared SMS sender (NetGSM HTTP API).
// Reads credentials from external DB `netgsm_config` table and logs every send.
import { query } from "./external-db.ts";

interface NetgsmConfig {
  username: string | null;
  password: string | null;
  msgheader: string | null;
  is_active: boolean;
}

async function loadConfig(): Promise<NetgsmConfig | null> {
  const r = await query<NetgsmConfig>(
    "SELECT username, password, msgheader, is_active FROM netgsm_config WHERE id = 1",
  );
  return r.rows[0] ?? null;
}

// Normalize TR mobile number to NetGSM's expected format: 5XXXXXXXXX (10 digits).
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D+/g, "");
  if (digits.startsWith("90") && digits.length === 12) return digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) return digits.slice(1);
  return digits;
}

export interface SendSmsResult {
  ok: boolean;
  status: string;
  raw: string;
}

/**
 * Send SMS via NetGSM `sendsms-1` HTTP endpoint.
 * Docs: https://www.netgsm.com.tr/dokuman/#sendsms-1
 * Returns raw provider response code (e.g. "00 BULKID").
 */
export async function sendSms(phone: string, message: string): Promise<SendSmsResult> {
  const cfg = await loadConfig();
  if (!cfg || !cfg.is_active) {
    const result: SendSmsResult = { ok: false, status: "disabled", raw: "NetGSM config not active" };
    await logSend(phone, message, result);
    return result;
  }
  if (!cfg.username || !cfg.password || !cfg.msgheader) {
    const result: SendSmsResult = { ok: false, status: "misconfigured", raw: "Missing NetGSM credentials" };
    await logSend(phone, message, result);
    return result;
  }

  const gsmno = normalizePhone(phone);
  const url = new URL("https://api.netgsm.com.tr/sms/send/get");
  url.searchParams.set("usercode", cfg.username);
  url.searchParams.set("password", cfg.password);
  url.searchParams.set("gsmno", gsmno);
  url.searchParams.set("message", message);
  url.searchParams.set("msgheader", cfg.msgheader);
  url.searchParams.set("dil", "TR");

  let raw = "";
  try {
    const res = await fetch(url.toString(), { method: "GET" });
    raw = (await res.text()).trim();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const result: SendSmsResult = { ok: false, status: "network_error", raw: msg };
    await logSend(phone, message, result);
    return result;
  }

  // NetGSM returns "00 <bulkid>" on success, otherwise an error code (20, 30, 40, 50, ...).
  const code = raw.split(/\s+/)[0];
  const ok = code === "00";
  const result: SendSmsResult = { ok, status: ok ? "sent" : `error_${code}`, raw };
  await logSend(phone, message, result);
  return result;
}

async function logSend(phone: string, message: string, r: SendSmsResult) {
  try {
    await query(
      "INSERT INTO sms_log (phone, message, provider, status, provider_response) VALUES ($1,$2,'netgsm',$3,$4)",
      [phone, message, r.status, r.raw],
    );
  } catch {
    // Logging failures must not break SMS flow
  }
}

export function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
