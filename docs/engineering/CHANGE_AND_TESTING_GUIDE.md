# Senda — change, testing and release guide

## 1. Before starting

1. Confirm the repository and branch. The canonical repository is nashe66-create/senda3.0; main is the current shared branch.
2. Inspect the working tree before changing files. Copilot may have uncommitted work on main. Never reset, checkout over, force-push or overwrite someone else's changes.
3. Read docs/README.md and the documents relevant to the change.
4. Search for the data/function/UI call sites affected by the change.
5. Identify whether the change alters product behaviour, schema, money movement, provider behaviour, security, scheduled jobs or deployment.

## 2. Change classification

Describe the change as one or more of:
- product/UI change;
- domain model change;
- quote/pricing change;
- collection change;
- conversion/FX change;
- payout/beneficiary change;
- webhook/reconciliation change;
- database migration;
- security/authentication change;
- provider migration;
- operational/deployment change.

A financial change commonly affects several categories. Do not treat a backend payment change as a screen-only task.

## 3. Implementation discipline

- Keep a clear distinction between plan/order, transaction/collection and recipient commitment/payout.
- Treat all amounts as currency-specific financial values.
- Validate user ownership and destination/currency both at UI and trusted server boundaries.
- Persist stable references before calling external provider endpoints.
- Use conditional state updates/constraints to prevent concurrent duplicate actions.
- Handle timeout/unknown state by provider lookup and reconciliation.
- Do not make client redirects or client-submitted values authoritative.
- Preserve quote-time snapshots for every payout commitment.
- Do not change status transitions without checking the UI, Edge Functions, SQL RPCs, triggers and cron workers that read/write them.
- Do not introduce a new Flutterwave money movement path. See the migration readiness document for legacy paths that still require controlled replacement.
- Avoid unrelated refactors in payment code. Keep the diff focused and auditable.

## 4. Database migration discipline

Before writing a migration:
1. Inspect the current SQL schema/migrations and the target project's applied migration history if available.
2. Determine how existing rows will be represented.
3. Add constraints/indexes that enforce the intended invariant.
4. Consider RLS and privileges for every new table/function.
5. Use safe transaction boundaries where possible.
6. Do not modify an old migration that could already have run.
7. Write a new corrective migration when necessary.
8. Test on a non-production project/database first.

After a migration:
- verify columns, constraints, indexes, policies, triggers and RPC grants;
- verify existing rows;
- update types/database.ts;
- test both allowed and rejected cases;
- document whether it has actually been applied in each environment.

## 5. Financial test matrix for every provider change

At a minimum test:
- valid success path;
- rejected/invalid request;
- wrong owner;
- wrong amount and wrong currency;
- missing/stale quote;
- duplicate request;
- concurrent request;
- provider timeout before response;
- provider accepted request but Senda did not receive response;
- duplicate webhook;
- invalid webhook signature;
- out-of-order event;
- unknown provider status;
- provider lookup unavailable;
- partial recipient success/failure;
- manual/support resolution;
- retry after a verified terminal failure;
- no retry after an ambiguous outcome until reconciled.

Tests should assert both the expected row state and the absence of duplicate external money movement.

## 6. Commands available in package.json

The audited package.json defines:
- npm install
- npm run dev
- npm run dev:local
- npm run dev:web
- npm run build:web
- npm run lint
- npm run typecheck

There is no test script defined in the audited package.json. Do not claim a unit/integration test suite passed unless one has actually been added and run. If a test harness is introduced, document its command and required setup.

## 7. Pull request expectations

Every PR should explain:
- user/problem being solved;
- intended and actual behaviour;
- affected screens, Edge Functions, tables, migrations and provider endpoints;
- security/ownership checks;
- money-state transitions and idempotency behaviour;
- failure/timeout/reconciliation behaviour;
- tests and commands actually run;
- environment tested (local, sandbox, staging or production);
- migrations/secrets/schedules/webhooks needed;
- known gaps and rollback/recovery plan.

For provider or financial changes, include a state-transition summary or sequence diagram and identify how to reconcile an uncertain operation.

## 8. Documentation requirements

Update relevant handbook documents when:
- the product journey or domain changes;
- a status is added/removed/redefined;
- a database table or financial field changes;
- a provider API or credential changes;
- a webhook event/contract changes;
- a cron/scheduled reconciliation process changes;
- an old provider dependency is removed;
- deployment and rollback steps change.

Update docs/operations/FINCRA_MIGRATION_READINESS.md whenever a Fincra migration item becomes implemented, tested, deployed or verified. A code change alone should move an item to “implemented in source”, not “deployed” or “production-ready”.

## 9. Deployment control

There are separate release surfaces:
- frontend web export and Cloudflare Pages deployment;
- Supabase SQL migrations;
- Supabase Edge Function deployments;
- Supabase secrets/configuration;
- Fincra provider dashboard/webhook settings;
- pg_cron/pg_net/Vault schedules.

Do not imply one deploys the others. Production changes to payment functions, SQL or provider configuration require explicit user approval. Record the target environment and verify the actual deployed version after release.
