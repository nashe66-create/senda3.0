/*
# Recipient Flutterwave verification lifecycle

## Overview
A recipient saved locally is not necessarily payout-ready — Flutterwave's
recipient validation (POST /transfers/recipients) is the source of truth for
that. This adds the minimum fields needed to track that outcome.

## Changes to `recipients`
- `verification_status` (text, default 'pending', check: pending | verified | needs_attention)
- `validation_error_code` (text, nullable) - technical Flutterwave field/code, for internal debugging
- `validation_error_message` (text, nullable) - user-safe message, never raw Flutterwave JSON

No new tables. Existing RLS policies on `recipients` already cover these columns.
*/

ALTER TABLE recipients ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'pending';
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS validation_error_code text;
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS validation_error_message text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'recipients_verification_status_check' AND table_name = 'recipients'
  ) THEN
    ALTER TABLE recipients ADD CONSTRAINT recipients_verification_status_check
      CHECK (verification_status IN ('pending', 'verified', 'needs_attention'));
  END IF;
END $$;
