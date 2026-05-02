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
  {
    version: "0006_recipes",
    description: "Recipes: ingredients (raw stock items) + product_recipes (BOM)",
    sql: `
      -- Raw materials / ingredients used by recipes (e.g. ekmek, köfte, kaşar)
      CREATE TABLE IF NOT EXISTS ingredients (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        unit TEXT NOT NULL DEFAULT 'adet', -- 'adet','gr','ml','kg','lt'
        stock_qty NUMERIC(12,3) NOT NULL DEFAULT 0,
        low_stock_threshold NUMERIC(12,3),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_ingredients_school ON ingredients(school_id, is_active);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_ingredients_school_name ON ingredients(school_id, lower(name));

      -- Product recipe lines (BOM): which ingredients & how much per 1 product unit
      CREATE TABLE IF NOT EXISTS product_recipes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
        qty NUMERIC(12,3) NOT NULL CHECK (qty > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (product_id, ingredient_id)
      );
      CREATE INDEX IF NOT EXISTS idx_product_recipes_product ON product_recipes(product_id);
      CREATE INDEX IF NOT EXISTS idx_product_recipes_ingredient ON product_recipes(ingredient_id);

      -- Per-sale ingredient consumption log (audit + analytics)
      CREATE TABLE IF NOT EXISTS ingredient_movements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
        delta NUMERIC(12,3) NOT NULL,             -- negative = consumption, positive = restock
        reason TEXT NOT NULL,                      -- 'sale','restock','adjustment'
        transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
        product_id UUID REFERENCES products(id) ON DELETE SET NULL,
        balance_after NUMERIC(12,3) NOT NULL,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_ing_mov_school_date ON ingredient_movements(school_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ing_mov_ingredient ON ingredient_movements(ingredient_id, created_at DESC);
    `,
  },
  {
    version: "0007_parent_sessions",
    description: "Parent panel: opaque session tokens (parents auth via OTP, no signup)",
    sql: `
      CREATE TABLE IF NOT EXISTS parent_sessions (
        token TEXT PRIMARY KEY,
        phone TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_parent_sessions_phone ON parent_sessions(phone);
      CREATE INDEX IF NOT EXISTS idx_parent_sessions_expires ON parent_sessions(expires_at);

      -- Useful index to look students up by parent phone (digits only) for OTP eligibility check.
      CREATE INDEX IF NOT EXISTS idx_students_parent_phone ON students(parent_phone) WHERE parent_phone IS NOT NULL;
    `,
  },
  {
    version: "0008_student_blocked_products",
    description: "Parent-set product blocks per student (cashier must reject these at POS)",
    sql: `
      CREATE TABLE IF NOT EXISTS student_blocked_products (
        student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (student_id, product_id)
      );
      CREATE INDEX IF NOT EXISTS idx_sbp_student ON student_blocked_products(student_id);
      CREATE INDEX IF NOT EXISTS idx_sbp_product ON student_blocked_products(product_id);
    `,
  },
  {
    version: "0009_marketers",
    description: "Marketers (sales reps): per-marketer signup bonus + commission share, school assignments, monthly earnings, bonuses, payouts",
    sql: `
      -- Marketer (sales representative) accounts. Linked to a Supabase auth user
      -- via auth_user_id once the marketer first signs in (or admin creates the
      -- auth user). Each marketer has a per-marketer one-time bonus per school
      -- and a per-marketer share rate over the platform commission of every
      -- school they brought in.
      CREATE TABLE IF NOT EXISTS marketers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        full_name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        phone TEXT,
        -- One-time bonus (TRY) granted per school the marketer brings in.
        signup_bonus NUMERIC(10,2) NOT NULL DEFAULT 0,
        -- Share of OUR commission revenue this marketer earns (0..1, e.g. 0.20 = 20%).
        commission_share_rate NUMERIC(5,4) NOT NULL DEFAULT 0,
        auth_user_id UUID,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_marketers_active ON marketers(is_active);
      CREATE INDEX IF NOT EXISTS idx_marketers_auth_user ON marketers(auth_user_id);

      -- A school can be attributed to AT MOST one marketer.
      CREATE TABLE IF NOT EXISTS marketer_schools (
        marketer_id UUID NOT NULL REFERENCES marketers(id) ON DELETE CASCADE,
        school_id UUID NOT NULL UNIQUE REFERENCES schools(id) ON DELETE CASCADE,
        assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (marketer_id, school_id)
      );
      CREATE INDEX IF NOT EXISTS idx_marketer_schools_marketer ON marketer_schools(marketer_id);

      -- Per-school one-time signup bonus tracking. One row per (marketer, school).
      -- Snapshot the amount at creation time (so rate edits don't retroactively change it).
      CREATE TABLE IF NOT EXISTS marketer_bonuses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        marketer_id UUID NOT NULL REFERENCES marketers(id) ON DELETE CASCADE,
        school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        amount NUMERIC(10,2) NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','cancelled')),
        approved_at TIMESTAMPTZ,
        paid_at TIMESTAMPTZ,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (marketer_id, school_id)
      );
      CREATE INDEX IF NOT EXISTS idx_mbonus_marketer ON marketer_bonuses(marketer_id);
      CREATE INDEX IF NOT EXISTS idx_mbonus_status ON marketer_bonuses(status);

      -- Monthly earnings per (marketer, school, period). Super admin enters
      -- the platform commission revenue collected that month from the school;
      -- the marketer share is computed = commission * share_rate (snapshotted).
      CREATE TABLE IF NOT EXISTS marketer_monthly_earnings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        marketer_id UUID NOT NULL REFERENCES marketers(id) ON DELETE CASCADE,
        school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        period_year INT NOT NULL,
        period_month INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
        commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        share_rate NUMERIC(5,4) NOT NULL,
        share_amount NUMERIC(12,2) NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','cancelled')),
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (marketer_id, school_id, period_year, period_month)
      );
      CREATE INDEX IF NOT EXISTS idx_mme_marketer_period ON marketer_monthly_earnings(marketer_id, period_year, period_month);
      CREATE INDEX IF NOT EXISTS idx_mme_status ON marketer_monthly_earnings(status);

      -- Payouts: when super admin pays the marketer (cash, transfer, etc.).
      -- Decreases what's owed to the marketer.
      CREATE TABLE IF NOT EXISTS marketer_payouts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        marketer_id UUID NOT NULL REFERENCES marketers(id) ON DELETE CASCADE,
        amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
        method TEXT,
        reference TEXT,
        note TEXT,
        paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_mpayouts_marketer ON marketer_payouts(marketer_id);
    `,
  },
  {
    version: "0010_school_splashes",
    description: "Per-school parent splash/ad screen (image + optional link, shown once per day after parent login)",
    sql: `
      CREATE TABLE IF NOT EXISTS school_splashes (
        school_id UUID PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
        image_url TEXT NOT NULL,
        link_url TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
  {
    version: "0011_donations",
    description: "Per-school donation pools, donation records, distributions to students, and donation manager accounts (phone+OTP login)",
    sql: `
      -- Per-school donation pool (single row per school).
      CREATE TABLE IF NOT EXISTS school_donation_pools (
        school_id UUID PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
        balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
        total_received NUMERIC(14,2) NOT NULL DEFAULT 0,
        total_distributed NUMERIC(14,2) NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- Each donation made by a parent (no commission applied).
      CREATE TABLE IF NOT EXISTS donations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        parent_phone TEXT NOT NULL,
        student_id UUID REFERENCES students(id) ON DELETE SET NULL,
        amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
        source TEXT NOT NULL CHECK (source IN ('balance','card')),
        status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending','completed','failed','refunded')),
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_donations_school_date ON donations(school_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_donations_parent ON donations(parent_phone);

      -- Distributions: donation manager moves money from pool to a specific student.
      CREATE TABLE IF NOT EXISTS donation_distributions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
        manager_id UUID NOT NULL,
        amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
        student_balance_before NUMERIC(12,2) NOT NULL,
        student_balance_after NUMERIC(12,2) NOT NULL,
        pool_balance_before NUMERIC(12,2) NOT NULL,
        pool_balance_after NUMERIC(12,2) NOT NULL,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_dist_school_date ON donation_distributions(school_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_dist_student ON donation_distributions(student_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_dist_manager ON donation_distributions(manager_id, created_at DESC);

      -- Donation manager accounts (one or more per school). Login via phone + OTP.
      CREATE TABLE IF NOT EXISTS donation_managers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        full_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (school_id, phone)
      );
      CREATE INDEX IF NOT EXISTS idx_donmgr_phone ON donation_managers(phone);
      CREATE INDEX IF NOT EXISTS idx_donmgr_school ON donation_managers(school_id, is_active);

      -- Opaque session tokens for donation managers.
      CREATE TABLE IF NOT EXISTS donation_manager_sessions (
        token TEXT PRIMARY KEY,
        manager_id UUID NOT NULL REFERENCES donation_managers(id) ON DELETE CASCADE,
        school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_dmgr_sess_manager ON donation_manager_sessions(manager_id);
      CREATE INDEX IF NOT EXISTS idx_dmgr_sess_expires ON donation_manager_sessions(expires_at);

      -- Per-school donation presets (quick amounts shown to parent). Optional.
      CREATE TABLE IF NOT EXISTS school_donation_settings (
        school_id UUID PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
        presets NUMERIC(10,2)[] NOT NULL DEFAULT ARRAY[10,25,50,100,250]::NUMERIC(10,2)[],
        is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        thank_you_message TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- Make sure every existing school has a pool row (idempotent).
      INSERT INTO school_donation_pools (school_id)
      SELECT id FROM schools
      ON CONFLICT (school_id) DO NOTHING;
    `,
  },
  {
    version: "0012_parent_welcome_sms",
    description: "Default parent welcome SMS template stored in system_settings (key: parent_welcome_sms_template)",
    sql: `
      INSERT INTO system_settings (key, value)
      VALUES (
        'parent_welcome_sms_template',
        '"Sayin {parent_name}, {school_name} kantin sisteminde hesabiniz aktiftir. Cocugunuzun bakiyesini yonetmek ve yukleme yapmak icin: kantinpay.com"'::jsonb
      )
      ON CONFLICT (key) DO NOTHING;
    `,
  },
  {
    version: "0013_student_photo",
    description: "students.photo_url column for parent-uploaded student profile photos",
    sql: `
      ALTER TABLE students ADD COLUMN IF NOT EXISTS photo_url TEXT;
    `,
  },
  {
    version: "0014_student_card_lost",
    description: "students.card_lost column to disable card usage at the cashier when reported lost by parent",
    sql: `
      ALTER TABLE students ADD COLUMN IF NOT EXISTS card_lost BOOLEAN NOT NULL DEFAULT FALSE;
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
