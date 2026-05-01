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
    const inputDigits = parsed.data.phone.replace(/\D+/g, "");
    const variants = Array.from(new Set([phone, `0${phone}`, `90${phone}`, inputDigits]));
    const r = await query<{ full_name: string }>(
      `SELECT full_name FROM app_users
        WHERE (phone = ANY($1::text[]) OR regexp_replace(phone, '\\D', '', 'g') = ANY($1::text[]))
          AND role = 'school_admin' AND is_active = TRUE LIMIT 1`,
      [variants],
    );

    let fullName = r.rows[0]?.full_name;
    if (r.rowCount === 0) {
      // Older school records may not have been mirrored into app_users yet.
      // Fall back to the schools table, then create the OTP-login user row.
      const s = await query<{ id: string; admin_full_name: string }>(
        `SELECT id, admin_full_name FROM schools
          WHERE (admin_phone = ANY($1::text[]) OR regexp_replace(admin_phone, '\\D', '', 'g') = ANY($1::text[]))
            AND is_active = TRUE LIMIT 1`,
        [variants],
      );
      if (s.rowCount === 0) {
        // Don't reveal absence; pretend success.
        await new Promise((res) => setTimeout(res, 400));
        return json({ ok: true });
      }
      const school = s.rows[0];
      fullName = school.admin_full_name;
      await query(
        `INSERT INTO app_users (school_id, full_name, phone, role, is_active)
         VALUES ($1,$2,$3,'school_admin',TRUE)
         ON CONFLICT (phone) DO UPDATE SET school_id = EXCLUDED.school_id,
           full_name = EXCLUDED.full_name, role = 'school_admin', is_active = TRUE, updated_at = now()`,
        [school.id, fullName, phone],
      );
    }

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
