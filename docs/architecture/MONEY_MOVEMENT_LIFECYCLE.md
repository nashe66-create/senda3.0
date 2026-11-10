# Senda — money-movement lifecycle

This is the canonical description of the intended financial sequence. It distinguishes Senda's domain states from Fincra's external events.

## 1. Overview

Current intended sequence:

1. Customer creates a draft grouped order and recipient commitments.
2. Senda validates the order and creates a provider-backed quote.
3. Customer reviews and locks the quote.
4. Customer pays the GBP amount through hosted checkout.
5. Senda verifies collection and marks the order funded.
6. Senda checks the GBP wallet and initiates one order-level FX conversion.
7. Senda verifies the conversion.
8. Senda initiates one payout per ready commitment.
9. Senda verifies each payout and updates the parent order summary.
10. Uncertain or mismatched outcomes remain visible and are reconciled before retry or support resolution.

This is not a single atomic provider operation. Collection, conversion and payouts can complete at different times.

## 2. Stage 0 — draft order

The current Start a transfer screen creates a plan in draft status and creates one commitment for each selected existing recipient. The form restricts the order to a single destination country/currency; the quote function also validates the currency at the server boundary.

A draft is editable. The user can select pricing mode:
- fixed_source: allocate a known GBP source budget across commitments;
- fixed_destination: specify destination amounts and calculate the source side using the FX rate held on commitments.

Do not treat form validation as authoritative. Revalidate ownership, destination/currency, commitment completeness and amounts on the server.

## 3. Stage 1 — quote

The client calls the Senda quote Edge Function. The function:
- authenticates the user using the Supabase session;
- loads the plan scoped to the authenticated user;
- permits quoting only from draft or quoted status;
- requires verified profile KYC status;
- validates pricing mode and order destination country/currency;
- loads commitments and checks allocation IDs, ownership within the plan, duplicates, missing allocations and currency consistency;
- calculates total source/destination allocations and a recipient-level breakdown;
- requests the Fincra quote using GBP source currency and the plan destination currency;
- persists quote reference, fee/rate, charge/receive amounts and expiry to the plan;
- persists each commitment's destination amount, FX rate, payout method and recipient snapshot fields.

Current code calls Fincra POST /quotes/generate. It calculates a Senda fee as the greater of 0.5% of total source amount or GBP 0.50. Treat that as current code behaviour only; the fee policy needs explicit product/commercial approval.

Do not quote an allocation if any commitment is missing, duplicated, belongs to another plan or uses a different destination currency.

## 4. Stage 2 — quote lock

The client calls senda-orchestrate with action=lock-quote. The function:
- allows an already locked awaiting_payment/pending order to be treated idempotently;
- otherwise requires plan status quoted and no existing quote lock;
- rejects an expired quote;
- requires at least one commitment and a quote-time recipient snapshot plus payout method for every commitment;
- marks the commitments ready;
- conditionally changes the plan to awaiting_payment with payment_status pending and quote_locked_at set.

A race or state change must fail safely. The checkout function requires a locked quote.

## 5. Stage 3 — GBP collection / hosted checkout

The collection screen now calls createFincraCheckout(planId). The client does not collect card details itself; it opens a hosted Fincra checkout URL.

The fincra-checkout POST function:
- authenticates the user;
- verifies plan ownership and a positive customer_pays amount;
- requires a locked, unpaid, unexpired quote in an allowed payment state;
- loads or creates the transaction for the plan;
- checks that an existing transaction amount still matches the locked customer charge;
- requires a customer email;
- persists a stable Fincra checkout/collection reference and pending states on the transaction and plan;
- calls Fincra POST /checkout/payments with GBP amount, reference, customer data and plan/user metadata.

A browser redirect, WebBrowser return or successful popup opening is not proof of collection. The client uses fincra-checkout GET with the reference to ask the server to verify the status. The app currently polls while processing and checks again when the app resumes. When that lookup reconciles a successful collection, the GET handler also invokes fincra-conversion; the signed webhook path can invoke the same stage. The conversion claim/reference guards must make overlapping triggers safe.

The collection must be verified against the provider's reference, amount GBP, transaction amount, plan customer_pays value, quote lock and eligible plan/payment states. A successful collection changes the transaction to successful, the plan payment_status to successful and the plan status to funded; eligible commitments become ready. This transition is performed by the database reconciliation function, not by client UI state.

A failed or reversed collection must not overwrite a previously confirmed successful collection. Uncertain states remain processing and must be reconciled.

## 6. Stage 4 — conversion

After successful collection, the Fincra webhook handler invokes fincra-conversion for the order. The conversion function:
- authenticates the user or trusted internal call;
- requires payment_status successful and plan status funded or payouts_processing;
- refuses already successful conversion;
- refuses terminal failed/reversed conversion without reconciliation;
- if status is processing, queries Fincra by the existing reference rather than starting a new conversion;
- checks the configured Fincra GBP wallet and available balance;
- conditionally claims the conversion by writing the plan reference/status before calling the provider;
- initiates GBP-to-destination-currency conversion with a deterministic plan reference.

The current conversion function reads Fincra wallet availableBalance/available_balance/balance and requires at least plan.source_amount. Confirm that the account's actual funding/settlement model and the quote/collection amounts align with this calculation before live use.

