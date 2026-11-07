# Offerpath batch 04 report: OP-014, OP-016 and the tailoring half of OP-015

Prepared 7 November 2026 by Claude, for independent acceptance review by Codex. Worked in a shared uncommitted tree with other agents. Nothing was committed, pushed or deployed. No migration was written or applied, no live database was touched and no paid provider was called: `ANTHROPIC_API_KEY` was blank for every process, and provider output is simulated in every test.

## What this does and does not claim

A tailoring suggestion now changes nothing until the student keeps it. Each decision builds a real document, measures that document, and saves it as a new version beside the original assessment. Tailored text goes through the same fact check as a line rewrite on every path.

- It does **not** cover cover letters. OP-016's scope names the letter editor, and it was not changed (see "Task status").
- It has **not** been run against a real model or real PostgREST. Handling of provider output is tested; the model's response to the prompt is not. The atomic write is tested on the demo repository and the fake only.
- It does **not** re-score a CV review when a line is saved. The score is marked as being for the uploaded text. The student re-uploads to score it.
- The fact check is the OP-015 rule set, with its known gaps (see "Limitations"). OP-015's independent fidelity review under OP-011 has not happened.
- **A visible behaviour change:** an AI tailoring run used to apply itself to the tailored CV. It now produces suggestions only.

## Task status

| Task | Status | Notes |
|---|---|---|
| OP-014 | Implemented → Locally verified | Real versioned rescoring, hypothetical preview, student interpretation with provenance. |
| OP-015, tailoring path | Implemented → Locally verified | `checkTailorDraft` now uses the full check. `GROUND_RULES` fixed. Human gate still open. |
| OP-016, tailoring and line editors | Implemented → Locally verified | Diff, accept, edit, reject, undo, history, stale marking, conflicts, placeholder review, exports. |
| OP-016, letter editor | **Open** | Not changed. The register should treat OP-016 as partial until this is done. |

## Changed files

New:

- `src/lib/analysis/tailor-edits.ts`: versions, decisions, undo, restore, `tailoredExport`, `editView`. Pure.
- `src/lib/tailor-flow.ts`: the logic behind the actions, with the provider injected.
- `src/lib/analysis/word-diff.ts`: word difference.
- `src/app/tailor/[id]/TailorEditor.tsx`: the editing UI.
- `tests/tailor-edits.test.ts` (41 tests).

Modified, in files this task owns:

- `src/lib/analysis/claims.ts`: `buildClaimInventory(text, facts)`; claims and entries carry student-confirmed facts.
- `src/lib/analysis/rewrite-check.ts`: facts feed the checks; new `checkProfile`, `checkSkill`, `forTypedText`, `factsFromCheck`. With no facts, existing verdicts are unchanged, so `REWRITE_CHECK_VERSION` is not bumped.
- `src/lib/analysis/tailor.ts`: `checkTailorDraft` rebuilt on `checkRewrite`; `applyLineEdits` places edits by position and reports what it can't place.
- `src/lib/rewrite-flow.ts`: guarded writes, typed text, undo, facts. OP-025's job wrapper is kept.
- `src/app/actions/tailor.ts`, `src/app/tailor/[id]/TailorView.tsx`, `JobMatchPanel.tsx`, `page.tsx`, `src/app/reviews/[id]/lines/LineEditor.tsx`.
- `tests/rewrite.test.ts`: the verb assertion now expects `{ pass: 280, confirm: 0, block: 0 }`, was `{ pass: 272, confirm: 8, block: 0 }`.

Modified, in shared files (each re-read immediately before editing):

- `src/lib/types.ts`, `src/lib/report-schema.ts`: optional fields and a write-time check, `editProblems`. `PAYLOAD_VERSION` unchanged.
- `src/lib/repo/types.ts`, `demo.ts`, `supabase.ts`: `updateReport(..., { ifRevision })` and `ReportConflictError`.
- `src/lib/ai.ts`: `[12]` replaced in `GROUND_RULES`; `aiTailorCv` accepts `confirmedFacts`.
- `src/lib/analysis/lexicon.ts`: `WEAK_VERBS.helped`, "Organised" to "Supported". `LEXICON_VERSION` not bumped.
- `src/app/actions/cv.ts`: `acceptRewrite` options, `undoAccepted`.
- `src/app/api/tailor/[id]/route.ts`, `src/lib/cv-blocks.ts`: exports choose a version and refuse unreviewed blanks.
- `src/app/reviews/[id]/page.tsx`: a notice when saved lines aren't in the score.
- `tests/fixtures/fake-supabase.ts`: JSON-path filters, `.is`, rows returned from an update.
- `tests/fixtures/render-tailor.tsx`, `tests/security-tenancy.test.ts`: new actions added.

