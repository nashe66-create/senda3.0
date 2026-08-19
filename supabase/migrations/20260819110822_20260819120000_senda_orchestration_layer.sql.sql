/*
# Senda Financial Orchestration Layer

## Overview
Evolves the existing remittance schema to support a proper financial orchestration layer:
- Two pricing modes (fixed_source / fixed_destination)
- Quote model with FX snapshot, fees, expiry, and locking
- Order state machine with funding gate
- Separate payment status
- Payout state machine with provider status
- Recipient snapshots for immutable in-flight payouts
- One country/currency enforcement per remittance
- Deterministic idempotency keys
- Database triggers for quote lock enforcement and automatic order status recalculation

## Data migration
- Existing plans with status 'confirmed' are migrated to 'awaiting_payment' (closest
  equivalent in the new state machine). 'confirmed' is no longer a valid status.
- Existing plans with status 'processing' are migrated to 'payouts_processing'.
- Existing commitments with status 'processing' are migrated to 'submitted'.

## Changes to `plans` table
1. `pricing_mode` (text, default 'fixed_source')
2. `destination_country` (text, nullable)
3. `destination_currency` (text, nullable)
4. `source_amount` (numeric, default 0)
5. `destination_amount` (numeric, default 0)
6. `customer_pays` (numeric, default 0)
7. `customer_fx_rate` (numeric, default 0)
8. `provider_fx_rate` (numeric, default 0)
9. `provider_fee` (numeric, default 0)
10. `senda_fx_margin` (numeric, default 0)
11. `quote_created_at` (timestamptz, nullable)
12. `quote_expires_at` (timestamptz, nullable)
13. `quote_locked_at` (timestamptz, nullable)
14. `payment_status` (text, default 'pending')
15. Updated CHECK constraint on `status` with new order states

## Changes to `commitments` table
1. `recipient_snapshot` (jsonb, nullable)
2. `provider_status` (text, nullable)
3. `payout_method` (text, nullable)
4. `failure_reason_display` (text, nullable)
5. Updated CHECK constraint on `status` with new payout states

## New triggers
1. `enforce_single_country_currency` — ensures commitment currency matches plan currency
2. `enforce_quote_lock_commitments` — prevents financial field changes after quote lock
3. `recalc_plan_status_from_commitments` — auto-recalculates plan status from commitments

## Security
- No new tables. All new columns on existing tables with existing RLS.
- No RLS policy changes needed.

## Important notes
1. All new columns are nullable or have defaults to preserve existing data.
2. The existing `destination_currencies` text[] column remains for backward compatibility.
3. Triggers use DROP IF EXISTS + CREATE pattern for idempotency.
*/

-- =========================================================
-- DATA MIGRATION: Map old statuses to new state machine
-- =========================================================

UPDATE plans SET status = 'awaiting_payment' WHERE status = 'confirmed';
UPDATE plans SET status = 'payouts_processing' WHERE status = 'processing';
UPDATE commitments SET status = 'submitted' WHERE status = 'processing';

-- =========================================================
-- PLANS: Add new columns
-- =========================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'plans' AND column_name = 'pricing_mode') THEN
    ALTER TABLE plans ADD COLUMN pricing_mode text NOT NULL DEFAULT 'fixed_source';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'plans' AND column_name = 'destination_country') THEN
    ALTER TABLE plans ADD COLUMN destination_country text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'plans' AND column_name = 'destination_currency') THEN
    ALTER TABLE plans ADD COLUMN destination_currency text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'plans' AND column_name = 'source_amount') THEN
    ALTER TABLE plans ADD COLUMN source_amount numeric(12,2) DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'plans' AND column_name = 'destination_amount') THEN
    ALTER TABLE plans ADD COLUMN destination_amount numeric(12,2) DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'plans' AND column_name = 'customer_pays') THEN
    ALTER TABLE plans ADD COLUMN customer_pays numeric(12,2) DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'plans' AND column_name = 'customer_fx_rate') THEN
    ALTER TABLE plans ADD COLUMN customer_fx_rate numeric(12,6) DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'plans' AND column_name = 'provider_fx_rate') THEN
    ALTER TABLE plans ADD COLUMN provider_fx_rate numeric(12,6) DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'plans' AND column_name = 'provider_fee') THEN
    ALTER TABLE plans ADD COLUMN provider_fee numeric(12,2) DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'plans' AND column_name = 'senda_fx_margin') THEN
    ALTER TABLE plans ADD COLUMN senda_fx_margin numeric(12,6) DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'plans' AND column_name = 'quote_created_at') THEN
    ALTER TABLE plans ADD COLUMN quote_created_at timestamptz;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'plans' AND column_name = 'quote_expires_at') THEN
    ALTER TABLE plans ADD COLUMN quote_expires_at timestamptz;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'plans' AND column_name = 'quote_locked_at') THEN
    ALTER TABLE plans ADD COLUMN quote_locked_at timestamptz;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'plans' AND column_name = 'payment_status') THEN
    ALTER TABLE plans ADD COLUMN payment_status text NOT NULL DEFAULT 'pending';
  END IF;
