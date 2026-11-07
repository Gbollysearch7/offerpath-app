# Offerpath batch 05 report: OP-017, the letter half of OP-016, and the proofreading write defect

Prepared 7 November 2026 by Claude, for independent acceptance review by Codex. Worked in a shared uncommitted tree with the OP-018 LinkedIn agent. Nothing was committed, pushed or deployed. No migration was written or applied, no live database was touched and no paid provider was called: `ANTHROPIC_API_KEY` was blank for every process, and provider output is simulated in every test.

## What this does and does not claim

New cover-letter reports get a deeper, versioned assessment (`letter-review-2026-11-07.1`), and letters now use the same keep, edit, reject, undo and version model as tailoring. Every generated path goes through the OP-015 fact check. Old reports are read-only and keep their saved score.

- It is a **rule set**. It reads wording. It can't tell whether a reason is true or persuasive, and it misses facts written in plain lower-case words (see "Limitations").
- The weights, cap and length bands are **uncalibrated product judgments**. No adviser has reviewed them or the greeting and sign-off wording. The blueprint asks for that review, and it has not happened.
- It has **not been run against a real model or real PostgREST**. Handling of provider output is tested; the model's response to the changed prompt is not. Atomic writes are tested on the demo repository and the fake only.
- It does **not** look up employers. Facts about an employer can come only from the advert or the student's notes.
- The fixtures were written by the rules' author, so results show consistency with one person's idea of a hard case, not real-world accuracy. Strong letters, short statements and career changers have one or a few fixtures each, which is a sample and not the evaluation the blueprint describes.

**Visible behaviour changes for Codex to judge:**

- "Write an improved version" now adds suggestions to the same report, rather than creating a new report.
- An old report can't be edited in place. "Check as a new letter" makes an editable copy.
- A new letter can have no number (`score: null`) when under half the weight can be assessed, for example with neither an advert nor a CV.

## Task status

| Task | Status | Notes |
|---|---|---|
| OP-017 | Implemented → Locally verified | Human gate open: adviser review of the guidance, weights and rules. |
| OP-016, letter editor | Implemented → Locally verified | Provider path simulated only. |
| **OP-016, final** | **Implemented → Locally verified** | The tailoring and line editors were verified in batch 04, and the letter half is now done. The batch 04 limits on those editors still stand. |
| OP-015, letter paths | Implemented → Locally verified | Draft and improve. OP-015's independent fidelity review under OP-011 remains open. |
| Proofreading overwrite defect | Implemented → Locally verified | Failing test first, see "Validation". |

## Changed files

New:

- `src/lib/analysis/letter-review.ts`: `assessLetter`, the versioned assessment, and `letterReviewAssessment`.
- `src/lib/analysis/letter-content.ts`: version, weights, cap and wording. Client-safe.
- `src/lib/analysis/letter-check.ts`: the OP-015 check applied per sentence, employer facts, `checkLetterDraft`.
- `src/lib/analysis/letter-edits.ts`: versions, decisions, undo, restore, `letterExport`, `letterView`. Pure.
- `src/lib/letter-flow.ts`: the logic behind the actions, with the provider injected and an atomic write.
- `src/app/letters/[id]/LetterWorkspace.tsx`: the page for current reports.
- `tests/letter-review.test.ts`, `tests/letter-edits.test.ts`, `tests/proofreading-flow.test.ts`, `tests/fixtures/letter-cases.ts`, `tests/fixtures/render-letter.tsx`.
- This report.

Modified, owned by this task:

- `src/app/actions/letters.ts`: delegates to the flow; new actions, each checking the session.
- `src/app/letters/[id]/page.tsx`, `LetterDraftView.tsx`, `LetterReviewView.tsx`: the last two are now only for old reports, read-only, with the note.
- `src/app/letters/LetterStart.tsx`: format, word limit and employer notes on the review form.
- `src/lib/proofreading-flow.ts`: the atomic write.
- `src/lib/analysis/letter.ts`: **not changed.** `reviewLetter` stays as the record of the old method.

Modified, shared (each re-read immediately before editing, additive unless stated):

