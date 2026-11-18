# Senda 4.0 — Stage operating plan

**Verdict:** Yes — next best step is to **tie processes down, research target customers, lock the product definition**, then **spin agents only against those workstreams**.  
Do **not** create “an agent for every future company function” yet.

---

## Where we are

| Locked | Still open |
| --- | --- |
| Infra / purpose-settlement company (not P2P remittance brand) | Exact MVP surface (API shape, pilot country, vertical mix) |
| Connect = **instruction + proof**; avoid adaptor-as-payer | First design-partner MTO |
| Provider-agnostic; single settlement executor | First 5–10 institutions + KYB process that works |
| School fees as natural wedge | Primary customer evidence (MTO buyers + diaspora payers + bursars) |

Thesis docs exist. **Operating clarity does not.** That’s the gap.

---

## Correct sequence

```
1. Secondary research (demand + supply)  ┐
2. Draft MVP PRD                        ┴── parallel OK (humans do in-person later)
        ↓
3. Founder lock MVP in/out + pilot corridor
        ↓
4. Process catalogue P1–P7
        ↓
5. Agents/workers execute against locked PRD + interviews
        ↓
6. Revise PRD from live evidence
```

**Research agents:** gather max secondary intel + interview kits + product implications.  
**Founder:** in-person MTO/school conversations. Don’t wait for live calls to start defining MVP — draft from secondary, falsify with interviews.

---

## 1. Product definition (freeze this week)

**Working name:** Senda Connect + Senda Biller (Network = density between them).

**MVP one-liner:** Verified Link + payment instructions + reconciliation proof for **allowlisted school fee** obligations, sold so an MTO can offer “pay school” without becoming a marketplace.

**In scope (MVP)**
- Institution KYB (manual OK)
- Student/beneficiary Link + unique payment reference
- Validate obligation (amount/term if known; else “open amount + ref”)
- Return pay instructions (bank / EcoCash / etc. as **destination data**, not Senda payout)
- Ingest MTO/bank confirmation → reconcile → proof artifact
- Exception queue (unmatched / partial / disputed)

**Out of scope (MVP)**
- Senda as collector / FX engine / adaptor-as-payer (except explicit later spike)
- Open goods & services
- Multi-country live
- Full SIS integrations
- Consumer remittance app as the company (dogfood only)

**Success for this stage:** One clean E2E (real or design-partner sandbox): Link → instruct → settle (MTO) → proof.

Deliverable: `docs/product/mvp-prd.md` (owner: Product Definition agent).

---

## 2. Target customers (two sides)

### Demand (who pays Senda)
| Segment | Examples | Job | Research ask |
| --- | --- | --- | --- |
| **Primary** | Mid-tier MTOs / regional remit brands (Mukuru, PayAngel-class, Flutterwave Send) | Add purpose pay without school ops | Would you embed instruction+proof? What risk bars exist? |
| **Stretch** | Remitly / Wise / WorldRemit | Same, higher bar | What evidence density do you need before vendor review? |
| **Adjacent** | Banks / neo-banks with diaspora | Destination purpose products | Same API appetite? |

### Supply (who makes the network real)
| Segment | Examples | Job | Research ask |
| --- | --- | --- | --- |
| **Schools** | Private NG secondary / universities | Get attributable fees + less WhatsApp chaos | KYB willingness, bank/EcoCash settle path, proof needs |
| **Later** | Medical aid, utilities, funeral | Same Link pattern | After school wedge works |

### Payer (influences demand, not the buyer)
UK/diaspora parents paying fees today via person-conduit — use for pain evidence, not as B2B revenue.

Deliverables: ICP one-pagers + interview guides + 5–10 conversations logged (`docs/customer-research/`).

---

## 3. Processes to tie down *now* (only)

| ID | Process | Why now |
| --- | --- | --- |
| P1 | **Institution KYB** | Cold-start supply |
| P2 | **Link creation** (payer ↔ beneficiary ↔ institution) | Core object |
| P3 | **Validate + instruct** (Connect API/manual) | What MTOs buy |
| P4 | **Settlement confirm ingest** (MTO webhook / bank match / manual) | Proof without paying |
| P5 | **Reconcile → proof / exception** | Trust product |
| P6 | **MTO design-partner sales loop** | Demand |
| P7 | **Pilot ops weekly review** | Kill/continue |

Explicitly **later:** full dispute legal playbooks, multi-PSP routing engine, SPI/API licensing ops, consumer growth loops.

Deliverable: `docs/processes/*.md` — trigger, steps, owner, systems, SLAs, failure modes.

---

## 4. Agent roster for *this stage*

Create **workers against the table above**, not a fake org chart.

| Agent | Owns | Outputs |
| --- | --- | --- |
| **Product Definition** | MVP PRD, glossary, in/out scope, API sketch | `docs/product/mvp-prd.md` |
| **Process Architect** | P1–P7 maps + RACI | `docs/processes/` |
| **Demand Research** | MTO/bank ICP + interviews / secondary intel | `docs/customer-research/mto-icp.md` + call notes |
| **Supply Research** | School/biller ICP + KYB field reality | `docs/customer-research/school-icp.md` |
| **Connect Spec** | Instruction+proof API & data model (no payout engine) | `docs/product/connect-api-draft.md` |
| **Compliance Lite** | Allowlist posture, what *not* to custody, UK/ZW/NG notes for MVP | `docs/product/compliance-mvp-boundaries.md` |
| **Coordinator** | Sequence, merge conflicts, tracker, founder decisions | Keeps locks in `project-context.md` |

**Do not spawn yet:** payout-rail agents, Flutterwave integration squads, consumer growth, full Agent SDK production bots — unless a design partner forces a spike.

---

## 5. How “agents” means here

For this Project stage: **Cursor project workers / task agents** with clear briefs and doc outputs.  
**Not** (yet): shipping `@grok/agent-sdk` production bots for KYB/recon — that comes after processes and data model exist.

If you later want always-on bots (e.g. research digest, school onboarding checklist), scaffold those from the process docs — not before.

---

## 6. Immediate next actions

1. Founder confirms this sequence + MVP in/out (above).  
2. Coordinator opens tracker tasks: Product Definition, Process Architect, Demand Research, Supply Research, Connect Spec, Compliance Lite.  
3. Product Definition agent drafts MVP PRD first (blocks vague research).  
4. Research agents run in parallel against ICPs once PRD draft exists.  
5. Process Architect ties P1–P7 to the PRD objects.

---

## Kill criteria for this stage

Stop or reframe if:
- No MTO will entertain instruction+proof without Senda also moving money **and** that forces full remittance licensing as day-one; or  
- Schools won’t KYB / share settle details for a pilot; or  
- Proof without adaptor-as-payer is rejected by every design partner.
