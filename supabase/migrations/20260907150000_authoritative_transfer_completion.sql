-- Transfer creation is not proof of terminal payout success.
-- Completion is assigned only after an authoritative provider status read.

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
  SELECT * INTO attempt_row
  FROM public.transfer_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND OR attempt_row.status <> 'creating' THEN
    RETURN;
  END IF;

  IF p_provider_transfer_id IS NOT NULL THEN
    next_status := CASE
      WHEN upper(coalesce(p_provider_status, '')) IN ('FAILED', 'CANCELLED') THEN 'failed'
      ELSE 'submitted'
    END;
  ELSIF p_definitive_failure THEN
    next_status := 'failed';
  ELSE
    next_status := 'creating_unknown';
  END IF;

  UPDATE public.transfer_attempts
  SET provider_transfer_id = coalesce(p_provider_transfer_id, provider_transfer_id),
      status = next_status,
      error_message = p_error_message,
      submitted_at = CASE WHEN next_status = 'submitted' THEN now() ELSE submitted_at END,
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

REVOKE EXECUTE ON FUNCTION public.record_transfer_creation_result(uuid, text, text, boolean, text)
  FROM PUBLIC, anon, authenticated;
