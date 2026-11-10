# Fincra — current repository implementation

**Status:** current intended provider for the Senda payment migration/testing effort.  
**Source snapshot:** main commit b81797cda2809175fa5be4c9da1265303e65ff33 (9 November 2026).  
**Important:** this document describes code found in the repository. It does not prove that migrations, functions, credentials, webhooks or wallet funding are configured in a live Supabase/Fincra environment.

## 1. Server-side API adapter

File: supabase/functions/_shared/fincra.ts

The shared adapter:
- resolves the base URL from FINCRA_BASE_URL when explicitly set;
- otherwise uses FINCRA_ENV, defaulting to sandbox;
- selects https://api.fincra.com when FINCRA_ENV is production;
- otherwise selects https://sandboxapi.fincra.com;
- reads FINCRA_SECRET_KEY, with FINCRA_API_KEY as a fallback;
- sends the credential in the api-key header;
- parses JSON responses and raises FincraApiError on non-success HTTP responses;
- supports an idempotency key through X-Idempotency-Key;
- provides helpers for quote, checkout, wallet, conversion, payout and webhook signature operations.

Never import the Fincra adapter into client/mobile code. Never expose its key through an EXPO_PUBLIC variable.

### Current API operations used by the adapter

| Purpose | HTTP method and path | Helper |
|---|---|---|
| Quote | POST /quotes/generate | fincraRequest in senda-quote |
| Hosted checkout | POST /checkout/payments | createFincraCheckout |
| Checkout lookup | GET /checkout/payments/merchant-reference/{reference} | getFincraCheckoutByReference |
| Wallet list | GET /wallets | listFincraWallets |
| Wallet detail/balance | GET /wallets/{walletId} | getFincraWallet |
| Conversion initiation | POST /conversions/initiate | initiateFincraConversion |
| Conversion lookup | GET /conversions/reference/{reference} | getFincraConversionByReference |
| Payout initiation | POST /disbursements/payouts | createFincraPayout |
| Payout lookup | GET /disbursements/payouts/reference/{reference} | getFincraPayoutByReference |

These are the paths used in repository code. Verify the current Fincra API contract, account entitlement, required request fields and production availability with Fincra before changing payloads or treating a capability as commercially enabled.

## 2. Quote flow

File: supabase/functions/senda-quote/index.ts

The quote function authenticates the user, scopes the plan to that user, requires draft/quoted state and a verified profile KYC status, validates pricing mode and destination data, and verifies that every supplied allocation maps to a commitment in the plan.

It rejects missing, duplicate or foreign commitment allocations and checks that recipient and commitment currencies match the plan destination currency.

It calculates:
- total source allocation;
- total destination allocation;
- per-commitment destination amount;
- per-commitment payout method;
- Senda fee;
- provider quote and fee values;
- customer charge and destination receive totals;
- quote reference and expiry.

The provider request currently uses sourceCurrency GBP, the plan destinationCurrency, the total source amount, feeBearer customer, and plan ID references. The Fincra quote response is read for quoteReference/reference, rate, fee, amountToCharge, amountToReceive and expiry.

The function persists quote details onto plans and each commitment, including quote-time recipient_snapshot information.

### Current Senda fee implementation

calculateSendaFee currently returns the greater of:
- 0.5% of total source amount; or
- GBP 0.50 minimum.

This is a code-level observation. Do not treat it as the final approved commercial policy without confirmation. If changing it, update product/pricing documentation and tests.

### Quote risks to validate

- Confirm Fincra's quote response amount/rate/fee semantics against sandbox responses and the commercial contract.
- Confirm that the amount-to-charge and amount-to-receive reconcile exactly to the commitment breakdown and the customer-visible quote.
- Confirm quote expiry and locking behaviour around clock skew and retries.
- Ensure the current fallback calculations cannot present an estimated amount as a provider-confirmed quote.

## 3. Quote locking and orchestration

File: supabase/functions/senda-orchestrate/index.ts

The current supported actions are:
- lock-quote;
- cancel-order;
- recalc-order-status.

The lock action requires a quoted, unexpired, unlocked plan and quote-time recipient snapshots/payout methods for every commitment. It updates commitments to ready and conditionally marks the plan awaiting_payment with payment_status pending and quote_locked_at.

Cancellation is restricted to eligible unpaid states. A funded order cannot be cancelled unless a verified refund process exists.

The function explicitly returns a legacy money movement disabled response for actions outside the supported set. It is not the current Fincra payout executor; the Fincra webhook and internal functions drive conversion and payout.

