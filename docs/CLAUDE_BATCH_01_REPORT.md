# Offerpath batch 01 implementation report

> Historical submission from Claude. Codex subsequently corrected several findings; the [independent review](CODEX_BATCH_01_REVIEW.md) records the final accepted state, including 8 diagnostic gates and 91 passing engine tests. This original report is retained to make that review traceable.

Prepared 5 November 2026 by Claude, for independent acceptance review by Codex. Covers **OP-001 and
OP-002 only**. Nothing else in `docs/CLAUDE_IMPLEMENTATION_TASKS.md` was started.

## What this batch does and does not claim

This batch made the two reproduced audit failures executable and corrected descriptions that
overstated what the engine measures. It did **not** repair either failure.

- Proofreading is **not** implemented. The four audit misspellings are still undetected and still
  score 10/10. Open as **OP-007**.
- Contextual requirement extraction and evidence matching are **not** implemented. The advert's
  Kubernetes and Terraform requirements are still never extracted, repeated desirable Excel is still
  promoted to essential, and the match score still starts from an unconditional 30 points. Open as
  **OP-012** and **OP-013**.
- No claim of CareerSet parity, adviser validation, calibration, accessibility conformance or
  production verification is made. Status of both tasks is **Implemented → Locally verified**; no
  human or operational gate was passed.

## Task status

| Task | Status | Notes |
|---|---|---|
| OP-001 — make the reproduced failures executable | Locally verified | Fixtures, diagnostic, exit semantics and script-validation tests in place. 7 of 9 desired gates remain unmet by design. |
| OP-002 — correct misleading descriptions in the existing core | Locally verified | Scoped wording across engine, static guidance, report, help, privacy and admin surfaces. All scores, check keys, cache fingerprints and the rubric version are byte-identical to the pre-change baseline. |

## Changed files

New:

- `tests/fixtures/audit.ts` — synthetic fixtures. The clean CV, the three substitutions that derive
  the misspelled variant, the four misspelled words, correct-word negative cases for OP-007, the
  advert, its correct essential/desirable reading, and the Excel-only CV evidence. Fully invented;
  no student data, credentials or real employer.
- `scripts/diagnose-audit.ts` — the diagnostic. Calls `analyseCv`, `findCheck`, `jobKeywords` and
  `matchScores` directly; contains no copy of their logic and no repair for these particular words.
- `tests/audit.test.ts` — 15 tests covering fixtures, numeric stability, scoped coverage messages,
  legacy-payload contextual text and the diagnostic's own behaviour.
- `docs/CLAUDE_BATCH_01_REPORT.md` — this report.

Modified:

- `package.json` — added `diagnose:audit` script. No dependency change.
- `src/lib/analysis/cv.ts` — check names for `ats`, `spell`, `grammar`; area `what` explanations for
  `structure`, `spelling`, `length`; summary/detail/stat for `ats`, `spell`, `grammar`, `length`; the
  no-bullet message; `stepText` and `wellText` for the same checks.
- `src/lib/analysis/check-content.ts` — static guidance for `spell`, `grammar`, `ats`, `length`; new
  `CHECK_SCOPE` coverage notes.
- `src/app/reviews/[id]/checks/[check]/page.tsx` — renders `CHECK_SCOPE[key]`.
- `src/app/reviews/[id]/breakdown/page.tsx` — "what the score doesn't cover" entry and scoped
  description of the exact rule checks.
- `src/app/help/page.tsx` — corrected the rewrite-fidelity answer; added "What doesn't Offerpath check?".
- `src/app/privacy/page.tsx` — corrected the rewrite-fidelity sentence; stated the real adviser workflow.
- `src/app/admin/page.tsx` — removed the score-override claim.
- `src/app/reviews/[id]/lines/LineEditor.tsx` — replaced "We never add facts you didn't give us".
- `src/app/letters/LetterStart.tsx` — same absolute claim on the cover-letter start page. **Flagged
  for Codex:** this file is non-landing presentation copy but is not literally a help, privacy or
  report surface. The change is one sentence and is trivially revertible if judged out of scope.

