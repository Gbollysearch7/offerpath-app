# Parser and lexicon bump: the four fixes held back by OP-005, and the month bug

Prepared 7 November 2026 by Claude, for independent acceptance review by Codex. Built in a shared uncommitted tree while OP-007, OP-011, OP-014/016 and OP-025 were also in progress. Nothing was committed, pushed or deployed. No migration was applied, no live database or paid provider was touched, and `next build` was not run.

**Status: Implemented → Locally verified.** No human or operational gate was passed.

## What this does and does not claim

CVs with symbol-font bullets, academic headings or a bare "Activities", role and date cells in Word tables, and repeated page headers are now read correctly. "Marketing 2021" is no longer read as March. Saved reports are not touched, and new scores start a new series.

- **Only one score moved materially:** `symbol-bullets.pdf` went from 22 to 87. `academic.pdf` went from 83 to 85. No other fixture and none of the 12 baseline cases moved.
- **No fixture or baseline case went down.** A real CV can go down, for a reason shown below (85 to 79 on three CVs built to show it).
- **The brief expected the baseline hash to change. The batch 02 dump did not:** it is `7cfec3a0…0865` before and after, because those CVs contain nothing these fixes touch. A wider dump that includes versions does change. See "Baseline hashes, for other agents".
- It changes no weight, threshold, target or rubric value. `RUBRIC_VERSION` is unchanged, so no verdict cache key changes.
- It was **not** tested on real Word-exported or Wingdings PDFs. See "Limitations".
- It does not validate any score with an adviser (OP-011).

## Versions

| Part | Before | After | Why |
|---|---|---|---|
| `PARSER_VERSION` | `parser-2026-11-05.1` | **`parser-2026-11-07.1`** | Repeated lines, list-item headings and dates are cut differently. |
| `LEXICON_VERSION` | `lexicon-2026-11-05.1` | **`lexicon-2026-11-07.1`** | `SECTION_HEADERS` and the new `LIST_ITEM_HEADINGS` changed. |
| `EXTRACTOR_VERSION` | `extractor-2026-11-05.1` | **`extractor-2026-11-07.1`** | Symbol glyphs and Word table rows are read differently. Not part of the identity (OP-010), so this bump relies on the parser and lexicon bumps to start the new series. |
| Rubric, normaliser, judge prompt, model, `PAYLOAD_VERSION`, coverage policy | unchanged | unchanged | Nothing they cover changed. |

**Conflict for Codex to rule on.** `rubric.ts` lines 9 to 11 say to change `RUBRIC_VERSION` when "the word lists in lexicon.ts that feed checks and judgments" change. OP-010's version table and `rubric.ts` line 25 say a word list change bumps `LEXICON_VERSION`. I followed OP-010's table, as the brief told me to. `SECTION_HEADERS` decides how text is cut, not how a bullet is judged, and a rubric bump would have re-judged every bullet at normal cost. I left the comment as it is. See unresolved question 1.

## Changed files

| File | Change |
|---|---|
| `src/lib/analysis/parse.ts` | Version; `MONTH` is whole month names only; `pageFurniture`; `normaliseHeader(line, within?)`; `cleanRole` keeps words and also cuts `03/2018` dates. |
| `src/lib/analysis/lexicon.ts` | Version; 25 new headings; `LIST_ITEM_HEADINGS`. |
| `src/lib/analysis/extract.ts` | Version; `markerOf` and the document-wide glyph count; `rejoinRow` for Word tables. |
| `src/lib/analysis/document.ts` | Warning weights and wording; `TABLE_READ_WEIGHT`; `fileWarnings` takes the parsed CV. |
| `src/lib/analysis/supplemental-dates.ts` | OP-009's local month correction removed. |
| `tests/extract.test.ts` | 15 tests before, **25 now**. Hand-updated expected structure; 10 new tests. |
| `tests/fixtures/extraction/expected.ts` | Updated by hand for the four fixtures, with `score`, `scoreBefore` and `gate` added to every fixture. |
| `scripts/make-extraction-fixtures.ts`, `tests/fixtures/extraction/{lost-bullets.pdf, unknown-headings.pdf, table-undated.docx}` | Three new fixtures. Only these three were written; the existing files were not regenerated. |
| `tests/fixtures/pre-bump-reports.json` (new) | Two reports written by the old engine, before my first edit. SHA-256 frozen in the test. |
| `tests/scoring-contract.test.ts` | New version hashes added to `FROZEN`; old ones kept. |
| `tests/sources.test.ts`, `tests/security-deletion.test.ts` | **Not in my brief.** They used `symbol-bullets.pdf`, `academic.pdf` and `table.docx` as files that get held for review, and those no longer are. They now use the three new fixtures, which still need review. No assertion was weakened. |

