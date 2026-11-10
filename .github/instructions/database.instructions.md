---
applyTo: "supabase/migrations/**/*.sql,types/database.ts"
---

# Senda database and schema instructions

Read docs/architecture/CORE_DOMAIN_MODEL.md, docs/architecture/MONEY_MOVEMENT_LIFECYCLE.md and docs/operations/FINCRA_MIGRATION_READINESS.md before changing the schema or TypeScript database contracts.

- plans, commitments, transactions and recipients have separate responsibilities. Do not collapse them into one transfer row.
- Use plans as grouped remittance orders; commitments as recipient-level payout obligations; transactions as customer collection/payment records. Provider references belong to the relevant financial stage and object.
- Enforce ownership, valid status transitions, amount/currency matching, idempotency and event deduplication in the database where atomic guarantees are required.
- Use additive, ordered migrations. Never rewrite an earlier migration that may already have run in an environment. Add a new migration to correct or extend schema.
- Do not use destructive DROP/rename operations on historical provider columns without a verified data-retention and migration plan.
- Keep RLS enabled on user data and private provider event/attempt tables. Explicitly revoke public/anon/authenticated permissions where only trusted server-side access is intended; grant only the required role.
- SECURITY DEFINER functions must use a fixed safe search_path, validate inputs and expose only the intended operation. Do not grant them to PUBLIC, anon or authenticated unless there is a reviewed, intentional reason.
- SQL constraints and TypeScript unions must agree. The current TS TransferAttempt provider type is still Flutterwave-only while a migration allows Flutterwave and Fincra; do not treat the types as a complete schema mirror until reconciled.
- Several Fincra columns are added by migrations but are not all represented in types/database.ts. Update database types and tests when the schema contract changes.
- A committed migration file does not mean it has been applied to Supabase. Verify migration history in the target project before claiming deployment.
- For every migration document purpose, affected tables/columns, backfill requirements, constraints, RLS/privileges, rollback/recovery implications and whether it is safe for existing rows.
- Do not insert provider secrets, customer PII or raw payment data into test fixtures or documentation.
