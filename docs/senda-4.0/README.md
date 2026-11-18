# Senda 4.0

## Note on repo location

These docs are the **Senda 4.0** product line. Canonical GitHub target is [`nashe66-create/Senda-4.0`](https://github.com/nashe66-create/Senda-4.0). Until Cloud Agent push access is granted there, this tree is checked into `senda3.0` under `docs/senda-4.0/` so the pivot and spec are versioned.

**Verified purpose-settlement network** — instruction + proof infrastructure between payment providers / purpose apps and allowlisted institutions (schools first).

> This is **not** Senda 3.0 (consumer grouped remittance prototype).  
> Senda 4.0 is the **B2B Connect + Biller** product: MTOs and apps like Mukuru / Remitly / Vybe embed us; schools onboard once; partners move the money.

## Product in one line

Validate Link → return pay instructions + reference → partner settles → Senda reconciles → **proof**.

## Repo layout

```
docs/
  product/           MVP PRD + product spec
  architecture/      Provider-agnostic / settlement executor rules
  customer-research/ Demand (MTO) + supply (school) packs
  processes/         Operating processes (to be filled)
  *.md               Thesis, comps, stage plan, brief
```

Start here: [`docs/senda-brief.md`](./docs/senda-brief.md) → [`docs/product/product-spec.md`](./docs/product/product-spec.md)

## Doctrine (locked)

- Connect = **instruction + proof** (not FX / collect)
- Prefer **`mto_settles`** — avoid adaptor-as-payer
- Single settlement executor per attempt
- Allowlisted institutions only (no open goods marketplace)
- First wedge: **UK → Nigeria private school fees**

## Status

Spec / research seed. Not production. No live customer funds.

## Related repos

| Repo | Role |
| --- | --- |
| `senda3.0` | Legacy consumer remittance prototype (dogfood possible later) |
| [`Senda-4.0`](https://github.com/nashe66-create/Senda-4.0) | **This repo** — Senda 4.0 product + infra |
| `senda2.0` / `Senda` | Earlier generations |
