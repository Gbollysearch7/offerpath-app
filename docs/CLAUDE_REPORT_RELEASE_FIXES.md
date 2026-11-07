# Release fixes: missing env, erased students after a restore, unchecked AI explanations

Prepared 7 November 2026 by Claude, for independent review by Codex. Worked in a shared uncommitted tree alongside OP-022 and OP-027. Nothing was committed, pushed or deployed. No migration was applied, no live configuration or database was touched, and no paid provider was called. `next build` ran only in copies under the scratchpad, with fake values, never in this directory.

Logs named below are in `/private/tmp/claude-501/-Users-gbolahan-Documents-NEW-ME-LevelUp/70ce5228-d909-41a7-b749-2bc52131c2e0/scratchpad/release-fixes/`. That folder is temporary, so the commands are given too.

## Results

| Defect | Result |
|---|---|
| 1. Missing required env | **Fixed, proven by real builds in a scratch copy. Not run on Vercel.** |
| 2. Restore revives erased students | **Built, tested on a simulated restore. Not applied, and not run on real Supabase.** The ledger can't survive a restore on its own: an off-site export is required, and nothing runs it yet. |
| 3. Unchecked AI explanation text | **Fixed.** Found the same gap in tailoring (two fields) and letters (one field). Line rewrites, the requirements adapter and the judge have none. |
| 6 engine failures, `src/lib/jobs.ts:97` | **Nothing fails now. Cause reproduced for 5 of the 6:** a test fixture lagged a code change by four minutes. No assertion loosened. |

