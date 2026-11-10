# Senda — repository instructions for GitHub Copilot

You are working on Senda, a cross-border grouped-remittance product. Treat this repository as a live financial application, not a generic CRUD app. Correctness of money movement, ownership, provider verification, auditability and recovery is more important than making a change look complete.

## Required reading before changing code

1. Read docs/README.md.
2. Read docs/product/SENDA_PRODUCT_OVERVIEW.md for product purpose and customer experience.
3. Read docs/architecture/CORE_DOMAIN_MODEL.md and docs/architecture/MONEY_MOVEMENT_LIFECYCLE.md before changing plans, commitments, quotes, transactions, payment status or payouts.
4. Read docs/payments/PROVIDER_INTEGRATION_MODEL.md and docs/payments/providers/FINCRA_IMPLEMENTATION.md before changing payment or provider code.
5. Read docs/operations/FINCRA_MIGRATION_READINESS.md before changing, removing or replacing any remaining Flutterwave integration.
6. Read the path-specific instruction file that applies to the files you are editing.

The documents describe intent and the last audited code state. The code and migrations on the current branch are the implementation evidence. When documentation and code disagree, do not silently choose one: identify the discrepancy, explain it, and update the appropriate document as part of the change.

## Product and architecture principles

- Senda owns the remittance order, customer journey, recipient records, commitments, quote presentation, internal statuses, audit trail and reconciliation experience.
- A plan is Senda's grouped remittance order. A commitment is one obligation to one recipient within that order. A transaction records the customer's collection/payment leg. A commitment payout is a separate disbursement leg.
- One order currently has one source currency (GBP) and one destination country/currency. Multiple commitments can be paid to different recipients and can use supported payout methods, but do not silently expand an order to multiple destination currencies or countries.
- The intended customer proposition is one Senda order and one customer funding journey, followed by separate, independently tracked payouts to the recipients in that order.
- Payment providers are infrastructure behind Senda's product. Do not let provider terminology or provider-specific status values leak into customer-facing domain concepts unless there is a clear mapping.
- Fincra is the intended primary provider for the current migration/testing effort. Do not add new Flutterwave payment, FX or payout functionality. Existing Flutterwave code and columns are legacy/transitional until the migration readiness checklist says their replacement and historical-data treatment are complete.
- Do not claim that the migration is complete just because the Fincra checkout path exists. Recipient validation, KYC, corridor/network/bank data, reconciliation and operational scheduling must also be assessed.

## Non-negotiable money-movement rules

- Never trust a client redirect, browser return, client state, submitted form value or webhook body by itself as proof that money moved.
- The backend must verify collection, conversion and payout outcomes against authenticated provider responses or correctly authenticated provider webhooks.
- Do not mark a plan funded from a checkout URL or a client-side success screen. Collection must be verified, including GBP amount, currency, reference, ownership and eligible plan state.
- Do not initiate conversion before successful collection is recorded. Do not initiate any recipient payout before successful collection and successful conversion are both confirmed.
- A grouped order may have successful, processing and failed commitments at the same time. Preserve recipient-level outcomes. Never mark the whole order completed while any commitment remains unresolved.
- Preserve quote-time recipient snapshots. A later edit to a saved recipient must not silently alter the beneficiary details of an already quoted or funded commitment.
- Use deterministic provider references and idempotency keys for collection, conversion and each payout. Reuse the same reference when resolving an uncertain attempt; do not create a second payment or payout just because a request timed out.
- If a provider request may have succeeded but Senda cannot confirm the result, keep the item in a processing/unknown/reconciliation-required state. Query the provider and reconcile. Do not convert ambiguity into a definitive failure and do not blindly retry.
- Validate amount and currency independently for collection, conversion and every payout. Reject mismatches and route them to support/reconciliation; never “correct” provider values silently.
- Webhooks must be authenticated using the provider's documented signature process over the raw request body, deduplicated, validated and applied idempotently. A webhook endpoint that is public at the platform JWT layer must still authenticate the provider itself.
- Never put service-role keys, Fincra API keys, webhook secrets, internal function secrets or cron secrets in client code, EXPO_PUBLIC variables, logs, fixtures or documentation.
- Never initiate a refund, reverse a payout, retry a financially ambiguous operation or change live money state without an explicit, verified business rule and appropriate authorisation.

