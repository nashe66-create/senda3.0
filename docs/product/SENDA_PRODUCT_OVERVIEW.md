# Senda — product overview

**Document purpose:** explain the product independently of any payment service provider.

**Current product direction:** grouped cross-border remittance management.  
**Current provider experiment:** Fincra. Provider choice does not define the product.  
**Research pilot context:** UK to Nigeria is the corridor prioritised in the repository's September 2026 research. This is a market-research focus, not proof that the present Fincra account, API configuration or recipient workflow supports a live corridor.

## 1. What Senda is

Senda is a customer-facing platform for people who regularly support more than one person across borders. Instead of organising each family or personal-support payment as a completely separate customer workflow, the customer can create a grouped remittance order containing individual recipient commitments.

The customer manages the order as one Senda activity. Senda maintains the separate obligations to each recipient and tracks each resulting payout independently.

The product proposition is therefore **grouped remittance administration and visibility**, not simply another card checkout or a thin wrapper around a provider's transfer API.

## 2. The problem

A person supporting several relatives or other beneficiaries may need to:
- remember who needs support and how much each person should receive;
- collect or re-enter bank-account or mobile-money details;
- make several separate remittance payments;
- repeat those tasks on a regular basis;
- keep track of which individual has received money;
- deal with different delays or failures without losing sight of the other payments.

A conventional individual-transfer experience makes the customer repeat the same sequence for each beneficiary. A provider may technically support batch payouts, but that alone does not provide Senda's customer-facing order, commitment, saved-recipient and reconciliation experience.

The underlying customer problem is a hypothesis to validate continuously through customer research. Do not claim that every remitter has multiple recipients or that all customers prefer one grouped order.

## 3. The product model

A Senda grouped order has:
- one customer owner;
- one named remittance order;
- one destination country and destination currency in the current implementation;
- one or more recipient commitments;
- a quote that describes the cost and amounts for the order;
- a customer-funding transaction;
- a funding/FX lifecycle;
- separate payout instructions and outcomes for each commitment;
- a consolidated order view with recipient-level status.

The product is designed so the customer does not need to understand the provider's internal wallet, conversion, payout or webhook language. Senda translates those events into clear order and recipient statuses.

## 4. Customer journey

### A. Account and eligibility
The customer creates an account, signs in and completes any required identity or compliance checks. The quote function currently requires the authenticated user's profile KYC status to be verified. The exact compliance allocation between Senda, its regulated partner and the provider must be confirmed before live use; the application code alone does not determine legal responsibilities.

### B. Recipient management
The customer saves a recipient and the information needed for the intended destination and payout method. Recipient information can include name, destination country, currency, receiving method, bank or mobile-money details and verification state.

The interface and provider-specific validation still have Flutterwave dependencies in the audited main snapshot. The intended product is provider-neutral recipient management; do not design the customer concept around a Flutterwave recipient ID.

### C. Create a grouped order
The customer creates a plan/order, selects the destination country/currency and adds recipient commitments. In the current flow, the customer chooses one of two pricing modes:
- fixed source: decide how much GBP to allocate/spend;
- fixed destination: decide how much each recipient should receive in the destination currency.

The present application and quote function require the commitments in an order to share the order's destination country/currency. Do not expand this into multi-country or multi-currency orders without a separate product and accounting design.

### D. Quote and review
Senda calculates the recipient-level allocation and requests a provider quote. The quote should make clear what the customer pays, what each recipient is intended to receive, the exchange rate, provider charges and Senda's own fee where known.

The quote and recipient details must be locked before collection. The customer should understand that the price is time-limited if the provider supplies an expiry.

### E. One customer funding journey
The customer pays the quoted GBP amount through the current hosted checkout integration. The checkout's redirect is not proof of payment. Senda verifies the result with provider data and reconciles it into the Senda transaction and order records.

### F. Funding, FX and payouts
After collection is confirmed, the current Fincra design checks the GBP wallet balance and initiates one order-level GBP-to-destination-currency conversion. After conversion is confirmed, Senda initiates a separate payout for each ready commitment.

The product must preserve independent recipient-level outcomes. One successful recipient payout must not cause other payouts to appear successful.

### G. Tracking and resolution
The customer sees the overall order and each recipient's status. When a payout fails or has an uncertain outcome, Senda should explain which recipient is affected and whether the case is being checked, needs corrected details or requires support. It must not tell the customer to pay again where the first payment may have succeeded.

## 5. Product principles

1. **One order, several obligations.** The grouped order is a customer-level container; each commitment remains a distinct financial obligation.
2. **Independent payout tracking.** Every recipient payout can progress, fail or need resolution independently.
3. **Clear pricing.** Distinguish customer charge, Senda fee, provider fee, FX rate and amount to receive. Do not present unknown fees as zero.
4. **No false success.** Only verified server-side provider evidence can confirm a financial outcome.
5. **No duplicate money movement.** Timeouts and uncertain outcomes must trigger reconciliation, not a new attempt.
6. **Recipient integrity.** Snapshot recipient payout details when the quote/commitment is prepared so later edits do not alter an in-flight order.
7. **Provider independence.** A provider can change without changing the meaning of order, recipient, commitment or customer status.
8. **Honest availability.** A market in research or a provider's public country list is not sufficient to advertise a corridor as available. Confirm the Senda account's live capability, exact payout method, onboarding permission, fees and operational process.

## 6. What Senda is not

- It is not defined by Fincra, Flutterwave or any other PSP.
- It is not merely a batch-payout API client.
- It is not a customer wallet or stored-value account by default. Do not describe customer balances or custody unless the product and regulatory model explicitly supports them.
- It is not proof that Senda itself is authorised to receive or transmit customer funds. That must be determined through the actual operating model and specialist legal advice.
- It is not currently a multi-country/multi-currency order engine in the audited implementation.

## 7. Current product boundaries and open validation

- The repository's research library prioritises UK to Nigeria. Treat that as a research focus only.
- The audited code has Fincra checkout, quote, conversion, payout and webhook functions, but still uses Flutterwave for parts of recipient setup, KYC, corridor discovery and scheduled reconciliation.
- The current quote function uses a Senda fee formula of the greater of 0.5% of the source amount or GBP 0.50. This is an implementation fact, not confirmation of the final commercial pricing policy.
- The current recurring-cycle function creates a fresh draft order for a due completed recurring plan. That draft needs a new quote and payment; a recurring schedule is not authority to charge or pay automatically without the required customer consent and operational design.
- The customer need for grouped remittance, ideal number of recipients, desired cadence, willingness to pay and preferred payout methods remain matters for customer validation.

## 8. How to use this document

Use this document when changing customer journeys, product copy, onboarding, navigation, order creation, recipient management or feature scope. If a requested feature conflicts with these principles, explain the conflict and propose a product decision rather than quietly changing the concept.
