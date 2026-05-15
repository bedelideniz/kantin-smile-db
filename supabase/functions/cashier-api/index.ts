// Cashier API: PIN-based login + POS operations.
// This function does NOT use Supabase Auth. Cashiers authenticate with phone+PIN
// and receive an opaque session token stored in the external DB (cashier_sessions).
// All subsequent requests must send: Authorization: Bearer <token>
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { z } from "npm:zod@3.23.8";
import bcrypt from "npm:bcryptjs@2.4.3";
import { query, withTransaction } from "../_shared/external-db.ts";
import { sendSms } from "../_shared/sms.ts";

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
  list_announcements: async (ctx) => {
    const r = await query(
      `SELECT slot, image_url, title
         FROM canteen_announcements
        WHERE school_id=$1 AND is_active=TRUE
        ORDER BY slot ASC`,
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
      `SELECT id, category_id, name, price, image_url, barcode, stock_tracking, stock_qty, sort_order
         FROM products WHERE ${where}
        ORDER BY sort_order ASC, name ASC LIMIT 500`,
      args,
    );
    return r.rows;
  },
  find_product_by_barcode: async (ctx, params) => {
    const p = z.object({ barcode: z.string().trim().min(4).max(32) }).parse(params ?? {});
    const r = await query(
      `SELECT id, category_id, name, price, image_url, barcode, stock_tracking, stock_qty, sort_order
         FROM products WHERE school_id=$1 AND is_active=TRUE AND barcode=$2 LIMIT 1`,
      [ctx.schoolId, p.barcode],
    );
    if (!r.rows[0]) throw new HttpError(404, "Bu barkoda ait ürün yok");
    return r.rows[0];
  },
  lookup_student: async (ctx, params) => {
    const p = z.object({
      qr_token: z.string().min(1).optional(),
      nfc_uid: z.string().min(1).optional(),
      query: z.string().min(1).optional(),
    }).parse(params ?? {});
    const cols = `id, full_name, class_name, student_no, balance, is_active, card_lost, photo_url,
                  daily_spend_limit,
                  COALESCE((
                    SELECT SUM(t.total_amount - t.refunded_amount)
                      FROM transactions t
                     WHERE t.student_id = students.id
                       AND t.status = 'completed'
                       AND t.created_at >= date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul'
                  ), 0) AS today_spent`;
    let row;
    if (p.qr_token) {
      const uuid = p.qr_token.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
      if (!uuid) throw new HttpError(400, "Geçersiz QR kod");
      const r = await query(
        `SELECT ${cols} FROM students WHERE school_id=$1 AND qr_token=$2`,
        [ctx.schoolId, uuid],
      );
      row = r.rows[0];
    } else if (p.nfc_uid) {
      const r = await query(
        `SELECT ${cols} FROM students WHERE school_id=$1 AND nfc_uid=$2`,
        [ctx.schoolId, p.nfc_uid.toUpperCase()],
      );
      row = r.rows[0];
    } else if (p.query) {
      const r = await query(
        `SELECT ${cols} FROM students
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
  // Cashier marks a previously "lost" card as found again — re-enables sales.
  mark_card_found: async (ctx, params) => {
    const p = z.object({ student_id: z.string().uuid() }).parse(params);
    const r = await query<{ id: string; full_name: string; parent_phone: string | null; school_id: string }>(
      `UPDATE students
          SET card_lost = FALSE,
              card_seized_at = NULL,
              card_seized_note = NULL,
              updated_at = now()
        WHERE id = $1 AND school_id = $2
        RETURNING id, full_name, parent_phone, school_id`,
      [p.student_id, ctx.schoolId],
    );
    if (r.rowCount === 0) throw new HttpError(404, "Öğrenci bulunamadı");
    const s = r.rows[0];
    if (s.parent_phone) {
      await query(
        `INSERT INTO parent_notifications
            (school_id, student_id, parent_phone, kind, title, body)
         VALUES ($1, $2, $3, 'card_found', $4, $5)`,
        [
          s.school_id, s.id, s.parent_phone,
          "Kart tekrar aktif",
          `${s.full_name} adına kayıtlı kart kantin tarafından tekrar aktif edildi.`,
        ],
      );
    }
    return { id: s.id, full_name: s.full_name, card_lost: false };
  },
  // Cashier seizes the physical card from someone misusing it.
  // Detaches NFC from the student, keeps card_lost=TRUE, records a parent notification, sends SMS.
  seize_card: async (ctx, params) => {
    const p = z.object({
      student_id: z.string().uuid(),
      note: z.string().trim().max(300).optional(),
    }).parse(params);

    const sr = await query<{
      id: string; full_name: string; parent_phone: string | null; school_id: string;
    }>(
      `SELECT id, full_name, parent_phone, school_id
         FROM students WHERE id = $1 AND school_id = $2`,
      [p.student_id, ctx.schoolId],
    );
    if (sr.rowCount === 0) throw new HttpError(404, "Öğrenci bulunamadı");
    const student = sr.rows[0];

    // Detach NFC + flag as lost so the card stays disabled even if reassigned by mistake
    await query(
      `UPDATE students
          SET nfc_uid = NULL,
              card_lost = TRUE,
              card_seized_at = now(),
              card_seized_note = $2,
              updated_at = now()
        WHERE id = $1`,
      [p.student_id, p.note ?? null],
    );

    // Resolve school name for the notification body
    const schName = await query<{ name: string }>(
      "SELECT name FROM schools WHERE id = $1",
      [student.school_id],
    );
    const schoolName = schName.rows[0]?.name ?? "Okul";

    const title = "Kartınıza el konuldu";
    const body = p.note && p.note.length > 0
      ? `${student.full_name} adına çıkardığımız kart bir başkasının elinde kullanılmaya çalışıldığı için kantin tarafından alıkonuldu. Kantinci notu: ${p.note}`
      : `${student.full_name} adına çıkardığımız kart bir başkasının elinde kullanılmaya çalışıldığı için kantin tarafından alıkonuldu. Lütfen kantine başvurun.`;

    if (student.parent_phone) {
      await query(
        `INSERT INTO parent_notifications
            (school_id, student_id, parent_phone, kind, title, body, meta)
         VALUES ($1, $2, $3, 'card_seized', $4, $5, $6::jsonb)`,
        [
          student.school_id,
          student.id,
          student.parent_phone,
          title,
          body,
          JSON.stringify({ note: p.note ?? null, school_name: schoolName }),
        ],
      );

      // Best-effort SMS
      try {
        await sendSms(
          student.parent_phone,
          `${schoolName}: ${student.full_name} icin kantine kayitli kart alikonuldu. Detay icin veli panelini kontrol ediniz.`,
        );
      } catch (e) {
        console.warn("seize_card SMS failed", (e as Error).message);
      }
    }

    return { id: student.id, full_name: student.full_name, card_seized: true };
  },
  create_sale: async (ctx, params) => {
    const p = z.object({
      student_id: z.string().uuid(),
      items: z.array(z.object({
        product_id: z.string().uuid(),
        qty: z.number().int().min(1).max(99),
      })).min(1).max(50),
      lookup_at: z.string().datetime().optional(),
    }).parse(params);

    return await withTransaction(async (client) => {
      // Lock student row
      const sr = await client.query(
        `SELECT id, full_name, balance, is_active, card_lost, daily_spend_limit
           FROM students WHERE id=$1 AND school_id=$2 FOR UPDATE`,
        [p.student_id, ctx.schoolId],
      );
      if (sr.rowCount === 0) throw new HttpError(404, "Öğrenci bulunamadı");
      const student = sr.rows[0];
      if (!student.is_active) throw new HttpError(403, "Öğrenci pasif");
      if (student.card_lost) throw new HttpError(423, "Kart kayıp olarak işaretli");

      // Today's spent so far (Europe/Istanbul day boundary), excludes refunds
      const tsRes = await client.query(
        `SELECT COALESCE(SUM(t.total_amount - t.refunded_amount), 0) AS spent
           FROM transactions t
          WHERE t.student_id = $1
            AND t.status = 'completed'
            AND t.created_at >= date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul'`,
        [student.id],
      );
      const todaySpent = Number(tsRes.rows[0].spent);
      const dailyLimit = student.daily_spend_limit == null ? null : Number(student.daily_spend_limit);

      // Parent-set blocked products check
      const blockedRes = await client.query(
        `SELECT sbp.product_id, pr.name
           FROM student_blocked_products sbp
           JOIN products pr ON pr.id = sbp.product_id
          WHERE sbp.student_id = $1 AND sbp.product_id = ANY($2::uuid[])`,
        [p.student_id, p.items.map((i) => i.product_id)],
      );
      if (blockedRes.rowCount > 0) {
        const names = blockedRes.rows.map((r: any) => r.name).join(", ");
        throw new HttpError(403, `Veli tarafından engellenen ürün(ler): ${names}`);
      }

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

      // ===== RECIPE: decrement ingredient stock for any product that has a recipe =====
      // Aggregate consumption per ingredient across all line items.
      const recipeRes = await client.query(
        `SELECT pr.product_id, pr.ingredient_id, pr.qty,
                i.name AS ingredient_name, i.unit, i.stock_qty
           FROM product_recipes pr
           JOIN ingredients i ON i.id = pr.ingredient_id AND i.is_active = TRUE
          WHERE pr.product_id = ANY($1::uuid[])
          ORDER BY pr.ingredient_id`,
        [ids],
      );
      const ingConsumption = new Map<string, { name: string; unit: string; stock: number; consume: number }>();
      for (const row of recipeRes.rows) {
        const item = p.items.find((i) => i.product_id === row.product_id);
        if (!item) continue;
        const need = Number(row.qty) * item.qty;
        const prev = ingConsumption.get(row.ingredient_id);
        if (prev) {
          prev.consume += need;
        } else {
          ingConsumption.set(row.ingredient_id, {
            name: row.ingredient_name,
            unit: row.unit,
            stock: Number(row.stock_qty),
            consume: need,
          });
        }
      }

      const stockWarnings: string[] = [];
      if (ingConsumption.size > 0) {
        // Lock ingredient rows for update
        const lockIds = Array.from(ingConsumption.keys());
        const lr = await client.query(
          "SELECT id, stock_qty FROM ingredients WHERE id = ANY($1::uuid[]) FOR UPDATE",
          [lockIds],
        );
        const stockMap = new Map<string, number>(lr.rows.map((r: any) => [r.id, Number(r.stock_qty)]));
        for (const [ingId, info] of ingConsumption.entries()) {
          const before = stockMap.get(ingId) ?? info.stock;
          const after = +(before - info.consume).toFixed(3);
          if (after < 0) {
            stockWarnings.push(`${info.name}: ${after.toFixed(2)} ${info.unit} (eksiye düştü)`);
          } else if (after < info.consume) {
            // already low — informational only when stock close to zero is handled below
          }
          await client.query(
            "UPDATE ingredients SET stock_qty=$1, updated_at=now() WHERE id=$2",
            [after, ingId],
          );
        }
      }

      // Insert transaction
      const lookupAt = p.lookup_at ?? null;
      const lookupDurationMs = lookupAt ? Math.max(0, Date.now() - new Date(lookupAt).getTime()) : null;
      const tx = await client.query(
        `INSERT INTO transactions (school_id, cashier_id, student_id, total_amount, balance_before, balance_after, payment_method, status, student_lookup_at, lookup_duration_ms)
         VALUES ($1,$2,$3,$4,$5,$6,'balance','completed',$7,$8)
         RETURNING id, tx_no, created_at`,
        [ctx.schoolId, ctx.cashierId, student.id, total, balanceBefore, balanceAfter, lookupAt, lookupDurationMs],
      );
      const txId = tx.rows[0].id;

      for (const l of lines) {
        await client.query(
          `INSERT INTO transaction_items (transaction_id, product_id, product_name, unit_price, qty, line_total)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [txId, l.product_id, l.product_name, l.unit_price, l.qty, l.line_total],
        );
      }

      // Log ingredient movements (linked to the transaction)
      for (const [ingId, info] of ingConsumption.entries()) {
        const newBalance = +(info.stock - info.consume).toFixed(3);
        await client.query(
          `INSERT INTO ingredient_movements (school_id, ingredient_id, delta, reason, transaction_id, balance_after)
           VALUES ($1,$2,$3,'sale',$4,$5)`,
          [ctx.schoolId, ingId, -info.consume, txId, newBalance],
        );
      }

      return {
        transaction_id: txId,
        tx_no: tx.rows[0].tx_no,
        created_at: tx.rows[0].created_at,
        student: { id: student.id, full_name: student.full_name },
        total_amount: total,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        items: lines,
        stock_warnings: stockWarnings,
      };
    });
  },
  recent_sales: async (ctx, params) => {
    const p = z.object({ limit: z.number().int().min(1).max(50).default(10) }).parse(params ?? {});
    const r = await query(
      `SELECT t.id, t.tx_no, t.total_amount, t.balance_after, t.created_at, t.status, t.refunded_amount,
              s.full_name AS student_name, s.class_name AS student_class,
              la.id              AS last_alarm_id,
              la.status          AS last_alarm_status,
              la.reason          AS last_alarm_reason,
              la.resolution_note AS last_alarm_resolution_note,
              la.resolved_at     AS last_alarm_resolved_at,
              la.created_at      AS last_alarm_created_at,
              (la.id IS NOT NULL AND la.status = 'open') AS has_alarm
         FROM transactions t
         JOIN students s ON s.id = t.student_id
         LEFT JOIN LATERAL (
           SELECT a.id, a.status, a.reason, a.resolution_note, a.resolved_at, a.created_at
             FROM transaction_alarms a
            WHERE a.transaction_id = t.id
            ORDER BY a.created_at DESC
            LIMIT 1
         ) la ON TRUE
        WHERE t.cashier_id = $1
        ORDER BY t.created_at DESC LIMIT $2`,
      [ctx.cashierId, p.limit],
    );
    return r.rows;
  },
  canteen_dashboard: async (ctx) => {
    // Aggregate completed sales for this school across common periods + last 30 days breakdown.
    const buckets = await query<{
      today_total: string; today_count: string;
      week_total: string; week_count: string;
      month_total: string; month_count: string;
      year_total: string; year_count: string;
      all_total: string; all_count: string;
    }>(
      `SELECT
         COALESCE(SUM(CASE WHEN created_at >= date_trunc('day', now())                        THEN total_amount - COALESCE(refunded_amount,0) ELSE 0 END),0) AS today_total,
         COUNT(*)    FILTER (WHERE created_at >= date_trunc('day', now()))                                                                               AS today_count,
         COALESCE(SUM(CASE WHEN created_at >= now() - interval '7 days'                       THEN total_amount - COALESCE(refunded_amount,0) ELSE 0 END),0) AS week_total,
         COUNT(*)    FILTER (WHERE created_at >= now() - interval '7 days')                                                                              AS week_count,
         COALESCE(SUM(CASE WHEN created_at >= now() - interval '30 days'                      THEN total_amount - COALESCE(refunded_amount,0) ELSE 0 END),0) AS month_total,
         COUNT(*)    FILTER (WHERE created_at >= now() - interval '30 days')                                                                             AS month_count,
         COALESCE(SUM(CASE WHEN created_at >= date_trunc('year', now())                       THEN total_amount - COALESCE(refunded_amount,0) ELSE 0 END),0) AS year_total,
         COUNT(*)    FILTER (WHERE created_at >= date_trunc('year', now()))                                                                              AS year_count,
         COALESCE(SUM(total_amount - COALESCE(refunded_amount,0)),0) AS all_total,
         COUNT(*) AS all_count
       FROM transactions
       WHERE school_id = $1 AND status = 'completed'`,
      [ctx.schoolId],
    );

    const daily = await query<{ day: string; total: string; count: string }>(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
              COALESCE(SUM(total_amount - COALESCE(refunded_amount,0)),0) AS total,
              COUNT(*) AS count
         FROM transactions
        WHERE school_id = $1 AND status = 'completed'
          AND created_at >= now() - interval '30 days'
        GROUP BY 1 ORDER BY 1 ASC`,
      [ctx.schoolId],
    );

    const b = buckets.rows[0];
    return {
      today:    { total: Number(b.today_total),    count: Number(b.today_count) },
      week:     { total: Number(b.week_total),     count: Number(b.week_count) },
      month:    { total: Number(b.month_total),    count: Number(b.month_count) },
      year:     { total: Number(b.year_total),     count: Number(b.year_count) },
      all_time: { total: Number(b.all_total),      count: Number(b.all_count) },
      daily: daily.rows.map((r) => ({ day: r.day, total: Number(r.total), count: Number(r.count) })),
    };
  },
  low_stock_products: async (ctx, params) => {
    const p = z.object({ threshold: z.number().int().min(0).max(10000).default(20) }).parse(params ?? {});
    const r = await query(
      `SELECT id, name, stock_qty, price, category_id
         FROM products
        WHERE school_id = $1 AND is_active = TRUE AND stock_tracking = TRUE
          AND stock_qty < $2
        ORDER BY stock_qty ASC, name ASC
        LIMIT 200`,
      [ctx.schoolId, p.threshold],
    );
    return { threshold: p.threshold, products: r.rows };
  },
  raise_alarm: async (ctx, params) => {
    const p = z.object({
      transaction_id: z.string().uuid(),
      reason: z.string().trim().max(500).optional(),
    }).parse(params);
    const tr = await query<{ id: string }>(
      "SELECT id FROM transactions WHERE id=$1 AND school_id=$2",
      [p.transaction_id, ctx.schoolId],
    );
    if (tr.rowCount === 0) throw new HttpError(404, "İşlem bulunamadı");
    const existing = await query<{ id: string }>(
      "SELECT id FROM transaction_alarms WHERE transaction_id=$1 AND status='open'",
      [p.transaction_id],
    );
    if (existing.rowCount > 0) {
      return { id: existing.rows[0].id, already_open: true };
    }
    const r = await query<{ id: string }>(
      `INSERT INTO transaction_alarms (transaction_id, school_id, cashier_id, reason)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [p.transaction_id, ctx.schoolId, ctx.cashierId, p.reason ?? null],
    );
    return { id: r.rows[0].id };
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
