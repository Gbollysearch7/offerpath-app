# OP-010: version scoring and define incomplete coverage

Prepared 7 November 2026 by Claude, for independent acceptance review by Codex. Nothing was committed, pushed or deployed. No migration was applied, and no live database or paid provider was touched. `next build` was not run. Other agents were editing the same working tree throughout (see "Concurrent work").

**Status: Implemented → Locally verified.** No human or operational gate was passed.

## What this does and does not claim

Every new report now records the versions that produced its score. Scores are compared only within one version set and method, and only when fully assessed. A CV with no bullets gets no overall score shown, and a low-confidence reading is marked incomplete.

- **No stored score changes, and no report is rewritten or rescored.** The numeric baseline hash is identical before and after.
- **I found no path where a provider failure awards marks.** That acceptance item already held; it is now tested through the real judge path. See "Outputs that changed".
- **Simultaneous first analyses already agreed per key.** This task adds a worst-case interleaving test and closes one related gap, the vote quorum.
- It does **not** ship the four gated parser fixes.
- It does **not** validate the score against advisers (OP-011).
- It was **not** run against a real provider, real PostgREST or concurrent Postgres connections (see "Limitations").

## Changed files

| File | Change |
|---|---|
| `src/lib/analysis/scoring-contract.ts` (new) | `ScoringRecord`, identity, core fingerprint, series rule for saved reports, `comparableScores`. |
| `src/lib/analysis/coverage.ts` (new) | Coverage policy, `scoreContext`, `comparableHistory`, `presentedScore`. |
| `src/lib/analysis/fingerprint.ts` | `NORMALISER_VERSION`. Behaviour unchanged. |
| `src/lib/analysis/judgment.ts` | `JUDGE_PROMPT_VERSION`, `AI_JUDGE_CONFIG`; keys accept a rubric argument. Default keys are unchanged. |
| `src/lib/analysis/rubric.ts` | Comments only: version table and correction path. `RUBRIC_VERSION` not bumped. |
| `src/lib/analysis/cv.ts` | Two lines: import, and `meta.scoring`. |
| `src/lib/analysis/findings.ts` | Exports `NEEDS_BULLETS`. |
| `src/lib/ai.ts` | Exports `JUDGE_SYSTEM`; judge request reads `AI_JUDGE_CONFIG` (same values). |
| `src/lib/scoring-core.ts`, `src/lib/scoring.ts` | Quorum, publication and retry rules, `SCORING_VOTES` removed. The register's "services.ts scoring path" actually lives in these two files. |
| `src/lib/services.ts`, `src/lib/types.ts`, `src/lib/report-schema.ts` | `meta.scoring`, `ReportRow.scoring`, `institutionalGuidance` and `withInstitutionalGuidance`. |
| `src/lib/repo/demo.ts`, `src/lib/repo/supabase.ts`, `src/lib/repo/types.ts` | List rows carry series and coverage. The v0 demo seed drops `meta.scoring`. |
| `src/app/reviews/[id]/page.tsx`, `breakdown/page.tsx`, `src/app/dashboard/page.tsx`, `src/app/tailor/page.tsx`, `src/app/admin/page.tsx` | History, deltas, withheld and incomplete states, admin wording. |
| `.env.example` | `SCORING_VOTES` removed. |
| `supabase/migrations/20261106120000_score_series.sql` (new, **not applied**) | `report_score_series`, `student_fact.comparable_cvs`, `admin_student_facts`, `student_flag`. |
| `supabase/tests/schema.test.mjs` | 15 new checks. Existing seeded reports now carry a series payload, otherwise they would be unknown and the admin figures would go unexercised. |
| `tests/scoring-contract.test.ts` (22), `tests/scoring-provider.test.ts` (9), `tests/fixtures/score-series-cases.json` (new) | New tests and the expected answers shared by TypeScript and SQL. |
| `tests/fixtures/fake-supabase.ts` | Models PostgREST JSON-path columns. |
| `tests/payload.test.ts`, `tests/fixtures/legacy-payloads.ts` | v0 fixtures no longer carry `meta.scoring`, because a real v0 report never has it. |

## Behaviour

**Simultaneous first analyses.** `putIfAbsent` is the single publication point and is atomic per key in Supabase. Everyone re-reads after writing, so all attempts score from the first verdict that landed. The test forces 8 attempts to read an empty cache before any may write, using contradictory judges and four sectors. All 8 really judge, and all report one answer.