## Fincra migration rules

- Use the current Fincra implementation as the baseline: shared adapter in supabase/functions/_shared/fincra.ts; quote in senda-quote; hosted collection in fincra-checkout; conversion in fincra-conversion; recipient payout in fincra-payout; provider events in fincra-webhook; shared internal invokers in _shared/internal-functions.ts; and event reconciliation in the apply_fincra_webhook_event database function.
- Verify current code before assuming an endpoint, payload, event name, response shape, supported corridor or credential name. The Fincra implementation document is a repository implementation map, not a substitute for Fincra's current API contract.
- Keep Fincra calls server-side. Client code may call authenticated Senda Edge Functions only.
- Retain Flutterwave identifiers required for historical transactions until a safe data migration/archive plan is approved. Do not bulk rename or drop columns merely to make names provider-neutral.
- Before removing a Flutterwave function, search all code, database triggers, scheduled jobs, webhook registrations, deployment configuration and historical references. Update the readiness document with evidence.
- Do not invent Fincra recipient onboarding, KYC, payout-method discovery or corridor support. Those are identified migration gaps unless verified by current code and provider evidence.

## Engineering workflow

At the start of a task:
- Inspect the current branch and working tree. Do not overwrite or discard uncommitted changes.
- Confirm the branch is based on the latest intended main branch. The user may have Copilot work in progress; preserve it.
- Search for all callers, database objects and Edge Functions affected by the change. Do not change only the most visible screen.
- Read the current implementation and migration files before relying on these docs.

While making a change:
- Keep business rules in the appropriate layer. Screens collect input and render state; lib/data.ts provides client data access; Edge Functions authenticate and orchestrate trusted operations; SQL enforces atomic constraints and reconciles provider events.
- Keep user ownership checks even when using service-role Supabase clients. Service role bypasses RLS; every operation must explicitly scope to the authenticated user or a trusted internal call.
- Use narrow, additive database migrations. Do not edit already-applied migrations to change production history. Do not run destructive SQL or alter production data without explicit approval.
- Use typed request/response structures. Avoid any and silent coercion for financial amounts, currencies and provider status mappings.
- Keep amounts in the correct currency and use decimal/minor-unit-safe calculations. Do not mix GBP, destination currency and provider wallet currency.
- Preserve accessible loading, error, retry and reconciliation states in the UI. A timeout must not invite a duplicate payment.
- Add or update tests for success, failure, duplicate, mismatch, timeout/unknown and retry paths when changing money movement.

Before finishing:
- Run the relevant checks available in package.json: npm run typecheck, npm run lint and npm run build:web. There is currently no package test script in the audited package.json; do not claim tests ran if they did not.
- Review the complete diff, especially security, status transitions, amount/currency checks, migration reversibility and old-provider references.
- Update the relevant docs, source inventory and migration-readiness status. Record decisions in docs/decisions when a product or architecture decision is made.
- Report what changed, checks actually run and any outstanding risks. Never say a production function, migration, webhook or secret was deployed unless that action was explicitly authorised and verified.

## Deployment and production safety

- A code merge is not a Supabase deployment. A Cloudflare Pages deployment is not an Edge Function deployment. A migration file in Git is not proof that it has been applied to the live database.
- Do not deploy Supabase Edge Functions, apply production migrations, change secrets, configure provider webhooks, run live transfers or alter production schedules without explicit user authorisation.
- Separate sandbox validation, staging validation and production release. State which environment was actually tested.
- Treat production payment and payout changes as high risk and require a rollout/rollback and reconciliation plan.

## Documentation maintenance

Documentation is part of the implementation. Update it whenever a change affects product behaviour, domain semantics, statuses, provider calls, database fields, security, configuration, operational procedures or migration completion.

If a change is intentionally temporary, mark it as temporary and add an owner/exit condition or a follow-up item. Do not leave contradictory provider instructions or obsolete runbooks behind.
