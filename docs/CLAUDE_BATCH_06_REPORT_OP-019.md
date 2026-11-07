# Offerpath batch 06 report: OP-019, link application artefacts and prioritise useful actions

Prepared 7 November 2026 by Claude, for independent acceptance review by Codex. Worked in a shared uncommitted tree with the OP-018 LinkedIn and OP-020 sharing agents. Nothing was committed, pushed or deployed. No live database was touched and no paid provider was called: `ANTHROPIC_API_KEY` was blank for every process, and provider output is simulated in every test. `next build` was not run, and no dev server ran in this directory.

**Status: Implemented → Locally verified**, except the interview-practice clause below, which is **Open**. No human or operational gate was passed. The migration file is **not applied** anywhere.

## What this does and does not claim

The dashboard now shows, for each tracked role, the CV, tailored CV and letter that belong to it, which version each is, and whether what the student downloaded holds that version. It also shows a short ranked list of what to do next, which can be dismissed with a reason.

- **Interview practice is not linked. The register's build line names it, and this part is Open.** Practice answers aren't saved anywhere today (`src/app/practice/interview/` never calls the repository), so there is no version to connect. OP-023 needs to save them first.
- **"Downloaded" means the server handed over the file.** It can't know the file arrived or is still on the student's device. A dropped connection after the server responded reads as downloaded. The dashboard's own button shows a failure it can see, and a retry is harmless.
- **The ranking is an uncalibrated product judgment.** The weights, the confidence of 0.6 for findings with none recorded, the 5-point change threshold and the "Strong band means stop polishing" rule are mine. No adviser or student has reviewed them.
- **No concurrency claim.** Conflicts are tested on the demo repository, the fake and two browser tabs, not against real PostgREST under load.
- **Not run against real PostgREST or Supabase.** RLS, triggers and cascades are run in PGlite. Repository code runs over the in-memory fake.
- **No accessibility conformance is claimed.** axe found 0 violations on the screens listed under "Validation", which is a local check and not an audit.
- **No number moves.** Nothing under `src/lib/analysis/` was edited, and a test deep-compares report rows and payloads before and after every new operation. One display change for Codex to judge: the dashboard's "· +3" beside the latest score now shows only for a change of 5 or more. The stored and displayed score itself is unchanged.

**Visible behaviour changes for Codex to judge:**

- The dashboard is longer: three new sections above the reports table, and a "FOR" column in the table.
- "Tracking" on Opportunities now asks before stopping, because stopping removes the application's status and links. This is a small change in `OpportunitiesView.tsx`.
- A tailored CV can now create an application with no listing behind it ("Track this role"). `applications.opportunity_id` was already nullable. **These rows count in institutional `trackedApplications`.**

## Task status

| Task | Status | Notes |
|---|---|---|
| OP-019: CV, tailored CV, letter, freshness, next actions | Implemented → Locally verified | Human gate open: nobody has reviewed the ranking or wording. |
| OP-019: interview practice version | **Open** | Nothing is saved to link to. Belongs with OP-023. |

## Changed files

New, owned by this task:

- `src/lib/applications/types.ts`: links, downloads, dismissal reasons, `LinkConflictError`, `LinkRefusedError`. Client-safe.
- `src/lib/applications/workspace.ts`: `summarise`, `downloadState`, `downloadSentence`, `buildWorkspace`, `UsefulProgress`, `MEANINGFUL_SCORE_CHANGE`. Pure, and keeps no document text.
- `src/lib/applications/next-actions.ts`: the candidates, `priorityOf`, `nextActions`, `dismissedNow`. Pure.
- `src/lib/applications/flow.ts`: `loadWorkspace`, the link, keep, track and dismiss flows, `linkNewReport`, `noteDownload`.
- `src/app/actions/applications.ts`: seven session-checked actions.
- `src/app/dashboard/NextActions.tsx`, `ApplicationsPanel.tsx`, `ApplicationControls.tsx`.
- `supabase/migrations/20261107220000_application_links.sql`: **unapplied**.
- `tests/applications.test.ts` (30 tests), `tests/applications-recovery.test.ts` (12 tests).
- This report.

Modified, owned by this task: `src/app/dashboard/page.tsx`.

Modified, shared (each re-read immediately before editing, additive unless stated):

