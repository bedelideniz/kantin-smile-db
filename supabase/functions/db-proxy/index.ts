// Generic DB proxy: executes named, server-defined operations against the
// external PostgreSQL. NEVER accepts raw SQL from the client.
// Phase 0 ships only a `ping` op so we can verify the connection end-to-end.
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { z } from "npm:zod@3.23.8";
import { authenticate, HttpError } from "../_shared/auth.ts";
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
    const r = await query(
      `INSERT INTO schools (name, province, district, admin_full_name, admin_phone, min_topup_amount, commission_rate, commission_free_after_days, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, name, province, district, admin_full_name, admin_phone, min_topup_amount, commission_rate, commission_free_after_days, is_active, created_at`,
      [p.name, p.province ?? null, p.district ?? null, p.admin_full_name, p.admin_phone, p.min_topup_amount, p.commission_rate, p.commission_free_after_days, p.is_active],
    );
    return r.rows[0];
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
};

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