**Two test changes for Codex to check:**

- `tests/recovery-actions.test.ts` belongs to OP-025. One assertion, `good.tailoredCv && good.aiTailored`, encoded the old auto-apply. It is now `good.edits && good.aiTailored`. The rest of that test is unchanged and passes.
- `tests/engine.test.ts`: "tailoring never adds a number" now expects `Coordinated 4 society events for [X] students` to be kept, because the invented `200` is repaired to a blank, as a line rewrite does.

## Behaviour

**Versions.** `TailorPayload.edits` holds suggestions, an append-only list of versions, and one document record per distinct text with its own `JobMatch`. `jobMatch` and `matchNow` are never rewritten. `tailoredCv` and `matchTailored` are derived from the selected version, and null when nothing is kept. `toStored` refuses a payload where a document's hash, its assessment, the selected figures or a kept sentence disagree.

**Choosing is not evidence.** `toggleKeyword` changes only `added`, and no longer wipes a tailored CV. A preview is computed when the page is read, never saved, and labelled "Hypothetical, not saved". Rule-based prompts are labelled hypothetical and are in no document. A skill added to the list measures as "named only".

**Interpretation.** "Not relevant to me" records the requirement, the advert's category, the student and the time. The requirement stays in the list, the gaps and the number. Taking it back sets `withdrawnAt` and keeps the record. It only removes the requirement from the rule-based prompts.

**Fact checks on tailored text.** A blocked bullet is repaired with a placeholder if that is all it needs. Otherwise it is dropped and only a reason is kept. A profile is checked against the whole CV and is never repaired, because the sentence still claims what the CV doesn't show. A skill the CV doesn't name always needs confirming, and a qualification is refused. The server re-checks at acceptance, whatever the page sent. Instruction-like sentences are removed from what is sent to the provider.

**Provider failures.** A throw, a refusal, junk, the wrong shape or an all-blocked draft saves no generated text. With nothing to protect, the student gets prompts. With a good version, the attempt fails with OP-025's message and the payload is deep-equal to before. Generation stays inside OP-025's `runAnalysisJob`.

**Decision on student-confirmed facts and typed text.**

- A confirmation is stored with the decision that made it: on `acceptedCheck.facts` for a line, on the version's decision for tailoring. Provenance records who, how (confirmed or typed), the CV hash, validator, report and time.
- Withdrawing the decision withdraws the fact from the inventory. Tailoring versions keep the record in history. A line keeps it in its undo list.
- A fact is scoped to its line. Elsewhere in the same entry it is asked about; under another role it is blocked.
- A block stops a *model* asserting something. A student's typed words are their own statement, so factual blocks become named confirmations. Markup, instructions and bracketed claims stay refused.
- Facts are never evidence for a job requirement. Only words in the measured document count.
- Line facts feed tailoring. Tailoring facts do **not** feed the line editor (see "Unresolved questions").

**Conflicts and retries.** Writes carry `editRevision` in the `WHERE` clause of one `UPDATE`. A tab showing an older revision is refused with a reload prompt. Saves on different lines retry and both land. Attempt keys make a repeat harmless, without a second provider call.

**Stale results.** The page marks a version out of date if lines were saved in the CV review since (`base-changed`), the CV is gone (`cv-deleted`), or it was measured by an earlier method (`older-method`). The line editor and the review overview say the score is for the uploaded text.

**Exports.** The route serves `tailoredExport`: the selected version or `?version=vN`. Blanks not already in the student's CV give a 409 until filled or explicitly retained for that exact document. `myCvBlocks` now also places saved lines by position, fixing a first-match replacement.

**`WEAK_VERBS.helped`.** Suggestion text only (see "Validation").

## Validation

Final tree, `ANTHROPIC_API_KEY` blank:

| Command | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors, 1 warning (`tests/e2e/smoke.mjs`, not this task's) |
| `npm run test:engine` | 632 tests, 632 pass, 0 fail, run twice |
| `tests/tailor-edits.test.ts` alone | 41 pass |
| `tests/rewrite.test.ts` alone | 31 pass |
| `npm run test:db` | 96 passed. No SQL touched; run anyway |
| `git diff --check` | No output |
| `npm run diagnose:audit` | Exit 0 |
| `npm run diagnose:audit -- --check` | Exit 0, `GATES: 9 met, 0 unmet` |

The test count moves as other agents add tests. Earlier full runs showed two failures that were not this task's: `dismissFinding` in the session scan (OP-007, gone by the final runs), and "a hung provider ends inside the budget" once (OP-025; `tests/recovery*.test.ts` then passed 78 of 78, and both final runs passed). It looks timing-sensitive, and I didn't investigate it.

**Verb change.** A scratch script ran `analyseCv` in one process with the old and new lists, so other agents' edits couldn't affect the comparison: 13 CV/sector cases, 154 lines. Scores, areas, checks, line scores and `meta` (including the fingerprint) hash the same both ways, `ca5c9616…`. Initial suggestions differing: 0. A test repeats the comparison. Numeric moves from the parser bump are not assessed here; compare with that agent's report.

**Browser.** Run in an isolated copy under the scratchpad, in demo mode (`"mode":"demo"` in the boot log) with keys blanked, on port 3710. The server was stopped afterwards; nothing else was stopped. **In that copy only**, `actions/tailor.ts` used a simulated provider, so that one line differs from the reviewed file. Playwright, on the final UI apart from the accept-all change below:

- Invented "Google" not offered and listed as left out; "77%" became `[X%]`; no download before a decision.
- Accept showed both assessments, and the download returned 200.
- A stale tab was told to reload. "Led" kept Accept disabled until ticked.
- Blanks hid the download, and the route returned 409 until retained.
- Undo worked and survived reload. "Include" moved nothing, and "Not relevant" kept the number.
- Typed line asked for confirmation. In the line editor: typed text, reload and undo worked.
- 0px overflow at 390px, and no console errors.

This is a focused check, not an accessibility audit; no axe run. `npm run test:e2e` was not run. After the run, accept-all was changed to skip suggestions with blanks; that is covered by a unit test but was not re-run in the browser.

**Rule results.** The OP-015 fixtures in `tests/rewrite.test.ts` pass with the same false-rejection and missed-invention assertions, apart from the verb change above. There is no new measure of tailoring text; these remain the author's own fixtures.

## Limitations

- **Plain-word inventions still pass**, as OP-015 reported. Paraphrased instructions also pass.
- **A profile can't be tied to a role.** A figure in a profile only has to exist somewhere in the CV.
- **Other writers aren't guarded.** `proofreading-flow.ts` still writes the CV payload without `ifRevision`, so it could overwrite a line saved between its read and write.
- **The conditional write uses `.eq("payload->>editRevision", …)` and `.is(…, null)`**, which is unverified against real PostgREST.
- A placeholder near an outcome passes the check, as before. Accept-all skips it, but a single Accept doesn't ask about the outcome itself.
- A provider call can be spent and the result refused, if the report changes during the call.
- History is capped at 30 distinct documents per report, then the student is told to start a new one. Each line keeps 20 undo steps.
- The "Your tailored CV is still here" message also appears when only suggestions exist. The wording is pinned by OP-025's test.
- "Read this version" shows the text while blanks are unreviewed. The gate covers Copy and download, not reading.
- Reports with a `tailoredCv` but no `edits` keep the older read-only view until tailored again.
- The repository has no single-report delete, so `cv-deleted` was only tested by passing no CV. Tailor reports hold full CV text in each version; `deleteAccount` is the existing route for removing them, and the deletion tests were not extended for the new fields.

## Migration impact

**None.** Everything is optional fields inside `reports.payload`. Older rows read unchanged. No SQL file was added and none was applied.

## Checks Codex must rerun

1. The commands above, then `tests/tailor-edits.test.ts` alone with the `test:engine` flags.
2. The two test changes listed under "Changed files".
3. By reading: only `tailor-flow.ts` passes provider output on, and only through `checkTailorDraft`.
4. Your own adversarial drafts and typed text, especially facts moved between roles after a confirmation.
5. The conditional write against a real PostgREST, under an authorised scope.

## Unresolved questions for Codex or the founder

1. Who builds OP-016 for letters: here, or with OP-017?
2. Should tailoring confirmations carry to the line editor and other adverts? I kept them per report, because the blueprint asks for "explicit control" and no control exists yet.
3. Should the line editor offer a direct re-score of saved lines, rather than asking for a re-upload?
4. Should the proofreading writer move to `ifRevision`? It belongs to OP-007.
5. Should a figure from another entry be confirmable when typed? I allowed it, naming the entry it belongs to.
6. The OP-015 questions on Skills-section tools, "Helped organise" to "Organised" as confirm, the absolute landing strings and refunding blocked rewrites remain open. The `WEAK_VERBS.helped` question is closed.
