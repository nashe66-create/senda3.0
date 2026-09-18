# Senda — Alternative Payment Rails & Infrastructure Scan
## September 2026

## Why this research exists

Senda should not assume the final architecture is Flutterwave plus the application. The product requirement is broader: UK customer collection → compliant funding/settlement → FX/treasury → multiple independently tracked recipient payouts → bank/mobile-money delivery → reconciliation.

The market appears to be separating into traditional PSPs, African payment orchestration, stablecoin-funded African payout infrastructure, settlement networks and local/regional rail providers. This means Senda may not need one provider to do everything.

## Highest-priority discoveries

### 1. Eversend — P0 investigation
Eversend Platform exposes African payouts, collections, FX and stablecoin settlement APIs. Its documentation says it can pay out to bank and mobile-money rails in 18 countries, fund from USDC/USDT, and provide remittance APIs. Its disbursement API supports batch payouts with mixed rails, per-item statuses, failure reasons and webhooks. This maps unusually well to Senda's grouped-order model.

Key question: can a UK-originating consumer remittance business use Eversend commercially and under what licensing/partner structure?

### 2. Zynta — P0/P1
Zynta markets Africa–EU cross-border payment infrastructure as a white-label API, including compliance, FX and last-mile delivery. It states that its rails have processed more than $300m across Africa–EU corridors.

Key question: can Senda use Zynta for UK/EU → Nigeria consumer remittances and multiple payout instructions within one order?

### 3. NuevoPay — P0/P1
NuevoPay offers African collections and payouts, bank/mobile-money rails, batch payouts, stablecoin settlement and fiat settlement through Faster Payments, SEPA and SWIFT. It markets white-label infrastructure to PSPs and remittance companies and exposes signed webhooks and idempotent API operations.

Key question: whether its UK collection/funding and Nigeria payout model is available to Senda.

### 4. Yellow Card API — P0/P1
Yellow Card's API supports local-currency collections, bank/mobile-money payouts, FX, transaction status, KYC and stablecoin settlement. This makes it potentially useful as a settlement/payout layer even if it is not the customer-facing remittance provider.

Key question: UK onboarding, regulatory structure and current UK→Nigeria commercial availability.

### 5. Passpoint — P1
Passpoint describes itself as a financial orchestration layer across Africa, Europe and G20 markets, supporting collections, payouts, multi-currency accounts and remittance use cases. It could potentially provide provider abstraction beneath Senda.

Key question: whether the required UK customer pay-in and settlement structure is actually live for Senda's use case.

## Additional candidates

- **Fiatsend** — stablecoin-funded African payout API with bank/mobile-money delivery, compliance, webhooks and audit trail. Particularly interesting for the payout leg.
- **Payfonte** — African payment orchestration across 22+ markets with routing, failover and reconciliation; potentially useful as a provider-abstraction layer.
- **Blaaiz** — payouts, collections, virtual accounts, stablecoin rails and FX for fintechs/remittance apps.
- **EverydayMoney** — Africa payout API, local-currency settlement, mass payouts and liquidity.
- **Borderless** — emerging orchestration/liquidity network; UK/EU→Nigeria is listed as a planned corridor, so do not treat it as live infrastructure yet.
- **WaftPay** — collections, payouts and licensed cross-border corridors with audit trails; currently more relevant to East Africa.
- **SurgePay** — Stellar-based stablecoin/remittance and wallet infrastructure; useful ecosystem signal but needs commercial/infrastructure clarification.
- **Diameter Pay** — programmable global/local payments and compliance automation; needs corridor and startup-access verification.
- **DusuPay** — established African payment/remittance infrastructure with high-volume payouts; useful benchmark despite being less of a new startup.

## Stellar — the bigger architectural lesson

Stellar itself should not necessarily be treated as another PSP. It is a settlement/interoperability network with an anchor model.

