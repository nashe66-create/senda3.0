/*
# Remittance Planning App - Core Schema

## Overview
Creates the database schema for a UK remittance planning app that lets users bundle
multiple international transfers into a single payment. Users create plans, add
commitments (each to a recipient with a specific receiving method), and confirm
once to trigger all transfers via Flutterwave.

## New Tables

### 1. profiles
- Extends auth.users with app-specific user data.
- `id` (uuid, PK, FK to auth.users)
- `email` (text, user's email)
- `full_name` (text, display name)
- `phone` (text, phone number)
- `kyc_status` (text: 'unverified', 'pending', 'verified', 'rejected' — Flutterwave KYC state)
- `flutterwave_customer_id` (text, Flutterwave customer reference)
- `country` (text, default 'GB' — user's base country)
- `created_at` (timestamptz)

### 2. recipients
- Beneficiaries the user sends money to. Can be a person or a bill payment.
- `id` (uuid, PK)
- `user_id` (uuid, FK to auth.users, owner)
- `name` (text, recipient or biller name)
- `country` (text, ISO country code e.g. 'NG', 'ZW')
- `receiving_method` (text: 'mobile_money', 'bank_account', 'cash_pickup', 'bill_payment')
- `phone` (text, recipient phone for mobile money)
- `mobile_money_provider` (text, e.g. 'MPESA', 'MTN', 'AIRTEL')
- `bank_code` (text, Flutterwave bank code)
- `account_number` (text, bank account number)
- `bill_type` (text, for bill payments e.g. 'electricity', 'water')
- `relationship` (text, e.g. 'family', 'friend', 'self')
- `notes` (text, free-form notes)
- `created_at` (timestamptz)

### 3. plans
- A remittance plan: a bundle of commitments paid for by one payment.
- `id` (uuid, PK)
- `user_id` (uuid, FK to auth.users, owner)
- `name` (text, plan name e.g. "Monthly Family Support")
- `status` (text: 'draft', 'confirmed', 'processing', 'completed', 'failed')
- `total_gbp` (numeric, total in GBP — sum of commitments)
- `total_recipients` (int, number of commitments)
- `destination_currencies` (text[], array of currency codes involved)
- `next_run_date` (date, when the plan should execute)
- `recurring` (text: 'one_off', 'weekly', 'biweekly', 'monthly')
- `created_at` (timestamptz)
- `updated_at` (timestamptz)

### 4. commitments
- Individual transfers within a plan, one per recipient.
- `id` (uuid, PK)
- `plan_id` (uuid, FK to plans, ON DELETE CASCADE)
- `recipient_id` (uuid, FK to recipients, ON DELETE SET NULL)
- `user_id` (uuid, FK to auth.users, owner — denormalized for RLS)
- `amount_gbp` (numeric, amount in GBP)
- `destination_currency` (text, e.g. 'NGN', 'ZWL')
- `amount_destination` (numeric, converted amount)
- `fx_rate` (numeric, rate used at time of confirmation)
- `receiving_method` (text, copied from recipient at confirmation time)
- `status` (text: 'pending', 'processing', 'completed', 'failed')
- `flutterwave_transfer_id` (text, Flutterwave transfer reference)
- `failure_reason` (text, if failed)
- `created_at` (timestamptz)

### 5. transactions
- The single GBP payment from the user's bank account for a plan.
- `id` (uuid, PK)
- `plan_id` (uuid, FK to plans, ON DELETE CASCADE)
- `user_id` (uuid, FK to auth.users, owner)
- `amount_gbp` (numeric, total debited)
- `status` (text: 'pending', 'successful', 'failed', 'refunded')
- `payment_reference` (text, internal reference)
- `flutterwave_payment_id` (text, Flutterwave payment reference)
- `created_at` (timestamptz)
- `completed_at` (timestamptz)

### 6. fx_rates
- Cached FX rates from Flutterwave, updated periodically.
- `id` (uuid, PK)
- `source_currency` (text, e.g. 'GBP')
- `destination_currency` (text, e.g. 'NGN')
- `rate` (numeric, exchange rate)
- `fetched_at` (timestamptz)

## Security
- RLS enabled on ALL tables.
- profiles: users can read/update only their own profile.
- recipients: owner-scoped CRUD.
- plans: owner-scoped CRUD.
- commitments: owner-scoped via user_id column (denormalized for simple RLS).
- transactions: owner-scoped CRUD.
- fx_rates: readable by all authenticated users (shared reference data), writes via service role only.
- All owner columns default to auth.uid() so client inserts work without passing user_id.
*/

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text DEFAULT '',
  phone text DEFAULT '',
  kyc_status text NOT NULL DEFAULT 'unverified',
  flutterwave_customer_id text,
  country text NOT NULL DEFAULT 'GB',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_profile" ON profiles;
