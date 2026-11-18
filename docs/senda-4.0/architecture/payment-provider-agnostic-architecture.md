# Senda 4.0 — Payment-provider-agnostic architecture

Locked direction (founder framing, 2026-11-13).

---

## Two jobs (do not merge)

| Job | Owner | What it does |
| --- | --- | --- |
| **1. Purpose / obligation layer** | **Senda** | Identify biller · validate student/account · payment instructions & references · track · reconcile against the bill · exceptions / proof |
| **2. Money movement** | **Payment provider / MTO rail / bank** | Actually credit the school/institution bank or mobile-money account |

Flutterwave (or any local PSP) can help with **job 2**. It is **not** required for every transaction and must **not** be a core dependency of Senda.

---

## Who is sending money to the school?

Ask this per flow — the answer picks the route:

1. **MTO already has payout coverage** → Remitly (etc.) pays the school’s verified account via **their** rails. Senda supplies identity, validation, reference, recon. **No Flutterwave.**
2. **MTO cannot reach that biller** → local partner (Flutterwave, Paystack, bank API, etc.) fills the gap. Senda still owns job 1; partner is an optional adapter for job 2.
3. **School takes direct bank transfer** → Senda issues verified account + unique reference; recon from bank confirmation / statement match. **No intermediary required.**

---

## Recommended stack shape

```
Remitly / Wise / Mukuru / other MTOs
        │  customer, collection, FX, payment orchestration
        ▼
SENDA INFRASTRUCTURE
  biller network · validation · payment references
  reconciliation · exceptions · proof
        │
   ┌────┴────────────────────────┐
   ▼                             ▼
Existing MTO payout rails    Local PSPs (only if needed)
(already have coverage)      Flutterwave / Paystack / …
   │                             │
   └────────────┬────────────────┘
                ▼
     School / hospital / utility / biller
```

Routes are **options**, not a requirement that every payment pass through Senda *or* through Flutterwave.

---

## Principles

- **Provider-agnostic:** no single PSP controls the network.
- **Do not compete with Remitly / Mukuru** for collection / FX / orchestration.
- **Connect = instruction + proof layer (founder lock):** validate Link → return pay instructions (account/till + unique ref) → ingest confirmation → reconcile → issue proof. That is the product sold to MTOs.
- **Prefer avoid adaptor-as-payer:** EcoCash / InnBucks / Flutterwave / Paystack adapters may exist for directory, status, and recon — and only rarely as last-mile push (`senda_settles`) when the MTO cannot reach the biller. Adaptor-as-payer pulls in float, fails, refunds, and licence shape; it is **not** the core business.
- **Single settlement executor per attempt:** `mto_settles` (default) | `senda_settles` (exception) | `institution_collects`. Never two pushers to the same wallet.
- **Ingest confirmations** from MTO rails, PSPs, or direct bank/wallet credit for reconciliation.
- **Moat:** knowing exactly which institution, student, account, or obligation the money was for — and proving allocation — not moving the money.

---

## Pilot implication

**Default pilot path:** MTO (or direct bank) settles; Senda does instructions + proof. No Flutterwave / EcoCash *as payer* unless the partner explicitly needs last-mile coverage.

**Zimbabwe:** do not assume Flutterwave solves ZW bank payouts. Prefer Mukuru/Remitly existing EcoCash/InnBucks coverage + Senda refs/recon. Direct EcoCash adaptor-as-payer only as a later coverage filler after commercial/legal diligence.

---

## Competitive line

Local rails (Flutterwave, EcoCash, InnBucks, …) = **optional** money-moving or status partners.  
**Senda Connect** = **instruction + proof** — who / what / whether-paid / allocated.
