-- Create the immutable payout snapshot from the owned recipient at commitment creation.

CREATE OR REPLACE FUNCTION public.populate_commitment_recipient_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  recipient_row public.recipients%ROWTYPE;
  plan_user_id uuid;
BEGIN
  SELECT user_id INTO plan_user_id
  FROM public.plans
  WHERE id = NEW.plan_id;

  IF plan_user_id IS NULL OR plan_user_id IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'Commitment does not belong to the remittance order owner';
  END IF;

  SELECT * INTO recipient_row
  FROM public.recipients
  WHERE id = NEW.recipient_id AND user_id = NEW.user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recipient does not belong to the authenticated user';
  END IF;

  NEW.recipient_snapshot := jsonb_build_object(
    'name', recipient_row.name,
    'phone', recipient_row.phone,
    'country', recipient_row.country,
    'receiving_method', recipient_row.receiving_method,
    'mobile_money_network', recipient_row.mobile_money_network,
    'mobile_money_provider', recipient_row.mobile_money_provider,
    'bank_code', recipient_row.bank_code,
    'account_number', recipient_row.account_number,
    'destination_country', coalesce(recipient_row.destination_country, recipient_row.country),
    'currency', recipient_row.currency,
    'flutterwave_recipient_id', recipient_row.flutterwave_recipient_id,
    'verification_status', recipient_row.verification_status
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_populate_commitment_recipient_snapshot ON commitments;
CREATE TRIGGER trg_populate_commitment_recipient_snapshot
  BEFORE INSERT ON commitments
  FOR EACH ROW EXECUTE FUNCTION public.populate_commitment_recipient_snapshot();

REVOKE EXECUTE ON FUNCTION public.populate_commitment_recipient_snapshot() FROM PUBLIC, anon, authenticated;