**Retries.** An attempt is all or nothing.
- If any bullet lacks a quorum of valid votes (2 of 3), or the store fails, the attempt publishes nothing of its own and saves no report.
- The source version is kept, so a retry needs no new upload.
- A repeat of a scored version returns the same report and calls nothing.

**Invariance.** `scoreCv` takes only text and sector. Tests cover five sectors, two demo accounts with different institution ids, and the Supabase repository through `uploadFlow`. They compare score and `coreFingerprint`. A source check also asserts the scoring modules import no session or repository.

**Institutional guidance.** `institutionalGuidance` sits beside `analysis` and has no score field. The strict schema rejects a score inside it, and rejects an institution inside `analysis.meta`. Nothing writes or renders it yet (OP-021). I avoided the name "supplemental" because OP-009 uses it for its findings.

**Student views.**
- The overview charts and compares only the same series, with a note counting what was set aside.
- The dashboard delta applies only within a series.
- Withheld scores show as "No overall score" on the overview and breakdown, and as "–" in lists and the tailor picker.

## Outputs that changed

No stored score, and no number in the baseline, changed. The output changes are:

| Output | Before | After | Why |
|---|---|---|---|
| `analysis.meta.scoring` on new reports | absent | present | The version record. It is not part of the baseline's selected fields. |
| 1 of 3 votes survive | Report saved; verdict cached permanently | No score, nothing cached | One vote from a degraded provider should not become the permanent answer for every student. |
| No-bullet CV (e.g. `symbol-bullets.pdf`, stored 22) | Number and band shown | "No overall score"; number stays stored | About 39% of the weight was assessed. |
| Low-confidence reading, scored anyway (`mixed-scan.pdf`, 80) | Shown as normal | Shown and marked "Incomplete"; not compared | The score reflects the reading as well as the writing. |
| Demo history | v0 report charted with the rest | Set aside: "+22 since first comparable upload" | v0 records no parser version, and the parser changed under this rubric version. |
| Admin improvement, "Not improving", "Improved by 10+" | Across any versions | Same series only, **once the migration is applied** | See "Migration impact". |
| Admin KPI wording | "Up from X", "Per student" | "First comparable score averaged X", "Comparable scores only" | The two averages can now cover different students. |
| `ScoreResult.method` for no bullets under AI | "ai" | "rules" | Not persisted; no judge ran. |
| `SCORING_VOTES` | Env override, 1 to 5 | Fixed at 3 | Model configuration is part of the contract. **Check the deployed environment** (unresolved question 3). |

**No version was bumped for the quorum.** It awards no marks and changes no result when votes arrive, and scoring rules are untouched. Codex may disagree (unresolved question 2).

### Audit run on provider failure

`tests/scoring-provider.test.ts` replaces only `fetch`, so no request leaves the process. It runs `uploadFlow` → `scoreCv` → `aiJudgeBullets` → the SDK.

Each of these gives no score, no saved report and no cache row: outage, invalid JSON, schema-breaking output, refusal, truncation, a skipped bullet, and one surviving vote. Two votes of three succeed. A retry after an outage scores once and repeating adds nothing.

## Version contract

Identity is `method|rubric|parser|lexicon|normaliser|judgePrompt|model`, with `-` for the rule engine's prompt and model. Current values:

| Part | Value | Bump when |
|---|---|---|
| Rubric | `rubric-2026-10-30.1` (unchanged) | A weight, penalty, target or threshold changes, or a verdict is corrected. |
| Parser | `parser-2026-11-05.1` (unchanged) | Any input would be cut differently. |
| Lexicon | `lexicon-2026-11-05.1` (unchanged) | A word list changes. |
| Normaliser | `normaliser-2026-11-06.1` (newly named, behaviour unchanged) | `normaliseText` or `bulletKey` would return anything different. |
| Judge prompt | `judge-prompt-2026-11-06.1` (newly named, prompt unchanged) | `JUDGE_SYSTEM` or `AI_JUDGE_CONFIG` changes. A prompt change also requires a rubric bump, because the cache key holds only rubric and model. |
| Model | `claude-haiku-5-5` (unchanged) | A different model judges. |

**Extractor excluded.** `EXTRACTOR_VERSION` is not part of the identity, because the contract runs from text to score. It stays recorded in document metadata.

**Normalisation contract.** NFKC, one form for quotes, dashes, spaces and bullet markers, and trimmed lines. `bulletKey` also ignores case and punctuation. The function is idempotent, and golden vectors freeze it.

**Enforcement.** `tests/scoring-contract.test.ts` holds a hash of what each version covers, plus a hash of fixture numbers. A change without a bump fails with a message saying what to do.

