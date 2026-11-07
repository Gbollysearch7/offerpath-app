# OP-011: independent calibration and evaluation tooling

Prepared 7 November 2026 by Claude, for independent acceptance review by Codex. Worked in a shared uncommitted tree with other agents. Nothing was committed, pushed or deployed. No migration was applied, no live database was touched and no paid provider was called: `ANTHROPIC_API_KEY` was blank for every process, and the judged path ran only against an injected fake judge in a test. `next build` and a dev server were not run.

## Task status

| Item | Status | Notes |
|---|---|---|
| OP-011 tooling | **Implemented** | Mechanics tested on invented data only. |
| Adviser validation | **Open** | No adviser has marked anything. |
| Recruit qualified, independent reviewers | **Open: human gate** | |
| Acquire consented, anonymised examples | **Open: human gate** | |
| Agree thresholds before held-out results are inspected | **Open: human gate** | The tool proposes no real numbers. |
| OP-015 independent fidelity review | **Open: human gate** | The review pack exists. Nobody has reviewed it. |

## What this task does and does not claim

It builds the tools for comparing Offerpath with independent advisers, and proves that they run and refuse what they should.

- **It holds no accuracy evidence.** Every figure the tool has produced came from invented marks, and its output says `SYNTHETIC, NOT VALIDATION`. This report quotes no accuracy figure for the product, and none should be inferred. The only numbers near a metric here are hand-worked arithmetic on toy data.
- The synthetic marks were generated from each CV's writing-strength label, which is also what its text was generated from. Any agreement with the engine there is partly built in, so synthetic figures mean nothing even as a rough guide.
- The tool checks records. It can't check that consent exists, that advisers are qualified or independent, or that a mark was blind. Those remain people's attestations, and a real report says so.
- No engine code and no score changed. `src/` is untouched by this task.

## Changed files

New, in `scripts/calibration/`:

| File | Purpose |
|---|---|
| `cli.ts` | Steps and exit codes: 0 done, 1 bad input, 2 held-out not met or inconclusive, 3 refused. |
| `dataset.ts` | Manifest, adviser-label import, version hashes. |
| `split.ts` | Grouped split, near-duplicate detection, lock. |
| `metrics.ts`, `stats.ts` | Metrics, intervals. |
| `gates.ts` | Pre-registered gates. |
| `heldout.ts` | Freeze and access ledger. |
| `run.ts`, `report.ts` | Evaluation pipeline, real-data checks, rendering. |
| `engine.ts` | Reads the engine through a `Predictor`. |
| `evidence.ts` | Evidence labels, human gates. The only home of the illustrative marks. |
| `anonymise.ts`, `sheets.ts` | Anonymisation, adviser sheets, sheet import. |
| `synthetic.ts` | The invented dataset, built on demand. |
| `op015.ts` | Blind review pack for OP-015's fixtures. |

New elsewhere:

- `docs/CALIBRATION_RUNBOOK.md` and this report.
- `docs/calibration/`: `ADVISER_MARKING_SHEET.md`, `CONSENT_AND_ANONYMISATION_CHECKLIST.md`, `THRESHOLDS_PREREGISTRATION.md`, `thresholds.template.json`, and blank CSVs for reviewers, marks, finding reviews, missed issues, rewrite items, rewrite reviews and intake. These sit here because `.gitignore` ignores `/calibration/*`.
- `tests/calibration-{stats,leakage,evidence,gates,metrics,import,workflow}.test.ts` (100 tests) and `tests/fixtures/calibration-helpers.ts`.

Modified:

- `scripts/calibrate.ts`: now only the entry point. The earlier concurrent `bandLabel` edit in that file is superseded, because band logic now uses `bandKey`, which compares bands rather than their wording.
- `calibration/README.md`: rewritten.

Deleted: `calibration/adviser_scores.example.csv`, the old `file,score` format, which is now refused.

## Behaviour

**Removed from the old script.** It averaged advisers into one number, silently skipped bad rows, mixed all CVs together, and advised raising the weights of areas that correlate with total marks. The blueprint warns against that last practice, and that correlation output is gone. Area figures now compare with advisers' area marks, if given.

**Adviser-label import.** Blind marks, finding reviews, missed issues and rewrite reviews. A bad row stops the import, every problem is listed, and the sheet is restored. Refused: `saw_offerpath_output` other than "no", duplicates, unknown documents or reviewers, out-of-range marks, personal data in notes, and a finding review dated before that adviser's blind mark. Each adviser's mark stays visible and disagreement is flagged.

**Dataset versioning.** `documentsHash` covers ids, groups and bytes. `dataHash` also covers the manifest and all sheets. Reports state name, version and both hashes. Real data must sit in a git-ignored folder.

**Grouped split.**
- Whole groups are assigned, balanced within discipline.
- The seed comes from the documents, so nobody can try seeds. The split reads no marks and no scores.
- A variant must share its original's group or the dataset won't load.
- Different-group documents sharing at least 50% of their word 5-grams stop the split, unless a person records them as distinct.
- After locking, these are refused: an edited or added document, a moved group, and a hand-edited side.

