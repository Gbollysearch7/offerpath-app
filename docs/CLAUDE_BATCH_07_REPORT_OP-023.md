# Offerpath batch 07 report: OP-023, interview practice from application evidence

Prepared 7 November 2026 by Claude, for independent acceptance review by Codex. Worked in a shared uncommitted tree alongside OP-027 and OP-029, so totals can move. Nothing was committed, pushed or deployed. No migration was applied and no live database was touched. No paid provider was called. `next build` was not run, and no dev server ran in this directory.

**Status: Implemented → Locally verified. The adviser evaluation gate is open.** No adviser has seen the questions, the feedback wording or the thresholds. The migration is **not applied anywhere**.

## What this does and does not claim

For a tracked role, a student chooses a CV version. Rules then write questions from that exact text and the advert's requirements, each with a reason. A written answer gets feedback that separates shape from content, and is saved privately on the application. General practice still works with no application.

- **It reads wording only.** It can't tell whether an answer is true or correct. It doesn't check that a technical answer is right. A determined student can get past it with real-looking words, as the limits below show.
- **Not a coach and not a predictor.** The page, the feedback and the help text say so. It holds no mark, and no number comes out of it.
- **The thresholds are uncalibrated product judgments:** 8 and 12 unique content words, 3 per concrete sentence, and the stock word list. No fixture here came from a real student or was labelled by an adviser.
- **The model pass has only run against simulated replies.** The prompt has never reached a real model. Only how its output is handled is tested.
- **Not run against real PostgREST or Supabase.** RLS, triggers and cascades ran in PGlite. Repository code ran over the in-memory fake.
- **No accessibility conformance is claimed.** axe found 0 violations on the screens listed, which is a local check, not an audit.
- **No score moves.** No scoring, rubric, judgment or fingerprint file was touched. In `src/lib/analysis/` only `job-state.ts` changed, with one added workflow name. A test deep-compares the reports and links before and after practising.

**Visible behaviour changes for Codex to judge:**

1. **The "X/10 for structure" mark is gone from the page.** It gave credit for STAR-sounding words. `starFeedback` stays exported and unchanged, its numbers are the same and `tests/practice.test.ts` is untouched, but nothing in the app calls it. I read "no score may change" as covering this function's output and the CV and job scores. If it also means this mark must stay on screen, that's a conflict with "STAR-sounding words alone don't earn credit", and needs a decision.
2. **The page used to say "nothing is saved". Answers are now always saved,** including general practice. The student is told before they press the button and can delete any answer. There's no "don't save" option.
3. **"Keep this version" now has a second entrance.** Choosing a version for practice writes the same `application_links` record as the dashboard's control, so it changes what the dashboard shows as kept, and can put a CV on an application that had none.
4. **The dashboard application card has a new row** with the count, date and version of practice, and a link.

## Task status

| Task | Status | Notes |
|---|---|---|
| OP-023 | Implemented → Locally verified | **Human gate open: adviser evaluation.** Listed in `docs/CONTENT_REVIEW.md`. |
| OP-019: interview practice clause | Implemented → Locally verified | Closes what [the OP-019 report](CLAUDE_BATCH_06_REPORT_OP-019.md) left Open (FD-67). I did not edit `docs/STATUS_REGISTER.md`, which still says Open. |

## Changed files

New, owned by this task:

- `src/lib/practice-types.ts`: saved shapes, `summarisePractice`. Client-safe.
- `src/lib/practice-questions.ts`: `generalQuestions`, `groundedQuestions`, `questionsFor`. Pure.
- `src/lib/practice-feedback.ts`: `practiceFeedback`, `withModelNotes`. Pure.
- `src/lib/practice-schema.ts`: `checkPracticeInput`, the write gate both repositories use.
- `src/lib/practice-flow.ts`: `resolveGrounding`, `submitPracticeFlow`, `approveVersionFlow`, `deleteAnswerFlow`.
- `src/app/actions/practice.ts`.
- `src/app/practice/interview/FeedbackView.tsx`, `ApproveVersion.tsx`, `saved/page.tsx`, `saved/DeleteAnswer.tsx`.
- `supabase/migrations/20261108110000_practice_answers.sql`: **unapplied**.
- `tests/practice-feedback.test.ts` (23), `tests/practice-flow.test.ts` (34), `tests/practice-provider.test.ts` (3).

