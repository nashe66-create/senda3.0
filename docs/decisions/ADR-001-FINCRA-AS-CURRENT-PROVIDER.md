# ADR-001 — Fincra as Senda's current provider direction

- **Status:** Accepted as the current implementation/testing direction; not a declaration of permanent provider selection or production readiness.
- **Date:** 10 November 2026
- **Context snapshot:** main commit b81797cda2809175fa5be4c9da1265303e65ff33.

## Context

Senda's product is a grouped remittance order: one customer funding journey, an order-level GBP-to-destination-currency conversion in the current design, and separate payouts to the commitments/recipients in that order.

The original code contains extensive Flutterwave-specific integration. The repository's 9 November 2026 main commit added a Fincra quote, hosted checkout, conversion, payout and webhook lifecycle, while older Flutterwave functions and provider-coupled columns remain.

The current product should not be designed around a provider brand. However, the immediate development effort needs one provider path that can be validated end-to-end.

## Decision

Treat Fincra as the current primary provider for the next implementation and sandbox-validation phase.

Do not add new Flutterwave collection, FX or payout functionality. Keep the Senda domain centred on customer, plan/order, recipient, commitment, quote, transaction and recipient-level payout outcome.

Retain legacy Flutterwave fields, functions and records until a documented replacement, call-site inventory, data-retention plan and reconciliation cutover are complete.

Do not build a full multi-provider routing/abstraction framework as part of this decision. Preserve a clean Senda/provider boundary and introduce only the small abstractions justified by the current Fincra implementation.

## Why

- The current main branch already contains a material Fincra lifecycle for quote, collection, conversion, payout and provider webhook reconciliation.
- The provider can be evaluated against the complete Senda order lifecycle rather than only one API operation.
- Keeping the product model separate from provider mechanics reduces the risk that a future provider change rewrites the customer journey and domain data.
- A staged migration is safer than deleting historical Flutterwave code/data while the app still calls it for recipients, KYC, corridor discovery or reconciliation.

## Consequences

### Positive
- One provider direction for the immediate sandbox implementation.
- Clearer separation of product requirements from provider API details.
- Explicit inventory of migration gaps and historical-data retention.
- A basis for Copilot to avoid adding new Flutterwave code.

### Costs and risks
- The migration is incomplete in the audited source.
- Recipient setup and verification still have Flutterwave dependencies.
- KYC and corridor/network/bank discovery remain provider-coupled.
- The existing 15-second scheduled payout reconciliation function still queries Flutterwave.
- TypeScript database definitions lag behind new Fincra schema fields.
- The conversion-attempt migration table does not appear to be used by the current conversion function.
- Fincra wallet settlement, corridor support, exact API payloads, webhook contract, fees and production permissions must be verified with the contracted account.
- Current code does not establish Senda's regulatory permissions or the allocation of regulated responsibilities.

## Not decided

This ADR does not decide:
- that Fincra is the permanent provider;
- that production transfers are approved;
- that Fincra supports every target Senda country or payout method;
- that Fincra performs all KYC/AML obligations;
- that Senda may receive/hold customer funds in a particular way;
- that Flutterwave historical data can be deleted;
- that the product should support multiple currencies/countries inside one grouped order.

## Review/exit criteria

Revisit this ADR if:
- Fincra cannot support the required UK collection and target-corridor payout model;
- the wallet/settlement model, fees or compliance requirements make the flow impractical;
- sandbox testing reveals unresolved duplication/reconciliation risks;
- another provider offers materially better fit and is commercially/regulatorily available.

A replacement ADR should describe the new direction and the treatment of Fincra/Flutterwave historical data.
