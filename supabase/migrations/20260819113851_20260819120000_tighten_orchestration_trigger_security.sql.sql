-- Tighten security on the 3 SECURITY DEFINER trigger functions added in the orchestration migration.
-- These are trigger-only functions and should NOT be callable via the REST API.

-- 1. enforce_single_country_currency
CREATE OR REPLACE FUNCTION public.enforce_single_country_currency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.destination_currency IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.plans
    WHERE id = NEW.plan_id
    AND (
      destination_currency IS NOT NULL
      AND destination_currency != NEW.destination_currency
    )
  ) THEN
    RAISE EXCEPTION 'All commitments in a plan must use the same destination currency';
  END IF;

  RETURN NEW;
END;
$$;

-- 2. enforce_quote_lock_commitments
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
  WHERE id = NEW.plan_id;

  IF locked_at IS NOT NULL THEN
    IF NEW.amount_gbp IS DISTINCT FROM OLD.amount_gbp
       OR NEW.amount_destination IS DISTINCT FROM OLD.amount_destination
       OR NEW.fx_rate IS DISTINCT FROM OLD.fx_rate
       OR NEW.receiving_method IS DISTINCT FROM OLD.receiving_method
       OR NEW.payout_method IS DISTINCT FROM OLD.payout_method
       OR NEW.recipient_snapshot IS DISTINCT FROM OLD.recipient_snapshot
       OR NEW.destination_currency IS DISTINCT FROM OLD.destination_currency
    THEN
      RAISE EXCEPTION 'Cannot modify financial fields after quote is locked';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. recalc_plan_status_from_commitments
CREATE OR REPLACE FUNCTION public.recalc_plan_status_from_commitments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  total_count int;
  completed_count int;
  failed_count int;
  processing_count int;
  current_status text;
BEGIN
  SELECT status INTO current_status
  FROM public.plans
  WHERE id = NEW.plan_id;

  IF current_status NOT IN ('funded', 'payouts_processing', 'partially_failed', 'completed', 'failed') THEN
    RETURN NEW;
  END IF;

  SELECT count(*), 
         count(*) FILTER (WHERE status = 'completed'),
         count(*) FILTER (WHERE status = 'failed'),
         count(*) FILTER (WHERE status IN ('submitted', 'processing'))
  INTO total_count, completed_count, failed_count, processing_count
  FROM public.commitments
  WHERE plan_id = NEW.plan_id;

  IF completed_count = total_count THEN
    UPDATE public.plans SET status = 'completed' WHERE id = NEW.plan_id;
  ELSIF failed_count = total_count THEN
    UPDATE public.plans SET status = 'failed' WHERE id = NEW.plan_id;
  ELSIF processing_count > 0 THEN
    UPDATE public.plans SET status = 'payouts_processing' WHERE id = NEW.plan_id;
  ELSIF completed_count > 0 AND failed_count > 0 AND processing_count = 0 THEN
    UPDATE public.plans SET status = 'partially_failed' WHERE id = NEW.plan_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Revoke EXECUTE from all non-internal roles
REVOKE EXECUTE ON FUNCTION public.enforce_single_country_currency() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_quote_lock_commitments() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_plan_status_from_commitments() FROM PUBLIC, anon, authenticated;
