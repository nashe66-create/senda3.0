-- Check active Flutterwave payouts every 15 seconds through the protected Edge Function.
-- The URL and cron secret are read from Supabase Vault at execution time.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
DECLARE
  existing_job_id bigint;
BEGIN
  SELECT jobid INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'senda-payout-reconciliation';

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;
END;
$$;

SELECT cron.schedule(
  'senda-payout-reconciliation',
  '15 seconds',
  $job$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'SUPABASE_URL'
      ) || '/functions/v1/senda-payout-reconciliation',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-senda-cron-secret', (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'SENDA_RECONCILIATION_CRON_SECRET'
        )
      ),
      body := '{}'::jsonb
    );
  $job$
);
