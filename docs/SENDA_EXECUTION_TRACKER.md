# SENDA — DAILY EXECUTION TRACKER
Last reviewed: 10 September 2026

## Product Focus
**Pilot corridor:** UK → Nigeria

**Core product promise:** One payment. Multiple people.

**Customer terminology:**

- Grouped Transfer = one customer transaction containing multiple recipients
- Transfer = one individual recipient payout
- Payment = the customer's funding/payment event

## Execution Rules

1. We prioritise execution over generating new ideas.
2. Every day has one must-finish outcome.
3. There should normally be no more than two secondary tasks.
4. A task is only DONE when there is evidence.
5. Evidence can be code merged, test completed, provider contacted, document completed, user recruited, decision recorded, or another concrete artefact.
6. Blockers must have a next action.
7. New ideas must not automatically interrupt the current priority.
8. Do not mark work complete merely because it was discussed.

## Current State

### Product
- Senda aggregates multiple regular remittances into one customer transaction.
- One grouped order can contain multiple recipients.
- Recipients in a grouped transfer share destination country and currency.
- One customer payment funds the grouped transfer.
- One aggregate customer-facing processing fee.
- 60-second server-authoritative quotes.
- Locked quotes are immutable.
- Payment must be authoritatively confirmed before payouts are created/released.
- Individual payouts are independently tracked.

### Engineering
- Expo/React Native + Supabase architecture.
- Payout orchestration and reconciliation infrastructure are in place.
- Recurring-cycle infrastructure is deployed.
- Payment verification triggers payout orchestration.

1. Authenticated Supabase/Flutterwave runtime verification of the full payout and contact journeys remains outstanding.
2. Repository-wide ESLint currently reports pre-existing React hook, JSX, and Edge Function resolver issues; touched behavior typechecks and builds.
3. Verify release/main branch and Supabase migration alignment.

### Nigeria Pilot
- Confirm provider/Flutterwave production pathway.
- Define UK regulatory perimeter for the exact pilot structure.
- Map KYC/AML/sanctions, collection, FX and payout responsibility.
- Define complaints/refunds/support ownership.
- Define pilot limits and controls.
- Recruit first pilot users.

### Evidence / Metrics
- Number of separate transfers replaced by one Senda Grouped Transfer.
- Number of grouped transfers.
- Number of recipients per grouped transfer.
- Payout success and failure rate.
- Repeat usage.
- Time to completion.
- Customer support incidents.
- Customer fee.
- Provider cost.
- Margin/economics.

## Priority Queue

### P0 — Make the MVP testable
1. Status hierarchy + failure UX
2. Contacts selector
3. Release/main + migration verification
4. Full regression

### P1 — Make the Nigeria pilot operational
1. Provider/Flutterwave production pathway
2. Regulatory/perimeter review
3. Responsibility matrix
4. Pilot controls/support
5. First 10 pilot users

### P2 — Prove Senda
1. Controlled pilot
2. Measure grouped-transfer usage
3. Measure separate transfers replaced
4. Measure reliability and economics
5. Iterate based on evidence

## Daily Log

| Date | Must-finish outcome | Secondary tasks | What actually happened | Evidence | Blocker | Next action | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-09-10 | Establish the execution system and confirm Nigeria as the pilot corridor | Create the permanent tracker | Execution system established; pilot focus changed to UK → Nigeria | Daily execution automation created and tracker established | None | Close remaining MVP blockers | DONE |
| 2026-09-10 | Complete Day 1 status, payout failure, contacts, and regression handling | Validate release readiness | Shared grouped-status derivation now gives commitment state precedence; raw provider status keys normalize; individual failures show Needs attention with safe reasons; contact picker is reachable and handles permission, empty, missing-phone, and multiple-phone cases; terminal provider failures remain failed in the existing orchestration path | `npm test` passed 4/4; `npm run typecheck` passed; `npm run build:web` passed; `git diff --check` passed | Authenticated provider/runtime scenarios A-H not run; repository-wide lint remains red on existing issues | Run authenticated payout/contact scenarios, resolve or triage baseline lint, then verify release/main and migration alignment | PARTIAL |

## Current Next Session

### Must-finish outcome
Verify the implemented Day 1 fixes against authenticated Supabase/Flutterwave runtime behavior before expanding pilot activity.

### Tasks
1. Run authenticated payout and contact scenarios A-H, including provider FAILED/CANCELLED and reconciliation outcomes.
2. Triage repository-wide ESLint failures without changing unrelated product behavior.
3. Verify the current branch against release/main and Supabase migration alignment; do not merge or deploy from this branch.

### Definition of Done
The MVP status model is verified in authenticated runtime scenarios, payout failures are understandable to customers, Contacts selection works on supported devices, and the release state is verified.

## Execution Backlog


## Decisions Log

| Date | Decision | Reason | Impact |
| --- | --- | --- | --- |

## Working Principle
The purpose of this document is not to create more planning.

The purpose is to make sure Senda moves forward every working day.

When updating this document:
- preserve completed history
- do not delete evidence
- update status honestly
- keep the current must-finish outcome visible
- move completed work into history rather than leaving it mixed with TODOs
- do not invent progress
- do not rewrite old migration history merely to make the tracker look cleaner
