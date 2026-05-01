// Public endpoint: school admin requests an OTP via SMS.
// Validates the phone is a known school admin, generates a 6-digit code,
// stores it in otp_codes, and dispatches via NetGSM.
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { z } from "npm:zod@3.23.8";
import { query } from "../_shared/external-db.ts";
import { generateOtp, normalizePhone, sendSms } from "../_shared/sms.ts";

const BodySchema = z.object({ phone: z.string().min(5).max(32) });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: "Geçersiz telefon numarası" }, 400);
    }
    const phone = normalizePhone(parsed.data.phone);

    // Tolerate legacy rows where phone may have been stored with a leading 0
    // or country code. Match against any common variant.
    const variants = Array.from(new Set([phone, `0${phone}`, `90${phone}`, `+90${phone}`, parsed.data.phone]));
    const r = await query<{ full_name: string }>(
      "SELECT full_name FROM app_users WHERE phone = ANY($1::text[]) AND role = 'school_admin' AND is_active = TRUE LIMIT 1",
      [variants],
    );

    if (r.rowCount === 0) {
      // Don't reveal absence; pretend success.
      await new Promise((res) => setTimeout(res, 400));
      return json({ ok: true });
    }

    const fullName = r.rows[0].full_name;

    // Throttle: max 3 OTPs per phone in the last 5 minutes.
    const recent = await query<{ c: number }>(
      "SELECT COUNT(*)::int AS c FROM otp_codes WHERE phone = $1 AND created_at > now() - interval '5 minutes'",
      [phone],
    );
    if ((recent.rows[0]?.c ?? 0) >= 3) {
      return json({ error: "Çok fazla istek. Lütfen birkaç dakika sonra tekrar deneyin." }, 429);
    }

    const code = generateOtp();
    await query(
      "INSERT INTO otp_codes (phone, code, purpose, expires_at) VALUES ($1, $2, 'login', now() + interval '10 minutes')",
      [phone, code],
    );

    const message = `KantinPay'e hos geldiniz ${fullName}. Giris kodunuz: ${code}`;
    const sms = await sendSms(phone, message);

    if (!sms.ok) {
      return json({ error: "SMS gönderilemedi. Lütfen daha sonra tekrar deneyin." }, 502);
    }

    return json({ ok: true });
  } catch (e) {
    console.error("school-admin-login error:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
