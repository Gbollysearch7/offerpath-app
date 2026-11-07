# Offerpath batch 03 report: OP-009, date ordering, pronouns and consistency

Prepared 7 November 2026 by Claude, for independent acceptance review by Codex. Built in a shared uncommitted tree
while OP-007, OP-010, OP-012/013, OP-015 and OP-026 were also in progress. Nothing was committed, pushed or deployed.
No migration was applied, no live database or paid provider was touched, and `next build` was not run.

**Status: Implemented → Locally verified.** No human or operational gate was passed.

## What this task does and does not claim

Every new CV report now records seven supplemental findings beside the 16 core findings, and the report overview shows
them under "More writing checks", which says they aren't counted in the score. They cover date order, first-person
pronouns, how dates are written, bullet punctuation, bullet style, section headings, and a finding that says fonts and
alignment were not assessed. A report without them says "Not assessed" for each, never a pass.

- **No number moved.** Baseline hashes are byte-identical before and after (see Validation). `RUBRIC_VERSION`,
  `PARSER_VERSION`, `PAYLOAD_VERSION`, fingerprints and cache keys are unchanged by this task.
- These rules are **uncalibrated and not validated by an adviser**: confidence is `null` on all seven, and the section
  says no adviser has validated them. Whether any should affect a score is left to OP-010/011.
- It does **not** verify fonts, alignment, spacing or colour for any input, PDF included.
- It does **not** reorder or change a CV.
- It covers only the date, pronoun and consistency part of blueprint section 7. The wider accomplishment analysis in
  that section is not in OP-009 and was not attempted.

## Changed files

New (this task owns them):

- `src/lib/analysis/supplemental.ts`: runs the checks; `supplementalFindings`, `supplementalRows`, `runCheck`, `isSupplemental`.
- `src/lib/analysis/supplemental-context.ts`: one reading of the CV, evidence references, the finding builder, the keys.
- `src/lib/analysis/supplemental-dates.ts`: date reading on top of `parseDateRange`, comparison, ordering finding.
- `src/lib/analysis/supplemental-pronouns.ts`: context-aware pronoun finding.
- `src/lib/analysis/supplemental-consistency.ts`: date, punctuation, bullet, heading and visual findings.
- `src/app/reviews/[id]/SupplementalChecks.tsx`: the report section.
- `tests/supplemental.test.ts`: 36 tests.

Small additive edits to shared files, each re-read immediately before editing:

- `src/lib/analysis/findings.ts`: one import; `findings: origin === "engine" ? [...findings, ...supplementalFindings(text, doc)] : findings`.
- `src/lib/analysis/labels.ts`: one type import; `SUPPLEMENTAL_CHECK_LABELS`, `SUPPLEMENTAL_STATUS_DISPLAY`, `SUPPLEMENTAL_NOT_RECORDED`.
- `src/app/reviews/[id]/page.tsx`: one import, one element.
- `tests/payload.test.ts`: **an existing test was edited, and this was not in the brief's file list.** Three places
  asserted that every engine finding is a core check ("one finding per check" and two loops comparing findings with
  their checks). The acceptance requires new findings, so those three now filter with `!isSupplemental(f)`. The core
  assertions themselves are unchanged. The `checkEvidence` assertion in that test still covers all findings, supplemental included.

Not changed by this task: `parse.ts`, `rubric.ts`, `cv.ts`, `fingerprint.ts`, `judgment.ts`, `services.ts`,
`report-schema.ts`, `types.ts`, both repositories, migrations, `src/app/_landing/`.

## Behaviour

Findings use the existing shape and pass the existing schema and `checkEvidence` gate. All are `severity: "info"`
(the schema's word for anything that doesn't move the score), `confidence: null`, `method: "rules"`. Evidence is
`block: "doc"` with offsets into the normalised text. Status words are separate from the core ones because there is no
target: `passed` shows as "No issue found", `needs_attention` as "Worth checking", `not_applicable` as "Not assessed",
`unavailable` as "Not available", `uncertain` as "Uncertain". A check that throws becomes `unavailable`, and the report
is still made.

**Date order** (`supplemental.date_order`). Reads `structure.sections` and `structure.roles` from OP-005. Experience,
Projects and Activities use the parser's role lines; Education has no recorded roles, so its non-bullet lines are read.

