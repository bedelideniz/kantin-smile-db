// Cashier API: PIN-based login + POS operations.
// This function does NOT use Supabase Auth. Cashiers authenticate with phone+PIN
// and receive an opaque session token stored in the external DB (cashier_sessions).
// All subsequent requests must send: Authorization: Bearer <token>
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { z } from "npm:zod@3.23.8";
import bcrypt from "npm:bcryptjs@2.4.3";
import { query, withTransaction } from "../_shared/external-db.ts";

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const SESSION_TTL_HOURS = 12;

function normalizePhone(input: string): string {
  const digits = input.replace(/\D+/g, "");
  if (digits.length === 10) return "0" + digits;
  if (digits.length === 12 && digits.startsWith("90")) return "0" + digits.slice(2);
  return digits;
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface CashierContext {
  cashierId: string;
  schoolId: string;
  fullName: string;
  token: string;
}

async function authCashier(req: Request): Promise<CashierContext> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) throw new HttpError(401, "Oturum gerekli");
  const token = authHeader.slice(7);
  const r = await query<{
    cashier_id: string; school_id: string; full_name: string; expires_at: string; is_active: boolean;
  }>(
    `SELECT s.cashier_id, s.school_id, u.full_name, s.expires_at, u.is_active
       FROM cashier_sessions s
       JOIN app_users u ON u.id = s.cashier_id
      WHERE s.token = $1`,
    [token],
  );
  if (r.rowCount === 0) throw new HttpError(401, "Oturum bulunamadı");
  const row = r.rows[0];
  if (!row.is_active) throw new HttpError(403, "Hesap pasif");
  if (new Date(row.expires_at) < new Date()) {
    await query("DELETE FROM cashier_sessions WHERE token=$1", [token]);
    throw new HttpError(401, "Oturum süresi doldu");
  }
  // Touch last_seen (fire & forget)
  query("UPDATE cashier_sessions SET last_seen_at=now() WHERE token=$1", [token]).catch(() => {});
  return { cashierId: row.cashier_id, schoolId: row.school_id, fullName: row.full_name, token };
}

type Handler = (req: Request, params: any) => Promise<unknown>;

const PUBLIC_OPS: Record<string, Handler> = {
  login: async (_req, params) => {
    const p = z.object({
      phone: z.string().trim().min(10).max(20),
      pin: z.string().regex(/^\d{6}$/, "PIN 6 haneli olmalıdır"),
    }).parse(params);
    const phone = normalizePhone(p.phone);
    const r = await query<{
      id: string; school_id: string | null; full_name: string; pin_hash: string | null; is_active: boolean;
    }>(
      `SELECT id, school_id, full_name, pin_hash, is_active
         FROM app_users
        WHERE phone = $1 AND role = 'cashier'`,
      [phone],
    );
    if (r.rowCount === 0 || !r.rows[0].pin_hash) {
      throw new HttpError(401, "Telefon veya PIN hatalı");
    }
    const u = r.rows[0];
    if (!u.is_active) throw new HttpError(403, "Hesabınız pasif. Yöneticinize başvurun.");
    if (!u.school_id) throw new HttpError(403, "Okul atanmamış");
    const ok = await bcrypt.compare(p.pin, u.pin_hash!);
    if (!ok) throw new HttpError(401, "Telefon veya PIN hatalı");

    const token = generateToken();
    const expires = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);
    await query(
      `INSERT INTO cashier_sessions (token, cashier_id, school_id, expires_at)
       VALUES ($1,$2,$3,$4)`,
      [token, u.id, u.school_id, expires.toISOString()],
    );
    await query("UPDATE app_users SET last_login_at=now() WHERE id=$1", [u.id]);
    // Best-effort cleanup of expired sessions
    query("DELETE FROM cashier_sessions WHERE expires_at < now()").catch(() => {});

    // Get school name for context
    const sr = await query<{ name: string }>("SELECT name FROM schools WHERE id=$1", [u.school_id]);
    return {
      token,
      expires_at: expires.toISOString(),
      cashier: { id: u.id, full_name: u.full_name },
      school: { id: u.school_id, name: sr.rows[0]?.name ?? "" },
    };
  },
};

