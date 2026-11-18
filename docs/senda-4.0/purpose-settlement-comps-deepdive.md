# Purpose Settlement — Competitor Deep-Dive & Wholesale Angle

**Date:** 2026-11-13  
**Status:** Research note (public materials; not partner diligence)  
**Question behind this:** Can we be the safer Link/proof layer *for* PayAngel-class apps, EduPay-class schools, and Remitly-class MTOs — not only a consumer competitor?

---

## 1. PayAngel D2MR (closest analogue)

### Product
- **D2MR = Direct-to-Merchant Remittance:** diaspora pays a **verified organisation** in Ghana, not a person who “will pay the school.”  
- Sold to senders as free/traceable business payments; sold to schools/NGOs/merchants via **PayAngel Business**.  
- Send markets named: UK, EU, US, Canada, Australia → Ghana.  
- Institution types in public materials: **schools, churches, NGOs, merchants**, donations/organisations.  
- Flow (merchant side): register Business → verification → enable collection route (Payment Links and/or D2MR) → diaspora pays → funds land in **business account/wallets** → visible in dashboard.  
- Origin story (TechCabal): diverted tuition → product bet on *where money lands*.

Sources: [D2MR page](https://payangel.com/d2mr/) · [D2MR help](https://payangel.com/help/direct-to-merchant-remittances/) · [Schools Business](https://payangel.com/business/schools/)

### Proof
- Public claim: **auto-generated PDF payment reports**, “full traceability.”  
- Merchant dashboard visibility of who paid / what for.  
- This is **payment-trace proof**, not a guarantee the school’s internal ledger posted enrolment (same limit as everyone).

### Merchants
- **Allowlisted / verified registered businesses** in Ghana — not open “pay anyone.”  
- Schools: “registered Ghanaian schools”; verification + route availability apply.  
- Exact public directory of every school is not fully scraped here; commercially it’s an onboarded set.

### ToS / licence shape (important)
From [Terms](https://payangel.com/terms-and-conditions/) (effective 29 Sep 2025):

| Item | Detail |
| --- | --- |
| UK | PAYINC GROUP LIMITED — FCA payment services **FRN 608108** |
| Ghana | PAYINC GHANA — Bank of Ghana **PSP Enhanced** |
| Also | FINTRAC MSB (CA), FinCEN MSB (US), AUSTRAC remittance dealer (AU); EEA via Belmoney white-label |
| Services listed | Remittance, FX, closed-loop wallets/QR, invoices, merchant collection, **“Aggregation services for businesses and partner remittance companies”** |
| Refunds | Generally **non-refundable once disbursed**; cancel only before payout; best-effort |
| Liability | Limited; third-party delays; user responsible for accurate recipient details |
| Prohibited | Standard AML list (arms, drugs, unlicensed MSBs, etc.) — D2MR is framed as *verified merchant*, not open goods-to-strangers |

**Read:** PayAngel is already a **licensed remittance + merchant collection stack**, and ToS language suggests they *aspire* to aggregate for **partner remittance companies** (wholesale-ish). That makes them both **comp** and potential **channel** — or a competitor for the “sell to Remitly” slot in Ghana.

### Gaps vs our Link thesis
- Geography: **Ghana-strong**, not NG Remita/EduPay depth.  
- Public materials emphasise **organisation as recipient** more than a crisp **payer↔student↔school Link code** product (student ID exists in narrative/TechCabal; Link graph as wholesale API for Remitly is not their front door).  
- They own consumer + Business brand; less “Switzerland infrastructure only.”

---

## 2. Vybe UX tear-down (Kenya)

**Positioning:** “Don’t send money. Send what actually happens.” Purpose-locked merchant-direct via **M-Pesa paybill/till**.

### Purpose lock
- Categories: school fees, grocery voucher (Naivas/Carrefour/Quickmart), medical (SHA/NHIF), building materials, MMF, utilities (Kenya Power), rent, university paybill.  
- Mechanism: money → **locked voucher / paybill / till** — “never touches hands.”  
- Claim: any merchant with M-Pesa paybill/till can receive (Kenya formal economy leverage).

### Receipt / proof
- “Real-time receipt to your phone.”  
- Merchant lands voucher; recipient notified.  
- Not framed as school SIS posting — framed as **rail confirmation**.

### Funding
- USDC/USDT (~1%, 25 min lock) or Visa/Mastercard.  
- Licensed partners convert → KES settle.  
- Beta: fee-free early access claim on site.

### UX strengths
- Extremely clear anti-Remitly story.  
- Voucher mental model is intuitive.  
- Broad purpose catalog in one app.

### UX / model risks
- Kenya-specific (paybill/till).  
- “Any paybill” can reintroduce **merchant quality** risk unless they verify merchants hard (site is optimistic).  
- Stablecoin funding = compliance/UX friction for mainstream UK parents.  
- Stats on homepage (67% misuse) — treat as marketing until sourced.

Source: [vybe.ke](https://vybe.ke/)

---

## 3. Ékié UX tear-down (Cameroon — launching)

**Positioning:** “Trust infrastructure for African families” / “Send outcomes, not just cash.”

### Purpose lock
- School fees (first to launch): direct to school + receipt.  
- Broader: Skip-the-queue pre-order, bookings, Akao contributions, marketplace goods with **QR pickup**.  
- Care Circles (shared family pay) — roadmap.

### Receipt / proof
- Marketplace: **escrow at CinetPay** until family picks up with QR; photo confirmation; refund if no pickup. **Stronger consumer protection** than classic remittance.  
- School fees: “real receipt”; school partner form for bursars.  
- They state Ékié **never touches money** — partner holds.

### Funding
- Local: MoMo / cards / bank.  
- Diaspora: international cards (USD/EUR/GBP) via **CinetPay** (BEAC compliance claim).

### UX strengths
- Narrative + escrow/QR is best-in-class for **goods**.  
- School partnership CTA built in.  
- Multi-product family OS (not only fees).

### Risks
- Still **pre/early launch** (Cameroon).  
- Escrow model is heavier ops than bill tokens.  
- Not an MTO-wholesale API story yet.

Source: [myekie.com](https://www.myekie.com/)

---

## 4. NG school stack — what each “guarantees”

### EduPay — how the “guarantee” actually works

**They do not insure that “fees bought a school place” or that a bursar won’t argue.**  
They guarantee a **narrow payment attribution loop**:

1. School connects **its own Flutterwave merchant account**.  
2. EduPay **never holds** school funds.  
3. Each student gets a **dedicated virtual account**.  
4. Parent transfers to that VA → Flutterwave webhook → marked paid for that student → **digital receipt** in portal.

So the guarantee is: **“NGN that hit this student’s VA settled to the school’s Flutterwave account and we recorded it.”**  
Not: UK collect, diaspora FX, multi-payer Link policy, Remitly embed, or legal guarantee against social-engineering (“bursar said use this personal account”).

Public scale on site (small): ~28 schools, ~1.2k students — density still early.

Source: [edupay.com.ng](https://edupay.com.ng/)

### Slimpay
- Schools browse/register; fee categories; checkout (card/bank); remits to school; platform fee example in API docs.  
- Also general **billers marketplace** (airtime, electricity, cable…).  
- Closer to **NG bill + school OS**; diaspora/UK not the core story.

### Paystack for Schools
- Payment methods infrastructure for schools/SIS builders.  
- **Pipe**, not diaspora Link product. Partner, don’t rebuild.

### Remita (RRR) — strongest “purpose reference” pattern in NG public sector
- School/portal generates **unique RRR** for a specific payment to a specific beneficiary/purpose.  
- Payer pays against RRR; Remita issues receipt; school reconciles same code.  
- Harder to divert than “send to uncle.”  
- Diaspora still struggles with **funding GBP → pay RRR** UX; guides say pay school/Remita directly in NGN.  
- Remita exposes **Biller APIs** for platforms to generate/process RRRs — wholesale *rail*, not remittance brand.

**Partner vs rebuild**

| Layer | Partner | Rebuild? |
| --- | --- | --- |
| Student VA / school Flutterwave | EduPay / school’s Paystack | No — integrate |
| Public uni RRR | Remita Biller API | No — integrate |
| Private school fee schedules + portal | Slimpay / EduPay / SIS | Prefer partner; rebuild only if contracts demand |
| **Payer↔student↔school Link + multi-payer + UK GBP + MTO API + proof standard** | Nobody owns cleanly | **Build** |
| Bill tokens (NEPA, DSTV) | Flutterwave Bills / VTpass | Adapter only |

---

## 5. Who sells wholesale to Remitly-class?

| Layer | Who sells to big MTOs today | Gap |
| --- | --- | --- |
| Cash pickup / bank / MM payout | Thunes, TerraPay, local banks, MNOs | Commodity last-mile |
| Bill catalogs | Flutterwave, VTpass-class, Onafriq | Tokens, not Link graph |
| Remita billers | Remita | NG public/gov-heavy |
| Purpose/D2MR consumer brands | PayAngel, Vybe, Ékié | Vertical apps; not Remitly’s silent infrastructure |
| **Compliance-grade PURPOSE_SETTLEMENT API** (allowlist + Link + proof SLA) | **Still looks open** | Your wedge |

PayAngel ToS *lists* aggregation for partner remittance companies — treat as **signal they want this seat in Ghana**. Diligence: do they actually power another MTO today, or is it aspirational?

Flutterwave already powers EduPay under the hood — they could productise “schools for remittance partners.” That’s the **biggest structural threat**, not PayAngel’s brand.

---

## 6. Can we be a provider *for* these players?

**Yes — that’s often a better company than out-consuming them.**

| Player | What they have | What they still need | How you supply |
| --- | --- | --- | --- |
| **EduPay / Slimpay** | School graph, student VA, local receipts | UK/EU collect, diaspora UX, multi-country payers, MTO distribution, scam-hardened Link policy | You = **cross-border + Link + wholesale**; they = school OS |
| **PayAngel** | Licences, D2MR, Ghana merchants, PDF proof | NG Remita/EduPay density; maybe pure infra posture | Partner on NG; or compete in GH; or white-label their D2MR into Remitly (hard) |
| **Vybe** | Purpose UX, paybill mental model | Non-Kenya corridors; card-primary diaspora | You supply NG institution adapters |
| **Ékié** | Escrow/QR trust UX | Launch scale; school density | School Link network as backend |
| **Remitly / WorldRemit** | Customers, GBP, risk teams | Closed purpose rail without becoming marketplace | Your API as `PURPOSE_SAFE` destination type |

**Recommended posture:**  
**Network/control plane** (Links, KYB standards, proof schema, dispute SLAs) + **adapters** (Remita, Flutterwave Bills, EduPay/VA, paybill) + **sell up** to MTOs and **sell across** to EduPay-class as “diaspora and multi-payer module.”

You are not replacing EduPay’s guarantee — you **compose** it:

```
Remitly collects GBP
  → your Link resolves student@school
  → adapter pays EduPay VA / Remita RRR / school biller
  → proof = {link_id, RRR or VA credit, provider refs, PDF}
```

EduPay guarantees **local attribution**.  
You guarantee **who was allowed to pay whom for what**, cross-border, with an allowlist Remitly’s risk team can underwrite.

---

## 7. What EduPay does *not* solve (your wedge)

1. Payer in UK funding in GBP with remittance-grade UX  
2. Binding **multiple diaspora payers** to one student with permissions  
3. Stopping “pay this personal account, school is down” social engineering (needs allowlist + Link only)  
4. Standard proof object MTOs can show natively  
5. One API across schools *and* utilities *and* insurers  
6. Selling that as wholesale compliance product  

---

## 8. Practical next diligence (nashe)

1. PayAngel Business sandbox / partner call: do they already aggregate for other MTOs? NG roadmap?  
2. EduPay / Slimpay partner terms: API access, revenue share, school data rights.  
3. Remita biller API access requirements for a UK fintech.  
4. Flutterwave: any “remittance × schools” partner programme (threat monitor).  
5. Tear down PayAngel + Vybe apps as a customer (PDF proof samples, merchant picker, failure states).

---

## 9. Bottom line

- **PayAngel** = licensed D2MR competitor/peer (Ghana); already flirts with remittance-partner aggregation.  
- **Vybe / Ékié** = UX north stars for purpose lock + receipt/escrow; corridor-local.  
- **EduPay** = “guarantee” = **Flutterwave VA → school merchant webhook**, not outcome insurance — **partner it**.  
- **Remita** = purpose-bound RRR standard — **integrate**.  
- **Wholesale to Remitly-class** still the empty chair; PayAngel/Flutterwave are the ones who could sit there first if you’re slow.  
- Best strategy: **be the Link + proof control plane** that EduPay-class and MTO-class both plug into — provider *to* the industry, not only another vertical app in it.
