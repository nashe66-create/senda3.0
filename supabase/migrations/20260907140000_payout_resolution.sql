-- Separate payout failure from the operational resolution state.

ALTER TABLE commitments
  ADD COLUMN IF NOT EXISTS resolution_reason text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

ALTER TABLE commitments DROP CONSTRAINT IF EXISTS commitments_status_check;
ALTER TABLE commitments ADD CONSTRAINT commitments_status_check CHECK (
  status IN (
    'pending', 'ready', 'creating', 'creating_unknown', 'submitted',
    'confirming', 'confirming_unknown', 'processing', 'completed',
    'failed', 'reconciliation_required', 'resolution'
  )
);

CREATE OR REPLACE FUNCTION public.resolve_failed_commitment(
  p_commitment_id uuid,
  p_resolution_reason text
)
RETURNS TABLE (commitment_id uuid, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  commitment_row public.commitments%ROWTYPE;
BEGIN
  IF nullif(trim(coalesce(p_resolution_reason, '')), '') IS NULL THEN
    RETURN;
  END IF;

  SELECT c.* INTO commitment_row
  FROM public.commitments c
  WHERE c.id = p_commitment_id AND c.user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND OR commitment_row.status <> 'failed' THEN
    RETURN;
  END IF;

  UPDATE public.commitments
  SET status = 'resolution',
      resolution_reason = trim(p_resolution_reason),
      resolved_at = now()
  WHERE id = p_commitment_id;

  RETURN QUERY SELECT p_commitment_id, 'resolution'::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_failed_commitment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_failed_commitment(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.recalc_plan_status_from_commitments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  total_count integer;
  completed_count integer;
  failed_or_resolved_count integer;
  active_count integer;
  current_status text;
BEGIN
  SELECT status INTO current_status FROM public.plans WHERE id = NEW.plan_id FOR UPDATE;
  IF current_status IN ('cancelled', 'completed') THEN RETURN NEW; END IF;

  SELECT count(*),
         count(*) FILTER (WHERE status = 'completed'),
         count(*) FILTER (WHERE status IN ('failed', 'resolution')),
         count(*) FILTER (WHERE status IN ('creating', 'creating_unknown', 'submitted',
           'confirming', 'confirming_unknown', 'processing', 'reconciliation_required'))
  INTO total_count, completed_count, failed_or_resolved_count, active_count
  FROM public.commitments WHERE plan_id = NEW.plan_id;

  IF total_count = 0 THEN RETURN NEW; END IF;
  IF completed_count = total_count THEN
    UPDATE public.plans SET status = 'completed' WHERE id = NEW.plan_id AND status <> 'cancelled';
  ELSIF failed_or_resolved_count = total_count THEN
    UPDATE public.plans SET status = 'failed' WHERE id = NEW.plan_id AND status <> 'cancelled';
  ELSIF active_count > 0 THEN
    UPDATE public.plans SET status = 'payouts_processing'
      WHERE id = NEW.plan_id AND status NOT IN ('cancelled', 'completed');
  ELSIF completed_count > 0 AND failed_or_resolved_count > 0 THEN
    UPDATE public.plans SET status = 'partially_failed'
      WHERE id = NEW.plan_id AND status NOT IN ('cancelled', 'completed');
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recalc_plan_status_from_commitments() FROM PUBLIC, anon, authenticated;