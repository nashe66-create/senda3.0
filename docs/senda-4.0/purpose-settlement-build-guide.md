# Building Purpose / Bill / School Settlement with Proof

**Date:** 2026-11-13  
**Status:** Build blueprint (not a founder lock)  
**Wedge:** UK sender settles a *named need* in Nigeria and gets **proof** — not “hope brother paid the school.”  
**Context:** Complements remittance P2P; harder ops than grouped person payouts; higher differentiation vs Remitly/WorldRemit.

---

## 1. What “done properly” means

A purpose settlement is **not** a remittance with a memo field.

| Remittance P2P | Purpose settlement |
| --- | --- |
| Payee = person | Payee = **biller / school / utility** (or escrowed obligation) |
| Success = NGN delivered | Success = **obligation cleared** + **receipt artefact** |
| Proof = provider payout webhook | Proof = **institution acknowledgement** (token, receipt PDF, student VA credit, biller reference) |
| Failure = wrong account | Failure = wrong student ID, expired fee schedule, school not onboarded |

**Product promise (one sentence):**  
“I paid Chidi’s term fees at [School] — here’s the receipt — and Mum’s upkeep separately.”

If you cannot show that receipt reliably, you are still a remittance app with labels. Labels alone are table stakes (Cenfri); **proof** is the wedge.

---

## 2. Do not boil the ocean — wedge sequence

### Phase 0 — Prove demand (2–4 weeks, parallel)
- Primary interviews: UK Nigerians who paid **school fees** or **utilities** in last 12 months via someone in NG.  
- Ask: how they pay today, what goes wrong, what “proof” they accept (WhatsApp photo of receipt vs school portal).  
- Kill if: everyone trusts conduit + photo, or schools refuse any third-party pay.

### Phase 1 — MVP: **School fees for a closed set of schools** (recommended first)
Why schools first (not “all bills”):
- Highest Cenfri willingness to pay institutions directly (~55% stated for schools).  
- Distinct expense (not fungible household cash).  
- Clear student identity (name / class / admission no.).  
- Seasonal urgency → willingness to try a new flow.  
- Existing NG infra: Flutterwave `SCHPB` billers, EduPay-style school+VA models, Slimpay school APIs, school portals.

**MVP scope (ruthless):**
- UK collect GBP (partner) → convert → settle **one school fee obligation**.  
- Optional: same order can still include **one P2P** (Mum) — proves portfolio UX without needing 50 billers.  
- 5–20 pilot schools (Lagos/Abuja private or known diaspora schools), not “every school in Nigeria.”  
- Manual school onboarding OK at first; automate later.

