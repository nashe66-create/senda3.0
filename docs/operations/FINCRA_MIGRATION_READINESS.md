# Fincra migration — readiness, runbook and outstanding work

**Purpose:** track the migration from Flutterwave to Fincra without losing historical records or creating a gap in collection, recipient validation, payout or reconciliation.

**Direction:** Fincra is the current primary provider being tried.  
**Source reviewed:** main commit b81797cda2809175fa5be4c9da1265303e65ff33 (9 November 2026).  
**Environment status:** this file does not assert that the migrations, Edge Functions, secrets, provider webhooks or cron jobs are deployed in any live environment.

## 1. Executive status

The main branch contains a substantial Fincra collection/conversion/payout lifecycle, but the wider migration is not complete.

| Capability | Repository status at snapshot | What still needs proving |
|---|---|---|
| Fincra quote | Implemented in senda-quote | Real sandbox response, pricing and expiry reconciliation |
| Fincra hosted GBP checkout | Implemented in fincra-checkout and collection screen | Actual account acceptance, redirects/callbacks, collection settlement timing |
| Collection status lookup | Implemented via fincra-checkout GET | Sandbox tests for all provider statuses and mismatch cases |
| Conversion | Implemented in fincra-conversion | Wallet funding mechanics, quote/amount reconciliation, attempt ledger usage |
| Individual payout | Implemented in fincra-payout | Beneficiary snapshot compatibility, corridor/method availability, payout delivery |
| Webhook authentication | HMAC-SHA512 verification implemented | Confirm actual Fincra headers, secret and payload in sandbox |
| Event deduplication/reconciliation | Database RPC and private event table implemented in migrations | Apply migrations in a test environment and test concurrency/replay |
| Recipient creation/verification | Still uses Flutterwave recipient functions | Replace with approved provider-neutral/Senda/Fincra validation path |
| Corridor, bank and mobile-money discovery | Flutterwave-specific functions/data still present | Verify Fincra coverage and implement the supported-method catalogue |
| KYC | Client data layer still calls flutterwave-kyc | Decide compliant KYC/AML operating model and implement/contract replacement |
| Scheduled payout reconciliation | Still Flutterwave-specific | Build and test Fincra-aware reconciliation before cutover |
| Historical Flutterwave records | Present in schema/types | Preserve read-only history and resolve outstanding legacy attempts |
| TypeScript schema contract | Behind new Fincra SQL fields | Update interfaces and ensure constraints/types agree |
| Live deployment | Not established by this repository review | Verify target Supabase migration history, function versions, secrets and schedules |

Do not describe the migration as complete until the completion criteria in the Flutterwave migration-status document are met.

## 2. Priority migration backlog

### P0 — beneficiary and corridor readiness

The current recipient save path in app/recipient/[id].tsx calls Flutterwave recipient create/update functions. The transfer creation screen also filters eligible recipients using a Flutterwave recipient ID.

This must be replaced before removing Flutterwave recipient services. Decide whether:
- Senda performs validation itself using a provider-neutral process;
- Fincra offers the required beneficiary/account verification for the target corridors;
- another validation service is required;
- verification status is supplied by a contracted partner.

The decision must specify what “verified” means, what data was checked, when it was checked, and whether validation expires or must be repeated. Do not set verification_status to verified just because the customer completed a form.

Corridor and payout-method availability must come from verified Fincra account/API capability for the intended country and method. The current research library prioritises UK → Nigeria, but research focus is not production enablement. The current main source tree does not contain a Fincra payout-options or Fincra recipient-onboarding Edge Function.

### P0 — Fincra scheduled reconciliation

The repository migration 20260908150000_schedule_payout_reconciliation.sql schedules senda-payout-reconciliation every 15 seconds through pg_cron and pg_net, using SUPABASE_URL and SENDA_RECONCILIATION_CRON_SECRET from Vault.

The current supabase/functions/senda-payout-reconciliation/index.ts still authenticates to Flutterwave and queries Flutterwave transfer statuses.

