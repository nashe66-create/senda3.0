# Senda 4.0 MVP PRD (draft)

**Status:** Draft for founder lock — informed by secondary demand/supply research (2026-11-13).  
**Full build spec:** [product-spec.md](./product-spec.md) (v0.1)  
**Product:** Senda Connect (MTO) + Senda Biller (institutions).  
**Doctrine:** Instruction + proof. Prefer `mto_settles`. Avoid adaptor-as-payer.

---

## 1. Problem

Diaspora money for **school fees** (and later medical/utilities) still often goes **person → person → institution**, or to fragile WhatsApp account details. MTOs increasingly want purpose/business pay (Remitly Business Pay, Mukuru billers, PayAngel D2MR) but **verified student↔school Links, obligation validation, and recon proof** across allowlisted African institutions remain thin — especially as neutral infra an MTO can embed without running bursar ops.

---

## 2. MVP outcome

One clean path:

**Verified school + student Link → Connect returns pay instructions + ref → MTO (or bank) settles → Senda reconciles confirmation → proof to payer, school, MTO.**

Success metric: **≥1 design-partner sandbox or ≥5 schools + ≥20 real/pilot settlements** with three-way recon green.

---

## 3. Users

| Role | Need |
| --- | --- |
| **MTO partner** | Embed purpose pay; keep collect/FX; low goods-services risk |
| **School bursar** | Attributable fees; less chase; trusted receipt |
| **Diaspora payer** | Pay the right school/student; get proof (via MTO UX) |

Senda has **no** consumer brand requirement in MVP (dogfood UI optional).

---

## 4. In scope

- Manual institution KYB  
- Student roster (CSV) → beneficiaries  
- Link + unique payment reference  
- `validate` obligation (amount if known / open + student)  
- `instructions` payload: bank or MM till **as destination data**  
- Confirmation ingest (partner webhook / manual mark / statement match)  
- Recon states + exception queue  
- Proof artifact (PDF/JSON)  
- Partner API or documented manual Connect flow for pilot  

## 5. Out of scope

- Senda GBP collection / FX / adaptor-as-payer as core  
- Open marketplace goods/services  
- Live multi-country  
- SIS live sync  
- Remita/EduPay rebuild  
- Consumer growth/marketing engine  

---

## 6. Core objects

| Object | Meaning |
| --- | --- |
| `Institution` | KYB’d school + settle destinations |
| `Beneficiary` | Student (or policy holder later) |
| `Link` | Allowed payer context ↔ beneficiary ↔ institution |
| `Obligation` | Term/fee line or open amount |
| `Instruction` | How MTO should pay (account/till + ref) |
| `Attempt` | One settlement try; single `settlement_executor` |
| `Proof` | Immutable-enough receipt of allocated payment |

---

## 7. Connect API sketch (logical)

1. `POST /v1/validate` — institution/student/obligation → OK + amounts/constraints  
2. `POST /v1/instructions` — returns settle rails + `customer_reference`  
3. `POST /v1/confirmations` — MTO/bank notifies paid (id, amount, timestamp, provider_ref)  
4. `GET /v1/proof/{id}` — receipt  
5. `GET /v1/attempts/{id}` — status including `needs_reconcile`

Default executor: **`mto_settles`**.

---

## 8. Corridor / vertical

| Choice | Draft lock | Rationale |
| --- | --- | --- |
| Vertical | **School fees** | Universal language across Remitly/Mukuru/PayAngel; clear obligation |
| Geography | **UK send → NG private schools** | Supply research + existing repo pilot; ZW as research track |
| Settle types v1 | Bank transfer (+ name match); optional MM till | Matches safest diaspora practice |

---

## 9. Research-driven risks

| Risk | Mitigation |
| --- | --- |
| Remitly builds Business Pay depth | Differentiate Link-level proof + multi-MTO neutrality; move fast on density |
| Mukuru bill network enough | Sell student-level validation + recon SLA they don’t have |
| Schools won’t KYB without volume | Dogfood channel or MTO LOI before wide onboarding |
| Double pay if adaptor later | Single executor rule (already locked) |

---

## 10. What founder must still lock

1. Pilot country: **NG confirm?** ZW parallel only?  
2. First design-partner target list (names)  
3. Dogfood consumer UI: yes/no for cold-start  
4. Pricing hypothesis to test in interviews (per proof vs SaaS)  
5. Accept this MVP in/out as **v0 lock** pending interview falsification  

---

## 11. Sources feeding this draft

- `docs/customer-research/demand-mto-pack.md`  
- `docs/customer-research/supply-school-pack.md`  
- `docs/payment-provider-agnostic-architecture.md`  
- `docs/stage-operating-plan.md`  
