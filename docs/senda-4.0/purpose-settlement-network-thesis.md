# Thesis: Safe Purpose-Settlement Network for MTOs / Fintechs

**Date:** 2026-11-13  
**Status:** Strategic exploration (not founder-locked)  
**Idea:** Don’t only be the consumer remittance brand. Become the **allowlisted institution + beneficiary binding layer** that Remitly/WorldRemit/Wise/banks/fintechs call when a sender wants to pay a *named obligation* (school, medical aid, funeral plan, electricity) with **proof** and **lower dispute/scam surface**.

Related: [purpose-settlement-build-guide.md](./purpose-settlement-build-guide.md) (consumer wedge) · payments partner strategy.

---

## 1. The reframe

| Consumer MTO (Remitly et al.) | This network |
| --- | --- |
| Pay **person** | Pay **institution × beneficiary** |
| Success = money arrived | Success = **obligation cleared + receipt** |
| Open receive graph (anyone) | **Closed graph** (onboarded merchants only) |
| Warn against goods/services | **Productise** goods/services safely |
| Own customer relationship | Can be **infrastructure** under their brand (or dual) |

Big players avoid open commerce. They may **buy or embed** a network that turns “school fees” into a **typed, linked, attested payment** — same way they already embed cash-pickup agents and mobile-money wallets.

**One-liner:** *Stripe + bill-pay directory + beneficiary KYC binding for African institutions, exposed as an API to remittance majors.*

---

## 2. Core object: the Link

Not “send to school account.” A **Link** binds three parties:

```
Payer (diaspora user) ──Link──► Beneficiary (student / member / meter)
                              └──► Institution (school / HMO / funeral / disco)
```

### Link properties (minimum)
| Field | Why |
| --- | --- |
| `link_code` | Human-shareable (e.g. `SND-GRN-CHIDI-7K2`) for WhatsApp onboarding |
| `institution_id` | Allowlisted, KYB’d merchant |
| `beneficiary_ref` | Student ID / policy no. / meter no. / member no. |
| `beneficiary_display` | Name for payer confirmation (masked as needed) |
| `payer_id` | Who is authorised to fund this link |
| `status` | `pending_verify` → `active` → `suspended` |
| `verification_method` | School roster match / OTP to guardian / biller validate API / letter |
| `permissions` | Who can pay; optional second payer (spouse) |

**Onboarding flow (school example):**
1. School KYB + fee products (term fees, PTA, boarding).  
2. School (or parent in NG) creates beneficiary → system issues **link code**.  
3. UK payer redeems code → sees “Greenfield College · Chidi Eze · JSS2” → confirms.  
4. Optional: school/parent confirms payer (QR, OTP, portal approve).  
5. Only then can GBP→settle hit that obligation.

**Scam mitigation:** Payer cannot invent a random “school.” No link = no pay. Fake school with no KYB never enters the graph.

**Dispute mitigation:** Payment is always to `institution_id + beneficiary_ref + product_id + period`. Receipt cites those. “I paid the wrong person” shrinks to “wrong link” (user error) vs “merchant didn’t deliver” (merchant SLA).

---

## 3. How this fixes the three Remitly blockers

### Scams
- Closed merchant set  
- Beneficiary must exist at institution before pay  
- Payer↔beneficiary link is explicit (not “send to bursar’s personal account”)  
- Velocity / new-link cooling / institution risk tiers  

### Disputes
- Clear success criteria: biller accept / school ledger credit  
- Proof artefact API for the MTO to show in-app  
- Contractual waterfall: network ↔ institution SLA; MTO ↔ network; consumer ToS points at **attested payment**, not educational outcome  
- Refunds only on `settlement_failed` or institution reject — not “child failed exams”  

### Licence shape
Two clean postures (counsel to pick; both better than open P2B):

| Posture | Who you are | Fit |
| --- | --- | --- |
| **A. Agent of the institution** | Merchant payment processor / bill-pay agent for contracted schools/billers | Often cleaner “not open money transmission to arbitrary parties”; FinCEN-like logic elsewhere: agent of biller ≠ same as open MT |
| **B. Technical service + settlement partner** | You do directory, link, proof; a licensed PI/IMTO moves funds | Faster UK start; Remitly already has licences — they call your API for *destination instruction* |

For selling into Remitly: **B** is the land; **A** deepens moat as you accumulate exclusive school contracts.

You are **not** asking Remitly to accept open goods/services. You’re giving them a **typed rail**: `PURPOSE_SETTLEMENT` with allowlist guarantees they can put in their risk policy.

---

## 4. Product surface for big players

