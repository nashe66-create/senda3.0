# Senda 4.0 — Brief

**Senda** is **B2B infrastructure for verified purpose payments** — not a remittance app competing with Remitly on FX.

## Problem

Diaspora money for school fees, medical costs, and bills usually lands as **P2P**, then someone local pays the institution — causing diversion, fake-account fraud, bursar reconciliation pain, and no proof the obligation was settled. MTOs are adding business/bill pay but still lack a **trusted allowlisted network of institutions + beneficiaries (Links)** with validation, payment references, and recon proof — without becoming a marketplace or running bursar ops.

## Solution (one sentence)

A network that lets remittance providers (and later institutions) pay a real obligation — school fee, utility, hospital, policy — against a **verified biller + beneficiary Link**, with validation, payment references, reconciliation, and proof.

## Surfaces

| Surface | Who buys | What they get |
| --- | --- | --- |
| **Senda Connect** | Remitly, Wise, Mukuru, Flutterwave Send, banks | API: look up biller/student, get pay instructions, confirm settlement, recon + receipt |
| **Senda Biller** | Schools (then utilities, clinics…) | KYB, student/account Links, payment refs, portal, proof |
| **Senda Network** | Density between the two | Shared directory of verified institutions + live Links |

## How it works (school fees)

1. School joins **Biller** (KYB + students) → Senda creates **Link** `payer ↔ student ↔ school` + payment reference.  
2. Mum pays in **Remitly** (or Wise/Mukuru); Remitly calls **Connect** to validate bill and get pay instructions/ref.  
3. Remitly moves money on **their** rails (or bank/PSP last mile if needed) into the school account with Senda’s ref.  
4. Senda reconciles confirmation → marks paid → **proof** to mum, school, and Remitly.  

Senda is invisible to mum; owns directory, Link, ref, recon, proof. Pilot can start with 5–10 schools and bank refs before a Remitly embed.

## First ship

**UK → Nigeria school fees:** onboard a small set of schools → Link payer ↔ student ↔ school → MTO (or direct bank) pays with Senda’s reference → Senda reconciles and issues proof.

## Architecture

**Connect = instruction + proof.** Senda owns identity, validation, refs, recon, proof. **Prefer avoid adaptor-as-payer** — MTO keeps collect/FX/payout; EcoCash/Flutterwave-class adapters are rare last-mile or status only. Provider-agnostic by design.

## Legacy prototype (repo)

An Expo/RN **grouped remittance** consumer app (plans, recipients, Fincra/Flutterwave money path) still exists as possible dogfood/channel — not the company thesis. See [project-context.md](./project-context.md).

## Spec

Working product spec: [product/product-spec.md](./product/product-spec.md).

## Status

Thesis and architecture locked (2026-11-13). Product spec v0.1 ready for nashe review (§17 dogfood / Link binding). School cold-start and design-partner conversations not yet fielded. Not ready for live customer funds.
