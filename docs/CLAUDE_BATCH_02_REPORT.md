# Offerpath batch 02 implementation report

Prepared 5 November 2026 by Claude, for independent acceptance review by Codex. Covers all four batch 02
tasks, **OP-004, OP-003, OP-005 and OP-006**, in that implementation order (OP-004 first because the others
depend on it; OP-003 and OP-005 were then built concurrently in disjoint files; OP-006 last, on top of
OP-005). Batch 01 (OP-001, OP-002) is accepted and its uncommitted changes were left exactly as Codex
reviewed them. Each task has its own "what this does and does not claim" section; the paragraph below is the
batch-level summary.

## What this batch does and does not claim

OP-004 gives every saved report a version, one shared shape for findings, a validation gate that
both repositories run before anything is written, and an adapter that reads reports saved before the
version existed. It changes **no number**: every score, area, check and line score, page estimate,
cache fingerprint and the rubric version are byte-identical to the pre-change engine, verified three
ways (section "Validation"). OP-003 separates score thresholds from display wording and corrects
overstated claims across the app, again changing no number, no rubric version and no cache key. OP-005
records how a document was read (measured versus estimated pages, structure, warnings, confidence) alongside
the unchanged text the scorer sees, and makes an unreadable upload a distinct "not scored" outcome instead of
a report. OP-006 keeps every CV's text as immutable versions, holds a reading below high confidence for the
student to check and correct before anything is scored, scores exactly the corrected (or typed) text as a new
version with provenance, and makes repeats and other students' ids harmless. The numeric baseline was re-run
after each task and on the final tree (section "Combined tree validation").

- It does **not** add proofreading, requirement extraction or any new check. The six unmet audit gates
  are still unmet; the diagnostic's output is unchanged.
- It does **not** migrate stored data. OP-003, OP-004 and OP-005 wrote no SQL. OP-006 adds one migration
  file (`supabase/migrations/20261105120000_cv_sources.sql`, a new table and one nullable column), validated
  in PGlite only and **not applied to any live database**. Historical records are adapted in memory when read
  and are only rewritten in the current shape when the student next edits them, and then they stay marked as
  historical.
- It does **not** calibrate anything. Finding statuses follow the product's existing pass line (8 out
  of 10); severity follows the existing "steps to improve" arithmetic; confidence is `1` for exact rule
  checks, `null` (unknown) for judge-based checks and for every historical record. None of these values
  has been validated by an adviser.
- No claim of adviser validation, calibration, accessibility conformance or production verification is
  made. Every task's status is at most **Implemented → Locally verified**; no human or operational gate was passed.
  Nothing was committed, pushed or deployed; no live database or paid provider was touched.

## Task status

| Task | Status | Notes |
|---|---|---|
| OP-003 — claims inventory and presentation migration | Locally verified | Thresholds and wording separated (`labels.ts`); "Interview-ready" → "Very strong"; 39 claims changed, 18 kept with reason, 12 deferred (9 are landing strings, listed, not applied). Numbers, rubric version and cache keys unchanged. |
| OP-004 — version assessment payloads and evidence | Locally verified | Versioned payloads, finding schema, write-time validation, evidence verification and the legacy adapter, in both repositories. Numbers unchanged. |
| OP-005 — preserve extraction structure and confidence | Locally verified | Per-page text, structure, warnings and confidence recorded alongside unchanged text; measured vs estimated pages; unreadable uploads become a "not scored" outcome; 12 synthetic fixtures; processing limits. `PARSER_VERSION` unchanged (structure added alongside); new `EXTRACTOR_VERSION`. No migration. |
| OP-006 — let students correct uncertain extraction | Locally verified | Immutable versions (`cv_sources`), review before scoring below high confidence, block editor, correction and paste versions with provenance, attempt keys plus content dedupe, ownership in repository, action and (unapplied) database layers. Numbers for existing inputs unchanged. One **unapplied** migration file. |

## OP-004

### Changed files

New:

- `src/lib/report-schema.ts` — the contract. Zod schemas for the three payload types (strict for the
  current version, lenient for v0), `PAYLOAD_VERSION` handling, `PayloadError`, `toStored` (write gate),
  `fromStored` (read adapter) and `checkEvidence` (evidence verification against the text). Zod was
  already a dependency; no package was added.
- `src/lib/analysis/findings.ts` — turns a `CvAnalysis` or a letter review into an `Assessment`
  (`cvAssessment`, `letterAssessment`), finds spelling-variant evidence in the text, and defines
  `PASS_SCORE`, the block scheme (`cvBlocks`) and the legacy limit sentences.
- `tests/payload.test.ts` — 14 tests (listed under "Validation").
- `tests/fixtures/fake-supabase.ts` — an in-memory PostgREST builder for the `reports` table only, so the
  Supabase repository's contract runs without a database.
- `tests/fixtures/legacy-payloads.ts` — synthetic v0 records: a CV under the pre-OP-002 wording, a no-bullet
  CV saved before the 26 October fix with 10/10 on checks that assessed nothing, a letter with and without a
  job ad, and a tailor report.
- `docs/CLAUDE_BATCH_02_REPORT.md` — this report.

Modified:

- `src/lib/types.ts` — `PAYLOAD_VERSION`, `FindingStatus`, `FindingSeverity`, `FINDING_STATUS_LABEL`,
  `EvidenceRef`, `Finding`, `Assessment`; `payloadVersion` on all three payloads; `assessment` on
  `CvReviewPayload` and `CoverLetterPayload`.
- `src/lib/repo/types.ts` — contract comments on `StoredReport`, `getReport`, `createReport`, `updateReport`.
- `src/lib/repo/demo.ts` — reads through `fromStored`, writes through `toStored`; the oldest seeded CV is
  kept in the v0 shape so demo mode always has one historical report.
- `src/lib/repo/supabase.ts` — same two calls; `updateReport` now reads the row's type (with the student's
  session) before validating, and throws "Report not found" for an unknown or foreign id instead of silently
  updating nothing; `supabaseRepo` takes an optional service-role client factory so tests can inject a fake
  (the production call site in `src/lib/session.ts` is unchanged).
- `src/lib/services.ts` — the four payload builders stamp `payloadVersion` and (CV, letter) `assessment`.
- `src/app/actions/letters.ts` — `saveRecomputed` recomputes the letter assessment with the checks.
- `src/app/reviews/[id]/checks/[check]/page.tsx` — a status pill from the finding next to the check name,
  and the historical-record note when the report was saved before findings existed.
- `src/app/reviews/[id]/breakdown/page.tsx` — an "Older report" line in "what the score doesn't cover" for
  historical records, and a footer line naming the findings' origin, parser and word-list versions.
- `src/lib/analysis/parse.ts` — `PARSER_VERSION` constant (3 lines). `src/lib/analysis/lexicon.ts` —
  `LEXICON_VERSION` constant (3 lines). `src/lib/analysis/cv.ts` — the single word `export` on `stepText`;
  everything else in that file's diff is OP-002's accepted work.
- `docs/PLAN.md` — new "Report payload contract" section and one task-list line.

