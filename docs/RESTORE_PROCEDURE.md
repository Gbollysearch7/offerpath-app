# Backup restore procedure

**Status: not rehearsed.** No restore of any Offerpath backup has ever been performed, and none was performed for OP-028. OP-028's acceptance needs an actual dated result, so it stays open until someone authorised fills in the record at the end. Rehearsal owner: Founder to assign.

Written 7 November 2026. Supabase commands follow its documentation, read that day ([backup and restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [database backups](https://supabase.com/docs/guides/platform/backups)). They have not been run here. Check them against the docs on the day.

## Rules

- **Isolated test resources only.** Two new, throwaway Supabase projects in London, used for nothing else. Never link production, and never point any step at another project in the organisation.
- **Fictional data only.** The rehearsal uses seed data and made-up accounts. [OPERATIONS.md](OPERATIONS.md) forbids copying production data out of production, so a drill with a real backup is a separate decision ([FD-22](FOUNDER_DECISIONS.md#fd-22)).
- **No real email.** Leave SMTP unset on test projects, or use Resend's simulated recipients. A rehearsal proves nothing about delivery ([runbook section 11](RELEASE_RUNBOOK.md#11-testing-email-sandbox-is-not-delivery)).
- **No test keys in the repo or `.env.local`.** `npm run test:live` reads `.env.local`, which points at the live project. Keep test keys in a separate file outside the repo.
- Delete both projects and all dump files afterwards.

## What a backup does and doesn't contain

| Thing | Daily backup or PITR | `supabase db dump` | Where else |
|---|---|---|---|
| `public` tables | Yes | Yes | |
| `auth.users` and `storage.objects` rows | Yes | In the `--data-only` dump | |
| Our trigger on `auth.users` (`on_auth_user_created`), our policies on `storage.objects` | Yes | **No.** Supabase's guide says changes to `auth` and `storage` must be restored separately. | The migration files |
| The files in the `cvs` bucket | **No** | **No** | Must be copied separately |
| `erasure_ledger`, as of the backup | Yes | Yes | **Erasures made after the backup are not in it.** Export it off-site (below). |
| Our trigger `on_auth_user_erased` on `auth.users` | Yes | **No**, same as the sign-up trigger | The migration files |
| Auth settings: site URL, redirects, SMTP, templates, SSO, MFA | Stays with the project; **not in a dump** | **No** | [DEPLOY.md](DEPLOY.md), `supabase/templates/` |
| JWT secrets and API keys | Stays with the project | **No.** A new project has new ones, so sessions end and Vercel needs new keys. | |
| Vercel variables and code | No | No | Vercel, git |

No migration uses Vault or `pgsodium` (searched 7 November 2026), so the encryption-key step in Supabase's guide doesn't apply today. Check again on the day.

Plans: the production project is recorded as Free, which has no managed backups, so a dump is its only backup. Pro keeps 7 days of daily backups. PITR is an add-on from about $100 a month and **replaces** the daily backups. An in-place restore overwrites the project and takes it offline, so restore to a new project wherever possible.

## Rehearsal

Write down the time at each numbered step.

### A. Build the source

1. Create project `offerpath-restore-src`, London.
2. `npx supabase link --project-ref <src-ref>`, confirm the ref, then `npx supabase db push --linked` and apply `supabase/seed.sql`.
3. Create the data through the app or the admin API, pointed at this project, with a university on a made-up domain:
   - 3 fictional students, one careers admin
   - For one student: an upload, a correction, a tailored CV, a letter, a LinkedIn review, a dismissed spelling suggestion, a tracked application, a share link and an adviser note
   - A fictional PDF in `cvs` for each upload
4. Delete one student's account through the app. Note the id, and check `erasure_ledger` has a row for it.
5. Record a manifest:

```sql
select 'auth.users' t, count(*) from auth.users
union all select 'storage.objects', count(*) from storage.objects where bucket_id = 'cvs'
union all select 'profiles', count(*) from public.profiles
union all select 'reports', count(*) from public.reports
union all select 'cv_sources', count(*) from public.cv_sources
union all select 'applications', count(*) from public.applications
union all select 'application_links', count(*) from public.application_links
union all select 'proofreading_choices', count(*) from public.proofreading_choices
union all select 'share_links', count(*) from public.share_links
union all select 'adviser_notes', count(*) from public.adviser_notes
union all select 'judgment_cache', count(*) from public.judgment_cache;
```

   Add any tables newer migrations create. Also record each file's path and SHA-256.

### B. Back up the source

```sh
npx supabase db dump --remote="$SRC_DB_URL" -f roles.sql --role-only
npx supabase db dump --remote="$SRC_DB_URL" -f schema.sql
npx supabase db dump --remote="$SRC_DB_URL" -f data.sql --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
npx supabase db dump --remote="$SRC_DB_URL" -f history_schema.sql --schema supabase_migrations
npx supabase db dump --remote="$SRC_DB_URL" -f history_data.sql --use-copy --data-only --schema supabase_migrations
```

Needs Docker, `psql` and the database password. Keep the connection string in the shell only. Then copy the bucket to local encrypted storage, using the script in Supabase's guide or `rclone`. Confirm the bucket copy count and hashes against the manifest. **Then add one more student and one more report to the source**, so that later you can show what a restore loses. **Then delete another student through the app, and run the export in [Erasures](#erasures-after-a-restore)**, so part D can show that student staying gone.

### C. Restore to the target

1. Create project `offerpath-restore-dst`, London. Don't apply migrations to it.
2. Restore:

```sh
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql --dbname "$DST_DB_URL"
psql --single-transaction --variable ON_ERROR_STOP=1 --file history_schema.sql --file history_data.sql --dbname "$DST_DB_URL"
```

   Supabase's guide lists known errors and fixes (`supabase_admin` ownership, `cli_login_postgres`).
3. Recreate what the dump leaves out, from the migration files: the `on_auth_user_created` and `on_auth_user_erased` triggers on `auth.users`, the `read own cv files` policy and any other `cvs` policy on `storage.objects`, and the `cvs` bucket row if absent. Compare with `npx supabase db diff --remote` on the source. **Without the first trigger, new sign-ups get no profile and no domain check. Without the second, erasures stop being recorded, silently.**
4. Upload the bucket copy to the target's `cvs` bucket, keeping every path. Check it's private.
5. Set auth settings as in [DEPLOY.md](DEPLOY.md), with no real SMTP.
6. Re-apply erasures, as in [Erasures](#erasures-after-a-restore). Dry run first.

### D. Verify

Run a local copy of the app from outside the repo, or with explicit environment variables for the target, with no `.env.local`. Start it on its own port.

| Check | Pass means |
|---|---|
| Manifest query on the target | Same as part A, without the rows added after the backup |
| File paths and hashes | All match. List any report whose `storage_path` has no object, and any object with no report. |
| `select tablename from pg_tables where schemaname = 'public' and not rowsecurity` | Empty |
| Trigger and policies from C3 | Exist |
| `select count(*) from public.profiles p left join auth.users u on u.id = p.id where u.id is null` | 0 |
| Sign in as a restored student | Works, after a new link. Old sessions are invalid, which is expected. |
| Reports | Old reports open with **their original scores**, and history and corrections are intact |
| Download the original file | Hash matches |
| Student A's session requesting student B's report | Refused |
| New sign-up on the partner domain, and on another domain | Profile created; refused |
| Re-upload an already-scored CV | Same score (`judgment_cache` survived), no new judging |
| Dump contents vs account deleted before the backup | Absent, as expected |
| An account deleted **after** the backup, before C6 | **Back.** It's on the target with its reports and file, and not in the target's `erasure_ledger`. Confirm this first. |
| The same account, after C6 | **Gone:** no `auth.users`, `profiles` or `reports` row, no file, a ledger row with the original date. Students who were not deleted are untouched. |
| `select tgname from pg_trigger where tgrelid = 'auth.users'::regclass` | Lists both `on_auth_user_created` and `on_auth_user_erased` |
| Delete an account on the target, then read `erasure_ledger` | A new row with its id |
| Cron jobs by hand with a test secret | Succeed; send nothing real |
| `/api/health` on the local copy | `ok`, `supabase`, `ok` |

`npm run test:db` is not a check of a restored database. It builds its own in-memory PGlite from the migration files and never connects to a project, so it can't show anything about a restore. `OPERATIONS.md` used to say otherwise.

### E. Record and clean up

Fill in the record below, delete both projects and all dumps and copies, and update [STATUS_REGISTER.md](STATUS_REGISTER.md) and the table in [OPERATIONS.md](OPERATIONS.md).

## Erasures after a restore

<a id="known-gap-deleted-accounts-come-back"></a>Restoring a backup brings back everyone erased since it was taken. [FD-21](FOUNDER_DECISIONS.md#fd-21). Migration `20261108100000_erasure_ledger.sql` records each erased account, and `npm run erasures:reapply` erases them again. **Neither has been run on a real Supabase project.** They're tested in `tests/erasure-ledger.test.ts`, with a restored PGlite data directory and stubs for auth and storage.

**What the ledger holds:** the account's opaque id and the date. No name, email or CV content. A trigger on `auth.users` writes it, so every way of deleting an account counts. Only the service role can read it.

### The limit you must plan around

**The ledger is in the database, so a restore takes it back to the time of the backup, with everything else.** This architecture has no store that survives a database restore: the only other Supabase store is Storage, whose object list is itself in the database, and nothing else is set up. So:

- **The ledger must be exported off-site. Nothing does this automatically yet.** Someone has to run the command below, on a schedule the founder sets.
- **If the source project can still be read, this costs nothing:** export from it just before you restore, and nothing is lost. Restoring to a new project leaves the source readable.
- **If the project is lost altogether, every erasure since the last export comes back and can't be found.** The gap equals the time since that export. Say so to the university and the DPO if it happens.
- **Take an export at least as often as a backup, and keep every export for as long as any backup.** A backup can only be missing erasures made after it, so an export newer than the backup it's used with is what matters. Keep it away from the database, encrypted, in the UK, under the same schedule as the backups ([FD-03](FOUNDER_DECISIONS.md#fd-03)).

**Legal question, not settled here:** whether keeping these rows after erasure is lawful, for how long, and whether the privacy notice must mention them. An id isn't a name, but don't assume that takes it out of data protection law. Nothing purges the ledger, or the export, until the founder and the DPO decide ([FD-21](FOUNDER_DECISIONS.md#fd-21)). A purge earlier than the oldest backup's expiry would let that backup's erased students back.

### Commands

Set these by hand in the shell, for this run only, pointing at the project concerned. The script ignores the app's variables and `.env.local` on purpose, and refuses a `--target-ref` that doesn't match the URL.

```sh
export ERASURE_SUPABASE_URL=https://<ref>.supabase.co
export ERASURE_SERVICE_ROLE_KEY=...

# Off-site export, from the live project. Read-only there. Adds to the file if it exists.
npm run erasures:export -- --target-ref <ref> --out <encrypted-offsite-path>/erasure-ledger.jsonl

# After a restore, against the restored project. Dry run: changes nothing, prints counts.
npm run erasures:reapply -- --target-ref <restored-ref> --ledger <path>/erasure-ledger.jsonl

# Then for real. Puts the export's rows back in the ledger, then erases.
npm run erasures:reapply -- --target-ref <restored-ref> --ledger <path>/erasure-ledger.jsonl --apply
```

Reapply goes through the entries in both the restored ledger and the file. For each account still present it removes and verifies the files, deletes the auth user (which cascades to every row) and reads back. For an absent account with files left in the restored bucket, it removes the files. Exit 0: done. Exit 1: some ids are listed as failed, and those accounts are intact; run it again. Exit 2: refused before connecting. It's safe to run repeatedly. Run it **after** the bucket copy is uploaded (C4), or restored files of erased students stay.

A student who was erased and signed up again has a new id, so their new account isn't touched.

No export at all? Pass `--no-export-available` in place of `--ledger`. That re-applies only what the restored ledger knows, which by definition misses every erasure since the backup. Record that you did it.

## In a real incident

1. Contain it: stop writes if the data is still changing (roll back or take the site down). Tell the founder.
2. Choose the newest usable restore point before the damage, and accept what's lost after it. Note the figure for the university.
3. Restore to a **new project** and verify as in part D. Only then repoint Vercel: update the Supabase variables, Auth settings, SMTP and cron secret, and redeploy. Students must sign in again.
4. Restore files from the separate bucket copy. Files added since then are gone, and those reports' source files will show as unavailable.
5. **Export the ledger from the source first, if it can be read.** After the bucket copy is up, and before students return, re-apply erasures ([Erasures](#erasures-after-a-restore)).
6. Personal data breach or loss: follow Incidents in [OPERATIONS.md](OPERATIONS.md). The university DPO must be told within 24 hours.

## Rehearsal record

| Field | Result |
|---|---|
| Status | **Not rehearsed** |
| Date | |
| Person | |
| Source and target project refs | |
| Backup size and duration | |
| Restore duration, database | |
| Restore duration, files | |
| Total time to a working app | |
| Data lost (rows added after backup, as expected?) | |
| Manifest match | |
| File hash match | |
| Checks failed, and fixes | |
| Changes needed to this procedure | |
| Test resources deleted (date) | |