| Case | Result |
|---|---|
| Work and study overlap | Never compared. Each section occurrence is its own list. |
| Two jobs overlap, either order | Allowed. Explanation says the overlap is fine. |
| Role inside its employer's range (nested) | Allowed. Children out of order within the group are reported. |
| Later-listed entry wholly after an earlier one | `needs_attention`, quoting both. Checked past a long-running entry between them. |
| "Present", year-only, month/year, 06/2024, "June - Aug 2023", "Nov - Feb 2023", "2021-23" | Read and compared. |
| "Jan 2022 -", "June - August", "Jun '21", "2024 - 2021", a role with bullets and no date, an Experience or Education section with no dates | `uncertain`, naming the entry, saying it isn't an error. |
| Year-only against a month in that same year | Can't be ordered, so `uncertain`. |
| Fewer than two dated entries in any section, or no timeline section | `not_applicable` (unless an incomplete date makes it `uncertain`). |

A real ordering issue is still reported when another date is incomplete, and the incomplete date is mentioned too. No
clock is read, so the same text always gets the same finding.

**Pronouns** (`supplemental.pronouns`). Flagged only in non-heading lines of Experience, Projects, Activities and
Achievements, and in bullets or sentences in Education. `needs_attention` for I/me/my, saying it isn't a grammar mistake
and to leave any written on purpose. `uncertain` when only we/our/us appear, since crediting a team can be right.

Not flagged: personal statement and header (counted and said to be left alone); double, curly and single quotations,
including across a wrapped line (counted likewise); skills, interests and references; role lines; capitalised names
("Our Lady's", "We Are Social"); "US", "ME"; "Phase I", "Level I"; "i.e.", "(i)"; "data mine"; letter-spaced names. No
sections or no scoped lines gives `not_applicable`.

**Consistency.** Each finding needs enough material to compare, otherwise `not_applicable`, and shows the lines that
differ from the majority.

- Dates: months in full, short or numeric; the mark between dates; "Present" against "current"; years against months
  *within* a section. Years in Education beside months in Experience is fine.
- Punctuation: full stop against none at bullet ends (same definition as the core `grammar` check); doubled punctuation.
- Bullets: lowercase against capital starts; different symbols. A line that lost its symbol is not counted as different.
- Headings: capitals, Title Case, Sentence case, lowercase; colons. One-word headings fit both of the mixed-case styles.
- Visual: always `not_applicable`, for every source, because no geometry reaches these checks.

Normalisation turns every bullet glyph into • and every dash into a hyphen, so bullet symbols and date separators are
read from the raw line, matched index for index with the scored lines. If they can't be matched, the finding says those
were not compared rather than reporting them as consistent.

**Reports without these checks.** `cvAssessment(..., "legacy")` adds none. `supplementalRows` treats an absent finding
as `not_applicable` / "Not assessed", with text saying the report was saved before the check existed. Nothing is
recomputed for an old report.

## Validation: commands and actual results

Final tree, 7 November 2026. Other agents were editing throughout, so results for files they own were moving.

| Check | Result |
|---|---|
| `npm run test:engine` | **378 passed, 0 failed** on the last run. 36 are `tests/supplemental.test.ts` (36/36 on three consecutive runs). Earlier runs had failures in tests for other tasks' in-progress work (tailor/requirements, security); none named a supplemental test, and all passed on the last run. |
| `npm run typecheck` | Passed on the last run. Earlier runs had errors only in other tasks' in-progress files (`claims.ts`, `audit.test.ts`, `repo/supabase.ts`, `security-auth.test.ts`, `security-logging.test.ts`), none in a file this task touched. |
| `npm run lint` | 0 errors, 1 warning (`tests/e2e/smoke.mjs:38`, pre-existing). |
| `git diff --check` | Clean, exit 0. New files checked separately: no trailing whitespace. |
| Numeric baseline | See below. |

**Numeric baseline.** The batch 02 dump script (12 CV/sector cases, tailor, letter; `scratchpad/batch-03/op-009/baseline.ts`,
an unmodified copy, with `strip.mjs`), run before the first edit and after the last. `baseline-before.json` and
`baseline-after.json` compare identical with `cmp`.

| View | SHA-256, before and after |
|---|---|
| Full dump | `7cfec3a0082afd06ac2cb9aee7f06ea52e9a232e2cae3744590087e520500865` |
| Without `steps[].area` | `572b76e1475f05f8ab525833255c0a576c0ec1cbb591c0c9e7a204a432e409d0` |
| Without `steps[].area` and `steps[].text` | `e1fec96a58b34ed28ef11fa17e888b930e81b44c442b86b88108015c703cae73` |

All three equal the batch 02 final values. `RUBRIC_VERSION` is `rubric-2026-10-30.1`, `PARSER_VERSION` is `parser-2026-11-05.1`.
The dump covers numbers, not `assessment.findings`, so it is not affected by new findings by construction. That is why
`tests/supplemental.test.ts` also asserts the analysis is unmutated, the core findings are unchanged, and only
`findings.ts` imports a supplemental module.

