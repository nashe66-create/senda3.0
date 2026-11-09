BEGIN;

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS fincra_conversion_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS fincra_conversion_currency text;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS fincra_conversion_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS fincra_conversion_currency text;

CREATE TABLE IF NOT EXISTS public.fincra_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  reference text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('collection', 'conversion', 'payout')),
  provider_status text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_error text
);

ALTER TABLE public.fincra_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.fincra_webhook_events FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.apply_fincra_webhook_event(
  p_event_id text,
  p_event_type text,
  p_reference text,
  p_stage text,
  p_provider_status text,
  p_amount numeric,
  p_currency text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  event_row public.fincra_webhook_events%ROWTYPE;
  plan_row public.plans%ROWTYPE;
  transaction_row public.transactions%ROWTYPE;
  commitment_row public.commitments%ROWTYPE;
  mapped_status text := lower(trim(coalesce(p_provider_status, '')));
  inserted_count integer;
  payout_total integer;
  payout_completed integer;
  payout_failed integer;
BEGIN
  IF nullif(trim(coalesce(p_event_id, '')), '') IS NULL
     OR nullif(trim(coalesce(p_reference, '')), '') IS NULL
     OR coalesce(p_stage, '') NOT IN ('collection', 'conversion', 'payout')
     OR mapped_status NOT IN ('pending', 'processing', 'successful', 'failed', 'reversed') THEN
    RAISE EXCEPTION 'Invalid Fincra event fields';
  END IF;

  INSERT INTO public.fincra_webhook_events (
    event_id, event_type, reference, stage, provider_status, payload
  ) VALUES (
    p_event_id, coalesce(p_event_type, ''), p_reference, p_stage, mapped_status, coalesce(p_payload, '{}'::jsonb)
  ) ON CONFLICT (event_id) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  SELECT * INTO event_row
  FROM public.fincra_webhook_events
  WHERE event_id = p_event_id
  FOR UPDATE;

  IF inserted_count = 0 AND event_row.processed_at IS NOT NULL THEN
    RETURN jsonb_build_object('applied', false, 'duplicate', true);
  END IF;

  IF event_row.event_type <> coalesce(p_event_type, '')
     OR event_row.reference <> p_reference
     OR event_row.stage <> p_stage
     OR event_row.provider_status <> mapped_status THEN
    RAISE EXCEPTION 'Fincra event ID was reused with different event data';
  END IF;

  IF p_stage = 'collection' THEN
    SELECT p.* INTO plan_row
    FROM public.plans p
    WHERE p.fincra_collection_reference = p_reference
       OR EXISTS (
         SELECT 1 FROM public.transactions t
         WHERE t.plan_id = p.id
           AND (t.fincra_collection_reference = p_reference OR t.fincra_checkout_reference = p_reference)
       )
    ORDER BY p.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('applied', false, 'duplicate', false, 'reason', 'reference_not_found');
    END IF;

    SELECT t.* INTO transaction_row
    FROM public.transactions t
    WHERE t.plan_id = plan_row.id
      AND (t.fincra_collection_reference = p_reference OR t.fincra_checkout_reference = p_reference)
    ORDER BY t.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('applied', false, 'duplicate', false, 'reason', 'transaction_not_found');
    END IF;

    IF mapped_status = 'successful' THEN
      IF lower(coalesce(p_currency, '')) <> 'gbp'
         OR p_amount IS NULL
         OR abs(p_amount - transaction_row.amount_gbp) > 0.01
         OR abs(p_amount - coalesce(plan_row.customer_pays, 0)) > 0.01 THEN
        UPDATE public.fincra_webhook_events
        SET processing_error = 'Collection amount or currency does not match the locked Senda quote'
        WHERE event_id = p_event_id;
        RETURN jsonb_build_object('applied', false, 'duplicate', false, 'reason', 'amount_or_currency_mismatch');
      END IF;

      IF plan_row.quote_locked_at IS NULL
         OR plan_row.status NOT IN ('awaiting_payment', 'payment_processing')
         OR plan_row.payment_status NOT IN ('pending', 'processing') THEN
        UPDATE public.fincra_webhook_events
        SET processing_error = 'Plan is not eligible to transition to funded'
        WHERE event_id = p_event_id;
        RETURN jsonb_build_object('applied', false, 'duplicate', false, 'reason', 'invalid_plan_state');
      END IF;

      UPDATE public.transactions
      SET status = 'successful',
          fincra_checkout_status = mapped_status,
          fincra_collection_status = mapped_status,
          completed_at = coalesce(completed_at, now())
      WHERE id = transaction_row.id;

      UPDATE public.plans
      SET payment_status = 'successful',
          status = 'funded',
          fincra_collection_status = mapped_status
      WHERE id = plan_row.id;

      UPDATE public.commitments
      SET status = 'ready'
      WHERE plan_id = plan_row.id AND status IN ('pending', 'ready');
    ELSIF mapped_status IN ('failed', 'reversed') THEN
      IF plan_row.payment_status <> 'successful'
         AND plan_row.status IN ('awaiting_payment', 'payment_processing') THEN
        UPDATE public.transactions
        SET status = 'failed',
            fincra_checkout_status = mapped_status,
            fincra_collection_status = mapped_status
        WHERE id = transaction_row.id AND status <> 'successful';

        UPDATE public.plans
        SET payment_status = 'failed',
            status = 'payment_failed',
            fincra_collection_status = mapped_status
        WHERE id = plan_row.id AND payment_status <> 'successful';
      END IF;
    ELSE
      UPDATE public.transactions
      SET fincra_checkout_status = mapped_status,
          fincra_collection_status = mapped_status
      WHERE id = transaction_row.id AND status NOT IN ('successful', 'failed');

      UPDATE public.plans
      SET payment_status = 'processing',
          status = CASE WHEN status = 'awaiting_payment' THEN 'payment_processing' ELSE status END,
          fincra_collection_status = mapped_status
      WHERE id = plan_row.id
        AND payment_status <> 'successful'
        AND payment_status <> 'failed'
        AND status IN ('awaiting_payment', 'payment_processing');
    END IF;

  ELSIF p_stage = 'conversion' THEN
    SELECT p.* INTO plan_row
    FROM public.plans p
    WHERE p.fincra_conversion_reference = p_reference
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('applied', false, 'duplicate', false, 'reason', 'reference_not_found');
    END IF;

    IF plan_row.payment_status <> 'successful' THEN
      UPDATE public.fincra_webhook_events
      SET processing_error = 'Conversion event arrived before successful collection'
      WHERE event_id = p_event_id;
      RETURN jsonb_build_object('applied', false, 'duplicate', false, 'reason', 'collection_not_confirmed');
    END IF;

    IF mapped_status = 'successful'
       AND (
         p_amount IS NULL
         OR lower(coalesce(p_currency, '')) <> lower(coalesce(plan_row.destination_currency, ''))
         OR abs(p_amount - coalesce(plan_row.destination_amount, 0)) > 0.01
       ) THEN
      UPDATE public.fincra_webhook_events
      SET processing_error = 'Converted amount or currency does not match the plan destination total'
      WHERE event_id = p_event_id;
      RETURN jsonb_build_object('applied', false, 'duplicate', false, 'reason', 'conversion_amount_or_currency_mismatch');
    END IF;

    UPDATE public.plans
    SET fincra_conversion_status = mapped_status,
        fincra_conversion_amount = CASE WHEN mapped_status = 'successful' THEN p_amount ELSE fincra_conversion_amount END,
        fincra_conversion_currency = CASE WHEN mapped_status = 'successful' THEN upper(p_currency) ELSE fincra_conversion_currency END
    WHERE id = plan_row.id
      AND coalesce(fincra_conversion_status, '') NOT IN ('successful', 'failed', 'reversed');

    UPDATE public.transactions
    SET fincra_conversion_status = mapped_status,
        fincra_conversion_amount = CASE WHEN mapped_status = 'successful' THEN p_amount ELSE fincra_conversion_amount END,
        fincra_conversion_currency = CASE WHEN mapped_status = 'successful' THEN upper(p_currency) ELSE fincra_conversion_currency END
    WHERE plan_id = plan_row.id
      AND status = 'successful'
      AND coalesce(fincra_conversion_status, '') NOT IN ('successful', 'failed', 'reversed');

  ELSE
    SELECT c.* INTO commitment_row
    FROM public.commitments c
    WHERE c.fincra_payout_reference = p_reference
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('applied', false, 'duplicate', false, 'reason', 'reference_not_found');
    END IF;

    SELECT p.* INTO plan_row
    FROM public.plans p
    WHERE p.id = commitment_row.plan_id
    FOR UPDATE;

    IF plan_row.payment_status <> 'successful'
       OR plan_row.fincra_conversion_status <> 'successful' THEN
      UPDATE public.fincra_webhook_events
      SET processing_error = 'Payout event arrived before successful collection and conversion'
      WHERE event_id = p_event_id;
      RETURN jsonb_build_object('applied', false, 'duplicate', false, 'reason', 'funding_or_conversion_not_confirmed');
    END IF;

    IF mapped_status = 'successful' THEN
      IF p_amount IS NULL
         OR lower(coalesce(p_currency, '')) <> lower(coalesce(commitment_row.destination_currency, ''))
         OR abs(p_amount - coalesce(commitment_row.amount_destination, 0)) > 0.01 THEN
        UPDATE public.fincra_webhook_events
        SET processing_error = 'Payout amount or currency does not match the commitment'
        WHERE event_id = p_event_id;
        RETURN jsonb_build_object('applied', false, 'duplicate', false, 'reason', 'payout_amount_or_currency_mismatch');
      END IF;

      UPDATE public.commitments
      SET fincra_payout_status = mapped_status,
          provider_status = upper(mapped_status),
          status = 'completed',
          failure_reason = NULL,
          failure_reason_display = NULL
      WHERE id = commitment_row.id
        AND status IN ('ready', 'creating', 'creating_unknown', 'submitted', 'confirming',
                       'confirming_unknown', 'processing', 'reconciliation_required');
    ELSIF mapped_status IN ('failed', 'reversed') THEN
      UPDATE public.commitments
      SET fincra_payout_status = mapped_status,
          provider_status = upper(mapped_status),
          status = 'failed',
          failure_reason = coalesce(p_payload #>> '{data,message}', p_payload #>> '{message}', 'Fincra payout failed')
      WHERE id = commitment_row.id
        AND status IN ('ready', 'creating', 'creating_unknown', 'submitted', 'confirming',
                       'confirming_unknown', 'processing', 'reconciliation_required');
    ELSE
      UPDATE public.commitments
      SET fincra_payout_status = mapped_status,
          provider_status = upper(mapped_status),
          status = 'processing'
      WHERE id = commitment_row.id
        AND status IN ('ready', 'creating', 'creating_unknown', 'submitted', 'confirming',
                       'confirming_unknown', 'processing', 'reconciliation_required');
    END IF;

    SELECT count(*),
           count(*) FILTER (WHERE status = 'completed'),
           count(*) FILTER (WHERE status IN ('failed', 'resolution'))
    INTO payout_total, payout_completed, payout_failed
    FROM public.commitments
    WHERE plan_id = plan_row.id;

    UPDATE public.plans
    SET fincra_payout_status = CASE
      WHEN payout_total = 0 THEN 'pending'
      WHEN payout_completed = payout_total THEN 'successful'
      WHEN payout_failed = payout_total THEN 'failed'
      WHEN payout_completed + payout_failed = payout_total THEN 'partially_failed'
      ELSE 'processing'
    END
    WHERE id = plan_row.id;

    UPDATE public.transactions
    SET fincra_payout_status = CASE
      WHEN payout_total = 0 THEN 'pending'
      WHEN payout_completed = payout_total THEN 'successful'
      WHEN payout_failed = payout_total THEN 'failed'
      WHEN payout_completed + payout_failed = payout_total THEN 'partially_failed'
      ELSE 'processing'
    END
    WHERE plan_id = plan_row.id
      AND status = 'successful';
  END IF;

  UPDATE public.fincra_webhook_events
  SET processed_at = now(), processing_error = NULL
  WHERE event_id = p_event_id;

  RETURN jsonb_build_object('applied', true, 'duplicate', false);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_fincra_webhook_event(text, text, text, text, text, numeric, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_fincra_webhook_event(text, text, text, text, text, numeric, text, jsonb)
  TO service_role;

COMMIT;
