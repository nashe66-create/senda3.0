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

**Current MVP blockers:**
1. Status hierarchy must remain consistent between Payment, Grouped Transfer and individual Transfer.
2. A Grouped Transfer must not show Completed while an individual payout is still Processing.
3. Failed/blocked individual payouts must surface as Needs attention with a safe customer-facing reason.
4. Select from Contacts must work.
5. Verify release/main branch and Supabase migration alignment.
6. Run full regression testing.

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
| 2026-09-10 | Establish the execution system and confirm Nigeria as the pilot corridor | Create the permanent tracker | Execution system established; pilot focus changed to UK → Nigeria | Daily execution automation created; tracker committed to GitHub | None | Close remaining MVP blockers | DONE |

## Current Next Session

### Must-finish outcome
Close the remaining MVP blockers before expanding pilot activity.

### Tasks
1. Verify the latest local Copilot work is safely committed, pushed and merged to `main`, without rewriting existing live migration history.
2. Test that a Grouped Transfer cannot become Completed while an individual Transfer remains Processing.
3. Ensure failed/blocked payouts show Needs attention with a clear safe reason.
4. Fix and test Select from Contacts.

### Definition of Done
The MVP status model is consistent across Payment, Grouped Transfer and individual Transfer; payout failures are understandable to customers; Contacts selection works; and the release state is verified.

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
