# senda-New

[![Open in Bolt](https://bolt.new/static/open-in-bolt.svg)](https://bolt.new/~/sb1-rutfrxo7)


npm run dev

The default development command uses Expo Tunnel and targets Expo Go, so the
terminal should show a public `exp.direct` URL/QR code instead of a local
`10.x.x.x` address. If the CLI opens in development-client mode, press `s` in
the Expo terminal to switch to Expo Go. Use `npm run dev:local` only when the
phone and development machine are on a network that can reach the local address.

## Recurring cycles

`supabase/functions/senda-recurring-cycles` creates a fresh draft order for each completed recurring plan whose `next_run_date` is due. The new cycle is one-off so it must receive a fresh quote, customer payment, and payout verification; the completed source order is never modified financially.

Deploy the function and configure `SENDA_RECURRING_CRON_SECRET` as a Supabase secret. Invoke it from a trusted scheduler with:

```sh
curl -X POST "$SUPABASE_URL/functions/v1/senda-recurring-cycles" \
	-H "x-senda-cron-secret: $SENDA_RECURRING_CRON_SECRET"
```

Do not expose the cron secret to the mobile or web client.

## Payout reconciliation

`supabase/functions/senda-payout-reconciliation` verifies active Flutterwave transfers with `GET /transfers/{id}` every 15 seconds. It only updates attempts that are still active, and it stops treating an attempt as active after Flutterwave reports `COMPLETED`, `SUCCESSFUL`, `FAILED`, or `CANCELLED`.

The scheduler migration uses `pg_cron`, `pg_net`, and Supabase Vault. Before applying the migration, store these two secrets in Vault:

```sql
select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'SUPABASE_URL');
select vault.create_secret('YOUR_RANDOM_RECONCILIATION_SECRET', 'SENDA_RECONCILIATION_CRON_SECRET');
```

Set the same reconciliation secret for the Edge Function, then apply the migration:

```sh
npx supabase secrets set SENDA_RECONCILIATION_CRON_SECRET='YOUR_RANDOM_RECONCILIATION_SECRET'
npx supabase db push
npx supabase functions deploy senda-payout-reconciliation
```

The scheduler sends only the protected cron request. It never trusts client-reported payout status, and no card or transfer credentials are stored by the worker.