`rubric.ts`, `cv.ts`, `fingerprint.ts`, `judgment.ts`, `scoring-contract.ts`, `report-schema.ts` and migrations were not changed by this task.

**Another agent edited a file I own during this task.** At 00:48:27, `WEAK_VERBS.helped` in `lexicon.ts` changed from `"Organised"` to `"Supported"` (a rewrite suggestion, not my change). I did not revert it. It changes no score and leaves the baseline hash as it was, and the `lexicon-2026-11-07.1` hash in `FROZEN` (`5c9b5d6e…`) includes it. If it lands separately, that hash must be recomputed.

## Behaviour

**1. Symbol-font bullets (`extract.ts`).** A row may start with a decoded bullet when its first piece is one character, is in a different font from the text after it, and is set apart from that text by a gap. The character is written as "• " when the same character, font and indent start at least two rows of three or more words anywhere in the document. Ordinary punctuation, currency signs and characters the parser already treats as bullets are left alone. Bold initials, grade columns, glued first letters and same-font markers stay as written (tested).

**2. Headings (`lexicon.ts`).** Added: bare "Activities", other and student activities; research and teaching experience, research, teaching, academic experience and appointments; conferences, talks, presentations, grants, funding, scholarships, honours and awards. Research and teaching map to `experience`, conferences and funding to `achievements`. A one-word heading that can also be a list item ("Research") stays a list item inside Skills or Interests unless it is in capitals. Only `parseCv` passes that context.

**3. Word tables (`extract.ts`).** A row with exactly one short date cell puts that date on the first line of the cells beside it. So "Steward / Northgate Arena | 2021 - 2022" reads "Steward 2021 - 2022" then "Northgate Arena". Date-first rows, three-cell rows and a role with its bullets in one cell also work. Rows with no date, nested tables and sidebar layouts read as before. PDFs didn't have this defect: their cells already share a row.

**4. Repeated headers (`parse.ts`).** The scorer only has text, so this reads text. A bare page number is always furniture. Otherwise a line qualifies if it repeats (digits aside), has no year, is 14 words or fewer, and is also the CV's first line, a page label, a CV title or contact details. It is not a role, heading or part of the section, and a bullet carries on across it. A repeat alone isn't enough, so "Barista, Costa 2021 - 2022" twice stays two roles (tested). The words still count towards length, so scores for these CVs don't move. The edge-line logic in `document.ts` stays for footers the parser can't recognise, such as a bare "Confidential".

**5. Months (`parse.ts`).** Only real month names and abbreviations count, plus "Febuary" so that common misspelling keeps its month. `cleanRole` no longer cuts words that start like a month: "Head of Marketing 2021 - 2023" now gives "Head of Marketing".

**OP-009's correction was safe to remove.** `withRealMonth`, `MONTH_ONLY_RE` and `WORD_BEFORE_YEAR_RE` are gone. I ran old and new `readDates` over 1,196 generated lines (`dates-diff.ts`, output in `dates-diff.txt`):

| Result | Lines |
|---|---|
| Identical | 759 |
| Only the `raw` text differs ("2021" instead of "Marketing 2021") | 315 |
| "Febuary" or "Febr" now keep their month | 38 |
| A non-month word used as a range end: "2020 - Marketing 2021" was a range and is now the first date only. "2020 - Summer 2021" already read that way. | 84 |

`tests/supplemental.test.ts`, unedited: 36 of 36 pass.

## Score movement: actual, not estimates

Scored with `analyseCv` on the text `extractDocument` produced, sector Technology. "Before" comes from the old engine; the second run, in `before-tree`, was a current copy of the tree with my five engine files restored. The score has no sector weight, and the sector-fit figure is excluded from it.

