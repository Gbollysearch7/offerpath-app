# Data flows and processors

**DRAFT. Not reviewed by a lawyer, DPO or security reviewer.** Evidence levels are defined in the [README](README.md).

Source of what each party receives: reading the code in the working tree on 7 November 2026. **No network traffic was captured, and no provider's settings or contract were read.** Locations and contract terms below are what the project's draft documents assert. None has been checked against a signed document or a provider's console, unless the row says so.

## Roles (draft position, not confirmed)

| Party | Draft role | Status |
|---|---|---|
| University | Controller | `[TO SUPPLY: confirmation by the university's DPO and the operator's lawyer. External gate.]` |
| Operator | Processor | `[TO SUPPLY: legal entity. Founder.]` |
| Parties in the table below | Sub-processors, if confirmed | No signed agreement is on file for any of them |

Open question for the DPO: the operator chooses the product's scoring logic and AI providers, and keeps a shared cache of labels across universities. Whether that fits a pure processor role has had no legal review.

## Overview

```
Student or staff browser
   |  HTTPS
   v
Vercel (London): the Next.js application. Proofreading runs here, in process. No outside call.
   |-- Supabase (London, recorded): database, sign-in, CV files
   |-- Anthropic (US, per draft documents): text for AI features only
   |-- Resend (US/EU, per draft documents): app email
   |-- Public job advert sites: only if a student pastes a link
   |-- Chat webhook: NOT set up today. Alerts.
Supabase Auth --> SMTP provider (Resend planned, not recorded as set up) --> sign-in email to the student
Browser --> Plausible: NOT set up today
```

## Processors in use

| Party | Purpose | Receives | Location | Contract on file | Evidence level |
|---|---|---|---|---|---|
| **Supabase** | Database, sign-in, file storage | Everything the service stores: names, emails, university records, CV files and text, reports, letters, LinkedIn text, applications, notes, logs of staff access. Sign-in events. | London (`eu-west-2`), recorded 27 October 2026, not re-read | **None recorded** | Seen on live, older code |
| **Anthropic** | AI features (table below) | Document text, sent over the Anthropic API | United States, per `src/lib/legal.ts`. Not verified. | **None recorded.** The notice asserts a DPA, a UK transfer addendum and no training on the data. `[TO SUPPLY: signed agreement, transfer mechanism, retention terms. Founder.]` | AI calls seen on live in October. Current paths tested only against a simulated provider. |
| **Vercel** | Hosts and runs the application | All requests and responses pass through it, including uploaded files and document text in memory. Runtime logs hold ids, counts and URL paths. **A share link's secret token is in its URL path, so it can appear in request logs.** | Functions in London: one response seen from `lhr1`. "Global edge network", per `legal.ts`, not verified. | **None recorded** | Seen in production (region and headers only) |
| **Resend** | App email: deadline reminders, inactivity warnings, pilot enquiries | Recipient address and message. Reminders include the student's name and role titles. A pilot enquiry goes to `SUPPORT_EMAIL` and holds the enquirer's details. | "US / EU", per `legal.ts`. Not verified. | **None recorded** | Locally tested with a fake. **No real delivery recorded.** `EMAIL_FROM` recorded as Resend's test sender. |

`src/lib/legal.ts` describes Resend as sending "sign-in and deadline reminder emails". Sign-in email goes by a separate path (Supabase Auth, using SMTP settings in its dashboard), not recorded as set up (settings not read). Whether Resend will carry sign-in mail depends on that setup, in which case it would also receive sign-in links.

## What goes to Anthropic