## 4. Hosted GBP collection

Files:
- app/collect/[transactionId].tsx
- lib/data.ts
- supabase/functions/fincra-checkout/index.ts

Client function createFincraCheckout(planId) POSTs the plan ID to the Edge Function. The Edge Function authenticates and checks:
- plan belongs to user;
- customer_pays is positive;
- quote is locked;
- plan is in an allowed unpaid payment state;
- quote has not expired;
- an existing transaction's amount matches the quote;
- a customer email is present.

It creates/reuses a transaction and persists a stable checkout/collection reference before calling Fincra. The provider request uses:
- amount = plan.customer_pays;
- currency = GBP;
- merchantReference/reference = the stable Senda reference;
- description and plan/user metadata;
- optional business, redirect URL, callback URL and payment method fields;
- customer name/email/phone.

The hosted checkout URL is extracted on the client from recognised response URL fields and opened in a browser. The browser return is not trusted as payment confirmation.

### Collection verification

GET fincra-checkout?reference=...:
- verifies the reference belongs to the authenticated user's transaction;
- queries Fincra by merchant reference;
- maps the provider status;
- applies a stable poll event through apply_fincra_webhook_event;
- returns verified status/reason to the client;
- invokes fincra-conversion when a successful collection has been reconciled.

The signed webhook path can also invoke conversion after successful collection. These two paths may overlap, so conversion claiming and stable references must prevent duplicate conversion.

The collection SQL transition checks GBP currency and amount against both transaction.amount_gbp and plan.customer_pays, checks quote lock and plan/payment state, then marks transaction successful, plan funded and commitments ready. A mismatch is not a success.

## 5. Fincra wallet and conversion

Files:
- supabase/functions/fincra-conversion/index.ts
- supabase/functions/_shared/fincra.ts

Conversion is allowed only when collection is successful and plan status is funded or payouts_processing.

The function:
- refuses an already successful conversion;
- refuses terminal failed/reversed conversion without reconciliation;
- checks an existing processing reference rather than submitting a second conversion;
- loads FINCRA_WALLET_ID;
- reads wallet available balance from the provider response;
- requires available balance >= plan.source_amount;
- conditionally claims the plan's conversion reference/status;
- calls POST /conversions/initiate for GBP to the plan destination currency with wallet, business and plan/user metadata;
- stores the conversion reference/status on the transaction.

The reference defaults to senda-conversion-{plan_id}.

GET fincra-conversion?reference=... queries the provider and reconciles the returned status through apply_fincra_webhook_event. Successful conversion reconciliation may trigger payout fan-out.

### Important implementation caveat

Migration 20261105112847_fincra_single_provider_migration_foundation.sql creates fincra_conversion_attempts with a uniqueness rule for one active conversion per plan. The currently audited fincra-conversion function appears to persist its main claim/reference/status on plans and transactions and does not insert/update that attempt table. Do not assume the attempt table is currently the authoritative runtime ledger until code is changed and tests prove it.

## 6. Per-commitment payout

File: supabase/functions/fincra-payout/index.ts

The payout function can be called by an authenticated user for their own commitment or by a trusted internal caller. It:
- loads the commitment and verifies ownership;
- loads the associated plan;
- requires successful payment and successful conversion;
- requires commitment status ready;
- requires a positive destination amount, destination currency and recipient_snapshot;
- derives a stable reference senda-payout-{commitment_id} if none is saved;
- conditionally changes the commitment from ready to processing;
- sends amount, currency, wallet, reference, business, beneficiary snapshot and plan/commitment/user metadata to Fincra;
- stores payout processing state on the successful transaction.

If an error occurs after the commitment was claimed, the function attempts to mark it reconciliation_required while retaining the reference. This is deliberate: the provider may have accepted the payout despite a timeout or lost response.

GET fincra-payout?reference=... verifies that the reference belongs to the authenticated user's commitment, queries Fincra and applies the result through the database reconciliation function.

Do not use mutable current recipient details instead of the commitment's quote-time recipient_snapshot.

## 7. Webhook processing

Files:
- supabase/config.toml
- supabase/functions/fincra-webhook/index.ts
- supabase/functions/_shared/fincra.ts
- supabase/migrations/20261109093020_fincra_lifecycle_reconciliation.sql
- supabase/migrations/20261109093030_fincra_webhook_event_schema_repair.sql

