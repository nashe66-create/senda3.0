# Senda 4.0 — Demand research pack (MTO / remit buyers)

**Purpose:** Inform MVP (Connect = instruction + proof). Secondary only until founder runs live calls.  
**Updated:** 2026-11-13  
**Labels:** [F] fact · [I] inference · [Q] open question

---

## 1. Who the buyer is

| Tier | Who | Why they’d care | MVP priority |
| --- | --- | --- | --- |
| **Primary** | Regional MTOs with African density (Mukuru, mid-tier remit brands, Flutterwave Send) | Already near bills/wallets; need verified institution directory + attribution without building school ops | **Design partner target** |
| **Stretch** | Remitly, Wise, WorldRemit | Huge volume; tuition is a stated customer job; risk/compliance heavy | Sell after density + proof SLA |
| **Adjacent** | Banks / neobanks with diaspora | Purpose products as stickiness | Later |
| **Not buyer** | Local EduPay-class portals | Compete/partner on supply side | — |

**Product implication:** Chase **Mukuru-class / PayAngel-adjacent** for first design partner; use Remitly as requirements north-star, not first logo.

---

## 2. What buyers already ship (teardown)

### Remitly — Business / tuition pay [F]
- Public guide: Remitly is for family/friends needs including **education and tuition**, but **not** recommended for open goods/services to people you haven’t met ([clear guide](https://www.remitly.com/gb/en/landing/clear-guide-to-using-remitly)).
- **Oct 2026 product news:** Remitly app can **pay businesses abroad directly** (tuition to school, medical bills, contractors), available broadly across send/receive countries ([news](https://news.remitly.com/company-and-product-news/remitly-now-pays-businesses/?pdf=25504)). Framing: skip the “send to relative then they pay” step.

**Implication:** Demand is **validated by Remitly itself**. Threat: they build merchant directory in-house. Senda wedge ≠ “Remitly can’t pay businesses.” Wedge = **verified Link (payer↔student↔institution) + obligation validation + recon proof + allowlist ops** Remitly may not want to operate per African school corridor — especially NG/ZW density and bursar-grade attribution.

[Q] Does Remitly Business Pay support NG private schools with student-level refs, or only coarse merchant bank credit?  
[Q] Will Remitly buy a network vs build?

### Mukuru — Bill Payment + Pay [F]
- **Bill Payment** partner pitch: list billers on Mukuru; customer picks biller + account number; cash/card/MM; instant notify; local & international settlement ([bill payment](https://www.mukuru.com/services/collections/bill-payment/)). Use cases: aggregators, vouchers, utilities. Claims access to 16m+ customers.
- **Mukuru Pay:** e.g. DStv in ZW at booths; SA online cash pay ([Mukuru Pay](https://www.mukuru.com/services/mukuru-pay/)).
- Wallet/card narratives mention school fees as everyday spend (e.g. Botswana companion card) — **recipient-side spend**, not always diaspora→school Link.

**Implication:** Mukuru already thinks like a **biller network**. They may want (a) more verified education/medical merchants, (b) better student/policy-level refs + proof, or (c) nothing if their aggregator is enough. Strongest near-term **design-partner candidate** for Connect if we don’t compete as another collection rail.

[Q] Do they already list private schools / medical aids with account-level validation?  
[Q] API appetite for external “instruction + proof” vs onboarding billers themselves?

### PayAngel — D2MR schools (Ghana) [F]
- Schools product: diaspora (UK/EU/US/CA/AU) pay registered Ghanaian schools; Payment Links + **Direct-to-Merchant Remittance**; PayAngel Business visibility ([schools](https://payangel.com/business/schools/), [D2MR](https://payangel.com/help/direct-to-merchant-remittances/)).
- They **are** the stack (collect + merchant account), not silent infra for Remitly.

**Implication:** Closest **vertical competitor**. Senda should not copy “we are the remittance brand for schools.” Differentiate: **MTO-agnostic Connect**, multi-country directory, student Link + recon that an incumbent embeds. PayAngel may also be a **channel** (use Connect for NG densify) or competitor for wholesale seat.

### Flutterwave Tuition / Send [F / I]
- Flutterwave “Tuition” materials skew to paying **outbound** school fees (e.g. UK/CA schools) from African send countries — different corridor shape than UK→NG school.
- Flutterwave Send / diaspora surfaces remain potential **Connect customers**; Flutterwave PSP remains optional rail only.

---

## 3. Jobs-to-be-done (buyer)

1. Offer “pay school / medical / bill” without owning bursar ops.  
2. Reduce scam / goods-services losses and support tickets.  
3. Keep **collect + FX + brand**; outsource allowlisted destination truth.  
4. Get audit-friendly proof (who paid what obligation).  
5. Avoid becoming a marketplace (refunds, delivery disputes).

**Connect must answer all five without Senda taking customer funds by default.**

---

## 4. Likely objections → MVP answers

| Objection | MVP answer |
| --- | --- |
| “We already pay businesses / billers” | We add **student/policy Link + obligation validate + recon proof**, not another payout pipe |
| “Not enough schools” | Pilot density commitment (N schools in corridor X) before integration |
| “Who moves money / who is liable?” | **`mto_settles` default**; Senda returns instructions + matches confirmations |
| “Custody / licence” | No customer GBP custody in Connect MVP |
| “SLA if bursar disputes” | Exception queue + proof artifact; clear RACI in contract |
| “Remitly will build this” | Speed to NG/ZW (or chosen) density + multi-MTO neutrality |

---

## 5. Interview kit (founder runs)

**Screener:** Product/partnerships/risk lead at MTO with African receive corridors; authority to discuss destination products.

**Questions (30–40 min)**
1. What % of sends are “for school / medical / bills” vs general support? (estimate OK)
2. Do you offer direct-to-business or bill pay today? Where does it break?
3. How do you verify a school/merchant today?
4. Would you accept **destination instructions + webhook confirm → proof** from a third party without them moving funds?
5. Minimum institution count / countries before vendor review?
6. Hard blockers: licence, data residency, PCI, AML purpose codes?
7. Who owns unmatched payments today?
8. Build vs buy appetite in next 12 months?

**Success signal for MVP:** ≥2 design partners say instruction+proof is interesting **if** density exists; or 1 commits to a sandbox pilot.

---

## 6. MVP product implications (demand)

| Decision | Recommendation |
| --- | --- |
| First buyer type | Mid-tier African MTO / remit brand (Mukuru-class), not Remitly logo chase |
| API shape | `validate` → `instructions` → `confirm` → `proof` (no payout required) |
| Vertical | School fees first (tuition language already in Remitly/PayAngel/Mukuru world) |
| Positioning | “Allowlisted purpose network” under their brand — not “Senda remittance” |
| Competitive watch | Remitly Business Pay depth per corridor; Mukuru biller coverage; PayAngel expansion beyond GH |

---

## 7. Open research queue

- [ ] Remitly Business Pay: NG/ZW school merchant coverage and student reference support  
- [ ] Mukuru Bill Payment: education/medical aid merchants live list  
- [ ] Wise / WorldRemit business or bill products (parity check)  
- [ ] 5 named outreach targets + intros (founder)  
- [ ] Pricing willingness (per settlement vs SaaS) — ask in interviews only