Sent only when an AI feature runs. If `ANTHROPIC_API_KEY` is absent, rule-based paths are used where they exist. The name exists on production; its value and validity were not checked ([FD-06](../FOUNDER_DECISIONS.md#fd-06)).

From reading `src/lib/ai.ts` and the callers:

| Feature | Model | Text sent | Size limit |
|---|---|---|---|
| CV scoring (judge), 3 votes | `claude-haiku-5-5` | Each CV bullet, target sector | 600 characters a bullet |
| Line rewrite | `claude-opus-5-5` | One bullet, the entry heading, sector, any earlier suggestion | 600 characters |
| Requirement reading | `claude-opus-5-5` | Job advert | 15,000 characters |
| Tailoring | `claude-opus-5-5` | **Whole CV text,** up to 40 bullets, job advert, job title, employer, keywords | CV 20,000, advert 15,000 |
| Letter draft and improve | `claude-opus-5-5` | **Whole CV text,** job advert, student's notes, name, existing letter | CV 20,000, advert 15,000, letter 12,000, notes 1,000 |
| LinkedIn suggestions | `claude-opus-5-5` | The LinkedIn section text, career aim, source facts from the student | Section 15,000, facts 20,000 |

Points a DPO should note:

- **No code removes names or contact details before text is sent.** A search of those flows found no redaction step. `promptSafeCv` removes instruction-like text, not personal data. A whole CV normally holds name, email, phone and anything else the student wrote, which can include special category data.
- The student's account id and email are not added to the request. `metadata` and user fields don't appear in `ai.ts` or `provider.ts`.
- `ai.ts` allows Anthropic's server-side model fallback on the Opus calls, so a different Anthropic model may answer.
- No tools are available to the model (test: "AI calls have no tools").
- Text can't be recalled from Anthropic once sent. Retention there is `[TO SUPPLY: Anthropic's retention terms for this account. Founder.]`
- `[TO SUPPLY: whether zero data retention applies. Founder.]` Nothing on file says it does.

**In progress, not settled:** OP-023 files in the tree (`src/lib/practice-flow.ts`, `src/lib/practice-feedback.ts`) pass an injected provider the interview question and the student's written answer, and the flow also holds CV text. From a partial read of unfinished code, with no OP-023 report. If it ships, confirm exactly what is sent, add a row above, and add saved answers to [03_RETENTION_AND_DELETION.md](03_RETENTION_AND_DELETION.md) and the export.

## Proofreading runs locally

The active proofreader is a Hunspell-format dictionary check (`nspell`, `dictionary-en-gb`, `dictionary-en`) running inside the application on Vercel. **Student text is not sent to any proofreading service, so it adds no processor** (OP-007).

- Default in code: `src/lib/analysis/proofreading/settings.ts` selects the local provider unless two settings are both present.
- An adapter for LanguageTool exists and is **inactive**. It needs `PROOFREADING_PROVIDER=languagetool`, `PROOFREADING_EXTERNAL_TEXT_APPROVED=true` and a URL. Those names are absent from production ([E1](../STATUS_REGISTER.md#e1)). Turning it on would add a processor, and would require updating this pack first ([FD-26](../FOUNDER_DECISIONS.md#fd-26)).
- Level: locally tested. **No production build has yet exercised the dictionary packaging.** If the files were missing, the report would say the check couldn't run, not that it passed.

## Set up only if someone turns them on

These are not on the published sub-processor list. They are not active today, by name, per [E1](../STATUS_REGISTER.md#e1). Each would need adding to the list first.

| Party | Trigger | Would receive | Note |
|---|---|---|---|
| Chat webhook (Slack, Teams or Discord) | `ALERT_WEBHOOK_URL`. **The runbook says to add it.** | Alert text, after scrubbing of keys, emails and quoted input. | `src/lib/log.ts` sends the message text only, not the extra data fields. The provider chosen becomes a recipient of operational information. `[TO SUPPLY: which service. Founder.]` |
| Plausible Analytics | `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | Page visits | **From reading, not tested:** the script is in the root layout, so it would load on every page, including `/share/<token>`. The cookies page says it collects no personal data. Check share links and report URLs before enabling. |
| LanguageTool | See above | Student CV text | Self-hosted or third-party |
| University identity provider | SAML per university | Sign-in only; returns identity attributes | The university's own service. None connected. |

## Others who touch the service

| Party | What | Personal data |
|---|---|---|
| Public job advert sites | If a student gives a link, the server fetches that page, guarded against private addresses. | The site sees a request from the server, not the student. No student data is sent, though a URL may hold whatever the student pasted. |
| GitHub | Source code, CI on synthetic data, an uptime check every 15 minutes reading `/api/health`, which returns status only. Failures email the repository owner. | None by design. Repository visibility is undecided. |
| Google Fonts | `next/font/google` copies the fonts in at build. From reading: browsers load them from the site, and the CSP's `font-src 'self'` allows nothing else. | None from students, as far as the code shows. |
| Careers staff at the university | See below. | See below. |
| Share link recipients | Anyone with a link, when sharing is enabled. | A limited summary, with no CV text, name or contact details. |

## What careers staff can see

From `src/lib/institution/permissions.ts` and OP-021. Locally tested. **Needs an unapplied migration:** the production database is on an older model.

| Action | Student | Adviser | Careers admin |
|---|---|---|---|
| Original CV file | Own | Only with opt-in, once the flag is on. **Off.** | Same |
| CV text, line feedback, letters, tailored CVs, LinkedIn | Own | No | No |
| Scores, notes, disagreement, referrals | Own (can't disagree) | Students in scope who share progress | Students in scope who share progress |
| Dashboard, exports, access log, configuration | Export and log: own | No | Yes |
| Change a score | No | No | No |

Also: non-sharing students are still counted as numbers in activation and account totals. Whether the notice needs to say so has had no legal review (OP-022).

## Personal data held

| Category | Examples | Source |
|---|---|---|
| Account | Name, university email | Student, Supabase Auth |
| University records | Student number, course, year, faculty, fee status | University import or SSO |
| Documents | CV files and every version of their text, letters, job adverts, LinkedIn text, notes | Student |
| Derived | Scores, feedback, suggestions, proofreading results quoting words | Service |
| Choices | Sector, stage, sharing and reminder settings, dismissals, tracked roles, visa-sponsorship preference (may indicate immigration status) | Student |
| Casework | Adviser notes, disagreements, referrals, staff names | Staff |
| Audit and operations | Staff access log, analysis job records, rate-limit hashes, share-link open times, erasure ledger ids | Service |
| Enquiries | Name and email of pilot enquirers | Enquirer |

**Special category data** is not asked for, but free text can hold it. Lawful basis is for the university: `[TO SUPPLY: lawful basis. University DPO.]`

## Automated processing

Scores and suggestions are guidance. Staff can add a note or record disagreement, and can't change a score. The DPIA template says Article 22 is not engaged. **That is an unreviewed draft statement,** and depends on universities not using scores for decisions about students.

## International transfers

| Flow | Destination, per drafts | Mechanism, per drafts | Status |
|---|---|---|---|
| AI text to Anthropic | United States | Inconsistent: `legal.ts` says "UK International Data Transfer Addendum", the DPA and DPIA templates say "UK IDTA". They are different instruments. | No signed copy. Open conflict C-03. |
| Email to Resend | "US / EU" | "Data processing agreement"; no transfer tool named. The DPA template's Location row mentions AI transfers only. | No signed copy. Open conflict C-03. |
| Vercel edge | "Global edge network" | Not stated | Not reviewed |

`[TO SUPPLY: transfer risk assessment, transfer mechanism for each. Lawyer.]`

## Changing processors

The sub-processors page says universities are told before a change, and the DPA template says 30 days' notice with a right to object. **There is no process, owner or list of contacts to do this.** See commitment K-05 in [09_OPEN_ITEMS.md](09_OPEN_ITEMS.md).