CREATE POLICY "select_own_profile" ON profiles FOR SELECT
  TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "insert_own_profile" ON profiles;
CREATE POLICY "insert_own_profile" ON profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Recipients table
CREATE TABLE IF NOT EXISTS recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  country text NOT NULL,
  receiving_method text NOT NULL DEFAULT 'mobile_money',
  phone text DEFAULT '',
  mobile_money_provider text DEFAULT '',
  bank_code text DEFAULT '',
  account_number text DEFAULT '',
  bill_type text DEFAULT '',
  relationship text DEFAULT '',
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_recipients" ON recipients;
CREATE POLICY "select_own_recipients" ON recipients FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_recipients" ON recipients;
CREATE POLICY "insert_own_recipients" ON recipients FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_recipients" ON recipients;
CREATE POLICY "update_own_recipients" ON recipients FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_recipients" ON recipients;
CREATE POLICY "delete_own_recipients" ON recipients FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Plans table
CREATE TABLE IF NOT EXISTS plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  total_gbp numeric(12,2) DEFAULT 0,
  total_recipients int DEFAULT 0,
  destination_currencies text[] DEFAULT '{}',
  next_run_date date,
  recurring text NOT NULL DEFAULT 'one_off',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_plans" ON plans;
CREATE POLICY "select_own_plans" ON plans FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_plans" ON plans;
CREATE POLICY "insert_own_plans" ON plans FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_plans" ON plans;
CREATE POLICY "update_own_plans" ON plans FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_plans" ON plans;
CREATE POLICY "delete_own_plans" ON plans FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Commitments table
CREATE TABLE IF NOT EXISTS commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  recipient_id uuid REFERENCES recipients(id) ON DELETE SET NULL,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_gbp numeric(12,2) NOT NULL DEFAULT 0,
  destination_currency text NOT NULL,
  amount_destination numeric(12,2) DEFAULT 0,
  fx_rate numeric(12,4) DEFAULT 0,
  receiving_method text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  flutterwave_transfer_id text,
  failure_reason text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE commitments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_commitments" ON commitments;
CREATE POLICY "select_own_commitments" ON commitments FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_commitments" ON commitments;
CREATE POLICY "insert_own_commitments" ON commitments FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_commitments" ON commitments;
CREATE POLICY "update_own_commitments" ON commitments FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_commitments" ON commitments;
CREATE POLICY "delete_own_commitments" ON commitments FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_gbp numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  payment_reference text,
  flutterwave_payment_id text,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_transactions" ON transactions;
CREATE POLICY "select_own_transactions" ON transactions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_transactions" ON transactions;
CREATE POLICY "insert_own_transactions" ON transactions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_transactions" ON transactions;
CREATE POLICY "update_own_transactions" ON transactions FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_transactions" ON transactions;
CREATE POLICY "delete_own_transactions" ON transactions FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- FX rates table (shared reference data)
CREATE TABLE IF NOT EXISTS fx_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_currency text NOT NULL,
  destination_currency text NOT NULL,
  rate numeric(12,4) NOT NULL,
  fetched_at timestamptz DEFAULT now()
);
ALTER TABLE fx_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_fx_rates" ON fx_rates;
CREATE POLICY "select_fx_rates" ON fx_rates FOR SELECT
  TO authenticated USING (true);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_recipients_user_id ON recipients(user_id);
CREATE INDEX IF NOT EXISTS idx_plans_user_id ON plans(user_id);
CREATE INDEX IF NOT EXISTS idx_commitments_plan_id ON commitments(plan_id);
CREATE INDEX IF NOT EXISTS idx_commitments_user_id ON commitments(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_plan_id ON transactions(plan_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_fx_rates_pair ON fx_rates(source_currency, destination_currency);

-- Auto-update updated_at on plans
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS plans_updated_at ON plans;
CREATE TRIGGER plans_updated_at BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();