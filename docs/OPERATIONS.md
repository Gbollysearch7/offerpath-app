# Operations guide

How Offerpath is run once it's live: environments, database changes, backups, rollback, monitoring and
incidents. For the first deployment, see [DEPLOY.md](DEPLOY.md). For a production release, see [RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md). What's actually in place is in [STATUS_REGISTER.md](STATUS_REGISTER.md): this guide says how things should run, and not all of it is running yet.

## Environments

| Environment | App | Database | Used for |
|---|---|---|---|
| Local | `npm run dev` | None (demo mode) or a local Supabase stack (`supabase start`) | Building and testing |
| Staging | Vercel preview deployments | **Doesn't exist yet.** Planned: a separate Supabase project, UK/EU region. Preview has no variables today ([FD-16](FOUNDER_DECISIONS.md#fd-16)). | Testing migrations and releases on real infrastructure |
| Production | Vercel production (`lhr1`, London), project `offerpath-app` | Supabase project `levelup` (`gceybiizflndbkkjzprb`), London (`eu-west-2`), recorded on Free | Students and universities |

Staging and production never share a database, keys or storage bucket. Staging data must be fictional or
anonymised; never copy production data into staging.

## Database changes (migrations)

Every schema change is a new file in `supabase/migrations/`. **Never edit a migration that has been applied
anywhere.** Fix mistakes with a new migration.

1. Create it: `supabase migration new <short_name>` (or add `YYYYMMDDHHMMSS_name.sql` by hand).
2. Write the SQL. Every new table needs RLS enabled, and grants kept as narrow as possible
   (see existing migrations for the pattern).
3. Test locally: `npm run test:db` applies every migration to an in-memory Postgres and checks RLS, grants
   and functions. Add tests for anything new in `supabase/tests/schema.test.mjs`.
4. Apply to staging: `supabase link --project-ref <staging-ref>` then `supabase db push`.
   Check the app on the staging URL.
5. Apply to production the same way, **before** deploying app code that depends on it.
   Write migrations so the old app version still works after they run (add columns before using them;
   remove columns only after the code that reads them is gone).
6. Run the security advisor on both projects (Supabase dashboard → Advisors) and fix anything new.

If you change scoring (`src/lib/analysis/rubric.ts`, `lexicon.ts` or `JUDGE_SYSTEM` in `src/lib/ai.ts`),
bump `RUBRIC_VERSION`. Old cached judgments then stop being used, and re-uploads are re-scored under the new
rubric.

## Releases

1. Open a pull request. CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit tests, database tests,
   a build and the end-to-end accessibility smoke test.
2. Vercel builds a preview pointing at staging. Check the change there.
3. Apply any migration to production (above), then merge. Vercel deploys production automatically.
4. After deploying, check `/api/health` returns `"status": "ok"` and watch the alert channel for 30 minutes.

## Rollback

- **App:** Vercel dashboard → Deployments → previous deployment → *Instant Rollback*. Takes seconds and
  doesn't touch the database.
- **Database:** roll forward. Write a new migration that undoes the change, test it on staging, apply it.
  Only restore from backup (below) for data loss or corruption, because a restore also loses everything
  written since the backup.

## Backups and restore

