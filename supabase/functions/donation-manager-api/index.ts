// Donation Manager API: phone+OTP login for school-appointed donation managers,
// view the school's donation pool, distribute pool funds to specific students.
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { z } from "npm:zod@3.23.8";
import { query, withTransaction } from "../_shared/external-db.ts";
import { generateOtp, normalizePhone, sendSms } from "../_shared/sms.ts";

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const SESSION_TTL_HOURS = 24 * 7; // 1 week

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function phoneVariants(raw: string): { canonical: string; variants: string[] } {
  const canonical = normalizePhone(raw);
  const inputDigits = raw.replace(/\D+/g, "");
  const variants = Array.from(new Set([canonical, `0${canonical}`, `90${canonical}`, inputDigits].filter(Boolean)));
  return { canonical, variants };
}

interface Ctx { managerId: string; schoolId: string; token: string; }

async function authManager(req: Request): Promise<Ctx> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) throw new HttpError(401, "Oturum gerekli");
  const token = auth.slice(7);
  const r = await query<{ manager_id: string; school_id: string; expires_at: string }>(
    "SELECT manager_id, school_id, expires_at FROM donation_manager_sessions WHERE token=$1",
    [token],
  );
  if (r.rowCount === 0) throw new HttpError(401, "Oturum bulunamadı");
  if (new Date(r.rows[0].expires_at) < new Date()) {
    await query("DELETE FROM donation_manager_sessions WHERE token=$1", [token]);
    throw new HttpError(401, "Oturum süresi doldu");
  }
  query("UPDATE donation_manager_sessions SET last_seen_at=now() WHERE token=$1", [token]).catch(() => {});
  return { managerId: r.rows[0].manager_id, schoolId: r.rows[0].school_id, token };
}

const PUBLIC_OPS: Record<string, (req: Request, params: any) => Promise<unknown>> = {
  login_request: async (_req, params) => {
    const p = z.object({ phone: z.string().trim().min(10).max(20) }).parse(params);
    const { canonical, variants } = phoneVariants(p.phone);

    const mgr = await query<{ id: string }>(
      `SELECT id FROM donation_managers
        WHERE is_active=TRUE
          AND (phone = ANY($1::text[])
               OR regexp_replace(phone, '\\D', '', 'g') = ANY($1::text[]))
        LIMIT 1`,
      [variants],
    );
    if (mgr.rowCount === 0) {
      throw new HttpError(404, "Bu telefon numarası bağış yöneticisi olarak tanımlı değil.");
    }

    const recent = await query<{ c: number }>(
      "SELECT COUNT(*)::int AS c FROM otp_codes WHERE phone=$1 AND purpose='donation_mgr_login' AND created_at > now() - interval '5 minutes'",
      [canonical],
    );
    if ((recent.rows[0]?.c ?? 0) >= 3) {
      throw new HttpError(429, "Çok fazla istek. Lütfen birkaç dakika sonra tekrar deneyin.");
    }

    const code = generateOtp();
    await query(
      "INSERT INTO otp_codes (phone, code, purpose, expires_at) VALUES ($1,$2,'donation_mgr_login', now() + interval '10 minutes')",
      [canonical, code],
    );
    const sms = await sendSms(canonical, `KantinPay bagis yonetici giris kodunuz: ${code}. Kod 10 dakika gecerlidir.`);
    if (!sms.ok) throw new HttpError(502, "SMS gönderilemedi");
    return { ok: true };
  },
  login_verify: async (_req, params) => {
    const p = z.object({
      phone: z.string().trim().min(10).max(20),
      code: z.string().regex(/^\d{6}$/),
    }).parse(params);
    const { canonical, variants } = phoneVariants(p.phone);

    const otp = await query<{ id: string }>(
      `SELECT id FROM otp_codes
        WHERE phone=$1 AND purpose='donation_mgr_login' AND code=$2
          AND consumed_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1`,
      [canonical, p.code],
    );
    if (otp.rowCount === 0) throw new HttpError(401, "Kod hatalı veya süresi dolmuş");
    await query("UPDATE otp_codes SET consumed_at=now() WHERE id=$1", [otp.rows[0].id]);

    const mgr = await query<{ id: string; school_id: string; full_name: string; school_name: string }>(
      `SELECT m.id, m.school_id, m.full_name, sc.name AS school_name
         FROM donation_managers m
         JOIN schools sc ON sc.id = m.school_id
        WHERE m.is_active=TRUE
          AND (m.phone = ANY($1::text[])
               OR regexp_replace(m.phone, '\\D', '', 'g') = ANY($1::text[]))
        LIMIT 1`,
      [variants],
    );
    if (mgr.rowCount === 0) throw new HttpError(403, "Aktif bağış yöneticisi bulunamadı");
    const m = mgr.rows[0];

    const token = generateToken();
    const expires = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);
    await query(
      "INSERT INTO donation_manager_sessions (token, manager_id, school_id, expires_at) VALUES ($1,$2,$3,$4)",
      [token, m.id, m.school_id, expires.toISOString()],
    );
    await query("UPDATE donation_managers SET last_login_at=now() WHERE id=$1", [m.id]);
    query("DELETE FROM donation_manager_sessions WHERE expires_at < now()").catch(() => {});

    return {
      token,
      expires_at: expires.toISOString(),
      manager: { id: m.id, full_name: m.full_name, school_id: m.school_id, school_name: m.school_name },
    };
  },
};

