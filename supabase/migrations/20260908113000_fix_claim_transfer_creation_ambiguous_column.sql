-- Fix "column reference \"commitment_id\" is ambiguous" (42702) in claim_transfer_creation.
-- The function's RETURNS TABLE OUT parameter is named commitment_id, which collided with
-- bare references to transfer_attempts.commitment_id in the WHERE clauses below.
CREATE OR REPLACE FUNCTION public.claim_transfer_creation(
  p_commitment_id uuid,
  p_payout_method text,
  p_request_fingerprint text,
  p_is_retry boolean DEFAULT false
)
RETURNS TABLE (
  attempt_id uuid,
  commitment_id uuid,
  provider_reference text,
  idempotency_key text,
  amount_gbp numeric,
  destination_currency text,
  recipient_snapshot jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  commitment_row public.commitments%ROWTYPE;
  plan_row public.plans%ROWTYPE;
  next_attempt integer;
  new_attempt_id uuid := gen_random_uuid();
  new_reference text := 'senda-' || replace(new_attempt_id::text, '-', '');
  new_key text := 'SENDA-PAYOUT-' || replace(new_attempt_id::text, '-', '');
  last_attempt_status text;
BEGIN
  SELECT * INTO commitment_row
  FROM public.commitments
  WHERE id = p_commitment_id AND user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO plan_row
  FROM public.plans WHERE id = commitment_row.plan_id FOR UPDATE;
  IF NOT FOUND OR plan_row.payment_status <> 'successful'
     OR plan_row.status NOT IN ('funded', 'payouts_processing', 'partially_failed', 'failed') THEN
    RETURN;
  END IF;

  SELECT ta.status INTO last_attempt_status
  FROM public.transfer_attempts ta
  WHERE ta.commitment_id = p_commitment_id
  ORDER BY ta.attempt_number DESC
  LIMIT 1;

  IF p_is_retry THEN
    IF commitment_row.status <> 'failed' OR last_attempt_status IS DISTINCT FROM 'failed' THEN
      RETURN;
    END IF;
  ELSIF commitment_row.status NOT IN ('ready', 'pending') THEN
    RETURN;
  END IF;

  SELECT COALESCE(max(ta.attempt_number), 0) + 1 INTO next_attempt
  FROM public.transfer_attempts ta WHERE ta.commitment_id = p_commitment_id;

  INSERT INTO public.transfer_attempts (
    id, commitment_id, attempt_number, provider_reference, idempotency_key,
    request_fingerprint, status
  ) VALUES (
    new_attempt_id, p_commitment_id, next_attempt, new_reference, new_key,
    p_request_fingerprint, 'creating'
  );

  UPDATE public.commitments
  SET status = 'creating', payout_method = p_payout_method,
      idempotency_key = new_key, failure_reason = NULL, failure_reason_display = NULL
  WHERE id = p_commitment_id;

  UPDATE public.plans
  SET status = 'payouts_processing'
  WHERE id = plan_row.id
    AND status IN ('funded', 'payouts_processing', 'partially_failed', 'failed');

  RETURN QUERY SELECT new_attempt_id, commitment_row.id, new_reference, new_key,
                      commitment_row.amount_gbp, commitment_row.destination_currency,
                      commitment_row.recipient_snapshot;
END;
$$;
