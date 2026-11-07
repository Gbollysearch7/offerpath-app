# OP-026 — Extend security, retention and deletion verification

Prepared 7 November 2026 by Claude, for independent acceptance review by Codex. Nothing was committed, pushed or
deployed. No migration was applied. No live database, `test:live`, paid provider or `next build` was used.

**Status: Implemented → Locally verified.** No human or operational gate was passed. The new migration
`supabase/migrations/20261107120000_security_hardening.sql` is **not applied anywhere**, and neither is OP-006's
`20261105120000_cv_sources.sql`.

## What this does and does not claim

- **Claims:** the adversarial files below are bounded in this process; cross-user and cross-institution access is denied
  at the repository (fake), action and route (demo mode), and SQL (PGlite) layers; both deletion routes remove every
  version, report and original file on the fake and in PGlite; logs and alerts omit the canaries tested; the sign-in
  gates hold under a production configuration in the real server actions.
- **Does not claim:** anything about real Supabase Auth, PostgREST, Storage or a real production build. The table
  "What remains unproven" lists each gap. No penetration test was done. Legal text changed here has had no legal review.
- **Scores:** unchanged. No scoring, rubric, judgment or fingerprint file was touched. `extract.ts` changes limits only,
  not the text returned; `EXTRACTOR_VERSION` is unchanged. Typed text loses only NUL characters and broken surrogates,
  which a Postgres column can't hold anyway.

## Defects found and fixed

Each "After" is enforced by a named test in the Validation section. "Before" output was captured by a probe against the
tree before any edit. There is no commit to diff against because the tree is uncommitted and shared; to see a test fail,
undo the named line.

