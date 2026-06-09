// Generic DB proxy: executes named, server-defined operations against the
// external PostgreSQL. NEVER accepts raw SQL from the client.
// Phase 0 ships only a `ping` op so we can verify the connection end-to-end.
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { z } from "npm:zod@3.23.8";
import bcrypt from "npm:bcryptjs@2.4.3";
import { authenticate, HttpError, requireSchoolAdminSchool, resolveSchoolScope } from "../_shared/auth.ts";
import { isDbConnectionError, query, withTransaction } from "../_shared/external-db.ts";
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
      "SELECT id, name, province, district, admin_full_name, admin_phone, min_topup_amount, commission_rate, commission_free_after_days, payout_hold_days, is_active, created_at FROM schools ORDER BY created_at DESC",
    );
    return r.rows;
  },
  create_school: async (ctx, params) => {
    requireSuperAdmin(ctx);
    const p = SchoolInputSchema.parse(params);
    let school;
    try {
      school = await withTransaction(async (client) => {
        const ins = await client.query(
          `INSERT INTO schools (name, province, district, admin_full_name, admin_phone, min_topup_amount, commission_rate, commission_free_after_days, payout_hold_days, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING id, name, province, district, admin_full_name, admin_phone, min_topup_amount, commission_rate, commission_free_after_days, payout_hold_days, is_active, created_at`,
          [p.name, p.province ?? null, p.district ?? null, p.admin_full_name, p.admin_phone, p.min_topup_amount, p.commission_rate, p.commission_free_after_days, p.payout_hold_days, p.is_active],
        );
        const s = ins.rows[0];
        await client.query(
          `INSERT INTO app_users (school_id, full_name, phone, role, is_active)
           VALUES ($1,$2,$3,'school_admin',TRUE)
           ON CONFLICT (phone) DO UPDATE SET school_id = EXCLUDED.school_id,
             full_name = EXCLUDED.full_name, role = 'school_admin', is_active = TRUE, updated_at = now()`,
          [s.id, p.admin_full_name, p.admin_phone],
        );
        return s;
      });
    } catch (e: any) {
      if (e?.code === "23505" && String(e?.constraint ?? e?.message ?? "").includes("admin_phone")) {
        throw new HttpError(409, "Bu telefon numarası ile kayıtlı bir okul zaten var. Lütfen farklı bir numara kullanın.");
      }
      throw e;
    }


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
         min_topup_amount=$7, commission_rate=$8, commission_free_after_days=$9, payout_hold_days=$10, is_active=$11, updated_at=now()
       WHERE id=$1
       RETURNING id, name, province, district, admin_full_name, admin_phone, min_topup_amount, commission_rate, commission_free_after_days, payout_hold_days, is_active, created_at`,
      [p.id, p.name, p.province ?? null, p.district ?? null, p.admin_full_name, p.admin_phone, p.min_topup_amount, p.commission_rate, p.commission_free_after_days, p.payout_hold_days, p.is_active],
    );
    if (r.rowCount === 0) throw new HttpError(404, "Okul bulunamadı");
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
    const p = z.object({ query: z.string().trim().max(100).optional(), school_id: z.string().uuid().optional() }).parse(params ?? {});
    const schoolId = resolveSchoolScope(ctx, p.school_id);
    const args: any[] = [schoolId];
    let where = "school_id = $1";
    if (p.query && p.query.length >= 1) {
      args.push(`%${p.query}%`);
      const normalizedUid = p.query.toUpperCase().replace(/[^A-Z0-9]/g, "");
      args.push(normalizedUid ? `%${normalizedUid}%` : `%${p.query}%`);
      where += ` AND (full_name ILIKE $${args.length - 1} OR student_no ILIKE $${args.length - 1} OR parent_phone ILIKE $${args.length - 1} OR nfc_uid ILIKE $${args.length})`;
    }
    const r = await query(
      `SELECT id, full_name, class_name, student_no, parent_phone, balance,
              qr_token, nfc_uid, photo_url, card_lost, is_active, created_at
         FROM students WHERE ${where}
        ORDER BY created_at DESC LIMIT 500`,
      args,
    );
    return r.rows;
  },
  create_student: async (ctx, params) => {
    const p = StudentInputSchema.extend({ school_id: z.string().uuid().optional() }).parse(params);
    const schoolId = resolveSchoolScope(ctx, p.school_id);
    const parentPhone = p.parent_phone ? normalizePhone(p.parent_phone) : null;
    const sendWelcome = p.send_welcome_sms !== false; // default true

    const created = await withTransaction(async (client) => {
      let isNewParent = false;
      let pinPlain: string | null = null;
      if (parentPhone && parentPhone.length >= 10) {
        const existing = await client.query(
          "SELECT id FROM app_users WHERE phone=$1",
          [parentPhone],
        );
        if (existing.rowCount === 0) {
          isNewParent = true;
          await client.query(
            `INSERT INTO app_users (school_id, full_name, phone, role, is_active)
             VALUES ($1,$2,$3,'parent',TRUE)
             ON CONFLICT (phone) DO NOTHING`,
            [schoolId, p.parent_full_name?.trim() || `${p.full_name} Velisi`, parentPhone],
          );
        }
        if (sendWelcome) {
          // A hashed PIN cannot be read back, so every requested welcome SMS
          // creates a fresh parent PIN. This also covers existing parent phones.
          pinPlain = String(Math.floor(100000 + Math.random() * 900000));
          const pinHash = await bcrypt.hash(pinPlain, 10);
          await client.query(
            `INSERT INTO parent_pins (phone, pin_hash, must_change)
             VALUES ($1,$2,TRUE)
             ON CONFLICT (phone) DO UPDATE
               SET pin_hash = EXCLUDED.pin_hash,
                   must_change = TRUE,
                   updated_at = now()`,
            [parentPhone, pinHash],
          );
        }
      }
      const r = await client.query(
        `INSERT INTO students (school_id, full_name, class_name, student_no, parent_phone, balance, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,TRUE)
         RETURNING id, full_name, class_name, student_no, parent_phone, balance,
                   qr_token, nfc_uid, is_active, created_at`,
        [schoolId, p.full_name, p.class_name ?? null, p.student_no ?? null, parentPhone, p.balance ?? 0],
      );
      return { student: r.rows[0], isNewParent, pinPlain };
    });

    let smsStatus: { ok: boolean; status: string } | null = null;
    if (sendWelcome && created.pinPlain && parentPhone) {
      try {
        const sr = await query<{ name: string }>("SELECT name FROM schools WHERE id=$1", [schoolId]);
        const schoolName = sr.rows[0]?.name ?? "";
        const tplRow = await query<{ value: string }>(
          "SELECT value FROM system_settings WHERE key = 'parent_welcome_sms_template'",
        );
        const rawTpl = tplRow.rows[0]?.value;
        const template = typeof rawTpl === "string" ? rawTpl
          : "Sayin {parent_name}, {school_name} kantin sisteminde hesabiniz aktiftir.";
        const parentName = p.parent_full_name?.trim() || `${p.full_name} Velisi`;
        let message = template
          .replaceAll("{parent_name}", parentName)
          .replaceAll("{school_name}", schoolName)
          .replaceAll("{pin}", created.pinPlain);
        if (!template.includes("{pin}")) message += ` Giris PIN: ${created.pinPlain}`;
        const r = await sendSms(parentPhone, message);
        smsStatus = { ok: r.ok, status: r.status };
      } catch (e) {
        smsStatus = { ok: false, status: e instanceof Error ? e.message : "sms_error" };
      }
    }
    return { ...created.student, sms: smsStatus, new_parent: created.isNewParent };
  },
  update_student: async (ctx, params) => {
    const p = StudentUpdateSchema.extend({ school_id: z.string().uuid().optional() }).parse(params);
    const schoolId = resolveSchoolScope(ctx, p.school_id);
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
    const p = z.object({ id: z.string().uuid(), is_active: z.boolean(), school_id: z.string().uuid().optional() }).parse(params);
    const schoolId = resolveSchoolScope(ctx, p.school_id);
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
    const p = z.object({ id: z.string().uuid(), school_id: z.string().uuid().optional() }).parse(params);
    const schoolId = resolveSchoolScope(ctx, p.school_id);
    const r = await query(
      "DELETE FROM students WHERE id=$1 AND school_id=$2",
      [p.id, schoolId],
    );
    if (r.rowCount === 0) throw new HttpError(404, "Öğrenci bulunamadı");
    return { id: p.id, deleted: true };
  },
  set_student_nfc: async (ctx, params) => {
    const p = z.object({
      id: z.string().uuid(),
      nfc_uid: z.string().trim().min(1).max(64).nullable(),
      school_id: z.string().uuid().optional(),
    }).parse(params);
    const schoolId = resolveSchoolScope(ctx, p.school_id);
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
  // Admin photo upload (super_admin or school_admin scoped). Accepts base64 JPEG.
  set_student_photo: async (ctx, params) => {
    const p = z.object({
      id: z.string().uuid(),
      image_base64: z.string().min(100).max(2_000_000),
      school_id: z.string().uuid().optional(),
    }).parse(params);
    const schoolId = resolveSchoolScope(ctx, p.school_id);

    // Verify ownership of student in this school + grab old photo
    const sr = await query<{ id: string; photo_url: string | null }>(
      "SELECT id, photo_url FROM students WHERE id=$1 AND school_id=$2",
      [p.id, schoolId],
    );
    if (sr.rowCount === 0) throw new HttpError(404, "Öğrenci bulunamadı");
    const oldUrl = sr.rows[0].photo_url;

    // Decode base64 -> bytes
    let b64 = p.image_base64;
    const comma = b64.indexOf(",");
    if (b64.startsWith("data:") && comma > 0) b64 = b64.slice(comma + 1);
    let bytes: Uint8Array;
    try {
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch {
      throw new HttpError(400, "Geçersiz görüntü verisi");
    }
    if (bytes.length > 1_500_000) throw new HttpError(413, "Görüntü çok büyük (max 1.5MB)");
    if (bytes.length < 500) throw new HttpError(400, "Görüntü çok küçük");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const storageHeaders: Record<string, string> = { apikey: SERVICE_KEY };
    if (SERVICE_KEY.split(".").length === 3) storageHeaders.Authorization = `Bearer ${SERVICE_KEY}`;
    const filename = `${p.id}-${Date.now()}.jpg`;
    const objectKey = `${schoolId}/${filename}`;
    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/student-photos/${objectKey}`,
      {
        method: "POST",
        headers: { ...storageHeaders, "Content-Type": "image/jpeg", "x-upsert": "true", "Cache-Control": "31536000" },
        body: bytes,
      },
    );
    if (!uploadRes.ok) {
      const t = await uploadRes.text();
      throw new HttpError(500, `Yükleme başarısız: ${t.slice(0, 200)}`);
    }
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/student-photos/${objectKey}`;

    await query("UPDATE students SET photo_url=$2, updated_at=now() WHERE id=$1", [p.id, publicUrl]);

    if (oldUrl && oldUrl !== publicUrl) {
      const prefix = `${SUPABASE_URL}/storage/v1/object/public/student-photos/`;
      if (oldUrl.startsWith(prefix)) {
        const oldKey = oldUrl.slice(prefix.length);
        fetch(`${SUPABASE_URL}/storage/v1/object/student-photos/${oldKey}`, {
          method: "DELETE",
          headers: storageHeaders,
        }).catch(() => {});
      }
    }
    return { id: p.id, photo_url: publicUrl };
  },
  delete_student_photo: async (ctx, params) => {
    const p = z.object({
      id: z.string().uuid(),
      school_id: z.string().uuid().optional(),
    }).parse(params);
    const schoolId = resolveSchoolScope(ctx, p.school_id);
    const sr = await query<{ photo_url: string | null }>(
      "SELECT photo_url FROM students WHERE id=$1 AND school_id=$2",
      [p.id, schoolId],
    );
    if (sr.rowCount === 0) throw new HttpError(404, "Öğrenci bulunamadı");
    const oldUrl = sr.rows[0].photo_url;
    await query("UPDATE students SET photo_url=NULL, updated_at=now() WHERE id=$1", [p.id]);
    if (oldUrl) {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
      const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const storageHeaders: Record<string, string> = { apikey: SERVICE_KEY };
      if (SERVICE_KEY.split(".").length === 3) storageHeaders.Authorization = `Bearer ${SERVICE_KEY}`;
      const prefix = `${SUPABASE_URL}/storage/v1/object/public/student-photos/`;
      if (oldUrl.startsWith(prefix)) {
        const oldKey = oldUrl.slice(prefix.length);
        fetch(`${SUPABASE_URL}/storage/v1/object/student-photos/${oldKey}`, {
          method: "DELETE",
          headers: storageHeaders,
        }).catch(() => {});
      }
    }
    return { id: p.id, photo_url: null };
  },
  adjust_student_balance: async (ctx, params) => {
    const p = z.object({
      id: z.string().uuid(),
      delta: z.number().refine((n) => Math.abs(n) > 0 && Math.abs(n) <= 100000, "Tutar 0-100.000 ₺ aralığında olmalı"),
      school_id: z.string().uuid().optional(),
    }).parse(params);
    const schoolId = resolveSchoolScope(ctx, p.school_id);
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
      if (p.delta > 0) {
        await client.query(
          `INSERT INTO wallet_topups (school_id, student_id, amount, source, created_by)
           VALUES ($1,$2,$3,'admin',$4)`,
          [schoolId, p.id, p.delta, (ctx as any).userId ?? null],
        );
      }
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
  // ===== School splashes (super_admin manages per-school parent splash screen) =====
  list_school_splashes: async (ctx) => {
    requireSuperAdmin(ctx);
    const r = await query(
      `SELECT s.id AS school_id, s.name AS school_name,
              ss.image_url, ss.link_url, ss.is_active, ss.expires_at, ss.updated_at
         FROM schools s
         LEFT JOIN school_splashes ss ON ss.school_id = s.id
        ORDER BY s.name ASC`,
    );
    return r.rows;
  },
  get_global_splash: async (ctx) => {
    requireSuperAdmin(ctx);
    const r = await query(
      "SELECT id, image_url, link_url, is_active, expires_at, updated_at FROM global_splashes WHERE id = 1",
    );
    return r.rows[0] ?? null;
  },
  upsert_school_splash: async (ctx, params) => {
    requireSuperAdmin(ctx);
    const p = z.object({
      school_id: z.string().uuid(),
      image_url: z.string().trim().url().max(2048),
      link_url: z.string().trim().url().max(2048).nullable().optional(),
      is_active: z.boolean().optional().default(true),
      expires_at: z.string().datetime({ offset: true }).nullable().optional(),
    }).parse(params);
    const r = await query(
      `INSERT INTO school_splashes (school_id, image_url, link_url, is_active, expires_at, updated_at)
       VALUES ($1,$2,$3,$4,$5, now())
       ON CONFLICT (school_id) DO UPDATE
         SET image_url = EXCLUDED.image_url,
             link_url  = EXCLUDED.link_url,
             is_active = EXCLUDED.is_active,
             expires_at = EXCLUDED.expires_at,
             updated_at = now()
       RETURNING school_id, image_url, link_url, is_active, expires_at, updated_at`,
      [p.school_id, p.image_url, p.link_url ?? null, p.is_active, p.expires_at ?? null],
    );
    return r.rows[0];
  },
  upsert_global_splash: async (ctx, params) => {
    requireSuperAdmin(ctx);
    const p = z.object({
      image_url: z.string().trim().url().max(2048),
      link_url: z.string().trim().url().max(2048).nullable().optional(),
      is_active: z.boolean().optional().default(true),
      expires_at: z.string().datetime({ offset: true }).nullable().optional(),
    }).parse(params);
    const r = await query(
      `INSERT INTO global_splashes (id, image_url, link_url, is_active, expires_at, updated_at)
       VALUES (1, $1, $2, $3, $4, now())
       ON CONFLICT (id) DO UPDATE
         SET image_url = EXCLUDED.image_url,
             link_url  = EXCLUDED.link_url,
             is_active = EXCLUDED.is_active,
             expires_at = EXCLUDED.expires_at,
             updated_at = now()
       RETURNING id, image_url, link_url, is_active, expires_at, updated_at`,
      [p.image_url, p.link_url ?? null, p.is_active, p.expires_at ?? null],
    );
    return r.rows[0];
  },
  delete_school_splash: async (ctx, params) => {
    requireSuperAdmin(ctx);
    const p = z.object({ school_id: z.string().uuid() }).parse(params);
    await query("DELETE FROM school_splashes WHERE school_id=$1", [p.school_id]);
    return { school_id: p.school_id, deleted: true };
  },
  delete_global_splash: async (ctx) => {
    requireSuperAdmin(ctx);
    await query("DELETE FROM global_splashes WHERE id = 1");
    return { deleted: true };
  },
  // ===== Canteen announcements (per-school, 4 slots, shown on cashier panel) =====
  list_canteen_announcements: async (ctx) => {
    requireSuperAdmin(ctx);
    const r = await query(
      `SELECT s.id AS school_id, s.name AS school_name,
              ca.slot, ca.image_url, ca.title, ca.is_active, ca.updated_at
         FROM schools s
         LEFT JOIN canteen_announcements ca ON ca.school_id = s.id
        ORDER BY s.name ASC, ca.slot ASC NULLS LAST`,
    );
    return r.rows;
  },
  upsert_canteen_announcement: async (ctx, params) => {
    requireSuperAdmin(ctx);
    const p = z.object({
      school_id: z.string().uuid(),
      slot: z.number().int().min(1).max(4),
      image_url: z.string().trim().url().max(2048),
      title: z.string().trim().max(120).nullable().optional(),
      is_active: z.boolean().optional().default(true),
    }).parse(params);
    const r = await query(
      `INSERT INTO canteen_announcements (school_id, slot, image_url, title, is_active, updated_at)
       VALUES ($1,$2,$3,$4,$5, now())
       ON CONFLICT (school_id, slot) DO UPDATE
         SET image_url = EXCLUDED.image_url,
             title = EXCLUDED.title,
             is_active = EXCLUDED.is_active,
             updated_at = now()
       RETURNING school_id, slot, image_url, title, is_active, updated_at`,
      [p.school_id, p.slot, p.image_url, p.title ?? null, p.is_active],
    );
    return r.rows[0];
  },
  delete_canteen_announcement: async (ctx, params) => {
    requireSuperAdmin(ctx);
    const p = z.object({
      school_id: z.string().uuid(),
      slot: z.number().int().min(1).max(4),
    }).parse(params);
    await query(
      "DELETE FROM canteen_announcements WHERE school_id=$1 AND slot=$2",
      [p.school_id, p.slot],
    );
    return { school_id: p.school_id, slot: p.slot, deleted: true };
  },
  // ===== School stories (per-school Instagram-style reels for parent panel) =====
  list_school_stories: async (ctx) => {
    requireSuperAdmin(ctx);
    const r = await query(
      `SELECT s.id AS school_id, s.name AS school_name,
              ss.id AS story_id, ss.image_url, ss.link_url, ss.title,
              ss.sort_order, ss.is_active, ss.updated_at, ss.created_at
         FROM schools s
         LEFT JOIN school_stories ss ON ss.school_id = s.id
        ORDER BY s.name ASC, ss.sort_order ASC NULLS LAST, ss.created_at ASC`,
    );
    return r.rows;
  },
  upsert_school_story: async (ctx, params) => {
    requireSuperAdmin(ctx);
    const p = z.object({
      story_id: z.string().uuid().optional(),
      school_id: z.string().uuid(),
      image_url: z.string().trim().url().max(2048),
      link_url: z.string().trim().url().max(2048).nullable().optional(),
      title: z.string().trim().max(120).nullable().optional(),
      sort_order: z.number().int().optional(),
      is_active: z.boolean().optional().default(true),
    }).parse(params);
    if (p.story_id) {
      const r = await query(
        `UPDATE school_stories
            SET image_url=$2, link_url=$3, title=$4, is_active=$5,
                sort_order = COALESCE($6, sort_order), updated_at=now()
          WHERE id=$1
          RETURNING id, school_id, image_url, link_url, title, sort_order, is_active`,
        [p.story_id, p.image_url, p.link_url ?? null, p.title ?? null, p.is_active, p.sort_order ?? null],
      );
      if (r.rowCount === 0) throw new HttpError(404, "Hikaye bulunamadı");
      return r.rows[0];
    }
    // Default sort_order = max+1 for that school
    let order = p.sort_order;
    if (order == null) {
      const m = await query<{ m: number | null }>(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 AS m FROM school_stories WHERE school_id=$1",
        [p.school_id],
      );
      order = Number(m.rows[0]?.m ?? 0);
    }
    const r = await query(
      `INSERT INTO school_stories (school_id, image_url, link_url, title, sort_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, school_id, image_url, link_url, title, sort_order, is_active`,
      [p.school_id, p.image_url, p.link_url ?? null, p.title ?? null, order, p.is_active],
    );
    return r.rows[0];
  },
  delete_school_story: async (ctx, params) => {
    requireSuperAdmin(ctx);
    const p = z.object({ story_id: z.string().uuid() }).parse(params);
    await query("DELETE FROM school_stories WHERE id=$1", [p.story_id]);
    return { story_id: p.story_id, deleted: true };
  },
  reorder_school_stories: async (ctx, params) => {
    requireSuperAdmin(ctx);
    const p = z.object({
      school_id: z.string().uuid(),
      story_ids: z.array(z.string().uuid()).min(1),
    }).parse(params);
    await query(
      `UPDATE school_stories AS s
          SET sort_order = v.ord, updated_at = now()
         FROM (SELECT UNNEST($2::uuid[]) AS id,
                      generate_series(0, array_length($2::uuid[], 1) - 1) AS ord) AS v
        WHERE s.id = v.id AND s.school_id = $1`,
      [p.school_id, p.story_ids],
    );
    return { school_id: p.school_id, count: p.story_ids.length };
  },
  // ===== Donation managers (super_admin manages per-school donation operators) =====
  list_donation_managers: async (ctx) => {
    requireSuperAdmin(ctx);
    const r = await query(
      `SELECT m.id, m.school_id, m.full_name, m.phone, m.is_active,
              m.last_login_at, m.created_at, sc.name AS school_name
         FROM donation_managers m
         JOIN schools sc ON sc.id = m.school_id
        ORDER BY sc.name, m.full_name`,
    );
    return r.rows;
  },
  list_donation_pools: async (ctx) => {
    requireSuperAdmin(ctx);
    const r = await query(
      `SELECT s.id AS school_id, s.name AS school_name,
              COALESCE(p.balance,0) AS balance,
              COALESCE(p.total_received,0) AS total_received,
              COALESCE(p.total_distributed,0) AS total_distributed,
              p.updated_at
         FROM schools s
         LEFT JOIN school_donation_pools p ON p.school_id = s.id
        ORDER BY s.name`,
    );
    return r.rows;
  },
  upsert_donation_manager: async (ctx, params) => {
    requireSuperAdmin(ctx);
    const p = z.object({
      id: z.string().uuid().optional(),
      school_id: z.string().uuid(),
      full_name: z.string().trim().min(2).max(120),
      phone: z.string().trim().min(10).max(20),
      is_active: z.boolean().optional().default(true),
    }).parse(params);
    const phone = p.phone.replace(/\D+/g, "").replace(/^90/, "").replace(/^0/, "");
    if (phone.length !== 10) throw new HttpError(400, "Telefon 10 haneli olmalı (5XXXXXXXXX)");

    if (p.id) {
      const r = await query(
        `UPDATE donation_managers
            SET school_id=$2, full_name=$3, phone=$4, is_active=$5, updated_at=now()
          WHERE id=$1
          RETURNING id, school_id, full_name, phone, is_active`,
        [p.id, p.school_id, p.full_name, phone, p.is_active],
      );
      if (r.rowCount === 0) throw new HttpError(404, "Yönetici bulunamadı");
      return r.rows[0];
    }
    const r = await query(
      `INSERT INTO donation_managers (school_id, full_name, phone, is_active)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (school_id, phone) DO UPDATE
         SET full_name=EXCLUDED.full_name, is_active=EXCLUDED.is_active, updated_at=now()
       RETURNING id, school_id, full_name, phone, is_active`,
      [p.school_id, p.full_name, phone, p.is_active],
    );
    // Ensure pool row exists
    await query(
      "INSERT INTO school_donation_pools (school_id) VALUES ($1) ON CONFLICT DO NOTHING",
      [p.school_id],
    );
    return r.rows[0];
  },
  delete_donation_manager: async (ctx, params) => {
    requireSuperAdmin(ctx);
    const p = z.object({ id: z.string().uuid() }).parse(params);
    await query("DELETE FROM donation_managers WHERE id=$1", [p.id]);
    return { id: p.id, deleted: true };
  },
  // ---- Parent welcome SMS template (super admin) ----
  get_parent_welcome_template: async (ctx) => {
    requireSuperAdmin(ctx);
    const r = await query<{ value: string }>(
      "SELECT value FROM system_settings WHERE key = 'parent_welcome_sms_template'",
    );
    const tpl = r.rows[0]?.value
      ?? "Sayin {parent_name}, {school_name} kantin sisteminde hesabiniz aktiftir. Cocugunuzun bakiyesini yonetmek ve yukleme yapmak icin: kantinpay.com";
    return { template: typeof tpl === "string" ? tpl : String(tpl) };
  },
  save_parent_welcome_template: async (ctx, params) => {
    requireSuperAdmin(ctx);
    const p = z.object({ template: z.string().trim().min(10).max(500) }).parse(params);
    await query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ('parent_welcome_sms_template', to_jsonb($1::text), now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [p.template],
    );
    return { ok: true };
  },
  // ---- Bulk student import (super admin) ----
  bulk_import_students: async (ctx, params) => {
    requireSuperAdmin(ctx);
    const p = z.object({
      school_id: z.string().uuid(),
      send_welcome_sms: z.boolean().optional().default(true),
      rows: z.array(z.object({
        full_name: z.string().trim().min(2).max(255),
        class_name: z.string().trim().max(50).optional().nullable(),
        parent_full_name: z.string().trim().min(2).max(255),
        parent_phone: z.string().trim().min(10).max(20),
      })).min(1).max(2000),
    }).parse(params);

    const sr = await query<{ name: string }>("SELECT name FROM schools WHERE id=$1", [p.school_id]);
    if (sr.rowCount === 0) throw new HttpError(404, "Okul bulunamadı");
    const schoolName = sr.rows[0].name;
    const tplRow = await query<{ value: string }>(
      "SELECT value FROM system_settings WHERE key = 'parent_welcome_sms_template'",
    );
    const rawTpl = tplRow.rows[0]?.value;
    const template = typeof rawTpl === "string" ? rawTpl
      : "Sayin {parent_name}, {school_name} kantin sisteminde hesabiniz aktiftir.";

    type RowResult = {
      row: number; status: "created" | "failed";
      student_id?: string; parent_phone?: string; error?: string;
    };
    const results: RowResult[] = [];
    // phone -> { name, pin }  (PIN only set for brand-new parents)
    const newParentPhones = new Map<string, { name: string; pin: string }>();

    for (let i = 0; i < p.rows.length; i++) {
      const row = p.rows[i];
      try {
        const phone = normalizePhone(row.parent_phone);
        if (phone.length < 10) {
          results.push({ row: i + 1, status: "failed", error: "Geçersiz telefon" });
          continue;
        }
        const ins = await withTransaction(async (client) => {
          const existing = await client.query(
            "SELECT id FROM app_users WHERE phone=$1",
            [phone],
          );
          const isNewParent = existing.rowCount === 0;
          let pinPlain: string | null = null;
          if (isNewParent) {
            await client.query(
              `INSERT INTO app_users (school_id, full_name, phone, role, is_active)
               VALUES ($1,$2,$3,'parent',TRUE)
               ON CONFLICT (phone) DO NOTHING`,
              [p.school_id, row.parent_full_name, phone],
            );
            // Generate & store a 6-digit PIN (forced-change on first login).
            pinPlain = String(Math.floor(100000 + Math.random() * 900000));
            const pinHash = await bcrypt.hash(pinPlain, 10);
            await client.query(
              `INSERT INTO parent_pins (phone, pin_hash, must_change)
               VALUES ($1,$2,TRUE)
               ON CONFLICT (phone) DO UPDATE
                 SET pin_hash = EXCLUDED.pin_hash,
                     must_change = TRUE,
                     updated_at = now()`,
              [phone, pinHash],
            );
          }
          const sIns = await client.query(
            `INSERT INTO students (school_id, full_name, class_name, parent_phone, balance, is_active)
             VALUES ($1,$2,$3,$4,0,TRUE)
             RETURNING id`,
            [p.school_id, row.full_name, row.class_name ?? null, phone],
          );
          return { studentId: sIns.rows[0].id as string, isNewParent, pinPlain };
        });
        if (ins.isNewParent && ins.pinPlain) {
          newParentPhones.set(phone, { name: row.parent_full_name, pin: ins.pinPlain });
        }
        results.push({ row: i + 1, status: "created", student_id: ins.studentId, parent_phone: phone });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ row: i + 1, status: "failed", error: msg });
      }
    }

    let smsSent = 0; let smsFailed = 0;
    if (p.send_welcome_sms) {
      for (const [phone, info] of newParentPhones) {
        let message = template
          .replaceAll("{parent_name}", info.name)
          .replaceAll("{school_name}", schoolName)
          .replaceAll("{pin}", info.pin);
        // If admin's custom template doesn't include {pin}, append the PIN line
        // so the parent can always log in.
        if (!template.includes("{pin}")) {
          message += ` Giris PIN: ${info.pin}`;
        }
        try {
          const r = await sendSms(phone, message);
          if (r.ok) smsSent++; else smsFailed++;
        } catch { smsFailed++; }
      }
    }

    return {
      total: p.rows.length,
      created: results.filter((r) => r.status === "created").length,
      failed: results.filter((r) => r.status === "failed").length,
      new_parents: newParentPhones.size,
      sms_sent: smsSent,
      sms_failed: smsFailed,
      results,
    };
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
  parent_full_name: z.string().trim().max(255).optional().nullable(),
  balance: z.number().min(0).max(10000).optional(),
  send_welcome_sms: z.boolean().optional(),
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
  payout_hold_days: z.number().int().min(0).max(60).default(1),
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
      // Return 200 with error body so supabase-js doesn't surface a FunctionsHttpError
      // (which triggers the Lovable runtime-error overlay). The client checks `data.error`.
      return new Response(JSON.stringify({ error: e.message, status: e.status }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (isDbConnectionError(e)) {
      console.warn("db-proxy external DB unavailable:", msg);
      return new Response(JSON.stringify({
        error: "Veritabanı sunucusuna şu anda ulaşılamıyor. Lütfen kısa süre sonra tekrar deneyin.",
        code: "DB_UNAVAILABLE",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "5" },
      });
    }
    console.error("db-proxy error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