| File | Change |
|---|---|
| `src/lib/repo/types.ts`, `demo.ts`, `supabase.ts` | New methods: `workspaceReports`, `applicationLinks`, `setApplicationLink`, `removeApplicationLink`, `trackRole`, `removeApplication`, `recordDownload`, `artefactDownloads`, `actionChoices`, `recordActionChoice`. Demo `untrack` also removes links, as the foreign key does. |
| `src/lib/cv-blocks.ts` | `myCvDownload`. `myCvBlocks` unchanged. |
| `src/app/api/tailor/[id]/route.ts`, `api/letters/[id]/route.ts`, `reviews/[id]/source/file/route.ts`, `linkedin/[id]/download/route.ts` | One `noteDownload` call before the response. |
| `src/app/api/templates/[slug]/route.ts` | Same, and `?with=mine` accepts `&report=` for a named CV. Without it, behaviour is as before. |
| `src/app/api/export/route.ts` | A new `application-documents.json` in the student's data download. `applications.json` keeps its shape. |
| `src/app/actions/tailor.ts` | `createTailor` links a report made from a tracked listing. `moveApplication` also revalidates `/dashboard`. |
| `src/app/opportunities/OpportunitiesView.tsx` | Asks before stopping tracking (see above). |
| `src/lib/rate-limit.ts` | `applicationChoicePerUser`: 120 per 10 minutes. |
| `docs/OPERATIONS.md` | One row in the data lifecycle table. |

**Tests I changed that I did not write:**

| File | Change | Reason |
|---|---|---|
| `tests/fixtures/fake-supabase.ts` | Four tables, a `cascades` option on a table, new tables in the account cascade, new rows exposed | The repository's new methods need them. No existing behaviour changed. |
| `supabase/tests/schema.test.mjs` | One new block, 50 checks | Requested. No existing check changed. |

No existing assertion was edited. `tests/security-tenancy.test.ts` caught two real faults in my first version, and I fixed the code rather than the test: actions must call `getRepo()` visibly, and one service-role update lacked `user_id`.

## Behaviour

### Linking

A slot on an application is one CV, one tailored CV or one letter (`unique (application_id, kind)`). The same CV can sit on several applications.

| How a document gets there | Shown as | Removed by |
|---|---|---|
| The student links it, or uses "Track this role" | Linked | "Unlink" |
| Made from a tracked listing (`createTailor` with `opportunityId`, slot free) | Linked | "Unlink" |
| Named by a document in the slot: the tailored CV's `cvReportId`, the letter's `tailorReportId` and `cvReportId` | "used by your tailored CV" | Follows that document. A link in the slot always wins. |

**Matching by name only suggests.** A tailored CV with exactly the same normalised role and employer as an application is offered with a button, and isn't on that application until the student chooses it. The same title at another employer, or the same employer with another title, is not suggested. "the employer", which a report says when none was given, never matches or groups anything.

**A LinkedIn report** is listed under "Your LinkedIn profile", labelled "Your profile, not one role" in the table, and tracked for downloads. It can't be put on an application: refused by the repository and by the database trigger. The dashboard's existing LinkedIn filter is unchanged.

**Independent history.** Links live in their own table. No flow here writes to a report.

### Exact versions

`application_links.document_version` is null by default: the application follows the report's latest version. "Keep this version" stores that version's hash. A newer version then doesn't replace it: the row says "Version 2 kept", downloads ask for that version, a recommendation says a newer one exists, and "Use the latest" clears it.

### Whether a download has the latest changes

Every download route records `(report, document version, format)`, with one row per version. It records the version the route actually served, read from `tailoredExport`, `letterExport`, `baseDocument` or the hash of `profileText`.

| State | Student reads |
|---|---|
| `current`: that version has been sent, even if an older one was sent later | "Your download from 3 Nov has this version." |
| `behind`: a file was sent, not this version | "Your last download (3 Nov, version 1) doesn't have this version." |
| `never` | "Not downloaded yet." |
| `blocked`: blanks or points the OP-016 and OP-017 gates hold | "Fill or keep 1 blank first." |
| `nothing` | "No changes kept yet." |

Undoing back to a version already downloaded returns to `current`. A CV with no saved lines counts the original file as current, because the words are the same. A CV's download is always its lines as they stand, so a kept CV version can't be re-downloaded.

### What to do next

`priority = importance² × confidence ÷ effort`. Importance: critical 4, high 3, medium 2, low 1. Effort: 1 to 3. Confidence comes from the finding when recorded, 0.6 when not, otherwise a fixed value per kind of action.

