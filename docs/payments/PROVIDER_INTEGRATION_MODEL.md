# Senda — provider integration model

## 1. Purpose

Senda's product and financial domain must not depend on the brand of the provider used to collect, convert, settle or pay out money. Fincra is the current provider direction being tested. The separation described here is an architectural rule for future work; the audited code is still partly provider-coupled and is not yet a complete provider-abstraction framework.

Do not build a generic multi-provider routing platform prematurely. The immediate objective is to complete and prove one safe Fincra path while keeping the Senda domain concepts stable.

## 2. Separate Senda responsibilities from provider capabilities

Senda owns:
- customer authentication and account experience;
- customer/beneficiary records and permissions;
- grouped remittance orders (plans);
- per-recipient obligations (commitments);
- customer allocations and quote presentation;
- customer-facing order, payment and payout states;
- stable internal references and audit trail;
- provider event validation and reconciliation policy;
- support/resolution workflow;
- reporting and the customer activity history.

A provider may supply:
- GBP customer collection/hosted checkout;
- FX quote and conversion;
- a settlement or wallet account;
- local-currency disbursement;
- beneficiary/account validation;
- KYC or other compliance services, if contracted and appropriate;
- provider status lookup and signed webhooks.

Do not assume one provider supplies every capability. Do not assume that using a provider transfers all regulatory, KYC/AML, safeguarding or customer-support obligations away from Senda. Those responsibilities depend on the actual legal and commercial operating model.

## 3. Financial stages and provider boundaries

| Senda stage | Senda object | Current Fincra implementation | Senda verification responsibility |
|---|---|---|---|
| Quote | Plan + commitments | senda-quote → Fincra quote API | Validate plan ownership, recipient allocations, currency and expiry; persist quote |
| Collection | Transaction + plan | fincra-checkout hosted payment | Verify GBP amount, currency, reference, ownership and locked quote |
| Conversion | Plan | fincra-conversion | Require successful collection; verify wallet balance, reference, amount/currency and provider status |
| Payout | One commitment | fincra-payout | Require collection + conversion success; verify beneficiary snapshot, amount/currency and each payout status |
| Event delivery | Provider event | fincra-webhook | Verify signature, map stage/status, deduplicate, reconcile idempotently |
| Reconciliation | Internal event/financial state | apply_fincra_webhook_event + provider GET lookup functions | Preserve uncertain outcomes and reconcile before retry |

These stages are not interchangeable. A collection success cannot be used as proof of conversion or payout success.

## 4. Provider adapter design principles

When changing or adding a provider integration:

1. Keep provider API calls on the server.
2. Give every external money movement a Senda-owned stable reference and idempotency identity.
3. Persist the reference and in-progress/claim state before making the external call.
4. Keep provider request/response payloads separate from Senda's stable domain model.
5. Translate provider status values through an explicit mapping. Unknown values remain unknown/pending review; they must not default to success.
6. Validate the provider's returned reference, amount, currency and customer/beneficiary relationship.
7. Store enough event/attempt evidence to explain exactly what happened.
8. Provide a provider query/reconciliation method for each money-moving stage.
9. Make webhook processing authenticated, idempotent and safe for duplicates/out-of-order delivery.
10. Keep retry policy explicit. An uncertain operation must be resolved using its existing reference before a new operation is attempted.

The current shared adapter is Fincra-specific, not a complete generic interface. If a second provider is later introduced, design a small interface around the real Senda requirements only after the first provider lifecycle is proven.

## 5. Stable Senda identifiers

Prefer Senda internal IDs as the source of provider references:
- collection reference: stable for the plan's customer transaction;
- conversion reference: stable for the plan's conversion;
- payout reference: stable for each commitment.

The current Fincra implementation uses:
- a checkout reference derived from the transaction payment_reference (or transaction ID fallback);
- senda-conversion-{plan_id};
- senda-payout-{commitment_id}.

Never generate a new provider reference on every retry. Provider retries must use the same reference and reconcile existing provider state first.

## 6. What must not leak into the domain

Avoid making core business logic depend on:
- a Fincra checkout URL shape;
- Fincra's wallet field names;
- provider-specific event names;
- a provider's raw status string;
- a provider's beneficiary ID;
- a provider's response object structure.

Store these values where needed for audit/integration, but expose stable Senda concepts to the rest of the app.

The current code still contains many Flutterwave-specific columns and helper names. That is migration debt, not the ideal domain design. Keep a clear compatibility boundary until history and all active callers have been migrated safely.

## 7. Fincra is the current provider direction

For this migration/testing phase:
- do not add new Flutterwave money movement;
- build and validate the Senda collection → conversion → individual payout lifecycle with Fincra;
- do not assume Fincra covers recipient onboarding, KYC, corridor discovery or scheduled reconciliation until each capability is implemented and validated;
- retain old provider data required for history and reconciliation;
- only remove old functions/configuration after proving there are no live callers, scheduled jobs, webhooks or unresolved historical records.

See:
- docs/payments/providers/FINCRA_IMPLEMENTATION.md
- docs/payments/providers/FLUTTERWAVE_MIGRATION_STATUS.md
- docs/operations/FINCRA_MIGRATION_READINESS.md

## 8. Financial correctness requirements

A provider integration is not complete because an HTTP call returns 200. It is complete only when Senda can:
- create a valid operation;
- persist its reference before the call;
- query it by reference;
- receive and authenticate events;
- handle duplicates and out-of-order events;
- verify amount/currency and eligible state;
- safely represent unknown outcomes;
- reconcile each customer transaction and recipient commitment;
- report and resolve partial failures without double-paying or losing money.

## 9. Adding another provider in future

Before adding one:
1. Write an ADR describing the business reason and regulatory/operational assumptions.
2. Map each required capability: collection, FX, settlement, payout, recipient validation, KYC, status lookup, webhook, reconciliation.
3. Verify exact corridor, payout method, currency, production availability and commercial terms.
4. Define ownership of funds, safeguarding, customer support, disputes, refunds and compliance responsibilities.
5. Implement a sandbox end-to-end test, including failure and ambiguous states.
6. Update provider readiness, deployment and operational documentation.
7. Do not change the Senda customer experience solely to fit a provider API.
