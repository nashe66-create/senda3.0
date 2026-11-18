# Take: Senda as Payment Infrastructure (Not a Remittance Brand)

**Date:** 2026-11-13  
**Status:** Strategic assessment of the “network-first / six systems” framing  
**Aligns with:** [purpose-settlement-network-thesis.md](./purpose-settlement-network-thesis.md) · [purpose-settlement-comps-deepdive.md](./purpose-settlement-comps-deepdive.md) · [purpose-settlement-build-guide.md](./purpose-settlement-build-guide.md)

---

## 1. Verdict

**Yes — this is the right company shape.**

Treat Remitly/Wise/WorldRemit/banks as **B2B customers**, verified schools/hospitals/utilities as **supply-side nodes**, and Senda as the **control plane**: verify → identify → validate → orchestrate → reconcile → dispute.

That matches why big MTOs refuse open goods/services, why EduPay only “guarantees” VA attribution, and why PayAngel/Vybe/Ékié are vertical apps, not Remitly’s silent infrastructure layer.

**Do not** abandon money-movement awareness — orchestration without a clear “who holds/safeguards/settles” contract is vapour. **Do** refuse to be the consumer remittance brand as the primary identity.

---

## 2. What’s strong in this framing

| Point | Why it holds |
| --- | --- |
| Remittance cos keep the customer | Correct GTM; you’re not fighting their CAC |
| Six systems (KYB, directory, validation, orchestration, reconciliation, disputes) | Exactly the Remitly risk checklist |
| Reconciliation as commercially critical | MTOs buy **exception rate**, not logos |
| Prove 5 things before Remitly sales | Disciplined; matches “one clean E2E transaction” |
| Network density = moat | Software is copyable; verified billers + Links aren’t |
| Three products: Connect / Biller / Network | Clean packaging of the same core |
| Start one vertical (schools) | Required |
| Senda initially tech + orchestration; PIs move money | Matches founder posture (partner holds funds) + licence shape |

This is a sharper statement of the Link/network thesis, not a contradiction.

---

## 3. Sharpen / correct a few things

### A. “Unique student ID” ≠ authentication
They already note this — keep it loud. Directory IDs are **identifiers**. Authorisation is: biller attested the obligation + payer is allowed on that Link + provider authenticated the API call.

### B. Bill validation is the crown jewel — and the hardest
Live “outstanding balance / invoice settled?” needs school SIS or Remita/EduPay-class feeds.  
**Day-one realism:** portal + CSV/fee schedule + staff confirm for pilot schools.  
**Day-two:** API to EduPay/Remita/SIS.  
Don’t promise Remitly live invoice truth on day one if schools email Excel.

### C. Orchestration must separate instruction vs funds
Explicit states: `instructed → funded → settling → credited_biller → credited_obligation → proven` vs `exception`.  
Accepting Remitly’s API call ≠ money moved.

### D. Zimbabwe example is fine for illustration; pilot should still be **NG schools** (or one corridor you can actually KYB + settle)
Don’t multi-country the first proof.

### E. Landlords / councils are late-stage
Fraud and KYB nightmare. Schools → utilities/telecom tokens → insurers → rent last.

### F. “Aggregation for partner remittance companies”
PayAngel already claims this in ToS. Flutterwave could productise schools-for-partners. **Speed to proof + NG density + reconciliation SLA** matters.

---

## 4. How EduPay / Remita fit (don’t rebuild)

```
Provider (Remitly) --API--> SENDA CORE
                              |-- KYB directory + Links
                              |-- Validation (portal/API/SIS)
                              |-- Orchestration
                              |-- Ledger + 3-way reconcile
                              |-- Disputes
                              v
                    Adapters: EduPay VA | Remita RRR | Flutterwave Bills | school bank
                              v
                         Verified biller
```

EduPay guarantees **local VA attribution to student + school Flutterwave**.  
Senda guarantees **network identity + obligation validity + cross-provider reconciliation + proof object**.  
Compose, don’t clone.

---

## 5. What I’d keep from earlier Senda work

| Keep | Why |
| --- | --- |
| Order/commitment/attempt ledger thinking | Becomes transaction ledger + stages |
| Provider ports (collect/convert/payout) | Become orchestration adapters |
| Post-fund quote discipline | Still true if you touch FX |
| Partner holds funds (for now) | Infra posture |

| Deprioritise as *company identity* | Why |
| --- | --- |
| Competing with WorldRemit on P2P FX | Wrong war |
| Grouped P2P as the only thesis | Can remain a *use case* on the network (person as a “biller type” is weak; keep P2P separate or thin) |

Consumer Senda app → **dogfood / first “provider”** or school-parent channel, not the brand story to investors long-term.

---

## 6. Five proof points — agree, with pass criteria

| Proof | Pass looks like |
| --- | --- |
| Biller verification | KYB pack + account ownership control; account-change re-KYB |
| Account/obligation ID | Student resolved with school-confirmed display name |
| Payment integrity | Reject unknown biller, duplicate idempotency key, overpay rules |
| Reconciliation | Remitly instruction ↔ settlement credit ↔ student fee line match; mismatches = exception not “paid” |
| API reliability | Sandbox + one live provider (or Senda dogfood as provider) webhooks with retries |

**Demo that sells:** Remitly-shaped client (or Postman + simple UI) → validate school/student/invoice → fund → settle → proof ref → three-way green.

---

## 7. Commercial model — agree

- **Senda Connect** — per settlement + platform fee to MTOs/fintechs/banks  
- **Senda Biller** — SaaS + per-payment to schools  
- **Senda Network** — enterprise access / minimums / SLAs  

Same core meters differently.

---

## 8. Three architecture decisions — agree with recommendations

1. **Biller relationship:** Senda owns verified network profile; provider owns end customer.  
2. **Billing data:** API **or** portal/upload **or** SIS/Remita/EduPay — all three.  
3. **Who moves money:** Authorised partners; Senda instruction + track + reconcile (counsel still required).

Lock these before schema freeze.

---

## 9. Risks to say out loud

- Chicken-and-egg: schools won’t KYB for zero volume; Remitly won’t integrate for 5 schools → need dogfood channel or PayAngel-class mid-tier first.  
- Becoming unpaid support desk between UK parent and bursar.  
- Children’s data / DPIA.  
- Flutterwave/Remita/PayAngel occupying wholesale seat.  
- “Infra” identity while still needing BD boots in Lagos/Harare — this is an **ops + software** company.

---

## 10. Bottom line

This framing is **correct and investable**: Senda = **verified biller network + validation + orchestration + three-way reconciliation + disputes**, sold to payment providers once, reused across billers/countries.

Build **school vertical first**, partner NG rails (EduPay/Remita/Flutterwave), prove **one clean E2E**, then sell Connect.

The sentence to put on the wall:

> Integrate once. Access a growing network of verified institutions. We prove the biller, the obligation, and that settlement matched — or we raise an exception.
