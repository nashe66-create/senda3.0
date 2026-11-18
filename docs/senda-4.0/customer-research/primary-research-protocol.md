# Primary Research Protocol — Multi-Recipient Behaviour

**Date:** 2026-11-13  
**Pairs with:** [multi-recipient-behaviour-synthesis.md](./multi-recipient-behaviour-synthesis.md)  
**Goal:** Measure whether UK→Nigeria (then KE/GH) remitters run an **obligation portfolio** that creates **execution friction** MTOs don’t solve — before investing more in rails or brand.

**Rule:** Ask about **actual recent behaviour** before showing Senda. Do not lead with brand or ask willingness-to-pay in survey v1.

---

## 1. Design overview

| Phase | Method | Target | Output |
| --- | --- | --- | --- |
| A | Online screener survey (~10 Qs) | n=80–150 UK residents who sent to NG in last 6 months | Prevalence of multi-recipient + transfer count |
| B | Semi-structured interviews | 8–12 people with ≥2 recipients in last 90 days | Pain, tools, conduit vs multi-payout, concept reaction |
| C | Optional tiny concept test | Same interviewees | Preference: grouped pay+track vs status quo |

**Incentive suggestion:** £15–25 voucher for interview; survey raffle or £5 for complete.

**Recruitment channels (nashe-owned):** Nigerian UK WhatsApp/Telegram alumni groups, church/fellowship networks, LinkedIn diaspora, university African societies, Prolific/Respondent.io with screeners, personal warm intros. Avoid recruiting only inside one remittance app’s users if possible (bias).

**Ethics:** Say it’s product research; no need for bank passwords; anonymise notes; don’t pressure money stories.

---

## 2. Survey v1 (copy-paste ready)

**Title:** How people in the UK send money to Nigeria (research)

**Screener (terminate if no):**

1. Do you currently live in the United Kingdom?  
   - Yes / No → end  
2. In the last 6 months, have **you personally** sent money to someone in **Nigeria**?  
   - Yes / No → end  

**Behaviour block (multi-select / numbers — critical):**

3. In the **last 90 days**, how many **different people** in Nigeria did you send money to?  
   - 0 / 1 / 2 / 3 / 4 / 5+  
4. Thinking about a **typical month** when you support people in Nigeria, how many **separate transfers** do you usually make (separate checkouts / transactions with a provider)?  
   - 1 / 2 / 3 / 4 / 5+ / It varies too much to say  
5. Who did you send to in the last 90 days? (select all)  
   - Mother / Father / Sibling(s) / Spouse/partner / Child(ren) / Aunt/uncle/cousin / Friend / Other relative / School/fees account / Other institution / Prefer not to say  
6. What were the main **reasons** for sending in the last 90 days? (select all)  
   - Everyday household / food  
   - Rent or housing  
   - School / university fees  
   - Health / medical  
   - Bills / utilities / data  
   - Business / trading capital  
   - Ceremony / funeral / celebration  
   - Emergency one-off  
   - Savings / building / investment for them or you  
   - Other (free text)  
7. When money is meant for several needs, what do you usually do? (single)  
   - Send to **one person** who distributes it  
   - Send **separate amounts to different people**  
   - Mix of both  
   - Not sure  
8. How do you currently keep track of who you’ve sent to and what’s still owed / upcoming? (select all)  
   - Memory  
   - WhatsApp chats  
   - Notes app / phone reminders  
   - Spreadsheet  
   - Banking / remittance app history only  
   - Someone else reminds me  
   - I don’t really track  
9. In the last 6 months, which best describes friction? (select all that apply)  
   - Repeating the same transfer setup is annoying  
   - I lose track of who has been paid  
   - Fees add up when I send multiple times  
   - I’m unsure money was used as intended  
   - Timing (payday vs school fee dates) is stressful  
   - None of these — it’s fine  
10. Demographics (optional but useful): age band; years in UK; city/region; employment; approx. total £ sent to NG in last 90 days (bands: &lt;£100 / £100–299 / £300–599 / £600–999 / £1000+).

**Optional corridor add-on** (only if recruiting KE/GH too): mirror Q2–Q4 for that country.

**Analysis cheat sheet:**

- Multi-recipient rate = Q3 ≥ 2  
- Friction among multi = Q9 among Q3≥2  
- Conduit hypothesis = Q7 “one person who distributes”  
- Cross-tab Q3 × Q4 × Q7 × Q9  

---

## 3. Interview guide (45 minutes)

**Recruit only if:** survey Q3 ≥ 2 **or** warm lead clearly supports ≥2 people.

### 0. Consent (2 min)
Research for a possible money product; recording optional; can skip questions.

### 1. Recent month walkthrough (12 min) — gold section
“Open your remittance app or bank history if you’re comfortable — or just recall.”

- List each person you supported in the last 30–90 days.  
- For each: relationship, roughly how much, purpose, how often, which app.  
- How many **separate** send flows did that take?  
- Was anyone paid via a **middle person**? Why?

Probe: school fees vs mum upkeep in same month; emergencies; “black tax” language if they use it.

### 2. Tools & failure modes (8 min)
- How do you remember who’s next / what’s due?  
- Tell me about a time something went wrong (late, wrong person, money misused, double ask).  
- What do you do when two people ask in the same week?

### 3. Ideal workflow without pitching Senda (8 min)
“If a magic app existed only for *your* situation — not for strangers — what would it do?”

Listen for: one payment, calendar, labels, pay school direct, shared family pool, reminders.

**Then** show a **neutral** storyboard (no brand):

> One screen lists Mum £80 (monthly upkeep), Brother £50 (data), School £200 (term fees). You pay once in GBP. Each line shows its own status until delivered.

Ask:

- Would this help, hurt, or not matter vs what you do now?  
- What would you **not** trust?  
- Would you still want one conduit person instead?

### 4. Trust & switching (5 min)
- What would make you try a new app vs Remitly/WorldRemit/Mukuru/etc.?  
- Must-have: price, speed, bank vs mobile money, customer support, FCA feel, referrals.

### 5. Close (2 min)
- Anything we didn’t ask that matters for sending home?  
- OK to follow up in 4–6 weeks?

### Coding tags for notes
`recipients_n` `transfers_n` `conduit` `purposes` `tools` `pain_admin` `pain_purpose` `pain_fees` `concept_yes` `concept_no` `trust_block` `segment`

---

## 4. Decision meeting (after Phase A+B)

Use falsification rules in the synthesis doc §6.

| Outcome | Product implication |
| --- | --- |
| Multi-recipient + friction confirmed | Build commitment SoR; grouped fund; per-payout track; rails secondary |
| Multi-purpose but single conduit recipient | Pivot toward purpose labels / direct-to-institution; multi-payout less central |
| Low multi-recipient / low pain | Do not fight WorldRemit on workflow; revisit thesis |
| High purpose anxiety | Prioritise labelling / school-fee rails (Cenfri) in roadmap |

Write a one-page “primary findings” note into this folder when fielded; link from `project-context.md`.

---

## 5. What the agent completed vs what nashe must run

| Done in this research pass | Needs nashe / field |
| --- | --- |
| Secondary synthesis + strong thesis draft | Recruit respondents |
| Survey + interview instruments | Field survey / book interviews |
| Falsification thresholds | Apply thresholds to real data |
| | Optional: paid panel (Prolific) budget |

---

## 6. Minimal Typeform / Google Form structure

Sections: Screener → Last 90 days behaviour → Tracking & friction → Demographics → “May we contact you for a £20 interview?” (email/WhatsApp).

Filter interview invites: Q3≥2 AND (Q9 has any friction OR Q4≥2).