| # | Severity | Defect | Before (evidence) | After |
|---|---|---|---|---|
| 1 | **High** | `TEST_LOGIN=true` opened one-click sign-in, including as an admin, in production. Only a boot warning. `docs/LAUNCH_CHECKLIST.md` shows it is meant to be set in Production today. | `featureFlags.testLogin()` → `true` with `NODE_ENV=production`; `checkEnv` errors `[]`. | `testLoginEnabled()` is false in any production configuration (`NODE_ENV=production`, build-time or runtime; `VERCEL_ENV=production` or `preview`), with no override. Exact value `true` only. Button and action both gated. |
| 2 | **High** | Demo sign-in was gated only by the boot check. `isDemoMode()` is just "no Supabase variables", so a production server that lost them and got past boot would hand out demo admin sessions. A signed demo cookie was honoured too. | `startDemo` and `getRepo` had no production check. | `demoLoginAllowed()` checked in `startDemo`, `getRepo` and the page: production needs `DEMO_MODE=true` and no Supabase variable at all. |
| 3 | **High** | Forged zip: the size check trusted the file's own directory, then inflated `word/document.xml` on the **main thread**. | 1.5 MB `.docx` claiming 1 KB: process peak **2,746 MB**; ended in a non-`ExtractError` "Bug : uncompressed data size mismatch". | `readBounded()` stops at 20 MB of real output: `zip_too_large`. A false claim within the limit: `unreadable`. |
| 4 | **High** | PDF decompression bomb: the worker's 256 MB heap cap doesn't count typed arrays, where pdf.js puts decompressed streams. | 1,019,478-byte PDF: RSS 1,109 → **2,183 MB**, then returned `image_only` as if harmless. | Memory watchdog outside the worker: over 512 MB growth, terminate, `too_complex`. Holds for any filter or library. |
| 5 | **High** | Any worker error, not just failure to start, fell back to parsing **in process**, with no limits. The comment said "only if a worker can't be started". | `catch (e) { if (e instanceof ExtractError) throw e; … parseInProcess }`. A worker exit with no message also waited the full 20 s. | Only `WorkerStartError` falls back. Crash, unhandled rejection or exit: `unreadable`. |
| 6 | Medium | Logs and alerts leaked. Past depth 4 values passed through **unredacted**; parse errors quote their input; messages kept keys and emails; stacks repeated messages; the alert webhook got raw `err.message`. | Output: `"Unexpected token 'L', \"Led a team\"..."`; `{"text":"CANARY CV TEXT","apiKey":"sk-ant-CANARY"}` at depth 6; `sk-ant-api03-CANARY Bearer eyJ… jane.doe@northfield.ac.uk` verbatim. | Dropped past depth; parse messages omitted; keys, JWTs, bearer values and emails scrubbed from every string; stacks are frames only; `alert()` scrubs before sending. More field names redacted. |
| 7 | Medium | `log()` could throw inside error handling. | Circular data: `TypeError: Converting circular structure to JSON`. | Never throws; BigInt, circular and hostile getters handled. |
| 8 | Medium | Anyone could set institution fields through the public sign-up API: `raw_user_meta_data` filled student number, course, faculty, fee status, which students otherwise can't edit. | `handle_new_user` copied them from client-writable metadata. | **In the unapplied migration.** Only from an `sso:*` provider or server-set claims. Imported record still wins. |
| 9 | Medium | One undeletable account stopped the retention job, and every account after it, on every run. | `deleteUserCompletely` threw out of the loop. | Per-account `try`; `{warned, deleted, failed}`; alert; retried next run. |
| 10 | Medium | Deletion trusted storage's reply and had no second pass. A `remove` that removed nothing still deleted the account, orphaning files nobody could find. Two copies of the code. | No re-list; no sweep. | `src/lib/account-deletion.ts`, one copy: folder walk plus row paths (own folder only), verify empty before rows go, sweep after, alert if the sweep fails. |
| 11 | Medium | `rate_limits` stored emails and IPs in plain text, past the account's deletion, with only a 1%-per-hit clean-up. | Key `signInPerEmail:jane.doe@northfield.ac.uk`. | SHA-256 of the subject. Retention job purges windows over a day old. |
| 12 | Medium | Paste flow stored any file as the "original": an `.exe` or `.html`, as `application/octet-stream`. | Only the size was checked in `pasteFlow`. | Files refused for wrong type or wrong contents aren't kept; typed text is still scored. An unreadable real PDF (a scan) still is. |
| 13 | Medium | "Download my data" left out `cv_sources` text, so a correction or held version was not exportable, and adviser notes. | Route wrote profile, applications, reports, uploads only. | `cv-versions.json`, `adviser-notes.json`. |
| 14 | Low | File names were stored as sent; NUL and broken surrogates in typed text would fail at the database. Traversal was already blocked in the storage path, not in the stored name. | `file.name.slice(0, 120)`. | `cleanFileName`, `storableText`. Ordinary names unchanged. |
| 15 | Low | The worker's stdout reached server logs; pdf.js warnings quote the file's font names. | `Warning: Font "F1" is not available` in output. | `stdout: true, stderr: true` on the worker. |
| 16 | Low | Export, letter and admin CSV responses had no `Cache-Control`. | Headers absent. | `private, no-store`. |
| 17 | Low | A student could delete their own "immutable" original through the storage API, leaving a version whose file is gone. | Policy `delete own cv files`. | **In the unapplied migration.** Policy dropped; the app already used the service role. |
| 18 | Low | `anon` and `authenticated` held TRUNCATE, TRIGGER, REFERENCES. TRUNCATE ignores RLS. PostgREST can't issue it, so this is depth, not a known route. | `role_table_grants` listed them on 7 tables. | **In the unapplied migration.** Revoked, default privileges too. |
| 19 | Low | Document text could close its own prompt tag in letter and tailor prompts (`</cv>` then instructions). No tools are available to the model and output is validated, so impact was limited. | `cap()` only truncated. | `cap()` defuses those tags. Other text unchanged. Judge prompt not touched. |
| 20 | Low | Documents disagreed or fell short: notice said backups 30 days, `OPERATIONS.md` said 35 and "the privacy notice says so"; notice didn't mention versions; `OPERATIONS.md` claimed names are redacted, which code can't do; the boot warning implied a missing `CRON_SECRET` only cost reminders. | Quoted text. | Corrected; lifecycle table added to `OPERATIONS.md`. **Founder decision 2.** |