Protected and untouched: `src/lib/analysis/rubric.ts` (SHA-256 `52bb4468…` before and after), every
file under `src/app/_landing/` (only the founder's pre-existing modifications are present), the blueprint
and the task register. `fingerprint.ts`, `judgment.ts`, `job.ts`, `letter.ts`, `tailor.ts`, `extract.ts`,
`scoring-core.ts`, `scoring.ts`, `ai.ts`, authentication, migrations and `.env*` were not edited.

### Behaviour

**Write path.** `createReport` and `updateReport` in both repositories call `toStored(type, payload)`.
It parses the payload against the strict schema for that report type (unknown keys, non-integer or
out-of-range scores, unknown statuses, a confidence above 1, a missing assessment, a future version and
non-objects all fail), then verifies every evidence reference against the saved text. Any failure throws
`PayloadError` and nothing is written; in the Supabase repository this happens before a CV file is
uploaded, so an invalid payload leaves no orphaned file. A refused update leaves the stored report as it
was (tested).

**Read path.** `getReport` and `latestReport` call `fromStored(type, raw)`. A payload with
`payloadVersion: 1` is validated and returned. A payload with no version is v0: it is parsed with the
lenient schema (stray keys dropped, required fields still required), then adapted to v1 in memory with
`assessment.origin = "legacy"`. A version this build does not know throws `PayloadError`, as does a record
that fails even the v0 schema; the report page then errors rather than rendering a guess (see
"Unresolved questions" 4).

**Findings for a CV.** One finding per check, `id` = check key. Status: `not_applicable` when the CV has
no bullet points and the check is one of the nine that need bullets (`quant`, `verbs`, `accomp`,
`repeat`, `filler`, `buzz`, `passive`, `grammar`, `bulletlen`); otherwise `passed` at 8 or more out of
10 and `needs_attention` below. The `bullets` check itself is `needs_attention` with no bullets, so the
absence is still a finding. Explanation is the check's own `detail`; action is the "steps to improve"
text, or "Add bullet points…" for not-applicable checks, or null when passed. Evidence: every affected
line as a `line:<n>` block reference; for `spell`, the exact US variants found by searching the affected
lines (then the whole text) with offsets, so the positions come from the text and not from the check's
list. Method is `ai` for the four judge-based checks (`quant`, `verbs`, `accomp`, `sector`) when the
report was scored by the model and `rules` otherwise; confidence is `1` for rule checks and `null` for
model-judged ones. Versions: `parser`, `rubric`, `model` (the judge in AI mode, else null) and
`dictionary` (the lexicon).

**Findings for a letter.** One finding per `LetterCheck`, `id` = slug of the title. The keyword check
is the boolean that could not be trusted: it is saved as `ok: true` when there were no keywords to
compare, so the finding is `not_applicable` when there was no job ad and `uncertain` when the ad yielded
nothing to look for. Letter findings carry no evidence positions and say so in `limits`.

**Tailor reports** carry `payloadVersion` only. Mapping keyword hits to findings would freeze the
extraction defects the audit reproduced (OP-012/013) into a new structure, so their findings arrive with
that work.

### The schema

`Assessment`

| Field | Type | Meaning |
|---|---|---|
| `documentVersion` | string | sha256 of the assessed text (`CvReviewPayload.text` or `letterText`). Every evidence reference must name it. |
| `versions.parser` | string \| null | `PARSER_VERSION` for current CV assessments; null when not recorded. |
| `versions.rubric` | string \| null | From `analysis.meta.rubric`; null when not recorded. |
| `versions.model` | string \| null | The judge model when scored by Claude; null for the rule engine or when not recorded. |
| `versions.dictionary` | string \| null | `LEXICON_VERSION`; null when not recorded. |
| `origin` | `engine` \| `legacy` | `engine`: recorded when the report was made. `legacy`: derived on read from a v0 record. |
| `limits` | string[] | What the assessment cannot say, in the student's words. Empty for current CV assessments. |
| `findings` | Finding[] | |

`Finding`

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Stable within the assessment: the check key for CVs, the check title's slug for letters. |
| `check` | string | The check category. |
| `status` | enum | See below. |
| `severity` | `high` \| `medium` \| `low` \| `info` | From the estimated score gain (the "steps" arithmetic): ≥ 4 high, ≥ 2 medium, else low; `info` for passed checks and for the zero-weight sector area. Letters: `medium` when needing attention, else `info`. |
| `confidence` | number 0–1 \| null | `1` for exact rule checks; `null` where no calibrated confidence exists (model-judged checks, all historical records). |
| `method` | `rules` \| `ai` \| null | Who produced the judgment; null when a historical record did not say. |
| `explanation` | string | The check's own words at the time it was saved. |
| `action` | string \| null | Suggested next step; null when nothing to do. |
| `evidence` | EvidenceRef[] | `{ documentVersion, block, range: { start, end } \| null, quote }`. Blocks are `doc` (normalised text) or `line:<n>` (`analysis.lines[n].text`). Offsets are valid only in that document version; the quote keeps the evidence readable if they go stale. |

Statuses:

- `passed` — assessed, nothing to fix for this check. It says nothing beyond the check's own coverage:
  the misspelled audit CV is `passed` on UK/US variants with an explanation that says other spelling
  mistakes are not detected.
- `needs_attention` — assessed, something to fix.
- `not_applicable` — the document had nothing for this check to assess (no bullet points; no job ad for
  the keyword check). The score shown is the rubric's handling of that case, not a verdict on the writing.
- `unavailable` — the check could not run (a provider failed or timed out). Defined for OP-007/OP-025;
  nothing in the current engine produces it.
- `uncertain` — the check ran but its result is not reliable enough to act on. Produced today only by the
  letter keyword check when a job ad yields no keywords; proofreading providers will use it.

### Legacy adapter rules: what a historical record can and cannot say

A record with no `payloadVersion`:

- keeps `analysis` exactly as stored — every score, total, line, the saved check names and wording, and
  `meta` (asserted byte-for-byte in tests; a no-bullet row that holds 10/10 keeps its 10s and its total);
- gains `payloadVersion: 1` and an `assessment` with `origin: "legacy"` and two `limits` sentences that
  the check page and the score breakdown show;
- derives each finding's **status** from the saved score and the saved bullet count only. A saved
  `meta.bullets` of 0 makes the nine bullet-dependent checks `not_applicable` even where the row holds
  10/10, which is the one case where a historical record is read more honestly than it was displayed;
- carries the **saved explanation** (the old wording, e.g. "No US spellings found."), never today's;
- reports `confidence: null` on every finding, `method` from `meta.method` when it was saved and null
  otherwise, `versions.rubric` from `meta.rubric`, `versions.model` from `meta.judge` in AI mode, and
  `versions.parser` and `versions.dictionary` as null;
- carries block-level evidence only (`line:<n>` with the line's text), with `range: null` everywhere: no
  character offsets are reconstructed;
- is not rewritten in storage by a read. If the student later edits that report (a line rewrite, an
  accepted suggestion), the row is written in the current shape and keeps `origin: "legacy"` and its
  limits, so it never masquerades as recorded evidence (tested in both repositories and exercised in the
  browser through the real `rewriteLine` action).

Letters adapt the same way; tailor reports gain the version and nothing else.

### Validation: commands and actual results

Run in `/Users/gbolahan/Documents/NEW ME/LevelUp` on 5 November 2026.

| Command | Result |
|---|---|
| `npm run typecheck` | **Pass**, no output. Includes a compile-time check that each schema's inferred type and the TypeScript payload type are identical in both directions (`SCHEMAS_MATCH_TYPES` in `report-schema.ts`). |
| `npm run lint` | **Pass**: 0 errors, 1 warning, the pre-existing unused `eslint-disable` in `tests/e2e/smoke.mjs:38`. |
| `npm run test:engine` | **Pass: 105/105, 0 failed** (91 existing + 14 new in `tests/payload.test.ts`). |
| `npm run --silent diagnose:audit -- --json` | Exit **0**, valid JSON, 8 gates: 2 met, 6 unmet, the same six as the batch 01 review (`proofreading.detects-audit-misspellings`, the four `matching.*` extraction gates, `matching.no-unconditional-baseline`). Observations unchanged: spell 10/10, misspelled CV 83, Excel-only match 77, no-evidence score 30. |
| `npm run --silent diagnose:audit -- --check --json` | Exit **1**, valid JSON. |
| `npm run test:db` | **Pass** (PGlite, no server). Run because the repositories changed; no migration or RPC changed, and `supabase/tests/schema.test.mjs` needed no update: it never reads payload contents. |
| `git diff --check` | Clean. |
| Numeric baseline | A scratch script dumped every number a report carries (total, area, check and line scores, affected indexes, steps, wells, words, pages, bullets, rubric, method, judge, fingerprint, judgments) for the 12 CV/sector cases the batch 01 review used, plus the tailor match scores and keyword hits and the letter review. Captured **before** the first edit and again after the last: byte-identical, SHA-256 `a3bf830104287d59c8e8666512d999c0c98be4a270d84209069fb284bab9abfc` both times. Files: `/private/tmp/claude-501/-Users-gbolahan-Documents-NEW-ME-LevelUp/70ce5228-d909-41a7-b749-2bc52131c2e0/scratchpad/op-004/baseline-{before,after}.json` (temporary, not committed). |
| Browser | No server was listening on :3000, so a `next dev` was started on **:3100 in demo mode** with the Supabase, Anthropic and Resend variables blanked on the command line (boot log: `"mode":"demo"`, "ANTHROPIC_API_KEY is not set"), used with Playwright and the Chrome for Testing binary, then stopped. `next build` was **not** run. 13 page loads, all HTTP 200, no console or page errors: current report (v6) spelling, action verbs, breakdown, overview, lines; legacy report (v3) spelling, quantifying impact, breakdown, overview, lines; the seeded letter and tailor pages. "Try another" on the legacy report's first line ran the real `rewriteLine` action through the adapter; the suggestion changed and the breakdown still showed "findings read from the saved scores · parser unknown". The legacy spelling page at 390px has 0px sideways overflow. Screenshots in `/private/tmp/claude-501/-Users-gbolahan-Documents-NEW-ME-LevelUp/70ce5228-d909-41a7-b749-2bc52131c2e0/scratchpad/op-004/` (`current-spell.png`, `current-verbs.png`, `current-breakdown.png`, `legacy-spell.png`, `legacy-quant.png`, `legacy-breakdown.png`, `legacy-breakdown-after-edit.png`, `legacy-spell-390.png`, with `browser-results.json`). Temporary files; may be removed by cleanup. |
| `npm run test:live`, `npm run build` | **Not run.** Outside scope; a build would have disturbed the founder's dev cache. |

The 14 new tests: findings sit beside the analysis with no number moving (12 cases, two frozen
fingerprints, tailor 35/66 and letter 67 from the baseline); both repositories write and read the same
current payload; every CV check becomes a finding whose evidence resolves in the text; unassessed is
not passed (no-bullet CV); AI-judged checks are marked as the model's with null confidence; the letter
keyword check is `not_applicable` without a job ad and `uncertain` with a vague one; invalid payloads
are refused by both repositories and nothing is saved (nine bad CV payloads, a tailor and two letter
cases, a refused update leaving the stored report intact, a type mismatch on update); evidence that does
not resolve is rejected (out of range, shifted offsets, empty range, unknown block, unknown document,
quote mismatch, duplicate id, and the persistence gate for two of these in both repositories); a v0
record keeps its scores and words with unknowns left unknown; a v0 no-bullet record with 10/10 reads as
not applicable with totals untouched; legacy letters and tailor reports; unknown versions and unreadable
records fail loudly; both repositories read a stored v0 row and keep it legacy after an edit; and the
fixture helper really strips what v0 lacked.

### Limitations

- Statuses and severities are presentational derivations from existing numbers, not new assessments.
  `PASS_SCORE = 8` is the line the check page and "steps to improve" already use, so a report with one US
  variant (8/10) shows **PASSED** next to the variant it found (`legacy-spell.png`). That is the product's
  current semantics made visible, not a judgment that it is right; OP-003 separates thresholds from labels.
- `confidence` is uncalibrated: `1` for exact rules is a statement that the measurement is what it says,
  not that the interpretation is complete; `null` elsewhere. OP-011 owns calibration.
- `unavailable` is never produced yet; `uncertain` only by the letter keyword check. The current engine
  cannot fail partially, so these statuses wait for OP-007/OP-025.
- Character offsets are recorded for UK/US spelling variants only. Other findings cite whole lines.
- Letter findings carry no evidence positions. Tailor reports carry no findings.
- The UI change is small: a status pill on each check page and two lines on the score breakdown. The
  letter and tailor views do not show findings. No axe run was made for the pill and note; they use the
  existing `Tag` component and body-text styles and nothing more is claimed.
- A stored record that fails even the v0 schema produces an error page rather than a readable fallback.
- Legacy rows are upgraded one at a time on edit; no bulk upgrade exists.
- The `supabaseRepo` write path was exercised against an in-memory fake of PostgREST, not a Supabase
  project. The query chains it fakes are exactly the ones the repository uses; anything else throws.

### Migration impact

**None.** No SQL migration was written. `payloadVersion` and `assessment` live inside the existing
`reports.payload` jsonb. The adviser RPC `admin_student_detail` reads `payload -> 'analysis' -> 'areas'`,
which is unchanged in shape and position. Existing rows need no change to be read. `npm run test:db`
passes unchanged. Payloads grow by the findings (roughly 3–8 KB for a typical CV, mostly quoted lines).

### Checks Codex must rerun

1. `npm run typecheck`, `npm run lint`, `npm run test:engine` (expect 105), `npm run test:db`.
2. `npm run --silent diagnose:audit -- --json` (exit 0, 2 met / 6 unmet) and `-- --check --json` (exit 1).
3. Numeric preservation against an independently captured baseline: `git stash` the working tree, dump
   the same fields, restore, compare. `analyseCv`, `jobKeywords`, `matchScores` and `reviewLetter` were
   not edited; `buildCvPayload` wraps the same `analyseCv` call.
4. `git diff -- src/app/_landing/ src/lib/analysis/rubric.ts` to confirm only the founder's pre-existing
   landing changes are present and the rubric is untouched.
5. Render a current and a legacy report in demo mode: the oldest seeded CV (v3) is v0-shaped and the
   newest (v6) is current. Judge whether the status pill wording and the legacy note are adequate before
   OP-003, and whether PASSED at 8/10 with a detected variant is acceptable in the interim.
6. The scope judgments flagged below.

### Unresolved questions for Codex or the founder

1. **Pass line.** Should `passed` start at 8/10 (the existing "Looking good" line) or at 10/10 for checks
   that found something? Changing it is a presentation decision for OP-003 and would not touch scores.
2. **Demo seed.** The oldest demo CV is now deliberately v0-shaped so the adapter is always visible in demo
   mode. The founder's demo therefore shows "saved before Offerpath recorded findings" on v3. Keep as a
   fixture, or move it to tests only?
3. **Bulk upgrade.** Leave historical rows to upgrade on the student's next edit (current), or add a one-off
   script? Either way they stay `origin: "legacy"`.
4. **Unreadable records.** Should a row that fails the v0 schema render a "we can't read this report" state
   instead of an error page? None is expected, but the behaviour should be chosen on purpose.
5. **Finding ids for OP-007.** One finding per check today (`spell`). Per-misspelling findings will need a
   finer id (`spell:<block>:<start>` or similar) for OP-008 dismissals; agree the scheme before OP-007.
6. **`updateReport` on Supabase** now throws "Report not found" for an unknown or foreign id (matching the
   demo repository) and costs one extra `select type` round trip when a payload is patched. Confirm.
7. **Severity.** Derived from the "steps" gain, with sector fit always `info`. Confirm or replace in
   OP-003/OP-019 before anything orders findings by it.

## OP-003 — Claims inventory and presentation migration

Prepared 5 November 2026 by Claude, for independent acceptance review by Codex. Scope: rubric band
presentation, report views, exports, help, templates, letters copy and email surfaces. Landing surfaces
were **not** edited (founder's decision pending); every landing string OP-003 would change is listed in
the "Landing-page change list" below for one coordinated edit.

**Status: Implemented → Locally verified.** No adviser validation, calibration, accessibility conformance
or production verification is claimed. Nothing was committed, pushed or deployed; no live database or
paid provider was touched; `next build` was not run.

### What this does and does not claim

- Score thresholds stay in `rubric.ts`; the words shown for bands, areas, checks and finding statuses
  now live in one module, `src/lib/analysis/labels.ts`, and are looked up from the stored score or key
  when a report is rendered, exported or emailed. Renaming a label cannot change a score, a fingerprint,
  a judgment-cache key or `RUBRIC_VERSION`, and the test suite proves it.
- The top band no longer promises an interview: "Interview-ready" → "Very strong" (the other three
  labels are unchanged). Area names no longer claim checks the engine lacks: "Structure and ATS" →
  "Structure and readability", "Spelling and grammar" → "UK spelling and consistency".
- Historical (`origin: "legacy"`) reports render with the same labels as new ones, because labels are
  derived from the stored score/key. Their scores and saved wording are byte-identical (tested in both
  `tests/payload.test.ts` and `tests/labels.test.ts`). No stored JSON was rewritten.
- It does **not** change the finding-status derivation (`PASS_SCORE = 8` is OP-004's contract). The
  8/10-with-a-detected-variant case is addressed by presentation: the pill now says "TARGET MET" rather
  than "PASSED" (see "Behaviour" and "Unresolved questions" 1).
- It does **not** fix the two reproduced audit failures; the diagnostic output is byte-identical to
  OP-004's (same 6 unmet gates).

### Changed files

New:

- `src/lib/analysis/labels.ts` — `BAND_LABELS`, `bandLabel`, `nextBandLabel`, `bandLegend`,
  `bandRangeText`, `AREA_LABELS`, `CHECK_LABELS`, `areaLabel`, `checkLabel`, `FINDING_STATUS_DISPLAY`.
  The only place a band/area/check/status word is defined.
- `tests/labels.test.ts` — 10 tests (listed under "Validation").

Modified (OP-003 lines only; `cv.ts` and `check-content.ts` diffs against HEAD also contain OP-002's
accepted work, which was not reworked):

- `src/lib/analysis/rubric.ts` — header comment rewritten to state exactly what `RUBRIC_VERSION`
  covers and when it must and must not change; `BANDS` (min + label) replaced by `BAND_THRESHOLDS`
  (min + stable key: `top`/`high`/`mid`/`low`) and `bandKey()`. Thresholds 90/75/50/0, every weight,
  penalty and target, and the version string are unchanged (`git diff` shows only the four band lines
  and the comment; `RUBRIC_VERSION = "rubric-2026-10-30.1"` is untouched).
- `src/lib/analysis/cv.ts` — `AREA_META[*].name` and `CHECK_META[*].name` now come from `labels.ts`;
  `band` is `bandLabel`; new `checkContext(key)` ("Area · Check" from the key, for steps/strengths).
  `analyseCv` logic untouched.
- `src/lib/analysis/check-content.ts` — three before/after examples that escalated responsibility
  fixed; the verbs guidance no longer tells students to replace "Helped" with "Led"; the sector insight
  hedged; new `EXAMPLES_NOTE`.
- `src/lib/analysis/letter.ts` — the all-checks-pass summary says the checks passed and to check every
  fact, not "Ready to send". Score arithmetic untouched.
- `src/components/ui.tsx` — `scoreTone` reads `bandKey()` instead of its own 75/50 copy (same numbers).
- `src/components/ResultsSidebar.tsx` — area and check names from the key, not the saved report.
- `src/app/reviews/[id]/page.tsx` — band chip, "quickest way to reach …", the band strip (colours,
  text labels and aria-label) and area names all derived from `labels.ts`; steps/strengths context
  from `checkContext`. A score already in the top band no longer says "reach Interview-ready".
- `src/app/reviews/[id]/breakdown/page.tsx` — area and check names by key; the area-weights sentence
  is generated from `AREA_WEIGHTS` and the labels; "same score" qualified by scoring version; the
  older-report note updated.
- `src/app/reviews/[id]/checks/[check]/page.tsx` — check name by key; status pill from
  `FINDING_STATUS_DISPLAY`; `EXAMPLES_NOTE` above the before/after examples.
- `src/app/reviews/[id]/examples/page.tsx` — subtitle says the figures are made up and to keep the
  real level of responsibility.
- `src/app/dashboard/page.tsx`, `src/app/admin/students/[key]/page.tsx` — `bandLabel`; admin area
  names by key with the saved name as fallback.
- `src/app/admin/page.tsx` — band bar and legend from `bandLegend()` (text label + score range beside
  every colour; aria-label derived).
- `src/app/admin/export/route.ts` — the TEF pack column "Strong or better (75+)" is derived from
  `BAND_LABELS.high` and the threshold; output unchanged.
- `src/app/letters/[id]/LetterReviewView.tsx` — local "INTERVIEW-READY" band function removed in favour
  of `bandLabel`; "using only facts from your CV" softened.
- `src/app/letters/[id]/LetterDraftView.tsx` — "Every claim has a source" → "Where each paragraph came
  from", with an explicit caveat when the draft is AI-assisted.
- `src/app/letters/LetterStart.tsx` — "We write your letter only from facts in your CV" replaced.
- `src/app/templates/page.tsx` — "ATS-SAFE" badge → "ONE COLUMN"; the intro no longer guarantees ATS
  reading. `src/lib/cv-themes.ts`, `src/lib/documents.ts` — the matching comments and one theme blurb.
- `src/app/tailor/[id]/TailorView.tsx` — "using only what your CV already shows" and "keywords this
  employer screens for" softened.
- `src/app/help/page.tsx` — area list and the "always gets the same score" / "Only you" answers.
- `scripts/calibrate.ts` — uses `bandLabel`. `tests/engine.test.ts` — one assertion string
  ("Interview-ready" → "Very strong").
- `docs/CONTENT_REVIEW.md` — rubric row split into thresholds and labels; the "bump RUBRIC_VERSION"
  rule restated as numbers-only.

Protected and untouched: everything under `src/app/_landing/` (only the founder's pre-existing
changes are present), `src/lib/types.ts`, `src/lib/report-schema.ts`, `src/lib/analysis/extract.ts`,
`parse.ts`, `findings.ts`, `src/app/upload/`, `src/app/actions/`, `tests/fixtures/`,
`tests/payload.test.ts`, `docs/CLAUDE_BATCH_02_REPORT.md`, `docs/PLAN.md`, migrations, `.env*`.

### Behaviour

**Thresholds and labels.** `BAND_THRESHOLDS` in `rubric.ts` carries numbers and stable keys only.
`labels.ts` maps keys to words. The fingerprint (`sha256(RUBRIC_VERSION, method, sector, text)`) and
the judgment-cache keys (`sha256(RUBRIC_VERSION, model, …, bulletKey)`) never included a label; the only
coupling was the rubric file's own rule "change the version whenever anything in this file changes",
which would have rerun every cached judgment for a word change. That rule is now explicit: numbers bump
the version, words never do (comment at the top of `rubric.ts`, mirrored in `docs/CONTENT_REVIEW.md`).

**Render-time names.** Views, the sidebar, the admin student page and the breakdown look up area and
check names by key (`AREA_META`/`CHECK_META`, fed by `labels.ts`) instead of printing the saved
`name`. A report saved as "Spelling / UK spelling throughout" therefore shows "UK/US spelling variants"
as its heading while its saved summary and detail stay exactly as saved (the check page and breakdown
say so). The band is computed from the saved score. New reports still store `areas[].name` and
`checks[].name` (the label at the time of saving), as before.

**Status pill.** `FINDING_STATUS_DISPLAY.passed` is "Target met": the score met the check's pass line
(8/10), which is what the derivation means. It does not say nothing was listed. On the demo's legacy
report the spelling page shows "8/10 · TARGET MET" beside the chip "organize → organise" and the detail
that names it (`check-spell-legacy.png`). `not_applicable` displays as "Not assessed". The constant
`FINDING_STATUS_LABEL` in `types.ts` (OP-005's file) is no longer rendered anywhere; see "Unresolved" 6.

**Examples.** Every check page shows `EXAMPLES_NOTE` above its before/after pairs: the figures are
made up, use your own numbers, keep the level of responsibility you had. Three examples that turned a
supporting role into a leading one were rewritten; the verbs guidance now says "if you supported it,
say so precisely". A test guards every example whose "before" starts with a supporting verb.

**Colour-only meaning.** Every colour-coded band now has a text equivalent: the overview strip labels
and aria-label, the admin bar's aria-label and legend (label + range), band chips, the letter review's
"OVERALL · BAND". `scoreTone` is derived from the same thresholds.

### Label mapping (`src/lib/analysis/labels.ts`)

| Band key | Threshold (rubric.ts) | Label (was) |
|---|---|---|
| `top` | ≥ 90 | **Very strong** (was "Interview-ready") |
| `high` | 75–89 | Strong |
| `mid` | 50–74 | Getting there |
| `low` | 0–49 | Needs work |

| Area key | Label (was) |
|---|---|
| `impact` | Impact |
| `clarity` | Clarity |
| `structure` | **Structure and readability** (was "Structure and ATS") |
| `sector` | Sector fit |
| `spelling` | **UK spelling and consistency** (was "Spelling and grammar") |
| `length` | Length and formatting |

Check labels: unchanged from OP-002 (`UK/US spelling variants`, `Writing consistency`, `Text
readability`, …), now defined in `CHECK_LABELS`.

| Finding status | Display (was, in `types.ts`) |
|---|---|
| `passed` | **Target met** (was "Passed") |
| `needs_attention` | Needs attention |
| `not_applicable` | **Not assessed** (was "Not applicable") |
| `unavailable` | **Not available** (was "Unavailable") |
| `uncertain` | Uncertain |

### Claims inventory

Grep of `src/`, `scripts/`, `docs/legal`, `supabase/templates` and `src/lib/email.ts` for ATS
guarantees, proofreading guarantees, factual absolutes and the "Interview-ready" band. Line numbers are
from the tree before this change. Email templates (`src/lib/email.ts`, `supabase/templates/*.html`)
contain no claims of these kinds and no band labels; nothing to change.

| File:line | Current text (before) | Action |
|---|---|---|
| `src/lib/analysis/rubric.ts:52` | `{ min: 90, label: "Interview-ready" }` | **Changed**: label moved to `labels.ts` as "Very strong"; thresholds only in rubric |
| `src/app/reviews/[id]/page.tsx:66` | "…quickest way to reach Interview-ready / Strong / Getting there" | **Changed**: `nextBandLabel`; top band says "add to your score" |
| `src/app/reviews/[id]/page.tsx:71` | aria-label "…interview-ready 90 and above" | **Changed**: derived from `bandLegend` |
| `src/app/reviews/[id]/page.tsx:81-84` | strip text "NEEDS WORK / GETTING THERE / STRONG / READY" | **Changed**: legend labels |
| `src/app/letters/[id]/LetterReviewView.tsx:11` | own band fn: "INTERVIEW-READY" | **Changed**: `bandLabel` |
| `src/app/letters/[id]/LetterReviewView.tsx:103` | "weave in the missing keywords using only facts from your CV" | **Changed**: "drawing on your CV … can introduce mistakes … check each claim" |
| `src/app/admin/page.tsx:100` | aria-label "…interview-ready N percent" | **Changed**: derived |
| `src/app/admin/page.tsx:110` | legend "Interview-ready" | **Changed**: derived, with ranges |
| `src/app/admin/export/route.ts:20` | "Strong or better (75+)" | **Changed to derive** from labels; output identical |
| `src/app/dashboard/page.tsx:123,197` | `band()` | **Changed**: `bandLabel` (shows new top label) |
| `src/app/admin/students/[key]/page.tsx:31,38` | `band()`; stored area name | **Changed**: `bandLabel`; area name by key |
| `scripts/calibrate.ts:48` | `BANDS…label` | **Changed**: `bandLabel` |
| `tests/engine.test.ts:20` | asserts "Interview-ready" | **Changed**: "Very strong" |
| `src/lib/analysis/cv.ts:14` | area "Structure and ATS" | **Changed**: "Structure and readability" |
| `src/lib/analysis/cv.ts:16` | area "Spelling and grammar" | **Changed**: "UK spelling and consistency" |
| `src/app/reviews/[id]/breakdown/page.tsx:91` | hardcoded "…Spelling and grammar 11.5%" | **Changed**: generated from weights + labels |
| `src/app/reviews/[id]/breakdown/page.tsx:85` | "you get exactly the same score" | **Changed**: "…under the same scoring version; your overview says when that version has changed" |
| `src/app/reviews/[id]/breakdown/page.tsx:94` | "Older reports retain their saved wording, which may use broader check names" | **Changed**: scores and saved wording kept; names shown with current labels |
| `src/app/reviews/[id]/checks/[check]/page.tsx:72` | pill "PASSED" at ≥ 8/10 | **Changed**: "TARGET MET" (`FINDING_STATUS_DISPLAY`) |
| `src/app/help/page.tsx:9` | "…structure, spelling and length … because recruiters notice them first … The same CV always gets the same score." | **Changed**: new area names; "we weight impact and length most"; same score "under the same scoring version" |
| `src/app/help/page.tsx:14` | "Who can see my CV? Only you." | **Changed**: "Only you, unless you choose to let your careers adviser view it…" (the opt-in flag exists) |
| `src/app/templates/page.tsx:43` | "all single column so applicant tracking systems can read them" | **Changed**: "gives screening software the best chance … no layout can guarantee…" |
| `src/app/templates/page.tsx:80` | badge "ATS-SAFE" | **Changed**: "ONE COLUMN" |
| `src/lib/cv-themes.ts:4` | comment "so applicant tracking systems can read it" | **Changed** (comment): best chance, no guarantee |
| `src/lib/cv-themes.ts:146` | "still simple enough for screening software" | **Changed**: "on the same one-column, real-text layout" |
| `src/lib/documents.ts:8` | comment "Builds ATS-safe Word and PDF files" | **Changed** (comment) |
| `src/lib/analysis/check-content.ts:98` | "Recruiters and screening software look for sector terms." | **Changed**: "Recruiters often scan for sector terms, and some screening tools search for them too." |
| `src/lib/analysis/check-content.ts:29` | '"Helped" and "Assisted" hide your contribution; "Organised", "Built" and "Led" make it clear.' | **Changed**: name the specific thing; "if you supported it, say so precisely" |
| `src/lib/analysis/check-content.ts:23` | "Worked on a group consulting project." → "Led a team of 4…" | **Changed**: "Analysed a local charity's costs in a team of 4 and recommended savings worth £18k a year." |
| `src/lib/analysis/check-content.ts:32` | "Helped organise the careers fair." → "Organised a careers fair…" | **Changed**: "Co-organised a careers fair for 30 employers and 600 students." |
| `src/lib/analysis/check-content.ts:33` | "Assisted the marketing team." → "Drafted 12 social posts that grew Instagram followers by 18%." | **Changed**: "…for the marketing team; Instagram followers grew 18% over the campaign." |
| `src/lib/analysis/check-content.ts` (all examples) | invented figures shown as real | **Changed**: `EXAMPLES_NOTE` rendered above every examples section |
| `src/app/reviews/[id]/examples/page.tsx:17` | "Use them for ideas, then write your own with your real numbers." | **Changed**: adds "made-up figures" and "level of responsibility you actually had" |
| `src/app/letters/[id]/LetterDraftView.tsx:115-116` | "Every claim has a source" | **Changed**: "Where each paragraph came from" + AI caveat |
| `src/app/letters/LetterStart.tsx:51` | "We write your letter only from facts in your CV." | **Changed**: "from your CV and the job ad, so we need a CV to draw on" |
| `src/lib/analysis/letter.ts:63` | summary "Ready to send. Read it aloud once more before you do." | **Changed**: "All N checks pass. Read it aloud once more and check every fact before you send it." |
| `src/app/tailor/[id]/TailorView.tsx:118` | "…using only what your CV already shows." | **Changed**: "written from what your CV already shows, but check each line: wording can overstate what you did" |
| `src/app/tailor/[id]/TailorView.tsx:121-122` | "keywords this employer screens for" (×2), "lift you towards" | **Changed**: "keywords we found in this job ad" / "from this job ad"; "lift the match towards" |
| `docs/CONTENT_REVIEW.md:22` | "When changing anything in rubric.ts… bump RUBRIC_VERSION" | **Changed**: numbers only; labels exempt |
| `src/app/reviews/[id]/page.tsx:48` | pill "same CV, same score" | **Kept**: links to the explanation; the page itself says when the rubric changed; true within a version |
| `src/app/reviews/[id]/breakdown/page.tsx:53` | "It never gives a number." | **Kept**: true of the judge design (`JUDGE_SYSTEM`: categorical answers only) |
| `src/lib/analysis/check-content.ts:84-85,105,151-154` | ATS/spell insights and `CHECK_SCOPE` | **Kept**: OP-002 wording, already scoped; "no layout can guarantee" is a negation |
| `src/lib/analysis/check-content.ts:18`, check page:150 | "A careful estimate is fine, as long as you can explain it at interview." | **Kept**: advice to the student, not a product claim |
| `src/lib/analysis/cv.ts:370,521,531` | "terms recruiters in X look for"; "keywords recruiters look for"; "All the sections recruiters expect" | **Kept**: describe the lexicon's lists; stored in check text, so a rewording changes new reports' saved text; left for the adviser content review (`CONTENT_REVIEW.md`) rather than reworded unilaterally |
| `src/lib/ai.ts:21` | "Never invent facts…" | **Kept**: instruction to the model, not a claim to the student (OP-002 decision) |
| `src/lib/analysis/tailor.ts:17` | comment "may reword facts, never invent them" | **Kept**: internal comment on the number check; OP-015 owns fidelity; not student-facing |
| `judgment.ts:5-6`, `scoring-core.ts:7`, `fingerprint.ts:5`, `cv.ts:234`, `types.ts:124` | "always"/"never" in comments | **Kept**: engineering invariants true by construction; not student-facing |
| `src/app/legal/terms/page.tsx:21,34` | "don't guarantee any outcome"; "can't promise … always uninterrupted" | **Kept**: correct negations |
| `src/app/privacy/page.tsx:62`, `OnboardingFlow.tsx:23` | "Never your CV." (share-progress toggle) | **Kept**: true of that toggle; CV access is a separate opt-in described on the same page |
| `src/app/legal/privacy/page.tsx:32` | "but never your CV" | **Kept, flagged**: legal page (lawyer/DPO review); becomes "unless you opt in" once adviser CV access is enabled |
| `src/app/privacy/page.tsx:82` | "exports always leave out groups smaller than five" | **Kept**: enforced by the RPCs and the export route |
| `src/app/help/page.tsx:10` | "A score of 75 or more is strong." | **Kept**: matches the `high` band label |
| `src/app/practice/page.tsx:10` | "Answer real interview questions…" | **Kept, flagged for OP-023**: a static question bank; propose "typical interview questions" |
| `docs/legal/DPIA_TEMPLATE.md:28` | "same CV always same score" | **Kept**: DPO template; true within a version; DPO review item |
| `src/lib/documents.ts:192`, `cv-themes.ts:217` | letter-spacing comments mentioning screening software | **Kept**: describe a measured pdf.js behaviour |
| `src/lib/seed-data.ts:108`, `supabase/migrations/*:bands.ready` | JSON/SQL field names `needs/getting/strong/ready` | **Kept**: data field names, not labels; mapped to labels in `admin/page.tsx`; renaming needs a migration |
| `src/lib/types.ts:145` | `FINDING_STATUS_LABEL.passed = "Passed"` | **Kept (file owned by OP-005)**: no longer rendered; display table is in `labels.ts`; fold together after OP-005 |
| `src/app/upload/UploadForm.tsx:190` | "Use an ATS-friendly template" | **Deferred (file owned by OP-005 this batch)**: propose "Use a one-column template" |
| `src/app/page.tsx:7-8`, `opengraph-image.tsx:5` | "from first draft to signed offer"; "reach their first offer" | **Deferred to landing list**: marketing metadata; aspirational, not a guarantee; no change proposed |
| `src/app/_landing/**` (9 strings) | see next section | **Deferred to landing list** |

Totals: **39 changed**, **18 kept with reason**, **12 deferred** (9 landing strings, 1 OP-005-owned
upload string, 2 landing metadata strings with no change proposed).

### Landing-page change list (not applied; `src/app/_landing/` untouched)

| File:line | Current text | Proposed replacement | Reason |
|---|---|---|---|
| `Landing.tsx:47` | `["90+", "Interview-ready", "bg-brand text-white"]` | `["90+", "Very strong", …]` | Top band must describe the document, not an outcome; matches `BAND_LABELS.top` |
| `Landing.tsx:52` | `"ATS-friendly templates"` / `"CV layouts that screening software can read, with PDF and Word export."` | `"One-column templates"` / `"Plain, one-column CV layouts that give screening software the best chance of reading them, with PDF and Word export."` | ATS guarantee; app now says "ONE COLUMN" |
| `demos/OfferpathHero.tsx:60` | `'Structure and ATS'` | `'Structure and readability'` | Matches `AREA_LABELS.structure` |
| `demos/OfferpathHero.tsx:62` | `'Spelling and grammar'` | `'UK spelling and consistency'` | Matches `AREA_LABELS.spelling`; the engine does not check grammar |
| `demos/OfferpathHero.tsx:61` | `'Sector relevance'` | `'Sector fit'` | The app and `JourneyBento.tsx:97` say "Sector fit" |
| `demos/OfferpathHero.tsx:459` | `Your figures, never invented ones.` | `Your figures, with [brackets] where only you know the number.` | Absolute about AI output; the safeguard is placeholders plus a number check, not a guarantee |
| `demos/JourneyBento.tsx:96` | `'Structure and ATS'` | `'Structure and readability'` | As above |
| `demos/JourneyBento.tsx:98` | `'Spelling and grammar'` | `'UK spelling and consistency'` | As above |
| `demos/LineFixDemo.tsx:173` | `Numbers come from you. We never add facts.` | `Numbers come from you: we leave [brackets] where only you know the figure.` | Absolute; matches the line editor's corrected copy |
| `demos/LineFixDemo.tsx:229` | `"SPELLING · EDUCATION, LINE 1"` | `"UK SPELLING · EDUCATION, LINE 1"` | Optional: area now named for what it checks; keep short in the demo |
| `Landing.tsx:44-46`, `OfferpathHero.tsx:385,387`, `JourneyBento.tsx:155` | "Needs work", "Getting there", "Strong", "reach Strong" | no change | Already match the label table |
| `src/app/page.tsx:7-8`, `opengraph-image.tsx:5` | "from first draft to signed offer", "reach their first offer" | no change proposed | Aspirational product framing, not a guarantee; founder's call |

Suggested follow-up (founder's call): have the landing demos import `AREA_LABELS` and `BAND_LABELS`
from `src/lib/analysis/labels.ts` (a plain constants module with no server-only import) so the two
can never drift again. Not done here.

### Validation: commands and actual results

Run in `/Users/gbolahan/Documents/NEW ME/LevelUp` on 5 November 2026. OP-005 was working in the same
tree concurrently; the counts below are from runs during that session.

| Command | Result |
|---|---|
| `npm run typecheck` | **Pass**, no output. |
| `npm run lint` | **Pass**: 0 errors, 1 warning, the pre-existing unused `eslint-disable` in `tests/e2e/smoke.mjs:38`. |
| `npm run test:engine` | **Pass: 115/115, 0 failed** (105 before OP-003 + 10 new in `tests/labels.test.ts`; `tests/engine.test.ts` has one changed assertion string). OP-005 had added no test file to `tests/*.test.ts` at the time of the run (14 files listed). |
| `npm run --silent diagnose:audit -- --json` | Exit **0**, valid JSON, 8 gates: 2 met, **6 unmet** (`proofreading.detects-audit-misspellings`, the four `matching.*` extraction gates, `matching.no-unconditional-baseline`). Output **byte-identical** to OP-004's saved `diag-observe.json` (`diff` exit 0). |
| `npm run --silent diagnose:audit -- --check --json` | Exit **1**, valid JSON. |
| `git diff --check` | Clean. |
| `git diff --stat -- src/app/_landing/` | Only the founder's five pre-existing modified files; no OP-003 change. |
| `git diff -- src/lib/analysis/rubric.ts` | Only the header comment and the four band lines (`label:` → `key:`); no `RUBRIC_VERSION`, weight, penalty, target or threshold line changed. |
| `npm run test:db`, `npm run test:live`, `npm run build` | **Not run.** No repository, schema or RPC changed; live tests are out of scope; a build would disturb the dev cache. |

**Numeric baseline.** OP-004's dump script was copied verbatim and run before the first edit and after
the last.

- Before: `a3bf830104287d59c8e8666512d999c0c98be4a270d84209069fb284bab9abfc` — identical to OP-004's
  `baseline-after.json`, so the starting point is the reviewed one.
- After: `7cfec3a0082afd06ac2cb9aee7f06ea52e9a232e2cae3744590087e520500865` — **differs**, and the
  entire diff is 4 lines, all `steps[].area` presentation strings: `"Structure and ATS · Text
  readability"` → `"Structure and readability · Text readability"` (the dump includes the whole `steps`
  object, which carries that "Area · Check" label). No score, area score, check score, affected index,
  gain, line score, word/page/bullet count, rubric, method, judge, fingerprint, judgment, tailor match
  score, keyword hit or letter number changed.
- Numeric-only view (same dumps with `steps[].area` dropped, everything else kept): before and after
  both `572b76e1475f05f8ab525833255c0a576c0ec1cbb591c0c9e7a204a432e409d0`, **byte-identical**.
- Judgment-cache identity for a fixed bullet (`coreKey`, `relevanceKey`) captured before and after:
  identical (`a1814457…`, `3afc0078…`); frozen in `tests/labels.test.ts`.

Files: `/private/tmp/claude-501/-Users-gbolahan-Documents-NEW-ME-LevelUp/70ce5228-d909-41a7-b749-2bc52131c2e0/scratchpad/batch-02/op-003/baseline-{before,after}.json`,
`baseline-numeric-{before,after}.json`, `cachekeys-{before,after}.json`, `diag-{observe,check}.json`
(temporary, not committed).

**The 10 new tests** (`tests/labels.test.ts`): thresholds are the rubric's and did not move, and the
rubric holds no band words; band labels describe the document (no interview/ready/hire/offer/pass
words, ≤ 16 characters, UK English), with `nextBandLabel`, `bandLegend` ranges and text alternatives;
renaming a band moves no score, fingerprint, rubric version or judgment-cache key (frozen values, an
alternative label table, and proof that no band word is stored in the analysis for the 12 cases); area
and check names come from the label table and name only what is measured; a legacy report keeps its
saved names/wording/scores byte-for-byte while rendering the same labels as a current report with the
same score (both v0 fixtures); every finding status has a display label and 8/10 with one variant found
shows "Target met" with the variant still named; before/after examples never turn a supporting role
into a leading one and the note says figures are made up; copy constants and the engine output for the
12 cases carry no ATS/proofreading/outcome guarantee; a letter that passes every check is told the checks
passed, not that it is ready; the area-weights sentence and the CSV band header are derived correctly.

**Browser.** `next dev -p 3100` started in demo mode with `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY` and
`TEST_LOGIN` blanked on the command line; boot log `{"mode":"demo"}` and "ANTHROPIC_API_KEY is not
set"; stopped afterwards (no listener on :3100). Playwright with Chrome for Testing: 16 page loads
(student: dashboard, current v6 overview/breakdown/verbs/ats/examples, legacy v3
overview/breakdown/spell, templates, help, a letter review; admin: careers dashboard), **all HTTP 200,
no console or page errors**. Text sweep on every page for `Interview-ready`, `ATS-SAFE`,
`ATS-friendly`, `Spelling and grammar`, `Structure and ATS`, `PASSED`, `READY`, "only facts from",
"Every claim has a source": **no hits**. Expected strings found: "VERY STRONG" strip label on both
overviews; "Structure and readability 17.5%, … UK spelling and consistency 11.5%" and "under the same
scoring version" on the breakdown; "Older report" and current check names on the legacy breakdown;
"8/10 · TARGET MET" beside "organize → organise" on the legacy spelling page; the examples note on the
verbs page; "ONE COLUMN" and "no layout can guarantee" on templates; "Very strong 90+" … "Needs work
0–49" in the admin legend; the TEF CSV header still "Strong or better (75+)" with no "Interview-ready".
The help page's answers are inside collapsed `<details>`, so a second pass expanded them: all three new
sentences present. 390px current overview: **0px** horizontal overflow. Screenshots in
`…/scratchpad/batch-02/op-003/` (`overview-current.png`, `overview-legacy.png`,
`breakdown-current.png`, `breakdown-legacy.png`, `check-spell-legacy.png`, `check-verbs-current.png`,
`check-ats-current.png`, `templates.png`, `letter.png`, `admin.png`, `overview-current-390.png`,
`help-expanded.png`, `dashboard.png`, with `browser-results.json`). A focused visual check, not an
accessibility audit; no axe run.

### Limitations

- New reports still store `areas[].name`, `checks[].name` and `steps[].area` as text (the label at
  save time), as they always have. Views no longer read them, but raw exports (the "Download my data"
  ZIP, which dumps payload JSON) and the `admin_student_detail` RPC still carry whatever was saved.
  Older rows therefore keep "Spelling and grammar" in the ZIP; this is disclosed, not migrated.
- `PASS_SCORE = 8` and the status derivation are unchanged (OP-004's contract). "Target met" is a
  presentation fix; whether a found variant at 8/10 should be `needs_attention` is a product decision
  (Unresolved 1).
- `FINDING_STATUS_LABEL` in `types.ts` is now dead for rendering but could not be removed (OP-005 owns
  the file). Two tables exist until that is folded into `labels.ts`.
- The claims sweep is a regex over copy constants and engine output; page components (help FAQ, legal
  pages) are not importable in node tests, so they were checked in the browser and by review only.
- Browser check used fictional demo accounts; no production report was loaded. No accessibility
  conformance is claimed for the new legend text or the examples note beyond the existing styles and
  the text alternatives added.
- `cv.ts:370/521/531` keep "recruiters look for / expect" phrasing (adviser-review content); see the
  inventory.

### Migration impact

**None.** No SQL migration, no schema or RPC change, no payload shape change (`PAYLOAD_VERSION` stays
1, `report-schema.ts` untouched). No stored row was read-modified-written. `npm run test:db` was not
run because nothing it covers changed.

### Unresolved questions for Codex or the founder

1. **8/10 with a found item.** OP-004's pass line (8) now reads "Target met". If the founder prefers a
   found US variant to be `needs_attention` regardless of score, that is a change to `findings.ts`'s
   derivation (stored for new reports, derived for legacy) and to OP-004's tests, not a label change.
2. **Top band wording.** "Very strong" was chosen for brevity and consistency with "Strong". If a
   careers adviser prefers another assessed-document phrase, it is a one-line change in `labels.ts`
   with no version bump and no rerun (that is the point of the split).
3. **"Readiness Score."** The score's name itself implies readiness for employment. Renaming it is a
   product/brand decision touching the landing page; not changed.
4. **Landing edit.** The nine landing strings above are ready to apply in one coordinated edit; and
   whether the demos should import the label tables.
5. **`UploadForm.tsx:190`** "ATS-friendly template" is OP-005's file this batch; apply the proposed
   wording there when that batch lands.
6. **`FINDING_STATUS_LABEL`** (types.ts): remove or re-export from `labels.ts` after OP-005 merges.
7. **Stored names.** Should new reports stop storing `areas[].name`/`checks[].name`/`steps[].area`
   now that views derive them? It would be a payload-shape change (schema, PLAN.md), so it was not done.
8. **`docs/PLAN.md`** was not edited (shared with OP-005); suggested line for the contract section:
   "Band, area, check and status labels are derived at render time from `labels.ts`; the stored `name`
   fields are the labels at save time and are not read by views."

### Checks Codex must rerun

1. `npm run typecheck`, `npm run lint`, `npm run test:engine` (expect 115 if OP-005 has added none).
2. `npm run --silent diagnose:audit -- --json` (exit 0, 2 met / 6 unmet) and `-- --check --json` (exit 1).
3. Numeric preservation: run OP-004's `baseline.ts` against the pre-OP-003 tree and this one, confirm
   the only diff is the four `steps[].area` strings, and that the numeric-only hashes match
   (`572b76e1…`). Or simply `git stash`-free: the frozen fingerprints and cache keys in
   `tests/labels.test.ts` were captured before the change.
4. `git diff -- src/lib/analysis/rubric.ts src/app/_landing/` to confirm thresholds, weights and the
   version are untouched and the landing carries only the founder's changes.
5. Render the demo's v3 (legacy) and v6 (current) reports and the careers dashboard; judge "Target met",
   "Very strong" and the renamed areas, and the examples note.
6. The scope judgments on `letter.ts:63` (stored letter summary wording) and `TailorView.tsx:118-122`.

## OP-005 — Preserve extraction structure and confidence

Prepared 5 November 2026 by Claude, for independent acceptance review by Codex. Implemented concurrently with
OP-003 in the same working tree; the file ownership rules were kept (nothing under `src/app/reviews/`,
`src/app/letters/`, `src/app/help/`, `src/app/templates/`, `src/app/_landing/`, `rubric.ts`, `check-content.ts`,
`findings.ts`, `labels.ts` or `tests/labels.test.ts` was edited by this task). Nothing was committed, pushed or
deployed; no live database or paid provider was touched; `next build` was not run.

**Status: Implemented → Locally verified.** No human or operational gate was passed.

### What this task does and does not claim

Every CV upload now records how its text was read: a measured page count for PDFs (counted in the file) kept
apart from the word-count estimate, where each page begins in the saved text, the layout facts extraction noticed
(columns, tables, symbol-font bullets, repeated headers, text-less pages), the structure the parser read (every
heading, every role with its dates, which lines and role each bullet came from), a list of warnings in the
student's words, and a confidence figure. An image-only scan, a protected or corrupt file, the wrong file type and
anything over a processing limit now produce a typed, explained **outcome** on the upload screen; nothing is
scored or saved for them. When a reading was not straightforward the student sees a "Check how we read your file"
screen before the score.

- No number moved. The text handed to the scorer, every score, fingerprint and the rubric version are byte for
  byte what they were (section "Validation").
- `PARSER_VERSION` is **unchanged** (`parser-2026-11-05.1`): the parser cuts sections, roles and bullets exactly
  as before and records structure beside them. See "PARSER_VERSION decision".
- It does **not** let the student correct the extracted text (OP-006), does **not** OCR scans, and does **not**
  fix the three parser limitations the fixtures exposed (symbol-font bullet markers, academic headings, roles split
  from their dates by tables): those change what is scored and are recorded below as gated on OP-010.
- Confidence is a documented heuristic, not a calibrated probability.

### Changed files

New:

- `src/lib/analysis/document.ts` — builds the `DocumentMeta` record from what extraction observed and what the
  parser read: page provenance, warnings, confidence, structure, and the `ReadingSummary` the upload screen shows.
- `scripts/make-extraction-fixtures.ts` — dev-only generator for the synthetic fixtures (`npm run
  fixtures:extraction`), using pdf-lib and docx, both already dependencies. No runtime dependency added.
- `tests/fixtures/extraction/` — 12 generated files (10 PDFs, 2 DOCX, 76 KB in all) and `expected.ts`, the
  hand-written structure each one should produce.
- `tests/extract.test.ts` existed with 3 tests; it now holds 15 (12 new). `tests/payload.test.ts` gains 2.

Modified:

- `src/lib/analysis/extract.ts` — `extractDocument()` beside the unchanged `extractText()`; the reading-order pass
  returns pages and layout signals; `ExtractError` carries `kind`, `code`, `detail` and `alternatives`;
  content sniffing, zip-entry cap, text-object cap, DOCX structural facts; `EXTRACTOR_VERSION`; `LIMITS`.
- `src/lib/analysis/parse.ts` — bullets record `lines: [from, to]` and `roleIndex`; `ParsedCv.structure`
  (section spans, roles with `parseDateRange`, unrecognised headings). Decisions unchanged.
- `src/lib/types.ts` — `DocumentMeta`, `PageInfo`, `ExtractionWarning`, `EXTRACTION_WARNING_CODES`, `DateRange`,
  `DatePoint`; `CvReviewPayload.document?`.
- `src/lib/report-schema.ts` — `DocumentSchema` (strict, optional on CV payloads) and `documentProblems()`, run
  by `toStored` so metadata that disagrees with the saved text is refused.
- `src/lib/services.ts` — `buildCvPayload` takes `document?` and includes it only when given.
- `src/app/actions/cv.ts` — uses `extractDocument`; returns `{ outcome }` for an unreadable or over-limit file,
  `{ id, reading }` for a scored one.
- `src/app/upload/UploadForm.tsx` — the outcome panel and the reading-review screen.
- `package.json` — the `fixtures:extraction` script line only.

Not changed: `src/lib/analysis/cv.ts`, `rubric.ts`, `lexicon.ts`, `fingerprint.ts`, `scoring*.ts`, both
repositories, `src/lib/repo/types.ts`, migrations, `src/app/actions/letters.ts` (it still calls `extractText`
and shows `e.message`; scans are refused there with the same wording as before), every report view.

### Behaviour

**Upload.** `uploadCv` reads the file with `extractDocument`. An `ExtractError` becomes `{ outcome }` and the form
shows a bordered panel: a kicker ("NOT SCORED · WE CAN'T READ THIS FILE AS TEXT" or "… OUTSIDE A PROCESSING
LIMIT"), the message, the detail, "What you can do", and the line "This is about the file, not your CV: nothing
was scored and nothing was saved." No report is created, so nothing downstream (dashboard, history, adviser
views) can turn it into a verdict; the dashboard check in the browser pass confirms the scans never appear.
A readable file is scored exactly as before (`scoreCv(doc.text, …)`), then `documentMeta()` builds the record and
`buildCvPayload` saves it. The action returns `reading` (confidence, pages, warnings); when the band is not
`high` or any warning is a `caution`, the form shows the review screen instead of redirecting: pages
("2 pages, counted in your PDF" or "About 1 page, estimated from the word count. A Word file has no pages until it
is opened, so we can't count them."), the confidence with a one-line meaning, each warning with its detail, and
"See my results" / "Upload a different file". A clean read goes straight to the report as before.

**Extraction.** The PDF reading-order code is unchanged in what it returns as text (the fixture hash proves it);
it now also returns each page's text and counts: pages with no text, pages read as two columns, rows that begin
with a lone letter or digit in a different font (a symbol-font bullet decoded to that character), rows made of
three or more runs of text (table cells), and text objects. On a two-column page the table and symbol counts are
taken per column. Word files are inspected before anything is inflated (`word/document.xml` must exist; tables,
explicit page breaks, Word's cached `lastRenderedPageBreak` count and images are counted from the XML as
structural facts, never as a page count). The worker protocol carries pages and signals back only when the text
is within the limit; over it, only the cut text travels back and the file is refused as before.

**Metadata.** `documentMeta()` parses the same normalised text the scorer sees, so the structure it records is the
one the scores came from. Repeated page headers and footers are detected from the first and last two lines of
every page (digits generalised, so "Page 1 of 2" and "Page 2 of 2" match); the parser still reads them as role
lines (pre-existing behaviour, left alone because it affects `analysis.lines[].where`), but the recorded structure
drops those pseudo-roles and attributes their bullets to the real role above, and the warning discloses that the
lines remain in the scored text and word count.

### The extraction metadata schema (`CvReviewPayload.document`, optional)

| Field | Type | Meaning |
|---|---|---|
| `source.kind` | `"upload"` | OP-006 adds `"correction"` here with a `parentDocumentVersion`; the upload record stays immutable. |
| `source.format` | `"pdf"` \| `"docx"` | Judged by the file's bytes, not its name. |
| `source.bytes` | int ≥ 1 | Upload size. |
| `source.sha256` | hex | sha256 of the uploaded bytes (not of the text). |
| `documentVersion` | string | sha256 of the saved text; equals `assessment.documentVersion`, and `toStored` refuses a mismatch. |
| `extraction.extractor` | string | `EXTRACTOR_VERSION` (`extractor-2026-11-05.1`). |
| `extraction.parser` | string | `PARSER_VERSION` the structure was read with. |
| `extraction.pages.measured` | int \| null | Pages counted in the file. **PDF only.** Null means not measured, never zero. |
| `extraction.pages.estimated` | int ≥ 1 | `max(1, round(words / 450))`: the same number as `analysis.meta.pages` (asserted for every fixture). |
| `extraction.pages.provenance` | `"measured"` \| `"estimated"` | Which number a reader may quote. A Word file is never `measured`; `toStored` refuses `measured` without a count and vice versa. |
| `extraction.pages.starts` | int[] | PDF: character offset in `text` where each page begins (page 1 at 0; a text-less trailing page starts at `text.length`). Empty when not measured. Checked to be inside the text, ascending and one per page. |
| `extraction.pages.withoutText` | int[] | PDF: 1-based pages with no text at all. Empty when not measured. |
| `extraction.pages.explicitBreaks` | int \| null | DOCX: explicit page breaks in the XML. Structural information only. Null for PDFs. |
| `extraction.warnings[]` | see below | Each: `code`, `severity` (`caution` \| `info`), `message` (one sentence), `detail`, `count` (int \| null), `items` (the lines or headings concerned). |
| `extraction.confidence.score` | 0–1, 2 dp | `1 − Σ weights`, clamped. |
| `extraction.confidence.band` | `high` ≥ 0.8, `medium` ≥ 0.5, else `low` | Drives whether the review screen is shown. |
| `structure.sections[]` | `{ key, heading, bullets }` | Every heading occurrence in order (two headings can share a key), plus the implicit `header`. |
| `structure.roles[]` | `{ section, heading, dates, bullets }` | Role lines in bullet sections; `dates` is `{ raw, start: {year, month\|null}\|null, end: {…} \| "present" \| null }` or null. |
| `structure.bullets` / `wrappedBullets` | int | Scored bullets; those rebuilt from more than one line. |
| `structure.unrecognisedHeadings` | string[] | Short capitalised lines that look like headings but match no known section name. |

Absence of `document` means "not recorded" (reports made before this task, demo seeds built from text) and must
not be read as high confidence. `PAYLOAD_VERSION` stays **1**: the field is optional and strict, every stored v1
and v0 payload still validates (tested), and a reader treats absence as unknown. Bumping would have forced an
adapter for a field that legitimately may be missing.

**Warning codes and weights** (`WARNING_WEIGHT` in `document.ts`; severity is `caution` at weight ≥ 0.1):

| Code | Weight | Fires when |
|---|---|---|
| `pages_without_text` | 0.6; **0.05** when the readable text is a whole CV (≥ 300 words) | A PDF page has no text (image or blank). The whole-CV case reads "probably a blank page at the end of your CV, or an image". |
| `two_column_layout` | 0.15 | A page was read as two columns. |
| `symbol_font_markers` | 0.3 | ≥ 2 rows start with a lone letter/digit in a different font. |
| `table_layout` | 0.25 | ≥ 2 PDF rows of ≥ 3 runs, or any DOCX table. |
| `repeated_header_footer` | 0.1 | The same edge lines on every page (items list them). |
| `letter_spaced_text` | 0.05 (info) | Lines typed with spaces between letters; the headings are still recognised. |
| `unusual_characters` | 0.2 | ≥ 3 private-use, replacement or control characters in the text. |
| `no_sections_recognised` | 0.3 | The parser found no known heading. |
| `unrecognised_headings` | 0.1 per heading, max 0.3 | Heading-like lines not in the lexicon (items list them). |
| `no_bullets_found` | 0.25 | No bullet points: nine checks scored 0 rather than passing. |

The weights are chosen so one layout quirk stays `high`, one defect that changes what was assessed drops to
`medium`, and two drop to `low`. They are a heuristic for OP-006 to gate correction on and for OP-011 to
calibrate, not a measured probability.

### Fixtures (`tests/fixtures/extraction/`, all synthetic; expected structure in `expected.ts`)

| File | Tests | Expected (asserted) |
|---|---|---|
| `single-column.pdf` | Plain case; dates "Jun 2024 – Present", "September 2023 to December 2023", "2023" | sections education, experience, projects, skills; 3 roles with those dates and 2/2/1 bullets; 5 bullets; measured 1 = estimated 1; no warnings; confidence 1 high |
| `two-column.pdf` | Sidebar beside main column on one line grid | main column first; sections experience, education, skills, skills (SKILLS and LANGUAGES); 1 role, 3 bullets; `two_column_layout`; 0.85 high |
| `wrapped-bullets.pdf` | Bullets stored as two lines each, breaking mid-sentence | 3 bullets equal to the full sentences; `wrappedBullets` 3; bullets' `lines` spans [4,5] [6,7] [8,9]; no warnings; 1 high |
| `letter-spaced-headings.pdf` | P R O F I L E, W O R K  E X P E R I E N C E, drawn per letter | sections summary, education, experience, skills; `letter_spaced_text` (info, 4); 0.95 high |
| `repeated-header.pdf` | 2 pages, same header line and "Page n of 2"; page 2 opens with the first role's remaining bullets | measured 2, estimated 1, `starts` = [0, 411] with page 2 starting at the header line; roles: first role 4 bullets, second 2; `repeated_header_footer` items `["Alex Example — Curriculum Vitae", "Page # of #"]`; 0.9 high |
| `symbol-bullets.pdf` | ZapfDingbats tick markers (decode as "3"), Courier body: "unusual fonts" | 4 symbol markers counted; 0 bullets found; `symbol_font_markers` + `no_bullets_found`; 0.45 low. The defect is disclosed, not endorsed. |
| `academic.pdf` | Research experience, Publications, Teaching, Conferences and talks; dates "Oct 2021 – present", "2019 – 2021", "03/2018 – 09/2018", "Autumn 2022" | sections education, achievements, skills; unrecognised `["RESEARCH EXPERIENCE", "TEACHING", "CONFERENCES AND TALKS"]`; 4 bullets; 0.7 medium |
| `mixed-scan.pdf` | Page 1 short text, page 2 an image | measured 2, `withoutText` [2]; `pages_without_text` caution; 0.4 low; scored on page 1 only and says so |
| `blank-trailing-page.pdf` | A 318-word CV that overflows onto an empty page | measured 2 vs estimated 1; `withoutText` [2]; `pages_without_text` info; 0.95 high |
| `table.docx` | Roles and dates in a two-column table, explicit page break, tab-aligned date | measured null, provenance estimated, `explicitBreaks` 1; `table_layout`; 0.75 medium; role expectations left open because the table splits each role from its dates (disclosed by the warning) |
| `scan.pdf` | Image-only page | `unsupported` / `image_only`, no score |
| `scan.docx` | Word file holding only a picture | `unsupported` / `image_only`, no score |

The 10 PDFs regenerate byte for byte (fixed dates and producer); the two DOCX files differ on regeneration only by
the `docx` library's timestamps, and the tests assert on extraction results, not bytes. Limit cases are generated
inside the test (11-page PDF, 20,050 text objects on one page, a zip named `.pdf`, a PDF named `.docx`, a zip
without `word/document.xml`, a 1,002-entry zip, an empty file, an OLE `.doc`, a PDF with one short line).

### Processing limits and what happens when they trip

| Limit | Value | Outcome |
|---|---|---|
| File size | 2 MB (`MAX_UPLOAD_BYTES`, unchanged) | rejected `too_large` |
| Empty file | 0 bytes | rejected `empty` |
| File type | `.pdf` / `.docx` by name **and** `%PDF-` within the first 1,024 bytes / `PK` zip header by content; OLE (`.doc`) named | unsupported `unsupported_type`, `not_pdf`, `not_docx` with the detail saying what the bytes are |
| PDF pages | 10 (unchanged) | rejected `too_many_pages` before any text is read |
| Text objects per PDF page | **20,000 (new)** | rejected `too_complex` (the worker stops at that page) |
| Text length | 40,000 characters (unchanged) | rejected `too_much_text` |
| Minimum text | 150 non-space characters (unchanged threshold, now typed) | unsupported `image_only` when every page is text-less (or a DOCX has images and no text), else `too_little_text` |
| DOCX uncompressed size | 20 MB (unchanged) | rejected `zip_too_large` |
| DOCX zip entries | **1,000 (new)** | rejected `zip_too_many_entries` |
| DOCX without `word/document.xml` | — | unsupported `not_docx` |
| Worker time | 20 s (unchanged) | rejected `timeout` |
| Worker heap | 256 MB (unchanged) | rejected `too_complex` |
| Password | — | unsupported `password` (untested: pdf-lib cannot write encrypted files) |

Every outcome's detail states that nothing was scored; every outcome offers at least one alternative. Document
text is data: the parser is deterministic regexes with bounded quantifiers, instructions inside a CV are ordinary
lines (tested: no warning, confidence or structure changes beyond the line being part of the text and version).

### PARSER_VERSION decision

Unchanged. The structure (`lines`, `roleIndex`, section spans, roles, dates, unrecognised headings) is recorded
alongside the existing decisions; the projection of every pre-existing `parseCv` field for the 2 audit CVs, the
4 demo CVs and the real `cv.pdf` hashes to the same value before and after (`2f2fbaff…`, frozen in
`tests/extract.test.ts`), and `cv.pdf`'s extracted text hashes to the same `19c56a76…`. `EXTRACTOR_VERSION` is new
and recorded in the metadata so a later change to reading order can be told apart from a parser change.

**Proposed parser/lexicon changes, not shipped, gated on OP-010** (each would move scores on some documents):

1. Treat a lone symbol-font glyph at the start of a row as a bullet marker (fixture `symbol-bullets.pdf`: 4
   bullets lost, score 22). Today disclosed by `symbol_font_markers`.
2. Add "research experience", "teaching", "conferences", "activities" (bare) and similar academic headings to
   `SECTION_HEADERS` (fixture `academic.pdf`; "ACTIVITIES" alone is also unrecognised). Today disclosed by
   `unrecognised_headings`.
3. Rejoin a table row's cells (role + dates) onto one line for DOCX tables (fixture `table.docx`). Today disclosed
   by `table_layout`.
4. Exclude repeated page headers/footers from role detection in the parser (so `analysis.lines[].where` stops
   showing "ALEX EXAMPLE — CURRICULUM VITAE" as a role). The recorded structure already corrects this; the label
   change is presentational but is a parser-behaviour change, so it waits for a `PARSER_VERSION` bump.

### Validation: commands and actual results

Run in `/Users/gbolahan/Documents/NEW ME/LevelUp` on 5 November 2026.

| Command | Result |
|---|---|
| `npm run typecheck` | **Pass**, no output (includes the `SCHEMAS_MATCH_TYPES` compile-time check with `document?`). |
| `npm run lint` | **Pass**: 0 errors, 1 warning, the pre-existing `tests/e2e/smoke.mjs:38`. |
| `npm run test:engine` | **Pass: 129/129, 0 failed.** 105 when this task started; OP-003 added 10 concurrently (`tests/labels.test.ts`); **14 are this task's**: 12 new in `tests/extract.test.ts` (tests 4–15 listed in that file: frozen hashes; fixtures vs expected structure; wrapped bullets and line spans; page offsets; estimated vs measured pages; scan outcomes; processing limits; reading-order signals; text warnings; instructions-as-data; parser structure; date formats) and 2 in `tests/payload.test.ts` (metadata round-trips through both repositories and is absent when not recorded; disagreeing or malformed metadata is refused and nothing is saved, 10 tamper cases). |
| `npm run test:db` | **Pass** (PGlite). Run for completeness; no repository or migration changed. |
| `git diff --check` | Clean. |
| `npm run --silent diagnose:audit -- --json` | Exit **0**, valid JSON, 8 gates: 2 met, the same 6 unmet (`proofreading.detects-audit-misspellings`, four `matching.*` extraction gates, `matching.no-unconditional-baseline`). Observations unchanged: spell 10/10, misspelled CV 83, Excel-only match 77, no-evidence 30. |
| `npm run --silent diagnose:audit -- --check --json` | Exit **1**, valid JSON, identical gates. |
| Numeric baseline | OP-004's dump script (12 CV/sector cases + tailor + letter) run before the first edit: SHA-256 **`a3bf830104287d59c8e8666512d999c0c98be4a270d84209069fb284bab9abfc`** (identical to OP-004's "after"). After the last edit: **`7cfec3a0082afd06ac2cb9aee7f06ea52e9a232e2cae3744590087e520500865`**. The 8 differing lines are all `steps[].area` label strings, "Structure and ATS" → "Structure and readability", which is OP-003's concurrent area rename in files this task did not touch. With `steps[].area` and `steps[].text` removed, both dumps hash to **`e1fec96a58b34ed28ef11fa17e888b930e81b44c442b86b88108015c703cae73`**: every score, area, check, line, affected index, gain, words, pages, bullets, rubric, method, judge, fingerprint, judgment, tailor and letter number is identical. Files: `scratchpad/batch-02/op-005/baseline-{before,after}.json`, `baseline-numbers-{before,after}.json`. |
| Browser (demo mode) | `next dev -p 3200` started with the Supabase, Anthropic and Resend variables blanked (boot log `"mode":"demo"`, "ANTHROPIC_API_KEY is not set"), driven with Playwright and the Chrome for Testing binary, then stopped. All 12 fixtures plus `tests/fixtures/cv.pdf` uploaded through the real `uploadCv` action (a fresh demo student every 7 uploads, because `uploadPerUser` is 10 per 10 minutes). Results in `scratchpad/batch-02/op-005/browser-results.json`; screenshots `upload-<fixture>.png`, `upload-scan.pdf.png` (the scan outcome), `upload-scan-390.png`, `upload-symbol-bullets-390.png`. No console or page errors. |

Browser states observed: **report** (clean read, straight to the overview) for `single-column.pdf` 88,
`wrapped-bullets.pdf` 87, `letter-spaced-headings.pdf` 85, `blank-trailing-page.pdf` 100, `cv.pdf` 96;
**review** (confidence and warnings before the score, then "See my results" opened the report) for
`academic.pdf` medium 0.70, `two-column.pdf` high 0.85 with a caution, `repeated-header.pdf` high 0.90 with a
caution, `table.docx` medium 0.75 ("About 1 page, estimated from the word count…"), `mixed-scan.pdf` low 0.40,
`symbol-bullets.pdf` low 0.45 (score 22, two cautions); **outcome** for `scan.pdf` and `scan.docx`
(`image_only`, "NOT SCORED · WE CAN'T READ THIS FILE AS TEXT", "Score my CV" disabled). The dashboard listed the
scored files and neither scan. 0 px horizontal overflow at 390 px for both the outcome panel and the review screen.

### Limitations

- Confidence weights and the 300-word "whole CV" line are judgment calls, uncalibrated (OP-011).
- Image detection is not attempted: a text-less page is reported as "an image or blank". pdf.js can only tell the
  two apart by decoding the image, which a hostile file could make very large; "blank" versus "scan" is instead
  inferred from how much text the rest of the CV holds.
- `symbol_font_markers` can false-positive on a lone bold "I" or "A" starting a line in a different font (two or
  more are needed to warn). `table_layout` on PDFs needs two rows of three runs; a two-column page's cross-column
  rows are excluded by counting per column.
- `unrecognised_headings` skips the first three lines (where a capitalised name sits) and the skills/interests
  sections, so an unknown heading in those places is not reported.
- The review screen is on the upload side only. The saved `document` is not yet shown on any report view (those
  are OP-003's files); the score breakdown still says "Page counts are estimated from your word count", which is
  true of `analysis.meta.pages` but now sits beside a measured count the student only sees on upload. Surfacing
  `document.extraction.pages` on the report is a one-line change for the OP-003/OP-006 pass.
- A low-confidence read is still scored and saved (with the record saying so); the correction step before scoring
  is OP-006. Students who close the review screen reach the same report via the dashboard, without the warnings.
- The password path is untested (no library here can write an encrypted PDF). The in-process fallback has no
  timeout (pre-existing); it is used only when a worker cannot start.
- `src/app/actions/letters.ts` still uses `extractText` and a plain error string, so a scanned cover letter gets
  the old-style message rather than the outcome panel.
- Demo seeds carry no `document` (built from text), so demo mode shows the review screen only for fresh uploads.

### Migration impact

**None.** No SQL migration was written or needed. `document` lives inside the existing `reports.payload` jsonb
as an optional field; existing rows read unchanged (tested for v1 without the field and for v0). The adviser RPC
reads `payload -> 'analysis' -> 'areas'`, untouched. Payloads grow by roughly 2–6 KB (structure and warnings).
The uploaded file itself is stored exactly as before (`storagePath`); `source.sha256` lets OP-006 verify it.

### Design notes for OP-006

- `source` is a discriminated record keyed on `kind`; a corrected version adds `{ kind: "correction",
  parentDocumentVersion, correctedAt, by }` and a new `text`, recomputes `documentVersion` and `assessment`, and
  leaves the original report row (and `storagePath`) untouched.
- `structure` is derivable from `text` by `parseCv` under `extraction.parser`; `pages.starts` and the warnings are
  not, which is why they are persisted. The review screen already shows exactly the fields a correction UI needs.
- `readingSummary()` in `document.ts` is the client-safe projection (no CV text beyond warning items).

### Unresolved questions

1. Should a `low` reading be scored at all before OP-006 exists, or held with the review screen as the only
   output? Today it is scored and the record says `band: "low"`.
2. The review screen appears for any `caution`, including a two-column CV at 0.85 (`high`). Keep the caution
   rule, or show the screen only below `high`?
3. Proposed gated changes 1–4 above: confirm they go into the OP-010 queue, and whether the lexicon additions
   (academic headings, bare "Activities") can ship earlier under a `LEXICON_VERSION` bump given OP-004 already
   records that version.
4. Should the report's score breakdown quote `document.extraction.pages.measured` when present (one line in an
   OP-003-owned file)?
5. `source.sha256` is the file hash; do we also want the storage object's ETag recorded for the retention/deletion
   work in OP-026?

## OP-006 — Let students correct uncertain extraction

Prepared 5 November 2026 by Claude, for independent acceptance review by Codex. Built on OP-005's extraction
metadata and its "Design notes for OP-006". Nothing was committed, pushed or deployed; no live database or paid
provider was touched; `next build` was not run.

**Status: Implemented → Locally verified.** No human or operational gate was passed. The migration file is
**not applied** anywhere.

**Provenance of this work, stated plainly.** The briefing for this session said an earlier OP-006 attempt had
been cut off before writing any code. That was not the state of the tree: the interrupted attempt had written
most of the design between 08:23 and 08:36 (file timestamps): `cv-flow.ts`, `sources.ts`, `content.ts`,
`SourceEditor.tsx`, the source page and file route, the migration, its PGlite checks, the fake's `cv_sources`
model, and the repository, type, schema and upload-form changes. It had written no OP-006 unit tests and had
left one OP-005 test failing (below). It had captured the "before" baseline, diagnostic output and SHA-256 of the
protected files at 08:19, before its first edit; those files are the "before" used here. This session reviewed
that code, kept it, fixed what is listed under "Fixes to the interrupted attempt", wrote the tests and ran every
check. There is no snapshot of the tree between OP-005 and the interrupted attempt, so OP-006's diff cannot be
separated mechanically from OP-005's in files both touched; "Changed files" lists the OP-006 parts by hand.
`tests/extract.test.ts` carries an 08:30 timestamp but contains no OP-006 reference; its 15 tests pass.

### What this does and does not claim

- Every CV text is now an immutable **version** (`CvSource`): the upload as read, a student's correction of a
  version, or text the student typed or pasted. A report points at exactly one version and says which.
- A reading whose confidence band is below `high` is **held**: it is saved as an unscored upload version and the
  student sees the reading and the text as editable blocks before any score exists. They correct it (a new
  version is made and scored) or score it as it is. A failed extraction never becomes a version that can be
  scored.
- What is scored is **exactly** the saved version's text, byte for byte (tested in both repositories, shown in
  the browser by hashing the text the source page displays).
- A refresh, double click or retry does not create a second version or a second report (attempt keys at the
  client, repository and database, plus content dedupe; tested and exercised in the browser).
- Another student cannot read, download, correct, score or descend from someone else's version by changing an
  id (repository contract in both repositories, the real server actions in the browser, database triggers and
  row-level security in PGlite).
- An image-only scan gets a usable path: type or paste the CV text, which is scored as a `paste` version whose
  parent is the scan, kept unchanged and downloadable. No OCR was added.
- It does **not** change any number for any existing input: scores, fingerprints, cache keys, rubric version and
  `PARSER_VERSION` are unchanged. A corrected or typed version is new input and scores as such.
- It does **not** claim that corrections are true to the student's real CV: the student can type anything. The
  correction is recorded as theirs (`by: "student"`) with every changed block before and after.
- No accessibility conformance is claimed: axe found 0 violations on five screens and the editor works with the
  keyboard at 390px, which is a local check, not an audit.

### Changed files

New:

- `src/lib/cv-flow.ts` — the upload → review → correct / paste → score flow on top of the repository, used by the
  server actions and called directly by the tests: `uploadFlow`, `scoreFlow`, `correctFlow`, `pasteFlow`,
  `reviewBeforeScoring`, `showReadingAfterScoring`, `sourceReview`.
- `src/lib/analysis/content.ts` — the editable view: `contentBlocks` (cut from the parser's own structure:
  heading, role, bullet with its wrapped lines, other line), `assembleContent`, `contentChanges`, `applyEdits`,
  limits `MAX_CONTENT_BLOCKS` 1,200 and `MAX_BLOCK_CHARS` 1,200.
- `src/lib/sources.ts` — `rootOf`, `lineage` (parent-link order) and kind labels.
- `src/app/upload/SourceEditor.tsx` — `SourceEditor` (labelled field per block, grouped by section),
  `CorrectionPanel`, `PastePanel`, `useAttemptKey`.
- `src/app/reviews/[id]/source/page.tsx` — "Source document": what the report scored (kind, version n of m,
  pages, confidence, provenance, version hash, the scored text), every version with its changes, the original
  file with a download and the text as read; "Correct this text" opens the editor on the scored version.
- `src/app/reviews/[id]/source/file/route.ts` — downloads the lineage's original file for the signed-in owner.
- `supabase/migrations/20261105120000_cv_sources.sql` — **unapplied**; see "Migration impact".
- `tests/sources.test.ts` — 10 tests, listed under "Validation".

Modified (OP-006 parts):

- `src/lib/types.ts` — `SourceKind`, `ContentBlock(Kind)`, `SourceChange`, `SourceOutcome`, the `correction` and
  `paste` members of `DocumentSource`, `CvSource`, `ReportRow.sourceId?`.
- `src/lib/report-schema.ts` — `correction`/`paste` source schemas, two provenance rules in `documentProblems`,
  `checkDocument` for versions saved before any report.
- `src/lib/analysis/document.ts` — text-only warnings split out (`stringWarnings`), `documentMetaForText`,
  `TEXT_EXTRACTOR`, `ReadingSummary.format` nullable. Upload metadata is unchanged (all 12 fixture expectations
  pass).
- `src/lib/repo/types.ts` — `SourceInput`, `SourceConflictError`, `sameAttempt`; `createReport` takes
  `source` (replacing the old `file` argument); `createSource`, `getSource`, `listSources`, `sourceFile`.
- `src/lib/repo/demo.ts`, `src/lib/repo/supabase.ts` — the four source methods, one report per source, files kept
  with the upload version (Supabase: uploaded to the bucket by `createSource`, removed again if the row insert
  fails), `exportFiles` and `deleteAccount` cover version files.
- `src/app/actions/cv.ts` — `uploadCv` delegates to `uploadFlow` and returns `review`; new `scoreVersion`,
  `correctVersion`, `pasteCv`; zod input validation, the per-user upload rate limit on each.
- `src/app/upload/UploadForm.tsx`, `src/app/upload/page.tsx` — the held review with the editor, an address
  `/upload?source=<id>&sector=…&stage=…` for it, a "Waiting for your check" list, the paste path from the outcome
  panel.
- `src/app/reviews/[id]/page.tsx` — one line under the overview heading: "Scored your corrected text, not the
  text read from the file." / "Scored the text you typed or pasted." and a link to the source document.
- `src/app/reviews/[id]/breakdown/page.tsx` — one footer line naming the scored text's kind, version and a link.
- `src/components/ResultsSidebar.tsx` — a "Source document" item.
- `tests/fixtures/fake-supabase.ts` — `cv_sources`, the storage bucket, the migration's unique indexes and
  ownership triggers.
- `tests/payload.test.ts` — one tamper case changed (below). `supabase/tests/schema.test.mjs` — 21 checks.
- `tests/e2e/smoke.mjs` — the crawler skips `/source/file` downloads.

Protected and untouched: `src/lib/analysis/rubric.ts`, `parse.ts`, `cv.ts` and all 18 files under
`src/app/_landing/` hash to the values recorded at 08:19 before OP-006 began (21 of 21 match).

### Fixes to the interrupted attempt (made in this session)

1. `tests/payload.test.ts`: OP-005's "unknown source kind" tamper case used `"correction"`, which OP-006 made a
   real kind, so the test failed. It now uses `"ocr"`; the correction rules are tested in `tests/sources.test.ts`.
2. **A reused attempt key with different content** returned the earlier version, so a student who edited after a
   failed save could have had their old text scored. Both repositories now refuse it (`SourceConflictError`,
   checked by `sameAttempt`: same text hash, parent and kind) and the flow shows "This attempt was already saved
   with different text. Reload the page and try again."
3. **The client's attempt key lived in a React ref**, so a refresh lost it and the same file sent again made a
   second version and report (reproduced in the browser: two `single-column.pdf` reports). The key is now kept in
   `sessionStorage`, named by a non-reversible hash of what is sent (file name, size, last-modified, sector, stage;
   or the edits; or the typed text), and forgotten only when the student leaves for the report.
4. **The held review had no address**, so a refresh lost it. It now lives at `/upload?source=…`; the server page
   reloads it through the student's own repository. A first version used `history.replaceState`, which made the
   next server action re-render the page and remount the editor, silently discarding edits and error messages
   (found in the browser); it now uses `router.replace` and swaps reviews without remounting.
5. **`lineage()` ordered by timestamp**, so a correction saved in the same millisecond as its parent could sort
   first and be dropped from the list (an intermittent failure of test 3). It now walks parent links. Regression
   test added.
6. The `:original` suffix on the paste flow's key could exceed the column's 80-character check: the action now
   accepts keys of 16–64 characters.
7. A bullet the student retyped with its own "•" got two markers; long lines were single-line inputs truncated at
   390px (now wrapping textareas); confidence wording spoke of a score before one existed and of "the file" for
   typed text.

### Behaviour

**Upload.** `uploadFlow` extracts as OP-005 did. An `ExtractError` is an outcome and nothing is saved. A readable
file is saved as an `upload` version (text, `DocumentMeta`, the file). Then:

- band `medium` or `low` → **held**: no report. The form shows "CV READ · LOW CONFIDENCE · NOT SCORED YET",
  the reading and warnings, and the text as fields; "Score my corrections" (enabled once something changed) or
  "Score the text as it is".
- band `high` with a `caution` warning → scored at once, then the reading screen is shown before the report with
  "See my results" and "Check and correct the text" (opens the source page's editor).
- band `high`, no caution → straight to the report, as before.

**Correct.** The editor shows `contentBlocks(version.text)`. On submit the action receives every block id and
text; ids not in the parent's blocks are refused as stale. Unchanged (or whitespace-only changed) blocks are no
correction: the parent is scored as it is and no version is made. Otherwise the new text is
`assembleContent(applyEdits(parentBlocks, edits))`: one line per block, bullets as `• text`, cleared blocks left
out, whitespace in a line collapsed. Re-assembling unedited blocks reproduces the same score, bullets, words and
scored lines for all 4 demo CVs and 10 readable fixtures (tested), so the reassembly itself moves nothing; the
edited lines are what changes. The text must still be 150–40,000 characters. It is saved as a `correction`
version and scored; the report is created with `source: { id }`.

**Paste.** From the outcome panel ("Type or paste my CV text instead"). The typed text has line endings
normalised, runs of 3+ newlines reduced to 2, and is trimmed; that normalised string is the version's text and
what is scored. If the unreadable file is re-sent with it, it is kept as an `upload` version with empty text,
`document: null` and `outcome` (`{kind, code, message}`), and the `paste` version is its child. Such an upload
can never be scored or corrected (`scoreFlow`/`correctFlow` refuse it).

**Score as it is.** `scoreFlow` scores a held version unchanged; a version already scored returns its report.

**Where the student sees which version was scored.** The overview line, the breakdown footer, and the source
page ("Corrected text · version 2 of 2", the version hash, "Show the text that was scored", the versions list
with each change struck through and replaced, "THIS REPORT" on the scored one, and the original file).

**Decisions on OP-005's open questions.**

1. *Should a low reading be scored before the student reviews it?* **No**, and the same for `medium`: the
   blueprint says to show the extracted content and let the student correct it before scoring, and OP-005's
   weights put one defect that changes what is assessed at `medium`. Nothing downstream (dashboard, history,
   adviser views) sees a held version, because no report exists until the student acts.
2. *Should a caution at band `high` show the review?* **Yes, but after scoring, not instead of it.** `high`
   means at most one layout quirk with no evidence that assessed content changed (a two-column page at 0.85, a
   repeated header at 0.90). Holding those would put most two-column CVs behind an extra step for no measured
   benefit; skipping the screen would hide a caution the student should see. So the score is made, the reading is
   shown first, and the correction path is one click away and creates a new version and report like any other.
   This is a judgment, uncalibrated, and the thresholds are OP-005's heuristic weights (OP-011 to calibrate).

### The version and provenance model

`CvSource` (both repositories return the same shape; the Supabase row is `cv_sources`):

| Field | Meaning |
|---|---|
| `id` | Version id. |
| `parentId` | The version it was made from: null for an upload and for a paste with no file; always set for a correction (database check); the scan for a paste that kept one. Must be the same user's (repository check and database trigger). |
| `kind` | `upload` (read from the student's file), `correction` (edited blocks of a parent), `paste` (typed or pasted). |
| `fileName` | The upload's name; `<parent> (corrected)` for a correction (one suffix); `<scan> (typed)` or "Pasted CV text" for a paste. |
| `text` | Exactly the text that is (or would be) scored. Empty only for a retained unreadable file. ≤ 40,000 characters. |
| `documentVersion` | sha256 of `text`; equals the scored report's `assessment.documentVersion` and `document.documentVersion`. |
| `document` | OP-005's `DocumentMeta`, validated by `checkDocument` before writing and again on read (Supabase). Null only for a retained unreadable file. |
| `outcome` | Why a retained file could not be read, else null. |
| `storagePath` / `hasFile` | The kept file (upload versions only). In demo mode the bytes are held in memory and `storagePath` is null. |
| `reportId` | The report that scored this version, or null while held. At most one (unique index). |
| `createdAt` | When it was saved. |

`DocumentMeta.source` per kind:

| Kind | Fields |
|---|---|
| `upload` | OP-005's `{ format, bytes, sha256 }` (hash of the uploaded bytes). |
| `correction` | `parentDocumentVersion` (the parent's text hash; must differ from this version's), `correctedAt` (ISO time), `by: "student"`, `changes[]` (≥ 1): `{ block, kind, where, before, after }` for every block whose text changed, `after: ""` when cleared. |
| `paste` | `pastedAt`, `by: "student"`, `original`: `{ fileName, format, bytes, sha256, outcome }` of the kept file, or null. |

For `correction` and `paste`, `extraction.extractor` is `student-text`, pages are always `estimated` (a measured
count is refused), and only warnings that can be read from text apply (letter spacing, unusual characters, no
sections, unrecognised headings, no bullets), so the confidence says how well the parser could structure what the
student wrote, nothing about a file. The source page words it that way.

The original upload is never written again: the demo store has no update path for versions; the Supabase
repository has none; the migration's `cv_sources_immutable` trigger refuses any `UPDATE`, even from the service
role (PGlite check). Versions are deleted only with the account (cascade; PGlite check) or by the retention job's
account deletion.

### Idempotency

| Layer | Mechanism |
|---|---|
| Client | `useAttemptKey`: a random key per attempt, held in `sessionStorage` under a hash of what is sent, so a retry, double click or refresh mid-submission (then the same file or text again) sends the same key; forgotten only on leaving for the report. Buttons also disable while pending, which is not relied on. |
| Action | Keys validated (`^[\w-]{16,64}$`); a missing or malformed key gets a fresh UUID, i.e. no dedupe, never a shared key. |
| Repository | `createSource`: same user + same key → the saved version if it is the same content (`sameAttempt`), else `SourceConflictError` and nothing saved. A correction or paste with the same parent and the same text hash → that version (two tabs, a lost key). `createReport` with a `source` → the existing report for that version. Supabase: on a unique violation (two requests past the checks at once) the row that won is returned and the duplicate file is removed from storage. |
| Database (unapplied) | unique `(user_id, idempotency_key)`, unique `(user_id, parent_id, document_version)` where `parent_id` is set, unique `reports.source_id`. |

Not deduplicated: two deliberate uploads of the same file after the first reached its report (a new attempt, as
before OP-006); a refresh followed by sending a *different* file, sector or stage. AI quota (`bumpAi`) can be
reserved twice when two identical requests score in parallel in AI mode, although only one report is saved.

### Ownership

- **Repository.** Demo: each student's versions live in their own store; nothing looks across users. Supabase:
  every read filters `user_id = <session user>` on the student's own client (under RLS), the parent check and the
  "version is yours" check on `createReport` run with that client before any service-role write, ids must be
  UUIDs, and the file is downloaded with the student's session (the bucket policy opens only their folder).
- **Action / route.** The actions and pages take the repository from the session; there is no id-only path. The
  upload page's `?source=` and the source page and file route resolve ids through that repository; a foreign id
  is "We couldn't find that document." or 404.
- **Database (unapplied).** RLS `select` own rows only; no insert/update/delete grant or policy for students;
  triggers refuse a parent or a report source belonging to another user even for the service role.

### Validation: commands and actual results

Run in `/Users/gbolahan/Documents/NEW ME/LevelUp` on 5 November 2026, final tree.

| Command | Result |
|---|---|
| `npm run typecheck` | **Pass**, no output. |
| `npm run lint` | **Pass**: 0 errors, 1 warning, the pre-existing `tests/e2e/smoke.mjs:38`. |
| `npm run test:engine` | **Pass: 139/139, 0 failed** (run three times). 129 before OP-006; **10 new, all in `tests/sources.test.ts`**; one existing case in `tests/payload.test.ts` changed (fix 1). |
| `npm run test:db` | **Pass** (PGlite, exit 0): 116 checks, 21 of them OP-006's (19 written by the interrupted attempt, 2 storage checks added here: the owner can read the file behind their version, another student cannot). |
| `git diff --check` | Clean; new untracked OP-006 files checked separately for trailing whitespace: none. |
| `npm run --silent diagnose:audit -- --json` | Exit **0**; 8 gates, 2 met, the same 6 unmet; output byte-identical to the 08:19 capture. |
| `npm run --silent diagnose:audit -- --check --json` | Exit **1**; byte-identical to the 08:19 capture. |
| Numeric baseline | OP-004's dump script (`scratchpad/batch-02/op-006/baseline.ts`, 12 CV/sector cases + tailor + letter) and `strip.mjs`. Before (08:19) and after (final tree): full dump **`7cfec3a0082afd06ac2cb9aee7f06ea52e9a232e2cae3744590087e520500865`** both times (= OP-005's "after"); without `steps[].area`: **`572b76e1475f05f8ab525833255c0a576c0ec1cbb591c0c9e7a204a432e409d0`** both; without `steps[].area` and `steps[].text`: **`e1fec96a58b34ed28ef11fa17e888b930e81b44c442b86b88108015c703cae73`** both. OP-006 moved nothing; against OP-004's dump the only difference remains OP-003's label rename. |
| Protected files | rubric.ts, parse.ts, cv.ts and 18 landing files: 21/21 SHA-256 match the 08:19 capture. |
| Mutation check | Five deliberate breaks, each reverted: Supabase `getSource` without the user filter (test 6 fails), scoring text other than the version's (tests 2, 7), no key dedupe in demo (test 4), no content dedupe in demo (test 4), not holding low readings (7 tests fail). |

The 10 tests in `tests/sources.test.ts`, each against both repositories (the Supabase pair sharing one fake):

1. Readings below high (symbol-bullets low, mixed-scan low, academic medium, table.docx medium) are held: saved
   as unscored uploads, no report; single-column is scored straight away; two-column (0.85) is scored with the
   reading shown.
2. **Corrected text is exactly what is assessed**: symbol-bullets.pdf, four "3 …" lines corrected to "• …";
   the version's text equals the assembled edits, the report's `payload.text` equals it byte for byte, the
   analysis equals `analyseCv` of it (4 bullets, each edited line scored), `document.documentVersion`,
   `assessment.documentVersion` and the version hash agree, the row links the version, and the provenance names
   the parent version, the student, the time and each changed block before and after.
3. The original stays as it was through two corrections (repository read and, for Supabase, the stored row);
   its file downloads byte-identical with the recorded hash; lineage upload → correction → correction; each report
   names its version.
4. Same key twice, same key at once (double click), same edits under a new key, three corrections at once, a
   held version scored twice, a paste retried → one version and one report each; a reused key with different text
   is refused.
5. A retry after the report write failed reuses the saved version and makes the one missing report; a further
   retry returns it.
6. Student B gets null for A's upload and correction, null file, "not found" from score and correct flows, a
   rejection when creating a version descended from A's or a report attached to A's version, and A's versions,
   reports and (Supabase) stored rows are unchanged.
7. scan.pdf is an outcome with nothing saved; the paste with the scan scores exactly the normalised typed text;
   the scan is kept unreadable, downloadable, never scored or corrected; provenance names its hash and outcome;
   a paste without a file has no parent; too little text is refused before saving.
8. Re-assembled unedited blocks score identically for 14 texts; unchanged fields make no version; a foreign block
   id is stale.
9. Version metadata is refused for: identical to parent, no changes, measured pages on a correction, not the
   student, malformed file hash, another text's hash; both repositories write nothing.
10. Lineage orders by parent links when timestamps tie (fix 5).

**Browser (demo mode).** `next dev -p 3300` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` and `RESEND_API_KEY` blanked; boot log `"mode":"demo"` and
"ANTHROPIC_API_KEY is not set". Driven by `scratchpad/batch-02/op-006/browser-check.mjs` (Playwright, Chrome for
Testing), then stopped. Results in `browser-results.json`; screenshots in the same folder. Final-tree run:

| Walkthrough | Observed |
|---|---|
| Low confidence → review | symbol-bullets.pdf: "CV READ · LOW CONFIDENCE · NOT SCORED YET", 12 fields, 0 unlabelled; address `/upload?source=…`; after a reload the same unscored version (`1-review.png`, `1-review-after-refresh.png`). |
| Correct with the keyboard → score | Four lines edited with Home/Delete/typing, "4 LINES CHANGED", 5 Tabs to "Score my corrections", Enter. The server action request was **delivered twice** to the server (Playwright `route.fetch` ×2). Overview: "Scored your corrected text, not the text read from the file." (`1-edited.png`, `1-report.png`). |
| Report shows the corrected version | Source page: "Corrected text · version 2 of 2"; versions V1 upload NOT SCORED, V2 correction THIS REPORT — **2 versions, 1 corrected report** on the dashboard despite the double delivery; the scored text shown has 4 "• " bullets and no "3 " line, and its SHA-256 prefix `9d9e6634ad443a80` equals the version the page prints; the original downloads (200, `attachment; filename="symbol-bullets.pdf"`) byte-identical to the fixture (`1-source.png`, `1-dashboard.png`). |
| Scan → outcome → paste → score | "NOT SCORED · WE CAN'T READ THIS FILE AS TEXT", Score disabled; paste panel; report "scored the text you typed or pasted"; the scored text equals the typed text exactly and hashes to the printed version; V1 scan NOT READABLE, V2 typed THIS REPORT; the scan downloads byte-identical (`2-outcome.png`, `2-paste.png`, `2-report.png`, `2-source.png`). |
| Refresh mid-submission | (a) response held back 5 s, page reloaded at 0.8 s, same file sent again → 1 `single-column.pdf` report; (b) reload during the pause after the response, same file again → 1 `wrapped-bullets.pdf` report; (c) a deliberate re-upload after reaching the report → a second report, as intended (`3-refresh-dashboard.png`). |
| Second student | B opening A's review address: no review, "We couldn't find that document."; A's source page 404; A's file route 404; B's own correction and score-as-is actions with the request body rewritten to A's version id: both "We couldn't find that document."; A's versions unchanged afterwards (`4-denied-*.png`). The only console error is that intended 404. |
| Accessibility | axe (the tags `tests/e2e/smoke.mjs` uses) on the held review, the review after editing, the paste panel, a source page and the source page with the editor at 390px: 0 violations each. 390px horizontal overflow: 0 px on the review/editor, the source page with the editor, and the paste panel (`390-*.png`). |

### Limitations

- The confidence thresholds that decide holding are OP-005's uncalibrated heuristic.
- A correction re-assembles the whole text one line per block: blank lines go, bullet markers become "•", wrapped
  bullets become one line, runs of spaces collapse. This moved no score for the 14 texts tested, but it is a
  normalisation the `changes` list does not itemise; the source page shows the full scored text.
- Paste normalises line endings and blank lines; that normalised string is what is scored and shown.
- A correction's report has no file of its own (`storage_path` null), so the adviser CV link (`admin_cv_link`,
  opt-in) is not offered for corrected or typed reports; the student still downloads the original from the
  source page. A held version is not visible to advisers (no report exists).
- Held versions are listed only on the upload page ("Waiting for your check", up to 3), not on the dashboard.
  They are never purged except with the account.
- Editing is per line; adding a new line means typing it into a neighbouring field (lines are joined as typed;
  a newline inside a field is collapsed to a space). There is no reordering.
- Two tabs editing the same version each make their own correction unless the text matches; there is no conflict
  warning between them.
- AI quota can be reserved twice for identical parallel requests in AI mode (one report results).
- `src/app/actions/letters.ts` is untouched: cover letters still have no versions or paste path.
- The Supabase path ran against the PostgREST fake (which models the indexes and triggers) and PGlite (which
  runs the migration and RLS), not a Supabase project. Storage RLS is checked against PGlite's stub of
  `storage.objects`.
- No `next build`; the action-level ownership check was done in the browser through the real actions, not in a
  unit test, because the actions read the session from request cookies.

### Migration impact

**One new migration file, `supabase/migrations/20261105120000_cv_sources.sql`. It was NOT applied to any live
database** (or to any Supabase project); it was run only inside PGlite by `npm run test:db`.

- New table `public.cv_sources` (columns as in the version model, `idempotency_key` 8–80 chars), indexes on
  `(user_id, created_at desc)` and `parent_id`, unique `(user_id, idempotency_key)` and
  `(user_id, parent_id, document_version)`.
- New nullable column `public.reports.source_id uuid references cv_sources(id) on delete set null`, unique when
  set. Existing rows keep `null` and read as before (no `sourceId`; the source page says the report predates
  versions and shows its text).
- Triggers: parent must be the same user's; a report's source must be the same user's; versions are immutable.
  Their functions have `search_path = ''` and execute revoked from `public`, `anon`, `authenticated`.
- RLS on: students `select` their own rows; insert/update/delete revoked from `anon` and `authenticated`.
- Deploying the app without the migration would break CV uploads on Supabase (`cv_sources` missing); demo mode
  is unaffected. The migration must be applied before this code ships. No data backfill is needed.
- `PAYLOAD_VERSION` stays **1**: the two new `source` kinds are added to a discriminated union, every stored v1
  payload (an `upload` source or no `document`) and every v0 payload still validates (tested), and no reader has
  to adapt anything; a bump would add an adapter with nothing to adapt.

### Unresolved questions

1. Hold `medium` as well as `low` (implemented), or only `low`?
2. Should a held version expire (e.g. after 30 days) rather than wait for account deletion?
3. Should the corrected report carry the original's `storage_path`, so the opt-in adviser link works for it? It
   would point at a file whose text differs from what was scored.
4. Should held versions appear on the dashboard, and should advisers see that a student has one?
5. The normalisation in a correction (limitations) is not itemised in `changes`: record a "text normalised" flag,
   or keep the full text as the record?
6. Cover letters: extend versions and the paste path to `letters.ts`?
7. The OP-005 scan alternative "retype it into one of our CV templates" now sits beside the paste button; keep
   both, or reword `extract.ts`'s alternatives (a wording change, no score change)?

### Checks Codex must rerun

1. `npm run typecheck`, `npm run lint`, `npm run test:engine` (expect 139), `npm run test:db` (exit 0).
2. `npm run --silent diagnose:audit -- --json` (exit 0, 2 met / 6 unmet) and `-- --check --json` (exit 1).
3. Numeric baseline against your own capture: expect only OP-003's `steps[].area` labels to differ from OP-004's
   dump; nothing from OP-006.
4. Read `tests/sources.test.ts` test 2 and confirm the byte-for-byte assertion is against the saved report's
   text, not a recomputation.
5. Review the migration for RLS gaps (especially the service-role triggers and the storage folder policy) before
   anyone applies it; confirm it should go out with the app change.
6. In demo mode: upload `tests/fixtures/extraction/symbol-bullets.pdf`, correct the "3 " lines, reload mid-way,
   score, open "Source document"; upload `scan.pdf` and use the paste path; then sign in as a second demo student
   in another browser profile and try the first student's `/upload?source=…` and `/reviews/<id>/source` URLs.
7. The two OP-005 decisions above and the unresolved questions.

## Combined tree validation (OP-004 + OP-003 + OP-005 + OP-006 together)

Re-run after OP-006's last edit on the single working tree that contains all four tasks, batch 01 and the
founder's landing changes:

| Check | Result |
|---|---|
| `npm run typecheck` | Passed. |
| `npm run lint` | 0 errors, 1 pre-existing warning (`tests/e2e/smoke.mjs:38`). |
| `npm run test:engine` | **139 passed, 0 failed** (91 batch 01 + 14 OP-004 + 10 OP-003 + 14 OP-005 + 10 OP-006), three consecutive runs. |
| `npm run test:db` | Passed (PGlite, exit 0), 116 checks. Includes the unapplied OP-006 migration. |
| `npm run --silent diagnose:audit -- --json` | Exit 0; same 2 met / 6 unmet gates; output byte-identical to the capture before OP-006. |
| `npm run --silent diagnose:audit -- --check --json` | Exit 1, as designed; byte-identical. |
| `git diff --check` | Clean (untracked new files checked separately: no trailing whitespace). |
| Numeric baseline | Full dump `7cfec3a0…0865`; without `steps[].area` `572b76e1…09d0`; without `steps[].area`/`steps[].text` `e1fec96a…ae73`. The last equals OP-004's dump with OP-003's label strings stripped. |
| Protected files | `rubric.ts` and every `src/app/_landing/` file unchanged by batch 02 beyond the founder's pre-existing edits. |

The only difference between the OP-004 dump and the final dump is the four `steps[].area` display strings
renamed by OP-003; with those strings stripped the dumps hash identically, and cache keys are identical
throughout. Codex should expect its own baseline comparison to show exactly that label-only diff. The only
database change in the batch is OP-006's migration file, which has not been applied anywhere.
