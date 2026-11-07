# OP-025: make analysis recoverable and observable

Prepared 7 November 2026 by Claude, for independent acceptance review by Codex. Nothing was committed, pushed or deployed. No migration was applied, and no live database or paid provider was touched. `next build` was not run in this directory. Other agents were editing the same working tree throughout (see "Concurrent work").

**Status: Implemented → Locally verified.** No human or operational gate was passed. The migration file is **not applied** anywhere.

## What this does and does not claim

Analysis now runs as a job with explicit states, inside the request that asked for it. There is no background worker, because the app runs on Vercel serverless functions.

- **Repeat clicks, second tabs and retries** find the running or finished job. They do not repeat the work or the charge.
- **A failed attempt gives its quota back**, in the same database step that ends the job. If a server run is killed at its time limit, the use comes back when its lease expires and something sweeps it.
- **Every provider call stays inside the time limit.** Before this task a hung provider could take 90 seconds or more against a 60-second limit (45-second timeout, one SDK retry).
- **Good earlier results survive a failure.** Before this task, a provider failure could overwrite a good AI-tailored CV or a good AI line rewrite with rule-based text. Both are now kept.
- **No number moved.** The numeric baseline is `7cfec3a0…0865`, unchanged. This task changed no score, fingerprint, cache key or version.
- It does **not** claim real concurrency. PGlite has one connection, and in-process tests interleave on one event loop.
- It was **not** run against a real provider, real PostgREST or a real function timeout.
- Cost figures are **estimates of provider cost only**, from a price table, and have not been reconciled with an invoice.

## Changed files

| File | Change |
|---|---|
| `src/lib/analysis/job-state.ts` (new) | States, allowed moves, workflows, limits, time budget. Pure. |
| `src/lib/provider.ts` (new) | `callProvider`: per-call timeout from the remaining budget, 2 attempts, failure classes, circuit breaker, 8 calls in flight per instance, usage meter, price table. |
| `src/lib/analysis-job.ts` (new) | `runAnalysisJob`, `friendlyFailure`, student messages. |
| `src/lib/analysis-metrics.ts`, `src/app/api/cron/analysis/route.ts` (new), `vercel.json` | Daily sweep, purge, metrics log and error-rate alert. |
| `supabase/migrations/20261107180000_analysis_jobs.sql` (new, **not applied**) | `analysis_jobs`, `ai_usage.failed`, claim, charge, finish, sweep, get and metrics functions. Service role only. |
| `src/lib/ai.ts` | Additive: both request sites go through `callProvider`, SDK retries off. Prompts, `JUDGE_SYSTEM`, `AI_JUDGE_CONFIG` and OP-015's rewrite functions unchanged. |
| `src/lib/repo/types.ts`, `demo.ts`, `supabase.ts` | `claimJob`, `chargeJob`, `finishJob`, `getJob`; `AI_FAILED_LIMITS`. |
| `src/lib/cv-flow.ts`, `src/lib/rewrite-flow.ts` | Scoring and line rewrites run as jobs. |
| `src/app/actions/cv.ts`, `letters.ts`, `tailor.ts` | Jobs and `friendlyFailure`; attempt keys on letters. |
| `src/lib/tailor-flow.ts` | Not mine. The tailoring agent moved `createTailoredVersion` here during this task and kept the job wrapping (see "Concurrent work"). |
| `src/app/letters/LetterStart.tsx`, `src/app/letters/[id]/page.tsx` | Client attempt key; notice for a rule-based draft. |
| `src/app/reviews/[id]/source/page.tsx` | **Added `maxDuration = 60`.** Its correction panel scores a CV, and the page had no limit declared. |
| `src/lib/env.ts` | Boot warning if `SCORING_VOTES` is set. |
| `docs/OPERATIONS.md` | Recovery, cost, alerts, schedule, data lifecycle row. |
| `tests/recovery.test.ts` (33), `tests/recovery-db.test.ts` (29), `tests/recovery-actions.test.ts` (16), `tests/fixtures/provider-stub.ts` (new) | 78 tests. |
| `supabase/tests/schema.test.mjs` | 25 new checks. |

## Behaviour

### States

`queued` → `processing` → `completed` | `partial` | `failed`, and `failed` → `processing` on retry. `queued` can also go to `failed` if nobody returns within an hour.

- **`queued` has no worker behind it.** It means a concurrency limit was full. The student's retry with the same key starts the job.
- **`partial` means done with part unavailable:** a rule-based letter draft or tailoring prompts because the provider failed, a tailor report on the rules' reading alone, a kept line rewrite, or proofreading unavailable.
- **A failed judge is still no score.** OP-010's rule stands: it is `failed`, never `partial`.

### Time