- `src/lib/types.ts`: letter types; optional fields on `CoverLetterPayload`. `PAYLOAD_VERSION` unchanged.
- `src/lib/report-schema.ts`: letter schemas and `letterProblems` in the write gate.
- `src/lib/services.ts`: **the bodies of** `buildLetterReviewPayload` and `buildLetterDraftPayload` are rewritten. CV and tailor paths untouched.
- `src/lib/ai.ts`: `aiDraftLetter` takes `wordLimit`, and its prompt now forbids employer facts from outside the advert and notes.
- `src/lib/analysis/job-match.ts`: `SHOWN_BY` exported. `src/lib/analysis/rewrite-check.ts`: one new issue code. Neither changes a verdict, so `JOB_SCORING_VERSION` and `REWRITE_CHECK_VERSION` are not bumped.
- `src/app/api/letters/[id]/route.ts`: serves `letterExport`, and returns 409 until gaps are reviewed.

**Tests changed that I did not write:**

| File | Change | Reason |
|---|---|---|
| `tests/payload.test.ts`, baseline test | The 67 is now asserted on `reviewLetter`, not `buildLetterReviewPayload` | The builder writes the new version. The same number still pins the old method; the new number is pinned in `tests/letter-review.test.ts`. |
| `tests/payload.test.ts`, keyword-check test | Renamed, and built with `oldLetterPayload` | It tests how old reports read. The assertions are unchanged. |
| `tests/fixtures/legacy-payloads.ts` | `legacyLetter` uses `reviewLetter` directly; adds `oldLetterFields` and `oldLetterPayload` | A builder can no longer produce the old shape. The OP-013 tailor fixture was changed the same way. |

`tests/recovery-actions.test.ts`, `tests/security-tenancy.test.ts` and `tests/engine.test.ts` are unchanged and pass.

## Behaviour

**Areas and weights.** Score = `100 x sum(weight x credit) / sum(weight)` over the areas that could be assessed, with no starting points.

| Area | Weight | Not assessed when |
|---|---|---|
| Why this employer | 20 | We hold nothing about the employer and the letter gives no specific reason |
| Why this role | 10 | Never |
| Technical and subject skills | 20 | No advert, or nothing countable |
| Interpersonal skills | 10 | No advert, or nothing countable |
| Relevant examples | 20 | Never |
| Consistent with your CV | 10 | No CV |
| Structure / Length / Clarity / Details | 3 / 2 / 2 / 3 | Never |

Under 50 assessed weight gives no number. A partial number says what it leaves out. A CV claim the CV doesn't back, a gap, the wrong name or no specific reason holds the number at 74, one below the "Strong" band, so a high number can't hide them.

**Motivation.**

| Verdict | Meaning | Status, credit |
|---|---|---|
| `specific_sourced` | Shares at least two specific words with what the advert or notes say about the employer. Links to that sentence | passed, 1 |
| `specific_personal` | The student's own contact or experience | passed, 1 |
| `specific_unverified` | Specific, but not in anything we hold | uncertain, 0.75 |
| `generic` | Take out the employer's name, the job title, the advert's skill terms and generic words, and under two specific words remain | needs attention, 0.25 |
| `absent` | No reason, with employer information available | needs attention, 0 |
| `information_missing` | No specific reason, and we hold only a name | uncertain, not counted |

No phrase is required, and "because" earns nothing.

**Skills.** Requirements come from `extractRequirements`, and CV evidence from `matchRequirements`. Each is `demonstrated`, `mentioned` or `absent`, with quotes from the letter, the advert and the CV at their real offsets. Hard and soft are shown and scored separately. A requirement the CV shows nothing for doesn't count against a letter that leaves it out, so nobody is pushed to claim it. Only the top 6 hard and 3 soft count (3 and 2 for a short statement), because a letter can't cover everything.

**Fact checks.** Each sentence goes through `checkProfile` with the application's own names masked. A name, figure or scope word said about the employer must be in the advert or notes, or it becomes `unsupported-employer-fact`. An advert asking for Tableau doesn't let "I used Tableau" through. Notes count as a source, and instructions inside them don't.