**Metrics.** Each has a value, item count, independent group count and 95% interval, or a note saying why there is none.

| Area | Metrics |
|---|---|
| Score error | MAE, RMSE, bias, within 5 and 10, per-area MAE |
| Ranking | Spearman, Kendall tau-b, band agreement |
| Coverage | Share scored. Withheld scores leave the error figures and count here |
| Adviser agreement | Krippendorff's alpha, leave-one-out MAE |
| Findings | False-positive rate (ties count against the app), disputed share, review coverage, missed high-severity issues |
| Severity | Exact agreement, linear weighted kappa |
| Usefulness of advice | Same-adviser mark change after applied recommendations |
| Gaming | Stuffing, fabricated figures, repetition and injection variants against their originals, per kind |
| Rewrites | Fidelity, seniority inflation, unnecessary change, clarity, usefulness, and the OP-015 check's missed inventions, false rejections and false questions against people's judgment |

Intervals use a group-level percentile bootstrap, widened to Wilson for proportions. There is no interval under 5 groups.

**Failed thresholds can't be hidden.** Each gate stands alone. One failure gives `NOT_MET`, and no composite exists anywhere in the report. `each:` gates run on every subgroup. A pass needs the cautious end of the interval to clear the threshold. Unmeasured, thin or under-minimum results are `INCONCLUSIVE`. Metric direction is fixed in code. A freeze refuses blanks and omitted required gates. Real data needs named `pilot_partner` and `founder` agreement. Fewer than 30 groups, fewer than 2 marks per held-out document, or reviews of findings the engine no longer raises all stop a "met".

**Tuning is evaluated on untouched data.** Development runs score only development documents. Opening held-out needs frozen thresholds and engine, plus `--open-heldout`. The look goes on a hash-chained ledger before any held-out score exists. After that, only an exact repeat runs, labelled as a repeat. A different engine, different thresholds or different data gives `HELD-OUT SPENT`. A development-score digest catches an engine changed without a version bump.

**Demo marks.** `--demo` shows a table with no statistics and no gates, and it refuses to combine with anything else. A dataset labelled `illustrative` is refused. So are demo CVs under any label, matched on text, including lightly edited copies. The synthetic dataset relabelled `real` is refused through its marker text and `SYNTH-` reviewers.

**Labels.** `SYNTHETIC, NOT VALIDATION` is on the first and last lines and every result row. The open human gates are listed in synthetic reports and the proof command's output. `validation_evidence` is `false`, or `pending_human_acceptance` for real held-out data. It is never `true`.

**Anonymisation workflow.** Intake sheet to cleaned text, with a separate key file refused inside the dataset. Placeholders keep their shape because the engine's contact check looks for an email, phone and LinkedIn link, and the log records any score change. The log holds categories and line numbers only. Real data won't load until a person signs off each document. Validation also scans for leftovers and for author metadata.

**Blinding.** Marking sheets carry document ids only, in a per-adviser order. Findings sheets carry no score, and are released only after that adviser's marks are in. Held-out findings also wait for the freeze.

**OP-015.** `op015-pack` writes a blind sheet of 112 fixture cases with labels held in a separate file. `op015-compare` shows where reviewers disagree with the author and how the check compares with reviewers.

**Paid path.** `--ai` needs `--allow-paid-provider` and a key, and verdicts persist in a file cache so scores repeat without paying twice. It has never run against a real provider.

## Validation: commands and actual results

Run on the final tree, 7 November 2026, `ANTHROPIC_API_KEY` blank.

| Check | Result |
|---|---|
| `npm run typecheck` | Exit 0. An earlier run showed errors only in others' in-progress files (`tailor-edits.ts`, `tests/fixtures/extraction/expected.ts`), since cleared. |
| `npm run lint` | Exit 0: 0 errors, 1 warning, the pre-existing `tests/e2e/smoke.mjs:38`. |
| `npm run test:engine` | Exit 0: **632 tests, 632 passed, 0 failed.** 100 are OP-011's. |
| `tests/calibrat*.test.ts` alone | **100 passed, 0 failed.** |
| `git diff --check` | Exit 0. My untracked files, scanned separately for trailing spaces: none. |
| Leakage (`tests/calibration-leakage.test.ts`) | 13 of 13, including six `LEAKAGE:` tests. |
| Demo refused as validation (`tests/calibration-evidence.test.ts`) | 18 of 18, including seven `DEMO:` tests. |
| `npm run calibrate -- --demo --split heldout` | Exit **3**. |
| `npm run calibrate -- synthetic --out DIR`, twice in fresh folders | Same report hash, `fe1db0ab829570be5f5dbc961b6db742033f2d109d9a121b6a0c6118d8d2f05c`. It depends on the engine, so it will move if the engine does. |
| `npm run test:db`, `test:live`, `next build` | Not run. No SQL changed, and the others are out of scope. |

