// Public endpoint: verifies the SMS OTP for a school admin and returns a
// Supabase session (access_token + refresh_token) so the client can sign in.
//
// Strategy:
//  1. Validate phone + 6-digit code against external `otp_codes` table.
//  2. Mark the code consumed (atomic UPDATE ... RETURNING).
//  3. Find or create a Supabase auth user for this admin (synthetic email
//     {phone}@school-admin.kantinpay.local + a random password we never share).
//  4. Ensure a `school_admin` row exists in user_roles linked to the school.
//  5. Sign the user in via password grant and return the session to the client.
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { z } from "npm:zod@3.23.8";
import { query } from "../_shared/external-db.ts";
import { normalizePhone } from "../_shared/sms.ts";

const BodySchema = z.object({
  phone: z.string().min(5).max(32),
  code: z.string().regex(/^\d{6}$/),
});

const SYNTHETIC_DOMAIN = "school-admin.kantinpay.local";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) return json({ error: "Geçersiz istek" }, 400);

    const phone = normalizePhone(parsed.data.phone);
    const code = parsed.data.code;

    // Atomically consume the most recent valid OTP.
    const consume = await query<{ id: string }>(
      `UPDATE otp_codes SET consumed_at = now()
         WHERE id = (
           SELECT id FROM otp_codes
            WHERE phone = $1 AND code = $2 AND purpose = 'login'
              AND consumed_at IS NULL AND expires_at > now()
            ORDER BY created_at DESC LIMIT 1
         )
       RETURNING id`,
      [phone, code],
    );
    if (consume.rowCount === 0) {
      // Increment attempt counter on the latest active code, if any.
      await query(
        `UPDATE otp_codes SET attempts = attempts + 1
           WHERE id = (
             SELECT id FROM otp_codes
              WHERE phone = $1 AND consumed_at IS NULL AND expires_at > now()
              ORDER BY created_at DESC LIMIT 1
           )`,
        [phone],
      );
      return json({ error: "Kod hatalı veya süresi dolmuş" }, 401);
    }

    // Load the school admin record (tolerate legacy phone formats).
    const inputDigits = parsed.data.phone.replace(/\D+/g, "");
    const variants = Array.from(new Set([phone, `0${phone}`, `90${phone}`, inputDigits]));
    const u = await query<{ id: string; school_id: string; full_name: string; auth_user_id: string | null }>(
      `SELECT id, school_id, full_name, auth_user_id FROM app_users
        WHERE (phone = ANY($1::text[]) OR regexp_replace(phone, '\\D', '', 'g') = ANY($1::text[]))
          AND role = 'school_admin' AND is_active = TRUE LIMIT 1`,
      [variants],
    );
    let adminRow = u.rows[0];
    if (u.rowCount === 0) {
      const s = await query<{ id: string; admin_full_name: string }>(
        `SELECT id, admin_full_name FROM schools
          WHERE (admin_phone = ANY($1::text[]) OR regexp_replace(admin_phone, '\\D', '', 'g') = ANY($1::text[]))
            AND is_active = TRUE LIMIT 1`,
        [variants],
      );
      if (s.rowCount === 0) return json({ error: "Yönetici bulunamadı" }, 404);
      const school = s.rows[0];
      const created = await query<{ id: string; school_id: string; full_name: string; auth_user_id: string | null }>(
        `INSERT INTO app_users (school_id, full_name, phone, role, is_active)
         VALUES ($1,$2,$3,'school_admin',TRUE)
         ON CONFLICT (phone) DO UPDATE SET school_id = EXCLUDED.school_id,
           full_name = EXCLUDED.full_name, role = 'school_admin', is_active = TRUE, updated_at = now()
         RETURNING id, school_id, full_name, auth_user_id`,
        [school.id, school.admin_full_name, phone],
      );
      adminRow = created.rows[0];
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const email = `${phone}@${SYNTHETIC_DOMAIN}`;
    // Stable per-admin password derived nowhere — we always reset it on login,
    // then immediately use it to sign in. Never returned to the client.
    const password = crypto.randomUUID() + crypto.randomUUID();

    let authUserId = adminRow.auth_user_id;

    if (!authUserId) {
      // Create or find by email.
      const created = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        phone: undefined,
        user_metadata: { full_name: adminRow.full_name, role: "school_admin", school_id: adminRow.school_id },
      });
      if (created.error) {
        // If user already exists (maybe orphaned), look it up via listUsers.
        const list = await adminClient.auth.admin.listUsers({ page: 1, perPage: 200 });
        const existing = list.data?.users?.find((x) => x.email === email);
        if (!existing) return json({ error: `Yönetici hesabı oluşturulamadı: ${created.error.message}` }, 500);
        authUserId = existing.id;
        const upd = await adminClient.auth.admin.updateUserById(existing.id, { password });
        if (upd.error) return json({ error: upd.error.message }, 500);
      } else {
        authUserId = created.data.user!.id;
      }
      await query("UPDATE app_users SET auth_user_id = $1, updated_at = now() WHERE id = $2", [authUserId, adminRow.id]);
    } else {
      // Reset password for this login session.
      const upd = await adminClient.auth.admin.updateUserById(authUserId, { password });
      if (upd.error) return json({ error: upd.error.message }, 500);
    }

    // Ensure user_roles has school_admin for this user/school.
    const { error: roleErr } = await adminClient
      .from("user_roles")
      .upsert(
        { user_id: authUserId, role: "school_admin", school_id: adminRow.school_id },
        { onConflict: "user_id,role,school_id" },
      );
    // Upsert may fail if no unique constraint matches the conflict target —
    // fall back to a manual insert-if-missing.
    if (roleErr) {
      const { data: existingRole } = await adminClient
        .from("user_roles")
        .select("id")
        .eq("user_id", authUserId)
        .eq("role", "school_admin")
        .eq("school_id", adminRow.school_id)
        .maybeSingle();
      if (!existingRole) {
        await adminClient.from("user_roles").insert({
          user_id: authUserId, role: "school_admin", school_id: adminRow.school_id,
        });
      }
    }

    // Sign in using the freshly set password to obtain a session for the client.
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const signIn = await anonClient.auth.signInWithPassword({ email, password });
    if (signIn.error || !signIn.data.session) {
      return json({ error: `Oturum oluşturulamadı: ${signIn.error?.message ?? "unknown"}` }, 500);
    }

    await query("UPDATE app_users SET last_login_at = now() WHERE id = $1", [adminRow.id]);

    return json({
      ok: true,
      session: {
        access_token: signIn.data.session.access_token,
        refresh_token: signIn.data.session.refresh_token,
      },
      admin: { full_name: adminRow.full_name, school_id: adminRow.school_id },
    });
  } catch (e) {
    console.error("school-admin-verify error:", e);
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
