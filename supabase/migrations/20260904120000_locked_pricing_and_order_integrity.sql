-- Locked quote pricing and authoritative remittance-order integrity.

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS senda_fee numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processing_fee numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_collection_cost numeric(12,2);

ALTER TABLE transfer_attempts
  ADD COLUMN IF NOT EXISTS actual_provider_payout_cost numeric(12,2),
  ADD COLUMN IF NOT EXISTS actual_provider_payout_cost_currency text,
  ADD COLUMN IF NOT EXISTS provider_cost_observed_at timestamptz;

CREATE OR REPLACE FUNCTION public.enforce_commitment_order_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  plan_row public.plans%ROWTYPE;
  recipient_country text;
  recipient_currency text;
  commitment_count integer;
BEGIN
  SELECT * INTO plan_row
  FROM public.plans
  WHERE id = NEW.plan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found for commitment';
  END IF;

  IF TG_OP = 'INSERT' AND plan_row.quote_locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot add commitments after quote is locked';
  END IF;

  SELECT country, currency INTO recipient_country, recipient_currency
  FROM public.recipients
  WHERE id = NEW.recipient_id;

  IF plan_row.destination_currency IS NOT NULL
     AND NEW.destination_currency IS DISTINCT FROM plan_row.destination_currency THEN
    RAISE EXCEPTION 'All commitments in a plan must use the same destination currency';
  END IF;

  IF plan_row.destination_country IS NOT NULL
     AND recipient_country IS DISTINCT FROM plan_row.destination_country THEN
    RAISE EXCEPTION 'All commitments in a plan must use the same destination country';
  END IF;

  IF plan_row.destination_currency IS NOT NULL
     AND recipient_currency IS NOT NULL
     AND recipient_currency IS DISTINCT FROM plan_row.destination_currency THEN
    RAISE EXCEPTION 'All recipients in a plan must use the same destination currency';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT count(*) INTO commitment_count
    FROM public.commitments
    WHERE plan_id = NEW.plan_id;

    IF commitment_count >= 5 THEN
      RAISE EXCEPTION 'A remittance order can contain a maximum of 5 recipients';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_commitment_order_rules ON commitments;
CREATE TRIGGER trg_enforce_commitment_order_rules
  BEFORE INSERT OR UPDATE OF plan_id, recipient_id, destination_currency ON commitments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_commitment_order_rules();

CREATE OR REPLACE FUNCTION public.enforce_locked_plan_pricing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.quote_locked_at IS NOT NULL THEN
    IF NEW.source_amount IS DISTINCT FROM OLD.source_amount
       OR NEW.destination_amount IS DISTINCT FROM OLD.destination_amount
       OR NEW.customer_pays IS DISTINCT FROM OLD.customer_pays
       OR NEW.provider_fee IS DISTINCT FROM OLD.provider_fee
       OR NEW.senda_fee IS DISTINCT FROM OLD.senda_fee
       OR NEW.processing_fee IS DISTINCT FROM OLD.processing_fee
       OR NEW.customer_fx_rate IS DISTINCT FROM OLD.customer_fx_rate
       OR NEW.provider_fx_rate IS DISTINCT FROM OLD.provider_fx_rate
       OR NEW.senda_fx_margin IS DISTINCT FROM OLD.senda_fx_margin
       OR NEW.quote_created_at IS DISTINCT FROM OLD.quote_created_at
       OR NEW.quote_expires_at IS DISTINCT FROM OLD.quote_expires_at
       OR NEW.quote_locked_at IS DISTINCT FROM OLD.quote_locked_at THEN
      RAISE EXCEPTION 'Locked quote pricing cannot be modified';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_locked_plan_pricing ON plans;
CREATE TRIGGER trg_enforce_locked_plan_pricing
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION public.enforce_locked_plan_pricing();

CREATE OR REPLACE FUNCTION public.enforce_quote_lock_commitments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  locked_at timestamptz;
BEGIN
  SELECT quote_locked_at INTO locked_at
  FROM public.plans
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.plan_id ELSE NEW.plan_id END;

  IF locked_at IS NOT NULL THEN
    IF TG_OP = 'DELETE'
       OR NEW.amount_gbp IS DISTINCT FROM OLD.amount_gbp
       OR NEW.amount_destination IS DISTINCT FROM OLD.amount_destination
       OR NEW.fx_rate IS DISTINCT FROM OLD.fx_rate
       OR NEW.receiving_method IS DISTINCT FROM OLD.receiving_method
       OR NEW.payout_method IS DISTINCT FROM OLD.payout_method
       OR NEW.recipient_snapshot IS DISTINCT FROM OLD.recipient_snapshot
       OR NEW.destination_currency IS DISTINCT FROM OLD.destination_currency THEN
      RAISE EXCEPTION 'Cannot modify commitments after quote is locked';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_quote_lock ON commitments;
CREATE TRIGGER trg_enforce_quote_lock
  BEFORE UPDATE OR DELETE ON commitments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_quote_lock_commitments();

REVOKE EXECUTE ON FUNCTION public.enforce_quote_lock_commitments() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_order_collection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  plan_row public.plans%ROWTYPE;
BEGIN
  SELECT * INTO plan_row
  FROM public.plans
  WHERE id = NEW.plan_id
  FOR UPDATE;

  IF NOT FOUND OR plan_row.quote_locked_at IS NULL
     OR plan_row.status <> 'awaiting_payment' THEN
    RAISE EXCEPTION 'A customer collection requires an order awaiting payment with a locked quote';
  END IF;

  IF NEW.amount_gbp IS DISTINCT FROM plan_row.customer_pays THEN
    RAISE EXCEPTION 'Customer collection amount must equal the locked customer total';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transactions
    WHERE plan_id = NEW.plan_id
  ) THEN
    RAISE EXCEPTION 'A remittance order can have only one customer collection';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_order_collection ON transactions;
CREATE TRIGGER trg_enforce_order_collection
  BEFORE INSERT ON transactions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_order_collection();

REVOKE EXECUTE ON FUNCTION public.enforce_commitment_order_rules() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_locked_plan_pricing() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_order_collection() FROM PUBLIC, anon, authenticated;