Modified, owned by this task: `src/app/practice/page.tsx`, `src/app/practice/interview/page.tsx`, `InterviewPractice.tsx`, `src/lib/practice.ts` (one comment only).

Modified, shared (each re-read immediately before editing, additive):

| File | Change |
|---|---|
| `src/lib/repo/types.ts`, `demo.ts`, `supabase.ts` | `practiceAnswers`, `savePracticeAnswer`, `deletePracticeAnswer`; AI kind `practice` with limits of 20 |
| `src/lib/analysis/job-state.ts` | `PRACTICE_WORKFLOWS` |
| `src/lib/ai.ts` | `aiPracticeFeedback`, `practicePrompt`, `PRACTICE_RULES`, at the end of the file |
| `src/lib/rate-limit.ts` | `practiceAnswerPerUser` |
| `src/lib/applications/types.ts` | One comment |
| `src/app/api/export/route.ts` | `interview-practice.json` |
| `src/app/dashboard/page.tsx`, `ApplicationsPanel.tsx` | The practice row |
| `src/app/help/page.tsx`, `src/app/privacy/page.tsx`, `src/app/legal/privacy/page.tsx` | One answer; a few words each. **The legal text has had no legal review.** |
| `docs/OPERATIONS.md`, `docs/CONTENT_REVIEW.md`, `docs/RELEASE_RUNBOOK.md` | One row each |

**Tests I changed that I did not write.** No existing assertion was edited or loosened.

| File | Change | Why |
|---|---|---|
| `tests/fixtures/fake-supabase.ts` | Additive: a `practice_answers` table, `nullOnDelete`, two report cascades, the account cascade | The fake throws on a table it doesn't model |
| `supabase/tests/schema.test.mjs` | Additive: one block of 36 checks | The brief asks for schema tests to be extended |

## Behaviour

**Which CV.** A version counts as approved only if the student kept it on the application: `application_links.document_version`. A kept tailored version is looked at first, then a kept CV. With nothing kept, no question appears and the page asks. A version with unfilled blanks can't be chosen. If a kept CV's words are no longer held, because lines changed after keeping, the student is asked again rather than given questions from different text.

**Which requirements.** From the tailored version's own saved match when there is one, otherwise re-measured against the chosen text. A role with no tailored report uses its listing. With no advert the page says so, and only CV and motivation questions appear.

**Questions.** Rules only: no model writes a question or a reason.

| Source | Asked | Left out |
|---|---|---|
| Essential or desirable, with evidence | Quotes the CV. Wording differs for tools, qualifications and others | |
| Named only in a list | "Your CV names X, but doesn't say…" | |
| Essential or desirable, no evidence | Says the CV doesn't show it. Tip: keep to what's true | |
| The role | Why this role at this employer | |
| CV lines | Up to three, lines with figures first | |
| | | Eligibility and location; requirements the student marked as not applying; text that reads like instructions |

Every quote is checked as word for word in its source, or dropped. The student can pick an objective: all, essential, gaps, CV or motivation.

**The server finds the question again.** The page sends only the application id and question id. The saved question, quotes and reason come from the student's own records, so a forged request can't save a question that misquotes a CV.

**Feedback.** No overall mark.

| Section | What it says |
|---|---|
| Substance | `little`, `some` or `concrete`, with the details picked out. STAR words, stock phrases and the question's own words count for nothing |
| Contribution | `clear`, `mixed`, `shared` or `unclear`, with the student's sentences quoted |
| What the question asked | Each part, found or not found |
| Claims to check | Figures, names, qualifications and lead words not on the chosen CV, worded as "if it's true, be ready to explain it", never as false. Claims with nothing behind them in the same sentence. General practice says nothing was compared |
| Ways to be clearer | Fixed text, with no example experience |
| Structure | Situation, task, action, result, labelled as not a mark. A template can tick all four and still be `little` |