**None of this is running yet.** The project is recorded on Free, which has no managed backups ([FD-04](FOUNDER_DECISIONS.md#fd-04)). The full procedure is in [RESTORE_PROCEDURE.md](RESTORE_PROCEDURE.md).

- Supabase Pro keeps 7 days of daily backups. **Point-in-Time Recovery** is a paid add-on that restores to any second
  in the retention window and replaces the daily backups. Supabase dashboard → Database → Backups.
- Weekly, keep an independent logical backup in UK storage you control:
  `supabase db dump --linked -f backup.sql` and `supabase db dump --linked --data-only -f data.sql`,
  encrypted at rest, kept for 35 days, then deleted. This matches the privacy notice, but **the DPA schedule says 30 days**. Awaiting [FD-03](FOUNDER_DECISIONS.md#fd-03). A plain dump doesn't restore everything: see the procedure.
- CV files live in the `cvs` storage bucket. Supabase backups don't include storage objects, so copy the
  bucket weekly with the storage API or `rclone` to the same encrypted UK location.
- **Test a restore every term,** following [RESTORE_PROCEDURE.md](RESTORE_PROCEDURE.md), and write the date and result below. Use fictional data unless
  [FD-22](FOUNDER_DECISIONS.md#fd-22) says otherwise. `npm run test:db` can't check a restore: it builds its own in-memory database.

| Restore drill | Date | Result |
|---|---|---|
| Not rehearsed. First drill due before pilot launch. | | |

Deleting an account (by the student or by the retention job) removes their rows and files at once.
Backups keep them until the backup expires (35 days, pending [FD-03](FOUNDER_DECISIONS.md#fd-03)). The privacy notice says this without a period, until that is decided ([FD-84](FOUNDER_DECISIONS.md#fd-84)).

## Data lifecycle and deletion

What happens to each kind of data, and what removes it. Code: `src/lib/account-deletion.ts`, `delete_my_account()`,
`runRetention()`. Tests: `tests/security-deletion.test.ts`, `supabase/tests/security.test.mjs`. Nothing below has been
run against the production database or storage; the tests use a fake and PGlite.

| Data | Where | Removed when | How |
|---|---|---|---|
| Original uploaded files | `cvs` bucket, under the user's id | Account deleted | Removed first and checked gone; if any step fails the account stays, intact, for a retry. Swept again after the rows go. |
| Proofreading choices: dismissals, reopenings, language, with the quoted word (`proofreading_choices`) | Postgres | Account or report deleted | Cascade. Otherwise append-only. |
| CV versions: upload, corrections, typed text (`cv_sources`) | Postgres | Account deleted | Cascade. Not otherwise expired, including a version held and never scored (see the OP-026 report's open question). |
| Reports: CV reviews, letters, tailored CVs, LinkedIn reviews with every saved section version (`reports`) | Postgres | Account deleted | Cascade. Generated Word and PDF downloads aren't stored: they're built per request and sent `no-store`. |
| Share links and their access log (`share_links`, `share_link_access`): a token hash, scope, dates and the time of each view. No document text, no recipient details | Postgres | Account or report deleted, or 90 days after the link expired | Cascade; `runRetention()` purges old links. |
| Application links, document versions sent, recommendations dismissed and why (`application_links`, `artefact_downloads`, `action_choices`). Ids, hashes and fixed reasons, no document text | Postgres | Account deleted; a link or download also with its report; a link also when the role stops being tracked | Cascade. `action_choices` is otherwise append-only. Not visible to advisers. |
| Interview practice: written answers, the question, its feedback, and which CV and advert versions it came from (`practice_answers`). Text only. Quotes the student's own CV and answer | Postgres | Student deletes it; account deleted, by any route including the retention job; the CV or advert report it quotes is deleted | Cascade. A role that stops being tracked lets go of the answer and keeps it. Not otherwise expired. Not visible to advisers or admins: no policy or function reads it. Writing one counts as activity for the inactivity clock. In "Download my data". |
| Adviser notes about the student | Postgres | Student's account deleted | Cascade. |
| Adviser disagreements, referrals and referral history (`adviser_disagreements`, `adviser_referrals`, `adviser_referral_events`). Attributed, in the adviser's words; visible to the student | Postgres | Student's account deleted; a disagreement also with its report | Cascade. Otherwise append-only: the database refuses edits. |
| Staff access log (`staff_access_log`): who opened which student, exported or changed what, including refusals. No IP address, browser or location; no document text | Postgres | 24 months, by the retention job (legal review needed) | See below: on account deletion the entry stays with the student's id removed. |
| Applications, reminder log, AI usage counts | Postgres | Account deleted | Cascade. |
| Profile, sign-in identity | Postgres, Supabase Auth | Account deleted | Deleting the auth user cascades. Supabase's own auth audit log is outside this list and its retention is Supabase's. |
| Temporary processing data | Memory only | End of request | Files are read in a worker thread; nothing is written to disk (a test forbids temp-file calls in `src/`). |
| Analysis job records (`analysis_jobs`): workflow, state, counts, cost, a hashed or id-based key. No document text | Postgres | Account deleted, or 90 days | Cascade; `/api/cron/analysis` purges finished rows. |
| Rate-limit counters | Postgres | Within a week | Keys are SHA-256 hashes, never an email or IP. The limiter purges at random; the weekly retention job purges anything over a day old. |
| Emails sent | Resend | Resend's retention | Name, deadline roles. Not deleted with the account; check against the DPA. |
| Text sent for AI feedback | Anthropic | Anthropic's retention | Per the provider agreement. Not recallable from here. |
| Application logs | Vercel | Within 30 days at most, per the privacy notice. In practice sooner: Vercel's limits page gives 1 hour on Hobby and 1 day on Pro, and there's no setting that lengthens it without a drain ([FD-05](FOUNDER_DECISIONS.md#fd-05)) | Contain ids and counts: the user id and report id can remain until they expire. |
| Backups | Supabase, weekly dump | 35 days | A deleted account is in backups until they expire. If a backup is restored, those accounts must be deleted again: see [the procedure](RESTORE_PROCEDURE.md#erasures-after-a-restore), including the off-site export it depends on ([FD-21](FOUNDER_DECISIONS.md#fd-21)). |

Kept after an account is deleted, on purpose:

| Data | Why | Removed when |
|---|---|---|
| `student_records` (the university's import: email, student number, course, faculty, fee status) | The university's own data, applied when a student signs up | The university's retention, or on contract end. **No self-service removal yet: founder and DPA decision.** |
| `judgment_cache` | Labels keyed by a hash; holds no text and no user id | Never |
| A deleted **adviser's** notes on students who remain, with `author_name` | Part of the student's record | With the student's account |
| `staff_access_log` entries about a deleted student, with `student_id` removed and a member of staff's name kept | The university can still answer who accessed what | After 24 months, by the retention job |
| Institution configuration (`institution_settings`, `programme_groups`, `institution_resources`, `institution_contacts`) | The university's own; no student data | With the university |
| `pilot_requests` (name, email of someone who enquired) | Never linked to an account | **No rule yet: founder decision.** |

Automatic deletion needs `CRON_SECRET` (the job refuses to run without it) and `RESEND_API_KEY` (an account is deleted
only 30 days after a warning that was actually sent). The boot log warns if either is missing.

If the alert `account-file-sweep-failed` fires, a deleted account may have a file left. List the `cvs` bucket under the
user id in the alert and delete what's there. The id no longer matches an account.

## Report sharing setting (OP-020)

Share links are off for every university until `universities.report_sharing_enabled` is set, with the service role or
in the SQL editor. No admin screen sets it. Whether it is on by default is an open founder decision. Switching it off
stops every link at that university on its next request, and switching it back on revives those not revoked or expired.
Demo mode reads `DEMO_REPORT_SHARING=true` instead. Hosting request logs record URL paths, so **a share URL can appear in
Vercel logs**: treat those logs as containing live links until they expire.

## Scheduled jobs

Defined in `vercel.json`, protected by `CRON_SECRET` (Vercel sends it as a Bearer token).

| Job | Schedule (UTC) | What it does |
|---|---|---|
| `/api/cron/reminders` | Daily 08:00 | Emails students a week before a tracked deadline closes (if they opted in) |
| `/api/cron/retention` | Mondays 03:00 | Warns accounts inactive for `RETENTION_INACTIVE_MONTHS`, deletes them 30 days after the warning |
| `/api/cron/analysis` | Daily 06:15 | Settles analysis whose server was killed, purges job rows over 90 days old, logs each workflow's figures, alerts on a high failure rate |

Run one by hand: `curl -H "Authorization: Bearer $CRON_SECRET" https://<site>/api/cron/reminders`.
All three are safe to run twice: reminders are logged and never re-sent, warnings are only sent once, and the analysis job only settles and purges what is already due. Retention deletes accounts whose time is up, so run it by hand only on purpose.

## Monitoring and alerts

- **Health:** `/api/health` checks the database and reports the mode. `.github/workflows/uptime.yml` checks it every
  15 minutes (3 tries) and GitHub emails the repository owner on failure. It stays 200 when email, cron or AI keys are missing. A monitor that checks every minute would be better once there are students.
- **Logs:** structured JSON in Vercel logs, through `src/lib/log.ts`. It drops document and secret fields by name, removes keys, tokens and email addresses from every string, drops error messages that quote their input (parse failures), and truncates rather than passes through anything too deeply nested. Alerts to the webhook go through the same scrubbing. It can't recognise a name in free text, so code logs ids and counts, never content.
- **Alerts:** set `ALERT_WEBHOOK_URL` (Slack or Teams incoming webhook). It isn't set yet, so alerts only reach the logs. Unhandled server errors, scoring
  failures and failed cron jobs post there, throttled so one fault doesn't flood the channel.
- **AI spend:** check Anthropic console usage weekly. Per-user limits are in `src/lib/rate-limit.ts`, and
  daily per-user AI caps in the `ai_usage` table. Cost per workflow: see "Analysis recovery and cost".

## Analysis recovery and cost (OP-025)

Code: `src/lib/analysis-job.ts`, `src/lib/provider.ts`, `src/lib/analysis/job-state.ts`; migration `20261107180000_analysis_jobs.sql`
(**not yet applied anywhere**; without it the app runs, with alert `analysis-jobs-unavailable` and no repeat protection or refunds).

There is no background worker. A job runs in the request that asked for it, inside the 60-second function limit: provider work stops
at 50 seconds, and each call is capped at 45. Every page whose actions reach the provider declares `maxDuration = 60`; a test checks them.

| State | Meaning |
|---|---|
| `queued` | Recorded, not started, because a concurrency limit was full. The student's retry with the same key starts it. Expires after an hour. |
| `processing` | A server run holds it, under a 90-second lease (longer than any run can live). |
| `completed` | Done. |
| `partial` | Done with part unavailable: a rule-based draft because the provider failed, or proofreading unavailable. |
| `failed` | Nothing produced, and the use given back. `error_code` says why. A retry starts it again. |

**Quota.** A use is taken when the provider is about to be asked and given back if the student doesn't receive what they asked for.
Failures that reached the provider are counted in `ai_usage.failed`, with their own daily cap (`AI_FAILED_LIMITS`), because they still cost money.

**Limits.** Three running jobs per student and 40 across all students (soft; `JOB_POLICY`), 8 calls in flight per server instance, 2 attempts
per call, 3 failures in a row before a piece of work rests for 5 minutes. After 5 outage failures in a row an instance stops calling the provider
for 30 seconds (per instance, so several instances each find out for themselves).

**Reading the figures.** Each attempt logs an `analysis-job` line, and the daily job an `analysis-metrics` line per workflow, with counts only. Or, in the SQL editor:
`select * from public.analysis_metrics(now() - interval '7 days');`. `cost_per_completed_micros` is millionths of a dollar, and spreads failed attempts' cost over
what finished. It is an estimate of **provider cost only**, from the prices in `src/lib/provider.ts`: it leaves out storage, exports and support, and the
attempt of a run killed at the time limit (its usage was in memory). Check it against the provider's invoice. `cost_incomplete_jobs` counts jobs whose price is unknown or estimated (a fallback model).

**Rehearsing failures.** `npx tsx` on `tests/recovery*.test.ts` (see `npm run test:engine`) simulates outages, hangs, invalid output and spent balances with no paid traffic.

| Alert | Means | Do |
|---|---|---|
| `ai-provider-outage` | Provider calls paused on an instance after repeated failures | Check the provider's status page. It recovers by itself. |
| `ai-budget-exhausted` | The provider says credit or a spend limit has run out | Top up. AI features fail with "try again" until then. |
| `analysis-jobs-unavailable` | The job store can't be reached, or the migration isn't applied | Apply the migration, or check the database. |
| `analysis-error-rate` | A workflow failed 20% or more of at least 20 attempts in 24 hours | Read the `analysis-metrics` and `analysis-job` lines for `failures`. |

## Secrets

All secrets live in Vercel environment variables (production and preview separately), never in the repo.
Rotate on staff changes or any suspected leak:

| Secret | Rotate by |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → roll key, update Vercel, redeploy |
| `ANTHROPIC_API_KEY` | Anthropic console → new key, update Vercel, delete old key |
| `RESEND_API_KEY` | Resend → new key, update Vercel and Supabase SMTP settings |
| `CRON_SECRET` | Generate (`openssl rand -hex 32`), update Vercel |
| `DEMO_SECRET` | Only used in demo mode |

## Incidents

1. **Contain:** roll back the app, or turn off the affected feature with its environment variable
   (for example unset `ADVISER_CV_ACCESS`). For a suspected breach, rotate the service role key first.
2. **Assess:** what data, how many people, which universities. Supabase logs and Vercel logs.
3. **Tell the university DPO within 24 hours** of becoming aware of a personal data breach (they are the
   controller and must decide on reporting to the ICO within 72 hours). Contract terms are in the DPA schedule.
   The period is an open conflict: this page says 24 hours and the DPA template said 48 ([FD-82](FOUNDER_DECISIONS.md#fd-82)).
4. **Fix and review:** write up the cause and the fix, and add a test that would have caught it.
