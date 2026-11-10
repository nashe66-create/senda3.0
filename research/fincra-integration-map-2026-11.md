# Senda to Fincra Integration Map

Reviewed: 2026-11-10
Purpose: map the current Senda Supabase functions to Fincra's published API, identify request/response contracts, and keep the provider flow aligned with Senda's UK-funded, multi-recipient remittance use case.

## Session Handoff

Status: implementation is local and not yet migrated, deployed, or verified against a Fincra sandbox/live account.

Completed in this change set:

- Updated `senda-quote` to Fincra's conversion quote schema and the app's `QuoteResult` response shape.
- Restricted new plans to fixed-source pricing; the displayed recipient-currency amounts are estimates until post-payment conversion.
- Added a post-funding fresh quote and immediate conversion path, with a service-role-only RPC for updating locked destination allocations.
- Aligned hosted-checkout field names and business header; taught the client to read Fincra's `data.link` response.
- Aligned payout fields, separated Senda and Fincra references, added timeout lookup by customer reference, and validate bank/mobile codes against Fincra's provider list.
- Updated webhook amount/currency extraction for Fincra collection, conversion, and payout payloads.

Remaining before production:

1. Apply `supabase/migrations/20261110123000_fincra_postfund_conversion_pricing.sql` before deploying the changed functions.
2. Confirm GBP hosted checkout or an approved GBP virtual-account funding flow for Senda's business; the public checkout currency list does not include GBP.
3. Confirm the live quote-extension duration and whether it covers checkout/payment confirmation. Until then, keep the fixed-source estimate policy.
4. Verify Fincra business/wallet configuration, corridor support, payout fees, required payment schemes, and recipient bank/mobile codes.
5. Run sandbox collection, quote, conversion, payout, timeout/reconciliation, and failure-retry tests. PostgreSQL/Deno/Fincra runtime validation was not available in the local container.
6. Re-enable fixed-destination pricing only after Fincra quote locking or an explicit shortfall/surplus/refund policy is in place.

Validation completed: `npm run typecheck` passes; modified Edge Functions lint with no errors (three array-type warnings). The broader plan-screen lint still reports pre-existing React hook/purity errors.

## Executive Summary

Senda's intended flow is:

1. Build one customer quote for a GBP-funded plan and its destination currency.
2. Collect the customer's GBP payment.
3. Convert the collected GBP from Senda's Fincra wallet into the destination currency.
4. Pay each recipient separately from the destination-currency balance.
5. Reconcile collection, conversion, and individual payout outcomes independently.

For this flow, `/quotes/generate` must create a **conversion quote**, not a disbursement quote: `transactionType: "conversion"` and `paymentDestination: "fliqpay_wallet"`. Fincra says the quote reference is valid for only 30 seconds for conversions and cross-currency payouts. That is a serious timing conflict with a hosted checkout and asynchronous payment confirmation.

The published checkout reference does not list GBP as a supported checkout currency, and the quote documentation says cross-currency checkout is coming soon. This does not prove Fincra cannot support Senda's GBP collection through an account-specific product, but the currently documented checkout integration does not establish that it can. Fincra's permanent virtual-account API does list GBP and describes accounts for local and foreign currencies; this is a possible GBP wallet-funding route, but it requires account/KYC approval and does not by itself establish per-plan payer attribution or consumer remittance eligibility.

The quote request in `supabase/functions/senda-quote/index.ts` uses the documented conversion-quote shape. The current workaround supports fixed-source transfers only: the displayed destination amounts are estimates, and after confirmed collection Senda obtains a fresh conversion quote and submits it immediately. Fixed-destination plan creation/quoting is temporarily disabled. This fixes the quote-expiry gap but does not establish that the documented checkout accepts GBP or that the selected live Fincra account is enabled for every corridor.

## Business Flow and Quote Semantics

Senda is not asking Fincra to disburse every recipient as part of the customer quote. The quote prices a conversion into Senda's destination-currency wallet; later, Senda sends separate payouts to each commitment. This supports a grouped customer order with multiple recipients while retaining individual payout state.