| Fixture | Before | After | OP-010 estimate | Why |
|---|---|---|---|---|
| `symbol-bullets.pdf` | 22 | **87** | 87 | 0 → 4 bullets. See below. |
| `academic.pdf` | 83 | **85** | 84 | `sections` check 7 → 10, because Experience is now found. See below. |
| `table.docx` | 87 | 87 | 87 | Same bullets and words. Only labels changed: "EXPERIENCE 1" → "EXPERIENCE · DATA ANALYST, EXAMPLE LTD". |
| `repeated-header.pdf` | 90 | 90 | 90 | Same bullets and words. Only labels changed: "EXPERIENCE · ALEX EXAMPLE - CURRICULUM VITAE" → "EXPERIENCE · DATA ANALYST, EXAMPLE LTD". |
| `single-column.pdf` | 88 | 88 | | Nothing it contains changed. |
| `two-column.pdf` | 82 | 82 | | Same. |
| `wrapped-bullets.pdf` | 87 | 87 | | Same. |
| `letter-spaced-headings.pdf` | 85 | 85 | | Same. |
| `mixed-scan.pdf` | 80 | 80 | | Same. |
| `blank-trailing-page.pdf` | 100 | 100 | | Same. |
| `cv.pdf` | 96 | 96 | | Same; its frozen text hash `19c56a76…` still holds. |
| `lost-bullets.pdf` (new) | 22 | 22 | | Markers share the body font, so nothing shows they were bullets. |
| `unknown-headings.pdf` (new) | 86 | 86 | | Its headings are still unknown. |
| `table-undated.docx` (new) | 82 | 82 | | No date cell to rejoin. |
| `scan.pdf`, `scan.docx` | no score | no score | | Still the `image_only` outcome. |

| 12 baseline cases | Before | After |
|---|---|---|
| audit-clean, Technology and Finance | 83, 83 | 83, 83 |
| audit-misspelled, Technology and Finance | 83, 83 | 83, 83 |
| demo-v3, Finance and Technology | 61, 61 | 61, 61 |
| demo-v4, Finance and Technology | 65, 65 | 65, 65 |
| demo-v5, Finance and Technology | 79, 79 | 79, 79 |
| demo-v6, Finance and Technology | 87, 87 | 87, 87 |

All areas, checks and line scores in these 12 are identical. They have no symbol bullets, tables, repeated lines or new headings.

**`symbol-bullets.pdf`, 22 to 87.** The composite is the area scores times their weights.

| Area (weight) | Before | After | Cause |
|---|---|---|---|
| Impact (0.3) | 0 | 100 | Four bullets are assessed. |
| Clarity (0.175) | 0 | 100 | Same. |
| Structure (0.175) | 77 | 77 | Unchanged. |
| Spelling (0.115) | 50 | 100 | `grammar` 0 → 10. |
| Length (0.235) | 10 | 60 | `bulletlen` 0 → 10, `bullets` 0 → 5. |
| Total | 21.6 → 22 | 86.6 → 87 | |

Sector fit moves 20 → 30 and carries no weight. Words go 83 → 79, because the four "3"s no longer count.

**`academic.pdf`, 83 to 85.** Structure 57 → 67, times 0.175, is +1.75 (83.07 → 84.82). OP-010's estimate of 84 is off by one; its estimate method isn't recorded in enough detail for me to say why. The same four bullets are scored, now labelled under their real sections. Before, core bullets numbered under 3, so all four were used; now all four are core.

### Can a CV go down? Yes, on real CVs

No fixture did, but these three CVs, built to show it, each go **85 → 79** (`down.ts`, results in `down-before.txt` and `down-after.txt`):

| CV | Bullets | Impact | Why |
|---|---|---|---|
| Weak bullets under RESEARCH EXPERIENCE, below Education | 4 → 7 | 100 → 78 | They were read as Education, which isn't scored once 3 core bullets exist. |
| Weak bullets under ACTIVITIES, below Education | 4 → 7 | 100 → 78 | Same. |
| Strong ordinary bullets plus weak symbol-font bullets | 4 → 7 | 100 → 78 | The weak lines were not recognised as bullets. |

