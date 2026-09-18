# Senda — Alternative Payment Infrastructure Due Diligence Report
## 18 September 2026

## Executive summary

We investigated payment infrastructure options outside the previously reviewed Currencycloud, Airwallex, Thunes and TerraPay. The research supports a different way of thinking about Senda's architecture: Senda does not necessarily need one provider that performs collection, FX, settlement and every recipient payout. It may be possible to combine a UK collection/regulatory layer with an African payout/orchestration or settlement layer.

The strongest new candidate for technical fit is **Eversend Platform**. Its current public API documentation describes batch payouts with mixed rails, per-item status and failure reasons, webhooks, idempotency, FX quotes and African bank/mobile-money coverage. Nigeria is supported through NIP bank transfer, including fintech accounts that sit on bank rails. Eversend also publishes business/global-account and stablecoin funding capabilities. This is unusually close to Senda's existing Grouped Transfer → individual Transfer architecture.

The strongest alternative architectural candidates are:

1. **Eversend** — best technical fit for the payout/disbursement problem.
2. **Zynta** — strongest Africa-EU stablecoin/fiat infrastructure fit and potential UK/Africa collection + settlement layer.
3. **NuevoPay** — interesting all-in-one African collection/payout + stablecoin/fiat settlement model.
4. **Yellow Card** — strong stablecoin-to-local-fiat infrastructure option, especially as a settlement/payout layer.
5. **Passpoint** — orchestration layer potentially connecting UK/open-banking collection with African payout rails.
6. **Payfonte** — African provider orchestration and failover layer, potentially useful once Senda has multiple payout providers.

This research does **not** establish that any provider is legally or commercially available for Senda's exact UK consumer-remittance model. FCA guidance remains the controlling UK question: if Senda receives customer money before passing it to another party, it may be providing regulated payment services/money remittance and would need the appropriate authorisation/registration or a legally valid structure with an authorised provider.

---

## 1. Eversend — highest priority

### What the public infrastructure shows

Eversend currently describes itself as an African payment infrastructure provider covering collections, payouts, FX and settlement. Its platform says it supports 18 payout countries, with African local rails and GBP/USD/EUR bank payouts. It exposes payout, collection, FX and stablecoin settlement APIs. [Source: Eversend Platform/API]

Its disbursement API is especially relevant to Senda. One batch request can contain multiple recipients, mixed rails and currencies; each item has its own status and failure reason; webhooks provide item and batch events; failed items can retry without blocking successful items. [Source: Eversend Disbursement API]

### Nigeria

Eversend's Nigeria payout API uses NIP bank transfer and states that it reaches every Nigerian bank and fintech wallet built on those bank rails, including OPay, Kuda and Moniepoint. It reports a 57-second median delivery time over the last 90 days of production transfers and 91% within five minutes. The API performs account-name checking before the payout is committed. [Source: Eversend Nigeria rail]

### Senda fit

Very high. Senda already has the concept of a Grouped Transfer containing multiple individual Transfers. Eversend's batch model could potentially sit underneath this without forcing Senda to redesign its customer-facing product.

### Pricing

Eversend currently publishes a flat NGN 58 bank-transfer payout fee on its platform pricing/API pages. It also publishes a 0.9%+ FX margin on its general pricing page, but platform pricing can differ and must be confirmed during onboarding. [Sources: Eversend Pricing; Eversend Nigeria rail]

### Funding / settlement

Eversend says platform payouts can be funded from a balance and USDC/USDT, with just-in-time funding described across its API materials. Its Nigeria page currently describes balance or USDC funding, while the same page labels just-in-time USDC-to-NGN funding as coming soon; this distinction must be clarified commercially. [Sources: Eversend API; Eversend Nigeria]

### Regulatory position

Eversend's own business page says its regulated entities include Cogni Labs Ltd in Uganda, Eversend Tech Ltd registered as an MSB in Canada and Eversend Inc. registered as an MSB in the US, and says it is authorised for inbound/outbound remittances in Kenya and inbound remittances in Zambia. This does not by itself establish UK authorisation or UK consumer-remittance permissions. [Source: Eversend Business Payouts]

### Key unanswered questions

- Can a UK company onboard specifically for UK-originating consumer remittances?
- Which Eversend entity contracts with Senda?
- Does that entity hold the permissions required for the UK collection/remittance leg?
- Can Senda collect GBP into an Eversend business balance, rather than merely pay out from one?
- Is USDC funding available in production for Senda's exact Nigeria flow, or is the NGN page's JIT feature still pending?
- Can a single customer-funded Senda order be represented as multiple compliant payout instructions?
- What KYB/KYC and transaction-monitoring responsibilities remain with Senda?
- What are platform/enterprise FX and payout fees at pilot volume?

