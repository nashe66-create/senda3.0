-- Fincra migration phase 2
-- expands the database to store collection, wallet, conversion, and payout references
-- for the next step of the remittance lifecycle.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'fincra_checkout_reference'
  ) THEN
    ALTER TABLE transactions ADD COLUMN fincra_checkout_reference text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'fincra_checkout_status'
  ) THEN
    ALTER TABLE transactions ADD COLUMN fincra_checkout_status text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'fincra_collection_reference'
  ) THEN
    ALTER TABLE transactions ADD COLUMN fincra_collection_reference text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'fincra_collection_status'
  ) THEN
    ALTER TABLE transactions ADD COLUMN fincra_collection_status text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'fincra_conversion_reference'
  ) THEN
    ALTER TABLE transactions ADD COLUMN fincra_conversion_reference text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'fincra_conversion_status'
  ) THEN
    ALTER TABLE transactions ADD COLUMN fincra_conversion_status text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'fincra_payout_reference'
  ) THEN
    ALTER TABLE transactions ADD COLUMN fincra_payout_reference text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'fincra_payout_status'
  ) THEN
    ALTER TABLE transactions ADD COLUMN fincra_payout_status text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'fincra_wallet_id'
  ) THEN
    ALTER TABLE plans ADD COLUMN fincra_wallet_id text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'fincra_wallet_balance'
  ) THEN
    ALTER TABLE plans ADD COLUMN fincra_wallet_balance numeric(12,2) DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'plans' AND column_name = 'wallet_balance_checked_at'
  ) THEN
    ALTER TABLE plans ADD COLUMN wallet_balance_checked_at timestamptz;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'commitments' AND column_name = 'fincra_conversion_reference'
  ) THEN
    ALTER TABLE commitments ADD COLUMN fincra_conversion_reference text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'commitments' AND column_name = 'fincra_payout_reference'
  ) THEN
    ALTER TABLE commitments ADD COLUMN fincra_payout_reference text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'commitments' AND column_name = 'fincra_payout_status'
  ) THEN
    ALTER TABLE commitments ADD COLUMN fincra_payout_status text;
  END IF;
END $$;
