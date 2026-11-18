# Senda 4.0 — Product specification (MVP)

**Product line:** Senda 4.0
**Status:** Working spec v0.1 — 2026-11-13  
**Companion:** [mvp-prd.md](./mvp-prd.md) · [payment-provider-agnostic-architecture.md](../payment-provider-agnostic-architecture.md)  
**Doctrine:** Connect = **instruction + proof**. Default settlement executor = `mto_settles`. No adaptor-as-payer in MVP.

---

## 1. Product summary

| | |
| --- | --- |
| **What** | Allowlisted purpose-settlement network: verify institutions, bind beneficiaries (Links), issue pay instructions + refs, reconcile confirmations, issue proof |
| **Who pays Senda** | MTOs / purpose apps (Connect); optionally institutions (Biller SaaS later) |
| **Who does not pay via Senda rails** | End customers — collect/FX/payout stay with the MTO |
| **First vertical** | School fees |
| **First corridor** | UK send → **Nigeria private schools** (ZW = research track only) |
| **Not this product** | Consumer remittance brand, FX engine, open goods marketplace |

**One-line:** Senda tells the partner *who/what to pay and whether it settled*; the partner moves the money.

---

## 2. Problem statement

Diaspora support for school fees (and similar obligations) usually travels **P2P**, then a local person pays the institution. That causes diversion, fake-account fraud, bursar mismatch, and no shareable proof. MTOs and purpose apps (Remitly Business Pay, Mukuru billers, Vybe, PayAngel) need a **neutral verified institution + beneficiary layer** they can embed without running bursar ops or becoming a marketplace.

---

## 3. Principles (non-negotiable for MVP)

1. **Two jobs:** Senda = identity/validate/instruct/recon/proof. Partner = money movement.  
2. **Single settlement executor** per attempt: `mto_settles` | `institution_collects` (MVP). `senda_settles` **out of MVP**.  
3. **Allowlist only** — contracted institutions; no open merchant marketplace.  
4. **Idempotent refs** — one `customer_reference` cannot prove twice.  
5. **Proof requires recon** — confirmation alone ≠ allocated until matched to Link/obligation.  
6. **Multi-partner ready** — same institution can be paid via Mukuru *or* Vybe *or* dogfood; directory is shared.

---

## 4. Personas

| Persona | Goal | Surface |
| --- | --- | --- |
| **Partner engineer / PM** (MTO, Vybe-class) | Embed “pay school fees” safely | Connect API |
| **Bursar / school admin** | Get attributable fees + receipts | Biller portal |
| **Senda ops** | KYB, exceptions, pilot support | Internal ops (can be sheets + admin UI) |
| **Diaspora payer** | Pay correct student; get proof | Partner UX (Senda invisible) |
| **Optional dogfood payer** | Same, via thin Senda UI | Dogfood only — not GTM |

---

## 5. Surfaces

### 5.1 Senda Connect (sell to partners)
API + docs + sandbox for: search/validate → instructions → confirm → proof/status.

### 5.2 Senda Biller (supply side)
School onboarding, roster, settle destinations, payment activity, proof download, basic exception flags.

### 5.3 Senda Network (implicit)
Shared density of verified institutions + Links across partners. Not a separate UI in MVP.

---

## 6. Domain model

### 6.1 Entity diagram (logical)

```
Partner ──┬── Attempt ── Instruction
          │                 │
Institution ── Beneficiary ─┴── Link ── Obligation
          │
          └── SettleDestination(s)
                              │
Attempt ── Confirmation ──► ReconResult ──► Proof
```

### 6.2 Fields (MVP)

#### `Institution`
| Field | Notes |
| --- | --- |
| `id` | UUID |
| `legal_name`, `trading_name` | |
| `country` | `NG` for pilot |
| `type` | `school` (enum expands later) |
| `kyb_status` | `draft` \| `pending_review` \| `verified` \| `suspended` |
| `bursar_contact` | name, email, phone |
| `timezone` | |

Only `verified` institutions appear in Connect.

#### `SettleDestination`
| Field | Notes |
| --- | --- |
| `id`, `institution_id` | |
| `method` | `bank_transfer` \| `mobile_money_till` |
| `currency` | `NGN` |
| `bank_code`, `account_number`, `account_name` | bank |
| `mm_provider`, `till_or_msisdn`, `account_name` | MM |
| `is_primary` | bool |
| `verified_at` | ops confirmed name match |

#### `Beneficiary`
| Field | Notes |
| --- | --- |
| `id`, `institution_id` | |
| `external_student_id` | school’s ID |
| `full_name`, `class_or_grade` | |
| `status` | `active` \| `archived` |

#### `Link`
| Field | Notes |
| --- | --- |
| `id` | |
| `institution_id`, `beneficiary_id` | |
| `link_code` | short human code (e.g. `GF-ADA-7K2`) |
| `payer_hint` | optional: phone/email hash or partner payer id |
| `status` | `active` \| `revoked` |
| `created_via` | `school_invite` \| `partner` \| `ops` |