**Assessment: P0 — contact immediately.**

---

## 2. Zynta — strongest Africa-EU stablecoin/fiat candidate

Zynta currently markets an Africa-EU cross-border payment API with white-label access, FX, virtual accounts, last-mile delivery and built-in KYC/KYB/AML screening. It says it supports GBP, USD, EUR, NGN and stablecoin settlement, including named virtual accounts and fiat-to-crypto/crypto-to-fiat conversion. It describes itself as a registered Money Services Business and says it holds VASP licensing across EU and African jurisdictions. [Sources: Zynta API; Zynta FAQ; Zynta site]

Zynta's public site currently advertises a 0.5% transfer fee and its individual FAQ says external transfers are charged at a flat 0.5%. This is a public indicative figure, not a Senda enterprise quote. [Source: Zynta Individuals]

### Senda fit

Potentially very high if Zynta can provide a UK-facing collection/settlement structure and Nigeria last-mile payout. The architecture is more comprehensive than a simple payout API because it combines collection, virtual accounts, FX, stablecoin settlement and last-mile delivery.

### Key unanswered questions

- What exact UK legal entity/licence covers GBP collection for a UK customer base?
- Is Zynta authorised/registered in the UK, or would a regulated UK partner be required?
- What exactly is meant by its "VASP licensing across EU and African jurisdictions" and which entities hold those permissions?
- Can Senda use its virtual accounts for consumer remittance funding?
- Can one Senda order produce several Nigeria payouts?
- Are recipient-level webhooks and idempotency available?
- What NGN payout rails are live in production?

**Assessment: P0/P1 — strong partnership candidate, but regulatory verification is essential.**

---

## 3. NuevoPay — strong African collection/payout and settlement candidate

NuevoPay currently markets one API for African collections and payouts across 14 markets. It supports bank and mobile-money payouts, single and batch payouts, per-payout tracking, signed webhooks, idempotent requests and a double-entry ledger. It states that settlement can occur in USDC/USDT or through Faster Payments, SEPA and SWIFT. It explicitly targets PSPs, remittance companies and marketplaces and offers white-label rails. [Source: NuevoPay]

Coverage includes Nigeria, Kenya, Tanzania, Uganda, Rwanda, Ghana, Zambia and South Africa among its listed markets.

### Senda fit

Potentially high. The combination of batch payout, African rails and UK/EU settlement channels is close to what Senda needs.

### Main uncertainty

The public site is strong on African collections/payouts but does not establish that a UK company can originate consumer remittances into Nigeria through the exact desired structure. The regulatory allocation between NuevoPay and Senda must be confirmed.

**Assessment: P0/P1.**

---

## 4. Yellow Card — stablecoin settlement/payout infrastructure

Yellow Card's API is explicitly designed for businesses integrating stablecoin-powered payment infrastructure. It supports sending to bank accounts and mobile-money wallets, receiving local-currency payments, real-time FX, transaction history/status, KYC submissions and direct crypto settlement. Yellow Card markets the API to fintechs, banks, corporates, crypto businesses and telcos, including international remittances. [Sources: Yellow Card API; API documentation]

Its public B2B pricing documentation covers collections and disbursements across supported countries. Yellow Card says exact current partner pricing is also governed by the partner agreement and onboarding documentation. [Source: Yellow Card pricing]

### Senda fit

High as a settlement/payout component. It is less obvious than Eversend as the complete one-stop Senda backend because we still need to establish the exact UK collection and Nigeria corridor structure.

### Key questions

- Can a UK company use the API for UK-originating consumer remittances?
- Which UK regulatory entity/partner handles GBP collection?
- Is Nigeria payout available for the exact intended use case and payout methods?
- Can one customer funding event support several payout instructions?
- How are end-user KYC/AML responsibilities divided?
- What are current NGN fees and FX spreads for platform partners?

**Assessment: P0/P1.**

---

## 5. Passpoint — potentially important orchestration layer

Passpoint positions itself as a financial orchestration layer rather than a conventional PSP. Its current unified API covers collections, payouts, FX, compliance and monitoring across Africa, Europe and G20 markets. It claims 35+ countries, 30+ payment methods and 7m+ transactions processed. [Sources: Passpoint Unified API; Passpoint site]

