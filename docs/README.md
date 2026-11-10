# Senda product and engineering handbook

This directory is the maintained reference for what Senda is, how its domain works, how money moves, how the current Fincra implementation works and how contributors should change it safely.

**Start here:** read the product overview first. Then read the domain model and money-movement lifecycle before changing plans, commitments, payments or payouts.

## Source-of-truth order

1. **Current branch code and applied database schema** describe what is implemented in the environment being examined.
2. **Product and architecture documents** describe the intended Senda behaviour and invariants.
3. **Provider implementation documents** describe the current provider-specific implementation and known gaps.
4. **Decision records** explain why an architectural choice was made.
5. Research documents describe external market hypotheses and evidence; they are not proof of technical support or legal/regulatory permission.

When these sources conflict, report the conflict. Do not silently treat a design intention as already implemented, or treat an old code path as the desired product design.

## Product

- [Senda product overview](product/SENDA_PRODUCT_OVERVIEW.md)
- [Core domain model](architecture/CORE_DOMAIN_MODEL.md)
- [Money-movement lifecycle](architecture/MONEY_MOVEMENT_LIFECYCLE.md)
- [Technical architecture](architecture/TECHNICAL_ARCHITECTURE.md)

## Payments and providers

- [Provider integration model](payments/PROVIDER_INTEGRATION_MODEL.md)
- [Fincra implementation](payments/providers/FINCRA_IMPLEMENTATION.md)
- [Flutterwave migration status and legacy inventory](payments/providers/FLUTTERWAVE_MIGRATION_STATUS.md)
- [Fincra migration readiness and operational runbook](operations/FINCRA_MIGRATION_READINESS.md)

## Engineering and decisions

- [Change, testing and release guide](engineering/CHANGE_AND_TESTING_GUIDE.md)
- [ADR-001: Fincra as the current provider direction](decisions/ADR-001-FINCRA-AS-CURRENT-PROVIDER.md)

## Repository snapshot and limitations

These documents were prepared against the repository's main branch at commit b81797cda2809175fa5be4c9da1265303e65ff33, committed 9 November 2026. They describe repository source, not a live Supabase deployment attestation.

At that snapshot:
- The customer collection screen uses Fincra hosted checkout.
- The quote function calls Fincra.
- Fincra checkout, conversion, payout and webhook Edge Functions exist.
- Fincra webhook events are reconciled through a database function.
- Flutterwave references remain in recipient setup, KYC, corridor/network/bank discovery, legacy transfer helpers and a Flutterwave-specific scheduled payout reconciliation function.
- The TypeScript database definitions do not yet fully describe all new Fincra schema fields.
- The Fincra conversion-attempt table exists in a migration, but the current conversion Edge Function does not appear to write to it.
- This repository snapshot alone does not prove which migrations or Edge Function versions are deployed in any Supabase environment.

Update this snapshot section when the current implementation changes materially.