const PROTECTED_OPS: Record<string, (ctx: CashierContext, params: any) => Promise<unknown>> = {
  me: async (ctx) => {
    const sr = await query<{ name: string }>("SELECT name FROM schools WHERE id=$1", [ctx.schoolId]);
    return {
      cashier: { id: ctx.cashierId, full_name: ctx.fullName },
      school: { id: ctx.schoolId, name: sr.rows[0]?.name ?? "" },
    };
  },
  logout: async (ctx) => {
    await query("DELETE FROM cashier_sessions WHERE token=$1", [ctx.token]);
    return { ok: true };
  },
  list_categories: async (ctx) => {
    const r = await query(
      `SELECT id, name, color, sort_order FROM categories
        WHERE school_id=$1 AND is_active=TRUE
        ORDER BY sort_order ASC, name ASC`,
      [ctx.schoolId],
    );
    return r.rows;
  },
  list_products: async (ctx, params) => {
    const p = z.object({ category_id: z.string().uuid().nullable().optional() }).parse(params ?? {});
    const args: any[] = [ctx.schoolId];
    let where = "school_id=$1 AND is_active=TRUE";
    if (p.category_id) { args.push(p.category_id); where += ` AND category_id=$${args.length}`; }
    const r = await query(
      `SELECT id, category_id, name, price, image_url, stock_tracking, stock_qty, sort_order
         FROM products WHERE ${where}
        ORDER BY sort_order ASC, name ASC LIMIT 500`,
      args,
    );
    return r.rows;
  },
  lookup_student: async (ctx, params) => {
    const p = z.object({
      qr_token: z.string().min(1).optional(),
      nfc_uid: z.string().min(1).optional(),
      query: z.string().min(1).optional(),
    }).parse(params ?? {});
    let row;
    if (p.qr_token) {
      // Accept raw uuid or full URL containing it
      const uuid = p.qr_token.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
      if (!uuid) throw new HttpError(400, "Geçersiz QR kod");
      const r = await query(
        `SELECT id, full_name, class_name, student_no, balance, is_active
           FROM students WHERE school_id=$1 AND qr_token=$2`,
        [ctx.schoolId, uuid],
      );
      row = r.rows[0];
    } else if (p.nfc_uid) {
      const r = await query(
        `SELECT id, full_name, class_name, student_no, balance, is_active
           FROM students WHERE school_id=$1 AND nfc_uid=$2`,
        [ctx.schoolId, p.nfc_uid.toUpperCase()],
      );
      row = r.rows[0];
    } else if (p.query) {
      const r = await query(
        `SELECT id, full_name, class_name, student_no, balance, is_active
           FROM students
          WHERE school_id=$1 AND is_active=TRUE
            AND (full_name ILIKE $2 OR student_no ILIKE $2)
          ORDER BY full_name ASC LIMIT 20`,
        [ctx.schoolId, `%${p.query}%`],
      );
      return { matches: r.rows };
    } else {
      throw new HttpError(400, "qr_token, nfc_uid veya query gerekli");
    }
    if (!row) throw new HttpError(404, "Öğrenci bulunamadı");
    if (!row.is_active) throw new HttpError(403, "Öğrenci hesabı pasif");
    return { student: row };
  },
  create_sale: async (ctx, params) => {
    const p = z.object({
      student_id: z.string().uuid(),
      items: z.array(z.object({
        product_id: z.string().uuid(),
        qty: z.number().int().min(1).max(99),
      })).min(1).max(50),
    }).parse(params);

    return await withTransaction(async (client) => {
      // Lock student row
      const sr = await client.query(
        `SELECT id, full_name, balance, is_active
           FROM students WHERE id=$1 AND school_id=$2 FOR UPDATE`,
        [p.student_id, ctx.schoolId],
      );
      if (sr.rowCount === 0) throw new HttpError(404, "Öğrenci bulunamadı");
      const student = sr.rows[0];
      if (!student.is_active) throw new HttpError(403, "Öğrenci pasif");

      // Fetch products with current price
      const ids = p.items.map((i) => i.product_id);
      const pr = await client.query(
        `SELECT id, name, price, stock_tracking, stock_qty, is_active
           FROM products WHERE school_id=$1 AND id = ANY($2::uuid[]) FOR UPDATE`,
        [ctx.schoolId, ids],
      );
      const productMap = new Map<string, any>(pr.rows.map((r: any) => [r.id, r]));

      let total = 0;
      const lines: { product_id: string; product_name: string; unit_price: number; qty: number; line_total: number }[] = [];
      for (const item of p.items) {
        const prod = productMap.get(item.product_id);
        if (!prod || !prod.is_active) throw new HttpError(404, `Ürün bulunamadı: ${item.product_id}`);
        if (prod.stock_tracking && prod.stock_qty < item.qty) {
          throw new HttpError(409, `Stok yetersiz: ${prod.name}`);
        }
        const unit = Number(prod.price);
        const lineTotal = +(unit * item.qty).toFixed(2);
        total = +(total + lineTotal).toFixed(2);
        lines.push({ product_id: prod.id, product_name: prod.name, unit_price: unit, qty: item.qty, line_total: lineTotal });
      }

      const balanceBefore = Number(student.balance);
      if (balanceBefore < total) {
        throw new HttpError(402, `Yetersiz bakiye. Mevcut: ${balanceBefore.toFixed(2)} TL, Tutar: ${total.toFixed(2)} TL`);
      }
      const balanceAfter = +(balanceBefore - total).toFixed(2);

      // Update balance
      await client.query(
        "UPDATE students SET balance=$1, updated_at=now() WHERE id=$2",
        [balanceAfter, student.id],
      );

      // Decrement stock for tracked products
      for (const item of p.items) {
        const prod = productMap.get(item.product_id);
        if (prod.stock_tracking) {
          await client.query(
            "UPDATE products SET stock_qty = stock_qty - $1, updated_at=now() WHERE id=$2",
            [item.qty, prod.id],
          );
        }
      }

      // Insert transaction
      const tx = await client.query(
        `INSERT INTO transactions (school_id, cashier_id, student_id, total_amount, balance_before, balance_after, payment_method, status)
         VALUES ($1,$2,$3,$4,$5,$6,'balance','completed')
         RETURNING id, created_at`,
        [ctx.schoolId, ctx.cashierId, student.id, total, balanceBefore, balanceAfter],
      );
      const txId = tx.rows[0].id;

      for (const l of lines) {
        await client.query(
          `INSERT INTO transaction_items (transaction_id, product_id, product_name, unit_price, qty, line_total)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [txId, l.product_id, l.product_name, l.unit_price, l.qty, l.line_total],
        );
      }

      return {
        transaction_id: txId,
        created_at: tx.rows[0].created_at,
        student: { id: student.id, full_name: student.full_name },
        total_amount: total,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        items: lines,
      };
    });
  },
  recent_sales: async (ctx, params) => {
    const p = z.object({ limit: z.number().int().min(1).max(50).default(10) }).parse(params ?? {});
    const r = await query(
      `SELECT t.id, t.total_amount, t.balance_after, t.created_at,
              s.full_name AS student_name, s.class_name AS student_class
         FROM transactions t
         JOIN students s ON s.id = t.student_id
        WHERE t.cashier_id = $1
        ORDER BY t.created_at DESC LIMIT $2`,
      [ctx.cashierId, p.limit],
    );
    return r.rows;
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

    const ctx = await authCashier(req);
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
    console.error("cashier-api error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