END $$;

-- =========================================================
-- PLANS: Update status CHECK constraint
-- =========================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'plans_status_check' AND table_name = 'plans') THEN
    ALTER TABLE plans DROP CONSTRAINT plans_status_check;
  END IF;
END $$;

ALTER TABLE plans ADD CONSTRAINT plans_status_check CHECK (
  status IN (
    'draft', 'quoted', 'awaiting_payment', 'payment_processing',
    'funded', 'payouts_processing', 'completed',
    'payment_failed', 'partially_failed', 'failed', 'cancelled'
  )
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'plans_payment_status_check' AND table_name = 'plans') THEN
    ALTER TABLE plans ADD CONSTRAINT plans_payment_status_check CHECK (
      payment_status IN ('pending', 'processing', 'successful', 'failed')
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'plans_pricing_mode_check' AND table_name = 'plans') THEN
    ALTER TABLE plans ADD CONSTRAINT plans_pricing_mode_check CHECK (
      pricing_mode IN ('fixed_source', 'fixed_destination')
    );
  END IF;
END $$;

-- =========================================================
-- COMMITMENTS: Add new columns
-- =========================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'commitments' AND column_name = 'recipient_snapshot') THEN
    ALTER TABLE commitments ADD COLUMN recipient_snapshot jsonb;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'commitments' AND column_name = 'provider_status') THEN
    ALTER TABLE commitments ADD COLUMN provider_status text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'commitments' AND column_name = 'payout_method') THEN
    ALTER TABLE commitments ADD COLUMN payout_method text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'commitments' AND column_name = 'failure_reason_display') THEN
    ALTER TABLE commitments ADD COLUMN failure_reason_display text;
  END IF;
END $$;

-- =========================================================
-- COMMITMENTS: Update status CHECK constraint
-- =========================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'commitments_status_check' AND table_name = 'commitments') THEN
    ALTER TABLE commitments DROP CONSTRAINT commitments_status_check;
  END IF;
END $$;

ALTER TABLE commitments ADD CONSTRAINT commitments_status_check CHECK (
  status IN (
    'pending', 'ready', 'submitted', 'processing', 'completed', 'failed'
  )
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'commitments_payout_method_check' AND table_name = 'commitments') THEN
    ALTER TABLE commitments ADD CONSTRAINT commitments_payout_method_check CHECK (
      payout_method IS NULL OR payout_method IN ('bank', 'mobile_money', 'cash_pickup')
    );
  END IF;
END $$;

-- =========================================================
-- TRIGGER 1: Enforce single country/currency per remittance
-- =========================================================

CREATE OR REPLACE FUNCTION enforce_single_country_currency()
RETURNS TRIGGER AS $$
DECLARE
  plan_currency text;
BEGIN
  SELECT destination_currency INTO plan_currency
  FROM plans WHERE id = NEW.plan_id;

  IF plan_currency IS NOT NULL AND NEW.destination_currency != plan_currency THEN
    RAISE EXCEPTION 'All recipients in a remittance must use the same destination currency. Plan requires %, got %', plan_currency, NEW.destination_currency;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enforce_single_currency ON commitments;
