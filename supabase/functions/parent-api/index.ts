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
import { query } from "../_shared/external-db.ts";
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
  }>(
    `SELECT s.id, s.school_id, s.full_name, s.class_name, s.student_no,
            s.balance, s.is_active, sc.name AS school_name
       FROM students s
       JOIN schools sc ON sc.id = s.school_id
      WHERE s.is_active = TRUE
        AND (s.parent_phone = ANY($1::text[])
             OR regexp_replace(s.parent_phone, '\\D', '', 'g') = ANY($1::text[]))
      ORDER BY sc.name ASC, s.full_name ASC`,
    [phoneVariantsList],
  );
  return r.rows;
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
      throw new HttpError(502, "SMS gönderilemedi. Lütfen daha sonra tekrar deneyin.");
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
        balance: Number(s.balance),
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
              sc.name AS school_name
         FROM students s
         JOIN schools sc ON sc.id = s.school_id
        WHERE s.id = $1 AND s.is_active = TRUE
          AND (s.parent_phone = ANY($2::text[])
               OR regexp_replace(s.parent_phone, '\\D', '', 'g') = ANY($2::text[]))`,
      [p.student_id, variants],
    );
    if (r.rowCount === 0) throw new HttpError(404, "Öğrenci bulunamadı");
    const s: any = r.rows[0];
    return {
      id: s.id, school_id: s.school_id, school_name: s.school_name,
      full_name: s.full_name, class_name: s.class_name, student_no: s.student_no,
      balance: Number(s.balance),
    };
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
             OR regexp_replace(parent_phone, '\\D', '', 'g') = ANY($2::text[]))`,
      [p.student_id, variants],
    );
    if (own.rowCount === 0) throw new HttpError(403, "Bu öğrenciye erişim yok");

    const tx = await query(
      `SELECT t.id, t.total_amount, t.balance_before, t.balance_after, t.created_at,
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
        ORDER BY t.created_at DESC
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
             OR regexp_replace(parent_phone, '\\D', '', 'g') = ANY($2::text[]))`,
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
             OR regexp_replace(parent_phone, '\\D', '', 'g') = ANY($2::text[]))`,
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
             OR regexp_replace(parent_phone, '\\D', '', 'g') = ANY($2::text[]))`,
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