**Series for saved reports.**
- OP-010 onwards: the recorded identity.
- OP-004 to OP-010: built from `assessment.versions` and `meta`, using the first recorded normaliser and prompt names. These stay comparable with new reports.
- Before OP-004: null, because the parser version is unknown. Two unknowns are not compatible.

`meta.fingerprint` and the cache key formulas are unchanged, so no verdict is orphaned. `coreFingerprint` is the new hash that covers all versions and excludes the sector.

**Correcting a cached verdict.** Bump `RUBRIC_VERSION` and record why in `rubric.ts`. Every key changes, so old rows stay under old keys and bullets are judged afresh on next use. Old reports keep their bytes, and the new series never reads as improvement. This is tested end to end, except that the constant cannot change inside a test: keys use an injected rubric, and the newer record is constructed to match what a real bump would write.

## Coverage policy (`coverage-2026-11-06.1`)

| Status | When | Effect |
|---|---|---|
| complete | All weighted checks assessed; reading not low confidence | Normal. |
| incomplete | Some weight unassessed but at least 60% assessed, or a low-confidence reading | Number shown and marked. Not compared. |
| withheld | Under 60% of weight assessed | Number stored, not presented. Not compared. |

- Scores are never rescaled.
- A failed provider is not a coverage state: it produces no report.
- **OP-007 coordination.** I read its current integration: `cv-flow.ts` stores `payload.proofreading` beside the analysis, and it does not feed `analysis.score`. So its unavailability cannot affect the composite and needs no composite rule. If it ever carries weight, that is a rubric bump and a coverage entry.
- The 60% line is my judgment, not a calibrated value. Today only the no-bullet case (38.9% assessed) falls under it.

## Decision on the four gated parser fixes: not shipped

Effects below are **estimates**, made by editing fixture text the way each fix would and scoring it with `analyseCv`. The fixes themselves were not built.

| Fix | Fixture | Before | Estimated after |
|---|---|---|---|
| 1. Symbol-font bullet markers | `symbol-bullets.pdf` | 22, 0 bullets | 87, 4 bullets |
| 2. Academic headings | `academic.pdf` | 83 | 84 |
| 3. DOCX table row rejoin | `table.docx` | 87 | 87 |
| 4. Repeated header not a role | `repeated-header.pdf` | 90 | 90 |

Reasons for leaving them:
1. A parser bump starts a new series for every student, so it should be one bump covering all pending changes. OP-009 has numeric changes gated on this task too, and bundling avoids two consecutive breaks in history.
2. You asked for the baseline to stay identical, and a bump changes every recorded identity.
3. The worst case no longer misleads: `symbol-bullets.pdf` now shows no overall score instead of 22, goes to the review screen first, and can be corrected there.

**Recommendation:** ship fix 1 first in the next bundled bump. Its withheld message says "Add bullet points" when the student may already have them, which is wrong advice until the fix lands.

## Validation: actual results

Run on the final tree, 7 November 2026.

| Check | Result |
|---|---|
| `npm run typecheck` | **Passes on the final run, no errors.** The run before it failed with 2 errors in `tests/security-auth.test.ts`, and an earlier one in `job-requirements.ts`. Both were concurrent agents' work in progress, since cleared by them; neither was in an OP-010 file. |
| `npm run lint` | 0 errors, 1 warning, the pre-existing `tests/e2e/smoke.mjs:38`. |
| `npm run test:engine` | **380 passed, 0 failed.** 139 at the start of my task; **31 are OP-010's** (`--test` on my two files alone: 31 passed). The rest arrived from concurrent agents. |
| `npm run test:db` | Exit 0, **227 PASS, 0 FAIL.** 15 are OP-010's. Migration applies in PGlite. |
| `git diff --check` | Clean. |
| Numeric baseline, before and after | **`7cfec3a0082afd06ac2cb9aee7f06ea52e9a232e2cae3744590087e520500865`** both times, matching batch 02's final full dump. Script: `scratchpad/op-010/baseline.ts`, copied from OP-004's. |
| `diagnose:audit -- --json` | Before my first edit: exit 0, **2 of 8** gates met. Final: exit 0, **9 of 9** met. |
| `diagnose:audit -- --check --json` | Before: exit **1**. Final: exit **0**. |
| Browser, demo mode | `next dev -p 3400`, boot log `"mode":"demo"`, Supabase, Resend and Anthropic keys blank. Stopped afterwards by its own pid and port only. Script and results: `scratchpad/op-010/browser.mjs`, `browser-results.json`. |

