# Accessibility issue register

Started 7 November 2026 under OP-027. Owner: the Offerpath team. Update this file whenever an issue is found or closed, and record every manual result in it.

**This register makes no conformance claim.** Automated tools and scripted key presses find a useful share of problems, and they prevent regressions. They can't show that the service meets WCAG, or that a person using assistive technology can actually use it. **No student has tested anything here. No screen reader has been used. The human gate, representative user testing, remains open.**

## Scope and method

| Tested | How |
|---|---|
| Student journeys: sign-in, onboarding, upload, review before scoring, source document, report overview, check pages, line editor, tailor and its edit controls, letters, LinkedIn, dashboard, opportunities, share page, privacy and export | `tests/e2e/keyboard.mjs` (`npm run test:keyboard`): real key presses in Chrome for Testing 146 on macOS, driven by Playwright. No clicks (one deliberate exception, marked in the script), no scripted focus, no form filling. |
| Route states at 1280px, 200% zoom (640×450), 390×844 and 400% zoom (320×256) | axe-core 4.14 with the WCAG 2.0, 2.1 and 2.2 A/AA tags at each size, best-practice rules at 1280px, a full Tab walk (except at 320×256), one Shift+Tab walk at 1280px, overflow, target sizes, and text spacing overrides. `tests/e2e/sweep.mjs`. |
| Word and PDF files | `tests/accessibility.test.ts`, and the downloaded files read with python-docx and pypdf. |
| Colour | Contrast ratios worked out from the design tokens, in the engine suite, plus axe. |

The server was a production build of an isolated copy, in demo mode with every key blank. **A simulated tailoring provider was patched into that copy only**, because Accept, Edit and Reject on suggestions don't exist without a provider. It is not in the repository. To reproduce it, apply the same one-line patch to `createTailoredVersion` in `src/app/actions/tailor.ts` and set `OP027_STUB_TAILOR=1`; it is set out in the OP-027 report. Without it, `npm run test:keyboard` reports those steps as SKIP.

### Not tested

- **`src/app/admin/`: not audited.** It belonged to the OP-021 work during this audit and was not edited. `tests/e2e/smoke.mjs` crawls it, so its one axe failure is recorded as A11Y-O08. No keyboard task covers it. The shared focus safety net (A11Y-002), field-edge colour (A11Y-014) and switch colour do reach admin pages.
- **The landing page (`src/app/_landing/`):** protected from this work, and not edited. An earlier build had no serious axe failures once its entrance animations finished, and the final build returned HTTP 500 (A11Y-O12). No keyboard task covers it.
- **Screen readers, voice control, magnifiers and real phones:** none used. Accessible names come from Chrome's accessibility tree, which is not what a person hears. Announcements are recorded as text reaching a live region, which does not prove a screen reader reads it well.
- **Safari, Firefox and Edge; Windows; Android; iOS.** Chrome on macOS only. Focus behaviour, and how a closed `<select>` responds to arrow keys, both differ between platforms.
- **Word or Acrobat themselves.** The files were inspected, not opened in the applications with a screen reader.
- Practice pages, templates and help had axe and Tab walks only, with no keyboard task. Real AI output, real Supabase sign-in and real email were not exercised.

## Severity

**Critical:** stops a task for everyone affected. **High:** a named task is blocked or badly disorienting for keyboard or screen-reader users. **Medium:** the task can be done, with real difficulty or a failed check. **Low:** an annoyance or a gap in depth.

**Status** is `Fixed, locally verified` or `Open`. "Fixed" here means the named check passes on this tree. It does not mean a person has confirmed it.

## Issues fixed in this audit

Reproduce each one by reverting the named change, or against any earlier copy of the tree. `kb` = `npm run test:keyboard`, `eng` = `tests/accessibility.test.ts`, `smoke` = `npm run test:e2e`.