A particularly important discovery is its public statement that it connects UK open-banking rails with African mobile-money, bank-transfer and other local methods. Its 2026 open-banking article specifically describes the use case of African-facing businesses collecting from European/UK customers and paying into African markets. [Source: Passpoint Open Banking]

### Senda fit

Potentially very high architecturally. Instead of Senda integrating card collection plus multiple African payout providers, Passpoint could potentially sit underneath the whole operation.

### Key questions

- Is UK open-banking collection live for Senda's business type?
- Can Senda collect GBP and then initiate multiple Nigerian payouts?
- Who is the regulated payment service provider for each leg?
- Can Passpoint hold/settle customer funds or is it purely orchestration?
- What Nigeria payout rails are available?
- How does it price FX and payout transactions?

**Assessment: P1, potentially P0 after a commercial call.**

---

## 6. Payfonte — provider abstraction and failover

Payfonte is interesting for a different reason. It is an African payment orchestration layer covering 22+ markets and connects M-Pesa, MTN MoMo, Airtel Money, Moov, banks, cards and other providers. Its model supports smart routing, failover and central reconciliation. It also supports hybrid orchestration: a fintech can retain its own provider contracts while using Payfonte's integrations where it lacks coverage. [Sources: Payfonte; Payfonte About]

### Senda fit

Potentially excellent later in the architecture. Senda could eventually have:

Senda → Payfonte → Flutterwave / MNO / local PSP / other provider

rather than hard-coding a single African payout relationship.

### Limitation

It appears more Africa-focused than UK→Africa-focused, so it is not obviously the complete solution for the UK collection leg.

**Assessment: P1 as an orchestration/failover candidate.**

---

## 7. Fiatsend — useful but currently narrower

Fiatsend's public developer documentation currently describes an API for instant stablecoin-to-mobile-money payouts in Ghana, converting USDC/USDT to GHS and delivering to MTN MoMo, Telecel Cash and AirtelTigo Money. It offers sandbox and production APIs with real-time webhooks. [Source: Fiatsend Developer API]

### Senda fit

Interesting as a specialised payout component, particularly for Ghana. It does not currently look like the best answer for the UK→Nigeria pilot because the public API documentation is specifically focused on Ghana mobile money.

**Assessment: P2 for current pilot; keep on Ghana infrastructure watchlist.**

---

## 8. Blaaiz — potentially useful African infrastructure

Blaaiz markets a single API with payouts, collections, virtual accounts, stablecoin rails and FX for fintechs, remittance apps and marketplaces. Its API documentation includes NGN bank transfer payouts, customer verification, webhooks and business wallets. [Sources: Blaaiz; Blaaiz payout API]

### Senda fit

Potentially high on the African infrastructure side, particularly Nigeria. However, the public material does not yet establish the UK collection/regulatory structure needed by Senda.

**Assessment: P1/P2 pending UK/corridor verification.**

---

# Comparative view

| Provider | UK collection | Nigeria payout | Multi-payout/batch | Stablecoin settlement | Orchestration | Senda fit now |
|---|---|---|---|---|---|---|
| Eversend | Needs confirmation | Yes, NIP | **Yes** | **Yes** | Medium | **Very high** |
| Zynta | **Potentially** | Corridor needs confirmation | Needs confirmation | **Yes** | High | **Very high** |
| NuevoPay | Settlement via FPS/SEPA/SWIFT; exact UK collection needs confirmation | **Yes** | **Yes** | **Yes** | Medium | **High** |
| Yellow Card | Needs confirmation | Supported API concept; exact route needs confirmation | Needs confirmation | **Yes** | Medium | **High** |
| Passpoint | **UK/open banking claimed** | **Yes / African coverage claimed** | Needs confirmation | Yes/USDT shown | **Very high** | **High** |
| Payfonte | Not obvious | African rails | Provider-level | Not core | **Very high** | Medium-high |
| Blaaiz | Needs confirmation | **Yes** | API payout; batch claim on site | **Yes** | Medium | Medium-high |
| Fiatsend | No public evidence | Ghana focus | No evidence for Nigeria | **Yes** | Low | Low for current pilot |

"Needs confirmation" means the public material found in this research was insufficient; it is not a finding that the capability does not exist.

---

# The architecture we should now test

The research changes Senda's architecture question.

Instead of:

**Senda → Flutterwave → recipients**

we should test at least four structures:

### Model 1 — PSP-led
UK collection → regulated PSP → African payout network

### Model 2 — African infrastructure-led
UK collection → settlement → Eversend/NuevoPay/Passpoint → Nigerian payouts