**Known answers.** Krippendorff's alpha reproduces the published worked example (nominal 0.743, ordinal 0.815, interval 0.849), as I recalled it from Krippendorff's paper. I didn't re-fetch the paper, so check that citation. Wilson bounds, Kendall, kappa and all metrics in `tests/calibration-metrics.test.ts` are worked by hand in comments. SciPy wasn't available for a cross-check.

**Mutation checks.** 16 mutations, one guarantee each, ran in an isolated copy of the tree. 14 failed tests on the first pass. Two survived: "near-duplicate check off" and "illustrative label allowed", because a later check or the demo-text check masked them. I strengthened both tests, and both mutations now fail. Script: `/private/tmp/claude-501/-Users-gbolahan-Documents-NEW-ME-LevelUp/70ce5228-d909-41a7-b749-2bc52131c2e0/scratchpad/op-011/mutate.sh` (temporary).

**Bugs the tests found in my code.** The tool's own date-of-birth placeholder and `Candidate <hex>` name failed its own scan. A clock inside the report hash broke reproducibility. Both are fixed and covered.

**Housekeeping.** A slip of mine created an empty `/tmp/null` and hung one command. I stopped it and removed the file. The first two edits of that command had applied, and the rest were re-run.

## Limitations

- **The ledger holds on an honest machine.** Someone with the files can delete a whole dataset's state. Lodging the frozen hash with the partner is the outside check, and that is a human step.
- **Tuned against baseline isn't compared on held-out.** One engine gets the one look. Showing that a change helped needs an extra design.
- **Anonymisation is an aid.** It is regex-based and UK-centred. It misses unusual names, foreign phone numbers and rare combinations. PDF author detection works only on uncompressed metadata.
- **Text output loses layout**, so advisers marking `.txt` can't judge formatting. A hand-redacted PDF or Word file can be used instead, but `anonymise` doesn't produce one.
- **Grouping relies on the steward,** backed by the 5-gram check. A person's two very different CVs under different labels won't be detected.
- **Stratification is by discipline only.** A discipline with one group goes to development and is absent from held-out. Its `each:discipline` gate then doesn't run for it, though the report's discipline counts show the gap.
- **A split can't be extended.** Late documents mean a new dataset version.
- **Date-only ordering.** A same-day finding review passes the "after blind mark" check.
- **Consensus is a mean of advisers.** Disagreement is reported but no model of adviser severity is fitted. Reviewers' marking styles aren't adjusted for.
- **Intervals are approximate** on small samples, and bias has no gate.
- **The judged path is proven only with a fake judge,** and its file cache isn't safe for concurrent runs.
- **The OP-007 proofreading held-out set** also lacks human review. This task doesn't provide a pack for it.

## Migration impact

None. No SQL, no stored report and no score changed.

## Checks Codex must rerun

1. `npm run typecheck`, `npm run lint`, `npm run test:engine`, `git diff --check`.
2. `NODE_OPTIONS=--conditions=react-server npx tsx --tsconfig tsconfig.json --test tests/calibrat*.test.ts`: expect 100 passed.
3. Run `npm run calibrate -- synthetic --out DIR` twice with fresh folders and compare hashes. Read a held-out report in `DIR/reports/`.
4. Try to break it: relabel a dataset, split a variant into its own group, edit `split.lock.json`, the ledger or `prereg.lock.json`, drop a required gate, or change a mark after the look.
5. Write your own mutations. Mine were chosen by the code's author.
6. Check the alpha citation against the paper, and recompute a metric independently.
7. Read the three reviewer documents as an adviser would. **They have not been reviewed by a careers professional or a data protection lead.**

## Unresolved questions

1. **Founder: which engine is tested?** Rule engine or the AI judge? Live scoring uses the judge when a key is set, so calibrating the rules wouldn't measure what students see if the judge is on.
2. **Coordinator: ship the bundled parser and numeric bump first.** OP-010 left fixes pending, with estimated moves such as 22→87 and OP-009's numeric changes. Those are estimates, and any bump after opening spends the held-out set. The version set also moved during this batch: my final run reports `parser-2026-11-07.1` and `lexicon-2026-11-07.1`, where OP-010's table lists `2026-11-05.1`. The engine should settle before step 11 of the runbook.
3. **Founder and advisers:** are the 40% held-out share (my default) and the required gate list right? OP-010's 60% withhold line also remains uncalibrated.
4. **Stale text I didn't edit because the files aren't mine:**
   - `docs/DEPLOY.md:82` still gives `npm run calibrate -- --dir calibration --ai`, which is now refused and points to the runbook.
   - `.gitignore` still has `!/calibration/adviser_scores.example.csv`.
   - `src/lib/analysis/rubric.ts:2` suggests adjusting weights after calibrating.
   - `docs/LAUNCH_CHECKLIST.md:26` has T15-calibration ticked for the old script, while #11 correctly stays open.
5. **Landing copy (protected, not edited):** `src/app/_landing/Landing.tsx:89` says "Calibrated with advisers" under "PILOT TERM". No calibration has happened. It should read as a plan, or change before launch.