**Model pass, optional.** With no key it isn't attempted, and everything above still works. When on, it can only add a comment tied to a verbatim quote from the answer, or mark a part as not answered. It can't raise substance, tick a part, change structure or remove a claim. A comment must pass `explanationIsSafe` with its words limited to the student's text and a closed list, and must avoid a list of praise, verdict and person words. It runs through `runAnalysisJob`, with its own daily limit. Failure of any kind leaves rules feedback, saved, with the use given back.

**Privacy.**

- **Staff:** no adviser or admin policy, no database function reads the table, and no staff repository method exists. A test lists every file that reads answers. The dashboard gets counts and hashes only.
- **Export:** `interview-practice.json` in "Download my data".
- **Deletion:** the student can delete any answer. Account deletion by any route cascades, and the erasure ledger records it. Removing a CV or advert report takes answers that quote it.
- **Retention:** no separate period. Answers live as long as the account, and go when an inactive account is deleted. Saving an answer counts as activity, so someone practising isn't deleted as inactive.
- **Stopping tracking:** keeps the answer, with its role label, and drops the link.
- **Immutable:** the database refuses edits, even from the server, apart from the foreign key letting go.

## Validation: commands and actual results

Run on 7 November with `ANTHROPIC_API_KEY` blank. One disclosure: `tests/practice-provider.test.ts` imports the existing `tests/fixtures/provider-stub.ts`, which sets a dummy key (`test-key-never-sent`) inside that test process and replaces `fetch`, as several existing tests do. Nothing leaves the process.

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0, no output |
| `ANTHROPIC_API_KEY= npm run test:engine` | **1005 tests, 1005 pass, 0 fail**, 0 skipped. Includes 60 new |
| `npm run test:db` | **489 PASS, 0 FAIL**, exit 0. Includes 36 new |
| `git diff --check` | exit 0. New files also checked for trailing whitespace: none |

**Browser, in a scratch copy** (`op023-app`, port 3923, demo mode, keys blank, `next dev`, stopped afterwards). Chrome through `playwright-core`, 1280px and 390px, WCAG 2 A, AA and 2.2 AA rules:

| Screen | axe violations (1280 / 390) | Horizontal overflow at 390 |
|---|---|---|
| General practice | 0 / 0 | none |
| General, template feedback | 0 / 0 | none |
| Choose a version | 0 / 0 | none |
| Questions for a role | 0 / 0 | none |
| Feedback for a role | 0 / 0 | none |
| Objective changed | 0 / 0 | none |
| Dashboard with the practice row | 0 / 0 | none |
| Saved answers, opened | 0 / 0 | none |
| Saved answers, after a delete | 0 / 0 | none |
| Practice home | 0 / 0 | none |

Also seen in that run: no question before a version was chosen; the template answer read "Not much to go on yet" with no mark; the dashboard row; delete; the export held the file; the answer box reachable by Tab; no console or page errors. After that run only tests and a type annotation changed.

**One browser check proves nothing and isn't counted:** the second student was redirected to onboarding, so never reached the saved page. Cross-student access rests on the repository and PGlite tests.

The browser found one real defect the tests hadn't: a degree was asked about as "how you've used it". Fixed, with a test.

**Mutation checks, in the scratch copy.** 24 deliberate breaks, each undone after its run:

- **Caught first time (16):** quote not checked against the answer; comment fact check removed; CV claims never compared; question not re-found on the server; unchosen version used; not-relevant choice ignored; eligibility asked; Supabase read unscoped; export omits answers; answers deleted on stop tracking; RLS opened; no owner trigger; not immutable; no activity trigger; no account cascade; both stock filters off.
- **Missed at first, tests added, then caught (6):** question's words counting as evidence; praise filter removed; instruction-like quotes repeated; Supabase ownership check removed; demo ownership check removed; write gate off.
- **Still not caught alone (2):** removing either one of the two stock-word filters. Each covers for the other. Removing both is caught by 7 tests.

