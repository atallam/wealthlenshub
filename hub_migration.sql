-- ═══════════════════════════════════════════════════════════════════
--  Wealth Lens Hub — Database Migration
--  Multi-tenant, RLS-secured, pgcrypto-encrypted schema
--  Run in Supabase SQL Editor as postgres superuser
-- ═══════════════════════════════════════════════════════════════════

-- Enable pgcrypto for server-side encryption helpers
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── User profiles (extends Supabase auth.users) ──────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  text,
  currency      text NOT NULL DEFAULT 'INR',   -- user's base currency
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_self" ON profiles FOR ALL USING (auth.uid() = id);

-- ── Custom asset types (per user) ────────────────────────────────
CREATE TABLE IF NOT EXISTS asset_types (
  id            text PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label         text NOT NULL,
  icon          text DEFAULT '📦',
  color         text DEFAULT '#c9a84c',
  price_source  text DEFAULT 'MANUAL',   -- MANUAL | YAHOO | MFAPI
  currency      text DEFAULT 'INR',
  is_default    boolean DEFAULT false,
  created_at    timestamptz DEFAULT now()
);
ALTER TABLE asset_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "asset_types_owner" ON asset_types FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_asset_types_user ON asset_types(user_id);

-- ── Portfolio metadata (members, goals, alerts) ───────────────────
CREATE TABLE IF NOT EXISTS portfolio (
  id            text PRIMARY KEY,           -- = user_id (one row per user)
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  members       jsonb DEFAULT '[]',
  goals         jsonb DEFAULT '[]',
  alerts        jsonb DEFAULT '[]',
  updated_at    timestamptz DEFAULT now()
);
ALTER TABLE portfolio ENABLE ROW LEVEL SECURITY;
CREATE POLICY "portfolio_owner" ON portfolio FOR ALL USING (auth.uid() = user_id);

-- ── Holdings ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS holdings (
  id              text PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id       text,
  name            text NOT NULL,                     -- encrypted (pgp_sym_encrypt)
  type            text NOT NULL,
  ticker          text,
  scheme_code     text,
  interest_rate   numeric,
  start_date      date,
  maturity_date   date,
  purchase_value  numeric,
  current_value   numeric,
  current_price   numeric,
  current_nav     numeric,
  principal       numeric,
  usd_inr_rate    numeric DEFAULT 83.5,
  currency        text DEFAULT 'INR',
  price_fetched_at timestamptz,
  created_at      timestamptz DEFAULT now()
);
ALTER TABLE holdings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "holdings_owner" ON holdings FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_holdings_user ON holdings(user_id);

-- ── Transactions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id            text PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  holding_id    text NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
  txn_type      text NOT NULL DEFAULT 'BUY',
  units         numeric NOT NULL,
  price         numeric NOT NULL,
  price_usd     numeric,
  txn_date      date NOT NULL,
  notes         text DEFAULT '',
  created_at    timestamptz DEFAULT now()
);
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "transactions_owner" ON transactions FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user    ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_holding ON transactions(holding_id);

-- ── Artifacts (documents per holding) ────────────────────────────
CREATE TABLE IF NOT EXISTS artifacts (
  id            text PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  holding_id    text NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
  file_name     text,
  storage_path  text,
  file_type     text,
  file_size     integer,
  description   text,
  uploaded_at   timestamptz DEFAULT now()
);
ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "artifacts_owner" ON artifacts FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_holding ON artifacts(holding_id);

-- ── Budget statements ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budget_statements (
  id             text PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source         text NOT NULL,
  statement_type text NOT NULL,
  filename       text NOT NULL,
  file_size      integer,
  period_start   date,
  period_end     date,
  txn_count      integer DEFAULT 0,
  upload_date    timestamptz DEFAULT now(),
  notes          text DEFAULT ''
);
ALTER TABLE budget_statements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "budget_statements_owner" ON budget_statements FOR ALL USING (auth.uid() = user_id);

-- ── Budget transactions (description encrypted) ───────────────────
CREATE TABLE IF NOT EXISTS budget_transactions (
  id            text PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  statement_id  text NOT NULL REFERENCES budget_statements(id) ON DELETE CASCADE,
  txn_date      date NOT NULL,
  description   text NOT NULL,   -- AES-256 encrypted at app layer
  amount        numeric NOT NULL,
  txn_type      text NOT NULL,
  category      text NOT NULL DEFAULT 'Other',
  balance       text,
  ref_number    text,
  created_at    timestamptz DEFAULT now()
);
ALTER TABLE budget_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "budget_txns_owner" ON budget_transactions FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_budget_txns_user      ON budget_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_budget_txns_statement ON budget_transactions(statement_id);

