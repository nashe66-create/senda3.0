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
2. Repository-wide ESLint currently reports pre-existing React hook, JSX, and Edge Function resolver issues; touched behaviour typechecks and builds.
3. Verify release/main branch and Supabase migration alignment.

### Nigeria Pilot
- Confirm provider/Flutterwave production pathway.
- Define UK regulatory perimeter for the exact pilot structure.
- Map KYC/AML/sanctions, collection, FX and payout responsibility.
- Define complaints/refunds/support ownership.
- Define pilot limits and controls.
- Recruit first pilot users.

### Nigeria Provider Research — 10 September 2026
Verified current public information:

- Flutterwave's current Send App says its UK remittance services are powered and operated by Global Remit Financial Services Limited, an FCA-authorised payment institution (FRN 930827), while Flutterwave UK Limited acts as the technology platform/PSD agent arrangement described on the service. The same service states Flutterwave holds a CBN International Money Transfer Operator licence for inbound remittances in Nigeria. This is evidence of a regulated UK→Nigeria structure already operating within Flutterwave's ecosystem, not evidence that Senda itself is authorised.
- Flutterwave's developer documentation supports NGN bank-account payouts to Nigeria and requires an approved/KYC'd account, sufficient balance and server controls; beneficiary details include bank and account information. Current documentation also describes provider status verification through webhooks/transfer-status checks.
- Flutterwave's public payment-method documentation lists GBP card/account payment options for the United Kingdom, while its separate UK/EUR bank-account collection flow supports GBP and says approval is required for UK/European bank-account payments.
- CBN's revised IMTO guidelines define IMTOs as approved companies facilitating remittance transfers from people/entities abroad to beneficiaries in Nigeria. CBN also states Flutterwave Technology Solutions Limited holds relevant Nigerian payment-system licences and publishes Flutterwave on its payment-provider materials.

**Working conclusion:** Senda should pursue a regulated-partner/provider structure for the pilot rather than assume Senda can independently conduct UK→Nigeria remittance activity. The key commercial/regulatory question for Flutterwave is whether its existing regulated UK→Nigeria setup can support Senda's model of one UK customer payment funding multiple Nigerian beneficiary payouts, and under exactly which contracting/licensing structure.

**Questions to resolve with Flutterwave:**
1. Can Senda operate its customer experience as a technology/orchestration layer while the regulated entity remains the payment/remittance provider?
2. Which entity would contract with the UK customer and accept/settle the customer's GBP?
3. Which entity performs FX and determines the NGN payout amount/rate?
4. Which entity performs KYC, AML and sanctions screening for the sender and beneficiary?
5. Can one customer payment be allocated to multiple Nigerian payouts under the supported product/contract structure?
6. Which refund, chargeback, complaints and failed-payout responsibilities sit with Senda versus the regulated provider?
7. What production onboarding, transaction limits, reserve/safeguarding requirements and pricing apply to this structure?
8. Which Flutterwave API/product should Senda use for UK collection and Nigeria payout in production?

**Regulatory working rule:** Do not market Senda as the regulated remittance/payment provider or launch customer money movement in production until the exact legal/provider structure is confirmed.

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
1. Status hierarchy + failure UX — implementation complete; authenticated runtime verification outstanding
2. Contacts selector — implementation complete; device/runtime verification outstanding
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
| 2026-09-10 | Turn the Nigeria pilot pathway into a concrete operating question | Verify provider and regulatory facts | Confirmed that Flutterwave publicly documents UK→Nigeria remittance through regulated entities, Nigerian IMTO status, UK GBP collection options, and NGN bank payouts. Converted the uncertainty into a defined Flutterwave partnership questionnaire rather than assuming Senda's regulatory status or provider structure. | Flutterwave Send App/legal pages; Flutterwave payment and transfer documentation; CBN IMTO guidance; FCA payment-services/agent guidance reviewed | Exact Senda contracting, licensing, KYC/AML, FX, settlement, refund and multi-beneficiary allocation structure not yet confirmed | Contact Flutterwave and obtain a written answer to the 8 provider questions above | IN PROGRESS |

## Current Next Session

### Must-finish outcome
Obtain a concrete Flutterwave answer on the UK→Nigeria operating structure for Senda and continue authenticated runtime verification in parallel.

### Tasks
1. Send the Flutterwave partnership questionnaire covering regulated entity, UK collection, FX, Nigeria payout, KYC/AML, sanctions, refunds, complaints, limits and multi-beneficiary allocation.
2. Run authenticated payout and contact scenarios A-H, including provider FAILED/CANCELLED and reconciliation outcomes.
3. Triage repository-wide ESLint failures without changing unrelated product behaviour.
4. Verify the current branch against release/main and Supabase migration alignment; do not merge or deploy from this branch.

### Definition of Done
We have written provider answers identifying the intended UK→Nigeria structure and responsibility split, authenticated runtime tests have been executed, customer-facing status/failure behaviour is verified, Contacts works on supported devices, and the release state is understood.

## Execution Backlog


## Decisions Log

| Date | Decision | Reason | Impact |
| --- | --- | --- | --- |
| 2026-09-10 | Nigeria is the first Senda pilot corridor | Gives us one concrete corridor to validate the aggregation model before expanding | All pilot/provider/regulatory work is currently centred on UK → Nigeria |
| 2026-09-10 | Treat Flutterwave as a provider/regulated-partner candidate, not proof that Senda itself is authorised | Flutterwave publicly operates a UK→Nigeria remittance service through regulated entities, but Senda's own legal perimeter remains unresolved | We must confirm the exact contracting/licensing structure before customer-money production launch |

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
