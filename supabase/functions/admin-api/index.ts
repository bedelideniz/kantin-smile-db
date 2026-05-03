// Admin API — super_admin staff/permissions management + alarm/refund flows.
// All ops require an authenticated super_admin (with appropriate module grant).
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { z } from "npm:zod@3.23.8";
import { authenticate, HttpError, requireRole } from "../_shared/auth.ts";
import { query, withTransaction } from "../_shared/external-db.ts";

type AppModule =
  | "schools" | "students" | "marketers" | "splashes" | "donations"
  | "payments" | "sms" | "infrastructure" | "alarms" | "staff" | "logs";

const MODULES: AppModule[] = [
  "schools","students","marketers","splashes","donations",
  "payments","sms","infrastructure","alarms","staff","logs",
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
    console.error("admin-api error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