Stellar defines SEP-24 for fiat on/off-ramp interaction and SEP-31 for anchor-to-anchor cross-border payments. SEP-31 is conceptually close to Senda because the customer can remain inside the originating application while regulated anchors exchange the necessary payment and compliance information in the background.

The research question therefore changes from “which provider can Senda use?” to:

**What is the simplest compliant combination of collection, settlement and payout rails that can produce the Senda customer experience?**

## Architecture hypotheses

### A — Traditional PSP
UK collection → Flutterwave → African payout

### B — African payout infrastructure
UK collection → settlement → Eversend / Passpoint / NuevoPay → bank/mobile money

### C — Stablecoin settlement
UK collection → GBP→USDC/USDT → stablecoin settlement → African payout API → local currency

### D — Stellar anchor network
UK fiat → Stellar anchor → Stellar/USDC → Nigerian anchor → NGN bank/mobile money

### E — Hybrid
UK collection → regulated collection partner → Senda order/ledger → stablecoin or fiat settlement → African payout infrastructure → individual recipients

Architecture E is worth serious investigation because Senda may not need one provider to supply every component.

## Current investigation shortlist

### Tier 1
1. Eversend
2. Zynta
3. NuevoPay
4. Yellow Card
5. Passpoint

### Tier 2
6. Fiatsend
7. Payfonte
8. Blaaiz
9. EverydayMoney

### Tier 3 / emerging
10. Borderless
11. WaftPay
12. SurgePay
13. Diameter Pay

## Evaluation framework

For every provider, record:

1. UK entity/customer eligibility
2. UK collection methods
3. UK regulatory/licensing structure
4. Nigeria payout rails
5. Other Senda target corridors
6. Bank/mobile-money coverage
7. Stablecoin funding/settlement
8. FX quote and lock mechanism
9. Batch/multiple-recipient support
10. Per-recipient status and webhooks
11. Idempotency and reconciliation
12. KYC/KYB/AML responsibilities
13. Safeguarding/custody model
14. Settlement timing
15. Pricing and FX spread
16. Sandbox/API documentation
17. White-label capability
18. Whether consumer remittance use is permitted
19. Commercial minimums
20. Whether Senda could use the provider without becoming the regulated funds-transfer operator itself

## Current working conclusion

Eversend is the first provider to investigate deeply because its public API model combines stablecoin funding, FX, African payout rails, batch disbursement, per-recipient status and remittance infrastructure. That does not mean Senda should choose it. It means it provides a strong test of whether the infrastructure layer we have been looking for already exists in a form that matches Senda's architecture.

Stellar remains important as a network/settlement architecture rather than simply another PSP.

## Source register

- Eversend Platform/API: https://eversend.co/platform/apis
- Eversend disbursement API: https://eversend.co/platform/apis/disbursements
- Eversend remittance infrastructure: https://eversend.co/platform/for/remittance
- Zynta: https://zynta.com/api-services/
- Passpoint: https://www.mypasspoint.com/solutions/fintech
- Passpoint unified API: https://www.mypasspoint.com/products/unified-api
- Payfonte: https://www.payfonte.com/
- EverydayMoney: https://everydaymoney.eu/
- Fiatsend: https://fiatsend.com/
- NuevoPay: https://nuevopay.co/
- WaftPay: https://waftpay.io/
- Blaaiz: https://www.blaaiz.com/
- DusuPay: https://www.dusupay.com/octopus
- Yellow Card API documentation: https://help.yellowcard.io/articles/8999093541-api-documentation
- Stellar anchors: https://developers.stellar.org/docs/learn/fundamentals/anchors
- Stellar cross-border SEP-31/SEP-24 overview: https://stellar.org/blog/ecosystem/fiat-on-off-ramps-and-cross-border-payments-on-stellar
- Stellar ramps: https://stellar.org/use-cases/ramps
- Diameter Pay: https://diameterpay.com/
- SurgePay: https://surgepay.tech/
- Borderless: https://www.goborderless.co/
