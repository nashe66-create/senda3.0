-- Durable payout-attempt ledger and database-owned state claims.

CREATE TABLE IF NOT EXISTS transfer_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id uuid NOT NULL REFERENCES commitments(id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  provider text NOT NULL DEFAULT 'flutterwave' CHECK (provider = 'flutterwave'),
  provider_reference text NOT NULL,
  idempotency_key text NOT NULL,
  provider_transfer_id text,
  provider_status text,
  request_fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'creating', 'creating_unknown', 'submitted', 'confirming',
    'confirming_unknown', 'processing', 'completed', 'failed',
    'reconciliation_required'
  )),
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  last_checked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (commitment_id, attempt_number),
  UNIQUE (provider, provider_reference),
  UNIQUE (provider, idempotency_key)
);

ALTER TABLE transfer_attempts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_transfer_attempts_reconciliation
  ON transfer_attempts (status, last_checked_at)
  WHERE status IN ('creating_unknown', 'confirming_unknown', 'reconciliation_required', 'submitted', 'processing');

ALTER TABLE transactions
  ALTER COLUMN payment_reference SET DEFAULT ('SND-' || replace(gen_random_uuid()::text, '-', ''));
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_payment_reference_unique
  ON transactions (payment_reference)
  WHERE payment_reference IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prevent_transfer_attempt_identity_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.commitment_id IS DISTINCT FROM OLD.commitment_id
     OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.provider_reference IS DISTINCT FROM OLD.provider_reference
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
    RAISE EXCEPTION 'Transfer attempt identity fields are immutable';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transfer_attempt_identity_immutable ON transfer_attempts;
CREATE TRIGGER trg_transfer_attempt_identity_immutable
  BEFORE UPDATE ON transfer_attempts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_transfer_attempt_identity_changes();