**Checked and found sound, no change:** every repository read and service-role write is scoped to the user; all route
handlers authenticate except health and the auth callback; all admin pages require an admin; all admin SQL functions
gate on `admin_university()`; no function takes a university id from a signed-in caller; every `user_id`/`student_id`
column cascades; no FK can block deletion; RLS is on for every table; no client component imports the service client;
no temp files are written; AI calls have no tools; `judgment_cache` holds no text or user id; generated Word and PDF
files are built per request and not stored; SSRF, cron auth and the demo cookie signature were already covered.

## Changed files

- **New:** `src/lib/account-deletion.ts`; `supabase/migrations/20261107120000_security_hardening.sql` (**unapplied**);
  `supabase/tests/security.test.mjs`; `tests/security-{auth,uploads,logging,deletion,tenancy}.test.ts`;
  `tests/fixtures/{request-scope,next-server-shim,worker-prints}.ts`.
- **Auth and config:** `src/lib/env.ts`, `src/lib/session.ts`, `src/app/actions/auth.ts`, `src/app/sign-in/page.tsx`, `.env.example`.
- **Uploads:** `src/lib/analysis/extract.ts`, `src/lib/cv-flow.ts`.
- **Deletion, retention:** `src/lib/repo/supabase.ts` (`deleteAccount` only), `src/lib/jobs.ts`, `src/lib/rate-limit.ts`.
- **Logging:** `src/lib/log.ts`. **Prompts:** `src/lib/ai.ts` (`cap` only).
- **Routes:** `src/app/api/export/route.ts`, `src/app/api/letters/[id]/route.ts`, `src/app/admin/export/route.ts` (headers only there).
- **Docs:** `docs/OPERATIONS.md`, `docs/LAUNCH_CHECKLIST.md`, `src/app/legal/privacy/page.tsx` (one paragraph).
- **Shared, small:** `tests/fixtures/fake-supabase.ts` (additive: `list`, `delete`, `lt`, `rpc`, `auth.admin`, faults);
  `supabase/tests/schema.test.mjs` (one line: the SSO test user now comes from an SSO provider);
  `package.json` (`test:db` also runs the new file).

## Behaviour

- **Sign-in page.** "Enter as a student" is gated by `featureFlags.testLogin() || (isDemoMode() && demoLoginAllowed())`.
  It appears only in development with `TEST_LOGIN=true`, in a local demo, or on a deliberate `DEMO_MODE=true` deployment
  with no database, which holds only fictional in-memory data. The action re-checks; hiding the button is not the control.
- **`TEST_LOGIN` left on in production** is inert and warns at boot. It deliberately doesn't stop boot: a stale variable
  shouldn't take the site down when it no longer does anything.
- **Limits:** 2 MB file, 20 MB real zip output, 1,000 zip entries, 10 PDF pages, 40,000 characters, 256 MB worker heap,
  512 MB process growth per parse, 20 s.
- **Deletion:** files, verify, rows, sweep. On any file failure the account stays intact for a retry.

## Validation: commands and actual results

Run on this tree, 7 November 2026, with five other agents working in it.

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 on the full run. Re-run after the report was written: 5 errors, all in `tests/job-match.test.ts`, an untracked file another agent (OP-012/013) wrote at 00:13 and was still editing; none in OP-026 files. See the note at the end of this section. |
| `npm run lint` | exit 0: 0 errors, 1 warning (`tests/e2e/smoke.mjs:38`, not mine) |
| `npm run test:engine` | exit 0: **380 tests, 380 pass, 0 fail** (56 are new: auth 11, uploads 15, logging 11, deletion 9, tenancy 10) |
| `npm run test:db` | exit 0: **227 PASS, 0 FAIL** (schema 132, new security file 95) |
| `git diff --check` | exit 0 |

The 56 new tests were re-run alone after the report was written: 56 pass, 0 fail. Codex should re-run typecheck once
OP-012/013 has finished `tests/job-match.test.ts`.