**Mutation check.** 16 deliberate breaks, run in a scratch copy of the tree rather than the shared one (for example:
overlap treated as an error, quotation exemption removed, visual reported as passed, absent finding read as passed,
legacy gaining findings, evidence quote altered). 15 failed tests first time. "Names flagged" survived, so a mid-line
name was added to the test, and it then failed too. Results: `scratchpad/batch-03/op-009/mutation-results.txt`.

**Extraction fixtures.** The test runs all 10 readable OP-005 fixtures through `extractDocument`: raw lines match,
evidence resolves, no check is unavailable. A probe on them found two false results, both fixed and now tested: a
repeated page header read as an undated role, and letters in a spaced-out name read as "I".

**Browser.** `next dev -p 3800` with Supabase, Resend and Anthropic keys blanked; boot log `"mode":"demo"`. Stopped by
PID afterwards (54453, 54448, 54428).

- Demo student's latest report: all seven rows, with quoted lines (`1-latest-desktop.png`, `2-latest-390.png`).
- Oldest demo report (v0 shape): all seven "NOT ASSESSED" (`3-legacy.png`).
- **The script failed on a final dashboard navigation (`ERR_ABORTED`), before writing its results file.** So the browser
  evidence is those screenshots, read by eye, not recorded assertions. Axe and overflow values from that run were lost.
- Axe and overflow were therefore measured separately: the component rendered to static HTML with the app's compiled
  `layout.css` in Chrome at 390px. Axe (wcag2a/aa, 21a/aa, 22aa) reported 0 violations, 0 incomplete, 9 rules passing;
  page overflow 0 (`4-static-390.json`, `4-static-390.png`). This tests the section alone, not the whole page. Its test
  data did not include a very long unbroken quoted line, so that case wasn't exercised.

**A second dev server did conflict on `.next`.** Three were sharing it (:3000, another agent's :3400, mine). :3000's `/`
returned 404 at times during my run, while `/sign-in` stayed 200, and my own server began returning 404s too. I can't
say which server caused it, but mine was one of them. `/` on :3000 was back to 200 after I stopped mine, and again at
the last check. **:3000 was not used for checks**, because I didn't confirm it runs in demo mode.

Scratch files are under `/private/tmp/claude-501/-Users-gbolahan-Documents-NEW-ME-LevelUp/70ce5228-d909-41a7-b749-2bc52131c2e0/scratchpad/batch-03/op-009/`.
They are temporary and not committed.

## Limitations

- A partial overlap is never an ordering issue, even when the lower entry both starts and ends later. This follows the
  blueprint's caution about overlaps, but it means a CV whose entries all overlap and run oldest first isn't caught.
- Entries are read from what the parser recorded. A role written as a bullet, or a date swallowed into a wrapped bullet,
  isn't seen as dated, which gives `uncertain` in Experience or Education, and is simply ignored in Projects or Activities.
- `parseDateRange` reads any word starting like a month as that month ("Marketing 2021" as March). `readDates` corrects
  this for these checks. `parse.ts` itself was left alone and still records the wrong month in `document.structure`.
- A role line with a year in its name counts as dated. Achievements, awards and publications are not ordered.
- `cvAssessment` doesn't receive `DocumentMeta`, so page headers are recognised by repetition or "Page N" rather than
  OP-005's edge-line detection, and extraction warnings don't lower these findings.
- Bullet symbols are what extraction produced. A mix can come from the file's fonts, and the finding says to check the file.
- The core `grammar` check counts "iPhone" as a lowercase start; the bullet-style finding doesn't, so they can disagree in that case.
- Punctuation inside sentences, tense and parallel structure are not assessed.
- Findings appear only on the report overview: no check page, adviser view or export. Rules are UK conventions and English only.

## Migration impact

None. No SQL. `PAYLOAD_VERSION` unchanged: `Finding.check` and `id` are already strings. Existing rows are not rewritten
and read as "Not assessed". New reports' payloads are about 7 findings larger.

## Unresolved questions

1. Should a partial overlap where the lower entry is later on both dates be raised gently? It is currently silent.
2. Is "uncertain" right for we/our/us only, or should that be plain guidance? An adviser should decide.
3. These findings and the rules behind them need adviser validation before any scoring use (OP-010/011).
4. Should parallel agents get a separate `distDir`? Sharing `.next` caused the 404s above.

## How to reproduce

1. `npm run test:engine`, and `npx tsx --tsconfig tsconfig.json --test tests/supplemental.test.ts` with `NODE_OPTIONS=--conditions=react-server`.
2. Run your own baseline against a tree without this task's edits to `findings.ts`, `labels.ts` and `page.tsx`; expect the hashes above.
3. Remove the `isSupplemental` filter from `tests/payload.test.ts` to see why that edit was needed.
4. Open a demo report in a demo-mode server: latest shows findings, oldest shows "Not assessed".
