# Flutterwave — legacy integration inventory and migration rules

**Direction:** Senda is moving away from Flutterwave and is testing Fincra as its current primary payment provider. Do not add new Flutterwave money movement.

**Important distinction:** legacy code, provider IDs and historical transaction records still exist in the repository. Their presence does not mean Flutterwave remains the intended provider. Their presence also does not mean they can safely be deleted immediately.

## 1. What remains in the audited main source

### Client data layer

lib/data.ts still exposes Flutterwave-named helpers or calls for:
- payout options and corridor data;
- live FX lookup;
- KYC submit/status;
- card collection, charge authorisation and charge verification;
- transfer create, confirm, cancel and status;
- wallet balance;
- corridor sync;
- recipient create/update;
- payment-method handling.

The current collection screen app/collect/[transactionId].tsx uses the new Fincra checkout helpers, but the rest of lib/data.ts still includes the older functions. Search all call sites before removing any exported function.

### Recipient setup

app/recipient/[id].tsx currently calls createFlutterwaveRecipient/updateFlutterwaveRecipient after saving mobile-money or bank details and uses the returned provider success to set the recipient verification outcome.

app/plan/new.tsx filters eligible recipients by verification_status === verified and a non-empty flutterwave_recipient_id in the audited main version.

This means the current user flow may still depend on Flutterwave to create/verify the recipient before the Fincra payout path can use the recipient snapshot. This is a priority migration gap, not an approved permanent design.

### KYC and corridor discovery

lib/data.ts still calls flutterwave-kyc for KYC submit/status. It also calls Flutterwave routes for FX and legacy payout options/corridor synchronization.

The product must continue to satisfy the relevant KYC/AML and corridor validation requirements when Flutterwave is removed. Do not simply delete KYC/corridor calls or mark recipients verified without an approved replacement process.

### Scheduled payout reconciliation

supabase/functions/senda-payout-reconciliation/index.ts still contains Flutterwave authentication and transfer-status lookup logic, including FLW_CLIENT_ID, FLW_CLIENT_SECRET and Flutterwave endpoints. The repository migration 20260908150000_schedule_payout_reconciliation.sql schedules this function every 15 seconds with pg_cron/pg_net and a Vault-held cron secret. Whether that job is active in a given Supabase environment must be verified separately.

Do not assume this scheduled function reconciles Fincra payouts. Before replacing it:
- identify every pg_cron/pg_net/Vault/scheduler trigger that calls it;
- verify whether any active or historical Flutterwave transfer attempts still need reconciliation;
- implement and sandbox-test an equivalent Fincra reconciliation worker;
- preserve old attempt history and support lookup;
- disable old schedules only after verifying the replacement and outstanding records.

### TypeScript and database coupling

types/database.ts still includes fields such as flutterwave_customer_id, flutterwave_sender_id, flutterwave_recipient_id, flutterwave_transfer_id, flutterwave_payment_id, flutterwave_charge_id, flutterwave_network_code and flutterwave_bank_name.

TransferAttempt.provider is typed as the literal flutterwave, while the November 2026 migration permits both flutterwave and fincra in the database constraint.

RecipientSnapshot also contains flutterwave_recipient_id.

These fields should be addressed through a staged provider-neutral model and data migration, not a mass rename that breaks history or current queries.

### Edge Functions

The repository still contains Flutterwave-specific Edge Function directories for charges, transfers, recipient management, KYC, corridors, FX, wallet balance, payout options and webhooks.

Some may now be unused by the Fincra collection screen; some are still used by other screens/helper functions; some may be needed for historical reconciliation. A directory's presence or absence of a current visible screen is not sufficient evidence to delete it.

## 2. Current Fincra path and legacy boundary

The audited main snapshot contains:
- Fincra quote call in senda-quote;
- hosted GBP collection in fincra-checkout;
- order-level conversion in fincra-conversion;
- one payout per commitment in fincra-payout;
- authenticated provider events in fincra-webhook;
- shared Fincra API adapter and internal function calls.

senda-orchestrate rejects unsupported legacy money movement actions with a 410 response and directs callers toward the Fincra lifecycle endpoints. It still owns quote locking, cancellation of eligible unpaid orders and order status recalculation.

Do not interpret this as proof that all recipient, KYC, corridor, reconciliation or operational dependencies have migrated.

## 3. Safe migration sequence

### Phase A — inventory
- Search all source files for Flutterwave identifiers, endpoints, env variables and function names.
- Search SQL migrations, functions, triggers, cron jobs, Vault secrets and provider dashboard webhook registrations.
- Identify current active callers and deployed function versions.
- Identify historical transactions/attempts still tied to Flutterwave.

### Phase B — replace required capabilities
- Choose and verify the KYC/AML operating process and identity provider.
- Implement recipient/bank/mobile-money validation and supported-method discovery for the intended Fincra corridors.
- Remove the frontend's requirement for a Flutterwave recipient ID, replacing it with a provider-neutral recipient verification contract.
- Replace the Flutterwave scheduled payout reconciler with a Fincra-aware reconciler.
- Update activity/history, support and status lookups to understand Fincra references.
- Add provider-neutral types for collection, conversion and payout references/attempts where appropriate.

### Phase C — data compatibility
- Define how old Flutterwave IDs/references and old events are retained.
- Do not erase historical provider identifiers that are needed to display old transfers, investigate complaints, reconcile accounting or respond to disputes.
- Add new columns/tables through new ordered migrations.
- Backfill only when the mapping is known and auditable.
- Update every query, view, RPC, Edge Function and TypeScript type.

### Phase D — controlled cutover
- Run the full Fincra sandbox test matrix.
- Confirm webhook subscriptions and environment-specific secrets.
- Confirm migrations and function versions in the target Supabase environment.
- Confirm scheduled reconciliation and alerting.
- Stop creating new Flutterwave references only after the Fincra path is verified.
- Retain historical lookup/read-only support as required.
- Remove old functions/secrets/schedules only after there are no active callers or unresolved legacy transactions.

## 4. Rules for Copilot

- Do not add a new Flutterwave money-movement call.
- Do not remove a Flutterwave function or column just because it appears unused.
- Before any removal, provide a call-site and database/scheduler inventory in the PR description.
- Do not map existing Flutterwave recipient IDs to Fincra IDs unless Fincra has actually returned and stored a verified mapping.
- Do not mark recipient verification complete by copying an old provider success status without a valid Fincra/Senda verification rule.
- Preserve the ability to read and display historical Flutterwave transactions.
- Update this file as each legacy dependency is replaced, tested, disabled and ultimately removed.

## 5. Evidence required to mark migration complete

The migration is complete only when all of the following have evidence:
- customer quote and GBP collection use Fincra;
- conversion and recipient payouts use Fincra;
- beneficiary validation and supported corridor/method discovery no longer depend on Flutterwave;
- KYC/AML responsibility and implementation are approved and tested;
- payout status lookup and scheduled reconciliation are Fincra-aware;
- webhook configuration, secrets and event replay are validated;
- no new Flutterwave references are created;
- historical Flutterwave transactions remain queryable and auditable;
- no active UI, Edge Function, SQL trigger, scheduled job or operational procedure depends on Flutterwave for new transactions;
- types, docs, environment examples and deployment runbooks agree with the new architecture;
- production migration has been explicitly approved and verified.

Do not declare completion based only on the removal of Flutterwave strings from the frontend.
