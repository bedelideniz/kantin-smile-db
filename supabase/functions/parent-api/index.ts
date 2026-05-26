// Parent API: OTP-based login + read-only canteen data for parents.
// Auth model:
//   1) parent_login_request: phone -> if any active student has that parent_phone,
//      generate OTP and send via SMS. If not found, return 404 ("tanımsız").
//   2) parent_login_verify: phone+code -> issue opaque session token (parent_sessions).
//   3) protected ops: list children, get child summary, list transactions.
//
// One parent (phone) can have multiple students across the same school (or even multiple schools).
// The session is bound to the phone, not to a specific student. Frontend chooses which student
// to operate on per-request via `student_id`.
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { z } from "npm:zod@3.23.8";
import { query, withTransaction } from "../_shared/external-db.ts";
import { generateOtp, normalizePhone, sendSms } from "../_shared/sms.ts";

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const SESSION_TTL_HOURS = 24 * 14; // 2 weeks (default)
const SESSION_TTL_HOURS_REMEMBER = 24 * 30; // 30 days (remember me)

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Returns the canonical (10-digit) phone plus all common variants the DB might hold.
function phoneVariants(raw: string): { canonical: string; variants: string[] } {
  const canonical = normalizePhone(raw);
  const inputDigits = raw.replace(/\D+/g, "");
  const variants = Array.from(new Set([canonical, `0${canonical}`, `90${canonical}`, inputDigits].filter(Boolean)));
  return { canonical, variants };
}

interface ParentContext { phone: string; token: string; }

async function authParent(req: Request): Promise<ParentContext> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) throw new HttpError(401, "Oturum gerekli");
  const token = authHeader.slice(7);
  const r = await query<{ phone: string; expires_at: string }>(
    "SELECT phone, expires_at FROM parent_sessions WHERE token = $1",
    [token],
  );
  if (r.rowCount === 0) throw new HttpError(401, "Oturum bulunamadı");
  if (new Date(r.rows[0].expires_at) < new Date()) {
    await query("DELETE FROM parent_sessions WHERE token=$1", [token]);
    throw new HttpError(401, "Oturum süresi doldu");
  }
  query("UPDATE parent_sessions SET last_seen_at=now() WHERE token=$1", [token]).catch(() => {});
  return { phone: r.rows[0].phone, token };
}

async function findStudentsForParent(phoneVariantsList: string[]) {
  const r = await query<{
    id: string; school_id: string; full_name: string; class_name: string | null;
    student_no: string | null; balance: string; is_active: boolean; school_name: string;
    photo_url: string | null; card_lost: boolean; nfc_uid: string | null;
    daily_spend_limit: string | null; today_spent: string;
  }>(
    `SELECT s.id, s.school_id, s.full_name, s.class_name, s.student_no,
            s.balance, s.is_active, s.photo_url, s.card_lost, s.nfc_uid,
            s.daily_spend_limit,
            COALESCE((
              SELECT SUM(t.total_amount - t.refunded_amount)
                FROM transactions t
               WHERE t.student_id = s.id
                 AND t.status = 'completed'
                 AND t.created_at >= date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul'
            ), 0) AS today_spent,
            sc.name AS school_name
       FROM students s
       JOIN schools sc ON sc.id = s.school_id
      WHERE s.is_active = TRUE
        AND (
          s.parent_phone = ANY($1::text[])
          OR regexp_replace(s.parent_phone, '\\D', '', 'g') = ANY($1::text[])
             
          OR EXISTS (
            SELECT 1 FROM student_co_parents cp
             WHERE cp.student_id = s.id
               AND (cp.phone = ANY($1::text[])
                    OR regexp_replace(cp.phone, '\\D', '', 'g') = ANY($1::text[]))
          )
        )
      ORDER BY sc.name ASC, s.full_name ASC`,
    [phoneVariantsList],
  );
  return r.rows;
}

