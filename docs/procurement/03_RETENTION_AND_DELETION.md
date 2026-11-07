# Retention and deletion

**DRAFT. Not reviewed by a lawyer or DPO. Not a commitment.** Evidence levels are defined in the [README](README.md).

## Summary of the position

1. **Backups are not running.** The project is recorded on Supabase Free, which has no managed backups. The weekly dump and bucket copy in [OPERATIONS.md](../OPERATIONS.md) have no record of ever running. If the live project were lost today, recorded data would not be recoverable from any backup this project knows of.
2. **No restore has ever been rehearsed.** [RESTORE_PROCEDURE.md](../RESTORE_PROCEDURE.md) is written and has not been run. Its record is blank.
3. **The backup retention period is an open conflict.** See below.
4. **Nothing below has run against the production database or storage in its current form.** Tests use a fake client and PGlite. An earlier version of account deletion passed on the live project on 27 October 2026.

## Open conflict: 30 or 35 days

**Update, 7 November 2026:** the wording quoted here has since been changed. See [CLAUDE_REPORT_CLAIMS_FIXES.md](../CLAUDE_REPORT_CLAIMS_FIXES.md).

**This is unresolved. It is shown here because a university would otherwise be misled.**

| Document | What it says |
|---|---|
| [Privacy notice](../../src/app/legal/privacy/page.tsx) | "Backups are overwritten within 35 days." |
| [OPERATIONS.md](../OPERATIONS.md) | Weekly dumps kept 35 days |
| [DPA schedule template](../legal/DPA_SCHEDULE_TEMPLATE.md) | "up to 30 days for deletion and backup expiry", and deletion of all controller data within 30 days of contract end |

