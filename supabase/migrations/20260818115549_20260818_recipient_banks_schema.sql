/*
# Recipient & Bank Payout Schema Extension

## Overview
Extends the remittance schema to support:
1. Flutterwave recipient object creation (storing recipient_type and verified account_name)
2. Bank account payouts (new payout_corridor_banks table for cached bank lists)
3. Bank support flag on payout_corridor_countries

## Changes to existing tables

### recipients (new columns)
- `flutterwave_recipient_type` (text) - Flutterwave recipient type string (e.g. mobile_money_kes, bank_ngn)
- `flutterwave_account_name` (text) - Verified account holder name returned by Flutterwave on recipient creation
- `currency` (text) - Destination currency for this recipient (already in types but not in DB)
- `flutterwave_network_code` (text) - Network code for mobile money (already in types but not in DB)
- `flutterwave_bank_name` (text) - Bank name for bank account recipients (already in types but not in DB)

### payout_corridor_countries (new column)
- `bank_supported` (boolean, default false) - whether bank transfers are supported for this country

## New tables

### payout_corridor_banks
- Cached bank lists per country, synced from Flutterwave GET /banks endpoint
- `id` (uuid, PK)
- `country_code` (text, FK to payout_corridor_countries) - destination country
- `bank_code` (text) - Flutterwave bank code
- `bank_name` (text) - human-readable bank name
- `last_synced_at` (timestamptz) - last sync run
- Unique on (country_code, bank_code)
- Readable by authenticated users (reference data), writes via service role only

## Security
- RLS enabled on payout_corridor_banks.
- SELECT-only policy for authenticated users on payout_corridor_banks.
- Existing RLS policies on recipients remain unchanged; new columns inherit table-level policies.
*/

-- =========================================================
-- recipients: new columns for Flutterwave recipient objects
-- =========================================================
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS flutterwave_recipient_type text;
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS flutterwave_account_name text;
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS flutterwave_network_code text;
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS flutterwave_bank_name text;

-- =========================================================
-- payout_corridor_countries: bank support flag
-- =========================================================
ALTER TABLE payout_corridor_countries ADD COLUMN IF NOT EXISTS bank_supported boolean NOT NULL DEFAULT false;

-- =========================================================
-- payout_corridor_banks (reference data, authenticated read-only)
-- =========================================================
CREATE TABLE IF NOT EXISTS payout_corridor_banks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL REFERENCES payout_corridor_countries(country_code) ON DELETE CASCADE,
  bank_code text NOT NULL,
  bank_name text,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_code, bank_code)
);
ALTER TABLE payout_corridor_banks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_corridor_banks" ON payout_corridor_banks;
CREATE POLICY "select_corridor_banks" ON payout_corridor_banks FOR SELECT
  TO authenticated USING (true);

-- =========================================================
-- Indexes
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_payout_corridor_banks_country ON payout_corridor_banks(country_code);