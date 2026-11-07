# OP-028 report: operational documents and recovery

Prepared 7 November 2026 by Claude, for independent acceptance review by Codex. Worked in a shared uncommitted tree with the OP-021, OP-027 and LinkedIn fix agents. Nothing was committed, pushed or deployed. No migration was applied, no live configuration changed, no email was sent, nothing was restored and no live service was written to.

**Status: Partial.** The documents are done. A restore rehearsal and production verification need an authorised owner. OP-028's acceptance requires "an actual dated result" for the restore, and there isn't one: **not rehearsed**.

## Task status

| Requirement | Status |
|---|---|
| One status register | Implemented: [STATUS_REGISTER.md](STATUS_REGISTER.md) |
| Stale claims resolved | Implemented: 30 corrections below |
| Founder decision list | Implemented: [FOUNDER_DECISIONS.md](FOUNDER_DECISIONS.md), FD-01 to FD-79. OP-021, OP-027 and the LinkedIn fix hadn't reported, so theirs aren't in it. |
| Release runbook | Implemented: [RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md). Not run. |
| Restore procedure | Implemented: [RESTORE_PROCEDURE.md](RESTORE_PROCEDURE.md). **Not rehearsed.** |
| Email notes separate sandbox from delivery | Implemented: [runbook section 11](RELEASE_RUNBOOK.md#11-testing-email-sandbox-is-not-delivery). **No real delivery has ever been recorded.** |
| Verify mail, onboarding, recovery, domains, monitoring on production | **Open.** Needs an authorised owner. |
| Every unresolved item has an owner | Done. Most say "Founder to assign", because the founder is the only person the documents name. |

## Does a missing required production variable fail visibly?

**Partly.** It's visible at runtime, but not at build, and only for four variables.

- **Fails:** no Supabase configuration, half of it, no service role key, no site URL or a non-https one. `assertEnv()` throws in `register()`. In a scratch Next 15.5.28 app with a throwing hook, every route, including `/api/health`, returned 500. The error was in the logs.
- **Not caught at build:** `next build` exited 0 in that test, so Vercel can promote a deployment that serves nothing. Not tested on Vercel.
- **Warns only, health stays 200:** `CRON_SECRET`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`. A missing `CRON_SECRET` silently stops automatic deletion ([FD-13](FOUNDER_DECISIONS.md#fd-13)).
- **Not checked at all:** `EMAIL_FROM`, `SUPPORT_EMAIL`, `ALERT_WEBHOOK_URL`, `LEGAL_*`.

Evidence: [E3 to E5](STATUS_REGISTER.md#e3). This is a design gap, not fixed here because source was out of scope.

## Environment gaps

From `vercel env ls` on 7 November; names only ([E1](STATUS_REGISTER.md#e1)). The code's references were re-listed at the end.

- **Missing on Production (7):** `SUPPORT_EMAIL`, `ALERT_WEBHOOK_URL`, `LEGAL_OPERATOR_NAME`, `LEGAL_OPERATOR_ADDRESS`, `LEGAL_COMPANY_NUMBER`, `LEGAL_ICO_NUMBER`, `LEGAL_CONTACT_EMAIL`.
- **Preview has no variables,** and a preview counts as a production configuration, so previews should fail at boot. The runbook's preview step can't pass until this is fixed.
- **Correctly absent:** `TEST_LOGIN`, `SCORING_VOTES`, `DEMO_MODE`, `ADVISER_CV_ACCESS`.
- **Values not checked.** `EMAIL_FROM` is recorded as Resend's test sender, and `NEXT_PUBLIC_SITE_URL` must change with the domain.

## Corrections

| # | Where | Was | Now | Evidence |
|---|---|---|---|---|
| 1 | LAUNCH_CHECKLIST | Presented as current status | Marked as history, pointing to the register | This task |
| 2 | LAUNCH_CHECKLIST T24 | 9 migrations | 11 recorded, 9 more pending | QA log, `ls` |
| 3 | LAUNCH_CHECKLIST T13 | Ticked: backups, staging | Written down only | E1, no backup record |
| 4 | LAUNCH_CHECKLIST T15 | Ticked for the old script | Replaced by OP-011; no adviser has marked | OP-011 |
| 5 | LAUNCH_CHECKLIST T17 | Ticked | Automated checks aren't conformance | Register rules |
| 6 | LAUNCH_CHECKLIST "Test sign-in off" | "Remove the variable" | It's absent; only the accounts remain | E1, E2 |
| 7 | LAUNCH_CHECKLIST #5 | "Deployed and healthy" | Dated, with the missing variables | E1 |
| 8 | LAUNCH_CHECKLIST #6 | Partly done | Open; previews expected to fail | E1, E4 |
| 9 | LAUNCH_CHECKLIST #4, #7 | "`CRON_SECRET` is set"; webhook unstated | Name exists; webhook not set | E1 |
| 10 | LAUNCH_CHECKLIST pilot heading | Dated 2026-11-02, now past | Date moved to a note | Today's date |
| 11 | DEPLOY | Two cron jobs | Three | `vercel.json` |
| 12 | DEPLOY | "Turn on PITR" | A decision, a paid add-on replacing dailies | Supabase docs, FD-04 |
| 13 | DEPLOY | "Refuses to start" | Build succeeds, every request 500 | E5 |
| 14 | DEPLOY | Implied it covers releases | New projects only; points to runbook | This task |
| 15 | OPERATIONS | `offerpath-prod`, `offerpath-staging` | `levelup`; staging doesn't exist | QA log, E1 |
| 16 | OPERATIONS | Backups written as in place | "None of this is running yet" | QA log, no record |
| 17 | OPERATIONS | Pro and PITR both implied | PITR replaces the dailies | Supabase docs |
| 18 | OPERATIONS | 35 days "matches the privacy notice" | Also conflicts with the DPA; awaiting FD-03 | DPA schedule |
| 19 | OPERATIONS | Restore drill runs `npm run test:db` "against the schema" | **It can't: it builds its own PGlite.** Points to the procedure | `schema.test.mjs` |
| 20 | OPERATIONS | Restore drill used production backup, while the same file forbids copying production data | Fictional data unless FD-22 decides otherwise | OPERATIONS |
| 21 | OPERATIONS | Re-run deletion for accounts deleted since a backup | Nothing records which they are: FD-21 | `grep` of `src` and migrations |
| 22 | OPERATIONS | Logs "within 30 days; set this in Vercel" | 1 hour or 1 day; not a setting | Vercel limits page |
| 23 | OPERATIONS | "Both are safe to run twice" | All three, with retention's caution | `vercel.json` |
| 24 | OPERATIONS | Uptime every minute | The real 15-minute workflow, and its limits | `uptime.yml` |
| 25 | OPERATIONS | "Set" the webhook | Not set yet | E1 |
| 26 | PLAN | Old cache key, `bullet_judgments`, no `linkedin`, falls back on any error | Current | Migrations, `ai.ts`, OP-025 |
| 27 | PLAN | Project uncreated, reminder job not built | Done, under `levelup`; no real delivery | QA log, `vercel.json` |
| 28 | README | `RUBRIC_VERSION` in `judgment.ts` | `rubric.ts` | `grep` |
| 29 | README | Seed with no warning, demo unconditional, "always" a fallback | Corrected | DEPLOY, `env.ts` |
| 30 | `.env.example` | "`offerpath` project"; two variables undocumented | `levelup`; added | QA log, `env.ts` |

[QA.md](QA.md) got a pointer only, since it's a dated log. The reports and the register of tasks are unedited history. [FD-03](FOUNDER_DECISIONS.md#fd-03) remains **unresolved**, by design: the notice and DPA still disagree until the founder and a lawyer decide. `.env.example` wasn't strictly a document I owned; the edit touches only comments and two blank optional lines.

## Findings beyond the brief

**Defects, reported, not fixed:**

1. **A restore brings back erased students, with no list to remove them by** ([FD-21](FOUNDER_DECISIONS.md#fd-21)).
2. **Previews should all fail today** (E1, E4).
3. **Rolling the app back after students use the new code isn't known to be safe.** `8545550` has no `report-schema.ts`, and hasn't seen `linkedin` rows or the new payloads. Untested ([runbook section 10](RELEASE_RUNBOOK.md#10-rollback)).
4. **Migration 20 replaces admin functions the old code calls.** Compatibility is unknown. Test before relying on rollback.
5. **`legal.lastUpdated` still says 27 October 2026,** though the notice has changed since (FD-25).
6. **The sign-in page says "Designed to WCAG 2.2 AA"** on production. For OP-027 and a lawyer to weigh: the accessibility statement is the proper place, and T08 was meant to have corrected the badge.
7. **Log retention undercuts two things:** OP-025's metric lines and any incident investigation can vanish within a day or an hour. OP-021's `staff_access_log` addresses the adviser-access promise once applied.
8. Stale items in files I don't own (FD-79): `.gitignore`, `rubric.ts:2`, `ai.ts:12`.

**Closed by evidence:** `SCORING_VOTES` isn't set; `TEST_LOGIN` isn't set; the landing claims OP-011 and OP-015 flagged are gone; OP-020's two guard failures now pass ([FOUNDER_DECISIONS.md section G](FOUNDER_DECISIONS.md#g-closed-with-evidence)).

## Validation

| Check | Result |
|---|---|
| `git diff --check -- docs README.md .env.example` | Clean, exit 0 |
| New files, trailing whitespace | None |
| Links and anchors in the four new documents, by script | All resolve (this report was the one exception, until written) |
| Register rows with an evidence link or command, by script | 94 rows checked; none empty. "No evidence" is stated outright for insurance and contracts. |
| `tests/env.test.ts` | 3 pass |
| `npm run test:engine` (shared tree) | 804 pass, 0 fail |
| `npm run test:db` (shared tree) | First: 6 failures in OP-021's work in progress. Last, 04:08: exit 0, 392 pass, 0 fail. |
| `checkEnv()` with fake values | [E4](STATUS_REGISTER.md#e4) |
| Scratch Next app with throwing hook | [E5](STATUS_REGISTER.md#e5). Built in the session scratchpad, not the repo. |
| Secrets in the new documents, by pattern | None |

Not run: `next build` or a dev server in this directory, typecheck, lint, e2e, `test:live`.

## Limitations

- **Not read, deliberately:** `/api/health`, the live database, Supabase settings, Resend, GitHub issues and workflow runs, Vercel plan. Only `vercel env ls` and the sign-in page were in scope. What production has applied is **unknown**; the last record is 30 October.
- **Boot behaviour was tested in a scratch app, not on Vercel or with the Offerpath code.**
- **The compatibility matrix is from reading code.** Migration 12 to 20 behaviour on a real Supabase is untested; PGlite stubs auth and storage.
- **Supabase and Vercel facts** came from their docs on 7 November 2026. The commands weren't run. Prices and limits change.
- **Recommendations are my judgement,** especially FD-03, FD-12, FD-18 and FD-19, and need the founder and a lawyer or adviser.
- **Other agents were editing.** Migration 20 changed during this work (its mtime moved to 04:02). Re-check it, and the OP-021 and OP-027 reports, against these documents.
- **FD-06:** no report records why the Anthropic key needs replacing. It's listed because the brief named it.

## Migration impact

None. No SQL written or applied.

## Files changed

New: `docs/STATUS_REGISTER.md`, `docs/FOUNDER_DECISIONS.md`, `docs/RELEASE_RUNBOOK.md`, `docs/RESTORE_PROCEDURE.md`, `docs/CLAUDE_REPORT_OP-028.md`.

Edited: `docs/LAUNCH_CHECKLIST.md`, `docs/DEPLOY.md`, `docs/OPERATIONS.md`, `docs/PLAN.md`, `docs/QA.md`, `README.md`, `.env.example`. Some of these also hold other agents' uncommitted edits. No source code edited.

## Checks Codex must rerun

1. `vercel env ls`, against [E1](STATUS_REGISTER.md#e1).
2. `npm run test:db` on the final migration 20.
3. Each correction above against its evidence.
4. By reading: section 2 of the runbook against each migration and the repo code, especially "what breaks".
5. Section 10's matrix: deploy `8545550` on a fully migrated staging database, under an authorised scope.
6. Whether `FOUNDER_DECISIONS.md` missed anything from the reports' unresolved lists.

## Unresolved questions

See [FOUNDER_DECISIONS.md](FOUNDER_DECISIONS.md). In order: FD-02, FD-01 and FD-16, FD-04 and FD-22, FD-14, FD-15 and FD-03, FD-08 and FD-06.

The owner of the rehearsal and the release: Founder to assign.