No backup exists to which either period applies. A recommendation is on file ([FD-03](../FOUNDER_DECISIONS.md#fd-03): 30 days). It is advice, and **nobody has decided**. Owner: founder, with a lawyer. `[TO SUPPLY: the decided period, the date and the decider. Founder.]`

## What happens to each kind of data

From [OPERATIONS.md](../OPERATIONS.md), checked against `src/lib/jobs.ts`, `src/lib/account-deletion.ts` and the migrations on 7 November 2026.

| Data | Held in | Removed when | Level |
|---|---|---|---|
| Original CV files | `cvs` bucket, private | Account deletion. Removed first and checked gone; on failure the account stays intact for retry. | Locally tested; earlier version seen on live |
| CV versions (`cv_sources`), including held, never-scored versions | Postgres | Account deletion. **Held versions don't otherwise expire**, so up to 24 months of inactivity (FD-19). | Locally tested; unapplied migration |
| Reports: CV reviews, letters, tailored CVs, LinkedIn reviews | Postgres | Account deletion | Locally tested |
| Generated Word and PDF downloads | Not stored | Built per request, sent `no-store` | Locally tested |
| Temporary processing data | Memory | End of request. A test forbids temp-file calls in `src/`. | Locally tested |
| Proofreading choices, including the quoted word | Postgres | Account or report deletion | Locally tested; unapplied |
| Applications, reminder log, AI usage counts | Postgres | Account deletion | Locally tested |
| Application links, document versions sent, dismissed recommendations | Postgres | Account deletion | Locally tested; unapplied |
| Share links and open times | Postgres | Account or report deletion, or 90 days after expiry (FD-23) | Locally tested; unapplied |
| Adviser notes, disagreements, referrals | Postgres | Student's account deletion. Otherwise append-only. | Locally tested; unapplied in part |
| Analysis job records: counts, costs, no document text | Postgres | Account deletion, or 90 days (FD-23) | Locally tested; unapplied |
| Rate-limit counters: hashes only | Postgres | Within a week | Locally tested; live database has plain-text keys until new code ships |
| Staff access log | Postgres | 24 months. The period is a placeholder needing legal review. | Locally tested; unapplied |
| Profile and sign-in identity | Postgres, Supabase Auth | Account deletion. **Supabase's own auth audit log has its own retention:** `[TO SUPPLY: period. Founder from Supabase's terms.]` | Locally tested; earlier version seen on live |
| Application logs: ids, counts, URL paths | Vercel | Vercel's retention. The notice says up to 30 days; Vercel's limits page gave 1 hour on Hobby, 1 day on Pro on 7 November 2026. Plan not read. | Not verified |
| Emails | Resend | Resend's retention. **Not deleted with the account.** `[TO SUPPLY: period. Founder.]` | Not verified |
| Text sent to AI | Anthropic | Anthropic's retention. **Can't be recalled.** `[TO SUPPLY: period. Founder.]` | Not verified |
| Backups | None today | See above | Not built |

## Kept after a student's account is deleted

These stay deliberately. **None of these positions has had legal review,** and the privacy notice doesn't mention them all.

| Data | Why | Removed when |
|---|---|---|
| `student_records`: email, student number, course, faculty, fee status | University's own import, reapplied at sign-up | The university's retention. **No route to remove it other than SQL** (FD-17). |
| Staff access log entries about the student | The university can answer who accessed what. `student_id` is nulled; the staff member's name stays. | After 24 months |
| Erasure ledger row: account id and date | See below | **Nothing removes it** |
| `judgment_cache`: labels keyed by a hash of bullet words | Same text, same answer. Holds no text and no user id (tested). | **Never** |
| A deleted adviser's notes on students who remain | Part of the student's record | With the student's account |
| Institution configuration | The university's own | With the university |
| `pilot_requests`: name and email of enquirers, not linked to accounts | No rule set (FD-18) | **No rule** |

## Automatic deletion for inactivity

`/api/cron/retention` runs on Mondays. An account inactive for `RETENTION_INACTIVE_MONTHS` (default 24) is warned, and deleted 30 days after a warning that was actually sent.

- **It depends on real email.** With no working email, no warning goes, and **no inactive account is deleted**. No real delivery is recorded.
- It needs `CRON_SECRET`. The name is set on production; no run has been read.
- It applies to `role = 'student'` only (`retention_candidates`), so **staff accounts are never deleted for inactivity.**
- Not run on production. Level: locally tested with a fake client.

## Student deletion and export

**Deletion:** the student types DELETE at `/privacy`. Files are removed and checked, then rows, then a second sweep. If the sweep fails, an alert fires. On a storage failure the account stays intact for a retry.

**Export:** `/api/export` returns a ZIP of profile, applications, CV versions, adviser notes and casework, proofreading choices, share-link dates, reports and uploaded files. It is JSON and original files, so readable but hard to use with a screen reader (A11Y-O07).

**Other rights** (rectification, restriction, objection) go through the university's DPO per the notice. **No operator procedure exists for handling such a request.**

## The erasure ledger and its limits

**The problem.** Restoring a backup brings back every account erased since that backup.

**What was built.** Migration `20261108100000_erasure_ledger.sql` adds a table holding each erased account's opaque id and date. A trigger on `auth.users` writes it, so every deletion route counts. Only the service role can read it. `npm run erasures:export` copies it out. `npm run erasures:reapply` erases those accounts again after a restore, and removes any restored files.

**Level: locally tested on a simulated restore** (`tests/erasure-ledger.test.ts`: real PGlite dump and reload, a stub for auth, a Map for the bucket). **Not applied to any database. Never run on real Supabase.**

**Its limits.**

| # | Limit | Consequence |
|---|---|---|
| 1 | The ledger lives in the database, so a restore takes it back to the time of the backup. | It can't by itself find erasures made after the backup. |
| 2 | It must be exported off-site. **Nothing does this automatically, and no one has been named to do it.** | Until someone does, the protection is partial. |
| 3 | If the live project can still be read, exporting just before a restore loses nothing. | Restore to a new project, leaving the source readable. |
| 4 | **If the project is lost altogether, every erasure since the last export comes back and can't be found.** | The gap equals the time since that export. Today no export has been run. The university and DPO would have to be told. |
| 5 | **Whether keeping the ledger is lawful is undecided:** an id isn't a name, but it should not be assumed to fall outside data protection law. | FD-21. Needs founder and DPO. |
| 6 | **Nothing purges the ledger or its export.** Too early would let a backup's erased students back. | Conflicts with "all controller data within 30 days" at contract end (conflict C-04). |
| 7 | The privacy notice doesn't mention it, and says deletion removes data "straight away". | Needs legal review. |
| 8 | It covers accounts and their files. It doesn't cover the kept items above or what providers hold. | |
| 9 | The bucket copy must be uploaded before reapply, or restored files of erased students stay. | Procedure step. Not rehearsed. |
| 10 | Our triggers on `auth.users` aren't in a `supabase db dump` and must be recreated. Without `on_auth_user_erased`, erasures silently stop being recorded. | Procedure step C3. Not rehearsed. |

## What a backup would and wouldn't hold

Per [RESTORE_PROCEDURE.md](../RESTORE_PROCEDURE.md), from Supabase's documentation, read 7 November 2026, not exercised: Supabase daily backups and dumps **don't include the files in the `cvs` bucket**, so CVs need a separate copy. Dumps don't include triggers on `auth.users`, storage policies, or Auth settings.

## End of contract

**Not built.** The DPA template promises deletion of all controller data within 30 days, or return in a standard format. A search of the code, migrations and operations documents finds no offboarding procedure, no function that deletes a university's data, and no bulk export for return. It would have to be written and tested, and the items above (ledger, cache, logs at providers) decided. See conflict C-04.

## Corrected or disputed data in a report

A saved report keeps its original score and wording. Old reports aren't rewritten. Exports carry the labels saved at the time.