| ID | Severity | Issue | Reproduce (before the fix) | Fix | Regression check |
|---|---|---|---|---|---|
| A11Y-001 | **Critical** (everyone, not only assistive technology) | The tailor page returned HTTP 500 once a suggestion touched any CV line containing a hyphen. `esc()` wrote `\-`, a syntax error in a `/u` regular expression. | Upload `cv.pdf` ("mid-market"), tailor with a provider. Log: `SyntaxError: Invalid regular expression … mid\-market`. | `src/lib/analysis/tailor.ts`: stop escaping `-`. | eng: "a line with a hyphen" |
| A11Y-002 | **High** | Focus fell to `<body>` after almost any server-action update: a button disabled while its action ran, or removed by what came back. Seen on saved switches, Share with my adviser, downloads, Accept, Reject, Not relevant to me, Switch off, sign-in errors. | kb, 20 of the 51 baseline failures: "focus fell to <body>". | `src/components/A11yRuntime.tsx`, mounted in the root layout: puts focus back when the control returns, or on the nearest control. Does nothing after a navigation, or if focus went elsewhere. | kb: every "keeps focus" step and "focus safety net" |
| A11Y-003 | **High** | Upload: each screen swap (progress, reading summary, review, outcome, paste, Back) lost focus, and the chosen file wasn't announced. | kb: Tab to "Choose a file", Enter, choose `cv.pdf`; nothing in a live region. Enter on "Score my CV": focus on `<body>`. | `UploadForm.tsx`, `SourceEditor.tsx`: heading takes focus on each screen change; `announce()`. | kb: upload; eng |
| A11Y-004 | **High** | Editors: Edit opened a box without moving focus to it; Cancel removed the focused button and lost focus. Line editor, tailor, letters, LinkedIn. | kb: Enter on Edit, then `document.activeElement` is `<body>`. | `autoFocus` on the box; `focusSoon()` back to Edit. | kb; eng |
| A11Y-005 | **High** | No visible focus at all on three search fields (`outline-none`): sign-in, dashboard, verb bank. | Tab to "Your university": computed outline `none`, no shadow. | Removed `outline-none`. | eng: "focus is never hidden" |
| A11Y-006 | **High** | Hidden file inputs were an invisible Tab stop at x = −9999: upload, letters. | Tab past "Choose a file": focus on "CV file", offscreen. | `tabIndex={-1}`. | kb; eng |
| A11Y-007 | **High** | Seven `role="tablist"` groups had no arrow keys, though a screen reader tells users to press them; every tab was a Tab stop; Opportunities and the tailor and letter views had no tab panel. | kb: focus "Browse", press ArrowRight: focus doesn't move. | `onTabListKey`, roving `tabIndex`, `role="tabpanel"`. | kb; eng, with a unit test of the keys |
| A11Y-008 | **High** | Word files had no headings: bold paragraphs only, no title or language. The statement calls them "fully accessible". | Unzip a download: no `w:pStyle` of a heading in `word/document.xml`. | `src/lib/documents.ts`: Title, Heading 1 for sections, Heading 2 for roles, document title, `en-GB`. Formatting set on the runs is unchanged. **No screen reader has tried these.** | eng: "Word: real headings" |
| A11Y-009 | Medium | Letters' mode choice was `role="radio"` with no arrow keys. | kb: role is `radiogroup`, ArrowDown does nothing. | `role="group"` with `aria-pressed`, as LinkedIn uses. | kb; eng |
| A11Y-010 | Medium | Tour dialog: focus stayed outside it, Escape did nothing, Done and Back at the first stop lost focus, stops weren't announced, focus ring was 2.94:1 on black. | kb: Enter on "Show me around", then Escape: the dialog stays. | `ShowAround.tsx`. | kb; eng |
| A11Y-011 | Medium | Onboarding: a new step wasn't announced, and Back to step 1 lost focus (Back disappears there). | kb. | The step's heading takes focus. | kb; eng |
| A11Y-012 | Medium | Status changes not announced: saved settings, tailoring and letter decisions, LinkedIn updates, new or revoked share links, tracking, moving a role, stopping sharing. | kb: "nothing reached a live region". | One live region (`A11yRuntime`) and `announce()`. | kb: every "announced" step |
| A11Y-013 | Medium | Sideways-scrolling tables and scrolling text couldn't be reached by keyboard. axe **serious** at narrow widths only, which the smoke test never measured: cookies, sub-processors, score breakdown. Also the keyword panel and the `<pre>` text blocks. | Baseline sweep, `scrollable-region-focusable` at 390px and 320px. | `tabIndex={0}` with a name. | smoke, now at 390px and 200% |
| A11Y-014 | Medium | Field edges were 1.31:1 on white and 1.18:1 on the page; the off switch was the same colour (WCAG 1.4.11). axe doesn't measure this. | Worked from the tokens: `#DCE3DE`. | `#7D8A85` (3.59:1, 3.25:1), in `globals.css` and `Switch`. | eng |
| A11Y-015 | Medium | Repeated buttons with no target: Track and Move to, Switch off, and LinkedIn's Keep, Skip, Edit, Undo, Reassess and Copy. Correction fields called "Line" several times over, and sections with the same landmark name. | kb: name is just "Track". | Visually hidden text; numbered fields; each section named after its heading. | kb; eng |
| A11Y-016 | Medium | Sign-in and delete-account errors weren't tied to their fields. | kb: `aria-describedby` absent. | `aria-describedby`. | kb; eng |
| A11Y-017 | Medium | PDF: read order was date before role title, bullet mark after its text, with no title or language. | Raw text order from a download, or eng on an earlier tree. | `documents.ts`: draw order changed, same positions; `setTitle`, `setLanguage`. **Still untagged: see A11Y-O01.** | eng: "PDF: selectable text" |
| A11Y-018 | Low | Account menu ignored Escape, and stayed open over the content when focus moved on. | kb. | `A11yRuntime`, `data-menu`. | kb |
| A11Y-019 | Low | A switch that failed to save flipped back with no message; a failed copy said nothing; a blocked share-link copy threw an error. | Read `client.tsx` and `ShareForm.tsx`; **not driven in a browser**, as forcing the failures needs a broken server. | Readable messages. | none in a browser |
| A11Y-020 | Low | The proofreading status line took focus with its indicator removed. | kb baseline. | Removed `outline-none`. | kb; eng |
| A11Y-021 | Low | A 404 had the generic title "Offerpath". | Baseline sweep. | `metadata` on `not-found.tsx`. | `tests/e2e/sweep.mjs` |
| A11Y-022 | Low | In Windows contrast themes, switches would lose their state. **Reasoned from the CSS; not seen in Windows.** | Backgrounds are dropped in forced colours. | `forced-colors:` border and thumb. | none |
| A11Y-023 | Low | The tour scrolled smoothly even with reduced motion on. | Read `ShowAround.tsx`. | Respects the setting. | none in a browser |
| A11Y-024 | Low | Check page title and score ring overflowed sideways by 18px at 320px, on long titles ("Accomplishments"). | Baseline sweep, `/checks/accomp` at 320×256. | `flex-wrap`. | `tests/e2e/sweep.mjs` (measures; doesn't fail) |
| A11Y-025 | Low | "Reading the job ad…" and its equivalents for letters and LinkedIn were shown on a disabled button only. | kb. | `announce()`. | kb |

## Open issues

| ID | Severity | Issue | Reproduce | What it needs |
|---|---|---|---|---|
| A11Y-O01 | **High** | **PDFs are untagged.** No structure tree, headings or list semantics. Text is selectable and now in reading order, and the file has a title and language, but a screen reader gets one flat run. The statement discloses this. | With pypdf, `/StructTreeRoot` and `/MarkInfo` are both absent from a downloaded PDF. | pdf-lib doesn't write tags. A different PDF route is a product decision. Until then, offer Word first to anyone who needs structure. |
| A11Y-O02 | Medium | **Many targets are under 44px, which the statement says they aren't.** At 1280px, on a typical report page, 42 of 44 controls are under 44px high: sidebar links are 38px and footer links 20px. axe's 24px rule passes. | The last column of the axe table below. | Make them larger (a design decision), or change the claim. See wording changes. |
| A11Y-O03 | Medium | **"Move to" saves on every change of the select.** On platforms where arrow keys change a closed select, each press would save a move. Focus and the announcement now hold, but stepping through options makes several saves. Type-ahead was what was driven here. | `OpportunitiesView.tsx`: `onChange` calls the action. | Test on Windows (T13), then add a Move button if it's a real problem. |
| A11Y-O04 | Low | `Expandable` ("Read more") puts the new text before its own button, so a screen reader has to go back to find it. | `client.tsx`. | Move the button or focus. Wants a person's view. |
| A11Y-O05 | Low | Score rings give the score both as the image's label and as visible digits, so it may be read twice. | `ScoreRing`. | Check with T5 first. |
| A11Y-O06 | Low | Labels as small as 10 to 11px in mono capitals, on a number of pages. They pass contrast and scale with zoom. | Sweep `minFont`. | Readability testing with students. |
| A11Y-O07 | Low | Data export is JSON and original files. Readable, but hard to use with a screen reader. | Download it. | A readable summary file, if T16 shows the need. |
| A11Y-O08 | Medium | **Admin:** `/admin/settings` has a `<pre>` that scrolls with no keyboard access at 390px. axe serious. This makes `npm run test:e2e` fail. | smoke. | `tabIndex={0}` with a name. Not fixed here: admin was off limits. One line for the OP-021 owner. |
| A11Y-O09 | Low | Older letters (`LetterReviewView`, `LetterDraftView`, reports from before versioned scoring) have arrow keys on their tabs but no tab panel. | Read the file. No such report is in the keyboard run. | Add panels when next touched. |
| A11Y-O10 | Medium | **All assistive technology is untested**, and so is everything under "Not tested" above. | The scripts below. | **Human gate.** |
| A11Y-O12 | **Critical**, not accessibility | **The landing page `/` returns HTTP 500** on the build synced at about 05:07 on 7 November: `Cannot read properties of undefined (reading '0')` at `g[i]![0]` in `src/app/_landing/demos/CohortDashboard.tsx:204`. That file changed at 05:06, not as part of this work; the previous build, about 20 minutes earlier, served `/` with no serious axe failures. It may be an edit in progress. | `npm run test:e2e`, or open `/` on a build of the tree. | Protected from this work, so not fixed. For the founder or whoever is editing that file. |
| A11Y-O11 | Low | With WCAG 1.4.12 text spacing forced on at 320×256, `/upload` overflows by 21px and one check page by 5px. Nothing overflows at 390px or wider. | Sweep field `spaced`. | Look at it alongside the 320px claim. |

**A11Y-O08 update, 7 November:** `tabIndex={0}` and an accessible name added. Not yet confirmed by a smoke run.

**A11Y-O12 update, 7 November:** cause confirmed and fixed by the coordinating session, which had added a demo group with 4 rows where the component indexes 5. `/` then returned 200 with no page or console errors in a browser. The full axe sweep of `/` has not been repeated.


### Checked, no defect found

These are scripted or automated results for the named scope, not assurance.

- **Drag is never required.** The only drop zone is the upload area, and its button does the same job. No `draggable` anywhere in the audited files.
- **Hover is never required.** No hover-only content in those files: no `group-hover`, no `onMouseEnter`, no `title` tooltips.
- **No keyboard traps** in any Tab walk, in any view; the Shift+Tab walk retraced the same stops at 1280px. Stops never landed offscreen, unnamed or without an indicator.
- **Skip link** on student pages comes first, shows on focus and jumps past the navigation.
- **Score colours have text equivalents.** Every ring has a spoken label and visible number, the overview shows a band in words, sidebar scores say "Score N", and no score-coloured badge is empty.
- **Page titles** are present and specific. **Language** is set. **One `h1`** on each route checked, and no skipped heading levels at the sizes measured. Focus goes from the sidebar to the main column on report pages: this shows as an upward jump on screen, and it's the reading order.
- **Exports:** selectable text in every template, and headings aren't left at the foot of a page (existing test in `tests/templates.test.ts`).

## Statement wording for legal review

The statement at `src/app/legal/accessibility/page.tsx` has **not been changed**. These findings suggest it says too much in places. Each is a proposal for whoever reviews it.

| Now says | Finding | Proposed direction |
|---|---|---|
| "Every page can be used with a keyboard, with a visible focus indicator and a skip link." | Before this audit, three fields had no indicator. Sign-in, onboarding and legal pages have no skip link. Admin wasn't audited. | "We test the main student tasks with a keyboard. Most pages have a skip link." |
| "touch targets are at least 44 pixels" | Untrue on most pages (A11Y-O02). | Remove the figure unless the design changes. |
| "Text colours meet AA contrast, and pages work from 320 pixels wide and at 400% zoom." | axe found no text contrast failures at the sizes tested, but couldn't judge the numbers inside score rings ("incomplete"; their colours were worked out from the tokens instead). Long tables scroll sideways at 320px. Measured by viewport, not real zoom. | "In automated checks of the main student pages…", and mention that some tables scroll sideways. |
| "Word downloads are fully accessible." | Untrue when written (A11Y-008). Now structured, with no screen-reader test. | "Word downloads have headings and lists. They have not yet been tested with screen readers." |
| "Downloaded PDF templates and letters are simple text documents but are not yet tagged PDFs." | Accurate. Also covers tailored CVs. | Add "tailored CVs", and suggest the Word version for screen readers. |
| "it has passed automated testing and keyboard checks" | Depends on the scope. Admin fails one axe rule at 390px. | State the scope and date of the checks, and that they are scripted. |
| "plus manual keyboard testing" | The testing in this audit was scripted, not manual. There's no record here of a person doing it. | Say "scripted keyboard checks", until the manual scripts have been run. |
| "Automated checks with axe-core across every page at desktop and mobile sizes" | Admin wasn't brought to zero, and the smoke test measured narrow widths only from this audit on. | Name what was covered. |
| "Offerpath is designed to meet … WCAG 2.2 at level AA. It is partially compliant" | This audit can't support or refute a compliance status. | For legal review, along with who decides it and on what evidence. Needs the independent audit the statement already mentions. |
| "Some charts on the careers dashboard have a text summary…" | Admin not audited, so not confirmed. | Confirm when admin is audited. |
| *(not stated)* | Scripts for real students exist, and haven't been run. | Add results once there are some. |

## Recorded automated results

Run on 7 November 2026 against a production build of the scratch copy. These go out of date as the tree changes: rerun them, using the commands in `docs/CLAUDE_REPORT_OP-027.md`.

### Keyboard tasks, per journey

The baseline is the same script before the fixes. It has fewer steps, because failures ended journeys early, in particular the tailor page crash (A11Y-001), and because the script gained steps afterwards.

| Journey | Baseline before fixes: pass / fail | After fixes: pass / fail / skip |
|---|---|---|
| sign-in | 3 / 2 | 5 / 0 / 0 |
| onboarding | 5 / 2 | 7 / 0 / 0 |
| upload | 7 / 7 | 14 / 0 / 0 |
| review before scoring | 5 / 1 | 6 / 0 / 0 |
| source document | 4 / 0 | 4 / 0 / 0 |
| report overview | 1 / 4 | 10 / 0 / 0 |
| check pages | 4 / 1 | 5 / 0 / 0 |
| line editor | 0 / 1 | 11 / 0 / 0 |
| tailor | 2 / 4 | 25 / 0 / 0 |
| letters | 2 / 5 | 15 / 0 / 0 |
| linkedin | 4 / 2 | 8 / 0 / 0 |
| opportunities | 4 / 7 | 14 / 0 / 0 |
| dashboard | 7 / 6 | 14 / 0 / 0 |
| share | 4 / 5 | 12 / 0 / 0 |
| privacy and export | 4 / 4 | 8 / 0 / 0 |
| narrow 390px | 5 / 0 | 5 / 0 / 0 |
| narrow 200% zoom (640x450) | 5 / 0 | 5 / 0 / 0 |
| focus safety net | 0 / 0 | 2 / 0 / 0 |
| whole run | 1 / 0 | 1 / 0 / 0 |
| **Total** | **67 / 51** | **171 / 0 / 0** |

### axe, per route and size

Violations under the WCAG 2.0, 2.1 and 2.2 A/AA tags. **A zero is not a pass of WCAG**: axe can't judge most criteria. It listed colour contrast as "incomplete" for numbers over score rings, on 9 routes; those weren't reviewed beyond the token calculation. The baseline had 7 serious `scrollable-region-focusable` results across 3 routes at narrow sizes (A11Y-013). `/onboarding` here redirects to the dashboard, as this student has finished onboarding; `#step1` to `#step3` are a new student's three steps, and their last column isn't measured. `/nonexistent-route` is meant to be a 404.

| Route state | 1280px | 200% (640×450) | 390px | 400% (320×256) | Tab stops at 1280px | Under 44px high / all controls, 1280px |
|---|---|---|---|---|---|---|
| `/onboarding#step1` | 0 | 0 | 0 | 0 | 5 | 0 / 0 |
| `/onboarding#step2` | 0 | 0 | 0 | 0 | 12 | 0 / 0 |
| `/onboarding#step3` | 0 | 0 | 0 | 0 | 5 | 0 / 0 |
| `/sign-in` | 0 | 0 | 0 | 0 | 11 | 1 / 11 |
| `/sign-in?admin=1` | 0 | 0 | 0 | 0 | 11 | 1 / 11 |
| `/legal/privacy` | 0 | 0 | 0 | 0 | 9 | 7 / 9 |
| `/legal/terms` | 0 | 0 | 0 | 0 | 8 | 7 / 8 |
| `/legal/accessibility` | 0 | 0 | 0 | 0 | 7 | 7 / 7 |
| `/legal/cookies` | 0 | 0 | 0 | 0 | 8 | 7 / 7 |
| `/legal/sub-processors` | 0 | 0 | 0 | 0 | 8 | 7 / 7 |
| `/privacy-notice` | 0 | 0 | 0 | 0 | 9 | 7 / 9 |
| `/nonexistent-route` (HTTP 404) | 0 | 0 | 0 | 0 | 1 | 0 / 1 |
| `/dashboard` | 0 | 0 | 0 | 0 | 115 | 43 / 153 |
| `/onboarding` | 0 | 0 | 0 | 0 | 115 | 43 / 153 |
| `/upload` | 0 | 0 | 0 | 0 | 22 | 19 / 25 |
| `/upload?source=:id` | 0 | 0 | 0 | 0 | 31 | 19 / 34 |
| `/reviews/:id` | 0 | 0 | 0 | 0 | 55 | 49 / 57 |
| `/reviews/:id/breakdown` | 0 | 0 | 0 | 0 | 57 | 41 / 58 |
| `/reviews/:id/source` | 0 | 0 | 0 | 0 | 42 | 42 / 44 |
| `/reviews/:id/source?correct=1` | 0 | 0 | 0 | 0 | 64 | 42 / 67 |
| `/reviews/:id/lines` | 0 | 0 | 0 | 0 | 41 | 43 / 43 |
| `/reviews/:id/examples` | 0 | 0 | 0 | 0 | 43 | 50 / 50 |
| `/reviews/:id/verbs` | 0 | 0 | 0 | 0 | 61 | 49 / 69 |
| `/reviews/:id/checks/quant` | 0 | 0 | 0 | 0 | 42 | 42 / 44 |
| `/reviews/:id/checks/verbs` | 0 | 0 | 0 | 0 | 42 | 42 / 44 |
| `/reviews/:id/checks/accomp` | 0 | 0 | 0 | 0 | 42 | 42 / 44 |
| `/tailor` | 0 | 0 | 0 | 0 | 29 | 20 / 31 |
| `/tailor/:id` | 0 | 0 | 0 | 0 | 41 | 35 / 54 |
| `/letters` | 0 | 0 | 0 | 0 | 24 | 19 / 26 |
| `/letters/:id` | 0 | 0 | 0 | 0 | 32 | 30 / 35 |
| `/letters/:id` | 0 | 0 | 0 | 0 | 31 | 30 / 34 |
| `/linkedin` | 0 | 0 | 0 | 0 | 28 | 21 / 30 |
| `/linkedin/:id` | 0 | 0 | 0 | 0 | 44 | 26 / 47 |
| `/opportunities` | 0 | 0 | 0 | 0 | 36 | 38 / 39 |
| `/templates` | 0 | 0 | 0 | 0 | 61 | 39 / 75 |
| `/practice` | 0 | 0 | 0 | 0 | 20 | 19 / 22 |
| `/practice/aptitude` | 0 | 0 | 0 | 0 | 21 | 22 / 23 |
| `/practice/interview` | 0 | 0 | 0 | 0 | 22 | 19 / 25 |
| `/practice/roadmap` | 0 | 0 | 0 | 0 | 22 | 24 / 24 |
| `/privacy` | 0 | 0 | 0 | 0 | 22 | 26 / 27 |
| `/help` | 0 | 0 | 0 | 0 | 25 | 26 / 27 |
| `/share/manage` | 0 | 0 | 0 | 0 | 17 | 19 / 19 |
| `/share/manage/:id` | 0 | 0 | 0 | 0 | 22 | 23 / 27 |

## Manual assistive-technology task scripts

**Status: none of these has been run. Every result below is blank.** They are for real students, ideally ones who use the technology every day. A facilitator should not be the only tester, and an automated run must never be entered here.

### Before each session

- Use a test account and the synthetic CV `tests/fixtures/cv.pdf`. Don't ask anyone to upload their own CV or show their own data.
- Get consent to take notes. Record the technology and version, the browser, and the task outcome. Don't record anything that identifies the student or their disability beyond what they choose to share.
- Say: "We're testing the service, not you. If something doesn't work, that's what we need to know." Pay participants, and let them stop at any time.
- Don't prompt or demonstrate. If someone is stuck for three minutes, or asks to move on, mark the task "Not completed", then ask what they expected.

### Who and what to cover

Aim for at least one student in each row. Add a row for whatever else your students use.

| Set-up | Tester | Date | Version | Tasks completed | Notes |
|---|---|---|---|---|---|
| NVDA with Chrome or Firefox, Windows | | | | | |
| JAWS with Chrome, Windows | | | | | |
| VoiceOver with Safari, macOS | | | | | |
| VoiceOver with Safari, iPhone | | | | | |
| TalkBack with Chrome, Android | | | | | |
| Keyboard only, no screen reader | | | | | |
| Voice Control or Dragon | | | | | |
| Browser zoom at 200% and at 400%, or a screen magnifier | | | | | |
| Windows contrast themes (forced colours) | | | | | |
| Dyslexia or reading support tools, such as text-to-speech | | | | | |

### Tasks

For each task record: **Completed** (alone / with difficulty / not completed), **time**, **what was announced or missing**, **the student's own words**, and a rating from 1 (very hard) to 5 (very easy).

| # | Task, as said to the student | It worked if | Listen and watch for |
|---|---|---|---|
| T1 | "Sign in as a student, then answer the set-up questions." | They reach the upload page. | Is each new step's heading read out? Are the on and off states of the preferences clear? |
| T2 | "Upload the CV file we gave you, and get your score." | They hear or see the score. | Is it clear the file was chosen? Is progress announced without being read over and over? |
| T3 | "Upload this second file (`lost-bullets.pdf`). Correct one line, then get it scored." | The corrected version is scored. | Can they tell the fields apart? Is the changed-line count useful or noisy? |
| T4 | "Upload this third file (`scan.pdf`). What happened, and what can you do next?" | They can say it wasn't scored, and find the paste option. | Is the explanation read when it appears? |
| T5 | "What's your score, out of what, and what's the first thing you'd fix?" | They give the number and a real fix. | Do they get the band from words, not colour? Is the score read twice? |
| T6 | "Find the text we scored, then find one check, such as Action verbs, and read its advice." | They reach both. | On a phone: can they find the "Results and feedback" menu? Does the source text remain readable? |
| T7 | "Take the short tour of the page, then leave it." | They complete it or leave it, and carry on. | Is it clear they're in a tour? Does Escape work? Where do they land? |
| T8 | "Go through your CV lines. On one line, use the suggestion or write your own, then change your mind." | The change is saved, then undone. | Is the suggested wording read, and the difference understandable? After saving, do they know it worked? |
| T9 | "Tailor your CV to this job ad. Accept one suggestion, reject one, edit one, then download the result." | They download a Word or PDF file. | Do they stay oriented after each decision? Is it clear which suggestion a button belongs to? |
| T10 | "Open the file you downloaded. Move through it by headings. Can you read all of it, in order?" | Headings work in Word; the text reads in order in the PDF. | **The Word and PDF checks in this register did not use a screen reader.** This task is the only real test of them. |
| T11 | "Get a cover letter reviewed by pasting this text. Change one paragraph, then download it." | The letter downloads. | Are the file button and paste box clear? Is the Cover letter / Job ad switch understandable? |
| T12 | "Paste this LinkedIn text and get a review. Use or skip a suggestion." | The report shows the decision. | Can they tell which section each button is for? |
| T13 | "Find a role closing soon and track it. Stop tracking it, then think again. Track one, and move it to Applied." | The role ends up at Applied. | Is the question read before they answer it? **Does moving a role with arrow keys save too soon?** |
| T14 | "On the dashboard, find what to do next, and download a document for one role." | The file downloads. | Is the table usable? Are the repeated buttons distinguishable? |
| T15 | "Make a share link for this report. Copy it. Then open the link, and switch it off." | The link opens, then stops working. | Is the warning read before they create it? Do they know they must copy it now? Is the shared page clear to a recipient? |
| T16 | "Turn off deadline reminders, download your data, and find how you'd delete your account. Don't delete it." | All three. | Do they hear that the setting saved? Can they make sense of the data file? |
| T17 | "Make a mistake on purpose: type a bad email at sign-in, and an empty delete confirmation." | They can say what's wrong and fix it. | Is the error read, and is it clearly tied to the field? |

### After the session

Ask: "What was hardest? What would you change first? Would you use this for a real application?" Add every problem to the issue register with the set-up and the task number. Fix blockers, then ask someone to run that task again.

### Results

| Date | Set-up | Task | Outcome | Rating | Issue raised |
|---|---|---|---|---|---|
| *None yet* | | | | | |