**Browser and server checks.** A second dev server on the shared `.next` could disturb the founder's, so these ran from
a scratch copy of the source with `node_modules` symlinked, no `.env*`, and Supabase, Resend and Anthropic keys blanked.
Port 3900; each process stopped by its own PID; 3900 confirmed free afterwards. The copy reflects the tree at the moment
it was taken. The process on :3000 had a different PID at the end (44216, then 51318); I signalled neither.

| Configuration | Boot log | `/sign-in` |
|---|---|---|
| Demo, development | `"mode":"demo"` | 200, button present. In Chrome: click → `/dashboard`, cookie `httpOnly`; `/api/export` 200, `private, no-store`, zip |
| `VERCEL_ENV=production TEST_LOGIN=true`, no database | **Refuses to boot:** "No database is configured…", and "TEST_LOGIN is set but ignored" | not served |
| `VERCEL_ENV=production TEST_LOGIN=true`, unreachable fake host `op026-no-such-project.invalid` | `"mode":"supabase"`, "TEST_LOGIN is set but ignored" | 200, **button absent**; health `degraded`, database `error`, as expected for a host that doesn't exist |

`next dev` can't run with `NODE_ENV=production`, so these use `VERCEL_ENV`. No `next build`/`next start` was run.

## What remains unproven without a real database

| Item | Why it can't be proven here | What proves it |
|---|---|---|
| RLS as Supabase enforces it through PostgREST, with real JWTs | PGlite runs the same SQL policies, but `auth.uid()` is a stub reading a setting, and there is no PostgREST | Two real test accounts at two test universities |
| Storage bucket policy in the real service | `storage.objects` is a plain table here; the fake doesn't enforce policies | Download attempt with another user's JWT |
| Dropping `delete own cv files` works in Supabase | The stub accepts it; real permissions on `storage.objects` may differ | Applying to a staging project |
| `list()` paging and `id: null` folder semantics; `remove()` reply shape | Modelled from the existing code's assumptions, not from the service | Delete a real account with 100+ files, inspect the bucket |
| `auth.admin.deleteUser` and `delete_my_account` cascading on real Supabase | Foreign keys proven in PGlite; the auth service's own delete isn't | Same, then check every table |
| SSO provider value: that a real SAML sign-in gives `raw_app_meta_data.provider` of `sso:*`, and where attributes land | No identity provider here; from recollection of Supabase's behaviour. **If wrong, SSO fields stop filling** (imported records still work): fails safe, but it fails | One real SSO sign-in, before the first SSO pilot |
| Default-privilege revocation for Supabase's `postgres` role | The stub has one owner role | Check `role_table_grants` after applying |
| Retention job end to end, with real email and cron | Fake client; injected sender | Staging run with a backdated account |
| Backup expiry, restore re-deletion, Vercel log retention (30 days), Resend and Anthropic retention | Provider settings, not code | Founder checks; first restore drill is still blank in `OPERATIONS.md` |

Also unproven, without needing a database:

- **The worker on Vercel.** `extract.ts` falls back to parsing in process if a worker can't start or the libraries can't
  be resolved. That path has no memory or time limit (it logs `extract-worker-unavailable`). Whether workers run in the
  deployed bundle is unverified. Check that log line, and upload the bomb from this test file, on a preview deployment.
- **A production build.** `isProductionConfig` reads `process.env.NODE_ENV` so that Next inlines it. Build inlining was
  not exercised; the tests use runtime values.
- **The memory limit in a smaller function.** Watchdog peak reached under 850 MB in the test (with a 1,024 MB bomb). That
  exceeds a 512 MB function; Vercel's memory setting needs checking.

## Limitations

- The watchdog measures process RSS, so two concurrent parses share the 512 MB, and other memory use in the same
  instance counts. Ordinary fixtures stay under about 300 MB (asserted). A wrongly refused file gets `too_complex`, and
  a retry works. There is no global cap on concurrent parses, so several 20 s parses can run at once (OP-025 territory).
- `scrub` recognises keys, JWTs, bearer values and emails. It can't recognise a name or CV sentence in free text, unless
  quoted and over 25 characters. The static test covers only field names in `log`/`alert` calls that fit on a line.