| Senda pricing mode | Fincra quote `action` | Fincra `amount` | Meaning |
| --- | --- | --- | --- |
| `fixed_source` | `send` | Total GBP source amount, formatted as a string | Quote how much destination currency the converted wallet receives. |
| `fixed_destination` | `receive` | Total requested destination amount, formatted as a string | Quote how much GBP is needed to receive the requested destination amount. |

Both modes use `transactionType: "conversion"`, `paymentDestination: "fliqpay_wallet"`, the configured Fincra `business`, and `beneficiaryType: "individual"` for Senda's individual recipients in African corridors. Do not select `transactionType: "disbursement"` for this aggregated quote: individual disbursements happen after the wallet conversion.

Fincra's quote response `data.reference` is the `quoteReference` required by conversion initiation. It is not the later conversion's provider-generated transaction reference, nor Senda's own stable customer reference.

## Function-to-API Map

| Senda function | Role in Senda flow | Fincra API mapping | Contract and current assessment |
| --- | --- | --- | --- |
| `senda-quote` | Validate plan/recipients and show an estimated fixed-source quote before collection | `POST /quotes/generate` | Sends `amount` as a string, `action: "send"`, `transactionType: "conversion"`, configured `business`, `paymentDestination: "fliqpay_wallet"`, and `beneficiaryType: "individual"`. Returns the flat `QuoteResult` used by the app. Its quote reference is indicative only; it is not consumed after payment. Fixed-destination mode is rejected while post-funding repricing is in use. |
| `fincra-checkout` | Collect customer funds; verify hosted checkout by Senda merchant reference | `POST /checkout/payments`; `GET /checkout/payments/merchant-reference/{reference}` | Request now uses `paymentMethods`, `defaultPaymentMethod`, `customer.phoneNumber`, `redirectUrl`, `metadata`, and merchant `reference`; the business ID is sent in `x-business-id`. The app recognizes the documented response `data.link`. GBP is still absent from the published checkout currency enum and the public amount schema says integer, so confirm the live GBP contract/decimal behavior before enabling production checkout. Cross-currency checkout is described as coming soon. |
| `fincra-conversion` | After verified collection, re-quote and convert the funded GBP wallet balance | `GET /wallets/{walletID}`; `POST /quotes/generate`; `POST /conversions/initiate`; `GET /conversions/reference/{conversionReference}` | Checks GBP wallet liquidity before requesting a fresh conversion quote. It submits `business`, the new `quoteReference`, and stable `customerReference` to the conversion endpoint immediately after quote creation. A service-only RPC applies the new destination total and recipient allocation while preserving the collected GBP principal. The conversion provider reference is stored separately and used for status checks. Ambiguous submissions are held for reconciliation rather than replayed. |
| `fincra-payout` | Pay each ready commitment independently from the destination-currency wallet | `GET /core/banks`; `POST /disbursements/payouts`; GET by provider or customer reference | Sends the required same-currency fields and normalized beneficiary. Before submission it validates the saved bank/mobile code against Fincra's enabled provider list for that country, currency, and payout destination; unsupported codes stop with a reconciliation-safe 409. It persists the Senda customer reference before submit, then Fincra's returned provider reference. Payment schemes can be passed from the snapshot when saved, but corridor-required schemes still need to be populated. No published support for `cash_pickup` was found in the reviewed flow. |
| `fincra-wallet` | Internal wallet inventory/balance access | `GET /wallets`; `GET /wallets/{walletID}` | Paths match the shared helper and published wallet references. Keep protected by the internal secret. Confirm `FINCRA_WALLET_ID` identifies the GBP source wallet used for conversion; verify available balance in the same currency as the conversion source amount. |
| `fincra-webhook` | Normalize verified provider events and reconcile each lifecycle stage | Fincra Collection Webhook and Payout Webhook guides; status endpoints above are polling fallbacks | The handler recognizes collection, conversion, and payout stages. Public collection and payout examples were reviewed; a conversion-webhook guide and the webhook signing contract were not located in the published pages reviewed. The handler currently checks HMAC-SHA-512 against the raw body using `x-fincra-signature` or `x-signature`; confirm algorithm/header with Fincra before relying on it. |
| `_shared/fincra.ts` | Provider URL, API-key header, JSON/error parsing, endpoint wrappers | Shared transport for all Fincra API calls | Uses `api-key`, `Accept: application/json`, JSON bodies, and sandbox by default; `FINCRA_ENV=production` selects `https://api.fincra.com`. Conversion and payout requests use their stable `customerReference` as the idempotency key. |
| `_shared/internal-functions.ts` | Service-role calls between Supabase functions | No direct Fincra endpoint | Dispatches internal requests to `fincra-conversion` and `fincra-payout`; provider requests remain in the functions above. |