**The gate movement is not OP-010's.** The gates cover proofreading and job matching, which concurrent agents were changing. I edited none of those modules. The observed misspelled CV score is 83 both before and after. I did not diff the rest of the two outputs line by line, or isolate which agent moved which gate.

**Browser observations:** newest report 87, "Up 8", "+22 since first comparable upload", 1 set aside. No-bullet text: "No overall score", no ring, about 39%, "–" on the dashboard. `mixed-scan.pdf`: 80 with "Incomplete", 4 set aside. Axe found no violations on the newest, withheld and incomplete pages. No horizontal overflow at 390 px on the withheld page.

**Dev-server problem, needs attention.** At least four dev servers (:3000, :3400, :3600, :3900) were sharing one `.next`. On my last run authenticated pages returned 404 and webpack errors appeared, and at the end the founder's :3000 returned 404 on `/`. This points to shared build output rather than this diff, and earlier runs rendered these pages correctly, but I did not prove the cause. An earlier 404 for the breakdown page's chunk is unexplained for the same reason. The UI observations above come from the runs that rendered correctly. I did not restart anything on :3000.

## Limitations

- No real provider call. The SDK runs against a simulated `fetch`.
- The JSON-path list columns are checked only against my in-memory fake. **They have never run on real PostgREST.** A syntax problem would break report lists, so check this first on a non-production project.
- PGlite has one connection, so the database race test runs serially. It proves first-write-wins, not parallel locking. The real guarantee rests on the primary key and `on conflict do nothing`.
- Verdicts already cached from a single vote cannot be identified, because rows record no vote count.
- A correction is whole-version: it re-judges every bullet on next use, at normal cost, and splits all history. There is no single-verdict path.
- Comparison checks scoring compatibility only, not that two reports are the same document. Different CVs in one series still compare (OP-019).
- `bumpAi` is charged before scoring, so a failed attempt uses daily quota. Left for OP-025.
- Admin `avgScore` still includes withheld and incomplete latest scores.
- `institutionalGuidance` has no writer or UI.

## Migration impact

`supabase/migrations/20261106120000_score_series.sql` orders after the unapplied `20261105120000_cv_sources.sql`. **It has not been applied anywhere**; it has only run in PGlite.

- It rewrites no report and no score.
- Until it is applied, admin figures keep comparing across versions. Student views do not depend on it.
- When applied, students with reports only from before OP-004 and more than one upload lose their change figure, because their parser version is unknown.
- It is additive, but rolling back means restoring the two previous function bodies and dropping the attribute.

## Unresolved questions

1. Founder: should reports from before OP-004 be compared? I chose no, which removes improvement figures for those students. How many exist in production is unknown to me.
2. Codex: is the quorum correctly unversioned?
3. Founder: is `SCORING_VOTES` set in production to anything but 3? If so, removing it changes first-judgment behaviour.
4. Founder and advisers: is 60% the right withhold line (OP-011)?
5. Coordinator: do you want one bundled bump for the parser fixes and OP-009's numeric changes?
6. OP-025: should failed attempts consume quota?

## Concurrent work

`src/lib/analysis/proofreading/`, `supplemental*`, `claims.ts`, `job-requirements.ts`, `rewrite-check.ts`, `rewrite-flow.ts`, `tests/supplemental.test.ts`, `tests/security-auth.test.ts` and others appeared during this task and are not mine. The brief mentioned only OP-007. `src/app/_landing/` and `docs/CLAUDE_BATCH_02_REPORT.md` were not edited by this task.

## Checks Codex must rerun

1. `npm run typecheck`, `lint`, `test:engine`, `test:db`, `git diff --check`, on a tree where concurrent work has settled.
2. `npx tsx --tsconfig tsconfig.json --test tests/scoring-contract.test.ts tests/scoring-provider.test.ts` with `NODE_OPTIONS=--conditions=react-server`: expect 31 passed.
3. OP-004's baseline script: expect `7cfec3a0…0865`. Capture your own "before" independently if you can.
4. `diagnose:audit` in both modes, and attribute the gate movement yourself.
5. Mutation checks: change a rubric weight, a word list, `JUDGE_SYSTEM` or `normaliseText` without a bump, and confirm the contract test fails. Lower the quorum to 1 and confirm the provider tests fail.
6. Run the `LIST_COLUMNS` select in `src/lib/repo/supabase.ts` against real PostgREST on a non-production project.
7. Run the UI walkthrough with an isolated `.next`: withheld, incomplete and set-aside states.
