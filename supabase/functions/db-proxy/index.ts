// Generic DB proxy: executes named, server-defined operations against the
// external PostgreSQL. NEVER accepts raw SQL from the client.
// Phase 0 ships only a `ping` op so we can verify the connection end-to-end.
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { z } from "npm:zod@3.23.8";
import bcrypt from "npm:bcryptjs@2.4.3";
import { authenticate, HttpError, requireSchoolAdminSchool } from "../_shared/auth.ts";
import { query, withTransaction } from "../_shared/external-db.ts";
import { generateOtp, sendSms } from "../_shared/sms.ts";

const BodySchema = z.object({
  op: z.string().min(1).max(64),
  params: z.record(z.unknown()).optional(),
});

type Handler = (ctx: Awaited<ReturnType<typeof authenticate>>, params: any) => Promise<unknown>;

const HANDLERS: Record<string, Handler> = {
  ping: async () => {
    const r = await query<{ now: string; version: string }>(
      "SELECT now() AS now, version() AS version",
    );
    return r.rows[0];
  },
  list_schools: async (ctx) => {
    requireSuperAdmin(ctx);
    const r = await query(
      "SELECT id, name, province, district, admin_full_name, admin_phone, min_topup_amount, commission_rate, commission_free_after_days, is_active, created_at FROM schools ORDER BY created_at DESC",
    );
    return r.rows;
  },
  create_school: async (ctx, params) => {
    requireSuperAdmin(ctx);
    const p = SchoolInputSchema.parse(params);
    const school = await withTransaction(async (client) => {
      const ins = await client.query(
        `INSERT INTO schools (name, province, district, admin_full_name, admin_phone, min_topup_amount, commission_rate, commission_free_after_days, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, name, province, district, admin_full_name, admin_phone, min_topup_amount, commission_rate, commission_free_after_days, is_active, created_at`,
        [p.name, p.province ?? null, p.district ?? null, p.admin_full_name, p.admin_phone, p.min_topup_amount, p.commission_rate, p.commission_free_after_days, p.is_active],
      );
      const s = ins.rows[0];
      // Create / upsert school_admin user record (OTP-only login).
      await client.query(
        `INSERT INTO app_users (school_id, full_name, phone, role, is_active)
         VALUES ($1,$2,$3,'school_admin',TRUE)
         ON CONFLICT (phone) DO UPDATE SET school_id = EXCLUDED.school_id,
           full_name = EXCLUDED.full_name, role = 'school_admin', is_active = TRUE, updated_at = now()`,
        [s.id, p.admin_full_name, p.admin_phone],
      );
      return s;
    });

    // Generate OTP, store it, and send welcome SMS (non-blocking on failure).
    let smsResult: { ok: boolean; status: string } = { ok: false, status: "skipped" };
    try {
      const code = generateOtp();
      await query(
        `INSERT INTO otp_codes (phone, code, purpose, expires_at)
         VALUES ($1, $2, 'login', now() + interval '10 minutes')`,
        [p.admin_phone, code],
      );
      const message = `KantinPay'e hos geldiniz ${p.admin_full_name}. Giris kodunuz: ${code}`;
      const r = await sendSms(p.admin_phone, message);
      smsResult = { ok: r.ok, status: r.status };
    } catch (e) {
      smsResult = { ok: false, status: e instanceof Error ? e.message : "sms_error" };
    }
    return { ...school, sms: smsResult };
  },
  update_school: async (ctx, params) => {
    requireSuperAdmin(ctx);
    const p = SchoolUpdateSchema.parse(params);
    const r = await query(
      `UPDATE schools SET name=$2, province=$3, district=$4, admin_full_name=$5, admin_phone=$6,
         min_topup_amount=$7, commission_rate=$8, commission_free_after_days=$9, is_active=$10, updated_at=now()
       WHERE id=$1
       RETURNING id, name, province, district, admin_full_name, admin_phone, min_topup_amount, commission_rate, commission_free_after_days, is_active, created_at`,
      [p.id, p.name, p.province ?? null, p.district ?? null, p.admin_full_name, p.admin_phone, p.min_topup_amount, p.commission_rate, p.commission_free_after_days, p.is_active],
    );
    if (r.rowCount === 0) throw new HttpError(404, "Okul bulunamadı");
    // Keep the school_admin user in sync (name/phone may have changed).
    await query(
      `INSERT INTO app_users (school_id, full_name, phone, role, is_active)
       VALUES ($1,$2,$3,'school_admin',TRUE)
       ON CONFLICT (phone) DO UPDATE SET school_id = EXCLUDED.school_id,
         full_name = EXCLUDED.full_name, role = 'school_admin', updated_at = now()`,
      [p.id, p.admin_full_name, p.admin_phone],
    );
    return r.rows[0];
  },
  toggle_school_active: async (ctx, params) => {
    requireSuperAdmin(ctx);
    const p = z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(params);
    const r = await query(
      "UPDATE schools SET is_active=$2, updated_at=now() WHERE id=$1 RETURNING id, is_active",
      [p.id, p.is_active],
    );
    if (r.rowCount === 0) throw new HttpError(404, "Okul bulunamadı");
    return r.rows[0];
  },
  delete_school: async (ctx, params) => {
    requireSuperAdmin(ctx);
    const p = z.object({ id: z.string().uuid() }).parse(params);
    const r = await query("DELETE FROM schools WHERE id=$1", [p.id]);
    if (r.rowCount === 0) throw new HttpError(404, "Okul bulunamadı");
    return { id: p.id, deleted: true };
  },
  resend_admin_otp: async (ctx, params) => {
    requireSuperAdmin(ctx);
    const p = z.object({ school_id: z.string().uuid() }).parse(params);
    const sr = await query<{ admin_full_name: string; admin_phone: string }>(
      "SELECT admin_full_name, admin_phone FROM schools WHERE id=$1",
      [p.school_id],
    );
    if (sr.rowCount === 0) throw new HttpError(404, "Okul bulunamadı");
    const { admin_full_name, admin_phone } = sr.rows[0];
    const code = generateOtp();
    await query(
      `INSERT INTO otp_codes (phone, code, purpose, expires_at)
       VALUES ($1, $2, 'login', now() + interval '10 minutes')`,
      [admin_phone, code],
    );
    const message = `KantinPay'e hos geldiniz ${admin_full_name}. Giris kodunuz: ${code}`;
    const r = await sendSms(admin_phone, message);
    return { ok: r.ok, status: r.status, raw: r.raw };
  },
  // ---- NetGSM config ----
  get_netgsm_config: async (ctx) => {
    requireSuperAdmin(ctx);
    const r = await query(
      "SELECT username, msgheader, is_active, updated_at, (password IS NOT NULL AND password <> '') AS has_password FROM netgsm_config WHERE id = 1",
    );
    return r.rows[0] ?? { username: null, msgheader: null, is_active: false, has_password: false };
  },
  save_netgsm_config: async (ctx, params) => {
    requireSuperAdmin(ctx);
    const p = z.object({
      username: z.string().min(1).max(100),
      password: z.string().max(200).optional(), // empty = keep existing
      msgheader: z.string().min(1).max(20),
      is_active: z.boolean(),
    }).parse(params);
    const updatePassword = p.password && p.password.length > 0;
    if (updatePassword) {
      await query(
        `UPDATE netgsm_config SET username=$1, password=$2, msgheader=$3, is_active=$4, updated_at=now() WHERE id=1`,
        [p.username, p.password, p.msgheader, p.is_active],
      );
    } else {
      await query(
        `UPDATE netgsm_config SET username=$1, msgheader=$2, is_active=$3, updated_at=now() WHERE id=1`,
        [p.username, p.msgheader, p.is_active],
      );
    }
    return { ok: true };
  },
  test_sms: async (ctx, params) => {
    requireSuperAdmin(ctx);
    const p = z.object({ phone: z.string().min(5).max(32), message: z.string().min(1).max(500).optional() }).parse(params);
    const r = await sendSms(p.phone, p.message ?? "KantinPay test mesajidir.");
    return { ok: r.ok, status: r.status, raw: r.raw };
  },
  recent_sms_log: async (ctx) => {
    requireSuperAdmin(ctx);
    const r = await query(
      "SELECT id, phone, message, status, provider_response, created_at FROM sms_log ORDER BY created_at DESC LIMIT 20",
    );
    return r.rows;
  },
  // ---- Payment provider config ----
  get_payment_config: async (ctx) => {
    requireSuperAdmin(ctx);
    const r = await query(
      `SELECT active_provider, iyzico_api_key, iyzico_base_url,
              paytr_merchant_id, updated_at,
              (iyzico_secret_key IS NOT NULL AND iyzico_secret_key <> '') AS has_iyzico_secret,
              (paytr_merchant_key IS NOT NULL AND paytr_merchant_key <> '') AS has_paytr_key,
              (paytr_merchant_salt IS NOT NULL AND paytr_merchant_salt <> '') AS has_paytr_salt
         FROM payment_provider_config WHERE id = 1`,
    );
    return r.rows[0] ?? {
      active_provider: null, iyzico_api_key: null, iyzico_base_url: "https://api.iyzipay.com",
      paytr_merchant_id: null, has_iyzico_secret: false, has_paytr_key: false, has_paytr_salt: false,
    };
  },
  save_payment_config: async (ctx, params) => {
    requireSuperAdmin(ctx);
    const p = z.object({
      active_provider: z.enum(["iyzico", "paytr"]).nullable(),
      iyzico_api_key: z.string().max(200).optional().nullable(),
      iyzico_secret_key: z.string().max(200).optional(), // empty = keep existing
      iyzico_base_url: z.string().max(200).optional().nullable(),
      paytr_merchant_id: z.string().max(100).optional().nullable(),
      paytr_merchant_key: z.string().max(200).optional(), // empty = keep existing
      paytr_merchant_salt: z.string().max(200).optional(), // empty = keep existing
    }).parse(params);

    const sets: string[] = [
      "active_provider=$1",
      "iyzico_api_key=$2",
      "iyzico_base_url=$3",
      "paytr_merchant_id=$4",
    ];
    const vals: unknown[] = [
      p.active_provider,
      p.iyzico_api_key ?? null,
      p.iyzico_base_url ?? "https://api.iyzipay.com",
      p.paytr_merchant_id ?? null,
    ];
    let i = 5;
    if (p.iyzico_secret_key && p.iyzico_secret_key.length > 0) {
      sets.push(`iyzico_secret_key=$${i++}`); vals.push(p.iyzico_secret_key);
    }
    if (p.paytr_merchant_key && p.paytr_merchant_key.length > 0) {
      sets.push(`paytr_merchant_key=$${i++}`); vals.push(p.paytr_merchant_key);
    }
    if (p.paytr_merchant_salt && p.paytr_merchant_salt.length > 0) {
      sets.push(`paytr_merchant_salt=$${i++}`); vals.push(p.paytr_merchant_salt);
    }
    sets.push("updated_at=now()");
    await query(`UPDATE payment_provider_config SET ${sets.join(", ")} WHERE id=1`, vals);
    return { ok: true };
  },
  // ---- Cashier management (school_admin scoped) ----
  list_cashiers: async (ctx) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const r = await query(
      `SELECT id, full_name, phone, is_active, last_login_at, created_at,
              (pin_hash IS NOT NULL) AS has_pin, pin_updated_at
         FROM app_users
        WHERE school_id = $1 AND role = 'cashier'
        ORDER BY created_at DESC`,
      [schoolId],
    );
    return r.rows;
  },
  create_cashier: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = CashierCreateSchema.parse(params);
    const phone = normalizePhone(p.phone);
    const pinHash = await bcrypt.hash(p.pin, 10);
    try {
      const r = await query(
        `INSERT INTO app_users (school_id, full_name, phone, role, is_active, pin_hash, pin_updated_at)
         VALUES ($1,$2,$3,'cashier',TRUE,$4, now())
         RETURNING id, full_name, phone, is_active, created_at, (pin_hash IS NOT NULL) AS has_pin, pin_updated_at`,
        [schoolId, p.full_name, phone, pinHash],
      );
      return r.rows[0];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("unique") || msg.includes("duplicate")) {
        throw new HttpError(409, "Bu telefon numarası zaten kayıtlı");
      }
      throw e;
    }
  },
  update_cashier: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = CashierUpdateSchema.parse(params);
    const phone = normalizePhone(p.phone);
    const r = await query(
      `UPDATE app_users
          SET full_name=$3, phone=$4, updated_at=now()
        WHERE id=$1 AND school_id=$2 AND role='cashier'
        RETURNING id, full_name, phone, is_active, created_at, (pin_hash IS NOT NULL) AS has_pin, pin_updated_at`,
      [p.id, schoolId, p.full_name, phone],
    );
    if (r.rowCount === 0) throw new HttpError(404, "Kasiyer bulunamadı");
    return r.rows[0];
  },
  toggle_cashier_active: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(params);
    const r = await query(
      `UPDATE app_users SET is_active=$3, updated_at=now()
        WHERE id=$1 AND school_id=$2 AND role='cashier'
        RETURNING id, is_active`,
      [p.id, schoolId, p.is_active],
    );
    if (r.rowCount === 0) throw new HttpError(404, "Kasiyer bulunamadı");
    return r.rows[0];
  },
  delete_cashier: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = z.object({ id: z.string().uuid() }).parse(params);
    const r = await query(
      "DELETE FROM app_users WHERE id=$1 AND school_id=$2 AND role='cashier'",
      [p.id, schoolId],
    );
    if (r.rowCount === 0) throw new HttpError(404, "Kasiyer bulunamadı");
    return { id: p.id, deleted: true };
  },
  reset_cashier_pin: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = z.object({ id: z.string().uuid(), pin: z.string().regex(/^\d{6}$/) }).parse(params);
    const pinHash = await bcrypt.hash(p.pin, 10);
    const r = await query(
      `UPDATE app_users SET pin_hash=$3, pin_updated_at=now(), updated_at=now()
        WHERE id=$1 AND school_id=$2 AND role='cashier'
        RETURNING id`,
      [p.id, schoolId, pinHash],
    );
    if (r.rowCount === 0) throw new HttpError(404, "Kasiyer bulunamadı");
    return { ok: true };
  },
};