## Updated Quote Request

The quote function now constructs the request in this shape, with the amount and action selected from the saved plan pricing mode:

```json
{
  "sourceCurrency": "GBP",
  "destinationCurrency": "NGN",
  "amount": "100.00",
  "action": "send",
  "transactionType": "conversion",
  "business": "<FINCRA_BUSINESS_ID>",
  "paymentDestination": "fliqpay_wallet",
  "beneficiaryType": "individual"
}
```

The app currently permits fixed-source plans only. Fixed-destination plans are disabled at creation and rejected by the quote and conversion endpoints until a safe shortfall/surplus policy or Fincra quote lock is available. `FINCRA_BUSINESS_ID` is checked before the provider call so it cannot silently disappear from the JSON body.

Fincra's quote response `data.reference` is saved as the pre-payment indicative quote reference, and its source/destination totals are used in the flat `QuoteResult` returned to `lib/data.ts` and the quote screen. Customer total is calculated as Fincra's `amountToCharge` plus Senda's separately calculated fee. The customer is told the destination allocation is an estimate until payment is received.

After collection, `fincra-conversion` requests a new quote using the fixed GBP source amount and consumes its `data.reference` as `quoteReference` in the conversion call. The quote-to-conversion server sequence must finish before the returned `expireAt`; the customer checkout itself does not need to finish inside that window. The new quote is applied through `apply_fincra_conversion_quote`, which updates the final plan/recipient destination values only for a successfully funded fixed-source plan before conversion starts. Sandbox and live-account testing must confirm that `amountToReceive`, fees, and payout wallet debit semantics match the stored totals.

## Blocking Contract and Lifecycle Findings

### Workaround Paths to Validate

Fincra's [cross-border payout guide](https://docs.fincra.com/docs/cross-border-payouts) documents an end-to-end operation that can avoid holding a quote across customer checkout: fund the source wallet, generate the cross-currency quote immediately before the payout, then submit that payout with the quote reference. The quote expiry is then consumed in a server-to-server sequence rather than during a customer's card/3DS interaction. The guide also documents that a failed payout may still have completed its conversion; in that case funds remain in the destination wallet and the recovery is a new same-currency payout, not replaying the cross-currency request.

The selected temporary workaround is the first variant, restricted to fixed-source plans:

1. **Separate plan-level conversion (implemented).** After GBP collection is confirmed, generate a fresh `transactionType: "conversion"` quote and immediately initiate conversion with that quote reference. This matches the existing plan-level wallet conversion and per-recipient same-currency payouts. The GBP principal remains fixed, but recipient currency amounts/rate can move from the pre-payment estimate. Fixed-destination mode is blocked until its shortfall/surplus behavior is agreed or Fincra provides a quote lock usable through checkout.
2. **Cross-currency payout per recipient (not implemented).** After collection, request a fresh `transactionType: "disbursement"` quote for each recipient's destination, then submit that payout immediately with the quote reference. This combines quote/conversion with each payout and follows Fincra's documented recovery semantics. It requires changing Senda's lifecycle/reconciliation model because one recipient's payout can have a successful conversion while its payout fails.