MVP may allow **institution+beneficiary** lookup without strict payer binding first; tighten payer binding when multi-payer rules matter.

#### `Obligation`
| Field | Notes |
| --- | --- |
| `id`, `link_id` or (`institution_id`+`beneficiary_id`) | |
| `label` | e.g. `2026 Term 1 fees` |
| `amount_due`, `currency` | nullable if open amount |
| `amount_mode` | `fixed` \| `open` \| `up_to` |
| `due_at` | optional |
| `status` | `open` \| `partially_paid` \| `paid` \| `cancelled` |

#### `Attempt`
| Field | Notes |
| --- | --- |
| `id` | |
| `partner_id` | |
| `link_id`, `obligation_id` | obligation optional if open |
| `customer_reference` | **idempotency key** Senda issues |
| `settlement_executor` | `mto_settles` \| `institution_collects` |
| `amount`, `currency` | expected credit |
| `status` | see state machine |
| `instruction_id` | |

#### `Instruction`
| Field | Notes |
| --- | --- |
| `id`, `attempt_id` | |
| `destination_snapshot` | frozen copy of settle details |
| `customer_reference` | must appear on payout narrative/ref |
| `expires_at` | optional |

#### `Confirmation`
| Field | Notes |
| --- | --- |
| `id`, `attempt_id` | |
| `source` | `partner_webhook` \| `manual_ops` \| `school_mark` \| `statement_match` |
| `provider_reference` | partner’s txn id |
| `amount`, `currency`, `paid_at` | |
| `raw_payload` | audit |

#### `Proof`
| Field | Notes |
| --- | --- |
| `id`, `attempt_id` | |
| `proof_number` | public id |
| `issued_at` | |
| `payload` | JSON (see §10) |
| `pdf_url` | optional |

---

## 7. State machines

### 7.1 Attempt status

```
created
  → instructed          (instructions issued)
  → settling            (optional; partner says in flight)
  → confirmed           (confirmation received, not yet matched)
  → proven              (recon OK + proof issued)
  → needs_reconcile     (amount/ref/destination mismatch)
  → cancelled
  → expired             (instruction TTL)
```

Rules:
- Transition to `proven` only after recon rules pass (§9).  
- Duplicate confirmation with same `provider_reference` + `attempt_id` is idempotent.  
- Second successful pay against same `customer_reference` → reject / exception (no second proof).

### 7.2 Institution KYB

`draft` → `pending_review` → `verified` ↔ `suspended`

---

## 8. End-to-end flows

### 8.1 School onboarding (Biller)

1. Ops/school creates institution draft + uploads docs.  
2. Adds primary `SettleDestination`; ops verifies account name.  
3. Uploads student CSV → `Beneficiary` rows.  
4. KYB → `verified`.  
5. Optionally generate `link_code`s per student (or on first partner validate).

**CSV columns (MVP):** `external_student_id`, `full_name`, `class_or_grade`

### 8.2 Partner pays school fees (happy path)

```
Payer in Partner app
  → Partner: search school/student OR enter link_code
  → Connect validate
  → Connect instructions (ref + destination)
  → Partner collects GBP / FX / payout on THEIR rails
     with customer_reference on the credit
  → Partner POST confirmation
  → Senda recon → proof
  → Partner shows receipt; school sees paid in Biller
```

### 8.3 Institution collects (direct bank)

Same validate/instructions; payer/partner pays bank with ref; confirmation via `manual_ops` / `school_mark` / later statement match. Executor = `institution_collects`.

### 8.4 Exception path

Amount ≠ expected, unknown ref, wrong destination, duplicate → `needs_reconcile` → ops/school queue → resolve to `proven` (adjust) or `cancelled` + partner notified. **No silent double-proof.**

---

## 9. Reconciliation rules (MVP)

Match confirmation to attempt when:

| Check | Rule |
| --- | --- |
| Reference | `customer_reference` present or partner maps `provider_reference` → attempt |
| Amount | Equal within tolerance (MVP: **exact** on currency minor units) |
| Currency | Must match instruction |
| Destination | If partner sends destination fingerprint, must match snapshot |
| Timing | `paid_at` after `instructed` (skew tolerance e.g. 5 min clock skew) |

Partial pays: if `amount_mode=fixed` and underpay → `needs_reconcile` or `partially_paid` on obligation + new attempt for remainder (v1: flag exception, don’t auto-split).

Three-way view for ops:

1. Instruction issued  
2. Confirmation credited  
3. Obligation/beneficiary allocation  

All three green → `proven`.

---

## 10. Proof artifact

JSON (and PDF render):

```json
{
  "proof_number": "PRF-2026-000123",
  "issued_at": "2026-11-13T12:00:00Z",
  "institution": { "name": "Greenfield Secondary", "country": "NG" },
  "beneficiary": { "student_id": "STU-441", "name": "Ada Okafor" },
  "obligation": { "label": "2026 Term 1 fees", "amount": "250000.00", "currency": "NGN" },
  "payment": {
    "amount": "250000.00",
    "currency": "NGN",
    "customer_reference": "SENDA-GF-ADA-2026T1-9F3A",
    "paid_at": "2026-11-13T11:58:00Z",
    "partner": "mukuru",
    "provider_reference": "MK-..."
  },
  "status": "proven"
}
```

