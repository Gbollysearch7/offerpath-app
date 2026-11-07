# Independent review of Claude batch 01

Reviewer: Codex. Date: 5 November 2026.

## Decision

**OP-001 and OP-002 are accepted for their bounded scope after reviewer corrections.** The first batch makes the audit reproducible and improves the honesty of existing feedback. It does not deliver comprehensive proofreading, contextual job matching, full CareerSet parity or institutional launch readiness.

Claude Code was actually launched against `docs/CLAUDE_FIRST_BATCH.md`, using its configured account. It completed the implementation and wrote [its original report](CLAUDE_BATCH_01_REPORT.md). Codex inspected the actual changes, independently checked numerical preservation, reviewed the UI, corrected findings, and reran the relevant checks. No deployment, commit or push was performed.

## Findings and resolutions

| Finding | Evidence and consequence | Resolution |
|---|---|---|
| New copy claimed every rewrite was checked for invented figures | `aiRewriteLine` returns a parsed string and `rewriteLine` saves it without a number-provenance validator. A safeguard in the tailoring path does not establish one for every line or letter. Help, privacy and line-editor wording overstated protection; the letter introduction still contained an absolute claim. | Corrected the copy to explain that suggestions can introduce mistakes and require review of figures, responsibilities and outcomes. Also removed the equivalent absolute in the tailoring loading message. The writing engine remains unchanged; substantive fidelity work is OP-015. |
| A high readability score praised nonexistent headings | A synthetic 160-word document with no recognised sections scored 8 and received “Text and headings read cleanly.” | Changed the summary to “Text available for review.” The detailed count still reports zero headings. Added a regression case without changing the numerical heuristic. |
| The diagnostic could confuse echoed words with detected errors | Its detection adapter searched rewrites, explanations and other output for misspelled words. Merely repeating source text could satisfy that criterion. | Restricted detection to explicit entries in the spelling check's current finding list. Added a test proving that echoing all four words in a rewrite or explanation does not count. The adapter must be updated when versioned proofreading evidence is introduced. |
| An acceptance gate assumed an uncalibrated scoring decision | `proofreading.misspellings-change-the-score` required a lower composite score, although the blueprint explicitly keeps proofreading separate until calibration. | Removed that gate. Clean/misspelled scores remain visible observations. The positive diagnostic test now permits successful error detection with unchanged composite scores. |
| Several harness tests required the current matching defect to persist | Assertions expected repeated desirable Excel to be essential and the essential technologies to remain absent. Even with explanatory comments, these would resist a correct future repair. | Replaced those assertions with faithful comparisons against actual engine observations. Tested pass/fail reporting using explicit synthetic observations instead. Numerical compatibility snapshots remain clearly scoped to this copy-only batch. |

Codex also removed an unsupported general claim about spelling being a leading cause of CV rejection and changed the historical-report note to refer to “older reports,” avoiding an inaccurate month-based boundary.

## Independent validation

| Check | Final result |
|---|---|
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed with zero errors and one existing unused eslint-disable warning in `tests/e2e/smoke.mjs:38`. |
| `npm run test:engine` | **91 passed, 0 failed**: 74 existing tests and 17 audit tests. |
| Targeted audit tests | 17 passed, including the two reviewer-added edge cases. |
| Numerical compatibility | All 12 CV/sector cases matched an independently captured pre-change baseline, including total/area/check/line scores, affected indexes, improvement estimates, fingerprints and metadata. |
| Protected work | SHA-256 comparisons confirmed every pre-existing landing file, `rubric.ts`, the blueprint and the task register were unchanged by Claude and the implementation corrections. |
| Diagnostic observation mode | Valid JSON; exit 0; 2 gates met and 6 unmet. |
| Diagnostic `--check` mode | Valid JSON; exit 1 because the 6 product-quality gates remain unmet. |
| Browser verification | Ten student pages returned HTTP 200; the admin page rendered. No page-script errors. The 390px spelling page had no horizontal overflow. |
| Whitespace/error check | `git diff --check` passed. |

The full engine suite ran with the local permissions needed for its monitoring test's temporary listener. No live-service test or external AI analysis was run by Codex. Claude additionally recorded successful build and database checks in its submission; no schema or persistence implementation changed in this batch.

The browser pass used fictional demo accounts and checked overview, spelling, writing consistency, readability, length, breakdown, line editing, letter creation, expanded help answers, privacy and the admin dashboard. Desktop spelling, mobile spelling and the final letter screen were also visually inspected. Temporary screenshots and observations are in `/tmp/offerpath-batch-01/`; they are not committed and may be removed by temporary-file cleanup. This was a focused visual check, not a formal accessibility audit or a test of every interaction.

One repeat browser attempt encountered a generated Next.js cache conflict after Claude's production build ran while the development server was active. Codex stopped that server, moved the generated cache aside, restarted the local demo, and completed the final pass successfully. No source change was needed for that environment issue.

The baseline was captured before Claude changed the engine file and compared again after the final corrections. No stash, reset or replacement of the founder's working tree was necessary. The blueprint remains exactly **5,000 whitespace-separated words**, and the register contains **30 unique numbered tasks**.

## What the diagnostic now means

Run:

```sh
npm run diagnose:audit
npm run --silent diagnose:audit -- --json
npm run --silent diagnose:audit -- --check --json
```

Use `--silent` with npm when piping JSON to another program; otherwise npm adds its own script banner. Observation mode succeeds because collecting evidence succeeded. Check mode fails because the product still misses the desired behaviour. This distinction is intentional and is not a failing implementation test being hidden.

The remaining gates are:

1. Detect the four introduced spelling errors.
2. Extract Kubernetes and Terraform from the explicit requirement sentence.
3. Classify both as essential.
4. Keep repeated, explicitly desirable Excel desirable.
5. Show both essential evidence gaps for an Excel-only CV.
6. Remove the unconditional match-score baseline in a properly versioned matching change.

The misspelled and clean audit CVs still each score 83 overall and 10/10 on the limited writing checks. The Excel-only example still scores 77, and the no-evidence example scores 30. Those observations are disclosed, not endorsed. OP-007 and OP-012/013 remain open.

## Accepted limitations and next work

The check pages now show current coverage notes even when the saved payload contains older wording. This was inspected in code and exercised with a legacy-shaped test fixture. No stored report has been migrated, and no production historical report was loaded for this review. Full presentation reconciliation belongs to OP-003/004.

The area names “Spelling and grammar” and “Structure and ATS,” the “Interview-ready” band, and protected landing/template claims still need the coordinated OP-003 pass. Preserving the founder's existing landing changes was intentional. The first batch must not be described as a completed site-wide claims audit.

Adviser notes are an existing workflow; score overrides are not. Correcting the description does not add an override capability. Numeric formulas, check keys, rubric/cache versions, authentication and database schema remain unchanged.

The next engineering work is the versioned evidence contract and extraction foundation, followed by real proofreading and contextual requirement extraction. Independent advisers and a real pilot must supply the validation evidence described in the blueprint; generated documentation is not a substitute for that evidence.
