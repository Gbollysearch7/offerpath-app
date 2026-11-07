# Offerpath batch 03 report: OP-008 contextual dismissal and terminology

Prepared 7 November 2026 by Claude, for independent acceptance review by Codex. Nothing was committed, pushed, deployed or migrated. No live database was touched and no paid provider was called. The migration below is **not applied**.

## Task status

| Task | Status | Notes |
|---|---|---|
| OP-008 — contextual dismissal and terminology handling | **Implemented → Locally verified** | "Reviewed terminology" is structurally in place, but **no adviser has reviewed any list**. That human gate stays open. |

## What this does and does not claim

**Does:** on the spelling check page a student can dismiss any proofreading suggestion for one document and reopen it, and both survive a refresh. They can choose UK or US English. That re-checks this CV and applies to their next ones. Regional suggestions say the spelling is valid. Listed official names are never flagged, in either English. Every choice goes in an append-only history marked as the student's, shown in the panel and included in the data export. Account deletion removes it.

**Does not:**

- Change any score, analysis, fingerprint, `RUBRIC_VERSION` or dictionary.
- Change the scored `spell` check. A student who picks US English can see no regional suggestions in the panel and still see that check's lower score (4/10 in the browser run). This is required by the invariant that the same CV gets the same score, but students may find it confusing. See unresolved question 1.
- Carry a dismissal to changed text. Any edit makes a new document, so correct words come back after a re-upload with changes (question 2).
- Show that an adviser reviewed the terminology. `TERMINOLOGY_REVIEW.adviserReviewedBy` is `null`, a test holds it there, and `docs/CONTENT_REVIEW.md` has an unticked row.
- Show dismissals to advisers. No policy or repository method exposes them. Advisers can still see findings wherever they can see the report payload, as before.
- Protect official names beyond the 28 listed. Any other capitalised name opening a bullet can still be raised, and the student can dismiss it.
- Add proofreading to letters, adverts or LinkedIn text.

## Changed files

**New**
- `src/lib/analysis/proofreading/choices.ts`: types, row builder, state derived from history, history wording
- `src/lib/proofreading-flow.ts`: dismiss, reopen and language logic
- `src/app/actions/proofreading.ts`: `dismissFinding`, `reopenFinding`, `setProofreadingLanguage`
- `src/app/reviews/[id]/checks/[check]/ProofreadingControls.tsx`: the buttons and language form
- `supabase/migrations/20261107190000_proofreading_choices.sql` (not applied)
- `tests/dismissal.test.ts` (20 tests)

**Edited, owned by this task's scope**
- `src/app/reviews/[id]/checks/[check]/ProofreadingPanel.tsx`
- `src/lib/analysis/proofreading/view.ts`: `proofreadingHeadline` and `proofreadingSummary` take dismissals; adds `regionalExplanation`
- `src/lib/analysis/proofreading/terminology.ts`: `OFFICIAL_NAMES`, `officialNameSpans`, `TERMINOLOGY_REVIEW`; version now `terminology-2026-11-07.1`
- `src/lib/analysis/proofreading/run.ts`: drops findings inside official names; `proofreadCv` takes the student's language
- `src/lib/analysis/proofreading/settings.ts`: comment only

**Edited, shared, small**
- `src/lib/repo/types.ts`, `demo.ts`, `supabase.ts`: three repository methods
- `src/lib/cv-flow.ts`: one line, passes the preference
- `src/lib/rate-limit.ts`: two limits
- `src/app/api/export/route.ts`: `proofreading-choices.json`
- `src/app/reviews/[id]/page.tsx`: overview summary
- `src/app/reviews/[id]/checks/[check]/page.tsx`: passes choices to the panel
- `src/app/legal/privacy/page.tsx`: one clause in the deletion sentence. **Legal wording, not reviewed by a lawyer.**
- `tests/fixtures/fake-supabase.ts`, `supabase/tests/schema.test.mjs`, `supabase/tests/security.test.mjs`
- `docs/CONTENT_REVIEW.md`, `docs/OPERATIONS.md`, `docs/DEPLOY.md`

**Not edited by this task:** `rubric.ts`, `judgment.ts`, `fingerprint.ts`, `cv.ts`, `lexicon.ts`, `parse.ts`, `extract.ts`, `document.ts`, `ai.ts`, `scripts/calibrate.ts`, `src/app/_landing/`.

## Behaviour

**Document scope.** A document is the user id plus the sha256 of the text, which is the `documentVersion` the report already records. The same text scored again by the same student shows the same dismissals. Changed text, or the same text on another account, shows none (tested).

**Finding ids.** The key is OP-007's `category:rule:word`, so one dismissal covers every place that word appears in the document. A dismissal stays recorded if the language changes and the finding disappears, and applies again if the student switches back.

**Dismissal never reads as a clean result.** With every typo dismissed, the headline reads "No likely typos left to look at. That doesn't prove your spelling is correct. You've dismissed 2 suggestions on this CV." The overview reads "No likely typos left, 2 dismissed".

**Language.**

