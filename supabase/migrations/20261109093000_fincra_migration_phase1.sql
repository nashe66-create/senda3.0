-- Fincra migration phase 1
-- Adds provider-neutral Fincra fields that are needed before wiring the quote and wallet conversion flow.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'fincra_business_id'
  ) THEN
    ALTER TABLE profiles ADD COLUMN fincra_business_id text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'fincra_wallet_id'
  ) THEN
    ALTER TABLE profiles ADD COLUMN fincra_wallet_id text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'fincra_webhook_secret'
  ) THEN
    ALTER TABLE profiles ADD COLUMN fincra_webhook_secret text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'fincra_customer_reference'
  ) THEN
    ALTER TABLE profiles ADD COLUMN fincra_customer_reference text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'quote_reference'
  ) THEN
    ALTER TABLE plans ADD COLUMN quote_reference text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'quote_status'
  ) THEN
    ALTER TABLE plans ADD COLUMN quote_status text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'quote_rate'
  ) THEN
    ALTER TABLE plans ADD COLUMN quote_rate numeric(12,6) DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'quote_fee'
  ) THEN
    ALTER TABLE plans ADD COLUMN quote_fee numeric(12,2) DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'quote_amount_to_charge'
  ) THEN
    ALTER TABLE plans ADD COLUMN quote_amount_to_charge numeric(12,2) DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'quote_amount_to_receive'
  ) THEN
    ALTER TABLE plans ADD COLUMN quote_amount_to_receive numeric(12,2) DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'fincra_collection_reference'
  ) THEN
    ALTER TABLE plans ADD COLUMN fincra_collection_reference text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'fincra_collection_status'
  ) THEN
    ALTER TABLE plans ADD COLUMN fincra_collection_status text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'fincra_conversion_reference'
  ) THEN
    ALTER TABLE plans ADD COLUMN fincra_conversion_reference text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'fincra_conversion_status'
  ) THEN
    ALTER TABLE plans ADD COLUMN fincra_conversion_status text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'fincra_payout_reference'
  ) THEN
    ALTER TABLE plans ADD COLUMN fincra_payout_reference text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'fincra_payout_status'
  ) THEN
    ALTER TABLE plans ADD COLUMN fincra_payout_status text;
  END IF;
END $$;

-- Optional plan fields for the exact quote object we will persist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'customer_pays'
  ) THEN
    ALTER TABLE plans ADD COLUMN customer_pays numeric(12,2) DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'senda_fee'
  ) THEN
    ALTER TABLE plans ADD COLUMN senda_fee numeric(12,2) DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'provider_fee'
  ) THEN
    ALTER TABLE plans ADD COLUMN provider_fee numeric(12,2) DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'source_amount'
  ) THEN
    ALTER TABLE plans ADD COLUMN source_amount numeric(12,2) DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'destination_amount'
  ) THEN
    ALTER TABLE plans ADD COLUMN destination_amount numeric(12,2) DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'customer_fx_rate'
  ) THEN
    ALTER TABLE plans ADD COLUMN customer_fx_rate numeric(12,6) DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'provider_fx_rate'
  ) THEN
    ALTER TABLE plans ADD COLUMN provider_fx_rate numeric(12,6) DEFAULT 0;
  END IF;
END $$;