| Path | Block | Confirm |
|---|---|---|
| Provider draft | Repaired to a blank if possible, otherwise the sentence is removed and only the reason kept | Holds the download until reviewed |
| Provider suggestion | Same | Needs a tick to accept, re-checked on the server |
| Student typed | Becomes a named tick. Markup and links are refused | Needs a tick |
| Student's uploaded letter | Reported, never changed | Reported |

The greeting and signature on a generated draft are ours, so a model can't invent a recruiter or sign the wrong name.

**Editing.** The model is OP-016's: suggestions, append-only versions and one assessed document per distinct text. Writes carry `editRevision` in the `WHERE`, a stale tab is refused, and attempt keys make a retry harmless. A fact stands only while the decision that made it stands. Rule suggestions need no model: a blank for the reason, a word-for-word example from the CV, a sign-off and UK spelling.

**Length.** A limit in the advert, or one the student gives, decides first. Without one, 80 to 149 and 451 to 650 words pass with an explanation. Under 80 or over 650 asks the student to check. A form statement isn't asked for a greeting or contact block. Greeting and sign-off are phrased as optional guidance.

**Exports.** `letterExport` serves the selected version, or `?version=vN`. Brackets, `<...>`, `{{...}}`, "Your Name" and similar, a wrong signature, and unconfirmed generated claims give a 409 until the student fills them or keeps them for that exact document.

**Stale results.** The page marks `cv-changed`, `cv-deleted` and `older-method`.

**Old reports.** A report with no `review` renders its saved score and checks under `LEGACY_LETTER_NOTE`. Edit flows refuse it without writing. Only `saveLetter` can write, and it writes no score.

**Proofreading defect.** `languageFlow` wrote back the payload it read before checking, which could take time. It now re-reads, sets only `proofreading`, bumps `editRevision` and writes with `ifRevision`, retrying up to four times. If it keeps losing, the student is told and the results stay as they were. A CV tab holding an older revision is now refused after a language change, which is correct but new.

## Before and after

Same process, old `reviewLetter` against this version. The old numbers are what old reports keep. Pinned in `tests/letter-review.test.ts`.

| Fixture | Old | New | Motivation |
|---|---|---|---|
| `nameInserted`, employer name near "because" | 79 | 74 | generic |
| `conciseCredible`, short reason, no listed phrase | 66 | 97 | specific_sourced |
| `advertReason`, reason from the advert | 82 | 97 | specific_sourced |
| `inventedFact`, unsourced employer claims | 66 | 85 | specific_unverified |
| `mentionsOnly`, names skills, shows none | 85 | 56 | specific_sourced |
| `overclaims`, figure, tool, qualification not in the CV | 82 | 74 | specific_sourced |
| `shortStatement`, 43 of a 60-word limit | 40 | 84 | specific_sourced |
| `careerChanger`, limited experience | 77 | 75 | specific_sourced |
| Demo letter (`DEMO_LETTER`) | 67 | 66 | not pinned |

**Note for Codex:** `conciseCredible` reaches `specific_sourced` because its words overlap the advert. A concise reason with no overlap and no personal marker gets `specific_unverified` at 0.75, which doesn't fail it but is lower. `inventedFact` at 85 is still high: the claim is flagged and unconfirmed, but it isn't capped, because a student's own claim about an employer may be true.

## Validation

Final tree, `ANTHROPIC_API_KEY` blank.

