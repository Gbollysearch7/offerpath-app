# OP-027: audit accessibility and core journey usability

Prepared 7 November 2026 by Claude, for independent acceptance review by Codex. Nothing was committed, pushed or deployed. No migration was applied. No live database, `test:live`, paid provider or email was used. `next build` and the server ran only in an isolated copy under the scratchpad, with every key blank.

**Status: Implemented → Locally verified. The human gate, representative user testing, remains open.** The issue register, with its manual scripts, is [ACCESSIBILITY_REGISTER.md](ACCESSIBILITY_REGISTER.md).

## What this task does and does not claim

- **Claims:** a scripted keyboard, in one browser on one platform, completes the named student tasks. Focus lands somewhere named and visible after each update, and text reaches a live region. axe finds no violations on the routes listed. Word files have real headings and PDF text is drawn in reading order. Each of those holds as far as the named check measures it.
- **Does not claim:** conformance with WCAG or any standard. That a screen reader says these things usefully. That a person finds this usable. **No screen reader, student or real device was involved.** Admin is not audited.
- **Scores:** unchanged. The only analysis file touched is `tailor.ts`, one character in a regular-expression escape. `documents.ts` changes only how a file is written, and 24 generated files read back identically: see Validation.
- **The accessibility statement is unchanged.** It says too much in several places: wording changes for legal review are in the register.

## Task status

| Task | Status | Notes |
|---|---|---|
| OP-027 | Implemented → Locally verified | **Human gate open.** No manual result is recorded, because none has been run. |

## Findings

25 issues fixed: 1 critical, 7 high, 9 medium, 8 low. 12 open: 1 critical (the landing page, not caused by this work and off limits), 1 high, 4 medium, 6 low. Every issue, with how to reproduce it, is in the register.

- **Critical, and not an accessibility issue:** any tailoring suggestion on a CV line with a hyphen made the tailor page fail with HTTP 500 (`\-` in a `/u` regular expression, in `tailor.ts`). A real provider would hit it often, as hyphens are everywhere in CVs. This was found only because the audit needed a simulated provider. Existing tests' CVs had no hyphen on an edited line.
- **The largest fault:** focus fell to `<body>` after most server-action updates (20 of the 51 baseline failures).
- **Highest open accessibility issue:** PDFs are untagged, which pdf-lib can't change.
- **Needs someone now:** `/` returns HTTP 500 on the latest build, from a 05:06 edit to the protected `src/app/_landing/demos/CohortDashboard.tsx`. Not touched: A11Y-O12.

## Changed files

**New**
- `src/components/a11y.ts`: `announce`, `focusSoon`, `onTabListKey`.
- `src/components/A11yRuntime.tsx`: live region, focus safety net, menu closing.
- `tests/accessibility.test.ts`: 15 engine tests.
- `tests/e2e/keyboard.mjs`: keyboard tasks. `tests/e2e/sweep.mjs`: route sweep.
- `docs/ACCESSIBILITY_REGISTER.md`, this report.

**Changed, all small**
- Shared: `src/app/layout.tsx`, `src/app/globals.css`, `src/app/not-found.tsx`, `src/components/client.tsx`, `src/components/Topbar.tsx`, `package.json` (`test:keyboard`, `test:sweep`).
- Journeys: `src/app/sign-in/SignInForms.tsx`, `src/app/onboarding/OnboardingFlow.tsx`, `src/app/upload/UploadForm.tsx`, `src/app/upload/SourceEditor.tsx`, `src/app/reviews/[id]/ShowAround.tsx`, `src/app/reviews/[id]/breakdown/page.tsx`, `src/app/reviews/[id]/source/page.tsx`, `src/app/reviews/[id]/lines/LineEditor.tsx`, `src/app/reviews/[id]/verbs/VerbBank.tsx`, `src/app/reviews/[id]/examples/ExampleTabs.tsx`, `src/app/reviews/[id]/checks/[check]/page.tsx`, `src/app/reviews/[id]/checks/[check]/ProofreadingPanel.tsx`, `src/app/tailor/TailorStartForm.tsx`, `src/app/tailor/[id]/TailorView.tsx`, `src/app/tailor/[id]/TailorEditor.tsx`, `src/app/letters/LetterStart.tsx`, `src/app/letters/[id]/LetterWorkspace.tsx`, `src/app/letters/[id]/LetterReviewView.tsx`, `src/app/linkedin/LinkedinStart.tsx`, `src/app/linkedin/[id]/LinkedinReportView.tsx`, `src/app/opportunities/OpportunitiesView.tsx`, `src/app/dashboard/page.tsx`, `src/app/dashboard/ApplicationControls.tsx`, `src/app/dashboard/ShareButton.tsx`, `src/app/share/ShareForm.tsx`, `src/app/share/RevokeButton.tsx`, `src/app/share/LinkList.tsx`, `src/app/privacy/page.tsx`, `src/app/legal/cookies/page.tsx`, `src/app/legal/sub-processors/page.tsx`.
- Library: `src/lib/documents.ts`, `src/lib/analysis/tailor.ts`.

