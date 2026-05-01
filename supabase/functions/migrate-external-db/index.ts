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
    `,
  },
  {
    version: "0005_pos_schema",
    description: "POS: categories, products, students, cashier sessions, transactions",
    sql: `
      -- Cashier login sessions (opaque token -> cashier user)
      CREATE TABLE IF NOT EXISTS cashier_sessions (
        token TEXT PRIMARY KEY,
        cashier_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_cashier_sessions_cashier ON cashier_sessions(cashier_id);
      CREATE INDEX IF NOT EXISTS idx_cashier_sessions_expires ON cashier_sessions(expires_at);

      -- Product categories
      CREATE TABLE IF NOT EXISTS categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        color TEXT,
        sort_order INT NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_categories_school ON categories(school_id, sort_order);

      -- Products
      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
        image_url TEXT,
        barcode TEXT,
        stock_tracking BOOLEAN NOT NULL DEFAULT FALSE,
        stock_qty INT NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_products_school ON products(school_id, is_active);
      CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
      CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL;

      -- Students (canteen account holders)
      CREATE TABLE IF NOT EXISTS students (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        full_name TEXT NOT NULL,
        class_name TEXT,
        student_no TEXT,
        parent_phone TEXT,
        balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
        qr_token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
        nfc_uid TEXT UNIQUE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id, is_active);
      CREATE INDEX IF NOT EXISTS idx_students_name ON students(school_id, full_name);

      -- Sales transactions
      CREATE TABLE IF NOT EXISTS transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        cashier_id UUID NOT NULL REFERENCES app_users(id),
        student_id UUID NOT NULL REFERENCES students(id),
        total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
        balance_before NUMERIC(12,2) NOT NULL,
        balance_after NUMERIC(12,2) NOT NULL,
        payment_method TEXT NOT NULL DEFAULT 'balance',
        status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','refunded','voided')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_transactions_school_date ON transactions(school_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_transactions_student ON transactions(student_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_transactions_cashier ON transactions(cashier_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS transaction_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products(id),
        product_name TEXT NOT NULL,
        unit_price NUMERIC(10,2) NOT NULL,
        qty INT NOT NULL CHECK (qty > 0),
        line_total NUMERIC(12,2) NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tx_items_tx ON transaction_items(transaction_id);
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
        try {
          await withTransaction(async (client) => {
            await client.query(m.sql);
          });
          results.push({ version: m.version, status: "verified" });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          results.push({ version: m.version, status: "failed", error: msg });
          break;
        }
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
