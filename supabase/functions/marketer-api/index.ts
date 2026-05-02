// Marketer (sales rep) API.
//
// Super admin actions:
//  - list_marketers / create_marketer / update_marketer / delete_marketer
//  - list_schools_for_assignment (schools + current marketer)
//  - assign_school / unassign_school
//  - list_monthly_earnings (per marketer / period)
//  - upsert_monthly_earning (super admin enters platform commission for a school+month)
//  - update_earning_status / update_bonus_status
//  - list_payouts / record_payout / delete_payout
//  - get_marketer_summary (admin viewing a single marketer)
//
// Marketer actions (self):
//  - me                  — profile + aggregate balances
//  - my_schools          — schools attributed to me
//  - my_monthly_earnings — per-month breakdown
//  - my_bonuses          — signup bonuses
//  - my_payouts          — payments received from admin
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { z } from "npm:zod@3.23.8";
import { authenticate, HttpError, requireRole } from "../_shared/auth.ts";
import { query, withTransaction } from "../_shared/external-db.ts";

const SuperAdminAction = z.enum([
  "list_marketers",
  "create_marketer",
  "update_marketer",
  "delete_marketer",
  "list_schools_for_assignment",
  "assign_school",
  "unassign_school",
  "list_monthly_earnings",
  "upsert_monthly_earning",
  "delete_monthly_earning",
  "update_earning_status",
  "update_bonus_status",
  "list_bonuses_admin",
  "list_payouts",
  "record_payout",
  "delete_payout",
  "get_marketer_summary",
]);

const MarketerSelfAction = z.enum([
  "me",
  "my_schools",
  "my_monthly_earnings",
  "my_bonuses",
  "my_payouts",
]);