A successful conversion event or verified status lookup is sent through apply_fincra_webhook_event. The database requires successful collection first and checks the converted amount/currency against the plan destination total before marking conversion successful.

Do not assume a customer payment has already arrived in the Fincra wallet merely because checkout has succeeded. The actual settlement timing and wallet funding mechanics must be verified for the commercial account.

## 7. Stage 5 — recipient payouts

Once conversion is verified, invokeReadyFincraPayouts selects commitments whose status is ready and invokes fincra-payout for each commitment.

The current quote helper maps bank_account to bank, mobile_money to mobile_money and cash_pickup to cash_pickup. Its default (including bill_payment) is mobile_money. Treat bill_payment as unsupported/unverified until an explicit Fincra mapping and test exist.

The payout function:
- authenticates the customer or trusted internal invocation;
- loads the commitment and checks ownership;
- loads its plan and requires successful collection and successful conversion;
- requires commitment status ready;
- requires positive destination amount, currency and recipient_snapshot;
- creates a deterministic payout reference from the commitment ID if one is not already saved;
- conditionally changes ready to processing before making the external request;
- calls Fincra POST /disbursements/payouts with amount, currency, wallet, business, beneficiary snapshot and plan/commitment/user metadata.

A request error after the claim is marked reconciliation_required while preserving the provider reference/status. Do not assume that an HTTP error means the external payout did not happen.

Each payout is reconciled independently. Successful provider status is accepted only when the amount and destination currency match that commitment. Failed/reversed updates only that commitment. Processing remains processing.

## 8. Stage 6 — order aggregation

The database event function and senda-orchestrate status recalculation summarise commitments at plan level.

The intended meaning:
- completed: every commitment completed;
- failed: every commitment failed/terminally unresolved under the current aggregation rule;
- partially_failed: a mix of completed and failed terminal commitments;
- payouts_processing: one or more commitments remain in a processing/unknown/reconciliation state;
- funded: collection is successful and the order is awaiting downstream conversion/payout progression.

Do not make the parent status hide the status of an individual recipient. The UI should retain a recipient-level status and a clear action or explanation for failed/uncertain payouts.

Check the exact current aggregation logic before modifying it. The SQL and the Edge Function both calculate summaries, and they must not diverge.

## 9. Event processing and reconciliation

The Fincra webhook:
- reads the raw request body;
- verifies an HMAC-SHA512 signature using FINCRA_WEBHOOK_SECRET (or the supported fallback secret variable);
- extracts event type, reference, status, amount and currency;
- maps the event into collection, conversion or payout;
- creates a stable event ID using the provider event ID or a SHA-256 hash of the raw body;
- calls apply_fincra_webhook_event;
- returns a retryable non-success response when an event cannot yet be applied because its reference/stage prerequisite is not present;
- invokes conversion after successful collection, and payout fan-out after successful conversion.

The database function keeps a private event inbox, deduplicates by event ID, locks the event/financial record and validates stage prerequisites. Do not bypass it with direct table updates in a webhook handler.

GET status-check operations for checkout, conversion and payout also feed the same database reconciliation function using deterministic poll-event IDs. Poll events are marked separately from signed webhooks in the signature_valid trigger.

## 10. Important edge cases to preserve

| Scenario | Required Senda behaviour |
|---|---|
| Checkout redirect returns but provider says pending | Show processing; verify again; do not release payouts |
| Checkout request times out | Reuse transaction/reference and query provider; do not create another charge |
| Collection reports wrong GBP amount/currency | Do not fund the plan; keep an auditable mismatch for review |
| Duplicate webhook | Apply once; acknowledge duplicate safely |
| Conversion request may have reached provider but response is lost | Reconcile by same reference; do not submit a second conversion |
| Conversion failure/reversal | Do not initiate payouts; route through reconciliation/support policy |
| One payout fails while another succeeds | Keep independent commitment statuses; summarise order as partial failure when terminal |
| Payout times out after request | Preserve reference and mark reconciliation-required/unknown; query provider before retry |
| Payout amount/currency differs from commitment | Do not mark completed; place in review |
| Out-of-order webhook arrives | Do not bypass prerequisites; preserve event and retry/reconcile safely |
| Customer changes recipient after quote | Existing commitment uses the quote-time snapshot |

## 11. Current implementation caveats

- The Fincra conversion_attempts table is introduced by migration, but the current conversion function appears to use plan/transaction fields instead of writing attempt rows.
- The current order-level conversion function depends on a configured Fincra GBP wallet and a sufficient available balance.
- Fincra GET status operations exist for collection, conversion and payouts; the current scheduled payout reconciliation function in the repository is still Flutterwave-specific.
- The webhook SQL supports event stages collection/conversion/payout and mapped statuses pending/processing/successful/failed/reversed. Unknown provider states must not be forced into this set.
- The quote and payout snapshots still carry some Flutterwave-era naming/fields. Treat those as migration debt, not as proof that Fincra beneficiary setup is complete.
- The repository migration files do not prove that the migrations are installed on the live Supabase project.

Any change to these rules must update this document and include tests for both the normal path and the ambiguous/failure path.
