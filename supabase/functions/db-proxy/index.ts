// Generic DB proxy: executes named, server-defined operations against the
// external PostgreSQL. NEVER accepts raw SQL from the client.
// Phase 0 ships only a `ping` op so we can verify the connection end-to-end.
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { z } from "npm:zod@3.23.8";
import bcrypt from "npm:bcryptjs@2.4.3";
import { authenticate, HttpError, requireSchoolAdminSchool, resolveSchoolScope } from "../_shared/auth.ts";
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
    await ensureCashierPinColumns();
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
    await ensureCashierPinColumns();
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
    await ensureCashierPinColumns();
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
    await ensureCashierPinColumns();
    const r = await query(
      `UPDATE app_users SET pin_hash=$3, pin_updated_at=now(), updated_at=now()
        WHERE id=$1 AND school_id=$2 AND role='cashier'
        RETURNING id`,
      [p.id, schoolId, pinHash],
    );
    if (r.rowCount === 0) throw new HttpError(404, "Kasiyer bulunamadı");
    return { ok: true };
  },
  // ---- Student management (school_admin scoped) ----
  list_students: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = z.object({ query: z.string().trim().max(100).optional() }).parse(params ?? {});
    const args: any[] = [schoolId];
    let where = "school_id = $1";
    if (p.query && p.query.length >= 1) {
      args.push(`%${p.query}%`);
      where += ` AND (full_name ILIKE $${args.length} OR student_no ILIKE $${args.length} OR parent_phone ILIKE $${args.length})`;
    }
    const r = await query(
      `SELECT id, full_name, class_name, student_no, parent_phone, balance,
              qr_token, nfc_uid, is_active, created_at
         FROM students WHERE ${where}
        ORDER BY created_at DESC LIMIT 500`,
      args,
    );
    return r.rows;
  },
  create_student: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = StudentInputSchema.parse(params);
    const parentPhone = p.parent_phone ? normalizePhone(p.parent_phone) : null;
    const r = await query(
      `INSERT INTO students (school_id, full_name, class_name, student_no, parent_phone, balance, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE)
       RETURNING id, full_name, class_name, student_no, parent_phone, balance,
                 qr_token, nfc_uid, is_active, created_at`,
      [schoolId, p.full_name, p.class_name ?? null, p.student_no ?? null, parentPhone, p.balance ?? 0],
    );
    return r.rows[0];
  },
  update_student: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = StudentUpdateSchema.parse(params);
    const parentPhone = p.parent_phone ? normalizePhone(p.parent_phone) : null;
    const r = await query(
      `UPDATE students
          SET full_name=$3, class_name=$4, student_no=$5, parent_phone=$6, updated_at=now()
        WHERE id=$1 AND school_id=$2
        RETURNING id, full_name, class_name, student_no, parent_phone, balance,
                  qr_token, nfc_uid, is_active, created_at`,
      [p.id, schoolId, p.full_name, p.class_name ?? null, p.student_no ?? null, parentPhone],
    );
    if (r.rowCount === 0) throw new HttpError(404, "Öğrenci bulunamadı");
    return r.rows[0];
  },
  toggle_student_active: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(params);
    const r = await query(
      `UPDATE students SET is_active=$3, updated_at=now()
        WHERE id=$1 AND school_id=$2
        RETURNING id, is_active`,
      [p.id, schoolId, p.is_active],
    );
    if (r.rowCount === 0) throw new HttpError(404, "Öğrenci bulunamadı");
    return r.rows[0];
  },
  delete_student: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = z.object({ id: z.string().uuid() }).parse(params);
    const r = await query(
      "DELETE FROM students WHERE id=$1 AND school_id=$2",
      [p.id, schoolId],
    );
    if (r.rowCount === 0) throw new HttpError(404, "Öğrenci bulunamadı");
    return { id: p.id, deleted: true };
  },
  set_student_nfc: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = z.object({
      id: z.string().uuid(),
      nfc_uid: z.string().trim().min(1).max(64).nullable(),
    }).parse(params);
    const uid = p.nfc_uid ? p.nfc_uid.toUpperCase().replace(/[^A-Z0-9]/g, "") : null;
    if (uid !== null && uid.length < 4) throw new HttpError(400, "Geçersiz kart UID");
    try {
      const r = await query(
        `UPDATE students SET nfc_uid=$3, updated_at=now()
          WHERE id=$1 AND school_id=$2
          RETURNING id, nfc_uid`,
        [p.id, schoolId, uid],
      );
      if (r.rowCount === 0) throw new HttpError(404, "Öğrenci bulunamadı");
      return r.rows[0];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("unique") || msg.includes("duplicate")) {
        throw new HttpError(409, "Bu kart başka bir öğrenciye atanmış");
      }
      throw e;
    }
  },
  adjust_student_balance: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = z.object({
      id: z.string().uuid(),
      delta: z.number().refine((n) => Math.abs(n) > 0 && Math.abs(n) <= 10000, "Tutar 0-10000 ₺ aralığında olmalı"),
    }).parse(params);
    return await withTransaction(async (client) => {
      const sr = await client.query(
        `SELECT id, balance FROM students WHERE id=$1 AND school_id=$2 FOR UPDATE`,
        [p.id, schoolId],
      );
      if (sr.rowCount === 0) throw new HttpError(404, "Öğrenci bulunamadı");
      const before = Number(sr.rows[0].balance);
      const after = +(before + p.delta).toFixed(2);
      if (after < 0) throw new HttpError(400, "Bakiye negatif olamaz");
      await client.query(
        "UPDATE students SET balance=$1, updated_at=now() WHERE id=$2",
        [after, p.id],
      );
      return { id: p.id, balance_before: before, balance_after: after };
    });
  },

  /* ============== CATEGORIES ============== */
  list_categories_admin: async (ctx) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const r = await query(
      `SELECT c.id, c.name, c.color, c.sort_order, c.is_active, c.created_at,
              (SELECT count(*) FROM products p WHERE p.category_id = c.id)::int AS product_count
         FROM categories c
        WHERE c.school_id=$1
        ORDER BY c.sort_order ASC, c.name ASC`,
      [schoolId],
    );
    return r.rows;
  },
  create_category: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = CategoryInputSchema.parse(params);
    const r = await query(
      `INSERT INTO categories (school_id, name, color, sort_order, is_active)
       VALUES ($1,$2,$3,$4,TRUE)
       RETURNING id, name, color, sort_order, is_active, created_at`,
      [schoolId, p.name, p.color ?? null, p.sort_order ?? 0],
    );
    return r.rows[0];
  },
  update_category: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = CategoryUpdateSchema.parse(params);
    const r = await query(
      `UPDATE categories
          SET name=$3, color=$4, sort_order=$5, is_active=$6, updated_at=now()
        WHERE id=$1 AND school_id=$2
        RETURNING id, name, color, sort_order, is_active, created_at`,
      [p.id, schoolId, p.name, p.color ?? null, p.sort_order ?? 0, p.is_active],
    );
    if (r.rowCount === 0) throw new HttpError(404, "Kategori bulunamadı");
    return r.rows[0];
  },
  delete_category: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = z.object({ id: z.string().uuid() }).parse(params);
    const r = await query("DELETE FROM categories WHERE id=$1 AND school_id=$2", [p.id, schoolId]);
    if (r.rowCount === 0) throw new HttpError(404, "Kategori bulunamadı");
    return { id: p.id, deleted: true };
  },

  /* ============== PRODUCTS ============== */
  list_products_admin: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = z.object({
      query: z.string().trim().max(100).optional(),
      category_id: z.string().uuid().nullable().optional(),
    }).parse(params ?? {});
    const args: any[] = [schoolId];
    let where = "school_id = $1";
    if (p.category_id) { args.push(p.category_id); where += ` AND category_id=$${args.length}`; }
    if (p.query && p.query.length >= 1) {
      args.push(`%${p.query}%`);
      where += ` AND (name ILIKE $${args.length} OR barcode ILIKE $${args.length})`;
    }
    const r = await query(
      `SELECT id, category_id, name, price, image_url, barcode,
              stock_tracking, stock_qty, is_active, sort_order, created_at
         FROM products WHERE ${where}
        ORDER BY created_at DESC LIMIT 1000`,
      args,
    );
    return r.rows;
  },
  find_product_by_barcode: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = z.object({ barcode: z.string().trim().min(4).max(32) }).parse(params);
    const r = await query(
      `SELECT id, name, price, image_url, barcode, category_id, is_active
         FROM products WHERE school_id=$1 AND barcode=$2 LIMIT 1`,
      [schoolId, p.barcode],
    );
    return { product: r.rows[0] ?? null };
  },
  create_product: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = ProductInputSchema.parse(params);
    try {
      const r = await query(
        `INSERT INTO products (school_id, category_id, name, price, image_url, barcode,
                               stock_tracking, stock_qty, is_active, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9)
         RETURNING id, category_id, name, price, image_url, barcode,
                   stock_tracking, stock_qty, is_active, sort_order, created_at`,
        [
          schoolId, p.category_id ?? null, p.name, p.price,
          p.image_url ?? null, p.barcode ?? null,
          p.stock_tracking ?? false, p.stock_qty ?? 0, p.sort_order ?? 0,
        ],
      );
      return r.rows[0];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("unique") || msg.includes("duplicate")) {
        throw new HttpError(409, "Bu barkod ile bir ürün zaten kayıtlı");
      }
      throw e;
    }
  },
  update_product: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = ProductUpdateSchema.parse(params);
    const r = await query(
      `UPDATE products
          SET category_id=$3, name=$4, price=$5, image_url=$6, barcode=$7,
              stock_tracking=$8, stock_qty=$9, sort_order=$10, updated_at=now()
        WHERE id=$1 AND school_id=$2
        RETURNING id, category_id, name, price, image_url, barcode,
                  stock_tracking, stock_qty, is_active, sort_order, created_at`,
      [
        p.id, schoolId, p.category_id ?? null, p.name, p.price,
        p.image_url ?? null, p.barcode ?? null,
        p.stock_tracking, p.stock_qty, p.sort_order ?? 0,
      ],
    );
    if (r.rowCount === 0) throw new HttpError(404, "Ürün bulunamadı");
    return r.rows[0];
  },
  toggle_product_active: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(params);
    const r = await query(
      `UPDATE products SET is_active=$3, updated_at=now()
        WHERE id=$1 AND school_id=$2 RETURNING id, is_active`,
      [p.id, schoolId, p.is_active],
    );
    if (r.rowCount === 0) throw new HttpError(404, "Ürün bulunamadı");
    return r.rows[0];
  },
  delete_product: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = z.object({ id: z.string().uuid() }).parse(params);
    const r = await query("DELETE FROM products WHERE id=$1 AND school_id=$2", [p.id, schoolId]);
    if (r.rowCount === 0) throw new HttpError(404, "Ürün bulunamadı");
    return { id: p.id, deleted: true };
  },

  /* ============== INGREDIENTS ============== */
  list_ingredients: async (ctx) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const r = await query(
      `SELECT i.id, i.name, i.unit, i.stock_qty, i.low_stock_threshold, i.is_active, i.created_at,
              (SELECT count(*) FROM product_recipes pr WHERE pr.ingredient_id = i.id)::int AS used_in_count
         FROM ingredients i
        WHERE i.school_id = $1
        ORDER BY i.name ASC`,
      [schoolId],
    );
    return r.rows;
  },
  create_ingredient: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = IngredientInputSchema.parse(params);
    try {
      const r = await query(
        `INSERT INTO ingredients (school_id, name, unit, stock_qty, low_stock_threshold)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, name, unit, stock_qty, low_stock_threshold, is_active, created_at`,
        [schoolId, p.name, p.unit, p.stock_qty ?? 0, p.low_stock_threshold ?? null],
      );
      return r.rows[0];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("uq_ingredients_school_name") || msg.includes("duplicate")) {
        throw new HttpError(409, "Bu isimde bir malzeme zaten var");
      }
      throw e;
    }
  },
  update_ingredient: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = IngredientUpdateSchema.parse(params);
    const r = await query(
      `UPDATE ingredients
          SET name=$3, unit=$4, low_stock_threshold=$5, is_active=$6, updated_at=now()
        WHERE id=$1 AND school_id=$2
        RETURNING id, name, unit, stock_qty, low_stock_threshold, is_active, created_at`,
      [p.id, schoolId, p.name, p.unit, p.low_stock_threshold ?? null, p.is_active],
    );
    if (r.rowCount === 0) throw new HttpError(404, "Malzeme bulunamadı");
    return r.rows[0];
  },
  adjust_ingredient_stock: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = z.object({
      id: z.string().uuid(),
      delta: z.number().refine((n) => n !== 0 && Math.abs(n) <= 1_000_000, "Geçersiz miktar"),
      note: z.string().trim().max(200).optional(),
    }).parse(params);
    return await withTransaction(async (client) => {
      const ir = await client.query(
        `SELECT id, stock_qty FROM ingredients WHERE id=$1 AND school_id=$2 FOR UPDATE`,
        [p.id, schoolId],
      );
      if (ir.rowCount === 0) throw new HttpError(404, "Malzeme bulunamadı");
      const before = Number(ir.rows[0].stock_qty);
      const after = +(before + p.delta).toFixed(3);
      await client.query("UPDATE ingredients SET stock_qty=$1, updated_at=now() WHERE id=$2", [after, p.id]);
      await client.query(
        `INSERT INTO ingredient_movements (school_id, ingredient_id, delta, reason, balance_after, note)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [schoolId, p.id, p.delta, p.delta > 0 ? "restock" : "adjustment", after, p.note ?? null],
      );
      return { id: p.id, stock_before: before, stock_after: after };
    });
  },
  delete_ingredient: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = z.object({ id: z.string().uuid() }).parse(params);
    try {
      const r = await query("DELETE FROM ingredients WHERE id=$1 AND school_id=$2", [p.id, schoolId]);
      if (r.rowCount === 0) throw new HttpError(404, "Malzeme bulunamadı");
      return { id: p.id, deleted: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("foreign key") || msg.includes("violates")) {
        throw new HttpError(409, "Bu malzeme bir reçetede kullanılıyor. Önce reçetelerden çıkarın.");
      }
      throw e;
    }
  },

  /* ============== PRODUCT RECIPES ============== */
  get_product_recipe: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = z.object({ product_id: z.string().uuid() }).parse(params);
    const pr = await query("SELECT id, name FROM products WHERE id=$1 AND school_id=$2", [p.product_id, schoolId]);
    if (pr.rowCount === 0) throw new HttpError(404, "Ürün bulunamadı");
    const r = await query(
      `SELECT pr.id, pr.ingredient_id, pr.qty,
              i.name AS ingredient_name, i.unit, i.stock_qty
         FROM product_recipes pr
         JOIN ingredients i ON i.id = pr.ingredient_id
        WHERE pr.product_id = $1
        ORDER BY i.name ASC`,
      [p.product_id],
    );
    return { product: pr.rows[0], lines: r.rows };
  },
  set_product_recipe: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = z.object({
      product_id: z.string().uuid(),
      lines: z.array(z.object({
        ingredient_id: z.string().uuid(),
        qty: z.number().positive().max(1_000_000),
      })).max(50),
    }).parse(params);
    return await withTransaction(async (client) => {
      const pr = await client.query("SELECT id FROM products WHERE id=$1 AND school_id=$2", [p.product_id, schoolId]);
      if (pr.rowCount === 0) throw new HttpError(404, "Ürün bulunamadı");
      if (p.lines.length > 0) {
        const ingIds = p.lines.map((l) => l.ingredient_id);
        const ir = await client.query(
          "SELECT id FROM ingredients WHERE school_id=$1 AND id = ANY($2::uuid[])",
          [schoolId, ingIds],
        );
        if (ir.rowCount !== ingIds.length) throw new HttpError(400, "Geçersiz malzeme referansı");
      }
      await client.query("DELETE FROM product_recipes WHERE product_id=$1", [p.product_id]);
      for (const l of p.lines) {
        await client.query(
          "INSERT INTO product_recipes (product_id, ingredient_id, qty) VALUES ($1,$2,$3)",
          [p.product_id, l.ingredient_id, l.qty],
        );
      }
      return { product_id: p.product_id, line_count: p.lines.length };
    });
  },
  list_products_with_recipes: async (ctx) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const r = await query(
      `SELECT p.id, p.name, p.image_url, p.is_active,
              count(pr.id)::int AS recipe_line_count
         FROM products p
         LEFT JOIN product_recipes pr ON pr.product_id = p.id
        WHERE p.school_id = $1
        GROUP BY p.id
        ORDER BY p.name ASC`,
      [schoolId],
    );
    return r.rows;
  },
  recent_ingredient_movements: async (ctx, params) => {
    const schoolId = requireSchoolAdminSchool(ctx);
    const p = z.object({ limit: z.number().int().min(1).max(100).default(20) }).parse(params ?? {});
    const r = await query(
      `SELECT m.id, m.delta, m.reason, m.balance_after, m.note, m.created_at,
              i.name AS ingredient_name, i.unit
         FROM ingredient_movements m
         JOIN ingredients i ON i.id = m.ingredient_id
        WHERE m.school_id = $1
        ORDER BY m.created_at DESC
        LIMIT $2`,
      [schoolId, p.limit],
    );
    return r.rows;
  },
};

const INGREDIENT_UNITS = ["adet", "gr", "kg", "ml", "lt"] as const;
const IngredientInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  unit: z.enum(INGREDIENT_UNITS),
  stock_qty: z.number().min(0).max(1_000_000).optional(),
  low_stock_threshold: z.number().min(0).max(1_000_000).nullable().optional(),
});
const IngredientUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  unit: z.enum(INGREDIENT_UNITS),
  low_stock_threshold: z.number().min(0).max(1_000_000).nullable().optional(),
  is_active: z.boolean(),
});

const CategoryInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: z.string().trim().max(32).optional().nullable(),
  sort_order: z.number().int().min(0).max(9999).optional(),
});
const CategoryUpdateSchema = CategoryInputSchema.extend({
  id: z.string().uuid(),
  is_active: z.boolean(),
});

const ProductInputSchema = z.object({
  category_id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(255),
  price: z.number().min(0).max(100000),
  image_url: z.string().trim().max(2048).nullable().optional(),
  barcode: z.string().trim().min(4).max(32).nullable().optional(),
  stock_tracking: z.boolean().optional(),
  stock_qty: z.number().int().min(0).max(1_000_000).optional(),
  sort_order: z.number().int().min(0).max(9999).optional(),
});
const ProductUpdateSchema = ProductInputSchema.extend({
  id: z.string().uuid(),
  stock_tracking: z.boolean(),
  stock_qty: z.number().int().min(0).max(1_000_000),
});

const StudentInputSchema = z.object({
  full_name: z.string().trim().min(2).max(255),
  class_name: z.string().trim().max(50).optional().nullable(),
  student_no: z.string().trim().max(50).optional().nullable(),
  parent_phone: z.string().trim().max(20).optional().nullable(),
  balance: z.number().min(0).max(10000).optional(),
});
const StudentUpdateSchema = StudentInputSchema.extend({ id: z.string().uuid() });

function normalizePhone(input: string): string {
  const digits = input.replace(/\D+/g, "");
  // Store with leading 0 for TR (e.g. 0542...) to stay consistent with existing data.
  if (digits.length === 10) return "0" + digits;
  if (digits.length === 12 && digits.startsWith("90")) return "0" + digits.slice(2);
  return digits;
}

let cashierPinColumnsReady: Promise<void> | null = null;

function ensureCashierPinColumns(): Promise<void> {
  if (!cashierPinColumnsReady) {
    cashierPinColumnsReady = (async () => {
      await query("ALTER TABLE app_users ADD COLUMN IF NOT EXISTS pin_hash TEXT");
      await query("ALTER TABLE app_users ADD COLUMN IF NOT EXISTS pin_updated_at TIMESTAMPTZ");
    })().catch((e) => {
      cashierPinColumnsReady = null;
      throw e;
    });
  }
  return cashierPinColumnsReady;
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