const BodySchema = z.object({
  action: z.string(),
  payload: z.any().optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const ctx = await authenticate(req);
    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: "Geçersiz istek" }, 400);

    const { action, payload } = parsed.data;

    // Super admin actions
    if (SuperAdminAction.safeParse(action).success) {
      requireRole(ctx, "super_admin");
      return await handleSuperAdmin(action, payload ?? {}, ctx.userId);
    }

    // Marketer self actions
    if (MarketerSelfAction.safeParse(action).success) {
      return await handleMarketerSelf(action, payload ?? {}, ctx.userId);
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error("marketer-api error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ───────────────────────────── SUPER ADMIN ─────────────────────────────────

async function handleSuperAdmin(action: string, p: any, _adminId: string): Promise<Response> {
  switch (action) {
    case "list_marketers": {
      // Each marketer + aggregate balance
      const r = await query(`
        SELECT
          m.id, m.full_name, m.email, m.phone, m.signup_bonus, m.commission_share_rate,
          m.is_active, m.notes, m.auth_user_id, m.created_at,
          COALESCE(s.school_count, 0) AS school_count,
          COALESCE(b.approved, 0) AS bonus_approved,
          COALESCE(b.paid, 0) AS bonus_paid,
          COALESCE(e.approved, 0) AS earnings_approved,
          COALESCE(e.paid, 0) AS earnings_paid,
          COALESCE(e.pending, 0) AS earnings_pending,
          COALESCE(p.total_paid, 0) AS total_payouts
        FROM marketers m
        LEFT JOIN (
          SELECT marketer_id, COUNT(*)::int AS school_count
          FROM marketer_schools GROUP BY marketer_id
        ) s ON s.marketer_id = m.id
        LEFT JOIN (
          SELECT marketer_id,
            SUM(CASE WHEN status='approved' THEN amount ELSE 0 END) AS approved,
            SUM(CASE WHEN status='paid' THEN amount ELSE 0 END) AS paid
          FROM marketer_bonuses GROUP BY marketer_id
        ) b ON b.marketer_id = m.id
        LEFT JOIN (
          SELECT marketer_id,
            SUM(CASE WHEN status='approved' THEN share_amount ELSE 0 END) AS approved,
            SUM(CASE WHEN status='paid' THEN share_amount ELSE 0 END) AS paid,
            SUM(CASE WHEN status='pending' THEN share_amount ELSE 0 END) AS pending
          FROM marketer_monthly_earnings GROUP BY marketer_id
        ) e ON e.marketer_id = m.id
        LEFT JOIN (
          SELECT marketer_id, SUM(amount) AS total_paid
          FROM marketer_payouts GROUP BY marketer_id
        ) p ON p.marketer_id = m.id
        ORDER BY m.created_at DESC
      `);
      return json({ ok: true, marketers: r.rows });
    }

    case "create_marketer": {
      const schema = z.object({
        full_name: z.string().trim().min(2).max(120),
        email: z.string().trim().email().max(255),
        phone: z.string().trim().max(32).optional().nullable(),
        password: z.string().min(8).max(128),
        signup_bonus: z.number().min(0).max(1_000_000),
        commission_share_rate: z.number().min(0).max(1),
        notes: z.string().max(1000).optional().nullable(),
      });
      const v = schema.safeParse(p);
      if (!v.success) return json({ error: v.error.flatten() }, 400);

      // Create Supabase auth user
      const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const created = await adminClient.auth.admin.createUser({
        email: v.data.email,
        password: v.data.password,
        email_confirm: true,
        user_metadata: { full_name: v.data.full_name, role: "marketer" },
      });
      if (created.error || !created.data.user) {
        return json({ error: `Hesap oluşturulamadı: ${created.error?.message}` }, 400);
      }
      const authUserId = created.data.user.id;

      const { error: roleErr } = await adminClient.from("user_roles").insert({
        user_id: authUserId, role: "marketer", school_id: null,
      });
      if (roleErr) {
        await adminClient.auth.admin.deleteUser(authUserId).catch(() => {});
        return json({ error: `Rol eklenemedi: ${roleErr.message}` }, 500);
      }

      try {
        const ins = await query<{ id: string }>(`
          INSERT INTO marketers (full_name, email, phone, signup_bonus, commission_share_rate, notes, auth_user_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          RETURNING id`,
          [v.data.full_name, v.data.email.toLowerCase(), v.data.phone ?? null,
           v.data.signup_bonus, v.data.commission_share_rate, v.data.notes ?? null, authUserId]);
        return json({ ok: true, id: ins.rows[0].id });
      } catch (e) {
        await adminClient.auth.admin.deleteUser(authUserId).catch(() => {});
        await adminClient.from("user_roles").delete().eq("user_id", authUserId).catch(() => {});
        throw e;
      }
    }

    case "update_marketer": {
      const schema = z.object({
        id: z.string().uuid(),
        full_name: z.string().trim().min(2).max(120),
        phone: z.string().trim().max(32).optional().nullable(),
        signup_bonus: z.number().min(0).max(1_000_000),
        commission_share_rate: z.number().min(0).max(1),
        is_active: z.boolean(),
        notes: z.string().max(1000).optional().nullable(),
      });
      const v = schema.safeParse(p);
      if (!v.success) return json({ error: v.error.flatten() }, 400);
      await query(`
        UPDATE marketers SET full_name=$1, phone=$2, signup_bonus=$3,
          commission_share_rate=$4, is_active=$5, notes=$6, updated_at=now()
        WHERE id=$7`,
        [v.data.full_name, v.data.phone ?? null, v.data.signup_bonus,
         v.data.commission_share_rate, v.data.is_active, v.data.notes ?? null, v.data.id]);
      return json({ ok: true });
    }

    case "delete_marketer": {
      const schema = z.object({ id: z.string().uuid() });
      const v = schema.safeParse(p);
      if (!v.success) return json({ error: "Geçersiz id" }, 400);
      const r = await query<{ auth_user_id: string | null }>(
        "SELECT auth_user_id FROM marketers WHERE id=$1", [v.data.id]);
      const authId = r.rows[0]?.auth_user_id;
      await query("DELETE FROM marketers WHERE id=$1", [v.data.id]);
      if (authId) {
        const adminClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );
        await adminClient.auth.admin.deleteUser(authId).catch(() => {});
      }
      return json({ ok: true });
    }

    case "list_schools_for_assignment": {
      const r = await query(`
        SELECT s.id, s.name, s.province, s.district, s.is_active,
          ms.marketer_id, m.full_name AS marketer_name
        FROM schools s
        LEFT JOIN marketer_schools ms ON ms.school_id = s.id
        LEFT JOIN marketers m ON m.id = ms.marketer_id
        ORDER BY s.created_at DESC`);
      return json({ ok: true, schools: r.rows });
    }

    case "assign_school": {
      const schema = z.object({ marketer_id: z.string().uuid(), school_id: z.string().uuid() });
      const v = schema.safeParse(p);
      if (!v.success) return json({ error: "Geçersiz istek" }, 400);

      // Atomically: assign + create pending bonus row (snapshot bonus amount)
      await withTransaction(async (c) => {
        await c.query(
          `INSERT INTO marketer_schools (marketer_id, school_id) VALUES ($1,$2)
           ON CONFLICT (school_id) DO UPDATE SET marketer_id = EXCLUDED.marketer_id, assigned_at = now()`,
          [v.data.marketer_id, v.data.school_id]);
        const m = await c.query(
          "SELECT signup_bonus FROM marketers WHERE id=$1",
          [v.data.marketer_id]);
        const bonus = Number(m.rows[0]?.signup_bonus ?? 0);
        await c.query(
          `INSERT INTO marketer_bonuses (marketer_id, school_id, amount, status)
           VALUES ($1,$2,$3,'pending')
           ON CONFLICT (marketer_id, school_id) DO NOTHING`,
          [v.data.marketer_id, v.data.school_id, bonus]);
      });
      return json({ ok: true });
    }

    case "unassign_school": {
      const schema = z.object({ school_id: z.string().uuid() });
      const v = schema.safeParse(p);
      if (!v.success) return json({ error: "Geçersiz istek" }, 400);
      await query("DELETE FROM marketer_schools WHERE school_id=$1", [v.data.school_id]);
      return json({ ok: true });
    }

    case "list_monthly_earnings": {
      const schema = z.object({
        marketer_id: z.string().uuid().optional(),
        year: z.number().int().min(2020).max(2100).optional(),
        month: z.number().int().min(1).max(12).optional(),
      });
      const v = schema.safeParse(p);
      if (!v.success) return json({ error: "Geçersiz istek" }, 400);
      const conds: string[] = [];
      const args: unknown[] = [];
      if (v.data.marketer_id) { args.push(v.data.marketer_id); conds.push(`e.marketer_id = $${args.length}`); }
      if (v.data.year) { args.push(v.data.year); conds.push(`e.period_year = $${args.length}`); }
      if (v.data.month) { args.push(v.data.month); conds.push(`e.period_month = $${args.length}`); }
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      const r = await query(`
        SELECT e.id, e.marketer_id, e.school_id, e.period_year, e.period_month,
          e.commission_amount, e.share_rate, e.share_amount, e.status, e.note, e.created_at,
          s.name AS school_name, m.full_name AS marketer_name
        FROM marketer_monthly_earnings e
        JOIN schools s ON s.id = e.school_id
        JOIN marketers m ON m.id = e.marketer_id
        ${where}
        ORDER BY e.period_year DESC, e.period_month DESC, s.name`, args);
      return json({ ok: true, earnings: r.rows });
    }

    case "upsert_monthly_earning": {
      const schema = z.object({
        marketer_id: z.string().uuid(),
        school_id: z.string().uuid(),
        period_year: z.number().int().min(2020).max(2100),
        period_month: z.number().int().min(1).max(12),
        commission_amount: z.number().min(0).max(100_000_000),
        note: z.string().max(500).optional().nullable(),
      });
      const v = schema.safeParse(p);
      if (!v.success) return json({ error: v.error.flatten() }, 400);
      // Snapshot the marketer's current share rate
      const m = await query<{ commission_share_rate: string }>(
        "SELECT commission_share_rate FROM marketers WHERE id=$1", [v.data.marketer_id]);
      if (m.rowCount === 0) return json({ error: "Pazarlamacı bulunamadı" }, 404);
      const shareRate = Number(m.rows[0].commission_share_rate);
      const shareAmount = Math.round(v.data.commission_amount * shareRate * 100) / 100;
      await query(`
        INSERT INTO marketer_monthly_earnings
          (marketer_id, school_id, period_year, period_month, commission_amount, share_rate, share_amount, note)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (marketer_id, school_id, period_year, period_month)
        DO UPDATE SET commission_amount=EXCLUDED.commission_amount,
                      share_rate=EXCLUDED.share_rate,
                      share_amount=EXCLUDED.share_amount,
                      note=EXCLUDED.note,
                      updated_at=now()`,
        [v.data.marketer_id, v.data.school_id, v.data.period_year, v.data.period_month,
         v.data.commission_amount, shareRate, shareAmount, v.data.note ?? null]);
      return json({ ok: true, share_amount: shareAmount, share_rate: shareRate });
    }

    case "delete_monthly_earning": {
      const schema = z.object({ id: z.string().uuid() });
      const v = schema.safeParse(p);
      if (!v.success) return json({ error: "Geçersiz" }, 400);
      await query("DELETE FROM marketer_monthly_earnings WHERE id=$1", [v.data.id]);
      return json({ ok: true });
    }

    case "update_earning_status": {
      const schema = z.object({
        id: z.string().uuid(),
        status: z.enum(["pending", "approved", "paid", "cancelled"]),
      });
      const v = schema.safeParse(p);
      if (!v.success) return json({ error: "Geçersiz" }, 400);
      await query("UPDATE marketer_monthly_earnings SET status=$1, updated_at=now() WHERE id=$2",
        [v.data.status, v.data.id]);
      return json({ ok: true });
    }

    case "update_bonus_status": {
      const schema = z.object({
        id: z.string().uuid(),
        status: z.enum(["pending", "approved", "paid", "cancelled"]),
      });
      const v = schema.safeParse(p);
      if (!v.success) return json({ error: "Geçersiz" }, 400);
      const cols = v.data.status === "approved"
        ? "status=$1, approved_at=now()"
        : v.data.status === "paid" ? "status=$1, paid_at=now(), approved_at=COALESCE(approved_at, now())"
        : "status=$1";
      await query(`UPDATE marketer_bonuses SET ${cols} WHERE id=$2`, [v.data.status, v.data.id]);
      return json({ ok: true });
    }

    case "list_bonuses_admin": {
      const schema = z.object({ marketer_id: z.string().uuid() });
      const v = schema.safeParse(p);
      if (!v.success) return json({ error: "Geçersiz" }, 400);
      const r = await query(`
        SELECT b.id, b.school_id, b.amount, b.status, b.approved_at, b.paid_at, b.created_at,
          s.name AS school_name
        FROM marketer_bonuses b
        JOIN schools s ON s.id = b.school_id
        WHERE b.marketer_id = $1
        ORDER BY b.created_at DESC`, [v.data.marketer_id]);
      return json({ ok: true, bonuses: r.rows });
    }

    case "list_payouts": {
      const schema = z.object({ marketer_id: z.string().uuid().optional() });
      const v = schema.safeParse(p);
      if (!v.success) return json({ error: "Geçersiz" }, 400);
      const args: unknown[] = [];
      let where = "";
      if (v.data.marketer_id) { args.push(v.data.marketer_id); where = `WHERE p.marketer_id = $1`; }
      const r = await query(`
        SELECT p.id, p.marketer_id, p.amount, p.method, p.reference, p.note, p.paid_at,
          m.full_name AS marketer_name
        FROM marketer_payouts p
        JOIN marketers m ON m.id = p.marketer_id
        ${where}
        ORDER BY p.paid_at DESC`, args);
      return json({ ok: true, payouts: r.rows });
    }

    case "record_payout": {
      const schema = z.object({
        marketer_id: z.string().uuid(),
        amount: z.number().positive().max(100_000_000),
        method: z.string().max(50).optional().nullable(),
        reference: z.string().max(120).optional().nullable(),
        note: z.string().max(500).optional().nullable(),
      });
      const v = schema.safeParse(p);
      if (!v.success) return json({ error: v.error.flatten() }, 400);
      const ins = await query<{ id: string }>(`
        INSERT INTO marketer_payouts (marketer_id, amount, method, reference, note)
        VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [v.data.marketer_id, v.data.amount, v.data.method ?? null, v.data.reference ?? null, v.data.note ?? null]);
      return json({ ok: true, id: ins.rows[0].id });
    }

    case "delete_payout": {
      const schema = z.object({ id: z.string().uuid() });
      const v = schema.safeParse(p);
      if (!v.success) return json({ error: "Geçersiz" }, 400);
      await query("DELETE FROM marketer_payouts WHERE id=$1", [v.data.id]);
      return json({ ok: true });
    }

    case "get_marketer_summary": {
      const schema = z.object({ marketer_id: z.string().uuid() });
      const v = schema.safeParse(p);
      if (!v.success) return json({ error: "Geçersiz" }, 400);
      return json({ ok: true, summary: await loadSummary(v.data.marketer_id) });
    }
  }
  return json({ error: "Unknown action" }, 400);
}

// ──────────────────────────── MARKETER (SELF) ──────────────────────────────

async function resolveMarketerId(authUserId: string): Promise<string> {
  const r = await query<{ id: string }>(
    "SELECT id FROM marketers WHERE auth_user_id=$1 AND is_active=TRUE LIMIT 1",
    [authUserId]);
  if (r.rowCount === 0) throw new HttpError(403, "Pazarlamacı kaydı bulunamadı");
  return r.rows[0].id;
}

async function handleMarketerSelf(action: string, _p: any, authUserId: string): Promise<Response> {
  const marketerId = await resolveMarketerId(authUserId);
  switch (action) {
    case "me": {
      const me = await query(`
        SELECT id, full_name, email, phone, signup_bonus, commission_share_rate, notes, created_at
        FROM marketers WHERE id=$1`, [marketerId]);
      return json({ ok: true, profile: me.rows[0], summary: await loadSummary(marketerId) });
    }
    case "my_schools": {
      const r = await query(`
        SELECT s.id, s.name, s.province, s.district, s.is_active, ms.assigned_at
        FROM marketer_schools ms
        JOIN schools s ON s.id = ms.school_id
        WHERE ms.marketer_id=$1
        ORDER BY ms.assigned_at DESC`, [marketerId]);
      return json({ ok: true, schools: r.rows });
    }
    case "my_monthly_earnings": {
      const r = await query(`
        SELECT e.id, e.school_id, e.period_year, e.period_month,
          e.commission_amount, e.share_rate, e.share_amount, e.status, e.created_at,
          s.name AS school_name
        FROM marketer_monthly_earnings e
        JOIN schools s ON s.id = e.school_id
        WHERE e.marketer_id=$1
        ORDER BY e.period_year DESC, e.period_month DESC, s.name`, [marketerId]);
      return json({ ok: true, earnings: r.rows });
    }
    case "my_bonuses": {
      const r = await query(`
        SELECT b.id, b.school_id, b.amount, b.status, b.approved_at, b.paid_at, b.created_at,
          s.name AS school_name
        FROM marketer_bonuses b
        JOIN schools s ON s.id = b.school_id
        WHERE b.marketer_id=$1
        ORDER BY b.created_at DESC`, [marketerId]);
      return json({ ok: true, bonuses: r.rows });
    }
    case "my_payouts": {
      const r = await query(`
        SELECT id, amount, method, reference, note, paid_at
        FROM marketer_payouts WHERE marketer_id=$1 ORDER BY paid_at DESC`, [marketerId]);
      return json({ ok: true, payouts: r.rows });
    }
  }
  return json({ error: "Unknown action" }, 400);
}

async function loadSummary(marketerId: string) {
  const r = await query<{
    school_count: number;
    bonus_pending: string; bonus_approved: string; bonus_paid: string;
    earn_pending: string; earn_approved: string; earn_paid: string;
    payouts_total: string;
  }>(`
    SELECT
      (SELECT COUNT(*)::int FROM marketer_schools WHERE marketer_id=$1) AS school_count,
      COALESCE((SELECT SUM(amount) FROM marketer_bonuses WHERE marketer_id=$1 AND status='pending'),0) AS bonus_pending,
      COALESCE((SELECT SUM(amount) FROM marketer_bonuses WHERE marketer_id=$1 AND status='approved'),0) AS bonus_approved,
      COALESCE((SELECT SUM(amount) FROM marketer_bonuses WHERE marketer_id=$1 AND status='paid'),0) AS bonus_paid,
      COALESCE((SELECT SUM(share_amount) FROM marketer_monthly_earnings WHERE marketer_id=$1 AND status='pending'),0) AS earn_pending,
      COALESCE((SELECT SUM(share_amount) FROM marketer_monthly_earnings WHERE marketer_id=$1 AND status='approved'),0) AS earn_approved,
      COALESCE((SELECT SUM(share_amount) FROM marketer_monthly_earnings WHERE marketer_id=$1 AND status='paid'),0) AS earn_paid,
      COALESCE((SELECT SUM(amount) FROM marketer_payouts WHERE marketer_id=$1),0) AS payouts_total
  `, [marketerId]);
  const row = r.rows[0];
  const owedTotal = Number(row.bonus_approved) + Number(row.earn_approved); // approved but not yet paid
  const lifetimeEarned = Number(row.bonus_approved) + Number(row.bonus_paid)
    + Number(row.earn_approved) + Number(row.earn_paid);
  // Current month
  const now = new Date();
  const cm = await query<{ amt: string }>(
    `SELECT COALESCE(SUM(share_amount),0) AS amt FROM marketer_monthly_earnings
      WHERE marketer_id=$1 AND period_year=$2 AND period_month=$3`,
    [marketerId, now.getFullYear(), now.getMonth() + 1]);
  return {
    school_count: row.school_count,
    bonus_pending: Number(row.bonus_pending),
    bonus_approved: Number(row.bonus_approved),
    bonus_paid: Number(row.bonus_paid),
    earnings_pending: Number(row.earn_pending),
    earnings_approved: Number(row.earn_approved),
    earnings_paid: Number(row.earn_paid),
    payouts_total: Number(row.payouts_total),
    owed_total: owedTotal,
    lifetime_earned: lifetimeEarned,
    current_month_share: Number(cm.rows[0]?.amt ?? 0),
  };
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