| Limit | Value | Why |
|---|---|---|
| `maxDuration` | 60 s, on all 7 pages whose actions reach the provider | A test checks each page. |
| Provider budget | 50 s from the request's start, including reading the file | Leaves 10 s to save or fail cleanly. |
| One call | min(45 s, what's left) | |
| Attempts per call | 2 | Retried only for timeouts, connection errors, 429 and 5xx. Not retried if under 5 s would be left, or if `Retry-After` doesn't fit. |
| Lease | 90 s | Longer than any run can live, so an expired lease means the run is gone, not slow. |
| Wait for a duplicate | 20 s, then "still working" | |

### Idempotency

| Workflow | Key | A repeat counts for |
|---|---|---|
| `cv_score` | The CV version | Always. This closes OP-006's noted gap of quota reserved twice in parallel. |
| `letter_draft`, `letter_review` | Content hash + client attempt key | Always. With no key (an old tab): 15 s after finishing. |
| `letter_improve` | Report + hash of the letter | 15 s after finishing. |
| `tailor_create` | Hash of CV, title, employer, URL, deadline, advert | 15 s after finishing. |
| `tailor_version` | Report + keywords + edit revision | 15 s after finishing. |
| `line_rewrite` | Report + line + variant | 15 s after finishing. |

Running work is always deduplicated, whatever the window.

### Quota: settling the open item

**Decision made: failed attempts do not consume quota.** The limit counts what students received. A use is given back whenever the student didn't get what they asked for, including a rule-based fallback. This also applies to AI output blocked by a validator.

That creates a cost exposure, so there are guards:
- Failures that reached the provider are counted in `ai_usage.failed`, with a daily cap equal to the normal limit (`AI_FAILED_LIMITS`). Past it, the provider isn't called for that student that day. **Worst-case provider spend per student per kind is therefore about twice the old limit.** See decision 1.
- Failures that never reached the provider (open circuit, failed save) don't count towards the cap.
- Three failures in a row on one piece of work rest it for 5 minutes.
- `charge_analysis_job` refuses at the limit without climbing, so the count no longer passes it.
- Students cannot call the release path. Those functions are service-role only, and a schema test checks that a student can't reset their own counts.

### `SCORING_VOTES` open item

I cannot read the production environment, so this stays open (decision 3). The boot log now warns if the variable is set.

### Previous results

| Failure | Before | After |
|---|---|---|
| CV scoring fails | Previous report kept | Same, tested byte for byte. |
| Regenerating a tailored CV fails, or the limit has gone | Overwritten with rule-based prompts | Kept, with a message saying so. |
| Line rewrite fails | Good AI suggestion overwritten by rules | Kept, with a note. |
| Improve a letter fails | New "(improved)" report made from rules, ignoring the letter | **Error, no new report.** Letter untouched. This is a deliberate output change. |

### Concurrency

- Three running jobs per student, serialised by an advisory lock.
- 40 running jobs across all students. This is a soft limit, counted without a global lock, and 40 is my guess (decision 2).
- Eight calls in flight per server instance.
- The circuit breaker opens for 30 s after 5 outage failures in a row, per instance.

### Observability

Each attempt logs `analysis-job`: workflow, state, attempt, latency, calls, retries, tokens, estimated cost, failure counts by class. `analysis_metrics(since)` gives per-workflow totals, failure rate, p50 and p95 latency, tokens, cost, and cost per completed workflow, with failed attempts' cost spread over what finished. The daily cron logs these and alerts at 20% failures over at least 20 attempts, which are starting values and not calibrated.

Log field names avoid the logger's redaction list, so `log.ts` was not changed. Job rows have no column that could hold a document, and database checks refuse text in the code, key and result fields.

## Failure injection

Only `fetch` is replaced, so requests go through the real SDK. Run with `npm run test:engine`, or the three files alone.

| Injected | Result | Test |
|---|---|---|
| 503 outage | No score, at most votes × 2 calls, use back, retry works, same job | `recovery`: provider outage |
| Invalid JSON | Same | `recovery`: invalid JSON |
| Schema-breaking output | Same | `recovery`: schema-breaking |
| Refusal | Same | `recovery`: a refusal |
| Cut-off output | Same | `recovery`: cut-off |
| Balance exhausted (400) | Same, plus alert `ai-budget-exhausted` | `recovery`: exhausted |
| Hung connection | Ends inside the budget, one try per vote | `recovery`: a hung provider |
| 429 with short and long `Retry-After` | Retried once; not waited for | `recovery`: rate limits |
| 400 | Not retried | `recovery`: a client error |
| Repeated outages | Breaker opens: no call, fails fast, no charge; closes again | `recovery`: circuit breaker |
| Five clicks at once | One attempt's calls, one use, one report, same id | `recovery`: repeat clicks |
| Click after finishing | Same report, no call | `recovery`: a click after |
| Repeat outlives its wait | "Still working", no call or charge | `recovery`: a repeat that outlives |
| Run killed at the limit | Settled on next request, use back once, one use for the run that finishes | `recovery`: orphaned; `recovery-db`: expired lease |
| Zombie run finishing late | Refused | `recovery`: a run whose server died |
| Over a student's limit | Stays `queued`, no charge, same retry runs | `recovery`: concurrency; `recovery-db`: at a student's limit |
| Over the global limit | Told to wait, no provider details | `recovery`: concurrency; `recovery-db` |
| Three failures in a row | Rests 5 minutes, no call; then runs | `recovery`: bounded retries; `recovery-db` |
| At the daily limit | Plain message, no call, count stays | `recovery`: quota; `recovery-actions`: limit tests |
| At the failure cap | Plain message, no call | `recovery`: failures have their own cap |
| Session expired before the action | Told to sign in, nothing called (6 actions) | `recovery-actions` |
| Session expired mid-run (`PGRST301`) | Message, use back, retry pays nothing more | `recovery`: session expiry |
| Save fails after scoring | No report, use back, retry pays nothing more | `recovery`: a save that fails |
| Job store unavailable | Analysis still runs, alert fires, older counter used | `recovery`: job tracking unavailable |
| Provider output or errors quoting a canary | Not in logs, job rows or results; API key not in logs | `recovery`: logs |
| Letter, tailor and rewrite outages | Partial or kept, as in "Previous results" | `recovery-actions` |

**Mutation checks**, in the isolated copy (`scratchpad/op-025/copy`), 78 tests unmutated:

| Mutation | Tests failing |
|---|---|
| SQL finish gives no use back | 3 |
| Demo finish gives no use back | 23 |
| Budget ignored in the call timeout | 1 |
| Repeat of running work not detected (demo) | 8 |
| Breaker never opens | 1 |
| Tailored CV overwritten on failure | 1 |

## Validation: actual results

Final run, 7 November 2026, `ANTHROPIC_API_KEY` blank at launch. Tests set a dummy key in-process (`test-key-never-sent`), as OP-010's did, with `fetch` replaced.

| Check | Result |
|---|---|
| `npm run typecheck` | Exit 0. |
| `npm run lint` | Exit 0, 0 errors, 1 warning. |
| `npm run test:engine` | Exit 0, **630 passed, 0 failed**. 78 are OP-025's (`--test` on my three files alone: 78 passed). |
| `npm run test:db` | Exit 0, **274 PASS, 0 FAIL**. 25 are OP-025's. The migration applies in PGlite. |
| `git diff --check` | Clean. New files checked separately for trailing whitespace: none. |
| Numeric baseline | **`7cfec3a0082afd06ac2cb9aee7f06ea52e9a232e2cae3744590087e520500865`**, measured mid-task and on the final tree. Script: `scratchpad/op-025/baseline.ts`, copied from OP-010's. |

**Earlier failures on the way, in files I don't own**, all cleared without action from me on the final run:
- `tests/scoring-contract.test.ts`: another agent bumped `PARSER_VERSION` and `LEXICON_VERSION` to `2026-11-07.1` mid-task, then recorded the hashes.
- `tests/engine.test.ts` "tailoring never adds a number", `tests/rewrite.test.ts` rule-engine counts, `tests/security-tenancy.test.ts` (`proofreading.ts`), and typecheck errors in `scripts/calibration/`, `tests/extract.test.ts`, `TailorView.tsx` and `tests/calibration-import.test.ts`.

**Browser, demo mode:** an isolated copy, `next dev -p 3525`, with Supabase, Resend and Anthropic keys blank, boot log `"mode":"demo"`. Stopped by its own port afterwards. The founder's :3000 returned 200 after. Script and results: `scratchpad/op-025/browser.mjs`, `browser-results.json`, `letter-notice.png`.
- Double-clicking "Score my CV" and "Write my draft" each ran exactly one job (2 `analysis-job` log lines in total) and reached one report.
- The rule-based-draft notice rendered. Axe found no violations on that page. No overflow at 390 px.
- **This run is rules mode only, so it shows no provider failure in the browser.** The notice was opened through its URL.

## Limitations

- **Real races are unproven.** The guarantee rests on the advisory lock, row locks and the unique index, and those have only run serially.
- **The Supabase repository's job methods have run against the real SQL through a stand-in for `rpc`, not real PostgREST.** Named arguments and JSON return shapes need checking on a non-production project.
- **Session-expiry detection relies on PostgREST's `PGRST301/302/303` codes and message text,** which I could not observe live.
- **A real function kill was not exercised.** It was simulated by expiring a lease.
- **A narrow duplicate remains:** if a function dies in the moments between saving a letter or tailor report and ending the job, a retry makes a second report. It is charged once. CV reports can't duplicate, because of the unique index on the version.
- **Cost is incomplete:** a killed attempt's usage was in memory and is lost. Storage, exports, extraction and support are not counted, though the blueprint's measure includes them. A server-side fallback is priced at the served model's rate and flagged `cost_complete = false`. Prices are from a table cached on 6 October 2026.
- **The breaker and the call cap are per server instance,** so several instances each trip separately.
- **Without the migration** there is no repeat protection beyond the existing unique indexes, and no refunds.
- **The daily cron is the backstop for students who never return.** Their use comes back within a day, and it is returned to the day it was taken from.
- **`reviewDraft` and non-AI edits aren't jobs.** A double click on `reviewDraft` can still make two reports.
- **Two rewrites of different lines of one report at once can still lose one**, because `updateReport` writes the whole payload.
- **No load test was run.** The blueprint asks for one with an agreed workload.
- **"Midnight" in quota messages is UTC.** In British Summer Time that is 1am.
- **Provider error text that quotes a document without quotation marks** relies on the logger's `safeErrorMessage`. The canary test covers the quoted form only.

## Migration impact

`supabase/migrations/20261107180000_analysis_jobs.sql` sorted after every existing file when named. `20261107190000_proofreading_choices.sql` was added afterwards by another agent. **It has not been applied anywhere**; it has only run in PGlite.

- Additive: a new table, a new `ai_usage.failed` column defaulting to 0, and new functions. It rewrites no report and no score.
- The old app works after it. The new app works before it, with alert `analysis-jobs-unavailable`, no repeat protection and no refunds. Apply it first, as `docs/OPERATIONS.md` says.
- Rollback: drop the table, the functions and the column.
- `vercel.json` gains a daily cron, `/api/cron/analysis`, which needs `CRON_SECRET`.

## Unresolved questions

Founder decisions:
1. **Failed attempts don't consume quota, with a separate failure cap.** I chose this so students aren't charged for outages. It roughly doubles worst-case provider spend per student per kind. Are the caps (equal to the limits) right?
2. **Is 40 concurrent jobs right?** It should be set from the Anthropic account's real rate limits, which I don't have.
3. **Is `SCORING_VOTES` set in production to anything but 3?** Carried over from OP-010. The boot log now warns.
4. **Is a daily spending ceiling across all students wanted?** None was built. Today's control is per-student limits, plus the provider's own spend limit.
5. **Is 90 days right for keeping job rows?** They hold a user id and counts, and are deleted with the account. Check against the DPA and the privacy notice.
6. **Is the Vercel plan able to run a 60-second function and this cron?** I assumed so from the existing `maxDuration` and cron entries.

Codex:
7. A rule-based fallback gives the use back, and so does an AI answer that a validator blocked. Is that the right reading of "failed attempt"?
8. `improveLetter` now returns an error during an outage instead of a rule-based "(improved)" letter. Is that acceptable?

## Concurrent work

- **The tailoring agent moved `createTailoredVersion` into `src/lib/tailor-flow.ts` during this task and kept the job wrapping, quota handling and preservation rule.** So that file's job logic was adapted by that agent from my code. My action-level tests exercise it and pass. Codex should attribute it accordingly.
- **`tests/recovery-actions.test.ts`, the "version worth protecting" assertion, was changed by another agent** (its comment cites OP-014) to fit that flow, so a test file I own contains one line I didn't write.
- I did not edit `src/app/_landing/`, `src/app/tailor/`, `job.ts`, `scripts/calibrate.ts`, the logger, or any other agent's tests.
- `tests/sources.test.ts` expects a failed save to throw from `correctFlow`, so `cv_score` rethrows at flow level and the actions turn it into a message through `friendlyFailure`. Line rewrites do the same for `tests/rewrite.test.ts`.

## Checks Codex must rerun

1. `npm run typecheck`, `lint`, `test:engine`, `test:db` and `git diff --check`, on a tree where concurrent work has settled.
2. `NODE_OPTIONS=--conditions=react-server npx tsx --tsconfig tsconfig.json --test tests/recovery.test.ts tests/recovery-db.test.ts tests/recovery-actions.test.ts`: expect 78 passed.
3. The baseline script: expect `7cfec3a0…0865`.
4. The mutations above, on a copy.
5. Apply the migration on a non-production project, then exercise the four job RPCs through real PostgREST, including two truly parallel claims of one key.
6. Force a real function timeout on a preview deployment, and confirm the lease path returns the use.
7. Check `SELECT` on `analysis_jobs` is refused to `authenticated` on real Supabase, and run the security advisor.
