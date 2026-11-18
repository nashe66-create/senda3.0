# Senda 4.0 — Supply research pack (schools / billers)

**Purpose:** Inform Biller MVP + Link/proof design. Secondary only until founder/field visits.  
**Updated:** 2026-11-13  
**Labels:** [F] fact · [I] inference · [Q] open question

---

## 1. Who to onboard first

| Segment | Why | MVP fit |
| --- | --- | --- |
| **Private NG primary/secondary** with diaspora parents | Clear fee cycles; bank account culture; EduPay-sized gap | **Best wedge** |
| Private universities / colleges | Higher ticket; more portal/Remita variance | Second wave |
| Public unis (Remita/RRR) | Attribution exists via RRR; less “directory” pain | Adapter later, not cold-start |
| ZW private schools (EcoCash/InnBucks) | Strong diaspora purpose demand; rails exist | Parallel research; pilot only if founder locks ZW |
| Medical aid / funeral / utilities | Same Link pattern | After school process works |

**Product implication:** MVP Biller = **manual KYB + student list + verified settle destination + refs + portal/proof**. No SIS required.

---

## 2. How fees are paid today (NG)

### Pattern A — School bank + student reference [F]
- Diaspora guidance (Pryme, Techeconomy): safest path is **pay school’s own NGN account** with student name/ID as reference; confirm account name matches school; avoid personal accounts; keep receipts ([Pryme](https://www.mypryme.com/blog/pay-school-fees-nigeria-from-abroad), [Techeconomy](https://techeconomy.ng/nigerians-in-diaspora-how-to-pay-school-fees-safely)).
- Pain: wrong/scam accounts, WhatsApp “new account,” hard reconciliation when refs are messy, relative as middleman.

**Implication:** Senda MVP mirrors this **safest path** digitally: verified account + **canonical ref** + recon + proof. MTO settles; we don’t invent a new money rail.

### Pattern B — Remita RRR [F]
- Common for federal/state institutions; RRR from portal; pay card/bank/USSD; receipt + school verify via RRR ([Pryme Remita](https://www.mypryme.com/blog/remita-payment-from-abroad)).
- Foreign card acceptance unreliable → often need local NGN path.

**Implication:** Later `RemitaPort` as instruction type (`pay_rrr`), not rebuild Remita.

### Pattern C — EduPay / student VA [F]
- EduPay: per-student virtual accounts; school’s own Flutterwave merchant; auto verify; receipts; free; ~28 schools / 1.2k+ students public metric ([EduPay](https://edupay.com.ng/)).
- Guarantee = VA hit → school Flutterwave account + recorded paid — **not** bursar outcome insurance.

**Implication:** Competitor on **school portal**; partner/ignore for density. Senda differentiates **cross-border Link + multi-payer + MTO Connect**, not “another VA UI.”

### Pattern D — Flutterwave Tuition etc. [F]
- Often different corridors (pay into UK/CA schools from Africa). Don’t confuse with UK→NG private school collect.

---

## 3. Zimbabwe notes (not default pilot)

| Rail | Role for schools / diaspora | Senda use |
| --- | --- | --- |
| **EcoCash Diaspora Wallet / Home Wallet** [F] | Diaspora pays merchants/schools/utilities directly with confirmation ([Business Times](https://businesstimes.co.zw/ecocash-launches-diaspora-wallet-to-ramp-up-remittances/), Mobile Money Africa) | Destination/instruction data; EcoCash may compete as closed wallet |
| **InnBucks** [F] | Remittances + bill categories including **Schools**, medical, funeral ([bill payments](https://wallet.innbucks.co.zw/bill_payments.html)); school-term diaspora messaging | Same — till/account as settle target for `mto_settles` |
| **ZB SmileLink** [F] | Pay-by-link; EcoCash/OneMoney/ZB/Visa; schools/churches; diaspora cards ([SmileLink](https://www.zb.co.zw/banking/smilelink)) | Local collect competitor; Senda still can be Link/proof if MTOs embed |

**Implication:** ZW validates **purpose-pay demand**. For Connect MVP, treat EcoCash/InnBucks as **instruction destinations** Mukuru already reaches — not Senda adaptor-as-payer. Confirm in Mukuru interviews.

---

## 4. School jobs-to-be-done

1. Get fees from diaspora without WhatsApp account chaos.  
2. Know **which student** a credit belongs to.  
3. Issue / accept proof parents trust.  
4. Avoid chargebacks / “I paid” disputes without evidence.  
5. Minimal IT — spreadsheet/portal upload OK.

---

## 5. KYB / onboarding (MVP process sketch)

**Collect (manual)**
- Legal name, registration docs, address, bursar contact  
- Verified settle method: bank account name match **or** EcoCash/InnBucks merchant till  
- Fee schedule (PDF/sheet) optional for term amounts  
- Student roster: student_id, name, class/term (CSV)

**Senda creates**
- `institution` verified  
- `beneficiary` rows  
- `link_code` / payment refs  
- Pay instructions payload for Connect

**School gets**
- Simple portal or weekly paid report + proof PDFs

[Q] Will 10 private NG schools KYB for zero initial volume? (Need dogfood diaspora channel or MTO LOI.)

---

## 6. Interview kit — bursar / proprietor (founder)

1. How do diaspora parents pay today (% bank / relative / Remita / EduPay)?  
2. Last term: how many “can’t find payment” tickets?  
3. What reference format do you tell parents to use?  
4. Would you share student list + official account for a verified directory used by Remitly/Mukuru?  
5. Who must approve KYB (proprietor, board, accountant)?  
6. Proof format parents demand?  
7. Multi-payer (mum + uncle) — allowed? how attributed?  
8. Willingness to pilot for one term with N diaspora payers?

---

## 7. MVP product implications (supply)

| Decision | Recommendation |
| --- | --- |
| First institutions | 5–10 NG private schools with diaspora parents |
| Settle instruction types v1 | `bank_transfer` (+ account name check), optional `mobile_money_till` |
| Obligation | Term fee amount if known; else open amount + student ref |
| Proof | PDF/digital receipt: institution, student, amount, ref, time, status |
| Integrations | None required; CSV roster; manual KYB |
| Competitors to watch | EduPay density, Remita (public), EcoCash/InnBucks closed loops, SmileLink |

---

## 8. Open research queue

- [ ] List 20 NG private schools with visible diaspora marketing / UK alumni  
- [ ] Sample fee schedules + official pay instructions (public)  
- [ ] EduPay school count trajectory / API openness  
- [ ] ZW: whether Mukuru already settles school EcoCash tills  
- [ ] Medical aid ZW/NG as second vertical one-pager (after school MVP freeze)