At most 5 are shown, and at most 2 of those are CV findings. Titles are capped at 80 characters and reasons at 170. Each shows why, and plain words for how it was ranked, for example "Important · We're sure · Quick".

| Candidate | Importance | When |
|---|---|---|
| Deadline | critical within 3 days, otherwise high | Status "saved", closes within 7 days. Not after it has passed. |
| Held upload | high | The same rule as the upload page's waiting list |
| Finish a document | high | The download gate is holding it |
| Download the latest | high (never downloaded: medium) | Status "saved" only |
| Essential requirement with no evidence | high, confidence 0.7, effort 3 | "Add it only if it's true for you" |
| Possible typos | high | The proofreader's likely typos, less those dismissed |
| CV finding | the finding's severity | **Only high or medium, and only below the Strong band** |
| Newer version, CV changed, pending suggestions, link suggestion, mark as sent | medium or low | |

**Not chasing the number.** No action is ranked or worded by points. `analysis.steps[].gain` is not read. A sentence about the score is replaced rather than shown. **One caveat:** a finding's severity is itself derived from potential score gain (`checkSeverity`), so the gain influences rank indirectly below the Strong band. A CV at 75 or above gets no finding actions at all. With nothing to do, the student is told there's no need to upload the same CV again.

**Dismissal.** Four fixed reasons, and one is required. History is append-only. "Not now" returns after 7 days, and the others stay until brought back. A key includes the version where new work should ask again. Only something we would currently recommend can be stored, so the table can't be filled with anything else.

### Progress

Uploaded files, reviewed versions, tailored applications, letters and completed edits are separate tiles.

- **Reviewed versions** are distinct hashes of the normalised text, so a re-export that differs only in formatting is a repeat, and says so on the tile.
- **Completed edits** count what stands now, so an undone edit stops counting. Corrections count once per distinct text.
- **Improvements** walk distinct versions in order and count a rise of 5 or more within one scoring series. Sending A, A, B, A, B counts once.

### Interruption and recovery

| Case | Result |
|---|---|
| Refresh | Everything is server state. Two reads compare deep-equal. |
| Double click, lost reply | The same link request returns what's there. "Track this role" finds the same application. A repeat dismissal adds nothing. |
| Retried download | The same row, `lastAt` moves. The dashboard button keeps a failure on the page with a message. |
| Recording a download fails | The file is still served, and the failure is logged. The dashboard then errs towards "download again". |
| Session expiry | Every action says so and changes nothing. Routes return 401. The dashboard shows a message, the chosen reason stays selected, and the same click works after signing in. |
| Two tabs | Each write carries what the tab saw. A stale link, unlink or keep is refused with "This application changed in another tab, so nothing was replaced." Document edits keep OP-016's revision check. |
| Stopping tracking | Asks first. Links go, reports stay. Tracking again doesn't restore links, but the documents are offered back as a suggestion. |
| Report removed | Its link and download rows cascade. A document naming it says it's gone. The application stays. |
| Damaged record | Stays listed as unreadable and stops nothing else. |

**Not guarded:** moving an application's status from two tabs is last write wins, as before, and two tabs choosing "Keep" and "Use the latest" on the same report is too. Neither loses document work.

### Privacy

No new table holds document text. Tests search the loaded workspace for a CV sentence and an advert line. `document_version` and `action_key` are constrained so a sentence can't be stored. Advisers and admins have no route to these tables. They are in the student's data download and go with the account.

## Validation

Final tree, `ANTHROPIC_API_KEY` blank, exact results.

