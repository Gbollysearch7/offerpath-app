# Status register

The single current status of everything needed to launch Offerpath. If another document disagrees with this one, this one is meant to be right: fix whichever is wrong. Older lists ([LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md), [QA.md](QA.md), the reports) are kept as history.

Last full review: 7 November 2026, for OP-028. No live service was changed for it, and the only live reads were `vercel env ls` and the public sign-in page. **`/api/health`, the live database, Supabase settings, Resend, GitHub and Vercel plan settings were not read**, so anything depending on them shows its last recorded date.

**How to read it.** Status uses the [register's vocabulary](CLAUDE_IMPLEMENTATION_TASKS.md#status-vocabulary): Open, Implemented, Locally verified, Adviser validated, Pilot validated, Production verified. "Done" means nothing more is needed for launch and the evidence is linked. "Awaiting" names a person or role, because code can't establish that. Owner: where nobody has been named, "Founder to assign". The founder is the only person the documents name. `E` numbers are [command outputs](#command-evidence) below; `FD` numbers are [founder decisions](FOUNDER_DECISIONS.md).

## Summary

**Production verified today: nothing.** Done items below are done at the level stated. The tree holds uncommitted work with unapplied migrations, so production doesn't yet run most of what the reports describe.

Top blockers, in order:

1. **Review and commit the work.** About 240 uncommitted paths; only OP-001 and OP-002 have had independent review ([FD-02](FOUNDER_DECISIONS.md#fd-02)).
2. **Approve and apply migrations 12 to 20, tested on staging first.** The new code can't run without them, and no staging exists ([FD-01](FOUNDER_DECISIONS.md#fd-01), [FD-16](FOUNDER_DECISIONS.md#fd-16)).
3. **Backups and a rehearsed restore.** The project is recorded on Free, with no managed backups, and no restore has ever been tried ([FD-04](FOUNDER_DECISIONS.md#fd-04), [FD-22](FOUNDER_DECISIONS.md#fd-22)).
4. **Real email and a domain.** Students sign in by emailed link, and no real delivery has been recorded ([FD-14](FOUNDER_DECISIONS.md#fd-14)).
5. **Legal: company and ICO details, lawyer and DPO sign-off, and the 30 or 35 day conflict** ([FD-15](FOUNDER_DECISIONS.md#fd-15), [FD-03](FOUNDER_DECISIONS.md#fd-03)).
6. **Remove the QA data, set the missing variables, replace the Anthropic key** ([FD-08](FOUNDER_DECISIONS.md#fd-08), [E1](#e1), [FD-06](FOUNDER_DECISIONS.md#fd-06)).
7. **Adviser review and calibration, then a real pilot university.**

## 1. Production platform

| Item | Owner | Status | Evidence | Last verified | Outstanding action |
|---|---|---|---|---|---|
| Production site responds | Founder to assign | Up (sign-in page only) | [E2](#e2) | 2026-11-07 | Read `/api/health` during the release |
| Region is London | Founder to assign | Done for hosting: config and response agree | [vercel.json](../vercel.json), [E2](#e2) | 2026-11-07 | None |
| Security headers on production | Founder to assign | Done: CSP, HSTS and frame denial present | [E2](#e2) | 2026-11-07 | None |
| Code deployed to production | Founder to assign | Open: exact commit not read; no later than the last commit | `git log`, [runbook](RELEASE_RUNBOOK.md#1-what-is-being-released) | 2026-11-07 | Release per the runbook |
| Work reviewed and committed | Founder; reviewer Codex | Open | [Codex review of batch 01 only](CODEX_BATCH_01_REVIEW.md) | 2026-11-07 | [FD-02](FOUNDER_DECISIONS.md#fd-02) |
| Live database, 11 migrations | Founder to assign | Last recorded done, not re-read | [QA log](QA.md), 27 and 30 October | 2026-10-30 | Run the [pre-flight](RELEASE_RUNBOOK.md#3-pre-flight-read-only-checks) |
| Migrations 12 to 19 | Founder approves; applier to assign | Implemented; PGlite only; **not applied** | [Runbook table](RELEASE_RUNBOOK.md#2-migration-order), [E7](#e7) | 2026-11-07 | [FD-01](FOUNDER_DECISIONS.md#fd-01) |
| Migration 20, OP-021 | OP-021 agent, then founder | Open: in progress, no report yet. Database tests passed at the last run. | [E7](#e7) | 2026-11-07 | Finish, re-run `test:db`, report |
| Production build of this tree | Founder to assign | Open: never built | [DEPLOY.md](DEPLOY.md) | 2026-11-07 | Preview build, [runbook section 5](RELEASE_RUNBOOK.md#5-preview-check) |
| Environment variables | Founder to assign | Open: 7 missing on Production, none on Preview | [E1](#e1), [runbook section 4](RELEASE_RUNBOOK.md#4-environment-variables) | 2026-11-07 | Add them. Values weren't checked. |
| Missing required variable fails visibly | Founder to assign | Locally verified, partly: see [E3 to E5](#e3). Not tested on Vercel. | [env.ts](../src/lib/env.ts), [env.test.ts](../tests/env.test.ts) | 2026-11-07 | [FD-13](FOUNDER_DECISIONS.md#fd-13) |
| Vercel plan fits | Founder | Awaiting founder: plan not read | [FD-05](FOUNDER_DECISIONS.md#fd-05) | 2026-11-07 | Confirm the plan |
| Supabase Pro and backups (#14) | Founder | Open: recorded as Free | [QA log](QA.md) | 2026-10-27 | [FD-04](FOUNDER_DECISIONS.md#fd-04) |
| Staging (#6) | Founder to assign | Open: no Preview variables, so previews are expected to fail | [E1](#e1), [E4](#e4) | 2026-11-07 | [FD-16](FOUNDER_DECISIONS.md#fd-16) |
| Domain (#2) | Founder | Open. Production on the Vercel address. | [E2](#e2) | 2026-11-07 | [FD-14](FOUNDER_DECISIONS.md#fd-14) |
| Release process | Founder to assign | Written; not exercised | [RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md) | 2026-11-07 | Run it |
| CI on `main` (#1) | Founder to assign | Workflow exists; required-check setting last recorded, not re-read | [ci.yml](../.github/workflows/ci.yml), [checklist](LAUNCH_CHECKLIST.md) | 2026-11-02 | Confirm in GitHub. The shared tree passed engine and database tests at the last run ([E6](#e6), [E7](#e7)); build and e2e not run. |
| Secrets in git history (#13) | Founder | Last recorded done. Public or private still open. | [Checklist](LAUNCH_CHECKLIST.md) | 2026-11-02 | Decide repository visibility |

## 2. Email and access

| Item | Owner | Status | Evidence | Last verified | Outstanding action |
|---|---|---|---|---|---|
| App email (Resend) (#3) | Founder to assign | Implemented; **no real delivery recorded**. `EMAIL_FROM` recorded as the test sender; value not read. | [email.ts](../src/lib/email.ts), [E1](#e1), [checklist](LAUNCH_CHECKLIST.md) | 2026-11-02 | Verify the domain and run a [real delivery test](RELEASE_RUNBOOK.md#11-testing-email-sandbox-is-not-delivery) |
| Sign-in email (Supabase SMTP) | Founder to assign | **Open: QA says not tested.** Separate from app email. | [QA log](QA.md), [DEPLOY.md](DEPLOY.md) | 2026-10-27 | Set SMTP, then a real delivery test with a university inbox |
| Deadline reminders (#4, T04) | Founder to assign | Implemented. `CRON_SECRET` name exists. No delivered reminder recorded. | [E1](#e1), [vercel.json](../vercel.json) | 2026-11-07 | Confirm one arrives |
| Retention warnings and deletion | Founder to assign | Implemented; not run on production. Needs `CRON_SECRET` and real email. | [OP-026](CLAUDE_REPORT_OP-026.md), [OPERATIONS.md](OPERATIONS.md) | 2026-11-07 | Run by hand with an owner present |
| Institution onboarding | Founder to assign | Implemented (T05, T06, T25, OP-021 in progress). No real institution onboarded. | [DEPLOY.md](DEPLOY.md), [QA log](QA.md) | 2026-10-27 | First pilot university |
| Account recovery | Founder to assign | Open: there are no passwords, so recovery is a new sign-in email. Depends on sign-in email. | [DEPLOY.md](DEPLOY.md) | 2026-11-07 | Test with real delivery, and document admin lost-access steps |
| Admin MFA | Founder to assign | Open: a setting; not read | [DEPLOY.md](DEPLOY.md) | not verified | Enable and enrol |
| SSO per university | Founder to assign | Implemented; no provider connected; needs Pro | [DEPLOY.md](DEPLOY.md) | 2026-11-07 | When a university asks |
| Development login can't bypass production | Founder to assign | Locally verified in code. On production: variable absent, no buttons. | [env.ts](../src/lib/env.ts), [security-auth.test.ts](../tests/security-auth.test.ts), [E1](#e1), [E2](#e2) | 2026-11-07 | None for the code. QA data below. |
| Demo mode can't run by accident | Founder to assign | Locally verified | [env.test.ts](../tests/env.test.ts), [E3](#e3) | 2026-11-07 | None |
| QA accounts and `levelup-qa.ac.uk` | Founder approves; applier to assign | Open: not re-checked | [OP-026](CLAUDE_REPORT_OP-026.md) | 2026-11-07 | [FD-08](FOUNDER_DECISIONS.md#fd-08) |
| Anthropic key | Founder | Open: reason for replacing isn't recorded | [FD-06](FOUNDER_DECISIONS.md#fd-06), [E1](#e1) | 2026-11-07 | Replace, with spend limit |
| Support route: owner, response times, escalation | Founder to assign | Open: `SUPPORT_EMAIL` missing, and no owner or response time written | [E1](#e1), blueprint section 20 | 2026-11-07 | Name an owner, set a response time |

## 3. Recovery and monitoring

| Item | Owner | Status | Evidence | Last verified | Outstanding action |
|---|---|---|---|---|---|
| Restore procedure | Founder to assign | Written. **Not rehearsed.** | [RESTORE_PROCEDURE.md](RESTORE_PROCEDURE.md) | 2026-11-07 | Rehearse and fill in the record ([FD-22](FOUNDER_DECISIONS.md#fd-22)) |
| Weekly dump and bucket copy | Founder to assign | Open: described in OPERATIONS, no record of it ever running | [OPERATIONS.md](OPERATIONS.md) | 2026-11-07 | Start after FD-03 and FD-04 |
| Backup retention period | Founder | Awaiting founder: notice 35, DPA 30 | [FD-03](FOUNDER_DECISIONS.md#fd-03) | 2026-11-07 | Decide |
| Deleted accounts after a restore | Founder | Open: ledger and script built, not applied or rehearsed; off-site export and retention undecided | [FD-21](FOUNDER_DECISIONS.md#fd-21) | 2026-11-07 | Decide |
| Rollback | Founder to assign | Written; compatibility untested | [Runbook section 10](RELEASE_RUNBOOK.md#10-rollback) | 2026-11-07 | Test on staging |
| Uptime check (#7) | Founder to assign | Workflow exists; runs not read. Every 15 minutes. Emails owner. | [uptime.yml](../.github/workflows/uptime.yml) | 2026-11-02 | Confirm a run and a failure email. Set `PRODUCTION_URL` with the domain. It pauses after 60 days without commits. |
| Alerts | Founder to assign | Implemented; **`ALERT_WEBHOOK_URL` missing**, so alerts reach logs only | [E1](#e1), [OPERATIONS.md](OPERATIONS.md) | 2026-11-07 | Add it and send a test |
| Logs | Founder | Open: Vercel keeps 1 hour on Hobby, 1 day on Pro per its limits page | [FD-05](FOUNDER_DECISIONS.md#fd-05) | 2026-11-07 | Choose a plan; consider a drain |
| Analysis recovery (OP-025) | Reviewer Codex | Locally verified | [Report](CLAUDE_REPORT_OP-025.md), [E6](#e6) | 2026-11-07 | Apply migration 15 |
| Spend control | Founder | Open: per-student limits only | [FD-07](FOUNDER_DECISIONS.md#fd-07) | 2026-11-07 | Set a provider limit |
| Security review of hardening (OP-026) | Reviewer Codex | Locally verified; not run on production | [Report](CLAUDE_REPORT_OP-026.md), [E6](#e6) | 2026-11-07 | Apply migration 14; review |
| Security advisor | Founder to assign | Last recorded clean, for 9 migrations | [QA log](QA.md) | 2026-10-27 | Re-run after migrating |

## 4. Legal and commercial

None of these can be established by code, and templates don't count. Nobody has been named for any role. Founder to assign.

| Item | Owner | Status | Evidence | Last verified | Outstanding action |
|---|---|---|---|---|---|
| Company details (#8) | Founder | **Awaiting founder.** Variables missing, so pages show placeholders. | [E1](#e1), [legal.ts](../src/lib/legal.ts) | 2026-11-07 | [FD-15](FOUNDER_DECISIONS.md#fd-15) |
| ICO registration | Founder | **Awaiting founder.** No evidence it exists. | [E1](#e1) | 2026-11-07 | Register and supply the number |
| Privacy notice, terms, cookies, sub-processors (#9) | Lawyer and university DPO | **Awaiting lawyer and DPO.** Drafts only. | [CONTENT_REVIEW.md](CONTENT_REVIEW.md), `src/app/legal/` | 2026-11-07 | Review, with FD-03, FD-17 to FD-25 |
| DPA schedule and DPIA | University DPO | **Awaiting DPO.** Templates only. | [legal/](legal/DPA_SCHEDULE_TEMPLATE.md) | 2026-11-07 | Review with a real university |
| Signed contract with a university | Founder and university | **Awaiting founder.** None recorded. | No evidence | 2026-11-07 | First pilot |
| Agreements with Supabase, Anthropic, Vercel, Resend (DPA, UK transfer addendum) | Founder to assign | **Awaiting owner.** The sub-processor page asserts them; no signed copy is recorded. | [legal.ts](../src/lib/legal.ts) | 2026-11-07 | Confirm each exists and file it |
| Insurance | Founder | **Awaiting founder.** No evidence it exists. | No evidence | 2026-11-07 | Arrange if needed. Don't claim it. |
| Procurement pack (OP-029) | Founder to assign | Open | [Register](CLAUDE_IMPLEMENTATION_TASKS.md) | 2026-11-07 | After OP-021, OP-027, OP-028 |
| Pilot university (#12, OP-030) | Founder | **Awaiting founder.** None named. | [Checklist](LAUNCH_CHECKLIST.md) | 2026-11-07 | Find a sponsor |

## 5. Content and validation

| Item | Owner | Status | Evidence | Last verified | Outstanding action |
|---|---|---|---|---|---|
| Adviser content review (#10) | Careers adviser | **Awaiting adviser.** All 16 rows unticked. | [CONTENT_REVIEW.md](CONTENT_REVIEW.md) | 2026-11-07 | Recruit |
| Calibration (#11, OP-011) | Founder and advisers | Tooling Implemented. Adviser validation Open: no adviser has marked anything. | [OP-011](CLAUDE_BATCH_03_REPORT_OP-011.md), [runbook](CALIBRATION_RUNBOOK.md) | 2026-11-07 | Recruit; FD-36, FD-37 |
| Independent rewrite fidelity review (OP-015) | Independent reviewers | **Awaiting reviewers.** Pack exists. | [OP-011](CLAUDE_BATCH_03_REPORT_OP-011.md) | 2026-11-07 | Recruit |
| Proofreading evaluation labels (OP-007) | Careers adviser | **Awaiting adviser** | [OP-007](CLAUDE_BATCH_03_REPORT_OP-007.md) | 2026-11-07 | FD-43 |
| Accessibility | OP-027 agent, then real users | Open: in progress. Automated checks aren't conformance. The sign-in page says "Designed to WCAG 2.2 AA" ([E2](#e2)); the accessibility statement should support it. | [accessibility page](../src/app/legal/accessibility/page.tsx), [QA log](QA.md) | 2026-11-07 | OP-027 report; user testing; independent audit |
| Real opportunities loaded | Careers team | **Awaiting careers team.** Sample data is fictional. | [CONTENT_REVIEW.md](CONTENT_REVIEW.md) | 2026-11-07 | First pilot |

## 6. Implementation tasks

All from reports written by the implementing agents. **Only OP-001 and OP-002 have been accepted by Codex.** The engine tests pass on the shared tree ([E6](#e6)). None has passed a human or operational gate.

| Task | Owner | Status | Evidence | Last verified | Outstanding action |
|---|---|---|---|---|---|
| OP-001, OP-002 | Codex | Done for their stated scope: accepted | [Codex](CODEX_BATCH_01_REVIEW.md) | 2026-11-05 | None |
| OP-003 to OP-006 | Codex | Locally verified. OP-006 needs migration 12. | [Batch 02](CLAUDE_BATCH_02_REPORT.md) | 2026-11-07 | Review |
| OP-007 to OP-010, parser bump | Codex; advisers | Locally verified | [007](CLAUDE_BATCH_03_REPORT_OP-007.md), [008](CLAUDE_BATCH_03_REPORT_OP-008.md), [009](CLAUDE_BATCH_03_REPORT_OP-009.md), [010](CLAUDE_BATCH_03_REPORT_OP-010.md), [parser](CLAUDE_REPORT_PARSER_BUMP.md) | 2026-11-07 | Review; adviser gates |
| OP-011 | Codex; advisers | Implemented | [Report](CLAUDE_BATCH_03_REPORT_OP-011.md) | 2026-11-07 | Human gates |
| OP-012 to OP-016 | Codex; advisers | Locally verified | [012/013](CLAUDE_BATCH_04_REPORT_OP-012-013.md), [014/016](CLAUDE_BATCH_04_REPORT_OP-014-016.md), [015](CLAUDE_BATCH_04_REPORT_OP-015.md) | 2026-11-07 | Review; provider paths simulated only |
| OP-017 | Codex; advisers | Locally verified | [Report](CLAUDE_BATCH_05_REPORT_OP-017.md) | 2026-11-07 | Review; [FD-12](FOUNDER_DECISIONS.md#fd-12) |
| OP-018 | Codex; advisers | Locally verified. A LinkedIn fix was in progress during this review. | [Report](CLAUDE_BATCH_05_REPORT_OP-018.md) | 2026-11-07 | Review; test a real archive (FD-58) |
| OP-019 | Codex | Locally verified. Interview practice clause Open. | [Report](CLAUDE_BATCH_06_REPORT_OP-019.md) | 2026-11-07 | Review; FD-67 |
| OP-020 | Codex; founder | Locally verified; off by default. The two guard failures it noted now pass ([E6](#e6)). | [Report](CLAUDE_BATCH_06_REPORT_OP-020.md) | 2026-11-07 | Review; [FD-09](FOUNDER_DECISIONS.md#fd-09) |
| OP-021 | OP-021 agent | Open: in progress | [E7](#e7) | 2026-11-07 | Finish |
| OP-022 to OP-024 | Founder to assign | Open | [Register](CLAUDE_IMPLEMENTATION_TASKS.md) | 2026-11-07 | Later batches |
| OP-025, OP-026 | Codex | Locally verified | [025](CLAUDE_REPORT_OP-025.md), [026](CLAUDE_REPORT_OP-026.md) | 2026-11-07 | Review |
| OP-027 | OP-027 agent | Open: in progress | No report yet | 2026-11-07 | Finish |
| OP-028 | Founder to assign | Partial: documents done; rehearsal and production verification Open | [Report](CLAUDE_REPORT_OP-028.md) | 2026-11-07 | Rehearse the restore, run the release |
| OP-029, OP-030 | Founder to assign | Open | [Register](CLAUDE_IMPLEMENTATION_TASKS.md) | 2026-11-07 | After the above |

## 7. Earlier checklist tags

Ticks here mean the code or document exists at the level shown. They replace the ticks in [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md), which sometimes overstated it.

| Tag | Owner | Status | Evidence | Last verified | Outstanding action |
|---|---|---|---|---|---|
| T01 Checklist | Founder to assign | Superseded by this register | [Checklist](LAUNCH_CHECKLIST.md) | 2026-11-07 | None |
| T02 Production guard | Founder to assign | Locally verified | [E3](#e3) | 2026-11-07 | FD-13 |
| T03 Email templates and sender | Founder to assign | Implemented | [Section 2](#2-email-and-access) | 2026-11-07 | Real delivery |
| T05, T06, T07 Admin data, roles, opportunities | Founder to assign | Locally verified; live test covered pages | [QA log](QA.md) | 2026-10-27 | Pilot use |
| T08 UI truth | Founder to assign | Implemented, claims still under OP-003 and OP-027 | [Batch 02](CLAUDE_BATCH_02_REPORT.md) | 2026-11-07 | Accessibility claim, adviser review |
| T09 Legal pages | Lawyer, DPO | Implemented as drafts | [Section 4](#4-legal-and-commercial) | 2026-11-07 | Sign-off |
| T10 Long uploads | Founder to assign | Locally verified, extended by OP-025 | [OP-025](CLAUDE_REPORT_OP-025.md) | 2026-11-07 | Production check |
| T11 Monitoring code | Founder to assign | Implemented; webhook missing | [Section 3](#3-recovery-and-monitoring) | 2026-11-07 | Add webhook |
| T12 Security | Founder to assign | Locally verified; CSP seen live | [QA log](QA.md), [E2](#e2) | 2026-11-07 | Review with OP-026 |
| T13 Ops | Founder to assign | **Documents only.** No backup is running and staging doesn't exist. | [OPERATIONS.md](OPERATIONS.md) | 2026-11-07 | Section 3 |
| T14 CI | Founder to assign | Implemented | [ci.yml](../.github/workflows/ci.yml) | 2026-11-07 | Confirm required check |
| T15 Calibration | Founder and advisers | **Old script replaced.** See OP-011. | [Runbook](CALIBRATION_RUNBOOK.md) | 2026-11-07 | Section 5 |
| T16 Admin reporting | Founder to assign | Locally verified; OP-022 open on the counts | [QA log](QA.md) | 2026-10-27 | FD-34 |
| T17 Automated accessibility | OP-027 agent | Implemented; not conformance | [ci.yml](../.github/workflows/ci.yml) | 2026-11-07 | OP-027 |
| T18, T22 Landing, polish | Founder | Implemented; landing changes uncommitted | `git status` | 2026-11-07 | Commit |
| T19 Content | Careers adviser | Implemented; **not reviewed** | [CONTENT_REVIEW.md](CONTENT_REVIEW.md) | 2026-11-07 | Review |
| T20 Adviser features | Founder and lawyer | Implemented behind a flag; off | [E1](#e1) | 2026-11-07 | FD-20 |
| T21 Practice tools | Careers adviser | Implemented; not reviewed | [CONTENT_REVIEW.md](CONTENT_REVIEW.md) | 2026-11-07 | Review |
| T23 Deploy config | Founder to assign | Done: three crons, London | [vercel.json](../vercel.json) | 2026-11-07 | None |
| T24 Live database | Founder to assign | Last recorded done; 11 migrations; Free plan | [QA log](QA.md) | 2026-10-30 | Pre-flight |
| T25 SSO mapping | Founder to assign | Implemented; no provider connected | [Checklist](LAUNCH_CHECKLIST.md) | 2026-10-27 | When a university asks |

## Command evidence

Captured 7 November 2026. Secret values were never printed.

<a id="e1"></a>**E1. `vercel env ls`, project `offerpath-app`.** Names only. Production has exactly eight: `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL`, `EMAIL_FROM`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, all "created 5d ago". Preview and Development have none. Not present: `SUPPORT_EMAIL`, `ALERT_WEBHOOK_URL`, all five `LEGAL_*`, `TEST_LOGIN`, `SCORING_VOTES`, `DEMO_MODE`, `ADVISER_CV_ACCESS`.

<a id="e2"></a>**E2. `curl` of `https://offerpath-app-lake.vercel.app/sign-in`.** HTTP 200. `content-security-policy` with a nonce, `strict-transport-security: max-age=63072000; includeSubDomains; preload`, `x-frame-options: DENY`, `x-vercel-id: lhr1::lhr1::…`. The text offers university sign-in and an emailed link, with no test sign-in buttons, and shows "UK GDPR", "Files stored in the UK or EU" and "Designed to WCAG 2.2 AA".

<a id="e3"></a>**E3. `tsx --test tests/env.test.ts`.** 3 pass, 0 fail.

<a id="e4"></a>**E4. `checkEnv()` called directly with fake values**, based on production with all eight names set (0 errors, 0 warnings), removing one at a time:

| Removed | Errors | Warnings |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 2 | 1 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 2 | 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | 1 | 0 |
| `NEXT_PUBLIC_SITE_URL` | 1 | 0 |
| `ANTHROPIC_API_KEY` | 0 | 1 |
| `RESEND_API_KEY` | 0 | 1 |
| `CRON_SECRET` | 0 | 1 |

`VERCEL_ENV=preview` with nothing set: 1 error. With `DEMO_MODE=true`: 0 errors. `EMAIL_FROM`, `SUPPORT_EMAIL`, `ALERT_WEBHOOK_URL` and `LEGAL_*` don't appear in `env.ts`.

<a id="e5"></a>**E5. Scratch app outside the repo, Next 15.5.28, whose `register()` throws.** Not the Offerpath app and not Vercel. `next build`: exit 0. `next start` with the throw: stays up, logs "An error occurred while loading instrumentation hook: …", and returned 500 on `/` and `/api/health` on all 5 tries. Without the throw: 200 on both.

<a id="e6"></a>**E6. `npm run test:engine` on the shared tree.** 804 pass, 0 fail. Others were editing during the run.

<a id="e7"></a>**E7. `npm run test:db` on the shared tree.** First run, about 03:55, while OP-021 was writing migration 20: 6 failures in `security.test.mjs`, all naming OP-021's new functions and tables. Re-run at 04:08: exit 0, 392 checks pass, 0 fail. The file was still changing, so re-run before release.

**E8. `git ls-files supabase/migrations`:** 11 files, through `20261030120000`. `ls supabase/migrations`: 20 files, through `20261107230000`. **`git diff --check`:** clean on the files changed here.
