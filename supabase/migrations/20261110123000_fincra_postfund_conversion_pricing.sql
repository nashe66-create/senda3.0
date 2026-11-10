ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS conversion_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS fincra_conversion_quote_reference text,
  ADD COLUMN IF NOT EXISTS conversion_source_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS conversion_destination_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS conversion_rate numeric(18,8),
  ADD COLUMN IF NOT EXISTS conversion_fee numeric(14,2),
  ADD COLUMN IF NOT EXISTS conversion_expires_at timestamptz;

ALTER TABLE public.commitments
  ADD COLUMN IF NOT EXISTS fincra_payout_customer_reference text;

CREATE UNIQUE INDEX IF NOT EXISTS commitments_fincra_payout_customer_reference_unique
  ON public.commitments (fincra_payout_customer_reference)
  WHERE fincra_payout_customer_reference IS NOT NULL;

ALTER TABLE public.plans
  DROP CONSTRAINT IF EXISTS plans_conversion_status_check;

ALTER TABLE public.plans
  ADD CONSTRAINT plans_conversion_status_check
  CHECK (conversion_status IN (
    'not_started', 'quote_pending', 'quoted', 'initiating', 'initiating_unknown',
    'processing', 'confirmed', 'failed', 'reconciliation_required'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS plans_fincra_conversion_quote_reference_unique
  ON public.plans (fincra_conversion_quote_reference)
  WHERE fincra_conversion_quote_reference IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_locked_plan_pricing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  allow_conversion_reprice boolean :=
    coalesce(
      current_setting('app.fincra_conversion_reprice', true) = 'on'
      AND coalesce(
        nullif(current_setting('request.jwt.claim.role', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
      ) = 'service_role',
      false
    );
BEGIN
  IF OLD.quote_locked_at IS NOT NULL AND NOT allow_conversion_reprice THEN
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

CREATE OR REPLACE FUNCTION public.enforce_quote_lock_commitments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  plan_row public.plans%ROWTYPE;
  allow_conversion_reprice boolean :=
    coalesce(
      current_setting('app.fincra_conversion_reprice', true) = 'on'
      AND coalesce(
        nullif(current_setting('request.jwt.claim.role', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
      ) = 'service_role',
      false
    );
BEGIN
  SELECT * INTO plan_row
  FROM public.plans
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.plan_id ELSE NEW.plan_id END;

  IF plan_row.quote_locked_at IS NOT NULL AND NOT allow_conversion_reprice THEN
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

CREATE OR REPLACE FUNCTION public.apply_fincra_conversion_quote(
  p_plan_id uuid,
  p_quote_reference text,
  p_source_amount numeric,
  p_destination_amount numeric,
  p_rate numeric,
  p_fee numeric,
  p_expires_at timestamptz,
  p_commitments jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  plan_row public.plans%ROWTYPE;
  commitment_count integer;
  submitted_count integer;
  updated_count integer;
  submitted_total numeric;
BEGIN
  IF coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  ) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required to apply a Fincra conversion quote';
  END IF;

  IF nullif(trim(coalesce(p_quote_reference, '')), '') IS NULL
     OR p_source_amount IS NULL OR p_source_amount <= 0
     OR p_destination_amount IS NULL OR p_destination_amount <= 0
     OR p_rate IS NULL OR p_rate <= 0
     OR p_fee IS NULL OR p_fee < 0
     OR p_expires_at IS NULL OR p_expires_at <= now()
     OR jsonb_typeof(p_commitments) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid Fincra conversion quote';
  END IF;

  SELECT * INTO plan_row
  FROM public.plans
  WHERE id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND
     OR plan_row.pricing_mode IS DISTINCT FROM 'fixed_source'
     OR plan_row.payment_status IS DISTINCT FROM 'successful'
     OR plan_row.status IS DISTINCT FROM 'funded'
     OR plan_row.quote_locked_at IS NULL
     OR plan_row.fincra_conversion_status IS NOT NULL
     OR plan_row.conversion_status IS DISTINCT FROM 'quote_pending'
     OR abs(coalesce(plan_row.source_amount, 0) - p_source_amount) > 0.01 THEN
    RAISE EXCEPTION 'Plan is not eligible for post-funding fixed-source repricing';
  END IF;

  SELECT count(*) INTO commitment_count
  FROM public.commitments
  WHERE plan_id = p_plan_id;

  SELECT count(*), coalesce(sum(item.destination_amount), 0)
  INTO submitted_count, submitted_total
  FROM jsonb_to_recordset(p_commitments) AS item(
    commitment_id uuid,
    destination_amount numeric,
    fx_rate numeric
  );

  IF commitment_count = 0
     OR submitted_count <> commitment_count
     OR abs(submitted_total - p_destination_amount) > 0.01
     OR EXISTS (
       SELECT 1
       FROM jsonb_to_recordset(p_commitments) AS item(
         commitment_id uuid,
         destination_amount numeric,
         fx_rate numeric
       )
       LEFT JOIN public.commitments c
         ON c.id = item.commitment_id AND c.plan_id = p_plan_id
       WHERE c.id IS NULL
          OR item.destination_amount <= 0
          OR item.fx_rate <= 0
     )
     OR submitted_count <> (
       SELECT count(DISTINCT item.commitment_id)
       FROM jsonb_to_recordset(p_commitments) AS item(
         commitment_id uuid,
         destination_amount numeric,
         fx_rate numeric
       )
     ) THEN
    RAISE EXCEPTION 'Fincra conversion quote allocation does not match plan commitments';
  END IF;

  PERFORM set_config('app.fincra_conversion_reprice', 'on', true);

  UPDATE public.plans
  SET destination_amount = p_destination_amount,
      customer_fx_rate = p_rate,
      provider_fx_rate = p_rate,
      quote_rate = p_rate,
      provider_fee = p_fee,
      processing_fee = p_fee,
      quote_amount_to_receive = p_destination_amount,
      quote_fee = p_fee,
      fincra_conversion_quote_reference = p_quote_reference,
      conversion_source_amount = p_source_amount,
      conversion_destination_amount = p_destination_amount,
      conversion_rate = p_rate,
      conversion_fee = p_fee,
      conversion_expires_at = p_expires_at,
      conversion_status = 'quoted'
  WHERE id = p_plan_id;

  UPDATE public.commitments c
  SET amount_destination = item.destination_amount,
      fx_rate = item.fx_rate,
      recipient_snapshot = jsonb_set(
        CASE WHEN jsonb_typeof(c.recipient_snapshot) = 'object'
          THEN c.recipient_snapshot ELSE '{}'::jsonb END,
        '{amount_destination}',
        to_jsonb(item.destination_amount),
        true
      )
  FROM jsonb_to_recordset(p_commitments) AS item(
    commitment_id uuid,
    destination_amount numeric,
    fx_rate numeric
  )
  WHERE c.id = item.commitment_id AND c.plan_id = p_plan_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> commitment_count THEN
    RAISE EXCEPTION 'Could not apply Fincra quote to every plan commitment';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'plan_id', p_plan_id,
    'source_amount', p_source_amount,
    'destination_amount', p_destination_amount,
    'quote_reference', p_quote_reference,
    'quote_expires_at', p_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_fincra_conversion_quote(uuid, text, numeric, numeric, numeric, numeric, timestamptz, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_fincra_conversion_quote(uuid, text, numeric, numeric, numeric, numeric, timestamptz, jsonb)
  TO service_role;