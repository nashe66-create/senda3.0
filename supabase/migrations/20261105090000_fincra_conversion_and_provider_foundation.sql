-- Fincra single-provider migration foundation.
-- Keeps existing Flutterwave identifiers intact for audit/history; new transactions
-- use Fincra references and a distinct conversion ledger.

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS funding_provider text,
  ADD COLUMN IF NOT EXISTS funding_reference text,
  ADD COLUMN IF NOT EXISTS funding_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS conversion_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS fincra_conversion_reference text,
  ADD COLUMN IF NOT EXISTS fincra_conversion_quote_reference text,
  ADD COLUMN IF NOT EXISTS conversion_source_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS conversion_destination_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS conversion_rate numeric(18,8),
  ADD COLUMN IF NOT EXISTS conversion_fee numeric(14,2),
  ADD COLUMN IF NOT EXISTS conversion_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS conversion_initiated_at timestamptz,
  ADD COLUMN IF NOT EXISTS conversion_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS destination_wallet_funded_at timestamptz;

ALTER TABLE public.plans
  ADD CONSTRAINT plans_funding_provider_check
    CHECK (funding_provider IS NULL OR funding_provider IN ('fincra')),
  ADD CONSTRAINT plans_conversion_status_check
    CHECK (conversion_status IN (
      'not_started','quote_pending','quoted','initiating','initiating_unknown',
      'processing','confirmed','failed','reconciliation_required'
    ));

CREATE UNIQUE INDEX IF NOT EXISTS plans_fincra_conversion_reference_unique
  ON public.plans (fincra_conversion_reference)
  WHERE fincra_conversion_reference IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS plans_fincra_conversion_quote_reference_unique
  ON public.plans (fincra_conversion_quote_reference)
  WHERE fincra_conversion_quote_reference IS NOT NULL;

-- Extend payout-attempt ledger to identify the provider, while preserving historical
-- Flutterwave attempts. New attempts will be Fincra-only.
ALTER TABLE public.transfer_attempts
  ALTER COLUMN provider DROP DEFAULT;

ALTER TABLE public.transfer_attempts
  DROP CONSTRAINT IF EXISTS transfer_attempts_provider_check;

ALTER TABLE public.transfer_attempts
  ADD CONSTRAINT transfer_attempts_provider_check
    CHECK (provider IN ('flutterwave','fincra'));

-- Persist one auditable conversion attempt per order, including ambiguous
-- submissions, to ensure an uncertain conversion is reconciled, never replayed.
CREATE TABLE IF NOT EXISTS public.fincra_conversion_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  idempotency_key text NOT NULL UNIQUE,
  quote_reference text,
  conversion_reference text UNIQUE,
  source_currency text NOT NULL CHECK (source_currency = 'GBP'),
  destination_currency text NOT NULL,
  source_amount numeric(14,2) NOT NULL CHECK (source_amount > 0),
  destination_amount numeric(14,2),
  quoted_rate numeric(18,8),
  provider_fee numeric(14,2),
  quote_expires_at timestamptz,
  status text NOT NULL CHECK (status IN (
    'quoted','initiating','initiating_unknown','processing','confirmed',
    'failed','reconciliation_required'
  )),
  provider_status text,
  request_fingerprint text NOT NULL,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  last_checked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, attempt_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS fincra_conversion_one_active_per_plan
  ON public.fincra_conversion_attempts (plan_id)
  WHERE status IN ('initiating','initiating_unknown','processing','reconciliation_required');

CREATE INDEX IF NOT EXISTS idx_fincra_conversion_reconciliation
  ON public.fincra_conversion_attempts (status,last_checked_at)
  WHERE status IN ('initiating_unknown','processing','reconciliation_required');

ALTER TABLE public.fincra_conversion_attempts ENABLE ROW LEVEL SECURITY;
-- Intentionally no authenticated policies: Edge Functions with service role only.

CREATE TABLE IF NOT EXISTS public.fincra_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  signature_valid boolean NOT NULL
);
ALTER TABLE public.fincra_webhook_events ENABLE ROW LEVEL SECURITY;
-- Intentionally no authenticated policies: webhook handler/service role only.

COMMENT ON TABLE public.fincra_conversion_attempts IS
  'Durable idempotent ledger for GBP-to-destination wallet conversion. Never replay ambiguous conversions.';
COMMENT ON COLUMN public.plans.conversion_status IS
  'Order-level conversion lifecycle. Recipient payouts start only after conversion confirmed.';
