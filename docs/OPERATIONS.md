# Operations guide

How Offerpath is run once it's live: environments, database changes, backups, rollback, monitoring and
incidents. For the first deployment, see [DEPLOY.md](DEPLOY.md).

## Environments

| Environment | App | Database | Used for |
|---|---|---|---|
| Local | `npm run dev` | None (demo mode) or a local Supabase stack (`supabase start`) | Building and testing |
| Staging | Vercel preview deployments | Separate Supabase project (`offerpath-staging`), UK/EU region | Testing migrations and releases on real infrastructure |
| Production | Vercel production (`lhr1`, London) | Supabase project (`offerpath-prod`), London region (`eu-west-2`) | Students and universities |

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

- Supabase Pro takes daily backups. Turn on **Point-in-Time Recovery** for production (restore to any second
  in the retention window). Supabase dashboard → Database → Backups.
- Weekly, keep an independent logical backup in UK storage you control:
  `supabase db dump --linked -f backup.sql` and `supabase db dump --linked --data-only -f data.sql`,
  encrypted at rest, kept for 35 days, then deleted (matches the privacy notice).
- CV files live in the `cvs` storage bucket. Supabase backups don't include storage objects, so copy the
  bucket weekly with the storage API or `rclone` to the same encrypted UK location.
- **Test a restore every term:** restore the latest backup into a scratch project, run `npm run test:db`
  against the schema, and spot-check row counts. Write the date and result in this file.

| Restore drill | Date | Result |
|---|---|---|
| (first drill due before pilot launch) | | |

Deleting an account (by the student or by the retention job) removes their rows and files at once.
Backups keep them until the backup expires (35 days). The privacy notice says so.

## Scheduled jobs

Defined in `vercel.json`, protected by `CRON_SECRET` (Vercel sends it as a Bearer token).

| Job | Schedule (UTC) | What it does |
|---|---|---|
| `/api/cron/reminders` | Daily 08:00 | Emails students a week before a tracked deadline closes (if they opted in) |
| `/api/cron/retention` | Mondays 03:00 | Warns accounts inactive for `RETENTION_INACTIVE_MONTHS`, deletes them 30 days after the warning |

Run one by hand: `curl -H "Authorization: Bearer $CRON_SECRET" https://<site>/api/cron/reminders`.
Both are safe to run twice: reminders are logged and never re-sent, and warnings are only sent once.

## Monitoring and alerts

- **Health:** `/api/health` checks the database and reports the mode. Point an uptime monitor at it
  (every minute, alert after 2 failures).
- **Logs:** structured JSON in Vercel logs. Personal data (emails, CV text, names) is redacted before logging.
- **Alerts:** set `ALERT_WEBHOOK_URL` (Slack or Teams incoming webhook). Unhandled server errors, scoring
  failures and failed cron jobs post there, throttled so one fault doesn't flood the channel.
- **AI spend:** check Anthropic console usage weekly. Per-user limits are in `src/lib/rate-limit.ts`, and
  daily per-user AI caps in the `ai_usage` table.

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
4. **Fix and review:** write up the cause and the fix, and add a test that would have caught it.