### Phase 2 — Catalog billers (airtime, electricity, DSTV, internet)
Use bill-payment aggregators (e.g. Flutterwave Bills: AIRTIME, UTILITYBILLS, CABLEBILLS, SCHPB — [docs](https://developer.flutterwave.com/docs/bill-payment)).  
Faster coverage, weaker “special” feel; still valuable once school proof works.

### Phase 3 — Health / rent / construction suppliers
Only with institution contracts; fraud and dispute rates explode without them.

---

## 3. Architecture (layers)

Keep Senda’s order model; extend commitment types.

```
UK Sender
   │
   ├─ Obligation Ledger (Senda)          ← you own this
   │     Plan / Remittance Order
   │     Commitments: type = person | school_fee | biller
   │     Proof objects: receipt_url, biller_ref, student_id, status
   │
   ├─ CollectPort (GBP)                  ← partner (Fincra/Blaaiz/Passpoint…)
   ├─ ConvertPort (GBP→NGN)
   │
   └─ SettlePort
         ├─ PayoutPort (person bank/MM)  ← existing
         └─ InstitutionPort
               ├─ BillerAggregator (Flutterwave Bills / similar)
               └─ SchoolDirect (school VA / school API / EduPay-class)
```

**Critical design rule:** Institution settlement is a **first-class commitment**, not metadata on a person payout.

### Data model additions (conceptual)

| Entity | Fields (min) |
| --- | --- |
| `obligation` / commitment | `kind`, `beneficiary_display`, `amount_dest`, `due_at`, `purpose` |
| `institution` | `type` (school/biller), `provider`, `external_biller_code`, `country` |
| `student_context` | `student_name`, `student_id`, `class`, `term`, `school_id` |
| `settlement_attempt` | same attempt pattern as payouts |
| `proof` | `proof_type`, `external_ref`, `artifact_url`, `verified_at`, `raw_provider_payload` (secured) |

Statuses for institution commitments:  
`draft → funded → settling → settled_proven → failed → needs_reconcile`  
Never mark `settled_proven` on wallet debit alone.

---

## 4. Two settlement modes (use both over time)

### A — Aggregator biller pay (scale)
1. List billers/items from aggregator.  
2. Validate customer/student identifier (`customer_id` / smartcard / meter / school item).  
3. After GBP funded + NGN available, call create bill payment with **idempotent reference**.  
4. Webhook + poll until success.  
5. Store provider receipt/token as proof; surface in app + email/WhatsApp.

**Pros:** Fast catalog. **Cons:** School coverage uneven; proof quality = whatever aggregator returns; you don’t own school relationship.

Flutterwave shape: categories include `SCHPB`, validate, then pay item — [Bill payments](https://developer.flutterwave.com/docs/bill-payment).

### B — School-direct / student VA (trust + proof)
1. Onboard school (KYB, settlement account, fee schedule).  
2. Each student gets VA or payment reference (EduPay-style: school’s own processor account; funds to school).  
3. Senda pays that VA/reference from NGN wallet **or** generates pay instructions after FX.  
4. Proof = school webhook / VA credit + optional school-issued receipt PDF.

**Pros:** Best proof story; schools become distribution. **Cons:** BD-heavy; slow; support load.

**Proper build:** MVP = **B for pilot schools** + **A for airtime/utility** as secondary. Don’t wait for 1,000 schools before launch — wait for **receipt quality** on 10.

---

## 5. The “proof” product (this is the UX)

Minimum proof pack per settled obligation:

1. **What** — “Spring 2026 term fees — Greenfield College — Chidi Eze — JSS2”  
2. **How much** — NGN paid + GBP funded (show both)  
3. **To whom** — institution legal name / biller  
4. **References** — Senda obligation id + provider/biller/school ref  
5. **When** — settled timestamp  
6. **Artifact** — PDF or image + share link (WhatsApp)  
7. **Confidence** — `verified by school` vs `verified by payment network` (be honest in UI)

Sender flows:
- Share proof to family group  
- Reminder before term due date  
- History filter: “All school payments 2025”

Without shareable proof, WhatsApp photo-of-receipt still wins.

---

## 6. Money flow (ops-correct)

```
1. User creates obligation(s) → indicative GBP quote (fixed_source OK)
2. User pays once (CollectPort)
3. Funds safeguarded by partner → Senda marks order funded
4. Convert to NGN (ConvertPort) — post-fund quote policy fine
5. For each commitment in order:
     if person → PayoutPort
     if school/biller → InstitutionPort (idempotent)
6. Webhooks update each commitment independently
7. Only on institution success → attach Proof → notify sender
8. Partial success allowed (Mum paid, school failed → retry school only)
```

**Ops realities to staff for:**
- Wrong student ID / name mismatch  
- School fee amount changed mid-term  
- Aggregator success but school denies credit (nightmare — need escalation path)  
- Refunds when institution rejects after GBP collected  
- Support hours spanning UK evening / NG morning  

Write a **reconciliation runbook** before pilot money: who calls the school, SLA, when to refund GBP vs retry NGN.

---

## 7. Compliance & trust (non-optional)

| Topic | Approach |
| --- | --- |
| UK remit / payment services | Partner safeguards; Senda role written (agent/TSP). Purpose settlement can look more like paying merchants — counsel must classify. |
| Destination | School/biller KYB; no “send to random school account number” without verification. |
| Scams | Remitly warns against goods/services for a reason. **Allowlist institutions** only in MVP. |
| Consumer duty | Clear: who holds funds; when obligation is “paid”; complaint path if school disputes. |
| Data | Student minors’ data — minimise; parental/guardian authority; retention limits. |

**Do not** market “we guarantee the school enrolled your child.” Guarantee **payment delivery + receipt from payment rail/school system**, not educational outcomes.

---

## 8. Commercial & BD (the hard ops)

Hiring/partnering > more Edge Functions:

1. **School partnerships lead** (Lagos) — contracts, fee schedules, test payments.  
2. **Support playbook** — bilingual templates, school contact directory.  
3. **Aggregator contract** — bills + SCHPB coverage list for pilot cities.  
4. **Pricing** — workflow fee on institution legs (higher than P2P FX skim); transparent.  
5. **Distribution** — alumni WhatsApp of pilot schools; PTA groups; UK Nigerian professional networks.

Cold-start trick: start with **schools that already take Flutterwave/Paystack** so you’re integrating a known rail, not digitising a cash-only bursar from zero.

---

## 9. How this sits on current Senda

You already have: plans, commitments, fixed_source, collect→convert→per-commitment payout, attempt ledger.

**Reuse:** order + funding + conversion + attempt/webhook pattern.  
**Add:** `commitment.kind`, institution entities, InstitutionPort, proof table, school onboarding admin, receipt share.  
**Do not rewrite** into a generic “super app.”  
**Do not** wait for own rail — use partner NGN liquidity + bill/school APIs.

Roadmap alignment:
1. Finish GBP collect path for pilot.  
2. Ship P2P multi-commitment if primary research supports L2 friction.  
3. **Parallel** school pilot (even 1 obligation type) — that’s the differentiation bet.  
4. Merge UX: one plan = Mum P2P + school institution.

---

## 10. 90-day build plan (practical)

| Weeks | Build | Ops |
| --- | --- | --- |
| 1–2 | Research 15 fee-payers; pick 5–10 schools; counsel note on merchant vs remittance | Term sheets for schools |
| 3–5 | Data model + InstitutionPort sandbox (bills SCHPB + 1 school VA path) | Test pay real ₦ fee on sandbox/live small |
| 6–8 | Sender UX: create school obligation → fund → proof screen/share | Support runbook v1 |
| 9–10 | Closed beta 20–50 UK users / 1–2 schools | Measure: proof share rate, support tickets, settle success |
| 11–12 | Fix reconciliation gaps; decide expand schools vs add electricity | Kill/continue |

**Success metrics:** institution settle rate ≥95%; proof generated ≥98% of settles; % users who share proof; support contacts per 100 settles; repeat next term.

**Kill metrics:** schools won’t confirm; >X% “success but school says unpaid”; users still prefer send-to-bursar WhatsApp after trying you.

---

## 11. What “properly” is *not*

- A purpose dropdown on a person payout with no receipt  
- Paying a teacher’s personal account and calling it “school”  
- Launching 40 bill categories before one school receipt is trusted  
- Building your own school ERP  
- Waiting for SPI/API licence before the pilot  

---

## 12. One-line operating principle

**Own the obligation ledger and the proof; rent the GBP collect, FX, and biller/school rails — until proof-retention makes licence and direct school network worth owning.**

---

### References
- Flutterwave Bill Payments / SCHPB: https://developer.flutterwave.com/docs/bill-payment  
- EduPay (school→Flutterwave direct): https://edupay.com.ng/  
- Slimpay school fees API: https://slimpay.ng/docs/schools/overview  
- Cenfri for-purpose demand: see `docs/customer-research/multi-recipient-behaviour-synthesis.md`  
- Incumbent gap: Remitly P2P-not-goods; WorldRemit airtime as thin exception