const PROTECTED_OPS: Record<string, (ctx: Ctx, params: any) => Promise<unknown>> = {
  me: async (ctx) => {
    const r = await query<any>(
      `SELECT m.id, m.full_name, m.phone, m.school_id, sc.name AS school_name,
              COALESCE(p.balance,0) AS pool_balance,
              COALESCE(p.total_received,0) AS total_received,
              COALESCE(p.total_distributed,0) AS total_distributed
         FROM donation_managers m
         JOIN schools sc ON sc.id = m.school_id
         LEFT JOIN school_donation_pools p ON p.school_id = m.school_id
        WHERE m.id=$1`,
      [ctx.managerId],
    );
    if (r.rowCount === 0) throw new HttpError(404, "Yönetici bulunamadı");
    const m = r.rows[0];
    return {
      id: m.id, full_name: m.full_name, phone: m.phone,
      school_id: m.school_id, school_name: m.school_name,
      pool_balance: Number(m.pool_balance),
      total_received: Number(m.total_received),
      total_distributed: Number(m.total_distributed),
    };
  },
  logout: async (ctx) => {
    await query("DELETE FROM donation_manager_sessions WHERE token=$1", [ctx.token]);
    return { ok: true };
  },
  list_students: async (ctx, params) => {
    const p = z.object({ search: z.string().trim().max(100).optional() }).parse(params ?? {});
    const search = p.search ? `%${p.search.toLowerCase()}%` : null;
    const r = await query(
      `SELECT id, full_name, class_name, student_no, balance
         FROM students
        WHERE school_id=$1 AND is_active=TRUE
          AND ($2::text IS NULL
               OR lower(full_name) LIKE $2
               OR lower(coalesce(class_name,'')) LIKE $2
               OR lower(coalesce(student_no,'')) LIKE $2)
        ORDER BY full_name ASC
        LIMIT 200`,
      [ctx.schoolId, search],
    );
    return r.rows;
  },
  list_distributions: async (ctx, params) => {
    const p = z.object({ limit: z.number().int().min(1).max(200).default(50) }).parse(params ?? {});
    const r = await query(
      `SELECT d.id, d.amount, d.created_at, d.note,
              d.student_balance_before, d.student_balance_after,
              d.pool_balance_before, d.pool_balance_after,
              s.full_name AS student_name, s.class_name AS student_class,
              m.full_name AS manager_name
         FROM donation_distributions d
         JOIN students s ON s.id = d.student_id
         LEFT JOIN donation_managers m ON m.id = d.manager_id
        WHERE d.school_id=$1
        ORDER BY d.created_at DESC
        LIMIT $2`,
      [ctx.schoolId, p.limit],
    );
    return r.rows;
  },
  list_donations: async (ctx, params) => {
    const p = z.object({ limit: z.number().int().min(1).max(200).default(50) }).parse(params ?? {});
    const r = await query(
      `SELECT id, parent_phone, student_id, amount, source, status, created_at
         FROM donations
        WHERE school_id=$1 AND status='completed'
        ORDER BY created_at DESC
        LIMIT $2`,
      [ctx.schoolId, p.limit],
    );
    return r.rows;
  },
  // Distribute pool funds to a specific student (atomic).
  distribute: async (ctx, params) => {
    const p = z.object({
      student_id: z.string().uuid(),
      amount: z.number().positive().max(100000),
      note: z.string().trim().max(500).optional(),
    }).parse(params);
    const amount = Math.round(p.amount * 100) / 100;
    if (amount < 1) throw new HttpError(400, "Tutar en az 1 ₺ olmalıdır");

    const result = await withTransaction(async (client) => {
      // Lock pool
      const pRes = await client.query(
        "SELECT balance FROM school_donation_pools WHERE school_id=$1 FOR UPDATE",
        [ctx.schoolId],
      );
      if (pRes.rowCount === 0) throw new HttpError(400, "Bağış havuzu bulunamadı");
      const poolBefore = Number(pRes.rows[0].balance);
      if (poolBefore < amount) throw new HttpError(400, "Havuzda yeterli bakiye yok");

      // Lock student (must belong to same school)
      const sRes = await client.query(
        `SELECT id, balance, full_name FROM students
          WHERE id=$1 AND school_id=$2 AND is_active=TRUE FOR UPDATE`,
        [p.student_id, ctx.schoolId],
      );
      if (sRes.rowCount === 0) throw new HttpError(404, "Öğrenci bulunamadı");
      const balanceBefore = Number(sRes.rows[0].balance);
      const balanceAfter = Math.round((balanceBefore + amount) * 100) / 100;
      const poolAfter = Math.round((poolBefore - amount) * 100) / 100;

      await client.query(
        "UPDATE students SET balance=$1, updated_at=now() WHERE id=$2",
        [balanceAfter, p.student_id],
      );
      await client.query(
        `UPDATE school_donation_pools
            SET balance=$1, total_distributed=total_distributed+$2, updated_at=now()
          WHERE school_id=$3`,
        [poolAfter, amount, ctx.schoolId],
      );
      const dRes = await client.query(
        `INSERT INTO donation_distributions
           (school_id, student_id, manager_id, amount,
            student_balance_before, student_balance_after,
            pool_balance_before, pool_balance_after, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id`,
        [ctx.schoolId, p.student_id, ctx.managerId, amount,
         balanceBefore, balanceAfter, poolBefore, poolAfter, p.note ?? null],
      );

      return {
        distribution_id: dRes.rows[0].id,
        pool_balance_after: poolAfter,
        student_balance_after: balanceAfter,
      };
    });

    return { ok: true, ...result };
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
    const ctx = await authManager(req);
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
    console.error("donation-manager-api error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