-- ── Budget categories ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budget_categories (
  id            text PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  color         text DEFAULT '#c9a84c',
  icon          text DEFAULT '📁',
  monthly_limit numeric DEFAULT 0,
  keywords      text DEFAULT ''
);
ALTER TABLE budget_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "budget_cats_owner" ON budget_categories FOR ALL USING (auth.uid() = user_id);

-- ── Auto-provision profile + default asset types on signup ────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Create profile
  INSERT INTO public.profiles (id, display_name, currency)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)), 'INR')
  ON CONFLICT (id) DO NOTHING;

  -- Seed default budget categories
  INSERT INTO public.budget_categories (id, user_id, name, color, icon, monthly_limit, keywords) VALUES
    (concat('cat_food_',  NEW.id::text), NEW.id,'Food & Dining',  '#e07c5a','🍽️', 0,'swiggy,zomato,restaurant,cafe,food'),
    (concat('cat_groc_',  NEW.id::text), NEW.id,'Groceries',      '#4caf9a','🛒', 0,'bigbasket,blinkit,dmart,grocery,supermarket'),
    (concat('cat_trans_', NEW.id::text), NEW.id,'Transport',      '#5a9ce0','🚗', 0,'uber,ola,metro,fuel,petrol,parking,fastag'),
    (concat('cat_shop_',  NEW.id::text), NEW.id,'Shopping',       '#a084ca','🛍️', 0,'amazon,flipkart,myntra,mall'),
    (concat('cat_hlth_',  NEW.id::text), NEW.id,'Health',         '#4caf9a','🏥', 0,'pharmacy,hospital,clinic,doctor,apollo'),
    (concat('cat_util_',  NEW.id::text), NEW.id,'Bills & Utilities','#c9a84c','💡',0,'electricity,water,gas,broadband,jio,airtel'),
    (concat('cat_emi_',   NEW.id::text), NEW.id,'EMIs & Loans',   '#e07c5a','🏦', 0,'emi,loan,housing,hdfc,icici,sbi,axis'),
    (concat('cat_inv_',   NEW.id::text), NEW.id,'Investments',    '#c9a84c','📈', 0,'mutual fund,sip,zerodha,groww,upstox,stock'),
    (concat('cat_trf_',   NEW.id::text), NEW.id,'Transfers',      '#6b6356','↔️', 0,'neft,rtgs,imps,upi,transfer'),
    (concat('cat_oth_',   NEW.id::text), NEW.id,'Other',          '#6b6356','📦', 0,'')
  ON CONFLICT (id) DO NOTHING;

  -- Seed default asset types (user can add/remove/edit)
  INSERT INTO public.asset_types (id, user_id, label, icon, color, price_source, currency, is_default) VALUES
    (concat('at_instock_', NEW.id), NEW.id, 'Indian Stock',  '📈', '#e07c5a', 'YAHOO',  'INR',  true),
    (concat('at_inetf_',   NEW.id), NEW.id, 'Indian ETF',    '🏷️', '#f0a050', 'YAHOO',  'INR',  true),
    (concat('at_mf_',      NEW.id), NEW.id, 'Mutual Fund',   '🌀', '#a084ca', 'MFAPI',  'INR',  true),
    (concat('at_usstock_', NEW.id), NEW.id, 'US Stock',      '🇺🇸', '#5a9ce0', 'YAHOO', 'USD',  true),
    (concat('at_fd_',      NEW.id), NEW.id, 'Fixed Deposit', '🏛️', '#4caf9a', 'MANUAL', 'INR',  true),
    (concat('at_ppf_',     NEW.id), NEW.id, 'PPF',           '🏦', '#c9a84c', 'MANUAL', 'INR',  true),
    (concat('at_epf_',     NEW.id), NEW.id, 'EPF',           '🏦', '#c9a84c', 'MANUAL', 'INR',  true),
    (concat('at_re_',      NEW.id), NEW.id, 'Real Estate',   '🏠', '#4caf9a', 'MANUAL', 'INR',  true),
    (concat('at_gold_',    NEW.id), NEW.id, 'Gold',          '✨', '#c9a84c', 'YAHOO',  'INR',  false),
    (concat('at_crypto_',  NEW.id), NEW.id, 'Crypto',        '₿',  '#f0a050', 'YAHOO',  'USD',  false)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ── Encryption key rotation audit log ─────────────────────────────
CREATE TABLE IF NOT EXISTS encryption_audit (
  id            bigserial PRIMARY KEY,
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  event         text NOT NULL,   -- 'key_created' | 'data_exported' | 'account_deleted'
  ip_address    inet,
  created_at    timestamptz DEFAULT now()
);
ALTER TABLE encryption_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_owner" ON encryption_audit FOR SELECT USING (auth.uid() = user_id);