// Returns true if the given phone (any variant) owns this student via either
// students.parent_phone OR student_co_parents.
async function parentOwnsStudent(studentId: string, variants: string[]): Promise<boolean> {
  const r = await query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM students s
        WHERE s.id = $1 AND s.is_active = TRUE
          AND (
            s.parent_phone = ANY($2::text[])
            OR regexp_replace(s.parent_phone, '\\D', '', 'g') = ANY($2::text[])
            OR EXISTS (
              SELECT 1 FROM student_co_parents cp
               WHERE cp.student_id = s.id
                 AND (cp.phone = ANY($2::text[])
                      OR regexp_replace(cp.phone, '\\D', '', 'g') = ANY($2::text[]))
            )
          )
     ) AS ok`,
    [studentId, variants],
  );
  return !!r.rows[0]?.ok;
}

type Handler = (req: Request, params: any) => Promise<unknown>;

const PUBLIC_OPS: Record<string, Handler> = {
  login_request: async (_req, params) => {
    const p = z.object({ phone: z.string().trim().min(10).max(20) }).parse(params);
    const { canonical, variants } = phoneVariants(p.phone);

    const students = await findStudentsForParent(variants);
    if (students.length === 0) {
      // Explicit "unknown" response — parents do NOT self-register.
      throw new HttpError(404, "Bu telefon numarasına kayıtlı öğrenci bulunamadı. Lütfen okul yöneticisi ile iletişime geçin.");
    }

    // Throttle: max 3 OTPs per phone in the last 5 minutes.
    const recent = await query<{ c: number }>(
      "SELECT COUNT(*)::int AS c FROM otp_codes WHERE phone=$1 AND purpose='parent_login' AND created_at > now() - interval '5 minutes'",
      [canonical],
    );
    if ((recent.rows[0]?.c ?? 0) >= 3) {
      throw new HttpError(429, "Çok fazla istek. Lütfen birkaç dakika sonra tekrar deneyin.");
    }

    const code = generateOtp();
    await query(
      "INSERT INTO otp_codes (phone, code, purpose, expires_at) VALUES ($1,$2,'parent_login', now() + interval '10 minutes')",
      [canonical, code],
    );

    const childNames = students.map((s) => s.full_name.split(/\s+/)[0]).slice(0, 3).join(", ");
    const message = `KantinPay veli giris kodunuz: ${code} (${childNames}). Kod 10 dakika gecerlidir.`;
    const sms = await sendSms(canonical, message);
    if (!sms.ok) {
      console.error("[parent-api] SMS failed", { status: sms.status, raw: sms.raw });
      throw new HttpError(502, `SMS gönderilemedi (${sms.status}): ${sms.raw?.slice(0, 200) ?? "bilinmeyen hata"}`);
    }
    return { ok: true, student_count: students.length };
  },
  login_verify: async (_req, params) => {
    const p = z.object({
      phone: z.string().trim().min(10).max(20),
      code: z.string().regex(/^\d{6}$/, "Kod 6 haneli olmalıdır"),
      remember: z.boolean().optional().default(false),
    }).parse(params);
    const { canonical, variants } = phoneVariants(p.phone);

    const otp = await query<{ id: string; attempts: number }>(
      `SELECT id, attempts FROM otp_codes
        WHERE phone=$1 AND purpose='parent_login' AND code=$2
          AND consumed_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1`,
      [canonical, p.code],
    );
    if (otp.rowCount === 0) {
      // Increment attempts on most-recent unconsumed OTP for this phone (for throttling)
      await query(
        `UPDATE otp_codes SET attempts = attempts + 1
          WHERE id = (SELECT id FROM otp_codes
                       WHERE phone=$1 AND purpose='parent_login' AND consumed_at IS NULL
                       ORDER BY created_at DESC LIMIT 1)`,
        [canonical],
      );
      throw new HttpError(401, "Kod hatalı veya süresi dolmuş");
    }
    await query("UPDATE otp_codes SET consumed_at=now() WHERE id=$1", [otp.rows[0].id]);

    // Re-verify still has at least one student (in case of de-link in the meantime).
    const students = await findStudentsForParent(variants);
    if (students.length === 0) throw new HttpError(403, "Bu telefona ait aktif öğrenci yok");

    const token = generateToken();
    const ttlHours = p.remember ? SESSION_TTL_HOURS_REMEMBER : SESSION_TTL_HOURS;
    const expires = new Date(Date.now() + ttlHours * 3600 * 1000);
    await query(
      "INSERT INTO parent_sessions (token, phone, expires_at) VALUES ($1,$2,$3)",
      [token, canonical, expires.toISOString()],
    );
    query("DELETE FROM parent_sessions WHERE expires_at < now()").catch(() => {});

    return {
      token,
      expires_at: expires.toISOString(),
      students: students.map((s) => ({
        id: s.id, school_id: s.school_id, school_name: s.school_name,
        full_name: s.full_name, class_name: s.class_name, student_no: s.student_no,
        balance: Number(s.balance),
        daily_spend_limit: s.daily_spend_limit == null ? null : Number(s.daily_spend_limit),
        today_spent: Number(s.today_spent ?? 0),
      })),
    };
  },
  get_school_splash: async (_req, params) => {
    const p = z.object({ school_id: z.string().uuid() }).parse(params);
    const r = await query<{ image_url: string; link_url: string | null }>(
      "SELECT image_url, link_url FROM school_splashes WHERE school_id=$1 AND is_active=TRUE",
      [p.school_id],
    );
    if (r.rowCount === 0) return null;
    return r.rows[0];
  },
  list_school_stories: async (_req, params) => {
    const p = z.object({ school_id: z.string().uuid() }).parse(params);
    const r = await query<{
      id: string; image_url: string; link_url: string | null; title: string | null;
    }>(
      `SELECT id, image_url, link_url, title
         FROM school_stories
        WHERE school_id=$1 AND is_active=TRUE
        ORDER BY sort_order ASC, created_at ASC`,
      [p.school_id],
    );
    return r.rows;
  },
  get_school_donation_info: async (_req, params) => {
    const p = z.object({ school_id: z.string().uuid() }).parse(params);
    const r = await query<{ presets: string[] | null; is_enabled: boolean; thank_you_message: string | null }>(
      "SELECT presets, is_enabled, thank_you_message FROM school_donation_settings WHERE school_id=$1",
      [p.school_id],
    );
    if (r.rowCount === 0) {
      return { presets: [10, 25, 50, 100, 250], is_enabled: true, thank_you_message: null };
    }
    return {
      presets: (r.rows[0].presets ?? []).map((v) => Number(v)),
      is_enabled: r.rows[0].is_enabled,
      thank_you_message: r.rows[0].thank_you_message,
    };
  },
};

const PROTECTED_OPS: Record<string, (ctx: ParentContext, params: any) => Promise<unknown>> = {
  me: async (ctx) => {
    const { variants } = phoneVariants(ctx.phone);
    const students = await findStudentsForParent(variants);
    return {
      phone: ctx.phone,
      students: students.map((s) => ({
        id: s.id, school_id: s.school_id, school_name: s.school_name,
        full_name: s.full_name, class_name: s.class_name, student_no: s.student_no,
        balance: Number(s.balance), photo_url: s.photo_url,
        card_lost: !!s.card_lost, has_card: !!s.nfc_uid,
        daily_spend_limit: s.daily_spend_limit == null ? null : Number(s.daily_spend_limit),
        today_spent: Number(s.today_spent ?? 0),
      })),
    };
  },
  logout: async (ctx) => {
    await query("DELETE FROM parent_sessions WHERE token=$1", [ctx.token]);
    return { ok: true };
  },
  // Verify a student belongs to this parent and return its current details.
  get_student: async (ctx, params) => {
    const p = z.object({ student_id: z.string().uuid() }).parse(params);
    const { variants } = phoneVariants(ctx.phone);
    const r = await query(
      `SELECT s.id, s.school_id, s.full_name, s.class_name, s.student_no, s.balance, s.is_active,
              s.photo_url, s.card_lost, s.nfc_uid, sc.name AS school_name
         FROM students s
         JOIN schools sc ON sc.id = s.school_id
        WHERE s.id = $1 AND s.is_active = TRUE
          AND (s.parent_phone = ANY($2::text[])
               OR regexp_replace(s.parent_phone, '\\D', '', 'g') = ANY($2::text[])
             OR EXISTS (SELECT 1 FROM student_co_parents cp WHERE cp.student_id = s.id AND (cp.phone = ANY($2::text[]) OR regexp_replace(cp.phone, '\D', '', 'g') = ANY($2::text[]))))`,
      [p.student_id, variants],
    );
    if (r.rowCount === 0) throw new HttpError(404, "Öğrenci bulunamadı");
    const s: any = r.rows[0];
    return {
      id: s.id, school_id: s.school_id, school_name: s.school_name,
      full_name: s.full_name, class_name: s.class_name, student_no: s.student_no,
      balance: Number(s.balance), photo_url: s.photo_url,
      card_lost: !!s.card_lost, has_card: !!s.nfc_uid,
    };
  },
  // Parent toggles "card lost" flag for one of their own students.
  // When true, cashier-side lookup will block sales until cashier marks it found
  // (or parent re-enables it).
  set_card_lost: async (ctx, params) => {
    const p = z.object({
      student_id: z.string().uuid(),
      card_lost: z.boolean(),
    }).parse(params);
    const { variants } = phoneVariants(ctx.phone);
    const r = await query(
      `UPDATE students SET card_lost = $1, updated_at = now()
        WHERE id = $2 AND is_active = TRUE
          AND (parent_phone = ANY($3::text[])
               OR regexp_replace(parent_phone, '\\D', '', 'g') = ANY($3::text[])
             OR EXISTS (SELECT 1 FROM student_co_parents cp WHERE cp.student_id = students.id AND (cp.phone = ANY($3::text[]) OR regexp_replace(cp.phone, '\D', '', 'g') = ANY($3::text[]))))
        RETURNING id, card_lost`,
      [p.card_lost, p.student_id, variants],
    );
    if (r.rowCount === 0) throw new HttpError(404, "Öğrenci bulunamadı");
    return { id: r.rows[0].id, card_lost: !!r.rows[0].card_lost };
  },
  // Parent sets (or clears) the per-day spending limit for one of their students.
  // null disables the limit. Cashier API enforces it on every sale.
  set_daily_limit: async (ctx, params) => {
    const p = z.object({
      student_id: z.string().uuid(),
      daily_spend_limit: z.number().min(0).max(100000).nullable(),
    }).parse(params);
    const { variants } = phoneVariants(ctx.phone);
    const limit = p.daily_spend_limit == null
      ? null
      : Math.round(p.daily_spend_limit * 100) / 100;
    const r = await query(
      `UPDATE students SET daily_spend_limit = $1, updated_at = now()
        WHERE id = $2 AND is_active = TRUE
          AND (parent_phone = ANY($3::text[])
               OR regexp_replace(parent_phone, '\\D', '', 'g') = ANY($3::text[])
             OR EXISTS (SELECT 1 FROM student_co_parents cp WHERE cp.student_id = students.id AND (cp.phone = ANY($3::text[]) OR regexp_replace(cp.phone, '\D', '', 'g') = ANY($3::text[]))))
        RETURNING id, daily_spend_limit`,
      [limit, p.student_id, variants],
    );
    if (r.rowCount === 0) throw new HttpError(404, "Öğrenci bulunamadı");
    return {
      id: r.rows[0].id,
      daily_spend_limit: r.rows[0].daily_spend_limit == null ? null : Number(r.rows[0].daily_spend_limit),
    };
  },
  // List notifications for this parent (across all students sharing this phone).
  list_notifications: async (ctx, params) => {
    const p = z.object({
      limit: z.number().int().min(1).max(100).default(50),
      only_unread: z.boolean().optional(),
    }).parse(params ?? {});
    const { variants } = phoneVariants(ctx.phone);
    const where = p.only_unread
      ? "n.parent_phone = ANY($1::text[]) AND n.read_at IS NULL"
      : "n.parent_phone = ANY($1::text[])";
    const r = await query(
      `SELECT n.id, n.student_id, n.kind, n.title, n.body, n.meta, n.read_at, n.created_at,
              s.full_name AS student_name
         FROM parent_notifications n
         JOIN students s ON s.id = n.student_id
        WHERE ${where}
        ORDER BY n.created_at DESC
        LIMIT $2`,
      [variants, p.limit],
    );
    const cnt = await query<{ unread: string }>(
      `SELECT COUNT(*)::text AS unread FROM parent_notifications
        WHERE parent_phone = ANY($1::text[]) AND read_at IS NULL`,
      [variants],
    );
    return {
      notifications: r.rows,
      unread_count: Number(cnt.rows[0]?.unread ?? 0),
    };
  },
  mark_notifications_read: async (ctx, params) => {
    const p = z.object({
      ids: z.array(z.string().uuid()).optional(),
      all: z.boolean().optional(),
    }).parse(params ?? {});
    const { variants } = phoneVariants(ctx.phone);
    if (p.all) {
      await query(
        `UPDATE parent_notifications SET read_at = now()
          WHERE parent_phone = ANY($1::text[]) AND read_at IS NULL`,
        [variants],
      );
    } else if (p.ids && p.ids.length > 0) {
      await query(
        `UPDATE parent_notifications SET read_at = now()
          WHERE id = ANY($1::uuid[]) AND parent_phone = ANY($2::text[]) AND read_at IS NULL`,
        [p.ids, variants],
      );
    }
    return { ok: true };
  },
  // Upload (or replace) a student's profile photo. Body sends a base64-encoded JPEG
  // (already cropped & resized client-side). Stored in `student-photos` bucket.
  upload_student_photo: async (ctx, params) => {
    const p = z.object({
      student_id: z.string().uuid(),
      // data:image/jpeg;base64,XXXX OR raw base64
      image_base64: z.string().min(100).max(2_000_000), // ~1.5MB encoded cap
    }).parse(params);

    // Verify ownership
    const { variants } = phoneVariants(ctx.phone);
    const own = await query<{ id: string; school_id: string; photo_url: string | null }>(
      `SELECT id, school_id, photo_url FROM students
        WHERE id=$1 AND is_active=TRUE
          AND (parent_phone = ANY($2::text[])
               OR regexp_replace(parent_phone, '\\D', '', 'g') = ANY($2::text[])
             OR EXISTS (SELECT 1 FROM student_co_parents cp WHERE cp.student_id = students.id AND (cp.phone = ANY($2::text[]) OR regexp_replace(cp.phone, '\D', '', 'g') = ANY($2::text[]))))`,
      [p.student_id, variants],
    );
    if (own.rowCount === 0) throw new HttpError(403, "Bu öğrenciye erişim yok");
    const { school_id, photo_url: oldUrl } = own.rows[0];

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
    if (bytes.length < 1000) throw new HttpError(400, "Görüntü çok küçük");

    // Upload to Lovable Cloud Storage via REST (service role)
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const storageHeaders: Record<string, string> = { apikey: SERVICE_KEY };
    if (SERVICE_KEY.split(".").length === 3) storageHeaders.Authorization = `Bearer ${SERVICE_KEY}`;
    const filename = `${p.student_id}-${Date.now()}.jpg`;
    const objectKey = `${school_id}/${filename}`;
    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/student-photos/${objectKey}`,
      {
        method: "POST",
        headers: {
          ...storageHeaders,
          "Content-Type": "image/jpeg",
          "x-upsert": "true",
          "Cache-Control": "31536000",
        },
        body: bytes,
      },
    );
    if (!uploadRes.ok) {
      const t = await uploadRes.text();
      throw new HttpError(500, `Yükleme başarısız: ${t.slice(0, 200)}`);
    }
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/student-photos/${objectKey}`;

    await query("UPDATE students SET photo_url=$2, updated_at=now() WHERE id=$1", [p.student_id, publicUrl]);

    // Best-effort: delete previous photo (don't fail request if cleanup fails)
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

    return { photo_url: publicUrl };
  },
  list_transactions: async (ctx, params) => {
    const p = z.object({
      student_id: z.string().uuid(),
      limit: z.number().int().min(1).max(100).default(50),
    }).parse(params);
    // Ownership check
    const { variants } = phoneVariants(ctx.phone);
    const own = await query<{ id: string }>(
      `SELECT id FROM students WHERE id=$1 AND is_active=TRUE
        AND (parent_phone = ANY($2::text[])
             OR regexp_replace(parent_phone, '\\D', '', 'g') = ANY($2::text[])
             OR EXISTS (SELECT 1 FROM student_co_parents cp WHERE cp.student_id = students.id AND (cp.phone = ANY($2::text[]) OR regexp_replace(cp.phone, '\D', '', 'g') = ANY($2::text[]))))`,
      [p.student_id, variants],
    );
    if (own.rowCount === 0) throw new HttpError(403, "Bu öğrenciye erişim yok");

    // Sales (always shown as debit) UNION refunds (always shown as credit, separate row).
    const tx = await query(
      `WITH sales AS (
         SELECT t.id::text AS id,
                'sale'::text AS kind,
                t.total_amount, t.balance_before, t.balance_after, t.created_at,
                t.payment_method, t.status,
                COALESCE(json_agg(json_build_object(
                  'product_name', ti.product_name,
                  'qty', ti.qty,
                  'unit_price', ti.unit_price,
                  'line_total', ti.line_total
                ) ORDER BY ti.id) FILTER (WHERE ti.id IS NOT NULL), '[]'::json) AS items
           FROM transactions t
           LEFT JOIN transaction_items ti ON ti.transaction_id = t.id
          WHERE t.student_id = $1
          GROUP BY t.id
       ),
       refunds AS (
         SELECT r.id::text AS id,
                'refund'::text AS kind,
                r.amount AS total_amount,
                r.balance_before, r.balance_after, r.created_at,
                'refund'::text AS payment_method,
                r.kind AS status,
                COALESCE(json_agg(json_build_object(
                  'product_name', ri.product_name,
                  'qty', ri.qty,
                  'unit_price', ri.unit_price,
                  'line_total', ri.line_total
                ) ORDER BY ri.id) FILTER (WHERE ri.id IS NOT NULL),
                  json_build_array(json_build_object(
                    'product_name', 'İade (#' || t.tx_no || ')',
                    'qty', 1,
                    'unit_price', r.amount,
                    'line_total', r.amount
                  ))
                ) AS items
           FROM transaction_refunds r
           JOIN transactions t ON t.id = r.transaction_id
           LEFT JOIN transaction_refund_items ri ON ri.refund_id = r.id
          WHERE t.student_id = $1
          GROUP BY r.id, t.tx_no
       )
       SELECT * FROM sales
       UNION ALL
       SELECT * FROM refunds
       ORDER BY created_at DESC
       LIMIT $2`,
      [p.student_id, p.limit],
    );
    return tx.rows;
  },
  // List all active products of the student's school, grouped by category on the client.
  list_school_products: async (ctx, params) => {
    const p = z.object({ student_id: z.string().uuid() }).parse(params);
    const { variants } = phoneVariants(ctx.phone);
    const own = await query<{ school_id: string }>(
      `SELECT school_id FROM students WHERE id=$1 AND is_active=TRUE
        AND (parent_phone = ANY($2::text[])
             OR regexp_replace(parent_phone, '\\D', '', 'g') = ANY($2::text[])
             OR EXISTS (SELECT 1 FROM student_co_parents cp WHERE cp.student_id = students.id AND (cp.phone = ANY($2::text[]) OR regexp_replace(cp.phone, '\D', '', 'g') = ANY($2::text[]))))`,
      [p.student_id, variants],
    );
    if (own.rowCount === 0) throw new HttpError(403, "Bu öğrenciye erişim yok");
    const schoolId = own.rows[0].school_id;
    const r = await query(
      `SELECT p.id, p.name, p.price, p.image_url,
              p.category_id, c.name AS category_name, c.color AS category_color, c.sort_order AS category_sort
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id AND c.is_active = TRUE
        WHERE p.school_id = $1 AND p.is_active = TRUE
        ORDER BY COALESCE(c.sort_order, 9999), c.name NULLS LAST, p.sort_order, p.name`,
      [schoolId],
    );
    return r.rows;
  },
  list_blocked_products: async (ctx, params) => {
    const p = z.object({ student_id: z.string().uuid() }).parse(params);
    const { variants } = phoneVariants(ctx.phone);
    const own = await query<{ id: string }>(
      `SELECT id FROM students WHERE id=$1 AND is_active=TRUE
        AND (parent_phone = ANY($2::text[])
             OR regexp_replace(parent_phone, '\\D', '', 'g') = ANY($2::text[])
             OR EXISTS (SELECT 1 FROM student_co_parents cp WHERE cp.student_id = students.id AND (cp.phone = ANY($2::text[]) OR regexp_replace(cp.phone, '\D', '', 'g') = ANY($2::text[]))))`,
      [p.student_id, variants],
    );
    if (own.rowCount === 0) throw new HttpError(403, "Bu öğrenciye erişim yok");
    const r = await query<{ product_id: string }>(
      "SELECT product_id FROM student_blocked_products WHERE student_id=$1",
      [p.student_id],
    );
    return r.rows.map((x) => x.product_id);
  },
  set_product_block: async (ctx, params) => {
    const p = z.object({
      student_id: z.string().uuid(),
      product_id: z.string().uuid(),
      blocked: z.boolean(),
    }).parse(params);
    const { variants } = phoneVariants(ctx.phone);
    const own = await query<{ school_id: string }>(
      `SELECT school_id FROM students WHERE id=$1 AND is_active=TRUE
        AND (parent_phone = ANY($2::text[])
             OR regexp_replace(parent_phone, '\\D', '', 'g') = ANY($2::text[])
             OR EXISTS (SELECT 1 FROM student_co_parents cp WHERE cp.student_id = students.id AND (cp.phone = ANY($2::text[]) OR regexp_replace(cp.phone, '\D', '', 'g') = ANY($2::text[]))))`,
      [p.student_id, variants],
    );
    if (own.rowCount === 0) throw new HttpError(403, "Bu öğrenciye erişim yok");
    // Ensure product belongs to student's school
    const prod = await query<{ id: string }>(
      "SELECT id FROM products WHERE id=$1 AND school_id=$2 AND is_active=TRUE",
      [p.product_id, own.rows[0].school_id],
    );
    if (prod.rowCount === 0) throw new HttpError(404, "Ürün bulunamadı");
    if (p.blocked) {
      await query(
        `INSERT INTO student_blocked_products (student_id, product_id) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`,
        [p.student_id, p.product_id],
      );
    } else {
      await query(
        "DELETE FROM student_blocked_products WHERE student_id=$1 AND product_id=$2",
        [p.student_id, p.product_id],
      );
    }
    return { ok: true };
  },
  // Donate from the selected student's balance directly into the school's donation pool.
  // No commission is applied. Atomic: deduct student balance & credit pool.
  donate_from_balance: async (ctx, params) => {
    const p = z.object({
      student_id: z.string().uuid(),
      amount: z.number().positive().max(100000),
    }).parse(params);
    // Round to 2 decimals
    const amount = Math.round(p.amount * 100) / 100;
    if (amount < 1) throw new HttpError(400, "Bağış tutarı en az 1 ₺ olmalıdır");

    const { variants } = phoneVariants(ctx.phone);

    const result = await withTransaction(async (client) => {
      // Lock the student row
      const sRes = await client.query(
        `SELECT id, school_id, balance, full_name FROM students
          WHERE id=$1 AND is_active=TRUE
            AND (parent_phone = ANY($2::text[])
                 OR regexp_replace(parent_phone, '\\D', '', 'g') = ANY($2::text[])
             OR EXISTS (SELECT 1 FROM student_co_parents cp WHERE cp.student_id = students.id AND (cp.phone = ANY($2::text[]) OR regexp_replace(cp.phone, '\D', '', 'g') = ANY($2::text[]))))
          FOR UPDATE`,
        [p.student_id, variants],
      );
      if (sRes.rowCount === 0) throw new HttpError(403, "Bu öğrenciye erişim yok");
      const student = sRes.rows[0];
      const balanceBefore = Number(student.balance);
      if (balanceBefore < amount) throw new HttpError(400, "Bakiye yetersiz");
      const balanceAfter = Math.round((balanceBefore - amount) * 100) / 100;

      // Deduct student balance
      await client.query(
        "UPDATE students SET balance=$1, updated_at=now() WHERE id=$2",
        [balanceAfter, student.id],
      );

      // Ensure pool row exists & lock it
      await client.query(
        "INSERT INTO school_donation_pools (school_id) VALUES ($1) ON CONFLICT DO NOTHING",
        [student.school_id],
      );
      const pRes = await client.query(
        "SELECT balance FROM school_donation_pools WHERE school_id=$1 FOR UPDATE",
        [student.school_id],
      );
      const poolBefore = Number(pRes.rows[0].balance);
      const poolAfter = Math.round((poolBefore + amount) * 100) / 100;

      await client.query(
        `UPDATE school_donation_pools
            SET balance=$1, total_received=total_received+$2, updated_at=now()
          WHERE school_id=$3`,
        [poolAfter, amount, student.school_id],
      );

      const dRes = await client.query(
        `INSERT INTO donations (school_id, parent_phone, student_id, amount, source, status)
         VALUES ($1,$2,$3,$4,'balance','completed')
         RETURNING id`,
        [student.school_id, ctx.phone, student.id, amount],
      );

      return {
        donation_id: dRes.rows[0].id,
        student_balance_after: balanceAfter,
        pool_balance_after: poolAfter,
      };
    });

    return { ok: true, ...result };
  },

  // ---------- Co-parents (eş / diğer veli) ----------

  // List all co-parents for a student. Returns the original parent_phone too,
  // so the UI can display the full list. The original parent is marked primary.
  list_co_parents: async (ctx, params) => {
    const p = z.object({ student_id: z.string().uuid() }).parse(params);
    const { variants } = phoneVariants(ctx.phone);
    if (!(await parentOwnsStudent(p.student_id, variants))) {
      throw new HttpError(403, "Bu öğrenciye erişim yok");
    }
    const primary = await query<{ parent_phone: string; parent_full_name: string | null }>(
      "SELECT parent_phone, parent_full_name FROM students WHERE id=$1",
      [p.student_id],
    );
    const co = await query<{ id: string; phone: string; full_name: string | null; created_at: string }>(
      `SELECT id, phone, full_name, created_at
         FROM student_co_parents
        WHERE student_id=$1
        ORDER BY created_at ASC`,
      [p.student_id],
    );
    return {
      primary: primary.rows[0] ?? null,
      co_parents: co.rows,
    };
  },

  // Invite another parent for a student. Sends an SMS with a deep link to /veli-giris.
  // Idempotent: re-inviting the same phone re-sends SMS but does not create a duplicate row.
  invite_co_parent: async (ctx, params) => {
    const p = z.object({
      student_id: z.string().uuid(),
      full_name: z.string().trim().min(2).max(100),
      phone: z.string().trim().min(10).max(20),
    }).parse(params);

    const { canonical: callerCanonical, variants: callerVariants } = phoneVariants(ctx.phone);
    if (!(await parentOwnsStudent(p.student_id, callerVariants))) {
      throw new HttpError(403, "Bu öğrenciye erişim yok");
    }

    const { canonical: inviteeCanonical } = phoneVariants(p.phone);
    if (inviteeCanonical.length < 10) {
      throw new HttpError(400, "Geçersiz telefon numarası");
    }
    if (inviteeCanonical === callerCanonical) {
      throw new HttpError(400, "Kendi numaranızı ekleyemezsiniz");
    }

    // Throttle: max 5 invites from one phone in last 10 minutes
    const recent = await query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM student_co_parents
        WHERE invited_by_phone=$1 AND created_at > now() - interval '10 minutes'`,
      [callerCanonical],
    );
    if ((recent.rows[0]?.c ?? 0) >= 5) {
      throw new HttpError(429, "Çok fazla davet. Lütfen birkaç dakika sonra tekrar deneyin.");
    }

    // Fetch student name for SMS body
    const sRes = await query<{ full_name: string }>(
      "SELECT full_name FROM students WHERE id=$1",
      [p.student_id],
    );
    const studentName = sRes.rows[0]?.full_name ?? "öğrenciniz";

    await query(
      `INSERT INTO student_co_parents (student_id, phone, full_name, invited_by_phone)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (student_id, phone)
       DO UPDATE SET full_name = EXCLUDED.full_name`,
      [p.student_id, inviteeCanonical, p.full_name, callerCanonical],
    );

    const message =
      `KantinPay: ${p.full_name}, ${studentName} icin ek veli olarak eklendiniz. ` +
      `Kendi numaranizla giris yapin: https://dash.kantinpay.com/veli-giris`;
    const sms = await sendSms(inviteeCanonical, message);
    if (!sms.ok) {
      console.error("[parent-api] invite SMS failed", { status: sms.status, raw: sms.raw });
      // Don't roll back the invite — they can still log in. Surface the error to UI.
      throw new HttpError(502, `Davet kaydedildi fakat SMS gönderilemedi (${sms.status})`);
    }
    return { ok: true };
  },

  remove_co_parent: async (ctx, params) => {
    const p = z.object({
      student_id: z.string().uuid(),
      co_parent_id: z.string().uuid(),
    }).parse(params);
    const { variants } = phoneVariants(ctx.phone);
    if (!(await parentOwnsStudent(p.student_id, variants))) {
      throw new HttpError(403, "Bu öğrenciye erişim yok");
    }
    const r = await query(
      "DELETE FROM student_co_parents WHERE id=$1 AND student_id=$2 RETURNING id",
      [p.co_parent_id, p.student_id],
    );
    if (r.rowCount === 0) throw new HttpError(404, "Kayıt bulunamadı");
    return { ok: true };
  },
};

const BodySchema = z.object({
  op: z.string().min(1).max(64),
  params: z.record(z.unknown()).optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { op, params } = parsed.data;

    if (PUBLIC_OPS[op]) {
      const data = await PUBLIC_OPS[op](req, params ?? {});
      return new Response(JSON.stringify({ ok: true, data }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const handler = PROTECTED_OPS[op];
    if (!handler) throw new HttpError(404, `Bilinmeyen işlem: ${op}`);

    const ctx = await authParent(req);
    const data = await handler(ctx, params ?? {});
    return new Response(JSON.stringify({ ok: true, data }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    if (e instanceof HttpError) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("parent-api error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
