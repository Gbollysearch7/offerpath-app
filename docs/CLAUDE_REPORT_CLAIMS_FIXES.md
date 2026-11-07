# Claims fixes report

Prepared 7 November 2026 by Claude, for review by people. Nothing was committed, pushed, deployed or sent. No live service was touched: one public web page was read (Anthropic's commercial terms). No dev server or `next build` was run. **No lawyer has seen any of this wording.**

## Result

Every claim OP-029 reported was checked against code and docs. **None of them was correct as stated, so all were changed**, with four nuances:

- **Anthropic.** OP-029 says the DPA and no-training claims aren't evidenced. True for this project, but Anthropic's published commercial terms do say "Anthropic may not train models on Customer Content from Services" and incorporate its DPA by reference. Whether this account is on those terms wasn't checked. The pages quote the published terms and don't say an agreement exists.
- **Group-of-five exports.** Partly right: summary reports and the named list do have the threshold. "Always" was wrong, because the access log export names students regardless and the named list shows individuals once five share.
- **Deletion.** The listed items do go straight away (`removeUserFiles`, `delete_my_account`, `sweepUserFiles`). "All" was what was wrong.
- **Accessibility statement.** The PDF limitation was accurate, and is kept and extended.

Checked and left, as correct or a clearly stated plan: "Files stored in the UK or EU" (recorded in QA.md, not re-read today), "Only partner university emails" (`isPartnerDomain`), "Every student can export or delete", and the landing roadmap's "Calibrate with advisers" under PILOT TERM, which is future tense.

## Claims table

Reviewer: **L** lawyer or DPO, **F** founder, **A** accessibility reviewer. Every row needs its reviewer's approval. "Draft" pages show a banner saying so.

| # | Where | Old text | New text | Evidence | Review |
|---|---|---|---|---|---|
| 1 | `src/app/legal/privacy/page.tsx` | "Backups are overwritten within 35 days." | "Any backup keeps deleted data until that backup expires." plus a marked `[Founder decision…]` placeholder with no period | `OPERATIONS.md` "None of this is running yet"; FD-03, FD-04; procurement 03 | L, F (FD-84) |
| 2 | Same | "inactive for {months} months, when it is deleted automatically" | "If your account is inactive for {months} months, we email you a warning and delete it 30 days later unless you sign in." | `src/lib/jobs.ts`, `src/lib/email.ts` | L |
| 3 | Same | (not mentioned) | "Copies held by our service providers… follow those providers' own retention periods, and we can't recall them." | Procurement 03 | L |
| 4 | Same | "under data processing agreements and approved safeguards such as the UK International Data Transfer Addendum" | "A data processing agreement and an approved transfer safeguard with each of them are required before any pilot goes live." plus placeholder | None on file: procurement P-06, C-03 | L, F (FD-80) |
| 5 | Same; `src/app/privacy/page.tsx` | "Under Anthropic's commercial terms it isn't used to train their models." / "Anthropic doesn't use it to train its models." | "Anthropic's published commercial terms say it may not train models on customer content." Notice adds a placeholder to confirm the account | anthropic.com/legal/commercial-terms, read 7 November 2026; F-10, P-07 | L, F (FD-81) |
| 6 | `src/app/legal/sub-processors/page.tsx` | "Each is bound by a data processing agreement. We tell partner universities before adding or replacing one." | "A data processing agreement with each of them is required before any pilot goes live. Before a pilot starts, we'll agree with the university how it's told about changes to this list." | P-06; no process exists | L, F (FD-80, FD-88) |
| 7 | `src/lib/legal.ts` (shown on 6) | Anthropic "under a data processing agreement and UK International Data Transfer Addendum"; Resend "under a data processing agreement" | "…A data processing agreement and UK transfer safeguard are required before any pilot goes live"; "…A data processing agreement is required before any pilot goes live" | P-06 | L, F |
| 8 | `src/app/_landing/Landing.tsx` TRUST | "Built for UK GDPR"; "…to Anthropic in the US under a data processing agreement and the UK transfer addendum, and isn't used to train their models." | "Built with UK GDPR in mind"; "…to Anthropic in the US. A data processing agreement and a UK transfer safeguard are required before any pilot goes live. Anthropic's published commercial terms say it may not train models on customer content." | P-06, F-10; no legal review | L, F |
| 9 | Landing ROAD | "Ready for pilots"; "Built in the open, ready for our first pilot universities."; "Free pilots open for UK universities" | "Getting ready for pilots", "…are built and tested in development. Backups, email delivery and legal agreements must be in place before any pilot goes live."; "Getting ready for our first pilot universities."; "Taking requests for free UK university pilots" | Procurement 07; no backups, no recorded email delivery, 11 of 22 migrations in git; nothing shows the work is public | F (FD-87) |
| 10 | Landing TRUST | "Accessible by design": "Designed to meet WCAG 2.2 AA and checked with automated and keyboard testing…" | "Accessibility in progress": "We're working towards WCAG 2.2 AA. The main student tasks are checked with automated tools and scripted keyboard tests. Screen reader testing and an independent audit haven't been done yet." | `ACCESSIBILITY_REGISTER.md` | A, F |
| 11 | Landing TRUST | "University single sign-on or a one-time email link." | "A one-time email link, for partner university email addresses only. Single sign-on is built, but isn't yet connected for any university." | S-10 | F (FD-89) |
| 12 | `src/app/sign-in/page.tsx` | "Designed to WCAG 2.2 AA"; "UK GDPR" | "Working towards WCAG 2.2 AA"; "Built with UK GDPR in mind" | Register; no legal review. "UK GDPR" wasn't in the brief's list but is in OP-029's row | A, L |
| 13 | `src/app/legal/accessibility/page.tsx` | "touch targets are at least 44 pixels" | Removed. Known limitation: "Many buttons and links are smaller than 44 pixels. On a typical report page, most controls are." | A11Y-O02: 42 of 44 controls | A, L |
| 14 | Same | "Word downloads are fully accessible." | "Word downloads have headings and lists. They have not yet been tested with screen readers." | A11Y-008; `src/lib/documents.ts` | A, L |
| 15 | Same | "plus manual keyboard testing"; "across every page" | "on the main student and public pages… plus scripted keyboard checks, in Chrome on macOS, in November 2026. No person has yet run the manual keyboard or assistive technology tests." | Register, "Not tested" | A, L |
| 16 | Same | "It is partially compliant…"; "Every page can be used with a keyboard… and a skip link"; "Text colours meet AA contrast, and pages work…"; "We aim to reply within 5 working days" | "We can't yet say how far Offerpath meets them…" with status placeholder; "We test the main student tasks with a keyboard. Most student pages have a skip link."; scoped automated result; placeholder for owner and time | Register's wording table; procurement 05 | A, L, F (FD-86) |
| 17 | `src/app/privacy/page.tsx` | "Deleting your account removes it all straight away and can't be undone."; button "Delete everything" | "Deleting your account removes these straight away and can't be undone. A few things are kept or expire later, such as records your university holds, logs of staff access and copies at our service providers. See what's kept."; button "Delete my account and data" | Procurement 03; `src/lib/repo/supabase.ts` | L |
| 18 | Same | "Reports your careers service exports always leave out groups smaller than five." | "Summary reports… leave out groups smaller than five. If five or more students share their progress, the careers team can also export a list of those students, with each one's student ID, course, scores and activity. It can also export its log of staff access to student records." | `src/app/admin/export/route.ts` | L |
| 19 | `src/app/sign-in/page.tsx` | "Your account and data have been deleted." | "Your account has been deleted, with your CVs, reports and letters." | As 17 | L |
| 20 | `docs/legal/DPIA_TEMPLATE.md` | "calibration with advisers"; "DPA + UK IDTA with Anthropic; no training"; "inactivity purge, backup expiry"; "DPAs, breach notification terms, encryption in transit and at rest"; "exports hide groups under five" | Each marked `[NOT IN PLACE…]` or `[NOT CONFIRMED…]` with its decision; export wording corrected; draft banner added | `CALIBRATION_RUNBOOK.md` "No real calibration has been run"; S-03; items above | L, DPO |
| 21 | `docs/legal/DPA_SCHEDULE_TEMPLATE.md` | "Deletion of all controller data within 30 days…" | `[OPEN: NOT BUILT. Proposed: …]` (FD-85) | Search of code and migrations; procurement 03 | L, F |
| 22 | Same | "up to 30 days"; "30 days' notice"; "under the UK IDTA"; "at rest"; "Annual security summary" | Each marked `[OPEN: …]`; draft banner added | FD-03, FD-80, FD-88, P-08 | L, F |
| 23 | Same; `docs/OPERATIONS.md` | "within 48 hours" vs "within 24 hours" | **No number chosen.** DPA has a marked gap, OPERATIONS keeps its text with a note pointing at FD-82 | C-02 | L, F |
| 24 | Sign-in selector | "University of Northfield"; `you@northfield.ac.uk` | See below; `you@your-university.ac.uk` | Below | F (FD-89) |

Draft banner added to the privacy notice, sub-processors page and accessibility statement, through a new `draft` prop on `src/app/legal/LegalPage.tsx`: "Draft for legal review. No lawyer has approved this page yet. Text in [square brackets] is waiting for a decision and isn't a statement of fact."

## SSO

**The defect, confirmed.** `SignInForms.tsx` hard-coded one university. Whatever a student typed, the form's hidden field always sent `northfield.ac.uk`, so production showed a fictional institution and no real university's SSO could ever be reached.

**Now:**

| Situation | What happens |
|---|---|
| Production today (`SSO_UNIVERSITIES` not set) | No selector and no SSO button. Email link only. |
| A real university in `SSO_UNIVERSITIES="University of Example=example.ac.uk"` | A native `<select>` of the listed universities. The chosen domain goes to Supabase `signInWithSSO`, which redirects to the provider. |
| Provider missing in Supabase, or an unlisted domain posted by hand | "University sign-in isn't set up for your university yet. Use the email link below." An unlisted domain never reaches Supabase. |
| Demo mode only | The fictional university, beside the existing demo banner. A production server with no database shows none. |

**Not proved:** no real identity provider has been used. Supabase was stubbed at `fetch`. The email route needs real delivery, which is still unrecorded. Fictional names remain in demo data and labelled sample CVs and landing demos, which I left.

New: `src/lib/sso.ts`, `SSO_UNIVERSITIES` in `.env.example` and `docs/DEPLOY.md`. Changed: `SignInForms.tsx`, `sign-in/page.tsx`, `actions/auth.ts`. No migration.

## Founder decisions added

`docs/FOUNDER_DECISIONS.md` section B2: FD-80 DPAs and safeguard; FD-81 Anthropic terms; **FD-82 breach 24 or 48, no recommendation**; **FD-83 staff MFA, recommending it's required for staff and admin accounts** (not built); FD-84 backup wording; FD-85 contract-end deletion; FD-86 accessibility status and reply owner; FD-87 when "Ready for pilots" can return; FD-88 sub-processor notice and security summary; FD-89 SSO; FD-90 items left unchanged.

**New commitment to confirm:** "required before any pilot goes live" follows the brief's example, but it's now a public promise (FD-80).

## Tests

| File | Change |
|---|---|
| `tests/public-claims.test.ts` | **New, 7 tests:** SSO parsing; production offers none; no hard-coded institution in source; a configured university is offered; demo only; the action sends the chosen domain and refuses others; the old claims stay gone and drafts stay marked |
| `tests/e2e/keyboard.mjs` | "Delete everything" to "Delete my account and data". **Not run** |
| `tests/e2e/live.mjs` | Same, twice. **Not run** |

No engine or database test asserted the old wording.

## Validation

Run on the shared tree at about 06:08 on 7 November 2026, with other agents working.

| Check | Result |
|---|---|
| `npm run typecheck` | Exit 0 |
| `npm run lint` | Exit 0, no output |
| `npm run test:engine` | Exit 0: 1000 tests, 1000 pass, 0 fail, 0 skipped |
| `npm run test:db` | Exit 0: 489 PASS lines and 0 FAIL lines across both suites; security suite reports 95 passed |
| `git diff --check` | Exit 0 (tracked files; new files checked separately for trailing whitespace: none) |

Not run: `next build`, dev server, `test:e2e`, `test:keyboard`, `test:sweep`, `test:live`. **No page was looked at in a browser,** so the banner, selector and longer landing text haven't been seen. OP-027 should re-run `test:keyboard` and `test:sweep`, because the selector and banner are new on those pages.

## Follow-ups and limits

- **Shared edits:** other agents' uncommitted work was left alone. Each edit was an exact-match replacement made against the file at that moment.
- **Now stale, left for their owners:** the "Statement wording" table in `ACCESSIBILITY_REGISTER.md` (OP-027) and `docs/procurement/` details. I added a one-line pointer to this report in procurement 01, 03, 05 and 08, but not to 09's conflicts C-01, C-02, C-04, C-05, C-08 or K-rows, which still quote old wording. RESTORE_PROCEDURE's 24 hours is untouched, listed under FD-82.
- **`OPERATIONS.md` still says 35 days** for its planned dumps, pending FD-03.
- **`legal.lastUpdated` still shows 27 October** on all legal pages. FD-25 says to change it at legal sign-off.
- **Not changed, for review (FD-90):** Plausible and webhook; the retention email; "processes it on their behalf under UK GDPR" on `/privacy`, and the controller and processor statements, which depend on a contract no university has signed.
- **The accessibility statement's remaining items** ("Charts and score rings have text alternatives", "Animations stop…") were kept from the register's findings or unchallenged, not newly tested.
- **Public placeholders:** the marked placeholders are visible on public pages if this ships before the decisions are made. That's deliberate.

## Migration impact

None.