| Command | Result |
|---|---|
| `npm run typecheck` | Exit 0 |
| `npm run lint` | 0 errors, 1 warning (`tests/e2e/smoke.mjs:38`, not this task's) |
| `npm run test:engine` | 794 tests, 794 pass, 0 fail, run twice |
| `tests/applications.test.ts` alone | 30 pass |
| `tests/applications-recovery.test.ts` alone | 12 pass |
| `npm run test:db` | Exit 0. `schema.test.mjs` 391 PASS, 0 FAIL, of which 50 are this task's. `security.test.mjs` 96 passed |
| `git diff --check` | No output, exit 0 |
| `npm run diagnose:audit -- --check` | `GATES: 9 met, 0 unmet` |

The test count moves as other agents add tests. No persistent failure in files I don't own.

**Browser.** Own copy at `/private/tmp/claude-501/-Users-gbolahan-Documents-NEW-ME-LevelUp/70ce5228-d909-41a7-b749-2bc52131c2e0/scratchpad/op019/`, demo mode (`"mode":"demo"` in its boot log), keys blanked, port 3719, stopped afterwards. Playwright with Chrome. Scripts are `op019-browser.mjs`, `op019-browser2.mjs` and `op019-browser3.mjs` in that scratchpad folder.

| Screen | axe (WCAG 2.2 AA tags) | 390px scrollWidth / clientWidth |
|---|---|---|
| Dashboard, fresh | 0 violations | 390 / 390 |
| Dashboard, dismiss form open | 0 violations | not measured |
| Dashboard, link picker open | 0 violations | not measured |
| Dashboard, after linking and a download | 0 violations | 390 / 390 |
| Dashboard with a LinkedIn card | 0 violations | 390 / 390 |
| Dashboard filtered to LinkedIn | 0 violations | not measured |
| Opportunities, stop-tracking prompt open | 0 violations | 390 / 390 |

Observed in that browser: a reason was required, and a dismissal survived refresh and came back. With cookies cleared, a dismissal and a download both showed the expiry message, the chosen reason stayed selected, and the dismissal worked once the cookie returned. A stale second tab was refused. A real file downloaded and the row changed to "Your download from 7 Nov has this version." A blocked request showed the failure message, and the retry downloaded. Keep and release both survived reload. A LinkedIn review appeared in its own card, labelled in the table, and filtered correctly. The only console errors were the two I induced, the blocked request and the 401.

`npm run test:e2e` was not run.

## Limitations

- **Reads cost more.** The dashboard reads up to 40 full report payloads, those that links or parents name, and every CV version with its text. Size wasn't measured on a real account. Tiles count those 40 and say so when there are more.
- **Not a document store.** A kept CV version can't be re-downloaded, because the route serves the lines as they stand.
- **Suggestions are exact.** "Analyst" and "Graduate Analyst" at one employer aren't matched. The student can link by hand.
- **A role tracked from a report has no listing,** so it has no apply link and its deadline comes from the advert when we read one.
- **Severity reflects score gain,** as noted above.
- **Demo seeds** have no CV versions, so the demo counts them as uploads with no file.
- **Wording** is mine, unreviewed.

## Migration impact

**One unapplied file: `supabase/migrations/20261107220000_application_links.sql`.** Named after all existing files, re-listed immediately before naming and again at the end. It runs after `20261107210000_report_sharing.sql`.

- Adds `applications.source_report_id` (nullable, set null on delete, partial unique index, safe on existing rows).
- Adds `application_links`, `artefact_downloads` and `action_choices`, all with RLS, select-own policies, writes revoked from signed-in users, and ownership triggers.
- **Apply before deploying this code.** The dashboard reads these tables and would fail without them. A missing `artefact_downloads` wouldn't stop a download.
- Rollback: the tables and column can be dropped with nothing else depending on them. Data in them would be lost.

No existing column, row or score changes. `reports.payload` is untouched and `PAYLOAD_VERSION` is unchanged.

## Checks Codex must rerun

1. The commands above, then each new test file alone with the `test:engine` flags.
2. By reading: `next-actions.ts` doesn't read `steps` or `gain`, and judge whether the severity caveat is acceptable.
3. The two shared test files listed under "Changed files".
4. `setApplicationLink`, `recordDownload` and `trackRole` against a real PostgREST, under an authorised scope. The fake doesn't model the type check in `application_links_check`: that is covered in PGlite.
5. Your own two-tab and expired-session attempts in a copy, since browser timing is what these tests can't fully cover.
6. Whether hiding score changes under 5 is acceptable under "no score may change". I read it as presentation.

## Unresolved questions for Codex or the founder

1. **OP-022 and institutional counts:** `admin_outcomes_pack` `reuploaded` and `improved10` still count duplicate submissions. OP-019's acceptance is met for the student's dashboard only. I left the SQL for OP-022, which can reuse the same rule. Should role-derived applications count in `trackedApplications`?
2. **Interview practice:** OP-023 must save practice before it can be linked. Should the register split this clause out of OP-019?
3. **Ranking and wording:** who reviews the weights, the 5-point threshold and the Strong-band rule?
4. **Should a CV finding's rank stop using severity,** given it's derived from potential gain? That would need a separate importance per check, which is a content decision.
5. **Should marking an application "applied" keep the last downloaded version automatically,** as a record of what was sent? I left it explicit.
6. **OP-021:** nothing here is visible to advisers. Should an adviser with consent see which version went to which role?