In each, weak lines that went unassessed are now assessed. This is the fix working, not a defect, but a student could see a lower number. The series break means it is never shown as a decline.

## Confidence, warnings and the review screen

| Warning | Before | After | Why |
|---|---|---|---|
| `symbol_font_markers` | 0.3, caution | **0.05, info** | The bullets are now read. New wording says so, and to check nothing lost a first letter. |
| `repeated_header_footer` | 0.1, caution | **0.05, info** | Roles are no longer split. New wording says the words still count. |
| `table_layout`, Word, dated roles and bullets found | 0.25, caution | **0.05, info** | Evidence the table did no harm. |
| `table_layout`, Word, no dated roles or no bullets | 0.25, caution | 0.25, caution | Still unconfirmed. New wording. |
| `table_layout`, PDF | 0.25, caution | 0.25, caution | The risk is real (a wrapped cell can mix with its neighbour), and this wasn't the bug fixed. The old wording described Word behaviour, so it is corrected. |
| `unrecognised_headings`, `no_bullets_found`, others | unchanged | unchanged | Still true when they fire. |

| Fixture | Confidence before | After | First screen before | After | Coverage |
|---|---|---|---|---|---|
| `symbol-bullets.pdf` | 0.45 low | **0.95 high** | Review | **Report** | withheld → complete |
| `academic.pdf` | 0.70 medium | **1.00 high** | Review | **Report** | complete |
| `table.docx` | 0.75 medium | **0.95 high** | Review | **Report** | complete |
| `repeated-header.pdf` | 0.90 high | 0.95 high | Score, then reading | **Report** | complete |
| `mixed-scan.pdf` | 0.40 low | 0.40 low | Review | Review, unchanged | incomplete |
| `two-column.pdf` | 0.85 high | 0.85 high | Score, then reading | Unchanged | complete |
| Others | | unchanged | | unchanged | |

## Saved reports across the version boundary

`tests/extract.test.ts`, "reports saved before the parser bump keep their bytes", uses `tests/fixtures/pre-bump-reports.json`, written by the old engine. For `academic.pdf` (83) and `symbol-bullets.pdf` (22), through the demo repository and the Supabase repository against the in-memory fake:

- `fromStored`, `toStored` and a save-and-read all return **byte-identical JSON**, and the score stands, including after a new report is saved.
- The same file read today scores 85 and 87 under an identity holding the new parser and lexicon.
- `comparableScores` is false.
- `comparableHistory` leaves the old report out of the new report's chart and counts it as set aside.
- `meta.fingerprint` and cache key formulas are unchanged, so unchanged bullet text reuses cached verdicts.
- `report_score_series` reads the identity from the payload and pins no version, so it needs no migration.

## Baseline hashes, for other agents

| Dump | Old | New |
|---|---|---|
| Batch 02 dump, 12 cases plus tailor and letter (`baseline.ts`) | `7cfec3a0082afd06ac2cb9aee7f06ea52e9a232e2cae3744590087e520500865` | **`7cfec3a0082afd06ac2cb9aee7f06ea52e9a232e2cae3744590087e520500865`** (unchanged) |
| Same cases with `identity`, `coreFingerprint`, `fingerprint` and line labels (`baseline2.ts`, new) | `5007aa79135aedb20d66c2d657d21353f01dcde70bf6d8dacf600239b7ebf501` | **`a5c0c19f652640a9f4110b246a6a9c5291311ed91e4f2520e3f024a6b6620ee8`** |
| `FROZEN.parser` (`scoring-contract.test.ts`) | `a1c6a1c0…1472` | same hash, new key |
| `FROZEN.scores` | `6e448592…baad` | same hash, new key |
| `FROZEN.lexicon` | `4688a58b…bdd3` | `5c9b5d6e7beb624db644c39a9ae6977c5023aae3b64fb29174aef0aeb97008ac` |

**If you are another agent:** `7cfec3a0…` still being the hash does not mean nothing changed. It leaves out versions, and its CVs contain nothing these fixes touch. Between old and new `baseline2`, only `identity` and `coreFingerprint` differ, in all 12 cases (24 fields). New reports carry `parser-2026-11-07.1` and `lexicon-2026-11-07.1`. A test or script that hardcodes the old strings for a *current* report will fail. Hardcoding them for a *saved* report is right. Any fixture you were using as "held for review" may no longer be held; use `lost-bullets.pdf`, `unknown-headings.pdf` or `table-undated.docx`.