ALTER TABLE commitments DROP CONSTRAINT IF EXISTS commitments_status_check;
ALTER TABLE commitments ADD CONSTRAINT commitments_status_check CHECK (
  status IN (
    'pending', 'ready', 'creating', 'creating_unknown', 'submitted',
    'confirming', 'confirming_unknown', 'processing', 'completed',
    'failed', 'reconciliation_required'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS transfer_attempts_one_active_per_commitment
  ON transfer_attempts (commitment_id)
  WHERE status IN ('creating', 'creating_unknown', 'submitted', 'confirming',
                   'confirming_unknown', 'processing', 'reconciliation_required');

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

  SELECT status INTO last_attempt_status
  FROM public.transfer_attempts
  WHERE commitment_id = p_commitment_id
  ORDER BY attempt_number DESC
  LIMIT 1;

  IF p_is_retry THEN
    IF commitment_row.status <> 'failed' OR last_attempt_status IS DISTINCT FROM 'failed' THEN
      RETURN;
    END IF;
  ELSIF commitment_row.status NOT IN ('ready', 'pending') THEN
    RETURN;
  END IF;

  SELECT COALESCE(max(attempt_number), 0) + 1 INTO next_attempt
  FROM public.transfer_attempts WHERE commitment_id = p_commitment_id;

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

CREATE OR REPLACE FUNCTION public.claim_transfer_confirmation(p_commitment_id uuid)
RETURNS TABLE (attempt_id uuid, provider_transfer_id text, amount_gbp numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  commitment_row public.commitments%ROWTYPE;
  attempt_row public.transfer_attempts%ROWTYPE;
BEGIN
  SELECT * INTO commitment_row
  FROM public.commitments
  WHERE id = p_commitment_id AND user_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND OR commitment_row.status <> 'submitted' THEN
    RETURN;
  END IF;

  SELECT * INTO attempt_row
  FROM public.transfer_attempts
  WHERE commitment_id = p_commitment_id AND status = 'submitted'
  ORDER BY attempt_number DESC LIMIT 1
  FOR UPDATE;
  IF NOT FOUND OR attempt_row.provider_transfer_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.transfer_attempts SET status = 'confirming' WHERE id = attempt_row.id;
  UPDATE public.commitments SET status = 'confirming' WHERE id = commitment_row.id;
  RETURN QUERY SELECT attempt_row.id, attempt_row.provider_transfer_id, commitment_row.amount_gbp;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_transfer_creation_result(
  p_attempt_id uuid,
  p_provider_transfer_id text,
  p_provider_status text,
  p_definitive_failure boolean DEFAULT false,
  p_error_message text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  attempt_row public.transfer_attempts%ROWTYPE;
  next_status text;
BEGIN
  SELECT * INTO attempt_row FROM public.transfer_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND OR attempt_row.status <> 'creating' THEN RETURN; END IF;

  IF p_provider_transfer_id IS NOT NULL THEN
    next_status := CASE
      WHEN upper(coalesce(p_provider_status, '')) IN ('FAILED', 'CANCELLED') THEN 'failed'
      WHEN upper(coalesce(p_provider_status, '')) IN ('COMPLETED', 'SUCCESSFUL') THEN 'completed'
      ELSE 'submitted'
    END;
  ELSIF p_definitive_failure THEN
    next_status := 'failed';
  ELSE
    next_status := 'creating_unknown';
  END IF;

  UPDATE public.transfer_attempts
  SET provider_transfer_id = coalesce(p_provider_transfer_id, provider_transfer_id),
      status = next_status, error_message = p_error_message,
      submitted_at = CASE WHEN next_status IN ('submitted', 'processing') THEN now() ELSE submitted_at END,
      completed_at = CASE WHEN next_status = 'completed' THEN now() ELSE completed_at END,
      failed_at = CASE WHEN next_status = 'failed' THEN now() ELSE failed_at END,
      last_checked_at = now()
  WHERE id = attempt_row.id;

  UPDATE public.commitments
  SET flutterwave_transfer_id = coalesce(p_provider_transfer_id, flutterwave_transfer_id),
      status = next_status,
      provider_status = nullif(upper(p_provider_status), ''),
      failure_reason = CASE WHEN next_status = 'failed' THEN p_error_message ELSE NULL END,
      failure_reason_display = CASE WHEN next_status = 'failed' THEN p_error_message ELSE NULL END
  WHERE id = attempt_row.commitment_id
    AND status = 'creating';
END;
$$;

CREATE OR REPLACE FUNCTION public.record_transfer_confirmation_result(
  p_attempt_id uuid,
  p_provider_status text,
  p_definitive_failure boolean DEFAULT false,
  p_error_message text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  attempt_row public.transfer_attempts%ROWTYPE;
  next_status text;
BEGIN
  SELECT * INTO attempt_row FROM public.transfer_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND OR attempt_row.status <> 'confirming' THEN RETURN; END IF;

  IF p_definitive_failure THEN
    next_status := 'failed';
  ELSIF upper(coalesce(p_provider_status, '')) IN ('FAILED', 'CANCELLED') THEN
    next_status := 'failed';
  ELSIF upper(coalesce(p_provider_status, '')) IN ('COMPLETED', 'SUCCESSFUL') THEN
    next_status := 'completed';
  ELSIF p_provider_status IS NULL OR p_provider_status = '' THEN
    next_status := 'confirming_unknown';
  ELSE
    next_status := 'processing';
  END IF;

  UPDATE public.transfer_attempts
  SET status = next_status, error_message = p_error_message,
      confirmed_at = CASE WHEN next_status IN ('processing', 'completed') THEN now() ELSE confirmed_at END,
      completed_at = CASE WHEN next_status = 'completed' THEN now() ELSE completed_at END,
      failed_at = CASE WHEN next_status = 'failed' THEN now() ELSE failed_at END,
      last_checked_at = now()
  WHERE id = attempt_row.id;

  UPDATE public.commitments
  SET status = next_status,
      provider_status = nullif(upper(p_provider_status), ''),
      failure_reason = CASE WHEN next_status = 'failed' THEN p_error_message ELSE NULL END,
      failure_reason_display = CASE WHEN next_status = 'failed' THEN p_error_message ELSE NULL END
  WHERE id = attempt_row.commitment_id
    AND status = 'confirming';
END;
$$;

CREATE OR REPLACE FUNCTION public.recalc_plan_status_from_commitments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  total_count integer;
  completed_count integer;
  failed_count integer;
  active_count integer;
  current_status text;
BEGIN
  SELECT status INTO current_status FROM public.plans WHERE id = NEW.plan_id FOR UPDATE;
  IF current_status IN ('cancelled', 'completed') THEN RETURN NEW; END IF;

  SELECT count(*),
         count(*) FILTER (WHERE status = 'completed'),
         count(*) FILTER (WHERE status = 'failed'),
         count(*) FILTER (WHERE status IN ('creating', 'creating_unknown', 'submitted',
           'confirming', 'confirming_unknown', 'processing', 'reconciliation_required'))
  INTO total_count, completed_count, failed_count, active_count
  FROM public.commitments WHERE plan_id = NEW.plan_id;

  IF total_count = 0 THEN RETURN NEW; END IF;
  IF completed_count = total_count THEN
    UPDATE public.plans SET status = 'completed' WHERE id = NEW.plan_id AND status <> 'cancelled';
  ELSIF failed_count = total_count THEN
    UPDATE public.plans SET status = 'failed' WHERE id = NEW.plan_id AND status <> 'cancelled';
  ELSIF active_count > 0 THEN
    UPDATE public.plans SET status = 'payouts_processing'
      WHERE id = NEW.plan_id AND status NOT IN ('cancelled', 'completed');
  ELSIF completed_count > 0 AND failed_count > 0 THEN
    UPDATE public.plans SET status = 'partially_failed'
      WHERE id = NEW.plan_id AND status NOT IN ('cancelled', 'completed');
  END IF;
  RETURN NEW;
END;
$$;

-- Authoritative KYC fields are service-role-only. Clients retain ordinary profile fields.
CREATE OR REPLACE FUNCTION public.prevent_client_kyc_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND (NEW.flutterwave_sender_id IS DISTINCT FROM OLD.flutterwave_sender_id
       OR NEW.kyc_status IS DISTINCT FROM OLD.kyc_status
       OR NEW.kyc_verified_at IS DISTINCT FROM OLD.kyc_verified_at
       OR NEW.kyc_submitted_at IS DISTINCT FROM OLD.kyc_submitted_at
       OR NEW.kyc_national_id_type IS DISTINCT FROM OLD.kyc_national_id_type
       OR NEW.kyc_national_id_number IS DISTINCT FROM OLD.kyc_national_id_number
       OR NEW.kyc_national_id_expiry IS DISTINCT FROM OLD.kyc_national_id_expiry
       OR NEW.kyc_date_of_birth IS DISTINCT FROM OLD.kyc_date_of_birth
       OR NEW.kyc_address IS DISTINCT FROM OLD.kyc_address) THEN
    RAISE EXCEPTION 'KYC fields may only be updated by the server';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_client_kyc_mutation ON profiles;
CREATE TRIGGER trg_prevent_client_kyc_mutation
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_client_kyc_mutation();

REVOKE ALL ON TABLE public.transfer_attempts FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_transfer_creation(uuid, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_transfer_confirmation(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_transfer_attempt_identity_changes() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_client_kyc_mutation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_plan_status_from_commitments() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_transfer_creation_result(uuid, text, text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_transfer_confirmation_result(uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;