Actions:
1. Verify whether this migration has been applied and whether the named cron job is active in each Supabase environment.
2. Identify active transfer_attempts and commitments that the current worker may still reconcile.
3. Design a Fincra reconciliation worker that queries by the saved Fincra payout reference and applies status through the same idempotent reconciliation path.
4. Test completed, failed, pending, unknown, timeout, duplicate and provider-unavailable cases.
5. Ensure the worker cannot create a new payout; it should reconcile an existing reference only.
6. Switch the schedule only after the new worker is deployed and tested.
7. Preserve a separate historical reconciliation path for outstanding Flutterwave attempts if required.
8. Only then disable the old cron job/function and remove no-longer-needed secrets.

Do not leave the existing 15-second schedule pointing to a function whose provider credentials are being removed.

### P0 — quote and amount correctness

The current quote function derives per-commitment destination amounts from commitment allocations and existing commitment FX values, then requests an order-level Fincra quote. Confirm that the returned provider quote and the recipient-level breakdown reconcile exactly.

Verify:
- source amount vs customer charge vs Senda fee vs provider fee;
- source and destination currencies;
- amount-to-receive total vs sum of all commitments;
- quote expiry and locking;
- fixed-source and fixed-destination calculations;
- fee bearer and any charges withheld from destination proceeds.

The current Senda fee formula in code is max(0.5% of source amount, GBP 0.50). Treat this as implementation behaviour, not an approved permanent pricing policy.

### P0 — conversion state and attempt history

A migration creates fincra_conversion_attempts with unique idempotency keys, unique conversion references and one-active-attempt-per-plan constraints. The current Fincra conversion function appears to store its active reference/status directly on plans and transactions instead of inserting/updating fincra_conversion_attempts.

Before production:
- decide whether the attempt table is authoritative or should be removed from the intended design;
- make code and schema agree;
- persist request fingerprint, attempts, provider status, timestamps and reconciliation state if the table is retained;
- test concurrent conversion requests and timeouts after provider acceptance;
- prove a retry queries the original reference and cannot create duplicate FX conversion.

### P1 — provider-neutral data contracts

Update types/database.ts and affected queries to represent Fincra collection, conversion and payout references/statuses and any provider-neutral identifiers.

Do not bulk-rename Flutterwave columns. First map:
- existing rows and active references;
- current UI and Edge Function callers;
- SQL functions/triggers/views;
- scheduled jobs and webhooks;
- reporting/support requirements;
- historical record retention.

Keep legacy provider IDs readable for historical transactions. New domain types should separate Senda state from provider state.

### P1 — KYC, compliance and operational responsibility

The current quote function requires profile.kyc_status = verified. The client data layer still routes KYC submission/status through Flutterwave.

Before replacing that path, record:
- who is legally responsible for customer identification and verification;
- which entity performs checks;
- what evidence and statuses Senda receives;
- how rejected, pending and inconclusive cases behave;
- refresh/ongoing monitoring rules;
- how support handles false positives and appeals;
- data retention and access controls.

Do not infer UK regulatory permissions, safeguarding arrangements or compliance allocation from the provider API alone. Obtain appropriate legal/compliance confirmation.

### P1 — event/reconciliation observability

The database maintains fincra_webhook_events with raw payload and event metadata. Add operational visibility for:
- signature failures;
- missing or unknown references;
- amount/currency mismatches;
- repeated webhook delivery;
- events stuck unprocessed;
- failed internal function invocation;
- conversion or payout in reconciliation_required;
- provider GET lookup unavailable;
- partial failure across an order.

Sensitive payloads and customer data must not be placed in public logs or broadly accessible dashboards.

## 3. Supabase migrations introduced for Fincra

The main snapshot contains these migrations:

