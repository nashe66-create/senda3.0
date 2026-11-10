# Senda — core domain model

This document defines Senda's concepts independently of a provider. The current TypeScript interfaces and database migrations are not perfectly aligned yet; use the schema in the current environment and this document together, and record any mismatch before changing it.

## 1. Core entities

### Customer / profile
The authenticated person using Senda. Supabase Auth identifies the user; the profiles row holds customer profile and KYC status. A user's plan, recipients, commitments and transactions must be isolated to that user.

The current profile interface contains legacy Flutterwave customer/sender identifiers. Those fields are not part of the product definition and should not be used as the basis for a future provider-neutral domain model.

### Recipient
A saved beneficiary record owned by a customer. It stores the identity and destination details required to create a payout instruction:
- name and destination country;
- currency;
- receiving method;
- mobile number/network or bank details as applicable;
- notes/relationship where used by the app;
- verification state and validation message.

A recipient is a reusable address-book record. It is not itself a payment and does not mean a payout has occurred.

The current Recipient and RecipientSnapshot interfaces contain Flutterwave-specific identifiers. Treat those as legacy provider-coupled implementation fields pending migration, not as a reason to require Flutterwave for the product.

### Plan / remittance order
A plan is Senda's grouped remittance order. It is the parent object that groups the customer's intended support payments.

Current fields include owner, name, overall status, source/destination amounts, destination country/currency, pricing mode, quote values, fee fields, recurring settings, payment status and reconciliation status. New Fincra migrations add quote, collection, conversion, wallet and payout references/status fields.

The current quote logic expects one GBP source currency and a single destination currency for an order. It validates that all allocations and recipients use that destination currency.

### Commitment
A commitment is one amount owed to one recipient inside one plan. It is the key unit of recipient-level payout and reconciliation.

A commitment records its parent plan, owner, recipient reference, source allocation, destination amount/currency, FX rate, receiving method, payout method, status, provider status, failure/resolution information and a recipient snapshot.

Never replace several commitments with one provider batch result if that would lose the individual recipient outcomes. A provider may process a batch internally, but Senda must still reconcile each commitment.

### Transaction
A transaction is the customer's collection/payment record for a plan. It represents the GBP funding leg, not a recipient payout. The current UI and Fincra checkout path use a transaction linked to a plan, with amount, payment reference, status and provider references.

A successful transaction is evidence of collection only after backend verification. It does not by itself prove FX conversion or recipient delivery.

### Quote
A quote is the time-limited pricing basis for a plan. It connects the customer's intended amounts with the source charge, destination amount, FX rate, fees and expiry. The plan stores the current locked quote values; the commitment stores the recipient-level allocation and quote-time snapshot.

A quote is not a payment and should not cause a provider payout.

### Provider attempt / reference
A provider attempt records a particular external action such as collection, conversion or recipient payout. It has a stable reference/idempotency identity and provider state.

The current schema contains transfer_attempts and a new fincra_conversion_attempts table. The audited Fincra conversion Edge Function currently writes conversion references/status to plans and transactions and does not appear to insert into fincra_conversion_attempts. Do not assume this attempt table is operationally populated without checking.

### Webhook event
A provider event is an untrusted inbound message until its signature and contents have been verified. A verified event is mapped to an internal stage/status and applied idempotently.

fincra_webhook_events is a private event inbox. The apply_fincra_webhook_event SQL function locks the event and related financial row(s), deduplicates event IDs and enforces stage-specific state/amount/currency rules.

## 2. Relationship model

- One customer owns many plans.
- One customer owns many saved recipients.
- One plan has one or more commitments.
- A commitment belongs to one plan and may reference one saved recipient.
- A plan has one customer transaction/collection record in the current intended model; code must handle existing rows safely before enforcing a one-to-one constraint.
- A plan can have one order-level GBP-to-destination-currency conversion in the current Fincra design.
- Each commitment has its own payout reference, status and final outcome.
- Many provider webhook events can refer to a stage/reference, but each provider event ID must be applied at most once.

Conceptual relationship:

    Customer
      ├── Recipients (saved beneficiaries)
      └── Plans (grouped remittance orders)
            ├── Quote (one current quote)
            ├── Transaction (customer funding)
            ├── Conversion (order-level GBP → destination currency)
            └── Commitments (one per beneficiary)
                  ├── recipient reference
                  ├── quote-time recipient snapshot
                  └── Payout attempt(s) / payout reference

## 3. Status dimensions — do not conflate them

### Plan / order status
The TypeScript OrderStatus union currently includes:
- draft
- quoted
- awaiting_payment
- payment_processing
- funded
- payouts_processing
- completed
- payment_failed
- partially_failed
- failed
- cancelled

A plan status summarises the grouped order. It must not replace the transaction or commitment status.

### Customer payment / transaction status
The TypeScript PaymentStatus union is pending, processing, successful or failed. TransactionStatus currently includes pending, successful, failed and refunded.

These represent customer collection. They do not represent FX or payout completion.

### Commitment / payout status
The TypeScript PayoutStatus union includes:
- pending
- ready
- creating
- creating_unknown
- submitted
- confirming
- confirming_unknown
- processing
- completed
- failed
- reconciliation_required
- resolution

These represent the individual recipient obligation. Keep unknown and reconciliation-required states distinct from failed.

### Financial reconciliation status
FinancialReconciliationStatus is pending, reconciled or requires_review. This is a financial control dimension, not a synonym for plan status.

### Provider stage status
Fincra-specific statuses are stored separately for collection, conversion and payout. The event reconciliation SQL currently normalises provider states to pending, processing, successful, failed or reversed. Keep the original provider status/event payload for audit where the schema supports it.

## 4. Money and currency invariants

- Source customer funding is GBP in the current implementation.
- One plan has one destination currency in the current implementation.
- source_amount, amount_gbp and customer_pays are not interchangeable. The first is the source allocation/amount used by the order; customer_pays is the locked customer charge. A Senda fee and provider fees may make the charge differ from the nominal transfer amount.
- destination_amount is an order-level destination total; each commitment has its own amount_destination.
- FX rate must be explicitly sourced and locked. Do not use a default rate of 1 as a substitute for a real quote in financial flows.
- Compare amounts with a justified minor-unit tolerance, currently generally 0.01 in SQL verification. Do not increase tolerance to suppress a mismatch.
- Every amount must be interpreted alongside its currency. A numeric value without currency is incomplete financial data.

## 5. Recipient snapshots

The recipient snapshot is the quote-time payout instruction data. It protects a commitment from subsequent edits to the reusable recipient record.

A payout must use the snapshot associated with the commitment, not fetch a mutable current recipient and silently use changed bank/network details. If an account needs correction, use a controlled edit/resolution flow that makes the consequences to an existing commitment explicit.

Do not discard snapshots when migrating provider recipient identifiers. Replace provider-specific snapshot properties only through a reviewed data migration and compatibility plan.

## 6. Existing implementation mismatch list

At the 9 November 2026 main snapshot:
- types/database.ts contains Flutterwave-only properties on Profile, Recipient, Commitment, Transaction, SavedCard, TransferAttempt and RecipientSnapshot.
- TransferAttempt.provider is typed as only flutterwave, while the database migration expands the provider check to flutterwave or fincra.
- New Fincra schema columns for quote, collection, conversion, wallet and payout are not all represented by TypeScript interfaces.
- The domain model should remain provider-neutral, but the current persisted schema is still provider-coupled.

When changing these contracts, update SQL, generated/manual TypeScript types, queries, tests and this document in the same change. Do not make an interface look provider-neutral while database constraints and deployed data remain incompatible.