| Case | Result |
|---|---|
| Student has made no choice | `PROOFREADING_LANGUAGE`, otherwise en-GB |
| Student picks another English | Re-runs proofreading, replaces only `payload.proofreading`, records a `language` choice |
| Same English again | No write and no history entry |
| Re-check returns unavailable | Error shown, report unchanged, nothing recorded (tested) |
| Reading the preference fails during scoring | Report is still made, with the default language (tested) |
| Report has no proofreading (older report) | Refused, and no language form is shown |

**Regional wording.** The per-finding message from OP-007 is unchanged ("is a valid US spelling, so this is a preference rather than a mistake"). The panel adds `regionalExplanation`. Tests check both directions against `/misspell|incorrect|\bwrong\b|\berror\b|\btypo/i`.

**Official names.** The filter is in `run.ts`, so it applies to any provider, including the inactive LanguageTool adapter (tested with a fake provider). Matching is case-sensitive: "department of defense" in lower case is still raised (tested). Control: "Center of the" opening a bullet is raised, and "Center for Disease Control" is not.

**Global lists.** `TERMINOLOGY` and `OFFICIAL_NAMES` are code constants. Choices live in one table scoped to a user. A test hashes the list before and after dismissals, and static checks confirm the scoring and engine modules don't import choices, and the choices modules don't import the lists.

**Ownership.**

- The client sends only a report id and a finding id or language.
- The repository reads the report under the signed-in user and takes the document version and quoted word from it. A foreign report or an unknown finding throws `ChoiceNotFoundError` and saves nothing.
- Writes use the service role, so a database trigger also requires the report to be the user's and about that document.

## The schema

`public.proofreading_choices`: `id`, `user_id` (cascade from profile), `report_id` (cascade from report), `document_version`, `kind` (`dismiss`, `reopen`, `language`), `finding_id`, `quote`, `language`, `actor` (check: only `student`), `created_at`.

- **History:** updates are refused by a trigger, even for the service role. Rows leave only by cascade.
- **State:** the latest dismiss or reopen per finding. The language preference is the latest `language` row, so `profiles` and `Profile` are unchanged.
- **RLS:** enabled, with a read-own policy only. Insert, update and delete are revoked from `anon` and `authenticated`, the same pattern as `cv_sources`.

**`PAYLOAD_VERSION` is unchanged.** No payload field was added.

## Validation: commands and actual results

Run on the shared tree between about 00:57 and 01:00 on 7 November 2026, with other agents editing it. Engine tests and typecheck are from 01:00.