**Production variables that would block the next deploy: none, by name, under the default I chose.** All six required names were present on Production in `vercel env ls` on 7 November ([E1](STATUS_REGISTER.md#e1)). I did not re-read Vercel or any value. Two things could still block it: a required name removed since then, and `NEXT_PUBLIC_SITE_URL` not starting with `https://`, since the gate applies the boot check too.

**If the founder moves any of these to required, each blocks the deploy until added, because they're missing on Production today:** `SUPPORT_EMAIL`, `ALERT_WEBHOOK_URL`, `LEGAL_OPERATOR_NAME`, `LEGAL_OPERATOR_ADDRESS`, `LEGAL_COMPANY_NUMBER`, `LEGAL_ICO_NUMBER`, `LEGAL_CONTACT_EMAIL`. The build log already names them as warnings.

**Migration:** `supabase/migrations/20261108100000_erasure_ledger.sql`, unapplied. OP-022 added `20261108090000_institutional_analytics.sql` during this work, so I re-listed before naming. Mine is last in the listing taken at the end.

## Defect 1: missing required env

`REQUIRED_IN_PRODUCTION` in [src/lib/env.ts](../src/lib/env.ts) is the list. `next.config.ts` calls `assertBuildEnv()` when, and only when, the phase is the production build. So it holds whichever command Vercel runs.

**What I chose as required, for the founder to confirm ([FD-13](FOUNDER_DECISIONS.md#fd-13)):**

| Variable | Why |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL` | Every route returns 500 |
| `CRON_SECRET` | All three jobs refuse to run, so automatic deletion can't run |
| `RESEND_API_KEY` | No warning email is sent, and an inactive account is only deleted after a warning, so deletion can't complete |

The last two are my judgement. The app does serve pages without them, so a stricter reading of "can't run" gives only the first four. I included them because the job can't run and nothing else would tell anyone. Moving a name is a one-line edit.

Everything else is in `OPTIONAL_IN_PRODUCTION`, with what its absence does: named as a warning at build and at boot, blocking nothing. `ANTHROPIC_API_KEY` is here because the rule engine runs without it.

The gate also fails on whatever the boot check would refuse, such as a non-https site URL. It prints names only. There's no off switch, and `DEMO_MODE` doesn't get past it.

**Previews with no variables now build and run in demo mode.** Before this they built, then returned 500 on every route.

**This changes an OP-026 protection, and Codex should look at it.** OP-026 closed the demo in every production configuration, previews included, unless `DEMO_MODE=true`. A preview now opens the demo with no such variable, if all of these hold: `VERCEL=1`, `VERCEL_ENV=preview`, `VERCEL_TARGET_ENV` isn't `production`, no Supabase variable, no service key, no Anthropic key. Consequence: a preview that loses all its variables becomes an open demo with fictional data, where it used to go dark. `VERCEL_ENV=production` never matches. OP-026's own line `demoLoginAllowed({ VERCEL_ENV: "preview" }) === false` in `tests/security-auth.test.ts:56` still passes unedited, only because it doesn't set `VERCEL=1`, so **its passing doesn't mean its intent is unchanged**. `TEST_LOGIN` stays off on every preview.

### Build outcomes

Run in a scratch copy with `env -i` (no project variables) and `npx next build`. Each `next start` used port 3912 and was stopped afterwards.

| Case | Build | Then `next start` |
|---|---|---|
| **Before the fix,** `VERCEL_ENV=production`, nothing set (`before-production-missing.log`) | **exit 0: the defect** | With `VERCEL_ENV=preview`: `/api/health`, `/sign-in` and `/` all **500** (`before-preview-http.txt`) |
| **production-missing** (`after-production-missing.log`) | **exit 1**, listing the six names | Nothing to start |
| One missing, others set to a canary (`after-production-one-missing.log`) | **exit 1**, naming `CRON_SECRET`. Canary appears 0 times in the log. | |
| **production-complete**, fake values (`after-production-complete.log`) | **exit 0.** `fake-` appears 0 times. | Sign-in 200, no demo button, including with `TEST_LOGIN=true`. Health 503 `degraded`, expected for a host that doesn't exist. |
| That build, started with the variables gone, with and without `TEST_LOGIN=true` | | All routes **500**, no demo |
| **preview-empty** (`after-preview-empty.log`) | **exit 0** | Health 200 `"mode":"demo"`. Sign-in shows the demo button. Clicking it in Chromium reached `/dashboard`, 200, with an `httpOnly` cookie. |
| That build with `TEST_LOGIN=true` | | Same demo. Test login remains refused by `testLoginEnabled`, asserted in `tests/env-build.test.ts`. |
| That build with only `SUPABASE_SERVICE_ROLE_KEY` set | | All routes **500**, no automatic demo |

## Defect 2: restore revives erased students

**The ledger:** `public.erasure_ledger (account_id uuid primary key, erased_at timestamptz)`. RLS on, no policies, no grant to `anon` or `authenticated`, and `select, insert` only for the service role. No foreign key, so a row outlives its account. A trigger `on_auth_user_erased` on `auth.users` writes it, so self-service, the retention job, the admin API and the dashboard all count, with no app code to forget. If it can't write, the delete fails and is retried.

**Why the opaque id, not the hash FD-21 suggested:**

1. A keyed hash needs a key outside the database, and the trigger can't reach one.
2. A hash can't name the storage folder of an account whose row has gone.
3. An id names the account and not the person, so someone erased who signs up again keeps their new account. Tested.

**Where this falls short of the brief's first choice, plainly.** A database restore takes the ledger back with it, and the simulated restore asserts that. This architecture has no store that survives a database restore. Supabase Storage is the only other one to hand, and its object list is itself database rows, so a restored project may not list objects written after the backup. That's from my understanding of Storage and I didn't test it. So the ledger **must be exported off-site**, and **nothing runs that export automatically**. If the source project can still be read, exporting just before a restore loses nothing. If the project is lost, every erasure since the last export comes back and can't be found. A test states this outcome. [RESTORE_PROCEDURE.md](RESTORE_PROCEDURE.md#erasures-after-a-restore) says all of this.

**The script:** [scripts/erasures.ts](../scripts/erasures.ts), as `npm run erasures:export` and `npm run erasures:reapply`. Logic is in [src/lib/erasure-ledger.ts](../src/lib/erasure-ledger.ts).

- Dry run unless `--apply`.
- Reads only `ERASURE_SUPABASE_URL` and `ERASURE_SERVICE_ROLE_KEY`, never the app's variables, and refuses a `--target-ref` that doesn't match the URL.
- Refuses to re-apply without an export, unless told none exists.
- Refuses an export holding anything but ids and dates, without repeating the bad text.
- Puts the ledger back first, and erases nothing if it can't. One failed account is reported, keeps its rows, and doesn't stop the rest. Exit 1 lists its id. Safe to re-run.

**The simulated restore** (`tests/erasure-ledger.test.ts`): a real PGlite data directory, with every migration, is dumped and reloaded. The trigger and cascades are real SQL; auth and PostgREST are a small stub client, and the bucket is a Map. It shows the student back with their row and file and absent from the restored ledger, a dry run changing nothing, the apply removing them while another student stays, a second run doing nothing, and the original date kept.

**Legal, flagged and not asserted:** whether keeping these rows after erasure is lawful, for how long, and whether the privacy notice must mention them. **Nothing purges the ledger.** I didn't pick a period, because too short lets a backup's erased students back and too long is the legal question. Needs the founder and the DPO. The notice was not edited.

**Docs:** `RESTORE_PROCEDURE.md`, including the second trigger in step C3, which a dump leaves out; `OPERATIONS.md`; `RELEASE_RUNBOOK.md`; FD-13 and FD-21; `STATUS_REGISTER.md`; `DEPLOY.md`.

## Defect 3: unchecked AI explanation text

Every field a model writes, from `src/lib/ai.ts`:

| Path | Field | Shown as | Before | Now |
|---|---|---|---|---|
| LinkedIn | `after` | Suggestion | Checked | Unchanged |
| LinkedIn | `before` | Removed text | Must match the section | Unchanged |
| LinkedIn | **`why`** | Explanation | **Unchecked** | Checked. Unsafe: neutral sentence. |
| Tailoring | `summary`, `bullets.after`, `skills` | Suggestions | Checked | Unchanged |
| Tailoring | **`bullets.keywords`** | "uses the advert's wording for ..." | **Only had to share one word with the bullet; never compared with the advert** | Every word must be in the advert and the bullet, or the term is dropped |
| Tailoring | **`notEvidenced`** | "Left out: ..." | **Unchecked** | Must be in the advert and not in the CV |
| Letters | `paragraphs.text` | Letter | Checked | Unchanged |
| Letters | **`sources`** | Tag beside the paragraph | **Unchecked**: "CV · GOOGLE INTERNSHIP" would show | Must name what's there; otherwise `JOB AD` or `WRITING TOOL`. "YOU ADDED" needs notes. |
| Line rewrites | `rewrite` | Suggestion | Checked | No other field exists. Tested. |
| Requirements adapter | `terms`, `quote` (`label` ignored) | Requirement | Checked against the advert | No gap. Tested. |
| Judge | Enums only | Not text | | No gap. Tested. |

**The `why` check** ([explanation-check.ts](../src/lib/analysis/explanation-check.ts)) uses the existing `checkProfile` and `withoutInstructions`, and since there's no tick-box for an explanation, a `confirm` counts as a failure. **I added one thing beyond the existing checks:** every word must be the student's own or from a closed list of words about wording. OP-015 records that the fact check can't see lower-case inventions, and "you worked at google" would pass it. A false alarm costs only the neutral sentence.

A malformed or over-long `why` used to fail the whole reply and lose every suggestion. Now it only loses the explanation. The suggestion is judged separately in both directions: tested that a good `why` doesn't rescue an invention, and a bad `why` doesn't sink a good suggestion.

**Re-judged on read:** LinkedIn's `why`, tailoring's `notEvidenced` and keywords. Nothing saved is rewritten.

## Failing first, then passing

**How the red runs were made:** the four new test files in a copy of the unfixed tree, with inert stubs added to that copy only, so the imports load. The stubs behave as the old tree did (an explanation always passes, nothing is gated, nothing is recorded). To reproduce: in a copy, undo the named line. Some reds on the new API come from the stub rather than from old behaviour; the real builds and the assertions named here are the decisive ones.

| File | Before (`red-*.txt`) | After | Sample failure before |
|---|---|---|---|
| `tests/env-build.test.ts` | exit 1: 13 tests, 4 pass, **9 fail** | 13 pass | Preview: `No database is configured` in `errors` |
| `tests/ai-explanations.test.ts` | exit 1: 16 tests, 5 pass, **11 fail** | 16 pass | `tailoring ... what the advert asks for`; `demo: new draft` (GOOGLE saved in a tag) |
| `tests/ai-explanations-judge.test.ts` | exit 0: 1 pass | 1 pass | None: a guard |
| `tests/erasure-ledger.test.ts` | exit 1: 13 tests, 2 pass, **11 fail** | 13 pass | `relation "public.erasure_ledger" does not exist` |
| `supabase/tests/schema.test.mjs` | Not run before: the block needs the new table | 10 new checks pass | |

Tests that passed before too are guards, not reproductions: the requirements adapter, line rewrites, the judge, a true `why`, OP-026 in production, "non-empty preview", "only production is gated", "the export gap", "signed up again".

**Correction made along the way:** my first red run of the LinkedIn test failed partly because one demo student ran out of the day's AI allowance, not from the defect. I gave each case a new student and re-ran the red. The table is the re-run.

## The 6 engine failures

`npm run test:engine` before any edit: **851 tests, 851 pass.** After: **938 pass.** So nothing to fix.

**Cause.** `jobs.ts:97` is the retention job's `db.from("staff_access_log")` purge. `tests/fixtures/fake-supabase.ts` throws on a table it doesn't model. By file times, `jobs.ts` was last changed at 03:59 and the fixture at 04:03, and the fixture now models that table. **Reproduced:** with that table removed from the fixture in a scratch copy, these fail (`repro-jobs97.txt`): "the retention job removes an idle account's reviews", "...the same things", "one account that can't be deleted", "the rate limiter stores no email or IP address", "...removes a link 90 days after it expired".

**That's five, and it doesn't prove what happened in that run.** File times show the window could have existed; the original log is gone. The sixth, "every admin page requires an admin", doesn't use the fixture this way and I didn't reproduce it. My guess is an OP-021 admin page mid-edit, and that's only a guess. No assertion was changed.

## Validation, final tree

| Command | Result |
|---|---|
| `npm run typecheck` | **exit 0** on the last run. One run earlier in validation gave exit 1, with 2 errors in `tests/analytics-db.test.ts:419,431`, OP-022's file, which it then fixed. None in files I wrote or edited. |
| `npm run lint` | exit 0, no problems printed |
| `npm run test:engine` | exit 0: 938 tests, 938 pass, 0 fail |
| `npm run test:db` | exit 0: 452 PASS, 0 FAIL |
| `git diff --check` | exit 0. New files separately checked for trailing spaces: none. |

**No score changed.**

- Thirteen scoring and analysis files (`cv.ts`, `judgment.ts`, `rubric.ts`, `fingerprint.ts`, `job-match.ts`, `letter.ts`, `letter-review.ts`, `scoring.ts`, `scoring-core.ts`, `services.ts`, `ai.ts`, `rewrite-check.ts`, `job-requirements.ts`) are byte-identical to the copy taken before my edits.
- A script hashing CV, tailoring-match and letter scores and rule rewrites for two fixture CVs across three sectors gave `6b4e3bc2...a723` on both trees (`scores.ts`).
- `claims.ts` gained one helper, `allWordsIn`, which nothing in scoring uses. Keywords and `notEvidenced` don't feed any number.

## Tests I changed that I didn't write

| Test | Change | Why |
|---|---|---|
| `tests/engine.test.ts`, the `checkTailorDraft` call | Added arguments `[]` and an advert string | The function now needs the advert. No assertion changed. |
| `supabase/tests/schema.test.mjs` | Added one block | Requested. Nothing else touched. |
| `tests/security-auth.test.ts:56` | **Not edited**, but its intent has changed for real previews | See Defect 1 |

## Limits

- **Not run on Vercel.** That Vercel sets `VERCEL=1` and `VERCEL_ENV` at build and at runtime is from its documentation; here I set them by hand. Run a real preview and a real production deploy before relying on this.
- **Not run on real Supabase.** Unproven: the trigger firing when the auth service deletes a user, `getUserById`'s 404, Storage listing, and a real dump and restore. The real restore rehearsal is still blank.
- **Demo preview:** without `DEMO_SECRET`, sessions are signed with a per-process secret and data is in memory, so a session may not survive a move between instances. It proves the build and pages only.
- **`why` limits:** words all taken from the student's text can still be arranged into something false ("you led X" where both appear). The closed list is my own and hasn't met a real model, so **real explanations may often become the neutral sentence**. That's safe but is lost value. Worth checking on a real run.
- **Saved letter tags aren't re-judged on read.** Rule-written tags such as `CV · <role>` look the same as saved model tags. New drafts are covered; older letters aren't.
- **Keyword strictness:** a multi-word keyword now needs every word in the bullet, so some true matches lose their "Why" line. The bullet stays.
- **Rejected text is still quoted, by design:** a withheld reason or a note such as `included "Google", which your CV doesn't show` contains the model's word, in rule-written wording that says it's unsupported. Unchanged.
- **Noisy build log:** warnings repeat because Next loads the config in several processes.
- **Self-written tests:** same author as the code. Codex's own cases are worth more.

## Checks Codex must rerun

1. Build outcomes above in its own copy with fake values.
2. Whether the empty-preview demo is acceptable against OP-026.
3. Its own unsafe `why`, keyword and tag strings.
4. `npm run typecheck` and both test suites, since OP-022 and OP-027 were still working.
5. `ls supabase/migrations`, in case something now sorts after the ledger.

## Unresolved

1. **Founder:** confirm `REQUIRED_IN_PRODUCTION`, especially `CRON_SECRET` and `RESEND_API_KEY` (FD-13).
2. **Founder and DPO:** is keeping the ledger lawful, for how long, does the notice change (FD-21).
3. **Founder to assign:** who runs the off-site export, how often, and where it's kept. **Until someone does, the protection is partial.**
4. **Founder to assign:** the restore rehearsal, on real Supabase, and first runs on Vercel.
5. **Codex:** the OP-026 change above.

## Files

New: `src/lib/erasure-ledger.ts`, `src/lib/analysis/explanation-check.ts`, `scripts/erasures.ts`, `supabase/migrations/20261108100000_erasure_ledger.sql`, `tests/env-build.test.ts`, `tests/erasure-ledger.test.ts`, `tests/ai-explanations.test.ts`, `tests/ai-explanations-judge.test.ts`, this report.

Edited: `src/lib/env.ts`, `next.config.ts`, `package.json` (two scripts), `src/lib/analysis/claims.ts` (one helper), `linkedin-suggest.ts`, `linkedin-edits.ts`, `tailor.ts`, `tailor-edits.ts`, `letter-check.ts` (all in `src/lib/analysis/`), `src/lib/linkedin-flow.ts`, `src/lib/tailor-flow.ts`, `src/app/tailor/[id]/page.tsx`, `tests/engine.test.ts`, `supabase/tests/schema.test.mjs`, and the docs listed under Defect 2. Several already held other agents' uncommitted edits, which I left alone.
