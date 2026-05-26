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
  {
    version: "0015_parent_notifications",
    description: "parent_notifications: messages from cashier/admin to a parent about their student (e.g. card seized).",
    sql: `
      CREATE TABLE IF NOT EXISTS parent_notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        parent_phone TEXT NOT NULL,
        kind TEXT NOT NULL,                 -- e.g. 'card_seized', 'card_found'
        title TEXT NOT NULL,
        body TEXT,
        meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_parent_notif_phone ON parent_notifications(parent_phone, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_parent_notif_student ON parent_notifications(student_id, created_at DESC);

      ALTER TABLE students ADD COLUMN IF NOT EXISTS card_seized_at TIMESTAMPTZ;
      ALTER TABLE students ADD COLUMN IF NOT EXISTS card_seized_note TEXT;
    `,
  },
  {
    version: "0016_tx_no_and_alarms",
    description: "Unique transaction numbers + alarm/refund tables for cashier-flagged sales",
    sql: `
      -- Human-readable, monotonic per-school transaction number
      CREATE SEQUENCE IF NOT EXISTS transaction_no_seq;
      ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS tx_no BIGINT UNIQUE DEFAULT nextval('transaction_no_seq'),
        ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

      -- Backfill existing rows that may have NULL tx_no
      UPDATE transactions SET tx_no = nextval('transaction_no_seq') WHERE tx_no IS NULL;
      ALTER TABLE transactions ALTER COLUMN tx_no SET NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_transactions_tx_no ON transactions(tx_no);

      -- Alarms raised by the cashier on a specific transaction
      CREATE TABLE IF NOT EXISTS transaction_alarms (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        cashier_id UUID NOT NULL REFERENCES app_users(id),
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','rejected')),
        resolved_at TIMESTAMPTZ,
        resolved_by_admin UUID,    -- supabase auth user id of the staff who resolved
        resolution_note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_alarms_school_status ON transaction_alarms(school_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_alarms_status ON transaction_alarms(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_alarms_tx ON transaction_alarms(transaction_id);

      -- Refund records (one transaction can have multiple partial refunds up to total)
      CREATE TABLE IF NOT EXISTS transaction_refunds (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        alarm_id UUID REFERENCES transaction_alarms(id) ON DELETE SET NULL,
        school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES students(id),
        amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
        kind TEXT NOT NULL CHECK (kind IN ('full','partial')),
        balance_before NUMERIC(12,2) NOT NULL,
        balance_after NUMERIC(12,2) NOT NULL,
        refunded_by_admin UUID NOT NULL,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_refunds_tx ON transaction_refunds(transaction_id);
      CREATE INDEX IF NOT EXISTS idx_refunds_school_date ON transaction_refunds(school_id, created_at DESC);

      -- Per-line refund detail (only used when kind='partial')
      CREATE TABLE IF NOT EXISTS transaction_refund_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        refund_id UUID NOT NULL REFERENCES transaction_refunds(id) ON DELETE CASCADE,
        transaction_item_id UUID NOT NULL REFERENCES transaction_items(id),
        product_name TEXT NOT NULL,
        unit_price NUMERIC(10,2) NOT NULL,
        qty INT NOT NULL CHECK (qty > 0),
        line_total NUMERIC(12,2) NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_refund_items_refund ON transaction_refund_items(refund_id);
    `,
  },
  {
    version: "0017_sale_timing_logs",
    description: "Track student lookup time and sale duration for transaction logs",
    sql: `
      ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS student_lookup_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS lookup_duration_ms INT;
      CREATE INDEX IF NOT EXISTS idx_transactions_school_created
        ON transactions(school_id, created_at DESC);
    `,
  },
  {
    version: "0018_canteen_payouts",
    description: "Per-school payout hold days + canteen_payouts table to track daily net payouts owed to canteen.",
    sql: `
      -- Number of calendar days a sale is held before becoming payable to the canteen.
      -- 0 = next day (00:01 the day after sale), 7 = a week later, etc.
      ALTER TABLE schools
        ADD COLUMN IF NOT EXISTS payout_hold_days INT NOT NULL DEFAULT 1;

      -- One row per school per sale-day. Aggregated nightly (or on-demand) from transactions.
      CREATE TABLE IF NOT EXISTS canteen_payouts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        sale_date DATE NOT NULL,
        gross_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        refunded_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        net_sales NUMERIC(14,2) NOT NULL DEFAULT 0,    -- gross - refunded
        commission_rate NUMERIC(5,4) NOT NULL,         -- snapshotted from school
        commission_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        payout_amount NUMERIC(14,2) NOT NULL DEFAULT 0, -- net_sales - commission_amount
        hold_days INT NOT NULL,                         -- snapshotted from school
        payable_at TIMESTAMPTZ NOT NULL,                -- sale_date + hold_days @ 00:01
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','payable','paid','cancelled')),
        paid_at TIMESTAMPTZ,
        paid_by UUID,
        paid_reference TEXT,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (school_id, sale_date)
      );
      CREATE INDEX IF NOT EXISTS idx_cpayouts_school_date ON canteen_payouts(school_id, sale_date DESC);
      CREATE INDEX IF NOT EXISTS idx_cpayouts_status ON canteen_payouts(status, payable_at);
    `,
  },
  {
    version: "0019_wallet_topups",
    description: "Track every parent wallet top-up (balance increase) for dashboard reporting.",
    sql: `
      CREATE TABLE IF NOT EXISTS wallet_topups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
        source TEXT NOT NULL DEFAULT 'admin' CHECK (source IN ('admin','parent','online','manual')),
        created_by UUID,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_wallet_topups_school_date ON wallet_topups(school_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_wallet_topups_student ON wallet_topups(student_id, created_at DESC);
    `,
  },
  {
    version: "0020_canteen_announcements",
    description: "Per-school canteen announcement images (4 slots), shown on cashier panel left rail.",
    sql: `
      CREATE TABLE IF NOT EXISTS canteen_announcements (
        school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        slot SMALLINT NOT NULL CHECK (slot BETWEEN 1 AND 4),
        image_url TEXT NOT NULL,
        title TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (school_id, slot)
      );
    `,
  },
  {
    version: "0021_school_stories",
    description: "Per-school Instagram-style story reels (multiple images per school) shown above student switcher in parent panel.",
    sql: `
      CREATE TABLE IF NOT EXISTS school_stories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        image_url TEXT NOT NULL,
        link_url TEXT,
        title TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_school_stories_school
        ON school_stories(school_id, sort_order, created_at);
    `,
  },
  {
    version: "0022_student_co_parents",
    description: "Co-parents (eş/diğer veli) per student. A parent can invite another phone number to access the same student.",
    sql: `
      CREATE TABLE IF NOT EXISTS student_co_parents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        phone TEXT NOT NULL,
        full_name TEXT,
        invited_by_phone TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (student_id, phone)
      );
      CREATE INDEX IF NOT EXISTS idx_student_co_parents_phone
        ON student_co_parents(phone);
      CREATE INDEX IF NOT EXISTS idx_student_co_parents_student
        ON student_co_parents(student_id);
    `,
  },
  {
    version: "0023_parent_pins",
    description: "Parent PIN auth: per-phone 6-digit PIN (bcrypt-hashed) with forced-change flag. Replaces OTP-only login for parents.",
    sql: `
      CREATE TABLE IF NOT EXISTS parent_pins (
        phone TEXT PRIMARY KEY,
        pin_hash TEXT NOT NULL,
        must_change BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- Refresh default welcome template to include the new {pin} placeholder
      -- (only if admin hasn't customised it yet).
      UPDATE system_settings
         SET value = '"Sayin {parent_name}, {school_name} kantin sisteminde hesabiniz aktif. Giris PIN: {pin}. Ilk girisinizde PIN kodunuzu degistirmeniz gerekir. https://dash.kantinpay.com/veli-giris"'::jsonb,
             updated_at = now()
       WHERE key = 'parent_welcome_sms_template'
         AND value = '"Sayin {parent_name}, {school_name} kantin sisteminde hesabiniz aktiftir. Cocugunuzun bakiyesini yonetmek ve yukleme yapmak icin: kantinpay.com"'::jsonb;
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

    // Repair: drop orphan referential-integrity triggers whose constraint OID
    // points to a missing or non-FK constraint. These cause the runtime error
    // "constraint NNNN is not a foreign key constraint" on insert/update/delete.
    try {
      const repaired: string[] = [];
      await withTransaction(async (client) => {
        const r = await client.query(`
          SELECT t.tgname, t.tgrelid::regclass::text AS tbl
            FROM pg_trigger t
            LEFT JOIN pg_constraint c ON c.oid = t.tgconstraint
           WHERE t.tgconstraint <> 0
             AND t.tgisinternal = true
             AND (c.oid IS NULL OR c.contype <> 'f')
             AND t.tgfoid::regproc::text LIKE 'RI_FKey_%'
        `);
        for (const row of r.rows as Array<{ tgname: string; tbl: string }>) {
          await client.query(`DROP TRIGGER IF EXISTS "${row.tgname}" ON ${row.tbl}`);
          repaired.push(`${row.tbl}.${row.tgname}`);
        }
      });
      results.push({ version: "_repair_orphan_ri_triggers", status: repaired.length ? `dropped ${repaired.length}` : "ok" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ version: "_repair_orphan_ri_triggers", status: "failed", error: msg });
    }

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