### Model 3 — stablecoin settlement
UK collection → regulated conversion/settlement provider → USDC/USDT → African payout API → NGN

### Model 4 — orchestration
UK collection → Passpoint/other orchestration layer → multiple African payout providers → recipient rails

Senda should remain the customer/product layer and maintain the canonical Grouped Transfer and individual Transfer records regardless of which infrastructure provider executes the money movement.

---

# Critical regulatory conclusion

No provider in this research should be treated as proof that Senda itself can legally operate UK consumer remittances without authorisation or a suitable regulated-partner structure.

The FCA states that money remittance is a payment service and that a business receiving customer money before passing it to another party may be providing a regulated payment service. Providing payment services as a regular business activity generally requires the appropriate FCA authorisation/registration unless an exclusion or another permitted structure applies. [FCA]

Therefore, for every provider, Senda must establish:

1. Which legal entity receives the customer's GBP.
2. Which entity performs the regulated payment service.
3. Where customer funds are safeguarded.
4. Which entity performs KYC/KYB and transaction monitoring.
5. Whether Senda is an agent, technical service provider, merchant, programme manager or principal.
6. Which entity executes the Nigerian payout.
7. Who is responsible for refunds, failed transfers and complaints.
8. Whether Senda's grouped-order UX creates any additional regulatory implications.

This is a commercial/legal diligence item, not something we should infer from a provider's marketing language.

---

# Recommended next actions

## P0 — contact now

### Eversend
Ask for a technical/commercial call specifically about:

**UK consumer collection → one Senda Grouped Transfer → multiple Nigeria NIP payouts.**

### Zynta
Ask specifically about:

**UK GBP collection + Nigeria NGN payout + multi-recipient order + regulated entity/agent structure.**

### NuevoPay
Ask about:

**UK-originating remittance funding + Nigeria payout + batch disbursement + stablecoin/FPS settlement.**

### Yellow Card
Ask about:

**UK-originating consumer remittance + Nigeria payout + stablecoin settlement + end-user KYC responsibilities.**

## P1 — architecture discussions

- Passpoint
- Payfonte
- Blaaiz

## P2 / watchlist

- Fiatsend
- Borderless
- WaftPay
- SurgePay
- Diameter Pay

---

# What this means for Senda

The most important conclusion is not that we have found a replacement for Flutterwave.

We have found evidence that **Senda's underlying infrastructure can potentially be decomposed into separate layers**.

That matters because Senda's unique value is not moving money itself. The differentiated product is the **organisation of the customer's financial commitments**:

**One Remittance Order → one customer funding event → multiple recipient Transfers → individual status/reconciliation.**

If an infrastructure provider can execute the individual Transfers reliably, Senda may not need to own the entire payments stack.

The next step should therefore be provider calls/sandbox tests rather than another broad market scan.

## Primary sources

- Eversend Platform/API: https://eversend.co/platform/apis
- Eversend Disbursements: https://eversend.co/platform/apis/disbursements
- Eversend Nigeria payout: https://eversend.co/platform/coverage/nigeria
- Eversend pricing: https://eversend.co/pricing?level=business&region=ng
- Eversend business/regulatory information: https://eversend.co/business/payouts
- Zynta API: https://zynta.com/api-services/
- Zynta: https://zynta.com/
- Zynta FAQ: https://zynta.com/faq/
- Zynta pricing: https://zynta.com/for-individuals/
- NuevoPay: https://nuevopay.co/
- Yellow Card API: https://yellowcard.io/api
- Yellow Card API documentation: https://help.yellowcard.io/articles/8999093541-api-documentation
- Yellow Card pricing: https://help.yellowcard.io/articles/8792393400-supported-payment-methods-and-associated-fees-for-yellowcard-s-payment-api
- Passpoint Unified API: https://www.mypasspoint.com/products/unified-api
- Passpoint: https://www.mypasspoint.com/
- Passpoint UK/Africa open banking: https://www.mypasspoint.com/blog/open-banking-in-africa-businesses-collecting-payments-in-2026
- Payfonte: https://www.payfonte.com/
- Blaaiz: https://www.blaaiz.com/
- Blaaiz payout API: https://docs.business.blaaiz.com/api-reference/payout/create-a-payout
- Fiatsend API: https://developer.fiatsend.com/
- FCA payment services guidance: https://www.fca.org.uk/firms/consider-if-you-provide-payment-services
- FCA PSRs/EMRs: https://www.fca.org.uk/firms/payment-services-regulations-e-money-regulations