For collection, Fincra's `POST /profile/virtual-accounts/requests` schema includes `GBP` and supports a `merchantReference`, but requires a permanent account request, account type, KYC information, and potentially supporting documents. `GET /profile/virtual-accounts/requests` reports supported/requested currencies for the authenticated business. Confirm with Fincra whether the Senda business can receive third-party UK consumer GBP deposits into a GBP virtual account, whether accounts can be created per Senda customer or plan, what fields identify a payer deposit, whether the collection webhook is emitted for GBP accounts, and how the funds settle into the GBP wallet. The published collection webhook example is for virtual-account collections, but does not establish this exact product configuration.

**Recommended immediate investigation:** call the virtual-account request-options endpoint with the business credentials in a secure environment and confirm GBP eligibility with Fincra. In parallel, obtain written confirmation of the live quote-extension duration and supported product. The temporary sandbox path does not rely on that extension: it treats the pre-payment rate as indicative and generates the execution quote after funding. Do not re-enable fixed-destination pricing until its shortfall/surplus behavior is agreed.

### GBP Collection Is Not Established

The published `Initiate Checkout` schema lists NGN, KES, GHS, UGX, USD, ZMW, XAF, XOF, and TZS, but not GBP. Its body schema also differs from the current `fincra-checkout` request. The quote reference says cross-currency checkout is coming soon. Therefore, the current public docs do not establish that `/checkout/payments` can collect GBP from Senda's UK customers and settle it into the GBP wallet.

Before enabling the payment flow, obtain Fincra confirmation of the exact production product/API for UK customer GBP collection, eligible payment methods, settlement currency/wallet, required headers/body, and webhook/status events. Do not substitute USD or a local-currency checkout without a product decision.

### Quote Expiry and Live-Account Extension

Fincra documents sandbox conversion quotes as valid for 30 seconds. A customer payment cannot be guaranteed to complete in that window. Senda now avoids using the pre-payment indicative quote for conversion: after collection is confirmed, it requests a fresh quote and immediately initiates conversion. The quote-generation-to-conversion API calls must still finish before that fresh quote expires.

Fincra has told Senda that quote validity can be extended for a live account. Obtain the exact duration, supported endpoint/product, and written confirmation before relying on it. If the live extension covers customer checkout and payment confirmation, Senda may be able to preserve the pre-payment quote and later remove the temporary fixed-source-only policy after testing.

### Conversion and Payout References Must Be Distinct

Keep these identifiers separate:

- Senda's stable ID: send as Fincra `customerReference` for idempotency and mapping back to a plan/commitment.
- Fincra's returned `data.reference`: store as the provider transaction reference and use for Fincra status GET requests.
- Quote response `data.reference`: store as the quote reference and pass as `quoteReference` to the conversion or cross-currency payout that consumes it.

The conversion function stores Fincra's returned provider reference separately from the quote reference and uses a stable customer reference as its idempotency key. The payout function stores the Senda customer reference separately from Fincra's returned payout reference and can query by either. Fincra payout webhook examples include both references; reconciliation matches provider references, while customer references are used for idempotent submission and timeout recovery.

### Payout Rails Need Per-Recipient Mapping

Fincra documents separate payout destinations for bank accounts (`bank_account`) and mobile wallets (`mobile_money_wallet`). Mobile-money payouts require `beneficiary.accountNumber` for the wallet phone number and `beneficiary.mobileMoneyCode` from Fincra's provider list, as well as beneficiary name/type/country. Bank payouts require bank account number and provider bank code. Senda's stored recipient snapshot must be normalized to these shapes and validated for the selected corridor.

Fincra's mobile-money local-transfer guide describes `amount` as a string, while the current bank and mobile payout reference pages describe it as numeric. It also notes whole-number restrictions for some currencies such as UGX. Confirm exact amount type and corridor-specific fields in Fincra sandbox before sharing one payload builder across rails.

### Webhook Contract Requires Confirmation

