/*
# Senda Phase 1 - Flutterwave v4 Integration Schema

## Overview
Extends the existing remittance schema to support:
1. Real KYC submission (sender identity for GBP-source transfers)
2. Card-based GBP collection (Flutterwave direct charges)
3. Mobile money payouts via direct-transfer inline pattern
4. Webhook event deduplication
5. Live-synced payout corridor reference data (replaces hardcoded country lists)
6. Wallet balance caching

## Changes to existing tables

### profiles (new columns)
- `flutterwave_sender_id` (text) - Flutterwave sender reference (sdr_...)
- `kyc_national_id_type` (text) - PASSPORT | DRIVERS_LICENSE | NATIONAL_ID
- `kyc_national_id_number` (text) - national ID number
- `kyc_national_id_expiry` (date) - ID expiry date
- `kyc_date_of_birth` (date) - date of birth
- `kyc_address` (jsonb) - {line1, line2, city, state, postal_code, country}
- `kyc_submitted_at` (timestamptz) - when KYC was submitted
- `kyc_verified_at` (timestamptz) - when KYC was verified (if ever confirmed by Flutterwave)

### recipients (new columns)
- `flutterwave_recipient_id` (text) - Flutterwave recipient reference (if pre-created)
- `payout_type` (text, check: mobile_money | cash_pickup) - payout method discriminator
- `mobile_money_network` (text) - network code e.g. MTN, Mpesa
- `destination_country` (text) - ISO2 country code for the destination
- `cash_pickup_provider` (text) - null until CASH_PICKUP_ENABLED

### transactions (new columns)
- `flutterwave_charge_id` (text) - Flutterwave charge reference for card collection
- `idempotency_key` (text, unique) - idempotency key for card charge
- `next_action_type` (text) - requires_pin | requires_otp | requires_additional_fields | redirect_url | null
- `card_last4` (text) - last 4 digits of card
- `card_network` (text) - card network (Visa, Mastercard, etc.)

### commitments (new columns)
- `flutterwave_transfer_id` (text) - already exists in schema, keeping for clarity
- `idempotency_key` (text, unique) - idempotency key for transfer
- `transfer_action` (text, default 'deferred', check: deferred | instant) - transfer action type

## New tables

### wallet_balance_cache
- Caches Flutterwave wallet balance to avoid hammering API on every screen load
- `currency` (text, PK) - ISO 4217 currency code
- `balance` (numeric) - current balance
- `fetched_at` (timestamptz) - when balance was last fetched
- Service-role only, no client access

### flutterwave_webhook_events
- Deduplicates webhook deliveries from Flutterwave
- `webhook_id` (text, PK) - Flutterwave webhook event ID
- `event_type` (text) - event type string
- `received_at` (timestamptz) - when we received it
- `payload` (jsonb) - full webhook payload
- Service-role only, no client access

### payout_corridor_countries
- Live-synced from Flutterwave, never hardcoded in app code
- `country_code` (text, PK) - ISO2 country code
- `country_name` (text) - human-readable name
- `currency` (text) - ISO 4217 currency code
- `mobile_money_supported` (boolean) - whether mobile money payouts work
- `cash_pickup_supported` (boolean) - stays false until confirmed + CASH_PICKUP_ENABLED
- `last_synced_at` (timestamptz) - last sync run
- Readable by authenticated users (reference data), writes via service role only

### payout_corridor_networks
- Mobile money networks per country, synced from Flutterwave
- `id` (uuid, PK)
- `country_code` (text, FK to payout_corridor_countries) - destination country
- `network_code` (text) - e.g. MTN, Mpesa, orangemoney
- `network_name` (text) - human-readable name
- `last_synced_at` (timestamptz) - last sync run
- Unique on (country_code, network_code)
- Readable by authenticated users, writes via service role only

## Security
- RLS enabled on all new tables.
- wallet_balance_cache and flutterwave_webhook_events: no client policies (service-role only).
- payout_corridor_countries and payout_corridor_networks: SELECT-only for authenticated (reference data).
- Existing RLS policies on profiles, recipients, transactions, commitments remain unchanged.
- New columns on existing tables inherit their table's existing RLS policies.
*/

-- =========================================================
-- profiles: KYC columns
-- =========================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS flutterwave_sender_id text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS kyc_national_id_type text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS kyc_national_id_number text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS kyc_national_id_expiry date;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS kyc_date_of_birth date;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS kyc_address jsonb;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS kyc_submitted_at timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS kyc_verified_at timestamptz;

-- =========================================================
-- recipients: payout-type discriminator + Flutterwave IDs
-- =========================================================
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS flutterwave_recipient_id text;
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS payout_type text CHECK (payout_type IN ('mobile_money', 'cash_pickup'));
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS mobile_money_network text;
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS destination_country text;
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS cash_pickup_provider text;

-- =========================================================
-- transactions: card charge columns
-- =========================================================
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS flutterwave_charge_id text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS idempotency_key text UNIQUE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS next_action_type text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS card_last4 text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS card_network text;

-- =========================================================
-- commitments: transfer columns
-- =========================================================
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS idempotency_key text UNIQUE;
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS transfer_action text DEFAULT 'deferred' CHECK (transfer_action IN ('deferred', 'instant'));

-- =========================================================
-- wallet_balance_cache (service-role only)
-- =========================================================
CREATE TABLE IF NOT EXISTS wallet_balance_cache (
  currency text PRIMARY KEY,
  balance numeric NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE wallet_balance_cache ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- flutterwave_webhook_events (service-role only)
-- =========================================================
CREATE TABLE IF NOT EXISTS flutterwave_webhook_events (
  webhook_id text PRIMARY KEY,
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL
);
ALTER TABLE flutterwave_webhook_events ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- payout_corridor_countries (reference data, authenticated read-only)
-- =========================================================
CREATE TABLE IF NOT EXISTS payout_corridor_countries (
  country_code text PRIMARY KEY,
  country_name text NOT NULL,
  currency text NOT NULL,
  mobile_money_supported boolean NOT NULL DEFAULT false,
  cash_pickup_supported boolean NOT NULL DEFAULT false,
  last_synced_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE payout_corridor_countries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_corridor_countries" ON payout_corridor_countries;
CREATE POLICY "select_corridor_countries" ON payout_corridor_countries FOR SELECT
  TO authenticated USING (true);

-- =========================================================
-- payout_corridor_networks (reference data, authenticated read-only)
-- =========================================================
CREATE TABLE IF NOT EXISTS payout_corridor_networks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL REFERENCES payout_corridor_countries(country_code) ON DELETE CASCADE,
  network_code text NOT NULL,
  network_name text,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_code, network_code)
);
ALTER TABLE payout_corridor_networks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_corridor_networks" ON payout_corridor_networks;
CREATE POLICY "select_corridor_networks" ON payout_corridor_networks FOR SELECT
  TO authenticated USING (true);

-- =========================================================
-- Indexes
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_payout_corridor_networks_country ON payout_corridor_networks(country_code);
CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at ON flutterwave_webhook_events(received_at);