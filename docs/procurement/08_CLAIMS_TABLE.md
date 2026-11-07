# Claims table

**DRAFT. Not reviewed.** Levels are defined in the [README](README.md). **No claim is at "Verified in production".**

**Owner** is the role responsible for keeping the claim true. "Founder to assign" means no person has been named. **Date** is when the evidence was last checked. A date of 2026-11-07 with a command means the command or read was done for this pack, unless "recorded" says it was taken from another report on that date.

**Conditions for the tests.** `npm run test:engine` and `npm run test:db` ran on 7 November 2026 at about 05:07 on the shared, uncommitted tree while other agents were working. Result: **938 pass, 0 fail,** and **357 + 95 checks pass, 0 fail.** These run on fakes, demo mode and PGlite. No build, dev server, end-to-end run or `test:live` was run for this pack.

## State of the deployment

| ID | Claim | Level | Evidence | Owner | Date |
|---|---|---|---|---|---|
| D-01 | Production holds code no later than `8545550`; exact commit not read | Seen in production, partly | `git log -1`; [register](../STATUS_REGISTER.md#1-production-platform) | Founder to assign | 2026-11-07 |
| D-02 | 309 paths were uncommitted at about 05:10. The count moves while other agents work. | Fact about the tree | `git status --short \| wc -l` | Founder | 2026-11-07 |
| D-03 | 22 migrations in the tree, 11 in git | Fact about the tree | `ls supabase/migrations \| wc -l`; `git ls-files supabase/migrations \| wc -l` | Founder to assign | 2026-11-07 |
| D-04 | 11 migrations are applied live, as last recorded. What production holds today is unknown. | Seen on live, older code | [QA.md](../QA.md), T24 and 30 October | Founder to assign | 2026-10-30 |
| D-05 | Hosting responds from London | Seen in production | `curl` `x-vercel-id: lhr1` ([E2](../STATUS_REGISTER.md#e2)) | Founder to assign | 2026-11-07 (recorded) |
| D-06 | Database is in London on Supabase Free | Seen on live, not re-read | [QA.md](../QA.md) T24 | Founder | 2026-10-27 |
| D-07 | Seven variables are missing on Production; Preview has none | Seen in production (names) | `vercel env ls` ([E1](../STATUS_REGISTER.md#e1)) | Founder to assign | 2026-11-07 (recorded) |
| D-08 | No staging environment exists | Fact | [E1](../STATUS_REGISTER.md#e1), [OPERATIONS.md](../OPERATIONS.md) | Founder to assign | 2026-11-07 (recorded) |
| D-09 | The tree hasn't been built for production in this directory; scratch builds only | Recorded | [Release fixes report](../CLAUDE_REPORT_RELEASE_FIXES.md); [runbook](../RELEASE_RUNBOOK.md) | Founder to assign | 2026-11-07 (recorded) |
| D-10 | Only OP-001 and OP-002 have independent acceptance | Recorded | [CODEX_BATCH_01_REVIEW.md](../CODEX_BATCH_01_REVIEW.md) | Founder; reviewer Codex | 2026-11-07 (recorded) |

## Service

| ID | Claim | Level | Evidence | Owner | Date |
|---|---|---|---|---|---|
| S-01 | No university, student or adviser has used the service | External gate; none recorded | [Register section 4](../STATUS_REGISTER.md#4-legal-and-commercial) | Founder | 2026-11-07 (recorded) |
| S-02 | Same content gets the same core score under the same scoring version | Locally tested; earlier version seen on live | `tests/scoring-contract.test.ts`; [QA.md](../QA.md) 30 October | Reviewer Codex | 2026-11-07 |
| S-03 | No score is validated against advisers | External gate open | [OP-011 report](../CLAUDE_BATCH_03_REPORT_OP-011.md) | Founder and advisers | 2026-11-07 (recorded) |
| S-04 | A failed AI assessment gives no score, not a perfect score | Locally tested with simulated provider | `tests/scoring-provider.test.ts`, `tests/recovery.test.ts` | Reviewer Codex | 2026-11-07 |
| S-05 | Proofreading covers spelling and limited punctuation; grammar isn't assessed | Locally tested | `tests/proofreading.test.ts`; [OP-007 report](../CLAUDE_BATCH_03_REPORT_OP-007.md) | Adviser to assign | 2026-11-07 |
| S-06 | Proofreading figures (held-out 89.7% precision and recall) are on synthetic, AI-labelled data | Recorded | [OP-007 report](../CLAUDE_BATCH_03_REPORT_OP-007.md) | Adviser to assign | 2026-11-07 (recorded) |
| S-07 | AI suggestions are checked by rules; no independent fidelity review has been done | Locally tested; external gate open | `tests/rewrite.test.ts`, `tests/ai-explanations.test.ts`; [OP-015 report](../CLAUDE_BATCH_04_REPORT_OP-015.md) | Independent reviewers to assign | 2026-11-07 |
| S-08 | All 16 content review rows are unticked | Fact | [CONTENT_REVIEW.md](../CONTENT_REVIEW.md) | Careers adviser to assign | 2026-11-07 (recorded) |
| S-09 | Sign-in's university selector is hard-coded to a fictional university | Read in code | `src/app/sign-in/SignInForms.tsx:8` | Founder to assign | 2026-11-07 |
| S-10 | No SSO provider is connected | Recorded | [Register section 2](../STATUS_REGISTER.md#2-email-and-access) | Founder to assign | 2026-11-07 (recorded) |
| S-11 | No real delivery of any email is recorded | Recorded | [Runbook section 11](../RELEASE_RUNBOOK.md#11-testing-email-sandbox-is-not-delivery) table empty; [QA.md](../QA.md) | Founder to assign | 2026-11-07 |

## Data flows

| ID | Claim | Level | Evidence | Owner | Date |
|---|---|---|---|---|---|
| F-01 | Four processors are listed: Supabase, Anthropic, Vercel, Resend | Read in code | `src/lib/legal.ts` | Founder to assign | 2026-11-07 |
| F-02 | No signed agreement with any is on file; locations are unverified assertions | External gate open | [Register section 4](../STATUS_REGISTER.md#4-legal-and-commercial) | Founder to assign | 2026-11-07 (recorded) |
| F-03 | The server's outbound calls in code are Resend, the alert webhook, Anthropic through its SDK, Supabase through its client, and job advert links | Read in code | `grep -rnE "\bfetch\(" src`; `src/lib/safe-fetch.ts`; `package.json` | Founder to assign | 2026-11-07 |
| F-04 | AI payloads hold the text in [the table](02_DATA_FLOWS_AND_PROCESSORS.md#what-goes-to-anthropic), with these size limits | Read in code | `src/lib/ai.ts` (`LIMIT`, prompt builders) | Founder to assign | 2026-11-07 |
| F-05 | Names and contact details aren't removed before whole-CV AI calls | Read in code | `src/lib/tailor-flow.ts:174`; `src/lib/analysis/tailor.ts:199` | Founder to assign | 2026-11-07 |
| F-06 | No student id or email is added to AI requests | Read in code | `grep -nE "metadata\|user_id\|userId" src/lib/ai.ts src/lib/provider.ts` returns nothing | Founder to assign | 2026-11-07 |
| F-07 | The model has no tools | Locally tested | `tests/security-tenancy.test.ts`: "AI calls have no tools" | Reviewer Codex | 2026-11-07 |
| F-08 | Proofreading runs in process and sends no text out by default | Locally tested | `src/lib/analysis/proofreading/settings.ts`; `tests/proofreading.test.ts`. No production build. | Founder to assign | 2026-11-07 |
| F-09 | External proofreading variables are absent on production | Seen in production (names) | [E1](../STATUS_REGISTER.md#e1) | Founder | 2026-11-07 (recorded) |
| F-10 | Anthropic doesn't train on this data | **Not evidenced here.** An assertion in the notice. | `src/app/legal/privacy/page.tsx`. `[TO SUPPLY: terms. Founder.]` | Founder to assign | 2026-11-07 |
| F-11 | The alert webhook and Plausible aren't on the sub-processor list, and aren't active | Read in code; names checked | `src/lib/legal.ts`; `src/lib/log.ts`; `src/app/layout.tsx:37`; [E1](../STATUS_REGISTER.md#e1) | Founder to assign | 2026-11-07 |
| F-12 | Staff permissions are as tabled | Locally tested; unapplied | `src/lib/institution/permissions.ts`; `tests/adviser-db.test.ts` | Reviewer Codex | 2026-11-07 |
| F-13 | Share tokens can appear in hosting logs | Recorded, from reading | [OPERATIONS.md](../OPERATIONS.md); [OP-020 report](../CLAUDE_BATCH_06_REPORT_OP-020.md) | Founder to assign | 2026-11-07 (recorded) |

## Retention and deletion

| ID | Claim | Level | Evidence | Owner | Date |
|---|---|---|---|---|---|
| R-01 | **Backups aren't running** | Recorded; plan not re-read | [OPERATIONS.md](../OPERATIONS.md); [register](../STATUS_REGISTER.md#3-recovery-and-monitoring); [QA.md](../QA.md) | Founder | 2026-11-07 (recorded) |
| R-02 | **No restore has been rehearsed** | Recorded | [RESTORE_PROCEDURE.md](../RESTORE_PROCEDURE.md) record is blank | Founder to assign | 2026-11-07 |
| R-03 | **30 or 35 days is open** | Conflict shown | `src/app/legal/privacy/page.tsx`; [DPA template](../legal/DPA_SCHEDULE_TEMPLATE.md); [FD-03](../FOUNDER_DECISIONS.md#fd-03) | Founder, lawyer | 2026-11-07 |
| R-04 | Account deletion removes every version, report and file | Locally tested; earlier version seen on live | `tests/security-deletion.test.ts`; [QA.md](../QA.md) T24 | Reviewer Codex | 2026-11-07 |
| R-05 | Storage failure leaves the account intact for retry | Locally tested | `tests/security-deletion.test.ts`: "storage failure stops…" | Reviewer Codex | 2026-11-07 |
| R-06 | Data kept after deletion is as listed | Locally tested | `supabase/tests/security.test.mjs` "documented:" checks; [OPERATIONS.md](../OPERATIONS.md) | Founder, lawyer | 2026-11-07 |
| R-07 | Inactive students are warned, then deleted 30 days after a warning sent | Locally tested | `src/lib/jobs.ts`; `tests/security-deletion.test.ts`. **Not run on production.** | Founder to assign | 2026-11-07 |
| R-08 | Staff accounts aren't deleted for inactivity | Read in code | `retention_candidates` in `20261027170000_reminders_retention.sql` | Founder, lawyer | 2026-11-07 |
| R-09 | The erasure ledger records every deletion route, with id and date only | Locally tested; unapplied | `tests/erasure-ledger.test.ts`: first test; `supabase/migrations/20261108100000_erasure_ledger.sql` | Reviewer Codex | 2026-11-07 |
| R-10 | Simulated restore plus export re-erases; without an export, later erasures can't be found | Locally tested on simulation | `tests/erasure-ledger.test.ts`: "simulated restore", "without an export" | Reviewer Codex | 2026-11-07 |
| R-11 | No automatic ledger export exists and nothing purges the ledger | Read in code | `vercel.json` has no such job; migration comment; [procedure](../RESTORE_PROCEDURE.md#erasures-after-a-restore) | Founder, DPO | 2026-11-07 |
| R-12 | No university offboarding exists | Searched, not found | `grep -rnEi "contract end\|offboard\|end of contract" src supabase/migrations scripts docs/OPERATIONS.md docs/DEPLOY.md` | Founder to assign | 2026-11-07 |
| R-13 | Export holds the listed files | Read in code; locally tested | `src/app/api/export/route.ts`; `tests/security-tenancy.test.ts` | Reviewer Codex | 2026-11-07 |
| R-14 | Provider retention for Anthropic, Resend, Vercel and Supabase Auth logs isn't known here | Not evidenced | `[TO SUPPLY]` in [03](03_RETENTION_AND_DELETION.md) | Founder to assign | 2026-11-07 |

## Security

| ID | Claim | Level | Evidence | Owner | Date |
|---|---|---|---|---|---|
| X-01 | HSTS, CSP with nonce and frame denial are on `/sign-in` | Seen in production | [E2](../STATUS_REGISTER.md#e2) | Founder to assign | 2026-11-07 (recorded) |
| X-02 | RLS denies cross-student access on the original tables, through the public API | Seen on live, older code | `tests/e2e/live.mjs`; [QA.md](../QA.md) 52/52, later 53/53 | Founder to assign | 2026-10-30 |
| X-03 | RLS and functions hold on all 22 migrations | Locally tested, PGlite | `npm run test:db`. `auth.uid()` is stubbed. | Reviewer Codex | 2026-11-07 |
| X-04 | Cross-user and cross-university ids get nowhere | Locally tested | `tests/security-tenancy.test.ts`, `tests/adviser-actions.test.ts`, `tests/adviser-db.test.ts` | Reviewer Codex | 2026-11-07 |
| X-05 | Test and demo sign-in can't open production | Locally tested; production shows no buttons | `tests/security-auth.test.ts`, `tests/env-build.test.ts`; [E1, E2](../STATUS_REGISTER.md#e1) | Founder to assign | 2026-11-07 |
| X-06 | Production build fails if a required variable is missing | Locally tested, scratch builds | `tests/env-build.test.ts`; [release fixes](../CLAUDE_REPORT_RELEASE_FIXES.md). Not on Vercel. | Founder ([FD-13](../FOUNDER_DECISIONS.md#fd-13)) | 2026-11-07 |
| X-07 | Hostile uploads are bounded | Locally tested | `tests/security-uploads.test.ts`. Worker on Vercel unverified. | Reviewer Codex | 2026-11-07 |
| X-08 | Logs and alerts omit tested canaries | Locally tested | `tests/security-logging.test.ts` | Reviewer Codex | 2026-11-07 |
| X-09 | Application code doesn't enforce MFA | Searched, not found | `grep -rnEi "\baal\b\|aal2\|mfa" src` | Founder to assign | 2026-11-07 |
| X-10 | No malware scanning of uploads | Searched, not found | `grep -rniE "clamav\|virus\|malware" src` | Founder to assign | 2026-11-07 |
| X-11 | No dependency scanning in the repository's workflows | Searched, not found | `grep -rn "npm audit\|dependabot" .github` | Founder to assign | 2026-11-07 |
| X-12 | No penetration test, certification or independent security review | None on file | [OP-026 report](../CLAUDE_REPORT_OP-026.md); [register](../STATUS_REGISTER.md#4-legal-and-commercial) | Founder | 2026-11-07 |
| X-13 | Encryption at rest | **Not evidenced.** Template assertion. | `docs/legal/DPA_SCHEDULE_TEMPLATE.md`. `[TO SUPPLY: provider documentation. Founder.]` | Founder to assign | 2026-11-07 |
| X-14 | Rate limiter fails open on database error | Read in code; recorded | `src/lib/rate-limit.ts`; [runbook](../RELEASE_RUNBOOK.md#2-migration-order) | Founder to assign | 2026-11-07 (recorded) |
| X-15 | Security advisor last clean, for 9 migrations | Seen on live, older | [QA.md](../QA.md) | Founder to assign | 2026-10-27 |

## Accessibility (all provisional)

| ID | Claim | Level | Evidence | Owner | Date |
|---|---|---|---|---|---|
| A-01 | 171 scripted keyboard steps pass, 0 fail, on student journeys | Locally tested; not re-run | `npm run test:keyboard`; [register](../ACCESSIBILITY_REGISTER.md) | OP-027 agent, then founder to assign | 2026-11-07 (recorded) |
| A-02 | 0 axe violations on 43 route states at 4 sizes | Locally tested; not re-run. Not a pass of WCAG. | `npm run test:sweep`; [register](../ACCESSIBILITY_REGISTER.md) | OP-027 agent | 2026-11-07 (recorded) |
| A-03 | Admin pages not audited; one axe failure, which fails `test:e2e` | Recorded | A11Y-O08 | OP-021 owner | 2026-11-07 (recorded) |
| A-04 | No screen reader, no real device, no student test, no independent audit | Recorded; human gate open | [Register](../ACCESSIBILITY_REGISTER.md) results blank | Founder to assign | 2026-11-07 |
| A-05 | PDFs are untagged | Locally tested | `tests/accessibility.test.ts`; A11Y-O01 | Founder to assign | 2026-11-07 |

## Support, monitoring, recovery

| ID | Claim | Level | Evidence | Owner | Date |
|---|---|---|---|---|---|
| O-01 | No support owner, response time or escalation route exists | Recorded | [Register section 2](../STATUS_REGISTER.md#2-email-and-access) | Founder to assign | 2026-11-07 (recorded) |
| O-02 | Uptime workflow exists, every 15 minutes; runs not read | Built | `.github/workflows/uptime.yml` | Founder to assign | 2026-11-07 |
| O-03 | Alerts reach logs only | Seen in production (name absent) | [E1](../STATUS_REGISTER.md#e1); `src/lib/log.ts` | Founder to assign | 2026-11-07 (recorded) |
| O-04 | **24 or 48 hours is open** | Conflict shown | [OPERATIONS.md](../OPERATIONS.md); [DPA template](../legal/DPA_SCHEDULE_TEMPLATE.md) | Founder, lawyer | 2026-11-07 |
| O-05 | Incident, release and rollback procedures are written and not exercised | Documented only | [OPERATIONS.md](../OPERATIONS.md); [RELEASE_RUNBOOK.md](../RELEASE_RUNBOOK.md) | Founder to assign | 2026-11-07 (recorded) |
| O-06 | AI failures were exercised by simulation only | Locally tested | `tests/recovery*.test.ts`; [OP-025 report](../CLAUDE_REPORT_OP-025.md) | Reviewer Codex | 2026-11-07 |

## Facts this pack does not assert

Company details, ICO registration, insurance, certifications, legal approval, signed contracts, customers, uptime, service levels. Each is a placeholder or a stated absence. See [09_OPEN_ITEMS.md](09_OPEN_ITEMS.md).

## Statements elsewhere that go further than this evidence

**Update, 7 November 2026:** the wording and selector quoted here have since been changed. See [CLAUDE_REPORT_CLAIMS_FIXES.md](../CLAUDE_REPORT_CLAIMS_FIXES.md).

A reader comparing the site with this pack should take this pack as the current position. These were reported to the founder and not edited. Each is the founder's and reviewers' to resolve.

| Where | Says | Position in this pack |
|---|---|---|
| `src/app/legal/privacy/page.tsx` | "Backups are overwritten within 35 days." | No backups; 30 or 35 open |
| `src/app/legal/sub-processors/page.tsx` | "Each is bound by a data processing agreement. We tell partner universities before adding or replacing one." | No agreement on file; no process |
| `src/app/_landing/Landing.tsx` | Anthropic "under a data processing agreement and the UK transfer addendum" and not used for training | No agreement on file |
| `src/app/_landing/Landing.tsx` | "Ready for pilots" under "NOW" | Blockers in [07](07_UNSUPPORTED_AND_DEPENDENCIES.md) |
| `src/app/sign-in/page.tsx` | "UK GDPR", "Designed to WCAG 2.2 AA" (seen in production) | No legal review; no conformance evidence |
| `src/app/legal/accessibility/page.tsx` | 44px targets, "fully accessible" Word, manual testing | See [05](05_ACCESSIBILITY_FINDINGS.md) |
| `docs/legal/DPIA_TEMPLATE.md` | Mitigations: "calibration with advisers", "DPA + UK IDTA with Anthropic", "backup expiry", "inactivity purge" | None of these has happened or been evidenced |
