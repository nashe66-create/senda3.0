-- Internal reconciliation status and evidence for completed remittance orders.

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS financial_reconciliation_status text NOT NULL DEFAULT 'pending';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'plans_financial_reconciliation_status_check'
      AND table_name = 'plans'
  ) THEN
    ALTER TABLE plans ADD CONSTRAINT plans_financial_reconciliation_status_check
      CHECK (financial_reconciliation_status IN ('pending', 'reconciled', 'requires_review'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS financial_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL UNIQUE REFERENCES plans(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'reconciled', 'requires_review')),
  reason text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  reconciled_at timestamptz
);

ALTER TABLE financial_reconciliations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_financial_reconciliations" ON financial_reconciliations;
CREATE POLICY "select_own_financial_reconciliations"
  ON financial_reconciliations FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM plans WHERE plans.id = financial_reconciliations.plan_id AND plans.user_id = auth.uid()
  ));

CREATE OR REPLACE FUNCTION public.evaluate_financial_reconciliation(p_plan_id uuid)
RETURNS TABLE (status text, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  plan_row public.plans%ROWTYPE;
  transaction_count integer;
  successful_transaction_count integer;
  commitment_count integer;
  terminal_commitment_count integer;
  active_attempt_count integer;
  attempt_count integer;
  observed_cost_count integer;
  failed_commitment_count integer;
  next_status text;
  next_reason text;
  evidence jsonb;
BEGIN
  SELECT * INTO plan_row FROM public.plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'requires_review', 'Remittance order not found';
    RETURN;
  END IF;

  SELECT count(*), count(*) FILTER (WHERE status = 'successful')
    INTO transaction_count, successful_transaction_count
  FROM public.transactions WHERE plan_id = p_plan_id;

  SELECT count(*),
         count(*) FILTER (WHERE status IN ('completed', 'failed')),
         count(*) FILTER (WHERE status = 'failed')
    INTO commitment_count, terminal_commitment_count, failed_commitment_count
  FROM public.commitments WHERE plan_id = p_plan_id;

  SELECT count(*), count(*) FILTER (WHERE status IN ('completed', 'failed')),
         count(*) FILTER (WHERE actual_provider_payout_cost IS NOT NULL)
    INTO attempt_count, active_attempt_count, observed_cost_count
  FROM public.transfer_attempts ta
  JOIN public.commitments c ON c.id = ta.commitment_id
  WHERE c.plan_id = p_plan_id;

  IF transaction_count <> 1 OR successful_transaction_count <> 1 THEN
    next_status := 'pending';
    next_reason := 'Customer collection is not authoritatively successful';
  ELSIF commitment_count = 0 OR terminal_commitment_count <> commitment_count THEN
    next_status := 'pending';
    next_reason := 'All payout commitments are not in terminal states';
  ELSIF active_attempt_count <> attempt_count THEN
    next_status := 'pending';
    next_reason := 'All payout attempts are not in terminal states';
  ELSIF failed_commitment_count > 0 THEN
    next_status := 'requires_review';
    next_reason := 'One or more payout commitments failed';
  ELSIF plan_row.actual_collection_cost IS NULL OR observed_cost_count <> attempt_count THEN
    next_status := 'requires_review';
    next_reason := 'Authoritative actual provider cost evidence is incomplete';
  ELSE
    next_status := 'reconciled';
    next_reason := 'Collection, payouts, and observed provider costs reconcile';
  END IF;

  evidence := jsonb_build_object(
    'transaction_count', transaction_count,
    'successful_transaction_count', successful_transaction_count,
    'commitment_count', commitment_count,
    'terminal_commitment_count', terminal_commitment_count,
    'failed_commitment_count', failed_commitment_count,
    'attempt_count', attempt_count,
    'terminal_attempt_count', active_attempt_count,
    'observed_cost_count', observed_cost_count,
    'actual_collection_cost_present', plan_row.actual_collection_cost IS NOT NULL
  );

  UPDATE public.plans
  SET financial_reconciliation_status = next_status
  WHERE id = p_plan_id;

  INSERT INTO public.financial_reconciliations (plan_id, status, reason, evidence, evaluated_at, reconciled_at)
  VALUES (p_plan_id, next_status, next_reason, evidence, now(), CASE WHEN next_status = 'reconciled' THEN now() ELSE NULL END)
  ON CONFLICT (plan_id) DO UPDATE SET
    status = EXCLUDED.status,
    reason = EXCLUDED.reason,
    evidence = EXCLUDED.evidence,
    evaluated_at = EXCLUDED.evaluated_at,
    reconciled_at = EXCLUDED.reconciled_at;

  RETURN QUERY SELECT next_status, next_reason;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.evaluate_financial_reconciliation(uuid) FROM PUBLIC, anon, authenticated;