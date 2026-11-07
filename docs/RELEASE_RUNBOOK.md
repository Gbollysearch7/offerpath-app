# Production release runbook

Written 7 November 2026 for OP-028. **Nothing in this file has been run against production, and this file authorises nothing.** The release owner runs it, after the founder has approved [FD-01](FOUNDER_DECISIONS.md#fd-01) and [FD-02](FOUNDER_DECISIONS.md#fd-02). Release owner: Founder to assign.

Current state is in [STATUS_REGISTER.md](STATUS_REGISTER.md). Backups are in [RESTORE_PROCEDURE.md](RESTORE_PROCEDURE.md). Day-to-day running is in [OPERATIONS.md](OPERATIONS.md).

**Wrong-project check.** Before any Supabase command, confirm the linked ref is the intended one. The recorded production project is `levelup`, ref `gceybiizflndbkkjzprb`, London ([QA log](QA.md)). Another live app shares the same Supabase organisation. Never run a command against it.

## 1. What is being released

| Fact | Value | Evidence |
|---|---|---|
| Last commit | `8545550`, 2 November 2026 | `git log -1` |
| Work not committed | About 240 changed or new paths, including OP-003 to OP-026 | `git status --short` |
| Migrations in git at that commit | 11 | `git ls-files supabase/migrations` |
| Migrations in the working tree | 20, one of them still being written by OP-021 | `ls supabase/migrations` |
| Migrations last recorded as applied live | 11, on 30 October 2026 | [QA log](QA.md), "T24 live database" and the two later pushes |
| What production has today | **Unknown.** Check it in step 3. | No live database query was allowed for OP-028 |

The tree has never been through `next build`. Every report used dev servers or tests. The first real build happens on the preview in step 5, and the OP-007 dictionary packaging has never been exercised in one ([DEPLOY.md](DEPLOY.md)).

## 2. Migration order

`supabase db push` applies pending files in name order, so the order below is the name order. A failure stops the push and leaves earlier files applied. Check with `migration list` before retrying.

"Code" below means the working tree. "From reading" means from the code and the migration, not from a live test. All of 12 to 20 have run only in PGlite.

| # | File | Recorded live? | If it is skipped |
|---|---|---|---|
| 1 | `20261026120000_initial_schema.sql` | Yes | No application at all. Creates the core tables, RLS, the sign-up trigger, `delete_my_account` and the `cvs` bucket. |
| 2 | `20261027090000_scoring_integrity.sql` | Yes | Students keep rights to write their own reports and scores, so a score could be forged. |
| 3 | `20261027150000_rate_limits.sql` | Yes | The limiter fails open: sign-in, upload and link-fetch limits stop working, with errors logged ([rate-limit.ts](../src/lib/rate-limit.ts)). |
| 4 | `20261027160000_institution_admin.sql` | Yes | CSV import, team management and university-owned opportunities fail. Later admin functions depend on it. |
| 5 | `20261027170000_reminders_retention.sql` | Yes | The reminder and retention jobs fail, so the deletion the privacy notice promises doesn't run. |
| 6 | `20261027180000_admin_reporting.sql` | Yes | Admin dashboard, student list and outcomes pack fail. |
| 7 | `20261027190000_adviser.sql` | Yes | Adviser notes and student detail fail. |
| 8 | `20261027200000_pilot_requests.sql` | Yes | Pilot requests aren't saved. |
| 9 | `20261027210000_lock_helper_functions.sql` | Yes | Signed-out visitors can call the RLS helpers, which the security advisor flagged. |
| 10 | `20261030090000_shared_judgment_cache.sql` | Yes | Scoring fails on `judgment_cache`. **Drops `bullet_judgments`.** |
| 11 | `20261030120000_tailor_ai_usage.sql` | Yes | The tailoring limit fails, because the `tailor` kind isn't allowed. |
| 12 | `20261105120000_cv_sources.sql` | **No** | **Uploads fail, and account deletion fails at its row lookup** ([OP-026 report](CLAUDE_REPORT_OP-026.md)). Hard requirement for this code. |
| 13 | `20261106120000_score_series.sql` | **No** | Student views keep working. Admin improvement figures keep comparing across scoring versions, which is the misleading figure OP-010 fixed. Once applied, students with only pre-OP-004 reports lose their change figure ([OP-010](CLAUDE_BATCH_03_REPORT_OP-010.md)). |
| 14 | `20261107120000_security_hardening.sql` | **No** | The app runs, but sign-up metadata can still claim another student's number or fee status, and students can delete their own stored file directly. Run after 12. |
| 15 | `20261107180000_analysis_jobs.sql` | **No** | The app runs with alert `analysis-jobs-unavailable`, with no repeat-click protection and no refunds ([OP-025](CLAUDE_REPORT_OP-025.md)). **17 fails without it**, because 17 alters this table. |
| 16 | `20261107190000_proofreading_choices.sql` | **No** | **The spelling page and overview fail**, with no fallback ([OP-008](CLAUDE_BATCH_03_REPORT_OP-008.md)). |
| 17 | `20261107200000_linkedin_reports.sql` | **No** | Starting a LinkedIn review fails at the insert, with a generic error. Other report types are unaffected ([OP-018](CLAUDE_BATCH_05_REPORT_OP-018.md)). |
| 18 | `20261107210000_report_sharing.sql` | **No** | Sharing reads as off and no control is offered ([OP-020](CLAUDE_BATCH_06_REPORT_OP-020.md)). **19 doesn't need it, but 20 changes its column.** |
| 19 | `20261107220000_application_links.sql` | **No** | **The dashboard fails.** A failed `artefact_downloads` write doesn't stop a download ([OP-019](CLAUDE_BATCH_06_REPORT_OP-019.md)). |
| 20 | `20261107230000_institution_adviser_work.sql` | **No, still being written** | Institution settings, adviser casework, the access log and the adviser role are unavailable. Student calls to `my_institution` and `my_casework_unseen` are written to fail closed ([supabase-institution.ts](../src/lib/repo/supabase-institution.ts)). Admin and adviser pages need the OP-021 report's answer. It was still changing on 7 November, so don't release it until OP-021 has reported and `npm run test:db` passes on the final file ([register E7](STATUS_REGISTER.md#e7)). |

| After OP-022's `20261108090000_institutional_analytics.sql` | `20261108100000_erasure_ledger.sql` | **No** | Nothing records erasures, so a restore brings erased students back with no list to remove them by ([procedure](RESTORE_PROCEDURE.md#erasures-after-a-restore)). `erasures:export` and `erasures:reapply` fail. Adds a trigger on `auth.users`: if it can't write, the account deletion fails and is retried. From reading, untested on real Supabase. |
| After `20261108100000_erasure_ledger.sql` | `20261108110000_practice_answers.sql` | **No** | **The dashboard, interview practice and "Download my data" fail**, because they read this table ([OP-023](CLAUDE_BATCH_07_REPORT_OP-023.md)). Also widens the job and AI usage kinds. From reading, untested on real Supabase. |

Re-list the directory on the day. Other work may add files.

## 3. Pre-flight: read-only checks

None of these writes anything. Stop if a result surprises you.

```sh
vercel env ls                                   # names only; compare with section 4
npx supabase link --project-ref gceybiizflndbkkjzprb   # writes only local link state. Confirm the ref first.
npx supabase migration list --linked            # which files the live history holds
npx supabase db push --linked --dry-run         # what would be applied; applies nothing
```

The Supabase CLI isn't installed globally on the founder's machine (`which supabase` is empty), hence `npx`.

Then in the Supabase SQL editor, read-only:

```sql
-- What is applied, by history and by the objects themselves. History can disagree with reality.
select version from supabase_migrations.schema_migrations order by 1;
select to_regclass('public.judgment_cache') judgment_cache, to_regclass('public.cv_sources') cv_sources,
       to_regclass('public.analysis_jobs') analysis_jobs, to_regclass('public.proofreading_choices') proofreading_choices,
       to_regclass('public.share_links') share_links, to_regclass('public.application_links') application_links;
select pg_get_constraintdef(oid) from pg_constraint where conname in ('reports_type_check', 'ai_usage_kind_check', 'profiles_role_check');

-- How much real data is exposed to this release.
select type, count(*) from public.reports group by 1;
select count(*) from auth.users;

-- The QA data to remove before students arrive (FD-08). Read only here.
select id, name, domain from public.universities where domain = 'levelup-qa.ac.uk';
select id, email from auth.users where email like '%@levelup-qa.ac.uk';
```

Also confirm: the security advisor is clean; `main` requires the `check` job; a logical backup exists and has been read back (see below); the plan decisions in [FD-04](FOUNDER_DECISIONS.md#fd-04) and [FD-05](FOUNDER_DECISIONS.md#fd-05) are made.

**Take a restore point first.** The project is recorded on the Free plan, which has no managed backups. Without Pro, your own dump is the only way back:

```sh
npx supabase db dump --linked -f roles.sql --role-only
npx supabase db dump --linked -f schema.sql
npx supabase db dump --linked -f data.sql --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
```

These files hold personal data once real data exists. Encrypt them, keep them in the UK and delete them on the agreed schedule ([FD-03](FOUNDER_DECISIONS.md#fd-03)). They don't include stored files.

## 4. Environment variables

Vercel names were read on 7 November 2026 with `vercel env ls` ([register E1](STATUS_REGISTER.md#e1)). Values were not read, so "set" means the name exists, not that the value is right. **Preview has no variables at all.**

| Variable | Needed by current code | If missing in production | Production | Preview | Gap |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Required: the build fails | Every request would fail with 500 (section 9) | Set | None | Preview |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Required | Same | Set | None | Preview |
| `SUPABASE_SERVICE_ROLE_KEY` | Required | Same | Set | None | Preview |
| `NEXT_PUBLIC_SITE_URL` | Required, `https://` | Same | Set | None | Preview. Value must become the real domain ([FD-14](FOUNDER_DECISIONS.md#fd-14)). |
| `CRON_SECRET` | Required: the build fails | All three jobs would refuse to run, so no automatic deletion. | Set | n/a | None |
| `RESEND_API_KEY` | Required: the build fails | Emails would be logged, not sent, so inactive accounts would never be deleted. | Set | Optional | Value not verified |
| `EMAIL_FROM` | Required for real delivery | Build and boot warning. Falls back to `no-reply@offerpath.app`, a domain with no recorded verification. | Set | Optional | The checklist records it as Resend's test sender. Replace it. |
| `ANTHROPIC_API_KEY` | Needed for the AI product | Boot warning only. `/api/health` shows `"ai":"rules"` with status ok. | Set | Optional | See [FD-06](FOUNDER_DECISIONS.md#fd-06) |
| `SUPPORT_EMAIL` | Needed | Build and boot warning. Pilot requests aren't emailed, there is no reply-to, and the legal pages show a placeholder. | **Missing** | Optional | **Add** |
| `ALERT_WEBHOOK_URL` | Needed for chat alerts | Build and boot warning. Every alert goes only to logs, which Vercel keeps for a day or less (section 9). | **Missing** | Optional | **Add** |
| `LEGAL_OPERATOR_NAME` | Needed | Build and boot warning. The legal pages show a bracketed placeholder. | **Missing** | Optional | **Add** |
| `LEGAL_OPERATOR_ADDRESS` | Needed | Same | **Missing** | Optional | **Add** |
| `LEGAL_COMPANY_NUMBER` | Needed | Same | **Missing** | Optional | **Add** |
| `LEGAL_ICO_NUMBER` | Needed | Same | **Missing** | Optional | **Add** |
| `LEGAL_CONTACT_EMAIL` | Needed | Same | **Missing** | Optional | **Add** |
| `DEMO_MODE`, `DEMO_SECRET` | Preview only, if preview runs the demo | n/a | Absent, correct | None | Needed if preview uses the demo |
| `TEST_LOGIN` | Must be absent | Ignored in production by code | Absent, correct | None | None |
| `SCORING_VOTES` | Must be absent | Warned and ignored | Absent, correct | None | None |
| `ADVISER_CV_ACCESS` | Off until legal review | Off | Absent, correct | None | None |
| `RETENTION_INACTIVE_MONTHS` | Optional, default 24 | Default | Absent | None | None |
| `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`, `ANALYSIS_BUDGET_MS`, `PROOFREADING_*`, `DEMO_REPORT_SHARING` | Optional | Defaults | Absent | None | None. Don't set `PROOFREADING_EXTERNAL_TEXT_APPROVED` without FD-26. |

Outside Vercel: the GitHub repository variable `PRODUCTION_URL` must change with the domain, or the uptime check keeps watching the old address ([uptime.yml](../.github/workflows/uptime.yml)). Supabase Auth settings (site URL, redirect, SMTP, templates) aren't environment variables and are set in the dashboard ([DEPLOY.md](DEPLOY.md)).

`NEXT_PUBLIC_*` values are written in at build time, and any variable change reaches a deployment only on its next build. Redeploy after changing one.

## 5. Preview check

**A preview with no variables now builds and runs the demo:** fictional data in memory, one-click demo sign-in, no test login. This rests on Vercel setting `VERCEL=1` and `VERCEL_ENV=preview`, checked in a scratch build with those values set by hand but **not yet on Vercel**. It proves the build and the pages only: no database, no migrations, no sign-in email. Without `DEMO_SECRET`, a demo session may not survive a move between server instances. A preview holding any database variable, the service key or `ANTHROPIC_API_KEY` doesn't get this, and has to be configured properly. Choose one:

- **Staging project (needed to test migrations).** A separate Supabase project with Preview variables pointing at it, fictional data only. Apply all pending migrations there first. Needs [FD-16](FOUNDER_DECISIONS.md#fd-16).
- **Demo preview (tests the build and pages only).** Set nothing, or `DEMO_SECRET` for steadier sessions, Preview only.

Then:

1. Run CI on the release branch: typecheck, lint, engine tests, database tests, build, e2e and accessibility smoke ([ci.yml](../.github/workflows/ci.yml)).
2. Check `/api/health` on the preview: status 200, and the expected `mode`.
3. On a staging preview, run all of section 8 against fictional accounts.
4. Upload a CV with a typo and confirm the spelling page lists it rather than "couldn't run". This is the first proof the dictionaries survive a production build.
5. **Test rollback here.** With all migrations applied to staging, deploy `8545550` to a preview on the same staging database, then open a report made by the new code. Section 10 explains why.

## 6. Apply

Only with FD-01 approved, after a good preview and a read-back restore point.

1. Choose a quiet time. A bump starts a new score series for every student ([parser report](CLAUDE_REPORT_PARSER_BUMP.md)); this is visible, so warn the careers contact if one exists.
2. `npx supabase db push --linked --dry-run`, and compare with section 2.
3. `npx supabase db push --linked`.
4. `npx supabase migration list --linked`, then repeat the object queries in section 3.
5. Run the security advisor and fix anything new.
6. Check that production still works **on the old code** (`/api/health`, sign-in, one admin page). If it doesn't, stop. Section 10 applies.

If the OP-021 file isn't ready, apply 12 to 19 only, by releasing without file 20 in the branch. Don't move or rename a migration once it has been applied anywhere.

## 7. Deploy

1. Add the missing variables from section 4 first, so the new build has them.
2. Commit, open a PR, wait for the `check` job, merge. Vercel deploys production. Nothing here has been committed.
3. Note the old deployment's URL for rollback.
4. Watch the deployment logs for `[config]` lines. **A green build proves nothing about configuration**: the check runs when the server starts, not at build (section 9).

`vercel.json` adds a third cron, `/api/cron/analysis`. Confirm all three appear under Settings → Cron Jobs.

## 8. Post-deploy smoke checks

Use an account you can delete afterwards. Record date, person and result in [STATUS_REGISTER.md](STATUS_REGISTER.md).

| Check | Pass means |
|---|---|
| `/api/health` | 200, `"status":"ok"`, `"mode":"supabase"`, `"database":"ok"`, `"ai":"claude"` |
| `/sign-in` | No test sign-in buttons |
| Sign-in email | Arrives at a real inbox outside the Resend account (section 11) |
| Sign-up from another domain | Refused |
| Upload the same CV twice | Same score and no second charge |
| Upload a CV with a typo | Spelling page lists it |
| Uncertain extraction | The review screen appears, and correcting it gives a report |
| Tailor, letter draft, letter review, LinkedIn review | Each completes. The AI path is used if a key is set. |
| Dashboard | Loads, with next actions |
| Share control | Hidden for a university with sharing off |
| Admin dashboard and student list | Load |
| Each cron by hand | `curl -H "Authorization: Bearer $CRON_SECRET" https://<site>/api/cron/<reminders, retention or analysis>` returns success. Retention acts on real accounts, so run it only with the release owner present. |
| `/legal/privacy`, `/legal/terms`, `/legal/sub-processors` | No `[` placeholder is left |
| Alert channel | A test post arrives (needs `ALERT_WEBHOOK_URL`) |
| Delete the test account | Rows and stored files are gone |
| After 30 minutes | No new alerts, and the uptime workflow still passes |

## 9. What a missing variable does

Confirmed on 7 November 2026 ([register E3 to E5](STATUS_REGISTER.md#e3)).

**Errors, which stop the app:** no Supabase configuration without `DEMO_MODE=true`; only one of the URL and anon key; no service role key; no site URL, or one without `https://`. `register()` in [instrumentation.ts](../src/instrumentation.ts) calls `assertEnv()`, which throws. In a scratch Next 15.5.28 app with a throwing hook, `next build` exited 0, `next start` printed the error and stayed up, and **every route returned 500, including `/api/health`**. So it fails visibly at runtime, and the uptime check should email on its next 15-minute run, subject to GitHub's scheduling.

**What this doesn't give you:**

- A production build (`VERCEL_ENV=production`) now **fails** if any name in `REQUIRED_IN_PRODUCTION` ([env.ts](../src/lib/env.ts)) is missing or anything above would stop the boot, listing names only, so Vercel has nothing to promote. Today's list: the four above, `CRON_SECRET` and `RESEND_API_KEY`. Set-but-wrong values still pass. Checked in a scratch build; not yet on Vercel.
- The error text is in the function logs, not on the page. The student sees a generic error.
- `ANTHROPIC_API_KEY`, `EMAIL_FROM`, `SUPPORT_EMAIL`, `ALERT_WEBHOOK_URL` and `LEGAL_*` are named as warnings at build and at boot, and block nothing. Moving one to the required list is a one-line founder decision ([FD-13](FOUNDER_DECISIONS.md#fd-13)), and blocks the next deploy until it's set.
- `/api/health` still stays 200 with any of those missing.
- Set-but-wrong values pass. A revoked Anthropic key or an unverified sender shows up only at use.

Vercel's limits page gives runtime log retention as 1 hour on Hobby and 1 day on Pro (read 7 November 2026), so read these logs promptly.

## 10. Rollback

**Be clear about this before starting: migrations can't be cleanly undone.** The app can go back in seconds. The database mostly can't, and restoring it loses everything written since the backup and doesn't restore stored files.

### App

Vercel → Deployments → the previous deployment → Instant Rollback. It doesn't touch the database or undo variable changes. Check the cron list afterwards, since `/api/cron/analysis` doesn't exist in the old code and would fail with a 404.

### Which code tolerates which schema

No cell here has been tested against a real Supabase project. Section 5 step 5 is the test. "Reading" means from the code only.

| Code | Schema at 11 files | 12 to 19 applied | 20 also applied |
|---|---|---|---|
| **`8545550` (last commit)** | Current recorded state | Expected to work, from reading: it uses none of the new tables and the changes are additive. | **Unknown.** File 20 replaces `admin_students`, `admin_student_detail`, `admin_cv_path`, `admin_add_note`, `admin_set_role`, `admin_list_team` and `handle_new_user`. The JSON shapes these return must be compared with what the old admin pages read. |
| **Working tree without file 20** | **Broken:** uploads, account deletion, spelling page, overview and dashboard. | The intended pairing, once tested. | n/a |
| **Working tree with OP-021 code** | **Broken**, as above | Students see no institution content and no error, from reading. Admin configuration and casework calls fail. Check the OP-021 report. | The intended pairing, once tested |

### The data problem with rolling the app back

Once students use the new code, reports exist that the old code never expected. Check these on staging before relying on a rollback:

- `8545550` has no `report-schema.ts`, so it reads payloads raw. Reports with newer fields, or with no overall score (withheld and tailored ones), go into views written before those shapes existed.
- `linkedin` rows are a report type the old dashboard doesn't know.
- Old code has no route to corrections, share links, dismissals or application links. They stay in the database and work again when you roll forward. Share links don't resolve while the old code runs.

So an app rollback is safe with confidence **only before students have used the new code**. After that, prefer rolling forward with a fix.

### Database

Roll forward with a new migration, tested on staging. What undoing would mean:

| File | To undo | Cost |
|---|---|---|
| 12 `cv_sources` | Drop `reports.source_id` and the table | Loses all versions, corrections and typed text. Scored reports lose their source. |
| 13 `score_series` | Restore two earlier function bodies, drop the attribute | No data lost; misleading admin figures return |
| 14 `security_hardening` | Don't. | Would reopen the sign-up hole |
| 15 `analysis_jobs` | Drop the table, functions and `ai_usage.failed` | Loses job history and failure counts |
| 16 `proofreading_choices` | Drop the table | Loses dismissals and language choices. New code then fails. |
| 17 `linkedin_reports` | Delete `linkedin` rows first, then restore the constraints | Loses LinkedIn reviews |
| 18 `report_sharing` | Drop the tables, functions and column | All links stop. Loses the access log. |
| 19 `application_links` | Drop the tables, trigger and column | Loses links and dismissal reasons |
| 20 `institution_adviser_work` | Not sensible once in use | Loses the access log and casework, which are meant to be permanent history. Advisers would first need their role removed. |

Restore from backup only for data loss or corruption ([RESTORE_PROCEDURE.md](RESTORE_PROCEDURE.md)). That procedure has **not been rehearsed**.

## 11. Testing email: sandbox is not delivery

There are two separate paths, and neither has a recorded real delivery. [QA log](QA.md): "Not tested: real sign-in emails".

| Path | Sends | Configured in |
|---|---|---|
| App mail | Deadline reminders, retention warnings, pilot requests | `RESEND_API_KEY`, `EMAIL_FROM` ([email.ts](../src/lib/email.ts)) |
| Auth mail | Sign-in and confirmation links | Supabase Auth SMTP settings. **Not an environment variable, and a working app-mail setup says nothing about it.** |

Record every test with its type. Only the last row counts as delivery.

| Type | What it is | What it proves | Counts as delivery? |
|---|---|---|---|
| Logged | No `RESEND_API_KEY`: `email-not-sent-no-provider` in the log | The code path ran | No |
| Unit test | Fake `fetch` | Formatting and error handling | No |
| Resend test sender | Sending from Resend's shared test address, which only reaches the account owner | The key works | No |
| Resend test recipient | Sending to Resend's simulated addresses | The API accepts it and events fire | No |
| Supabase built-in mail | Reaches team addresses only and is rate-limited | Auth flow works | No |
| `sent: true` from `sendEmail` | Resend accepted the message | Acceptance only. It doesn't show it arrived. | No |
| **Real delivery** | Verified domain (SPF, DKIM, DMARC passing), sent to an inbox the sender doesn't control, ideally on a partner university's domain, where institutional filtering applies. Opened in the inbox; link works; not in spam; headers checked. | That a student can receive it | **Yes.** Record the date, path, recipient domain and Resend or Supabase log id. Don't record the address. |

Test both paths separately, and test the sign-in link end to end, because university mail scanners can open links before the student does and may use up a one-time link.

| Date | Path | Type | Recipient domain | Result | By |
|---|---|---|---|---|---|
| (none recorded) | | | | | |