| Migration | Purpose observed in source |
|---|---|
| 20261105112847_fincra_single_provider_migration_foundation.sql | Fincra plan funding/conversion fields, provider constraint update, fincra_conversion_attempts and webhook event table foundation |
| 20261109093000_fincra_migration_phase1.sql | Fincra profile/plan quote and collection/conversion/payout fields and financial values |
| 20261109093010_fincra_migration_phase2.sql | Fincra transaction/plan/commitment references, statuses and wallet fields |
| 20261109093020_fincra_lifecycle_reconciliation.sql | Fincra webhook event table, apply_fincra_webhook_event RPC, stage-specific reconciliation, amount/currency/state checks and privileges |
| 20261109093030_fincra_webhook_event_schema_repair.sql | Webhook event schema repair, stage index and signature_valid trigger distinguishing provider webhooks from polling events |

Important:
- These are source files in Git. Their application to production has not been established here.
- Inspect migration history before applying them; do not blindly run migrations against an unknown live schema.
- Review the repeated/overlapping schema definitions and the migration order in a disposable environment.
- Verify that the live RPC definition and grants match the repository.
- Confirm RLS and the webhook event table privileges after migration.

## 4. Supabase Edge Function settings

The current supabase/config.toml contains:

    project_id = "senda3"

    [functions.fincra-webhook]
    verify_jwt = false

Only the external Fincra webhook is explicitly configured with JWT verification disabled. The webhook must still verify its HMAC signature over the raw body before processing. Do not disable JWT verification for customer-facing functions as a convenience.

Confirm that the deployed function names, JWT settings and source version match the intended environment. A Git change does not automatically prove the deployed function source is updated.

## 5. Required secrets/configuration

| Secret/config | Purpose |
|---|---|
| SUPABASE_URL | Supabase server URL |
| SUPABASE_SERVICE_ROLE_KEY | Privileged server-side Supabase access |
| FINCRA_SECRET_KEY | Preferred Fincra API secret |
| FINCRA_API_KEY | Fallback Fincra API key variable supported by adapter |
| FINCRA_ENV | Sandbox/production selection; defaults to sandbox |
| FINCRA_BASE_URL | Explicit base URL override |
| FINCRA_BUSINESS_ID | Fincra business identifier where required |
| FINCRA_WALLET_ID | Fincra wallet used for conversion/payout |
| FINCRA_WEBHOOK_SECRET | Preferred HMAC webhook secret |
| FINCRA_WEBHOOK_SECRET_KEY | Webhook secret fallback supported by code |
| FINCRA_WALLET_INTERNAL_SECRET | Restricts fincra-wallet endpoint |
| SENDA_RECONCILIATION_CRON_SECRET | Existing legacy reconciliation schedule secret stored in Vault and function environment |
| SENDA_RECURRING_CRON_SECRET | Protects recurring-cycle scheduler |

Secret names and values must be confirmed in the target environment. Do not copy secrets into this document, GitHub, client environment or logs.

## 6. Sandbox test matrix

Do not test with live customer money. Run the following against a dedicated Fincra sandbox account and a non-production Supabase environment.

### Quote and order
- Valid fixed-source order with one recipient.
- Valid fixed-destination order.
- More than one commitment with the same destination currency.
- Wrong-country/wrong-currency recipient.
- Missing allocation, duplicate allocation and commitment owned by another plan.
- KYC not verified.
- Quote provider timeout, malformed response, missing quote reference and expired quote.
- Re-quote after expiry and attempt to lock the expired quote.
- Concurrent quote-lock requests.

### Collection
- Hosted checkout opens with the exact locked GBP customer charge.
- Correct successful collection webhook.
- Correct successful GET verification/poll.
- Pending then successful.
- Failed, cancelled and reversed collection.
- Duplicate webhook delivery.
- Invalid signature and missing signature.
- Wrong amount, wrong currency, wrong reference and wrong plan state.
- Request timeout after Fincra may have created the checkout.
- App closes/reopens or browser redirect is blocked while payment remains pending.
- Retry path reuses existing transaction/reference and does not create a duplicate charge.