- Letter and tailor inputs don't get `storableText`. A NUL there is a failed request, with nothing stored, not corruption.
- Prompt-injection work is structural (no tools, delimiters, tag defusing, output validation). No model was called, so
  how Claude actually behaves on hostile text is untested.
- Between file removal and the row delete, a failed `delete_my_account` leaves an account with rows and no files. A
  retry finishes it. Until then `sourceFile` errors.
- `/admin/students/[key]/cv/[reportId]` logs `key` from the URL, not the report's real owner, so an adviser can make the
  log name the wrong student. Access itself is checked on the report.
- The CSV export hides results under five, but narrowing by search or faculty could still allow differencing between
  two exports. Not changed; belongs with OP-021-style reporting rules.
- Test fixtures `request-scope.ts` and `next-server-shim.ts` depend on Next internals and may need updating on a Next upgrade.

## Migration impact

**One new file, `supabase/migrations/20261107120000_security_hardening.sql`, NOT applied to any database.** The directory
was re-listed immediately before naming; it sorts after `20261106120000_score_series.sql`. Other agents may add more;
it depends on none of theirs. It replaces `handle_new_user`, drops one storage policy, and revokes three privileges.
No table or data changes. The app works with or without it. Validated in PGlite only.

Code changes need no migration. **Deploying `account-deletion.ts` before `cv_sources` is applied would make account
deletion fail** at the row lookup, as uploads already would per the OP-006 report. Apply `cv_sources` first.

## Founder decisions needed

1. **`TEST_LOGIN` on the deployed site.** The checklist implies Production uses it today. Once this ships, the buttons
   disappear on Production and every preview, with no override. I took the strict reading of the register. If you need
   one-click on a shared site, previews with `DEMO_MODE=true` give that with fictional data only. Please confirm.
2. **Backups: 30 or 35 days?** `OPERATIONS.md` says 35. The notice said 30 and I changed it to 35 to match. The DPA
   template says "up to 30 days for deletion and backup expiry" and is now the odd one out. Either shorten the backup
   or change the DPA. My notice edit, including the new sentence on university records, needs legal review (#9).
3. **`student_records` after account deletion.** Kept today as the university's data: email, number, course, fee status.
   It reapplies if the student signs up again. There is no removal route other than SQL. Needs a DPA position.
4. **`pilot_requests` retention.** Names and emails with no rule at all.
5. **Held versions** (OP-006's open question): text and file wait until account deletion, up to 24 months' inactivity.
6. **Adviser access audit.** `/privacy` promises "Every time they do is logged", but that log lives only in application
   logs, 30 days at most. If that promise matters, it needs a table. `ADVISER_CV_ACCESS` is off today.
7. **Missing `CRON_SECRET` or `RESEND_API_KEY`** means no automatic deletion, contradicting the notice. Currently a boot
   warning. Should it stop boot in production?
8. **Before launch, on the live database (not done here):** delete the two `levelup-qa.ac.uk` accounts and university row.

Answer to OP-005's question 5: the storage ETag isn't needed for deletion, which goes by folder and verifies by re-listing.

## Checks Codex must rerun

```
npm run typecheck && npm run lint && npm run test:engine && npm run test:db && git diff --check
NODE_OPTIONS=--conditions=react-server npx tsx --tsconfig tsconfig.json tests/security-uploads.test.ts   # about 30 s; allocates about 1 GB
ls supabase/migrations | tail -3
```

Worth attacking: `testLoginEnabled` and `demoLoginAllowed` in `src/lib/env.ts` (is there another path to `startDemo` or
`generateLink`?); the order in `removeUserFiles`; the 512 MB threshold against a large legitimate PDF; `PARSE_ERROR` and
the quoted-text rule in `log.ts` (what else quotes input?); the `sso:` assumption in the migration; whether
`next-server-shim.ts` makes the auth tests prove less than they appear to (it replaces only `next/link`, `SignInForms`
and the build of `next/navigation`).
