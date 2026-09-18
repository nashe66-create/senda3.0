# Senda Customer Research — Evidence Gap
## 18 September 2026

### What secondary research now establishes

- The UK→Nigeria corridor is commercially active and highly competitive.
- The Nigerian diaspora in England and Wales is substantial: 270,768 usual residents were born in Nigeria in the 2021 Census. UK-wide standard census figures are not yet available as one consistent series. [ONS]
- Current consumer providers already offer bank deposit, cash pickup and/or mobile-wallet delivery, with fast delivery and competitive pricing. Remitly currently advertises bank deposit, cash pickup and mobile wallet for Nigeria and guaranteed delivery messaging. [Remitly]
- World Bank RPW data for UK→Nigeria was collected 8–22 August 2025 and measures total cost as sender fee plus FX margin. Provider-level costs vary materially. [World Bank]
- Nigeria's regulatory environment is active. The CBN's March 24 2026 update reminded IMTOs that remittance transactions and beneficiary settlements must use designated naira settlement accounts with authorised dealer banks. [CBN]
- New payment infrastructure providers can technically support parts of Senda's desired architecture. Eversend currently advertises batch payouts with mixed rails, per-item status/failure, webhooks, idempotency, Nigeria NIP and just-in-time stablecoin funding. [Eversend]

### What we still do NOT know

Public sources do not reliably establish:

1. What proportion of UK→Nigeria remitters regularly support 2+ recipients.
2. The typical number of recipients per remitter.
3. How many separate transfers a multi-recipient remitter makes in a normal month.
4. Whether these payments represent recurring commitments (rent, school fees, bills, household support, family allowances, etc.).
5. Whether customers currently track these commitments manually, in banking apps, WhatsApp, notes, spreadsheets or memory.
6. Whether the administrative burden is painful enough to make a grouped-transfer product materially better than using existing providers multiple times.
7. Whether users prefer one customer payment while retaining independent recipient-level tracking.
8. Whether users would trust Senda to manage several recipient payouts as one grouped order.

### Evidence gap conclusion

The single most important missing evidence is **multi-recipient behaviour among UK→Nigeria remitters**.

We should not build a large survey. The correct next step is a short behavioural survey followed by 5–10 interviews with qualifying remitters.

### Next action

Run a 9–10 question behavioural survey targeted at people in the UK who have sent money to Nigeria in the last 3–6 months. Ask about actual recent behaviour before showing the Senda concept.

The first survey should not lead with Senda or ask respondents to price the product. It should establish the problem first.

### Suggested screening criterion

Primary cohort: UK residents who personally sent money to Nigeria within the last 3–6 months.

Optional comparison cohorts: recent UK→Kenya and UK→Ghana remitters, only if recruitment makes this practical.

### Sources

- ONS, Nigerians in the UK: https://www.ons.gov.uk/aboutus/transparencyandgovernance/freedomofinformationfoi/nigeriansintheuk
- World Bank Remittance Prices Worldwide, UK→Nigeria: https://remittanceprices.worldbank.org/corridor/United%20Kingdom/Nigeria
- CBN reforms and diaspora-remittance update: https://www.cbn.gov.ng/AboutCBN/Reforms.html
- CBN licensed IMTOs: https://www.cbn.gov.ng/PaymentsSystem/InternationalMoneyTransferOperators.html
- Remitly UK→Nigeria: https://www.remitly.com/gb/en/money-transfer/send-money-to-nigeria
- Eversend disbursement API: https://eversend.co/platform/apis/disbursements