| Command | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors, 1 warning (`tests/e2e/smoke.mjs:38`, not this task's) |
| `npm run test:engine` | 719 tests, 719 pass, 0 fail, exit 0 (final run) |
| `tests/letter-review.test.ts` alone | 27 pass |
| `tests/letter-edits.test.ts` alone | 26 pass |
| `tests/proofreading-flow.test.ts` alone | 3 pass |
| `npm run test:db` | 96 passed. No SQL touched by this task; run anyway |
| `git diff --check` | No output, exit 0 |
| `npm run diagnose:audit` | Exit 0 |
| `npm run diagnose:audit -- --check` | Exit 0, `GATES: 9 met, 0 unmet` |

Test totals include the LinkedIn agent's tests and can move. One mid-work subset run failed `every exported server action checks the session` on `src/app/actions/linkedin.ts: saveLinkedinSection`, that agent's file while it was in progress. It passed in the full runs after that.

**The defect, reproduced first.** `tests/proofreading-flow.test.ts` was run against the unfixed flow and all 3 tests failed. The key one read `demo: the saved line survives`, with `undefined` where `'Supported the team with weekly reporting in Excel.'` was expected. To reproduce, replace the `saveProofreading` call with the old unconditional `updateReport`.

**Browser.** Isolated copy at `/private/tmp/claude-501/-Users-gbolahan-Documents-NEW-ME-LevelUp/70ce5228-d909-41a7-b749-2bc52131c2e0/scratchpad/op017-app`, demo mode (`"mode":"demo"` in the boot log), keys blanked, port 3720, unmodified code at the time of the run. The server was stopped by its port afterwards; nothing else was stopped. The script is `op017-browser.mjs` beside that folder. Results:

- Review showed 38, the generic finding, separate skills and letter, advert and CV quotes.
- A kept sign-off survived reload. An edited reason took the score to 61 and showed "First version: 38".
- A second tab was told to reload. Undo restored the text.
- The download gave 200, then 409 with a blank (links hidden), then 200 once kept.
- A typed claim asked for a tick, and rule suggestions appeared.
- axe (WCAG 2 A/AA tags) on this page: 0 violations. 0px overflow at 390px.
- The only console error was the deliberate 409.

This is a focused check on one page, not an accessibility audit. **The AI path was not seen in a browser**, because the copy had no provider. **Old reports weren't seen in a browser**, because no demo path reaches one; the real views are rendered to HTML from stored payloads in tests. After the run, one fix went in for placing rule suggestions after a deletion, covered by a test and not re-run in the browser. `npm run test:e2e` was not run, and `next build` was not run.

## Limitations

- **Plain-word inventions pass**, as in OP-015. The `careerChanger` fixture says "after six years as a nurse", and it passes: "six" also appears elsewhere in that CV, and "nurse" matches no pattern.
- **Motivation is word overlap, not meaning.** A reason in entirely different words from the advert reads as unverified. A sentence can share two words with the advert and still say little.
- **Who a name is about is a heuristic** based on nearby "your" and "I". It can be wrong in long sentences.
- Sentence splitting stumbles on abbreviations such as "Ms.", and a sentence-initial proper name isn't caught unless it looks like a brand or acronym.
- Generated draft claims at confirm level are one review per document (the "I've checked these" button), not a tick per claim as on suggestions.
- Reviewing a CV-linked letter with no `cvReportId` falls back to the latest CV when improving, as the old code did.
- A provider call can be spent and the result refused if everything fails the check; the job records a failure, as OP-015's question on refunds notes.
- History is capped at 30 distinct documents per report, each with a full assessment, so a long-edited report's payload grows.
- The conditional write is unverified against real PostgREST, as in batch 04. `deleteAccount` removes reports, and its tests weren't extended for the new fields.
- The landing page wasn't inspected; its copy may describe the old letter checks.

## Migration impact

**None.** Everything is optional fields inside `reports.payload`, and `reports.score` is already nullable. No SQL file was added and none was applied.

## Checks Codex must rerun

1. The commands above, then the three test files alone.
2. The defect: restore the unconditional write and confirm `tests/proofreading-flow.test.ts` fails.
3. The three test changes listed under "Changed files".
4. By reading: only `checkLetterDraft` and `cleanGenerated` pass provider text on, in `generateDraft` and `improveLetterFlow`.
5. Your own adversarial letters, especially generic sentences with unusual words, and facts about the employer in plain words.
6. Whether 74 is the right cap, and whether `inventedFact` at 85 is too high.
7. The conditional write against a real PostgREST, under an authorised scope.

## Unresolved questions for Codex or the founder

1. Are the weights, the 50-weight minimum, the cap and the length bands acceptable before adviser calibration?
2. Who reviews the greeting, sign-off and length guidance? The blueprint requires a careers adviser.
3. Is a read-only old report with an editable copy acceptable? I chose it because it's the only way an old score stays byte-identical.
4. Should "Write an improved version" stay on the same report, as built, rather than making a new one?
5. Should an unsourced claim about the employer in a student's own letter affect the number more than it does?
6. Should confirmed letter facts carry to the CV or to other letters? They stay on the letter's version here.