**Tests I changed that I did not write:** only `tests/e2e/smoke.mjs`. Axe now also runs at 390px and at 200% zoom, because narrow-only failures were being missed. The route list adds tailor, letters, LinkedIn, opportunities, templates, practice, shared links and a 404. Onboarding's three steps get axe. Animations are finished before each size, because a mid-animation colour gave a false failure on the landing page. Nothing was loosened. No engine test was edited.

**Left alone:** `src/app/admin/` and `src/app/_landing/`, and the statement. `src/app/layout.tsx` and `globals.css` are shared, so the safety net and field colour also reach admin pages.

## Behaviour

- **After an update, focus stays with the student.** Screens with an obvious next place send focus there: Edit to its box, Cancel back to Edit, a new step or screen to its heading, a created link to its field. Everything else falls to `A11yRuntime`: the control when it comes back, or the nearest one. It waits up to 8 seconds for a disabled control, and does nothing after a navigation, a deliberate click on the page, or if focus went elsewhere.
- **Status changes are spoken** through one polite live region.
- **Tabs are tabs:** arrow keys, Home, End and one Tab stop, in all seven groups.
- **Visible changes are deliberately few:** darker field edges and off switches, a focus ring on three search fields, "Line 2" field labels, wrap on the check page header. Word files gain heading styles with the same explicit formatting. PDF positions are the same; only the drawing order changed.
- **"Undo" and "Save to reports" use `aria-disabled` once finished,** so the button pressed last can hold focus.

## Validation: commands and actual results

Run in `/Users/gbolahan/Documents/NEW ME/LevelUp` on 7 November 2026 on the shared tree. Other agents were editing throughout: an engine run earlier in the session had 11 failures and `typecheck` errors, all in other agents' in-flight work, and both were clean by the final runs below.

| Command | Result |
|---|---|
| `npm run typecheck` | **Pass**, exit 0. |
| `npm run lint` | **Pass**, exit 0, 0 errors, 0 warnings. |
| `npm run test:engine` | **Pass: 938/938, 0 failed.** Includes the 15 new tests. |
| `git diff --check` | **Clean**, exit 0. New files checked for trailing spaces separately: none. |
| New tests against the tree before the fixes | **12 of 15 fail**, as they should. The other 3 are guards on what was already sound (arrow-key helper on its own, score colours, read-back parity). Output kept: `a11y-on-old.txt` in the scratch folder. |
| Export round trip, before and after | All 24 files (12 themes, Word and PDF): **same extracted text, bullet count and score, 0 differences.** |
| `npm run test:keyboard` | **PASS 171, FAIL 0, SKIP 0**, with the simulated provider. Every step was by keyboard, bar one marked click. Baseline: 67 pass, 51 fail.**** |
| `node tests/e2e/sweep.mjs` | **43 route states at 4 sizes: 0 axe violations at any size.** No Tab walk issue: no traps, unnamed stops, missing indicators, offscreen stops or positive tabindex. Baseline had 7 serious results, and 3 fields with no indicator. |
| `npm run test:e2e` (smoke) | **Exit 1: 125 pages crawled (9 public, 95 student, 21 admin), 2 faults, neither in code this task owns.** (1) `/admin/settings`, serious `scrollable-region-focusable` at 390px: A11Y-O08, admin was off limits. (2) `/` returned HTTP 500 and its console error: A11Y-O12, from a 05:06 edit to the protected `CohortDashboard.tsx`; the build about 20 minutes earlier had only fault (1). **No student route failed.** |

Per-journey and per-route tables are in the register.

### How to reproduce the browser results

In a copy of the repository, never in the shared tree:

```
rsync -a --exclude .next --exclude node_modules --exclude '.env*' --exclude .git ./ ../copy/ ; ln -s "$PWD/node_modules" ../copy/node_modules
cd ../copy
# The simulated provider, in the copy only. In src/app/actions/tailor.ts replace
#   aiEnabled() ? (input) => aiTailorCv(input) : null
# with
#   aiEnabled() ? (input) => aiTailorCv(input) : process.env.OP027_STUB_TAILOR === "1" ? (async (input: { lines: { id: number; text: string }[] }) => ({ summary: "", skills: ["SQL"], notEvidenced: [], bullets: input.lines.slice(0, 4).map((l, n) => ({ id: l.id, after: n === 1 ? l.text.replace(/\.$/, "") + ", improving results by [X%]." : "Clearly " + l.text.charAt(0).toLowerCase() + l.text.slice(1), keywords: [] })) })) as never : null
env -i PATH="$PATH" HOME="$HOME" DEMO_MODE=true ./node_modules/.bin/next build
env -i PATH="$PATH" HOME="$HOME" DEMO_MODE=true DEMO_REPORT_SHARING=true OP027_STUB_TAILOR=1 DEMO_SECRET=any ./node_modules/.bin/next start -p 3100
```

Then, from any checkout:

```
export E2E_CHROME_PATH=<path to Chrome>
E2E_TAILOR_STUB=1 E2E_OUT=run.json E2E_STATE=state.json E2E_DOWNLOADS=/tmp/dl npm run test:keyboard
E2E_RUN=run.json E2E_STATE=state.json E2E_SWEEP_OUT=sweep.json npm run test:sweep
npm run test:e2e
```

Without the patch and `E2E_TAILOR_STUB`, the suggestion steps report SKIP, never a pass. To see the crash in A11Y-001, also put `-` back in `esc()`. The script's file chooser retries once: the browser can still be closing the last automated chooser (seen in 2 of the first 7 runs, and not reproduced by a slower script), and no person can press that fast.

## Limitations

- **Only Chrome for Testing 146 on macOS.** Other browsers, and Windows, handle focus and closed selects differently.
- **"Announced" means the text reached a live region** in the DOM. Whether, when and how a screen reader speaks it is untested, and a heading taking focus while a live region updates may be read twice.
- **200% and 400% zoom are viewport sizes,** which is what zoom does to layout, not a browser zoomed by a person.
- **A simulated provider** stood in for AI tailoring. Real suggestions may differ in length and in what they need confirmed.
- **Demo mode:** real Supabase sign-in, including university sign-in, wasn't used. Failure messages for a switch or copy weren't driven (A11Y-019), nor were forced colours or reduced motion in a browser (A11Y-022, A11Y-023).
- **Word and PDF files were inspected by parser, not opened in Word or Acrobat.** The Word heading styles come from the docx library's defaults. Run formatting overrides them, and that wasn't confirmed visually in Word.
- **`A11yRuntime` is a heuristic.** Its nearest-control choice is by screen position. Mouse use was checked only for one click and for typing in a re-rendering field.
- **The engine tests are partly source scans.** They catch a pattern coming back, not every way of breaking the behaviour. The browser scripts cover behaviour, and aren't in CI.
- **Latent:** `esc()` in `letter-check.ts` has the same `\-` in a `/u` pattern. A probe with hyphenated names and claims didn't reach it, since inputs are split on hyphens first, so it wasn't changed. Worth a one-character fix when someone is in that file.

## Migration impact

None. No schema, RPC, stored data or environment variable changes. New files are written with the new structure, and old downloads aren't touched.

## Checks Codex must rerun

1. The four commands, on the tree as it stands then.
2. `tests/accessibility.test.ts` with `-` put back in `esc()`, and with heading styles removed from `toDocx`: tests 11 and 12 should fail.
3. The browser commands above. Then do your own keyboard run of tailor Accept, Reject and Decide again, and of Opportunities' Move to.
4. Read `A11yRuntime.tsx` for cases where it could take focus from someone. That's the riskiest change here.
5. Unzip a Word download and read the headings. Compare a downloaded CV with one from before, by eye, in Word, which wasn't done here.

## Unresolved questions for Codex or the founder

1. **Who reviews the statement wording,** and should it stay up as it is until then? It claims 44px targets and fully accessible Word files, neither of which holds.
2. **Students:** who recruits and pays representative testers? The scripts are ready; nothing can close this task's gate without them.
3. **Tagged PDFs:** accept untagged with Word as the alternative, or change PDF route?
4. **Target sizes:** make controls bigger, or drop the 44px claim?
5. **Landing page:** A11Y-O12. Is the 05:06 edit to `CohortDashboard.tsx` finished? As it stands `/` fails.
6. **Admin:** A11Y-O08 is one line, and it makes `npm run test:e2e` fail until fixed. It's for the OP-021 owner, as I was told to stay out. An OP-021 report appeared in `docs/` during this work, but I had no word that the agent had reported, so admin is listed as not audited. It still needs its own audit.
