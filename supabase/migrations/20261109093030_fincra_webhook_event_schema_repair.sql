BEGIN;

ALTER TABLE public.fincra_webhook_events
  ADD COLUMN IF NOT EXISTS stage text,
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_error text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fincra_webhook_events_stage_check'
      AND conrelid = 'public.fincra_webhook_events'::regclass
  ) THEN
    ALTER TABLE public.fincra_webhook_events
      ADD CONSTRAINT fincra_webhook_events_stage_check
      CHECK (stage IS NULL OR stage IN ('collection', 'conversion', 'payout'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_fincra_webhook_events_reference
  ON public.fincra_webhook_events (reference)
  WHERE reference IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_fincra_webhook_signature_valid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.signature_valid := coalesce(NEW.event_type, '') NOT LIKE '%.poll';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_fincra_webhook_signature_valid
  ON public.fincra_webhook_events;

CREATE TRIGGER trg_set_fincra_webhook_signature_valid
  BEFORE INSERT ON public.fincra_webhook_events
  FOR EACH ROW
  EXECUTE FUNCTION public.set_fincra_webhook_signature_valid();

REVOKE EXECUTE ON FUNCTION public.set_fincra_webhook_signature_valid()
  FROM PUBLIC, anon, authenticated;

COMMIT;