supabase/config.toml sets verify_jwt=false for fincra-webhook so an external provider can call it. This does not make the webhook trustworthy. The handler:
1. accepts POST only;
2. reads the exact raw body;
3. requires FINCRA_WEBHOOK_SECRET or FINCRA_WEBHOOK_SECRET_KEY;
4. accepts x-fincra-signature or x-signature;
5. validates HMAC-SHA512 over the raw body and compares the hex signature;
6. parses event type, reference, status, amount, currency and event ID;
7. classifies the event as collection, conversion or payout;
8. maps provider status to pending, processing, successful, failed or reversed;
9. uses provider event ID or a SHA-256 hash of raw body as stable event identity;
10. calls apply_fincra_webhook_event;
11. returns a retryable response for selected prerequisite/reference-not-found conditions;
12. invokes conversion after successful collection and ready payouts after successful conversion.

The database function validates stage prerequisites and amount/currency before applying success. The webhook event table is RLS-enabled and permissions are revoked from public, anon and authenticated roles. The SQL function is granted to service_role.

### Event mapping

The webhook currently infers stage from event type text:
- conversion/convert → conversion;
- payout/disbursement → payout;
- checkout/collection/payment/charge → collection.

It maps status aliases such as success/completed/paid to successful, cancel/cancelled to failed, and refunded to reversed. Unrecognised event types/status values are rejected rather than promoted to a final state.

Verify exact event names/header names/payload fields using actual Fincra sandbox webhooks and the provider account configuration. Do not assume this regex mapping covers every Fincra event variant.

## 8. Internal function calls and wallet endpoint

File: supabase/functions/_shared/internal-functions.ts

invokeFincraFunction invokes fincra-conversion or fincra-payout with server credentials and x-senda-internal-key. invokeReadyFincraPayouts loads commitments in ready status for the plan and calls fincra-payout sequentially.

File: supabase/functions/fincra-wallet/index.ts

The wallet endpoint is restricted by FINCRA_WALLET_INTERNAL_SECRET and X-Senda-internal-secret. It supports wallet list or balance/detail lookup. It is not a public customer endpoint.

## 9. Required Fincra secrets and configuration

| Variable | Use | Notes |
|---|---|---|
| FINCRA_SECRET_KEY | Fincra API authentication | Preferred variable |
| FINCRA_API_KEY | Fallback API-key variable | Adapter fallback |
| FINCRA_ENV | Sandbox/production selection | Defaults to sandbox |
| FINCRA_BASE_URL | Explicit API base URL override | Must be controlled by server configuration |
| FINCRA_BUSINESS_ID | Business identifier in provider requests | Optional in current code path; confirm account requirement |
| FINCRA_WALLET_ID | Wallet used for conversion and payout | Required by current conversion flow |
| FINCRA_WEBHOOK_SECRET | Webhook HMAC secret | Preferred variable |
| FINCRA_WEBHOOK_SECRET_KEY | Webhook secret fallback | Supported by current code |
| FINCRA_WALLET_INTERNAL_SECRET | Restricts wallet utility function | Never expose to client |

Supabase runtime also needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for privileged Edge Function operations.

Never put these secrets in .env.example with real values, app.json, EXPO_PUBLIC variables, GitHub source, client configuration or logs.

## 10. Fincra implementation verification checklist

- [ ] Fincra sandbox credentials provisioned in the correct Supabase environment.
- [ ] Sandbox/production base URL and environment are explicit and independently checked.
- [ ] Business and wallet IDs confirmed against the contracted account.
- [ ] Wallet currency, available balance semantics and settlement timing verified.
- [ ] Quote amount/rate/fee/expiry fields verified against real provider responses.
- [ ] Hosted checkout URL extraction verified for actual payload variants.
- [ ] GBP collection event header, signature algorithm and payload verified.
- [ ] Conversion event names, status mapping, amount/currency and reference verified.
- [ ] Payout request beneficiary shape and each required field validated for the target corridor.
- [ ] Payout event names, account reference and amount/currency verified.
- [ ] GET lookup endpoints tested for pending/success/failure/unknown.
- [ ] Duplicate, delayed and out-of-order webhooks tested.
- [ ] Timeout-after-provider-acceptance scenarios tested without duplicate money movement.
- [ ] All migrations applied in a non-production environment and schema checked.
- [ ] Live production function versions and secrets verified separately from Git.
- [ ] Operational reconciliation and incident ownership documented.

## 11. What is not established by this document

The code does not establish current production corridor permissions, provider pricing, payout delivery time, settlement availability, UK regulatory permission, safeguarding model, KYC ownership, refund process or commercial support. Confirm each with Fincra and appropriate advisers. A sandbox technical success is not a production launch approval.
