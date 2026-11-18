# Senda 4.0 — The pivot

**From:** a consumer remittance app that moves money (Senda 3.0).  
**To:** B2B infrastructure that makes **purpose payments** (school fees, then medical/utilities) verifiable, attributable, and provable — while **partners move the money**.

---

## What we were building (3.0)

- UK diaspora **grouped transfers** (one plan → N payouts)
- Senda (via Fincra/Flutterwave) handled **collect → FX → payout**
- Differentiation hoped to be multi-recipient UX, ledger, fees
- Reality: that hygiene is **not a moat** vs Remitly / WorldRemit / Mukuru

---

## What we’re building (4.0)

**Senda 4.0** = verified **purpose-settlement network**

| Surface | Buyer | Job |
| --- | --- | --- |
| **Connect** | MTOs / purpose apps (Mukuru, Remitly, Vybe, PayAngel-class, banks) | Validate institution + beneficiary → get pay instructions + ref → confirm → **proof** |
| **Biller** | Schools (then clinics, utilities…) | KYB, student Links, refs, payment visibility, receipts |
| **Network** | Density between them | Shared allowlisted institutions + Links |

**Doctrine:** Connect = **instruction + proof**. Prefer **`mto_settles`**. Avoid adaptor-as-payer / competing on FX.

---

## The problem (why pivot)

Diaspora money for school fees usually goes **person → person → institution**. That causes diversion, fake-account fraud, bursar mismatch, and no proof. MTOs are adding business/bill pay but still lack a **neutral allowlisted Link layer** (payer ↔ student ↔ school) with validation, references, and reconciliation — without becoming a marketplace or running bursar ops.

---

## What we stop owning

- Being “another Remitly” on rates/speed  
- Core dependence on Flutterwave/Fincra as the product  
- Open goods & services marketplace  
- Adaptor-as-payer as the company (float, FX, licence)

## What we start owning

- Institution KYB + directory  
- Beneficiary Links + payment references  
- Obligation validation  
- Confirmation ingest + three-way recon  
- Proof artifacts partners and schools can trust  

---

## Who moves money?

**The partner (default).** Remitly/Mukuru/Vybe collect, convert, and pay the school’s verified account/till using Senda’s instructions. Senda reconciles their confirmation into proof. Local PSPs (EcoCash, Flutterwave, etc.) are optional last-mile only if the partner cannot reach the destination — not the core business.

---

## First wedge

**UK → Nigeria private school fees**  
5–10 schools → Links → partner (or dogfood) settles with Senda ref → recon → proof.  
Then sell the same network into MTOs and purpose apps (including speeding **Vybe-class** adoption by onboarding institutions for them).

---

## One sentence

**Senda 4.0 doesn’t win by sending money cheaper — it wins by being the layer that proves the right institution and beneficiary got paid for the right obligation.**