Proof is what partners and schools share with payers.

---

## 11. Connect API (MVP contract)

Base: `/v1` · Auth: partner API key · Idempotency-Header on mutating calls where noted.

### `GET /v1/institutions`
Query: `country`, `q` (name search). Returns verified institutions only.

### `GET /v1/institutions/{id}/beneficiaries`
Query: `q`, `external_student_id`.

### `GET /v1/links/{link_code}`
Resolve link → institution + beneficiary summary.

### `POST /v1/validate`
```json
{
  "link_code": "GF-ADA-7K2",
  "obligation_id": "optional",
  "amount": "250000.00",
  "currency": "NGN"
}
```
Response: valid/invalid, obligation constraints, institution display name, beneficiary display name.

### `POST /v1/instructions`  
Idempotency-Key required.
```json
{
  "link_code": "GF-ADA-7K2",
  "obligation_id": "optional",
  "amount": "250000.00",
  "currency": "NGN",
  "settlement_executor": "mto_settles",
  "partner_payer_ref": "optional"
}
```
Response:
```json
{
  "attempt_id": "...",
  "customer_reference": "SENDA-...",
  "destination": {
    "method": "bank_transfer",
    "currency": "NGN",
    "bank_code": "...",
    "account_number": "...",
    "account_name": "GREENFIELD SECONDARY SCHOOL"
  },
  "expires_at": "..."
}
```

### `POST /v1/confirmations`
```json
{
  "attempt_id": "...",
  "provider_reference": "...",
  "amount": "250000.00",
  "currency": "NGN",
  "paid_at": "...",
  "customer_reference": "SENDA-..."
}
```
Response: attempt status (`confirmed` | `proven` | `needs_reconcile`).

### `GET /v1/attempts/{id}`
### `GET /v1/proofs/{id}` or `/v1/attempts/{id}/proof`

### Webhooks (Senda → partner)
`attempt.proven`, `attempt.needs_reconcile`, `attempt.cancelled`

---

## 12. Biller portal (MVP screens)

1. **Login** (school user)  
2. **Home** — paid this week, exceptions count  
3. **Students** — list, CSV upload  
4. **Payments** — attempts/proofs for this institution  
5. **Settings** — settle destination (read-only if ops-controlled), contacts  
6. **Proof** — download PDF  

No cards-as-decoration; keep operational. Ops KYB can be admin-only tool or spreadsheet + flag in DB for pilot.

---

## 13. Dogfood (optional cold-start)

Thin flow: payer picks school/student → sees instructions → pays via **their bank** or a **partner sandbox** → ops/school marks paid → proof.  
Must use same objects/API. Must **not** invent Senda FX collect as the product.

---

## 14. Non-functional

| Area | MVP bar |
| --- | --- |
| Idempotency | Instructions + confirmations |
| Audit | Store raw confirmations; who verified KYB |
| PII | Student data minimized; partner payer PII optional/hashed |
| Security | Partner keys; TLS; no public student dump |
| Availability | Best-effort pilot; status page not required |
| Performance | Human-scale (tens of schools, hundreds of students) |

---

## 15. Acceptance criteria (MVP done)

- [ ] 1 institution KYB’d with verified bank destination  
- [ ] ≥20 beneficiaries loaded  
- [ ] Partner (or dogfood) can validate + get instructions  
- [ ] Confirmation → proven proof for exact match  
- [ ] Mismatch lands in `needs_reconcile` (demo)  
- [ ] School can see payment + download proof  
- [ ] Docs for Connect happy path  
- [ ] `senda_settles` not implemented  

---

## 16. Explicit non-goals (repeat)

- Flutterwave/EcoCash as Senda payout engine  
- Competing with Remitly on rates  
- Government MDA onboarding in v1  
- Live SIS  
- Multi-country production  

---

## 17. Open decisions (founder)

| # | Question | Default if silent |
| --- | --- | --- |
| 1 | Dogfood UI in first build? | **Yes, minimal** for cold-start |
| 2 | Payer-bound Links vs open student+school pay? | **Open student+school** first; bind payer later |
| 3 | Pricing | Defer; instrument usage |
| 4 | First named design partner | Outreach parallel to build |
| 5 | ZW in data model enums only? | **Yes** — no live ZW KYB |

---

## 18. Build sequence (suggested)

1. Data model + admin KYB + CSV beneficiaries  
2. Instruction + reference generation  
3. Confirmation + recon + proof JSON/PDF  
4. Connect API + sandbox key  
5. Biller payments view  
6. Dogfood thin UI (optional parallel)  
7. Webhooks  

---

## Document control

| Version | Date | Notes |
| --- | --- | --- |
| 0.1 | 2026-11-13 | First full spec from locked doctrine + research packs |