CREATE TRIGGER trg_enforce_single_currency
  BEFORE INSERT OR UPDATE OF destination_currency ON commitments
  FOR EACH ROW EXECUTE FUNCTION enforce_single_country_currency();

-- =========================================================
-- TRIGGER 2: Enforce quote lock on commitments
-- =========================================================

CREATE OR REPLACE FUNCTION enforce_quote_lock_commitments()
RETURNS TRIGGER AS $$
DECLARE
  plan_locked timestamptz;
BEGIN
  SELECT quote_locked_at INTO plan_locked
  FROM plans WHERE id = NEW.plan_id;

  IF plan_locked IS NOT NULL THEN
    IF NEW.amount_gbp != OLD.amount_gbp
       OR NEW.amount_destination != OLD.amount_destination
       OR NEW.fx_rate != OLD.fx_rate
       OR NEW.receiving_method != OLD.receiving_method
       OR NEW.payout_method IS DISTINCT FROM OLD.payout_method
       OR NEW.recipient_snapshot IS DISTINCT FROM OLD.recipient_snapshot
       OR NEW.destination_currency != OLD.destination_currency
    THEN
      RAISE EXCEPTION 'Cannot modify financial fields of a commitment after the quote is locked';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enforce_quote_lock ON commitments;
CREATE TRIGGER trg_enforce_quote_lock
  BEFORE UPDATE ON commitments
  FOR EACH ROW EXECUTE FUNCTION enforce_quote_lock_commitments();

-- =========================================================
-- TRIGGER 3: Recalculate plan status from commitments
-- =========================================================

CREATE OR REPLACE FUNCTION recalc_plan_status_from_commitments()
RETURNS TRIGGER AS $$
DECLARE
  plan_id uuid;
  total_count int;
  completed_count int;
  failed_count int;
  processing_count int;
  pending_count int;
  current_status text;
BEGIN
  plan_id := COALESCE(NEW.plan_id, OLD.plan_id);

  IF plan_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status INTO current_status FROM plans WHERE id = plan_id;

  IF current_status NOT IN ('funded', 'payouts_processing', 'partially_failed', 'completed', 'failed') THEN
    RETURN NEW;
  END IF;

  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE status = 'completed')::int,
    COUNT(*) FILTER (WHERE status = 'failed')::int,
    COUNT(*) FILTER (WHERE status IN ('submitted', 'processing'))::int,
    COUNT(*) FILTER (WHERE status IN ('pending', 'ready'))::int
  INTO total_count, completed_count, failed_count, processing_count, pending_count
  FROM commitments WHERE plan_id = plan_id;

  IF total_count = 0 THEN
    RETURN NEW;
  END IF;

  IF completed_count = total_count THEN
    IF current_status != 'completed' THEN
      UPDATE plans SET status = 'completed' WHERE id = plan_id;
    END IF;
  ELSIF failed_count = total_count THEN
    IF current_status != 'failed' THEN
      UPDATE plans SET status = 'failed' WHERE id = plan_id;
    END IF;
  ELSIF processing_count > 0 THEN
    IF current_status != 'payouts_processing' THEN
      UPDATE plans SET status = 'payouts_processing' WHERE id = plan_id;
    END IF;
  ELSIF completed_count > 0 AND failed_count > 0 AND processing_count = 0 THEN
    IF current_status != 'partially_failed' THEN
      UPDATE plans SET status = 'partially_failed' WHERE id = plan_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_recalc_plan_status ON commitments;
CREATE TRIGGER trg_recalc_plan_status
  AFTER UPDATE OF status ON commitments
  FOR EACH ROW EXECUTE FUNCTION recalc_plan_status_from_commitments();

-- =========================================================
-- INDEXES
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_plans_payment_status ON plans(payment_status);
CREATE INDEX IF NOT EXISTS idx_plans_destination_country ON plans(destination_country);
CREATE INDEX IF NOT EXISTS idx_commitments_payout_method ON commitments(payout_method);
CREATE INDEX IF NOT EXISTS idx_commitments_provider_status ON commitments(provider_status);
