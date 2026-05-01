// Migration runner: applies schema versions to the external PostgreSQL.
// Only callable by super_admin. Each migration is idempotent and tracked
// in the Lovable Cloud `external_db_migrations` table.
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { authenticate, HttpError, requireRole } from "../_shared/auth.ts";
import { withTransaction } from "../_shared/external-db.ts";

interface Migration {
  version: string;
  description: string;
  sql: string;
}

// Phase 0 baseline schema. Future phases append new entries here.
const MIGRATIONS: Migration[] = [
  {
    version: "0001_baseline",
    description: "Phase 0 baseline: schools, system_settings, payment_provider_config",
    sql: `
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      CREATE TABLE IF NOT EXISTS schools (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        province TEXT,
        district TEXT,
        admin_full_name TEXT NOT NULL,
        admin_phone TEXT NOT NULL UNIQUE,
        min_topup_amount NUMERIC(10,2) NOT NULL DEFAULT 50.00,
        commission_rate NUMERIC(5,4) NOT NULL DEFAULT 0.05,
        commission_free_after_days INT NOT NULL DEFAULT 7,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_schools_active ON schools(is_active);

      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- Payment provider configuration (single active provider for whole platform)
      CREATE TABLE IF NOT EXISTS payment_provider_config (
        id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        active_provider TEXT CHECK (active_provider IN ('iyzico','paytr')),
        iyzico_api_key TEXT,
        iyzico_secret_key TEXT,
        iyzico_base_url TEXT DEFAULT 'https://api.iyzipay.com',
        paytr_merchant_id TEXT,
        paytr_merchant_key TEXT,
        paytr_merchant_salt TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      INSERT INTO payment_provider_config (id) VALUES (1) ON CONFLICT DO NOTHING;

      -- NetGSM configuration
      CREATE TABLE IF NOT EXISTS netgsm_config (
        id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        username TEXT,
        password TEXT,
        msgheader TEXT,
        is_active BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      INSERT INTO netgsm_config (id) VALUES (1) ON CONFLICT DO NOTHING;
    `,
  },
  {
    version: "0002_users_and_otp",
    description: "App users (school admin/cashier/parent) + OTP codes + SMS log",
    sql: `
      CREATE TABLE IF NOT EXISTS app_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        full_name TEXT NOT NULL,
        phone TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL CHECK (role IN ('school_admin','cashier','parent')),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_app_users_school ON app_users(school_id);
      CREATE INDEX IF NOT EXISTS idx_app_users_phone ON app_users(phone);

      CREATE TABLE IF NOT EXISTS otp_codes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        phone TEXT NOT NULL,
        code TEXT NOT NULL,
        purpose TEXT NOT NULL DEFAULT 'login',
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,
        attempts INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone);
      CREATE INDEX IF NOT EXISTS idx_otp_active ON otp_codes(phone, consumed_at, expires_at);

      CREATE TABLE IF NOT EXISTS sms_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        phone TEXT NOT NULL,
        message TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'netgsm',
        status TEXT NOT NULL,
        provider_response TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_sms_log_phone ON sms_log(phone);
      CREATE INDEX IF NOT EXISTS idx_sms_log_created ON sms_log(created_at DESC);
    `,
  },
  {
    version: "0003_app_users_auth_link",
    description: "Link app_users to Supabase auth user id for OTP login",
    sql: `
      ALTER TABLE app_users ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE;
      CREATE INDEX IF NOT EXISTS idx_app_users_auth_user ON app_users(auth_user_id);
    `,
  },
  {
    version: "0004_cashier_pin",
    description: "Add PIN hash for cashier login",
    sql: `
      ALTER TABLE app_users ADD COLUMN IF NOT EXISTS pin_hash TEXT;
      ALTER TABLE app_users ADD COLUMN IF NOT EXISTS pin_updated_at TIMESTAMPTZ;
      -- Allow multiple cashiers per school to share a phone-less placeholder if needed.
      -- Existing UNIQUE(phone) stays for school_admin/parent; cashiers must also have unique phones.
    `,
  },
];


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const ctx = await authenticate(req);
    requireRole(ctx, "super_admin");

    // Read already-applied versions from Lovable Cloud
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: applied, error: readErr } = await supabase
      .from("external_db_migrations")
      .select("version");
    if (readErr) throw new Error(`Failed to read migration log: ${readErr.message}`);
    const appliedSet = new Set((applied ?? []).map((r) => r.version));

    const results: { version: string; status: string; error?: string }[] = [];

    for (const m of MIGRATIONS) {
      if (appliedSet.has(m.version)) {
        results.push({ version: m.version, status: "skipped" });
        continue;
      }
      try {
        await withTransaction(async (client) => {
          await client.query(m.sql);
        });
        const { error: insErr } = await supabase
          .from("external_db_migrations")
          .insert({ version: m.version, description: m.description, applied_by: ctx.userId });
        if (insErr) throw new Error(`Migration applied but log insert failed: ${insErr.message}`);
        results.push({ version: m.version, status: "applied" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ version: m.version, status: "failed", error: msg });
        break; // stop on first failure
      }
    }

    return new Response(JSON.stringify({ ok: true, results }), {
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
    console.error("migrate-external-db error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