| Command | Result |
|---|---|
| `npm run typecheck` | **Pass**, exit 0, 0 errors. Earlier runs showed errors only in other agents' in-progress files (`scripts/calibration/metrics.ts`, `src/lib/report-schema.ts`). |
| `npm run lint` | **Pass**, exit 0: 0 errors, 1 warning. |
| `npm run test:engine` | **Pass at 01:00: 630 of 630, 0 failed, exit 0.** Other agents' tests are in this total. Earlier runs failed in other agents' files; see below. |
| `tests/dismissal.test.ts` alone | **20 of 20 pass.** |
| `npm run test:db` | **Pass**, exit 0: schema 274 PASS, 0 FAIL; security "96 passed". |
| `git diff --check` | Clean, exit 0. New code files checked separately for trailing whitespace. |
| Numeric baseline (OP-007's script, copied to the scratchpad) | `7cfec3a0082afd06ac2cb9aee7f06ea52e9a232e2cae3744590087e520500865`, the same as OP-007's. The parser bump may move this later; that wouldn't come from this task. |
| `npm run eval:proofreading -- --json` | Byte-identical before and after this task's code (`cmp`), so the official-name filter moved no held-out figure. Fixture hashes match OP-007's. |

**Earlier engine failures, gone by the final run without any edit from me:**

- `tailoring never adds a number the CV doesn't have` (`tests/engine.test.ts:240`) failed from 00:55, including isolated reruns, and passed from about 00:58. `tailor.ts` and that test are OP-014/016 work, and `tailor.ts` was edited at about 00:52.
- `tailored CV: a good AI version survives an outage and a spent limit, and the error says so` (`tests/recovery-actions.test.ts`) failed once at 00:57 and passed in the 01:00 full run and two isolated reruns. I didn't find the cause. It may be another agent's edit in progress or an intermittent failure, so please watch for it.

An import walk (`closure.py`) over `cv.ts`, `letter.ts`, `job.ts`, `job-match.ts`, `rubric.ts`, `judgment.ts`, `fingerprint.ts`, `tailor.ts` and `scoring-core.ts` found 24 files, none of them changed by OP-008. It's a regex walk, not a bundler trace. It covers the static imports of those number-bearing modules, not the tailored-CV action path.

**A failure I caused and fixed:** the existing test "every exported server action checks the session" failed because my actions called `getRepo()` in a helper. I moved the call into each exported action.

**Mutation check.** 16 deliberate faults were applied one at a time to a scratch copy, running `tests/dismissal.test.ts` each time. The first run caught 15. "Dismissals across documents" survived, so I added a test, and the second run caught all 16. Script: `mutate.py` in the scratchpad folder below.

**Browser.** Isolated copy, `next dev -p 3508`, boot log `"mode":"demo"`, all keys blanked, no `.env` copied, `node_modules` symlinked, own process stopped afterwards. `next build` not run. Results and screenshots are in `/private/tmp/claude-501/-Users-gbolahan-Documents-NEW-ME-LevelUp/70ce5228-d909-41a7-b749-2bc52131c2e0/scratchpad/batch-03/op-008/` (`browser-results.json`, `panel-*.png`, `spell-390.png`).

| Step | Result |
|---|---|
| Real paste flow | Readiness Score 81, check score 4/10; marks custmer, metronidazole, color, labor; "Center" in the Center for Disease Control line not marked |
| Dismiss metronidazole, then reload | Survives; history line present; focus moved to `proofreading-status` |
| Dismiss the typo too | Scores unchanged (81, 4/10); overview "No likely typos left, 2 dismissed" |
| Reopen, then reload | Word back among the open findings; history line present |
| Choose US English, then reload | Radio persists; color and labor gone; score still 81; history line present |
| Next CV | US English already selected |
| Second account | 404 on the first student's page; own report of the same text has all four marks, no dismissals, no history, UK English |
| Export | 200; `languagePreference` en-US; kinds dismiss, dismiss, reopen, language; actor student |
| **axe**, tags wcag2a, 2aa, 21a, 21aa, 22aa, with `details` open | **0 violations** on the initial, dismissed, US and 390 px states. A page check, not a formal accessibility audit. |
| **390 px** | **No overflow** (scrollWidth 390, clientWidth 390); panel buttons 44 px |
| Console | One error: the expected 404 from the second-account step |

The browser run predates the refactor that moved `getRepo()` into each action. Action tests cover that edit, but the page itself wasn't re-run on it.

## Limitations

- **The Supabase repository has not run against a real database.** It's tested over the in-memory fake, and the migration separately in PGlite. Nothing sends the repository's actual insert to the migrated table, so a column-name mismatch would only show at integration.
- **Fake limits:** the fake models report ownership but not the document-version check, immutability or RLS. Those are tested only in `schema.test.mjs`.
- **Language change is read-modify-write on the payload.** A line edit saved at the same moment could be lost. `updateReport` already has this pattern, but this adds another caller.
- **Partial language change:** the choice is recorded before the report is saved. If the save fails, the history says the student chose it and the report stays in the old language. Repeating the choice completes it.
- **History ordering** relies on `created_at`. Two writes in the same microsecond could tie.
- **History scope:** the panel shows the current document's choices across all reports of that text. Deleting a report cascades its rows, including dismissals another report of the same text was relying on. No delete-report path exists in the repository today.
- **Quoted words:** the history stores the student's quoted word, which can be a name or drug term. It is exported and deleted with the account.
- **Rate limits:** 120 choices and 20 re-checks per 10 minutes per student. No-op repeats count. The numbers are my judgement, not measured.
- **Re-check timing:** runs the local dictionary in the request, measured by OP-007 at p95 385 ms.
- **Requires JavaScript:** the buttons won't work without it.
- **`OFFICIAL_NAMES`:** chosen by me and unreviewed.

## Migration impact

One new migration, `20261107190000_proofreading_choices.sql`, named after every existing file (last was `20261107180000_analysis_jobs.sql`, re-listed immediately before naming). **Not applied anywhere.** It adds one table and two trigger functions, and alters nothing existing.

**Apply it before the code ships.** The spelling page and overview read this table without a fallback, so they would fail without it. Only the preference read during scoring tolerates its absence.

## Checks Codex must rerun

1. `NODE_OPTIONS=--conditions=react-server npx tsx --tsconfig tsconfig.json --test tests/dismissal.test.ts tests/security-tenancy.test.ts`.
2. `npm run test:db`, and read the "proofreading choices (OP-008)" section of `supabase/tests/schema.test.mjs`.
3. `npm run test:engine`, watching `tests/recovery-actions.test.ts` in particular, which failed once and then passed.
4. Your own baseline capture, then `cmp` of `eval:proofreading -- --json` against `eval-before.json` in the scratchpad.
5. Run the repository against a real migrated database in an authorised session. This is the largest unverified item.
6. Confirm a dismissal can't reach a score: search for `proofreadingChoices` and `proofreading_choices` under `src/`.

## Unresolved questions

1. **Founder: US English and the scored `spell` check.** A US-English student still loses points on the variant list, because the score has to be the same for the same CV. Keep and explain it, or remove regional variants from the core score under a rubric change with OP-010/011 calibration?
2. **Founder: should dismissals carry to a new version of the same CV?** I kept the strict reading: same text only. Uploads have no link to earlier uploads, so carrying them needs a design decision. Carrying them across corrections alone would be possible.
3. **Adviser:** review `TERMINOLOGY`, `OFFICIAL_NAMES` and the regional wording, then record the name and date in `TERMINOLOGY_REVIEW`.
4. **Lawyer/DPO:** check the one-clause privacy notice change. Dismissal history is new personal data, kept for the life of the account.
5. **Founder: should advisers see dismissals?** Currently they can't. An adviser may want to know a student set a real typo aside, but students may be less willing to use the feature if they're watched.