Logs: `/private/tmp/claude-501/-Users-gbolahan-Documents-NEW-ME-LevelUp/70ce5228-d909-41a7-b749-2bc52131c2e0/scratchpad/op023-browser.txt`, `op023-mutate.txt`, `op023-mutate2.txt`, `op023-engine.txt`, `op023-db.txt` in the same folder. That folder is temporary, so the script is `op023-mutate.py` there too.

## Limitations

- **Padding beats the rules.** Unrelated real-looking words raise the content count, and a stray name or number counts as a detail. Whether that is common is unknown.
- **Paraphrase is missed both ways.** A part answered in unusual wording reads as not found. `topic` only checks that there are 5 content words, not that they're on topic.
- **Contribution reads grammar.** "I" followed by a verb counts as an act, and it can't tell a true "I" from a claimed one.
- **`not_on_cv` is a capital-letter and figure rule** inherited from OP-015, so plain lower-case new claims get through. It also flags true things the CV just doesn't mention, such as "Leeds" in the browser run. The wording allows for that.
- **A checked model comment can still mislead.** Its words are limited, not their meaning.
- **Static general questions have no adviser review,** and "typical" is an unreviewed claim.
- **A kept CV can't be recovered from older text.** A changed CV means choosing again.
- **Concurrency is untested** beyond the idempotency key on the demo repository and the fake.
- **An answer is capped at 4,000 characters,** as the old text box was.

## Migration impact

`supabase/migrations/20261108110000_practice_answers.sql`, **not applied anywhere**, last in the listing taken just before naming and again at the end. Run after `20261108100000_erasure_ledger.sql`.

- **Adds** `practice_answers`, with RLS on and one policy: a student reads their own. Writes are revoked from `anon` and `authenticated`. Ownership and immutability triggers, and the existing `touch_activity`.
- **Widens** `analysis_jobs` workflow and charged kind checks and `ai_usage` kinds, and replaces `bump_ai_usage` to allow `practice`.
- **Apply before the code.** Without it, the dashboard, interview practice and "Download my data" fail, because they read the table. There's no fallback, as with OP-019. Added to `docs/RELEASE_RUNBOOK.md`.

Existing data isn't touched.

## Checks Codex must rerun

```
npm run typecheck && npm run lint
ANTHROPIC_API_KEY= npm run test:engine
npm run test:db
git diff --check
ANTHROPIC_API_KEY= NODE_OPTIONS=--conditions=react-server npx tsx --tsconfig tsconfig.json --test tests/practice.test.ts tests/practice-feedback.test.ts tests/practice-flow.test.ts tests/practice-provider.test.ts
```

Worth trying by hand: write your own empty STAR answers, and try to get `concrete` without saying anything. I expect padding to succeed. In the demo, track a role, and check that each question's quote and reason match its CV and advert.

## Unresolved questions for Codex or the founder

1. **Adviser evaluation (the human gate):** do the questions help, is the wording right, and where should the thresholds sit?
2. **The X/10 mark:** is removing it from the page acceptable, and should the now-unused `starFeedback` be deleted? That would mean editing a test I didn't write, so I left it.
3. **Always saving:** should a student be able to practise without saving? The brief says answers are saved, so I gave no opt-out.
4. **Retention:** should answers expire sooner than the account? They can quote a CV and may hold sensitive personal stories. This is for the founder and DPO. The privacy wording also needs legal review.
5. **Register:** `docs/STATUS_REGISTER.md` and FD-67 still show the OP-019 clause as Open, pending this review.
6. **Stale label, not changed:** `src/app/dashboard/page.tsx` still lists "Interview practice" under "COMING LATER" in a side panel, near line 113. It predates this work. I left it to avoid colliding with OP-027.
7. **For OP-027:** `/practice/interview/saved` and a role's practice page aren't in `tests/e2e/sweep.mjs`, which I didn't edit.
8. **Sub-processors:** answers go to Anthropic when AI is on. I updated the privacy pages but not `src/app/legal/sub-processors/page.tsx`, which should be checked in legal review.
