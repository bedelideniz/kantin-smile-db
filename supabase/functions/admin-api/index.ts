// Admin API — super_admin staff/permissions management + alarm/refund flows.
// All ops require an authenticated super_admin (with appropriate module grant).
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { z } from "npm:zod@3.23.8";
import { authenticate, HttpError, requireRole } from "../_shared/auth.ts";
import { isDbConnectionError, query, withTransaction } from "../_shared/external-db.ts";

type AppModule =
  | "schools" | "students" | "marketers" | "splashes" | "donations"
  | "payments" | "sms" | "infrastructure" | "alarms" | "staff" | "logs" | "payouts" | "dashboard" | "announcements" | "stories" | "legal" | "push";

const MODULES: AppModule[] = [
  "schools","students","marketers","splashes","donations",
  "payments","sms","infrastructure","alarms","staff","logs","payouts","dashboard","announcements","stories","legal","push",
];

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function isOwner(userId: string): Promise<boolean> {
  const { count } = await admin()
    .from("super_admin_module_permissions")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  // Owner = super_admin with NO permission rows
  return (count ?? 0) === 0;
}

async function requireModule(userId: string, mod: AppModule) {
  // Owner has all
  if (await isOwner(userId)) return;
  const { data, error } = await admin()
    .from("super_admin_module_permissions")
    .select("module")
    .eq("user_id", userId)
    .eq("module", mod)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(403, `Bu modüle yetkiniz yok: ${mod}`);
}

