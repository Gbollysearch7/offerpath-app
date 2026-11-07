# Service description

**DRAFT. Not reviewed. Not a commitment.** Evidence levels are defined in the [README](README.md). Claim numbers refer to the [claims table](08_CLAIMS_TABLE.md).

## Who provides it

| Item | Detail |
|---|---|
| Operator (legal entity) | `[TO SUPPLY: registered company name. Founder.]` |
| Registered address | `[TO SUPPLY: registered address. Founder.]` |
| Company number | `[TO SUPPLY: company number. Founder.]` |
| ICO registration | `[TO SUPPLY: ICO registration number, or confirmation none exists yet. Founder.]` No evidence of registration is on file. |
| Data protection contact | `[TO SUPPLY: name and address. Founder.]` |
| Support contact | `[TO SUPPLY: support address and owner. Founder.]` `SUPPORT_EMAIL` is not set on production. |
| Insurance | `[TO SUPPLY: policies held, if any. Founder.]` No evidence that any exists. |
| Certifications | None on file. |
| Existing university customers | None on file. |

The name "Offerpath" is the product name used in the code. The repository and some infrastructure use the earlier name "LevelUp" or `levelup`.

## What it is

A web application for university students and careers staff. A student uploads a CV and gets a score and feedback. Students can also tailor a CV to a job advert, draft and review cover letters, review LinkedIn text, track applications and use practice material. Careers staff get aggregate reporting and limited, consent-based access to individual students.

It has not been used by a real university. See [claim S-01](08_CLAIMS_TABLE.md).

## Functions

"Status" is the evidence level for the working tree. None of the functions marked "needs unapplied migration" can run on the production database as last recorded.

| Function | What it does | Limits | Status |
|---|---|---|---|
| CV upload and reading | Reads PDF and Word files up to 2 MB, 10 PDF pages. Records how the file was read, and holds uncertain readings for the student to check. | No OCR. A scan is not scored; the student can type or paste instead. | Locally tested. Version history needs an unapplied migration. |
| CV score | A fixed rule formula, part of its input coming from AI answers to set questions about each bullet. Same content gets the same core score under the same scoring version. | **Not validated against advisers.** Weights are product judgements. Named "Readiness Score", which should not be read as readiness for employment (FD-46). | Locally tested. An earlier version seen on live, 27 and 30 October. |
| Proofreading | A local dictionary check for likely misspellings, unrecognised words, regional variants and three punctuation patterns. | **Grammar is not assessed.** Real words used wrongly are not caught (0 of 14 on a held-out set). Figures come from synthetic, AI-labelled data with no human review. Doesn't cover letters, adverts or LinkedIn. | Locally tested. Needs an unapplied migration. |
| Line rewrites, tailoring, letters, LinkedIn suggestions | AI or rule-based suggestions with automated checks on what they add. | Checks can miss inventions and can wrongly refuse. No independent fidelity review has happened. The student must check every suggestion. | Locally tested with a simulated provider. |
| Job match | Compares a CV with requirements read from an advert. | Weights not validated. | Locally tested with a simulated provider. |
| Application tracker and dashboard | Tracks roles, deadlines and which document version went where. Optional deadline reminder emails. | No delivered reminder recorded. | Locally tested. Needs an unapplied migration. |
| Practice material | Interview and aptitude practice and role roadmaps. | Published practice content is not reviewed by an adviser. **OP-023 was adding interview practice tied to an application, with saved written answers and optional AI feedback, when this was written. It has no report yet:** re-check this row and the data flows when it reports. | Built. |
| Student data controls | Self-service data export (ZIP) and account deletion. | See [retention](03_RETENTION_AND_DELETION.md). | Locally tested. Earlier deletion seen on live, 27 October. |
| Report sharing | A link to a limited summary of a CV review. | **Off for every university** until the operator sets it. FD-09, FD-28 open. | Locally tested. Needs an unapplied migration. |
| Careers dashboard and exports | Aggregate figures with small groups hidden and counts rounded. | Not differential privacy. Thresholds not statistically or legally reviewed. A named student CSV exists, for sharing students only. | Locally tested. Needs an unapplied migration. |
| Adviser and institution configuration | Adviser role, casework, referrals, staff access log, branding, programme groups. | No adviser has used it. Adviser CV access is **off** pending legal review. | Locally tested. Needs an unapplied migration. |

## Sign-in

An emailed one-time link, restricted to email domains of universities set up in the database, or SAML single sign-on through Supabase. There are no passwords. Recovery means requesting a new link.

- No real delivery of a sign-in email is recorded, and Supabase SMTP is not recorded as set up (settings not read).
- No SSO provider has been connected. SSO needs a paid Supabase plan.
- **Update, 7 November 2026:** the selector described in the next point has been replaced. See [CLAUDE_REPORT_CLAIMS_FIXES.md](../CLAUDE_REPORT_CLAIMS_FIXES.md).
- The sign-in page's university selector is hard-coded to one fictional university, "University of Northfield" (`src/app/sign-in/SignInForms.tsx`), so a real university's SSO can't be chosen from it without a code change.

## How it is deployed

| Component | Recorded configuration | Last checked |
|---|---|---|
| Application | Vercel, project `offerpath-app`, region `lhr1` (London). Next.js 15.5.28. | 7 November 2026: one response from `lhr1` ([E2](../STATUS_REGISTER.md#e2)) |
| Production address | `https://offerpath-app-lake.vercel.app`. No custom domain ([FD-14](../FOUNDER_DECISIONS.md#fd-14)). | 7 November 2026 |
| Database, sign-in, files | Supabase project `levelup`, London (`eu-west-2`), Free plan. Another live app, unrelated to this service, is in the same Supabase organisation. | 27 and 30 October 2026, not re-read |
| Vercel plan | Not read ([FD-05](../FOUNDER_DECISIONS.md#fd-05)) | Never |
| Environments | Production only. **No staging environment.** Preview deployments have no variables and would run fictional demo data. | 7 November 2026 ([E1](../STATUS_REGISTER.md#e1)) |
| Scheduled jobs | Three Vercel cron jobs: reminders, retention, analysis housekeeping | `vercel.json`; runs not read |

Seven production variables are missing, including support, alerting and all legal details ([E1](../STATUS_REGISTER.md#e1)). Variable values were not read.

## Roles under data protection law

The draft documents treat the university as controller and the operator as processor. No lawyer or DPO has confirmed that this fits the service as built. See [02_DATA_FLOWS_AND_PROCESSORS.md](02_DATA_FLOWS_AND_PROCESSORS.md).

## Commercial terms, term and service levels

`[TO SUPPLY: price, term, renewal, exit terms. Founder with commercial reviewer.]` No pricing or contract is on file.

**No service level is offered.** No uptime figure, response time or recovery time has been measured or agreed. See [06_SUPPORT_AND_INCIDENTS.md](06_SUPPORT_AND_INCIDENTS.md).