### API (what Remitly integrates)
```
POST /v1/links/resolve          → show institution + beneficiary preview
POST /v1/quotes                 → GBP/NGN for product + fees
POST /v1/settlements            → execute after they collected GBP (or you collect)
GET  /v1/settlements/{id}       → status
GET  /v1/settlements/{id}/proof → receipt PDF/JSON
Webhooks: settlement.proven | settlement.failed | link.suspended
```

MTOs keep: customer UX, GBP collect, FX brand, AML on sender.  
You provide: **who to pay, validation, local settle, proof**.

### Categories (roadmap, not day-one)
| Priority | Category | Beneficiary key | Why |
| --- | --- | --- | --- |
| P0 | Schools / universities | student_id + term product | Highest diaspora emotion + Cenfri signal |
| P1 | Electricity / utilities | meter_no | Aggregator exists; proof = token |
| P1 | Airtime/data | MSISDN | Already commoditised; good demo |
| P2 | Funeral plans / insurance | policy_no | Recurring; high trust need |
| P2 | Medical aid / hospital packages | member_no | Sensitive data; higher bar |
| P3 | Rent (verified landlords) | tenancy_id | Fraud-heavy; last |

Same **Link** abstraction across all: institution + beneficiary_ref + product.

---

## 5. Why majors might adopt (honest)

**Buy / embed if you give them:**
- Lower scam loss and support cost on “school fee” intents they already see in free text  
- New use case without rebuilding NG merchant KYB  
- Receipt UX competitors lack  
- Corridor coverage they can market (“pay school fees with proof”)

**They build in-house if:**
- You only have 3 schools and no exclusive contracts  
- Your API is flaky / proof is weak  
- They fear disintermediation of their customer  

**Defence:** density in NG education + utilities, **exclusive or preferred** school contracts, certification (“Remitly Purpose Safe”), and being multi-MTO Switzerland (don’t launch a competing consumer brand in their face on day one — or white-label only).

---

## 6. Company architecture (build properly)

```
┌─────────────────────────────────────────────┐
│ Network control plane                        │
│ Institutions · Beneficiaries · Links · Risk  │
│ Proof store · Dispute cases · Audit          │
└───────────────┬─────────────────────────────┘
                │
     ┌──────────┴──────────┐
     │ Settlement adapters │  Flutterwave Bills / school VA /
     │                     │  disco tokens / insurer APIs
     └──────────┬──────────┘
                │
     Partner liquidity (NGN) + optional GBP collect partner
```

**Moat order:** (1) verified institution graph, (2) link identity graph, (3) proof reliability, (4) MTO integrations, (5) brand. Softward alone is copyable; **onboarded schools with live fee schedules** are not.

---

## 7. GTM (entrepreneur sequence)

1. **Own a thin consumer or partner channel** to prove settle+proof (even 1 school cohort) — inventory for demos.  
2. **Pack as API + compliance one-pager** for MTO risk teams (“closed loop P2B”).  
3. Pilot with a **second-tier or regional MTO / African fintech** before Remitly (faster BD).  
4. Use pilot metrics (scam rate, dispute rate, proof attach rate) as sales weapons.  
5. Only then enterprise Remitly/WorldRemit/Wise Business.

Parallel: sell to **schools** as “diaspora fee collection + automatic UK payer links” (they feel payment pain too).

---

## 8. Relation to Senda today

| Path | Role of current Senda app |
| --- | --- |
| **A. Network-first** | App is reference customer / dogfood; real company is B2B API |
| **B. Brand-first** | Senda consumer “pay school + Mum”; network extracted later when density exists |
| **C. Dual** | Consumer for distribution; API for scale |

Honest pick: **B then A** if you need learning and diaspora trust; **A** if you can hire NG BD and sell compliance story without a consumer brand. The Link model works for both.

Do **not** confuse “grouped P2P remittance” with this. This is **P2B attested settlement**. P2P can remain a sibling product on the same ledger.

---

## 9. Risks (take seriously)

- School BD is slow; fake “inventory” kills MTO trust  
- Becoming the dispute desk between UK parent and NG bursar  
- Data protection (children’s data)  
- Aggregator outages blamed on you  
- Majors copy directory after you prove category  
- Licence creep if you hold funds without clear agent structure  

Mitigations: allowlist only; clear SLA; proof standards; multi-aggregator; counsel on agent-of-biller vs PI; non-exclusive early, exclusive density later.

---

## 10. Verdict

**Yes — this is how you “be the one that builds the safer architecture for the big players.”**  
The product is not remittance. It’s a **verified Link network** (payer ↔ beneficiary ↔ institution) plus settlement + proof APIs that let MTOs offer purpose payments **without** opening goods/services to the open internet.

That directly answers why Remitly warns today: they lack this graph. Building the graph *is* the company.