The published payout webhook examples contain event names `payout.successful` and `payout.failed`, provider `reference`, and `customerReference`. The collection webhook guide documents `collection.successful` and `collection.failed`; it describes virtual-account collections, which may not be the same event contract as hosted checkout. Confirm hosted-checkout event names, conversion events, signature header/algorithm, retries, and delivery guarantees with Fincra.

## Recommended Integration Sequence

1. Confirm with Fincra the account's enabled UK GBP collection method and settlement path; test the business's GBP virtual-account request option and obtain written confirmation of third-party/customer deposit eligibility, attribution, and settlement.
2. Obtain the live quote-extension duration/product details; until verified, keep fixed-source estimates and post-funding fresh quotes.
3. Apply the new database migration before deploying `fincra-conversion`; it adds the service-only post-funding repricing RPC and lifecycle fields.
4. Run quote, conversion, and payout requests in Fincra sandbox for each destination currency and rail; record sanitized request/response fixtures and provider error bodies.
5. Confirm that existing recipient bank/network codes are Fincra-issued, add required payment schemes per corridor, and explicitly decide what to do with cash pickup.
6. Validate collection, conversion, and each payout independently using webhooks plus status polling. Never treat HTTP/API `success: true` as proof that final settlement succeeded; use the transaction status.

## Configuration and Security

- `FINCRA_SECRET_KEY` or `FINCRA_API_KEY`: server-only API key sent as `api-key`.
- `FINCRA_BUSINESS_ID`: required by quote, conversion, and payout contracts.
- `FINCRA_WALLET_ID`: wallet identifier; verify currency and account ownership in Fincra.
- `FINCRA_ENV`: sandbox by default; production selects Fincra's production base URL.
- `FINCRA_WEBHOOK_SECRET`: current Senda signature-verification secret; confirm exact Fincra webhook signing setup.
- Never expose these values to the app or include them in logs/screenshots.

## Official Fincra References Reviewed

- [Generate a Quote](https://docs.fincra.com/reference/generate-quote)
- [Initiate Checkout](https://docs.fincra.com/reference/initiate-checkout)
- [Verify Checkout Status](https://docs.fincra.com/reference/verify-checkout-status)
- [Initiate Currency Conversion](https://docs.fincra.com/reference/initiate-currency-conversion)
- [Verify Conversion Status](https://docs.fincra.com/reference/verify-conversion-status)
- [Create a Bank-Account Payout](https://docs.fincra.com/reference/initiate-payout)
- [Create a Mobile-Money Payout](https://docs.fincra.com/reference/initiate-payout-1)
- [Create a Stablecoin Payout](https://docs.fincra.com/reference/initiate-payout-2)
- [List Banks and Payout Providers](https://docs.fincra.com/reference/list-banks)
- [Verify Payout Status by Reference](https://docs.fincra.com/reference/verify-payout-status-by-reference)
- [Verify Payout Status by Customer Reference](https://docs.fincra.com/reference/fetch-payout-by-customer-reference)
- [Get Wallets](https://docs.fincra.com/reference/get-wallets)
- [Get Wallet Balance](https://docs.fincra.com/reference/get-wallet-balance)
- [Request a Permanent Virtual Account](https://docs.fincra.com/reference/request-permanent-virtual-account)
- [List Virtual Account Request Options](https://docs.fincra.com/reference/list-virtual-account-request-options)
- [Get Account Deposit History](https://docs.fincra.com/reference/get-multicurrency-account-deposit-history)
- [Cross-Currency Payouts](https://docs.fincra.com/docs/cross-border-payouts)
- [Mobile Money Local Payouts](https://docs.fincra.com/docs/mobile-money-local-transfers)
- [Collection Webhook](https://docs.fincra.com/docs/payin-webhook)
- [Payout Webhook](https://docs.fincra.com/docs/payout-webhook)

The references above were publicly accessible on 2026-11-10. Fincra's docs are account- and corridor-sensitive; confirm current production enablement, country/currency coverage, and any newer account-specific schema with Fincra before rollout.