const OPS: Record<string, (ctx: { userId: string }, params: any) => Promise<unknown>> = {
  // ---------- staff management ----------
  list_staff: async (ctx) => {
    await requireModule(ctx.userId, "staff");
    // List all super_admin users + their modules
    const a = admin();
    const { data: roles, error: rerr } = await a
      .from("user_roles")
      .select("user_id, created_at")
      .eq("role", "super_admin");
    if (rerr) throw new HttpError(500, rerr.message);
    const userIds = (roles ?? []).map((r) => r.user_id);
    if (userIds.length === 0) return { staff: [] };

    const { data: perms } = await a
      .from("super_admin_module_permissions")
      .select("user_id, module")
      .in("user_id", userIds);
    const byUser = new Map<string, AppModule[]>();
    for (const p of perms ?? []) {
      const arr = byUser.get(p.user_id) ?? [];
      arr.push(p.module as AppModule);
      byUser.set(p.user_id, arr);
    }

    // Resolve emails via auth admin
    const staff: Array<{ user_id: string; email: string | null; modules: AppModule[]; is_owner: boolean; created_at: string }> = [];
    for (const r of roles ?? []) {
      const { data: u } = await a.auth.admin.getUserById(r.user_id);
      const mods = byUser.get(r.user_id) ?? [];
      staff.push({
        user_id: r.user_id,
        email: u?.user?.email ?? null,
        modules: mods,
        is_owner: mods.length === 0,
        created_at: r.created_at,
      });
    }
    return { staff };
  },
  create_staff: async (ctx, params) => {
    await requireModule(ctx.userId, "staff");
    const p = z.object({
      email: z.string().email(),
      password: z.string().min(8).max(72),
      modules: z.array(z.enum(MODULES as [string, ...string[]])).min(1),
    }).parse(params);

    const a = admin();
    // Create auth user (email confirmed)
    const { data: created, error: cerr } = await a.auth.admin.createUser({
      email: p.email,
      password: p.password,
      email_confirm: true,
    });
    if (cerr || !created.user) throw new HttpError(400, cerr?.message ?? "Kullanıcı oluşturulamadı");
    const newUserId = created.user.id;

    // Assign super_admin role
    const { error: rerr } = await a.from("user_roles").insert({ user_id: newUserId, role: "super_admin" });
    if (rerr) throw new HttpError(500, rerr.message);

    // Insert module grants
    const rows = p.modules.map((m) => ({ user_id: newUserId, module: m, granted_by: ctx.userId }));
    const { error: perr } = await a.from("super_admin_module_permissions").insert(rows);
    if (perr) throw new HttpError(500, perr.message);

    return { user_id: newUserId, email: p.email, modules: p.modules };
  },
  update_staff_modules: async (ctx, params) => {
    await requireModule(ctx.userId, "staff");
    const p = z.object({
      user_id: z.string().uuid(),
      modules: z.array(z.enum(MODULES as [string, ...string[]])).min(1),
    }).parse(params);
    if (p.user_id === ctx.userId) throw new HttpError(400, "Kendi yetkilerinizi düzenleyemezsiniz");
    const a = admin();
    // Prevent editing owner accounts (the unrestricted ones)
    if (await isOwner(p.user_id)) throw new HttpError(403, "Sahip hesabı düzenlenemez");

    await a.from("super_admin_module_permissions").delete().eq("user_id", p.user_id);
    const rows = p.modules.map((m) => ({ user_id: p.user_id, module: m, granted_by: ctx.userId }));
    const { error } = await a.from("super_admin_module_permissions").insert(rows);
    if (error) throw new HttpError(500, error.message);
    return { ok: true };
  },
  delete_staff: async (ctx, params) => {
    await requireModule(ctx.userId, "staff");
    const p = z.object({ user_id: z.string().uuid() }).parse(params);
    if (p.user_id === ctx.userId) throw new HttpError(400, "Kendinizi silemezsiniz");
    if (await isOwner(p.user_id)) throw new HttpError(403, "Sahip hesabı silinemez");
    const a = admin();
    await a.from("super_admin_module_permissions").delete().eq("user_id", p.user_id);
    await a.from("user_roles").delete().eq("user_id", p.user_id).eq("role", "super_admin");
    await a.auth.admin.deleteUser(p.user_id);
    return { ok: true };
  },

  // ---------- alarms ----------
  list_alarms: async (ctx, params) => {
    await requireModule(ctx.userId, "alarms");
    const p = z.object({
      status: z.enum(["open","resolved","rejected","all"]).default("open"),
      limit: z.number().int().min(1).max(200).default(100),
    }).parse(params ?? {});
    const args: any[] = [p.limit];
    let where = "1=1";
    if (p.status !== "all") { args.unshift(p.status); where = "a.status = $1"; }
    const r = await query(
      `SELECT a.id, a.transaction_id, a.school_id, a.reason, a.status,
              a.resolved_at, a.resolution_note, a.created_at,
              t.tx_no, t.total_amount, t.refunded_amount, t.created_at AS tx_created_at,
              s.full_name AS student_name, s.class_name AS student_class, s.student_no,
              u.full_name AS cashier_name,
              sch.name AS school_name
         FROM transaction_alarms a
         JOIN transactions t ON t.id = a.transaction_id
         JOIN students s ON s.id = t.student_id
         JOIN app_users u ON u.id = a.cashier_id
         JOIN schools sch ON sch.id = a.school_id
        WHERE ${where}
        ORDER BY a.created_at DESC
        LIMIT $${args.length}`,
      args,
    );
    return { alarms: r.rows };
  },
  count_open_alarms: async (ctx) => {
    await requireModule(ctx.userId, "alarms");
    const r = await query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
         FROM transaction_alarms
        WHERE status='open'`,
    );
    return { count: Number(r.rows[0]?.c ?? 0) };
  },
  alarm_detail: async (ctx, params) => {
    await requireModule(ctx.userId, "alarms");
    const p = z.object({ alarm_id: z.string().uuid() }).parse(params);
    const ar = await query<any>(
      `SELECT a.id, a.transaction_id, a.school_id, a.reason, a.status,
              a.resolved_at, a.resolution_note, a.created_at,
              t.tx_no, t.total_amount, t.refunded_amount, t.balance_before, t.balance_after, t.created_at AS tx_created_at,
              s.id AS student_id, s.full_name AS student_name, s.class_name, s.student_no, s.balance AS student_balance,
              u.full_name AS cashier_name,
              sch.name AS school_name
         FROM transaction_alarms a
         JOIN transactions t ON t.id = a.transaction_id
         JOIN students s ON s.id = t.student_id
         JOIN app_users u ON u.id = a.cashier_id
         JOIN schools sch ON sch.id = a.school_id
        WHERE a.id=$1`,
      [p.alarm_id],
    );
    if (ar.rowCount === 0) throw new HttpError(404, "Alarm bulunamadı");
    const alarm = ar.rows[0];
    const items = await query(
      `SELECT id, product_name, unit_price, qty, line_total
         FROM transaction_items WHERE transaction_id=$1`,
      [alarm.transaction_id],
    );
    const refunds = await query(
      `SELECT id, amount, kind, note, created_at
         FROM transaction_refunds WHERE transaction_id=$1
        ORDER BY created_at DESC`,
      [alarm.transaction_id],
    );
    return { alarm, items: items.rows, refunds: refunds.rows };
  },
  reject_alarm: async (ctx, params) => {
    await requireModule(ctx.userId, "alarms");
    const p = z.object({
      alarm_id: z.string().uuid(),
      note: z.string().trim().max(500).optional(),
    }).parse(params);
    const r = await query(
      `UPDATE transaction_alarms
          SET status='rejected', resolved_at=now(), resolved_by_admin=$2, resolution_note=$3
        WHERE id=$1 AND status='open'`,
      [p.alarm_id, ctx.userId, p.note ?? null],
    );
    if (r.rowCount === 0) throw new HttpError(409, "Alarm zaten kapalı");
    return { ok: true };
  },
  refund_transaction: async (ctx, params) => {
    await requireModule(ctx.userId, "alarms");
    const p = z.object({
      alarm_id: z.string().uuid().optional(),
      transaction_id: z.string().uuid(),
      kind: z.enum(["full","partial"]),
      // For partial refunds: list of items with qty to refund
      items: z.array(z.object({
        transaction_item_id: z.string().uuid(),
        qty: z.number().int().min(1),
      })).optional(),
      note: z.string().trim().max(500).optional(),
    }).parse(params);

    return await withTransaction(async (client) => {
      const tr = await client.query(
        `SELECT id, school_id, student_id, total_amount, refunded_amount, status
           FROM transactions WHERE id=$1 FOR UPDATE`,
        [p.transaction_id],
      );
      if (tr.rowCount === 0) throw new HttpError(404, "İşlem bulunamadı");
      const tx = tr.rows[0];

      let amount = 0;
      const refundItems: { tii: string; name: string; unit: number; qty: number; line: number }[] = [];

      if (p.kind === "full") {
        amount = +(Number(tx.total_amount) - Number(tx.refunded_amount)).toFixed(2);
        if (amount <= 0) throw new HttpError(409, "İade edilecek tutar yok");
      } else {
        if (!p.items || p.items.length === 0) throw new HttpError(400, "Kısmi iade için kalem seçin");
        const ids = p.items.map((i) => i.transaction_item_id);
        const ir = await client.query(
          `SELECT id, product_name, unit_price, qty FROM transaction_items
            WHERE transaction_id=$1 AND id = ANY($2::uuid[])`,
          [p.transaction_id, ids],
        );
        if (ir.rowCount !== p.items.length) throw new HttpError(400, "Bazı kalemler bulunamadı");
        const map = new Map<string, any>(ir.rows.map((r: any) => [r.id, r]));
        for (const it of p.items) {
          const row = map.get(it.transaction_item_id);
          if (it.qty > row.qty) throw new HttpError(400, `${row.product_name}: en fazla ${row.qty} adet iade edilebilir`);
          const line = +(Number(row.unit_price) * it.qty).toFixed(2);
          amount = +(amount + line).toFixed(2);
          refundItems.push({
            tii: row.id, name: row.product_name, unit: Number(row.unit_price), qty: it.qty, line,
          });
        }
        const remaining = +(Number(tx.total_amount) - Number(tx.refunded_amount)).toFixed(2);
        if (amount > remaining) throw new HttpError(409, "İade tutarı kalan tutarı aşıyor");
      }

      // Lock student & credit balance
      const sr = await client.query(
        "SELECT id, balance FROM students WHERE id=$1 FOR UPDATE",
        [tx.student_id],
      );
      if (sr.rowCount === 0) throw new HttpError(404, "Öğrenci bulunamadı");
      const balanceBefore = Number(sr.rows[0].balance);
      const balanceAfter = +(balanceBefore + amount).toFixed(2);

      await client.query("UPDATE students SET balance=$1, updated_at=now() WHERE id=$2", [balanceAfter, tx.student_id]);

      const newRefunded = +(Number(tx.refunded_amount) + amount).toFixed(2);
      const newStatus = newRefunded >= Number(tx.total_amount) ? "refunded" : tx.status;
      await client.query(
        "UPDATE transactions SET refunded_amount=$1, status=$2 WHERE id=$3",
        [newRefunded, newStatus, p.transaction_id],
      );

      const ref = await client.query(
        `INSERT INTO transaction_refunds
           (transaction_id, alarm_id, school_id, student_id, amount, kind,
            balance_before, balance_after, refunded_by_admin, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id`,
        [p.transaction_id, p.alarm_id ?? null, tx.school_id, tx.student_id, amount, p.kind,
         balanceBefore, balanceAfter, ctx.userId, p.note ?? null],
      );
      const refundId = ref.rows[0].id;

      for (const ri of refundItems) {
        await client.query(
          `INSERT INTO transaction_refund_items
             (refund_id, transaction_item_id, product_name, unit_price, qty, line_total)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [refundId, ri.tii, ri.name, ri.unit, ri.qty, ri.line],
        );
      }

      // Resolve the alarm if provided
      if (p.alarm_id) {
        await client.query(
          `UPDATE transaction_alarms
              SET status='resolved', resolved_at=now(), resolved_by_admin=$2, resolution_note=$3
            WHERE id=$1`,
          [p.alarm_id, ctx.userId, p.note ?? null],
        );
      }

      return { refund_id: refundId, amount, balance_after: balanceAfter, kind: p.kind };
    });
  },

  // ---------- transaction logs ----------
  list_schools_for_logs: async (ctx) => {
    await requireModule(ctx.userId, "logs");
    const r = await query<{ id: string; name: string }>(
      "SELECT id, name FROM schools ORDER BY name ASC",
    );
    return { schools: r.rows };
  },
  list_sale_logs: async (ctx, params) => {
    await requireModule(ctx.userId, "logs");
    const p = z.object({
      school_id: z.string().uuid(),
      search: z.string().trim().max(100).optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      limit: z.number().int().min(1).max(500).default(200),
    }).parse(params);

    const args: any[] = [p.school_id];
    let where = "t.school_id = $1";
    if (p.from) { args.push(p.from); where += ` AND t.created_at >= $${args.length}`; }
    if (p.to)   { args.push(p.to);   where += ` AND t.created_at <= $${args.length}`; }
    if (p.search) {
      args.push(`%${p.search}%`);
      const i = args.length;
      const asNum = Number(p.search);
      if (Number.isInteger(asNum) && asNum > 0) {
        args.push(asNum);
        where += ` AND (s.full_name ILIKE $${i} OR s.student_no ILIKE $${i} OR s.class_name ILIKE $${i} OR u.full_name ILIKE $${i} OR t.tx_no = $${args.length})`;
      } else {
        where += ` AND (s.full_name ILIKE $${i} OR s.student_no ILIKE $${i} OR s.class_name ILIKE $${i} OR u.full_name ILIKE $${i})`;
      }
    }
    args.push(p.limit);

    const r = await query(
      `SELECT t.id, t.tx_no, t.total_amount, t.balance_before, t.balance_after,
              t.refunded_amount, t.status, t.created_at,
              t.student_lookup_at, t.lookup_duration_ms,
              s.full_name AS student_name, s.class_name AS student_class, s.student_no,
              u.full_name AS cashier_name,
              EXISTS(SELECT 1 FROM transaction_alarms a WHERE a.transaction_id = t.id) AS has_alarm
         FROM transactions t
         JOIN students s ON s.id = t.student_id
         JOIN app_users u ON u.id = t.cashier_id
        WHERE ${where}
        ORDER BY t.created_at DESC
        LIMIT $${args.length}`,
      args,
    );
    return { logs: r.rows };
  },

  // ---------- canteen payouts ----------
  // Recompute (upsert) daily payout rows from transactions for a given school
  // and date range. Idempotent. Excludes refunded amounts. Snapshots
  // commission_rate and payout_hold_days from the school at time of compute.
  recompute_canteen_payouts: async (ctx, params) => {
    await requireModule(ctx.userId, "payouts");
    const p = z.object({
      school_id: z.string().uuid().optional(),
      from: z.string().optional(), // YYYY-MM-DD
      to: z.string().optional(),   // YYYY-MM-DD (inclusive)
    }).parse(params ?? {});
    const args: any[] = [];
    let where = "1=1";
    if (p.school_id) { args.push(p.school_id); where += ` AND s.id = $${args.length}`; }
    if (p.from)      { args.push(p.from);      where += ` AND (t.created_at AT TIME ZONE 'Europe/Istanbul')::date >= $${args.length}::date`; }
    if (p.to)        { args.push(p.to);        where += ` AND (t.created_at AT TIME ZONE 'Europe/Istanbul')::date <= $${args.length}::date`; }

    // Aggregate per (school, sale_date in Europe/Istanbul)
    const sql = `
      WITH agg AS (
        SELECT
          s.id  AS school_id,
          s.commission_rate,
          s.payout_hold_days,
          (t.created_at AT TIME ZONE 'Europe/Istanbul')::date AS sale_date,
          COALESCE(SUM(t.total_amount),0)    AS gross,
          COALESCE(SUM(t.refunded_amount),0) AS refunded
        FROM transactions t
        JOIN schools s ON s.id = t.school_id
        WHERE ${where}
        GROUP BY s.id, s.commission_rate, s.payout_hold_days, sale_date
      )
      INSERT INTO canteen_payouts
        (school_id, sale_date, gross_amount, refunded_amount, net_sales,
         commission_rate, commission_amount, payout_amount, hold_days, payable_at, status)
      SELECT
        a.school_id, a.sale_date, a.gross, a.refunded, (a.gross - a.refunded),
        a.commission_rate,
        ROUND((a.gross - a.refunded) * a.commission_rate, 2),
        ROUND((a.gross - a.refunded) - ((a.gross - a.refunded) * a.commission_rate), 2),
        a.payout_hold_days,
        ((a.sale_date + (a.payout_hold_days || ' days')::interval)::timestamp AT TIME ZONE 'Europe/Istanbul')
          + interval '1 minute',
        CASE WHEN now() >= ((a.sale_date + (a.payout_hold_days || ' days')::interval)::timestamp AT TIME ZONE 'Europe/Istanbul') + interval '1 minute'
             THEN 'payable' ELSE 'pending' END
      FROM agg a
      ON CONFLICT (school_id, sale_date) DO UPDATE SET
        gross_amount      = EXCLUDED.gross_amount,
        refunded_amount   = EXCLUDED.refunded_amount,
        net_sales         = EXCLUDED.net_sales,
        commission_rate   = EXCLUDED.commission_rate,
        commission_amount = EXCLUDED.commission_amount,
        payout_amount     = EXCLUDED.payout_amount,
        hold_days         = EXCLUDED.hold_days,
        payable_at        = EXCLUDED.payable_at,
        status            = CASE
          WHEN canteen_payouts.status = 'paid' THEN 'paid'
          WHEN canteen_payouts.status = 'cancelled' THEN 'cancelled'
          ELSE EXCLUDED.status
        END,
        updated_at        = now()
      RETURNING school_id, sale_date
    `;
    const r = await query(sql, args);

    // Also bump any pending rows whose payable_at has arrived to 'payable'
    await query(
      `UPDATE canteen_payouts
          SET status='payable', updated_at=now()
        WHERE status='pending' AND now() >= payable_at`,
    );
    return { upserted: r.rowCount };
  },

  list_canteen_payouts: async (ctx, params) => {
    await requireModule(ctx.userId, "payouts");
    const p = z.object({
      school_id: z.string().uuid().optional(),
      status: z.enum(["pending","payable","paid","cancelled","all","unpaid"]).default("unpaid"),
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.number().int().min(1).max(1000).default(500),
    }).parse(params ?? {});

    // Auto-promote pending->payable on read
    await query(
      `UPDATE canteen_payouts
          SET status='payable', updated_at=now()
        WHERE status='pending' AND now() >= payable_at`,
    );

    const args: any[] = [];
    let where = "1=1";
    if (p.school_id) { args.push(p.school_id); where += ` AND cp.school_id = $${args.length}`; }
    if (p.status === "unpaid")      where += ` AND cp.status IN ('pending','payable')`;
    else if (p.status !== "all")    { args.push(p.status); where += ` AND cp.status = $${args.length}`; }
    if (p.from) { args.push(p.from); where += ` AND cp.sale_date >= $${args.length}::date`; }
    if (p.to)   { args.push(p.to);   where += ` AND cp.sale_date <= $${args.length}::date`; }
    args.push(p.limit);

    const r = await query(
      `SELECT cp.id, cp.school_id, sch.name AS school_name,
              cp.sale_date, cp.gross_amount, cp.refunded_amount, cp.net_sales,
              cp.commission_rate, cp.commission_amount, cp.payout_amount,
              cp.hold_days, cp.payable_at, cp.status, cp.paid_at, cp.paid_reference, cp.note
         FROM canteen_payouts cp
         JOIN schools sch ON sch.id = cp.school_id
        WHERE ${where}
        ORDER BY cp.sale_date DESC, sch.name ASC
        LIMIT $${args.length}`,
      args,
    );

    // Summary totals over current filter
    const sumArgs = args.slice(0, -1);
    const sumR = await query<any>(
      `SELECT
          COALESCE(SUM(CASE WHEN cp.status='payable' THEN cp.payout_amount ELSE 0 END),0)::text AS payable_total,
          COALESCE(SUM(CASE WHEN cp.status='pending' THEN cp.payout_amount ELSE 0 END),0)::text AS pending_total,
          COALESCE(SUM(CASE WHEN cp.status='paid'    THEN cp.payout_amount ELSE 0 END),0)::text AS paid_total,
          COALESCE(SUM(cp.commission_amount),0)::text AS commission_total
         FROM canteen_payouts cp
         JOIN schools sch ON sch.id = cp.school_id
        WHERE ${where}`,
      sumArgs,
    );
    return { rows: r.rows, summary: sumR.rows[0] };
  },

  mark_canteen_payout_paid: async (ctx, params) => {
    await requireModule(ctx.userId, "payouts");
    const p = z.object({
      id: z.string().uuid(),
      reference: z.string().trim().max(200).optional(),
      note: z.string().trim().max(500).optional(),
    }).parse(params);
    const r = await query(
      `UPDATE canteen_payouts
          SET status='paid', paid_at=now(), paid_by=$2, paid_reference=$3, note=COALESCE($4, note), updated_at=now()
        WHERE id=$1 AND status IN ('pending','payable')`,
      [p.id, ctx.userId, p.reference ?? null, p.note ?? null],
    );
    if (r.rowCount === 0) throw new HttpError(409, "Bu satır zaten ödenmiş veya iptal edilmiş");
    return { ok: true };
  },

  mark_canteen_payout_unpaid: async (ctx, params) => {
    await requireModule(ctx.userId, "payouts");
    const p = z.object({ id: z.string().uuid() }).parse(params);
    const r = await query(
      `UPDATE canteen_payouts
          SET status = CASE WHEN now() >= payable_at THEN 'payable' ELSE 'pending' END,
              paid_at=NULL, paid_by=NULL, paid_reference=NULL, updated_at=now()
        WHERE id=$1 AND status='paid'`,
      [p.id],
    );
    if (r.rowCount === 0) throw new HttpError(409, "Satır ödenmiş değil");
    return { ok: true };
  },

  list_payout_schools: async (ctx) => {
    await requireModule(ctx.userId, "payouts");
    const r = await query(
      `SELECT id, name, commission_rate, payout_hold_days
         FROM schools WHERE is_active = TRUE ORDER BY name ASC`,
    );
    return { schools: r.rows };
  },

  // ---------- TV Dashboard ----------
  dashboard_stats: async (ctx) => {
    await requireModule(ctx.userId, "dashboard");
    const sql = `
      WITH ranges AS (
        SELECT
          (now() AT TIME ZONE 'Europe/Istanbul')::date AS today,
          ((now() AT TIME ZONE 'Europe/Istanbul')::date - interval '6 days')::date AS d7,
          ((now() AT TIME ZONE 'Europe/Istanbul')::date - interval '29 days')::date AS d30
      ),
      tu AS (
        SELECT
          COALESCE(SUM(CASE WHEN (created_at AT TIME ZONE 'Europe/Istanbul')::date = (SELECT today FROM ranges) THEN amount END),0) AS d,
          COALESCE(SUM(CASE WHEN (created_at AT TIME ZONE 'Europe/Istanbul')::date >= (SELECT d7    FROM ranges) THEN amount END),0) AS w,
          COALESCE(SUM(CASE WHEN (created_at AT TIME ZONE 'Europe/Istanbul')::date >= (SELECT d30   FROM ranges) THEN amount END),0) AS m,
          COALESCE(SUM(amount),0) AS t
        FROM wallet_topups
      ),
      cp AS (
        SELECT
          COALESCE(SUM(CASE WHEN status='paid' AND (paid_at AT TIME ZONE 'Europe/Istanbul')::date = (SELECT today FROM ranges) THEN payout_amount END),0) AS d,
          COALESCE(SUM(CASE WHEN status='paid' AND (paid_at AT TIME ZONE 'Europe/Istanbul')::date >= (SELECT d7    FROM ranges) THEN payout_amount END),0) AS w,
          COALESCE(SUM(CASE WHEN status='paid' AND (paid_at AT TIME ZONE 'Europe/Istanbul')::date >= (SELECT d30   FROM ranges) THEN payout_amount END),0) AS m,
          COALESCE(SUM(CASE WHEN status='paid' THEN payout_amount END),0) AS t,
          COALESCE(SUM(CASE WHEN status IN ('pending','payable') THEN payout_amount END),0) AS owed
        FROM canteen_payouts
      ),
      dn AS (
        SELECT
          COALESCE(SUM(CASE WHEN (created_at AT TIME ZONE 'Europe/Istanbul')::date = (SELECT today FROM ranges) THEN amount END),0) AS d,
          COALESCE(SUM(CASE WHEN (created_at AT TIME ZONE 'Europe/Istanbul')::date >= (SELECT d7    FROM ranges) THEN amount END),0) AS w,
          COALESCE(SUM(CASE WHEN (created_at AT TIME ZONE 'Europe/Istanbul')::date >= (SELECT d30   FROM ranges) THEN amount END),0) AS m,
          COALESCE(SUM(amount),0) AS t
        FROM donations WHERE status='completed'
      ),
      dd AS (
        SELECT
          COALESCE(SUM(CASE WHEN (created_at AT TIME ZONE 'Europe/Istanbul')::date = (SELECT today FROM ranges) THEN amount END),0) AS d,
          COALESCE(SUM(CASE WHEN (created_at AT TIME ZONE 'Europe/Istanbul')::date >= (SELECT d7    FROM ranges) THEN amount END),0) AS w,
          COALESCE(SUM(CASE WHEN (created_at AT TIME ZONE 'Europe/Istanbul')::date >= (SELECT d30   FROM ranges) THEN amount END),0) AS m,
          COALESCE(SUM(amount),0) AS t
        FROM donation_distributions
      ),
      bal AS (
        SELECT COALESCE(SUM(balance),0) AS student_balances FROM students
      ),
      pool AS (
        SELECT COALESCE(SUM(balance),0) AS pool_balances FROM school_donation_pools
      )
      SELECT
        json_build_object(
          'topups',     json_build_object('today',tu.d,'week',tu.w,'month',tu.m,'total',tu.t),
          'payouts',    json_build_object('today',cp.d,'week',cp.w,'month',cp.m,'total',cp.t,'owed',cp.owed),
          'donations',  json_build_object('today',dn.d,'week',dn.w,'month',dn.m,'total',dn.t),
          'distributions', json_build_object('today',dd.d,'week',dd.w,'month',dd.m,'total',dd.t),
          'pool_balance', (tu.t - cp.t - dd.t),
          'student_balances', bal.student_balances,
          'donation_pool_balances', pool.pool_balances
        ) AS payload
      FROM tu, cp, dn, dd, bal, pool
    `;
    const r = await query<{ payload: any }>(sql);
    return r.rows[0]?.payload ?? {};
  },

  sms_balance: async (ctx) => {
    await requireModule(ctx.userId, "dashboard");
    const cfg = await query<{ username: string | null; password: string | null; is_active: boolean }>(
      "SELECT username, password, is_active FROM netgsm_config WHERE id = 1",
    );
    const c = cfg.rows[0];
    if (!c || !c.username || !c.password) {
      return { ok: false, error: "NetGSM yapılandırılmamış", credit: null, amount: null };
    }
    async function fetchBalance(stip: 1 | 2): Promise<{ ok: boolean; value: number | null; raw: string }> {
      let text = "";
      let status = 0;
      try {
        const res = await fetch("https://api.netgsm.com.tr/balance", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ usercode: c.username, password: c.password, stip }),
        });
        status = res.status;
        text = (await res.text()).trim();
      } catch (e) {
        return { ok: false, value: null, raw: `fetch_error: ${e instanceof Error ? e.message : String(e)}` };
      }
      const raw = `[${status}] ${text}`;
      try {
        const j = JSON.parse(text);
        const b = j?.balance;
        if (Array.isArray(b)) {
          const total = b.reduce((s: number, x: any) => s + (Number(x?.amount) || 0), 0);
          return { ok: true, value: total, raw };
        }
        if (typeof b === "string" || typeof b === "number") {
          const n = Number(String(b).replace(",", "."));
          return { ok: Number.isFinite(n), value: Number.isFinite(n) ? n : null, raw };
        }
        return { ok: false, value: null, raw };
      } catch {
        const parts = text.split(/\s+/);
        if (parts[0] === "00" && parts[1]) {
          const n = Number(parts[1].replace(",", "."));
          return { ok: Number.isFinite(n), value: Number.isFinite(n) ? n : null, raw };
        }
        return { ok: false, value: null, raw };
      }
    }
    try {
      const [credit, amount] = await Promise.all([fetchBalance(2), fetchBalance(1)]);
      return {
        ok: credit.ok || amount.ok,
        credit: credit.value,
        amount: amount.value,
        raw_credit: credit.raw,
        raw_amount: amount.raw,
        is_active: c.is_active,
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), credit: null, amount: null };
    }
  },

  recent_topups: async (ctx, params) => {
    await requireModule(ctx.userId, "dashboard");
    const limit = Math.min(Math.max(Number(params?.limit ?? 30), 1), 100);
    const r = await query<{ id: string; school_name: string; amount: string; created_at: string }>(
      `SELECT t.id, s.name AS school_name, t.amount, t.created_at
         FROM wallet_topups t
         JOIN schools s ON s.id = t.school_id
        ORDER BY t.created_at DESC
        LIMIT $1`,
      [limit],
    );
    return { topups: r.rows };
  },

  dashboard_home: async (ctx, params) => {
    await requireModule(ctx.userId, "dashboard");
    const limit = Math.min(Math.max(Number(params?.limit ?? 12), 1), 100);
    const sql = `
      WITH ranges AS (
        SELECT
          (now() AT TIME ZONE 'Europe/Istanbul')::date AS today,
          ((now() AT TIME ZONE 'Europe/Istanbul')::date - interval '6 days')::date AS d7,
          ((now() AT TIME ZONE 'Europe/Istanbul')::date - interval '29 days')::date AS d30
      ),
      tu AS (
        SELECT
          COALESCE(SUM(CASE WHEN (created_at AT TIME ZONE 'Europe/Istanbul')::date = (SELECT today FROM ranges) THEN amount END),0) AS d,
          COALESCE(SUM(CASE WHEN (created_at AT TIME ZONE 'Europe/Istanbul')::date >= (SELECT d7    FROM ranges) THEN amount END),0) AS w,
          COALESCE(SUM(CASE WHEN (created_at AT TIME ZONE 'Europe/Istanbul')::date >= (SELECT d30   FROM ranges) THEN amount END),0) AS m,
          COALESCE(SUM(amount),0) AS t
        FROM wallet_topups
      ),
      cp AS (
        SELECT
          COALESCE(SUM(CASE WHEN status='paid' AND (paid_at AT TIME ZONE 'Europe/Istanbul')::date = (SELECT today FROM ranges) THEN payout_amount END),0) AS d,
          COALESCE(SUM(CASE WHEN status='paid' AND (paid_at AT TIME ZONE 'Europe/Istanbul')::date >= (SELECT d7    FROM ranges) THEN payout_amount END),0) AS w,
          COALESCE(SUM(CASE WHEN status='paid' AND (paid_at AT TIME ZONE 'Europe/Istanbul')::date >= (SELECT d30   FROM ranges) THEN payout_amount END),0) AS m,
          COALESCE(SUM(CASE WHEN status='paid' THEN payout_amount END),0) AS t,
          COALESCE(SUM(CASE WHEN status IN ('pending','payable') THEN payout_amount END),0) AS owed
        FROM canteen_payouts
      ),
      dn AS (
        SELECT
          COALESCE(SUM(CASE WHEN (created_at AT TIME ZONE 'Europe/Istanbul')::date = (SELECT today FROM ranges) THEN amount END),0) AS d,
          COALESCE(SUM(CASE WHEN (created_at AT TIME ZONE 'Europe/Istanbul')::date >= (SELECT d7    FROM ranges) THEN amount END),0) AS w,
          COALESCE(SUM(CASE WHEN (created_at AT TIME ZONE 'Europe/Istanbul')::date >= (SELECT d30   FROM ranges) THEN amount END),0) AS m,
          COALESCE(SUM(amount),0) AS t
        FROM donations WHERE status='completed'
      ),
      dd AS (
        SELECT
          COALESCE(SUM(CASE WHEN (created_at AT TIME ZONE 'Europe/Istanbul')::date = (SELECT today FROM ranges) THEN amount END),0) AS d,
          COALESCE(SUM(CASE WHEN (created_at AT TIME ZONE 'Europe/Istanbul')::date >= (SELECT d7    FROM ranges) THEN amount END),0) AS w,
          COALESCE(SUM(CASE WHEN (created_at AT TIME ZONE 'Europe/Istanbul')::date >= (SELECT d30   FROM ranges) THEN amount END),0) AS m,
          COALESCE(SUM(amount),0) AS t
        FROM donation_distributions
      ),
      bal AS (
        SELECT COALESCE(SUM(balance),0) AS student_balances FROM students
      ),
      pool AS (
        SELECT COALESCE(SUM(balance),0) AS pool_balances FROM school_donation_pools
      ),
      recent AS (
        SELECT COALESCE(json_agg(row_to_json(x)), '[]'::json) AS items
        FROM (
          SELECT t.id, s.name AS school_name, t.amount, t.created_at
            FROM wallet_topups t
            JOIN schools s ON s.id = t.school_id
           ORDER BY t.created_at DESC
           LIMIT $1
        ) x
      )
      SELECT json_build_object(
        'stats', json_build_object(
          'topups',     json_build_object('today',tu.d,'week',tu.w,'month',tu.m,'total',tu.t),
          'payouts',    json_build_object('today',cp.d,'week',cp.w,'month',cp.m,'total',cp.t,'owed',cp.owed),
          'donations',  json_build_object('today',dn.d,'week',dn.w,'month',dn.m,'total',dn.t),
          'distributions', json_build_object('today',dd.d,'week',dd.w,'month',dd.m,'total',dd.t),
          'pool_balance', (tu.t - cp.t - dd.t),
          'student_balances', bal.student_balances,
          'donation_pool_balances', pool.pool_balances
        ),
        'topups', recent.items
      ) AS payload
      FROM tu, cp, dn, dd, bal, pool, recent
    `;
    const r = await query<{ payload: any }>(sql, [limit]);
    return r.rows[0]?.payload ?? { stats: {}, topups: [] };
  },

  // Owner-only: report whether the calling user is the owner (no module grants)
  whoami: async (ctx) => {
    const owner = await isOwner(ctx.userId);
    const a = admin();
    const { data: perms } = await a
      .from("super_admin_module_permissions")
      .select("module")
      .eq("user_id", ctx.userId);
    return {
      user_id: ctx.userId,
      is_owner: owner,
      modules: owner ? MODULES : (perms ?? []).map((p) => p.module),
    };
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
    const auth = await authenticate(req);
    requireRole(auth, "super_admin");

    const handler = OPS[parsed.data.op];
    if (!handler) throw new HttpError(404, `Bilinmeyen işlem: ${parsed.data.op}`);
    const data = await handler({ userId: auth.userId }, parsed.data.params ?? {});
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
    if (isDbConnectionError(e)) {
      console.warn("admin-api external DB unavailable:", msg);
      return new Response(JSON.stringify({
        error: "Veritabanı sunucusuna şu anda ulaşılamıyor. Lütfen kısa süre sonra tekrar deneyin.",
        code: "DB_UNAVAILABLE",
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "5" },
      });
    }
    console.error("admin-api error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