function normalizePhone(input: string): string {
  const digits = input.replace(/\D+/g, "");
  // Store with leading 0 for TR (e.g. 0542...) to stay consistent with existing data.
  if (digits.length === 10) return "0" + digits;
  if (digits.length === 12 && digits.startsWith("90")) return "0" + digits.slice(2);
  return digits;
}

const CashierCreateSchema = z.object({
  full_name: z.string().trim().min(2).max(255),
  phone: z.string().trim().min(10).max(20),
  pin: z.string().regex(/^\d{6}$/, "PIN 6 haneli olmalıdır"),
});
const CashierUpdateSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().trim().min(2).max(255),
  phone: z.string().trim().min(10).max(20),
});

function requireSuperAdmin(ctx: Awaited<ReturnType<typeof authenticate>>) {
  if (!ctx.roles.some((r) => r.role === "super_admin")) {
    throw new HttpError(403, "Requires super_admin");
  }
}

const SchoolInputSchema = z.object({
  name: z.string().min(1).max(255),
  province: z.string().max(100).optional().nullable(),
  district: z.string().max(100).optional().nullable(),
  admin_full_name: z.string().min(1).max(255),
  admin_phone: z.string().min(5).max(32),
  min_topup_amount: z.number().nonnegative().default(50),
  commission_rate: z.number().min(0).max(1).default(0.05),
  commission_free_after_days: z.number().int().nonnegative().default(7),
  is_active: z.boolean().default(true),
});
const SchoolUpdateSchema = SchoolInputSchema.extend({ id: z.string().uuid() });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const ctx = await authenticate(req);
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { op, params } = parsed.data;
    const handler = HANDLERS[op];
    if (!handler) throw new HttpError(404, `Unknown op: ${op}`);
    const data = await handler(ctx, params ?? {});
    return new Response(JSON.stringify({ ok: true, data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    if (e instanceof HttpError) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: e.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("db-proxy error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