## Validation: commands and actual results

Final tree, 7 November 2026, about 00:58. Other agents were still editing, and two earlier runs differed (below).

| Check | Result |
|---|---|
| `npm run typecheck` | **Pass, exit 0.** At 00:54 it had 2 errors, both in `tests/calibration-import.test.ts`, OP-011's in-progress file; they have since cleared. None was in a file I touched. |
| `npm run lint` | 0 errors, 1 warning, the pre-existing `tests/e2e/smoke.mjs:38`. |
| `npm run test:engine` | **Exit 0: 630 tests, 630 passed, 0 failed.** The count grew from 380 at OP-010 through other agents' work; **10 tests are new from this task**. |
| `tests/extract.test.ts` alone | 25 of 25. |
| `tests/scoring-contract.test.ts` alone | 22 of 22. |
| `tests/supplemental.test.ts` alone | 36 of 36, unedited. |
| `npm run test:db` | Exit 0: 274 PASS, 0 FAIL. |
| `git diff --check` | Clean, exit 0. |
| `diagnose:audit -- --json` | Exit 0, **9 of 9**. Gate list identical to the run before my first edit. |
| `diagnose:audit -- --check --json` | Exit 0, **9 of 9**. |
| Mutation checks | **23 of 23 caught**, run in a scratch copy: each fix disabled, each guard removed, each version unbumped, each weight restored. `mutation-results.txt`. |

**Failures seen on earlier runs, none from this bump.** At 00:47 to 00:54 these failed. I ran the first three against a copy of the tree with my five engine files restored to their pre-edit versions, and they failed the same way there. All have cleared without my involvement.

| Test | Cause | Owner |
|---|---|---|
| "tailoring never adds a number the CV doesn't have" (`tests/engine.test.ts`) | `tailor.ts`, edited 00:43 | OP-014/016 |
| "every exported server action checks the session" (`tests/security-tenancy.test.ts`) | `src/app/actions/proofreading.ts`, `dismissFinding` | OP-007 |
| "a retry after a failed save" (`tests/sources.test.ts`) | Not established; failed on the old engine too | Not mine |
| The rewrite test that pinned `"Organised"` (`tests/rewrite.test.ts`) | The `WEAK_VERBS.helped` edit above | OP-014/016 |
| `tests/recovery-db.test.ts`, as a file | Not investigated | Not mine |

**Browser.** A scratch copy under `parser-bump/after-tree`, `next dev -p 3517`, keys blank, boot log `"mode":"demo"`. Stopped by its own port after checking its working directory. The founder's :3000 was not touched and answered 200 afterwards. Uploads through the real form:

| File | Landed on | Score |
|---|---|---|
| `symbol-bullets.pdf` | Report (screenshot read: ring 87, Impact 100) | 87 |
| `academic.pdf` | Report | 85 |
| `table.docx` | Report | 87 |
| `repeated-header.pdf` | Report | 90 |
| `lost-bullets.pdf` | Review, "MEDIUM CONFIDENCE · NOT SCORED YET" | not scored |
| `mixed-scan.pdf` | Review, "LOW CONFIDENCE · NOT SCORED YET" | not scored |
| `two-column.pdf` | Reading shown, "HIGH CONFIDENCE", already scored | 82 |

No page errors. The browser run did not include a saved pre-bump report: demo seeds are built by the current engine, so the boundary is proved by the test above, not on screen.

## Limitations