Protected and untouched: every file under `src/app/_landing/`. `git diff --stat` on that directory
shows only the founder's pre-existing uncommitted work (`Landing.tsx`, `OfferpathHero.{tsx,css}`,
`TrackerDemo.{tsx,css}`). `src/lib/analysis/rubric.ts`, `fingerprint.ts`, `judgment.ts`, `job.ts`,
`lexicon.ts`, `src/lib/types.ts`, all repositories, migrations, authentication and `.env*` were not
opened for editing. Nothing was committed, pushed or deployed; no dependency was installed; no model
API was called for app analysis.

`docs/CAREERSET_REFERENCE_EVIDENCE.md` is untracked in the working tree but was not created by this
batch.

## Diagnostic: commands and observed behaviour

```
npm run diagnose:audit                    # observe, human-readable, exit 0
npm run diagnose:audit -- --json          # observe, machine-readable, exit 0
npm run diagnose:audit -- --check         # gate, exit 1 while any desired gate is unmet
npm run diagnose:audit -- --check --json
```

Exit semantics, verified: observation mode exits **0** with 7 gates unmet ("observation mode only
collects data"); `--check` exits **1**. The JSON payload carries no timestamp, so two runs on the
same code produce identical output.

Observations on 5 November 2026, rubric `rubric-2026-10-30.1`, rules judge (no model call, no cost):

**Spelling and writing consistency**

| Observation | Value |
|---|---|
| Clean CV score | 83/100 |
| Same CV with four misspellings | 83/100 (unchanged) |
| `spell` on the misspelled CV | 10/10 |
| `grammar` on the misspelled CV | 10/10 |
| Misspellings reported to the student | none |
| Misspellings missed | custmer, relatonships, finanical, recomendations |

**Job requirements and evidence matching**

| Observation | Value |
|---|---|
| Extracted from the advert | Excel (2× in advert, classified **essential**, found in CV), Reporting (1×, desirable, not in CV) |
| Never extracted | Kubernetes, Terraform |
| Match score for the Excel-only CV | 77/100 now, 77/100 tailored |
| Essential gaps shown to the student | none |
| Score for a CV with no evidence at all | 30/100 |

**Gates: 2 met, 7 unmet.**

| Gate | Status | Fix in |
|---|---|---|
| `proofreading.detects-audit-misspellings` | UNMET | OP-007 |
| `proofreading.misspellings-change-the-score` | UNMET | OP-007, then OP-010 |
| `proofreading.spelling-message-states-its-coverage` | met | OP-002 (this batch) |
| `proofreading.consistency-message-states-its-coverage` | met | OP-002 (this batch) |
| `matching.essential-requirements-extracted` | UNMET | OP-012 |
| `matching.essential-requirements-classified-essential` | UNMET | OP-012 |
| `matching.repeated-desirable-stays-desirable` | UNMET | OP-012 |
| `matching.essential-evidence-gaps-visible` | UNMET | OP-013 |
| `matching.no-unconditional-baseline` | UNMET | OP-013 |

Every gate's `met` value is computed from the observations, never asserted. The test *"the gates are
measured, so a repaired engine would pass them without editing the diagnostic"* feeds synthetic
observations describing a repaired engine and asserts all nine gates flip to met, then flips single
observations back and asserts only the corresponding gate fails. That is the evidence that the
diagnostic is not hardcoded to fail, and that OP-007/012/013 will be able to flip it without editing
`scripts/diagnose-audit.ts`.

No test anywhere asserts that the current behaviour is correct. `tests/audit.test.ts` asserts
`spell.score === 10` on the misspelled CV only as the premise of the wording requirement, with a
comment naming it as the OP-007 defect.

## OP-002 changes in detail

**Spelling** — `spell` is now named *UK/US spelling variants*. The pass message is "No US spelling
variants found", with detail "We compared your CV against a short list of common US spellings and
found none. That list is all this check covers, so other spelling mistakes aren't detected.
Proofread your CV yourself as well." The fail message states that a US variant is a regional
preference rather than a mistake and is correct inside an official name or a quotation. `wellText`
for a 10/10 is now "No US spelling variants found" instead of "Consistent UK spelling".

**Writing consistency** — `grammar` is now named *Writing consistency*. Both the pass and fail paths
name the three patterns actually checked (repeated words, lowercase bullet starts, mixed bullet
endings) and state that grammar, tense and sentence structure are not assessed. The pass summary is
"Consistent bullet style", not "No issues". `wellText` is "Consistent bullet style", not "Clean grammar".

**Text readability** — `ats` is now named *Text readability*. The former guarantee "Screening
software can read your text and headings" is replaced with the observed facts ("We read 253 words and
recognised 5 section headings") plus the explicit limit: we only see extracted text, cannot check
columns, tables, images or fonts, and cannot test how any individual employer's system will read the
file. "Our templates are all ATS-safe" became a statement of what the templates do and what that
cannot guarantee.

**Page estimates** — the `length` summary is "About 1 page (estimated)", the stat label is "estimated
page(s)", and the detail says "That's an estimate from your word count, not a measured page count."
`meta.pages` itself is unchanged.

**No-bullet path** — the shared message now reads "We found no bullet points, so this check scored 0
rather than passing: nothing was assessed", which matches the invariant that a skipped assessment is
never a pass.

**Adviser override** — the careers dashboard footnote now says advisers can add a note to a student's
report, which the student sees alongside their score, and that the score itself cannot be changed.
This matches the only implemented adviser write path, `addAdviserNote` in `src/app/actions/admin.ts`,
rendered on `/reviews/[id]`.

**Rewrite factuality** — "We never add facts you didn't give us" and "Suggested rewrites only use
facts from your own CV" are replaced on the line editor, help page, privacy page and cover-letter
start page with a description of the actual safeguard (built from the student's own words, checked
for figures the CV doesn't contain) plus the instruction to read each suggestion and correct anything
that overstates what they did. `src/lib/ai.ts` was left alone: its "Never invent facts" line is an
instruction to the model, not a claim to the student.

## Legacy saved payloads

Saved reports store the whole `CvAnalysis`, including each check's `name`, `summary`, `detail` and
`stat`. **No stored report was rewritten.** A report saved before this change still renders
"Spelling / UK spelling throughout / No US spellings found." — its historical content is intact, and
there is no completed migration.

The safe current-view clarification is `CHECK_SCOPE` in `check-content.ts`: coverage notes keyed on
the **check key**, not on the saved payload, rendered on the check page. An older report therefore
carries today's limits next to its original wording — for `spell`, "Other spelling mistakes aren't
detected, so 10 out of 10 here doesn't mean your CV is spelled correctly." This is tested in
*"coverage notes come from the check key, so a report saved under the old wording still gets them"*,
which builds a legacy `CheckResult`, asserts it really does claim correct spelling, and asserts the
note exists and contradicts it. The score breakdown page also states that reports saved before
November 2026 keep the wording they were saved with.

Remaining limitation: the results sidebar and score breakdown show the stored check `name`, so an
older report shows "Spelling" and "Grammar" while a new one shows the scoped names. Reconciling
current and historical labels needs the payload version and adapters from **OP-004**, driven by
**OP-003**. There is no payload version field to detect an old report by, and inventing one here
would have exceeded this batch.

## Deferred, with reasons

- **Global band naming.** "Interview-ready" still implies an employment outcome. `rubric.ts` was not
  opened, as instructed. **OP-003.**
- **Area names.** "Spelling and grammar" and "Structure and ATS" are still the area labels. Both
  strings are hardcoded in the protected landing demos (`OfferpathHero.tsx:60,62` and
  `JourneyBento.tsx:96,98`), so renaming them here would have desynchronised the landing page from
  the app. The area *explanations* were corrected. Coordinated rename: **OP-003.**
- **Landing copy.** `Landing.tsx:47` shows the "Interview-ready" band and `Landing.tsx:52` promises
  "CV layouts that screening software can read". Protected; **OP-003.**
- **Other ATS guarantees outside the permitted scope.** `src/app/templates/page.tsx:43,80` ("all
  single column so applicant tracking systems can read them", `ATS-SAFE` badge),
  `src/lib/cv-themes.ts:4,146` and `src/lib/documents.ts:8,192`. Inventory and change: **OP-003.**
- **`sector` check guidance** still says "Recruiters and screening software look for sector terms"
  (`check-content.ts:98`). It is a claim about employer behaviour rather than about our measurement,
  so it was left for the OP-003 inventory.
- **Numeric engine defects.** Untouched by instruction: no scoring number, formula, check key,
  rubric/cache/fingerprint version or authentication was changed.

## Validation: commands and actual results

Run in `/Users/gbolahan/Documents/NEW ME/LevelUp` on 5 November 2026.

| Command | Result |
|---|---|
| `npm run typecheck` | **Pass**, no output. |
| `npm run lint` | **Pass**: 0 errors, 1 warning. The warning is pre-existing and unrelated (`tests/e2e/smoke.mjs:38` unused eslint-disable); it is present on the unmodified baseline and was not touched. |
| `npm run test:engine` | **Pass**: 89/89, 0 fail (74 pre-existing + 15 new). |
| `NODE_OPTIONS=--conditions=react-server node --import tsx --test tests/*.test.ts` | **Pass**: 89/89. Recorded because it was offered as the sandbox-safe alternative; the sandbox did **not** block `tsx` IPC or the monitoring test's local listener in this session, so both runners work. |
| `npm run test:db` | **Pass**: all assertions, including adviser-note permissions and `delete_my_account`. Run because it exercises the adviser-note path the admin copy now describes. No migration was changed. |
| `npm run build` | **Pass**. Every edited route compiles, including `/reviews/[id]/checks/[check]`, `/reviews/[id]/breakdown`, `/help`, `/privacy`, `/admin` and `/letters`. |
| `npm run diagnose:audit` | Exit **0**, 7 gates unmet, output above. |
| `npm run diagnose:audit -- --check` | Exit **1**. |
| `npm run test:live` | **Not run.** Outside the authorised scope. |

Numeric stability was verified twice by dumping the total score, all six area scores, all sixteen
check scores, `meta.words`, `meta.pages`, `meta.bullets`, `meta.rubric`, `meta.fingerprint` and every
line score for the two audit fixtures and all four `DEMO_CVS`, before and after the change: **byte
identical**. The same comparison is frozen into `tests/audit.test.ts` for four representative
fixtures so a future regression fails in CI rather than in a student's report.

Not verified: rendered pages were checked by typecheck, lint and a successful production build, not
by opening a browser or running axe. No accessibility claim is made for the new scope-note paragraph
beyond its use of the existing body-text styles.

## Checks Codex must rerun

1. `npm run typecheck`, `npm run lint`, `npm run test:engine`.
2. `npm run diagnose:audit` and `npm run diagnose:audit -- --check`, confirming exit 0 and exit 1 and
   that the printed observations match this report.
3. The numeric-stability test specifically: confirm the frozen values in `tests/audit.test.ts` were
   recorded from the pre-change engine and not back-filled from the post-change engine. The
   reproduction is `git stash` the working tree, dump the same fields, restore, and compare.
4. `git diff -- src/app/_landing/` to confirm only the founder's pre-existing changes are present.
5. Render `/reviews/[id]/checks/spell`, `/checks/grammar`, `/checks/ats`, `/checks/length` and
   `/reviews/[id]/breakdown` against both a freshly analysed CV and a report saved under the old
   wording, to judge whether the `CHECK_SCOPE` note is sufficient contextual clarification or whether
   the stored/current label mismatch has to be resolved in OP-003 before this batch is accepted.
6. The scope judgment on `src/app/letters/LetterStart.tsx`, flagged above.
7. `npm run test:db` if the adviser-workflow wording is in question.

## Unresolved questions for the founder or Codex

1. Should the area labels be renamed in OP-003 together with the protected landing strings, or should
   the landing demos read the names from `AREA_META` so the two can never drift again?
2. `CHECK_SCOPE` currently covers four checks. Should OP-003 require a coverage note for every check,
   or keep notes only where a score is genuinely easy to over-read?
3. `proofreading.misspellings-change-the-score` assumes spelling will keep contributing to the
   composite score once OP-007 lands. Section 6 of the blueprint says proofreading coverage should be
   reported separately until calibrated. If that is the decision, this gate's desired behaviour
   should be restated during OP-007 rather than silently satisfied.