### Conversion
- Successful funded plan and sufficient wallet balance.
- Insufficient wallet balance.
- Wallet unavailable/malformed response.
- Conversion pending then successful.
- Failed and reversed conversion.
- Duplicate and out-of-order conversion events.
- Amount/currency mismatch.
- Timeout after provider may have accepted the conversion.
- Two concurrent conversion attempts.
- Re-query by the original reference without creating a second conversion.

### Payouts
- One recipient payout succeeds.
- Several commitments: all succeed.
- Several commitments: mixed success and failure.
- Provider accepts payout but request times out.
- Payout status remains pending/processing.
- Payout fails/reverses.
- Wrong amount or currency.
- Invalid/changed beneficiary snapshot.
- Duplicate webhook.
- Retry while original payout is uncertain must be blocked.
- Provider GET status lookup resolves an uncertain payout.
- Order summary matches all recipient-level outcomes.

### Security and operations
- A customer cannot access another customer's plan, transaction, commitment or payout reference.
- A client cannot invoke privileged internal functions.
- Wallet endpoint rejects missing/wrong internal secret.
- Webhook is rejected for invalid HMAC even though verify_jwt is false.
- Poll events are not treated as signed external webhooks.
- Service role has only the intended use; anon/authenticated cannot directly access private webhook event table/RPC.
- Cron cannot be triggered without its secret.
- Logs do not include secrets, card details or unnecessary beneficiary PII.

## 7. Release runbook

### Before sandbox deployment
1. Review PR and migration diff.
2. Confirm the target Supabase project is the sandbox project.
3. Confirm the sandbox Fincra key, wallet and business identifiers.
4. Set FINCRA_ENV=sandbox or the agreed sandbox base URL.
5. Set webhook secret and configure the provider's sandbox webhook URL.
6. Apply migrations to the sandbox project after checking migration history.
7. Deploy the necessary Edge Functions individually.
8. Read back deployed function versions and JWT settings.
9. Execute the test matrix and record actual results.

### Before production
1. Obtain explicit release approval.
2. Obtain confirmation of the UK operating/regulatory model and Fincra commercial permissions.
3. Confirm live account, currencies, corridors, payout methods, fees, settlement/wallet funding and refund/dispute process with Fincra.
4. Verify production secrets and wallet balances.
5. Apply reviewed migrations after backup and schema-history check.
6. Deploy Fincra functions individually and verify versions.
7. Configure and test production webhook signature delivery.
8. Replace or safely disable the Flutterwave-specific reconciliation schedule only after a Fincra replacement is proven.
9. Monitor first low-value controlled transactions and recipient outcomes.
10. Reconcile customer funds, converted funds, wallet balance and each payout before increasing volume.

A web build deployment is not a Supabase backend deployment. A merged migration file is not evidence of an applied migration. A deployed function is not evidence that the provider credentials/webhook are correct.

## 8. Incident handling principles

- **Collection uncertain:** do not ask the customer to pay again. Query the checkout by the existing reference and reconcile.
- **Collection successful, conversion uncertain:** block payouts; query the same conversion reference and reconcile.
- **Conversion successful, payout uncertain:** query the individual payout reference; do not create a new payout.
- **One recipient failed:** keep other completed commitments completed. Do not cancel or replay all payouts.
- **Mismatch:** do not mark success. Preserve event/provider evidence and route to support/review.
- **Webhook outage:** use provider GET lookup by saved reference and replay/reconcile through the same idempotent database path.
- **Provider outage:** preserve processing/reconciliation-required state. Alert operations; do not convert unknown into failure.
- **Secrets exposed:** rotate affected keys and webhook secrets, assess logs and access, and follow the incident process. Never paste the exposed value into a ticket or chat.

## 9. Completion checklist

The migration can be called complete only when the evidence criteria in docs/payments/providers/FLUTTERWAVE_MIGRATION_STATUS.md are satisfied and reviewed. Update this document with the actual environment, date, function versions, migration versions, test evidence and remaining caveats. Never fill in these values from assumptions.