- **Real files.** Only ZapfDingbats through pdf-lib ran through the real worker. Wingdings, Symbol and private-use glyphs were simulated at the pdf.js item level. No real Word-exported PDF or real student CV was tried.
- **The glyph rule can be wrong.** It does not know the font's name, because pdf.js text content doesn't reliably give it. Two aligned rows starting with the same bold letter and a gap would lose that letter. The info warning tells the student to check, but it no longer stops at review.
- **Text already saved isn't re-read.** A version held for review before the bump and scored after it keeps "3 Built…", and scores 22 with no overall score shown. Its `document.extraction.parser` names the old parser while `analysis.meta.scoring` names the new one. `toStored` doesn't check that pair. Re-uploading fixes it, because an upload with a new attempt key is a new version.
- **Pasted text.** Lines pasted as "3 Built…" aren't converted: the evidence is the font, and text has none.
- **Footers.** A repeated footer with no name, page label or contact details ("Confidential") is still a role line in the parser, so it can still show on a line's label. The recorded structure corrects it from page edges. A header with a year isn't recognised.
- **Word count** still includes repeated lines, so a long CV's length check can be slightly generous. Unchanged, and the warning says so.
- **`job-match.ts` and `tailor.ts`** call `normaliseHeader` without context, so "Research" alone in a Skills list ends that section there. I left those files to their owners.
- **New one-word headings in Title Case directly after Skills or Interests** read as list items, so a real "Teaching" heading there is missed, unless it is in capitals.
- **Misspelt months** other than Febuary now lose their month ("Septmber 2021" gives 2021). Before, any word with the stem counted. Season ranges are still unread.
- **Word tables:** rows with two date cells are left as they are.
- **The contract test can't catch these behaviours.** `FROZEN.parser` hashes the audit and demo CVs, which contain none of them, so its hash didn't move. `tests/extract.test.ts` catches them instead (mutation results above).
- **Weights** are still heuristics (OP-011). 0.05 for the three reweighted warnings is a judgment call.
- **Supabase** was exercised only through the in-memory fake.

## Migration impact

None. No SQL. `PAYLOAD_VERSION` is unchanged, and `EXTRACTION_WARNING_CODES` keeps every code, so saved warnings still validate. No row is rewritten. Once deployed, every student's next report starts a new series, so their change figure restarts and earlier reports are set aside with their original scores. **That is visible to every student at once**, so the deploy timing is worth deciding with OP-011's plans in mind (unresolved question 2).

## Unresolved questions

1. **Codex:** `rubric.ts` lines 9 to 11 conflict with OP-010's table on word lists. I treated `LEXICON_VERSION` as sufficient. If you agree, those lines should be reworded. I left them.
2. **Founder:** a parser bump restarts every student's history once. OP-010 asked for one bundled bump. OP-011 may add its own; should they ship together?
3. **Founder and advisers:** some students' scores can fall on re-upload (85 → 79 above). Is a note needed beyond "scored under different rules"?
4. **OP-014/016:** please confirm the `WEAK_VERBS.helped` edit is meant to ship under this lexicon version.
5. **OP-025 or OP-006:** should a version held across a bump be re-read from its stored file before scoring?
6. **Job-match and tailor owners:** pass the current section to `normaliseHeader`?

## How to reproduce

Scratch folder: `/private/tmp/claude-501/-Users-gbolahan-Documents-NEW-ME-LevelUp/70ce5228-d909-41a7-b749-2bc52131c2e0/scratchpad/parser-bump/`. It is temporary and not committed. It holds pre-edit copies (`before-src/`), my engine diff (`patch/engine.diff`), and every script and output named above.

1. `npm run typecheck`, `lint`, `test:engine`, `test:db`, `git diff --check`, and `diagnose:audit` in both modes, once concurrent work has settled.
2. With `NODE_OPTIONS=--conditions=react-server`: `npx tsx --tsconfig tsconfig.json --test tests/extract.test.ts tests/scoring-contract.test.ts tests/supplemental.test.ts`; expect 25, 22 and 36.
3. Scores: `npx tsx --tsconfig tsconfig.json <scratch>/probe.ts` from the project root for "after". For "before", run it from a copy of the tree with `before-src/{parse,extract,document,lexicon,supplemental-dates}.ts` restored to `src/lib/analysis/`.
4. Baseline: `<scratch>/baseline.ts` and `baseline2.ts` the same way, then `shasum -a 256`. Expect the hashes above. Capture your own "before" independently if you can.
5. Mutations: `T=<a scratch copy> S=<scratch> python3 <scratch>/mutate.py`. Never point `T` at the shared tree: it edits files in place.
6. If any test fails, attribute it by running it in that "before" copy too.
7. Confirm `tests/fixtures/pre-bump-reports.json` predates the bump: it records `parser-2026-11-05.1`, and its SHA-256 is `a19f5848…a7d5`.
