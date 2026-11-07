# Accessibility findings

**DRAFT. PROVISIONAL.** OP-027 was still working when this was written and its report, `docs/CLAUDE_REPORT_OP-027.md`, did not exist. Everything here comes from [ACCESSIBILITY_REGISTER.md](../ACCESSIBILITY_REGISTER.md) as read on 7 November 2026, and **must be re-checked against the final register and report before use.**

**This is not an accessibility statement and makes no conformance claim.** The register says the same: automated tools and scripted key presses find a useful share of problems, and can't show that the service meets WCAG or that a person using assistive technology can use it.

**No student has tested anything. No screen reader has been used. No independent audit has been done.** Human gate open. `[TO SUPPLY: auditor and date, if commissioned. Founder.]`

## What was tested

Level: **locally tested,** on a production build of an isolated copy, in demo mode with fictional data and no keys. A simulated tailoring provider was patched into that copy only.

| Method | Coverage | Recorded result (provisional) |
|---|---|---|
| `npm run test:keyboard`: scripted key presses in Chrome for Testing 146 on macOS | 15 student journeys and narrow widths | Before fixes: 67 pass, 51 fail. After: 171 pass, 0 fail, 0 skip. |
| axe-core 4.14 with WCAG 2.0, 2.1, 2.2 A/AA tags (`tests/e2e/sweep.mjs`) | 43 route states at 1280px, 640x450, 390px, 320x256 | 0 violations on those routes. **A zero is not a WCAG pass.** Contrast over score rings was "incomplete" on 9 routes. |
| Word and PDF files | `tests/accessibility.test.ts`; files read with python-docx and pypdf | Word has headings and language. PDF read order fixed. PDFs untagged. |
| Contrast | Worked out from design tokens, plus axe | Field edges and switch fixed to 3.25:1 or better |

25 issues were fixed in that audit (A11Y-001 to 025), one of them critical for all users (tailor page 500 on hyphens). "Fixed" means the named check passes on the tree, not that a person confirmed it.

## Not tested

- **`src/app/admin/`, the careers staff pages: not audited.** Smoke test only, with one failure (A11Y-O08). OP-021 and OP-022 record 0 axe violations on their own new pages, in dev mode.
- **Landing page:** smoke test only, with no keyboard task.
- **Screen readers, voice control, magnifiers, real phones:** none used.
- **Safari, Firefox, Edge, Windows, Android, iOS:** none. Chrome on macOS only.
- **Word and Acrobat themselves.** Files were inspected, not opened with assistive technology.
- Real AI output, real sign-in and real email.
- Practice, templates and help: axe and Tab walks only.

## Open issues (provisional)

| ID | Severity | Issue |
|---|---|---|
| A11Y-O01 | **High** | **PDFs are untagged.** A screen reader gets one flat run of text. Word first is the interim advice. |
| A11Y-O02 | Medium | **Many targets are under 44px,** which the published statement says they aren't. 42 of 44 controls on a typical report page. |
| A11Y-O03 | Medium | "Move to" saves on each change of a select. Could save repeatedly on platforms where arrow keys change a closed select. Needs a Windows test. |
| A11Y-O08 | Medium | `/admin/settings` has a scrolling `<pre>` with no keyboard access at 390px. axe serious. **Makes `npm run test:e2e` fail.** |
| A11Y-O10 | Medium | **All assistive technology untested.** Human gate. Task scripts exist; none run. |
| A11Y-O04, O05, O06, O07, O09, O11 | Low | Read-more order; score may be read twice; labels of 10 to 11px; data export hard to use with a screen reader; older letter tabs without panels; overflow at 320px with text spacing forced. |

## The published statement goes further than the findings

**Update, 7 November 2026:** the wording quoted here has since been changed. See [CLAUDE_REPORT_CLAIMS_FIXES.md](../CLAUDE_REPORT_CLAIMS_FIXES.md).

The statement at `/legal/accessibility` has not been changed, and the sign-in page says "Designed to WCAG 2.2 AA". The register lists the statement's wording for legal review. In particular:

| Statement says | Finding |
|---|---|
| "touch targets are at least 44 pixels" | Untrue on most pages |
| "Word downloads are fully accessible" | Now structured; no screen-reader test |
| "Every page can be used with a keyboard, with a visible focus indicator and a skip link" | Sign-in, onboarding and legal pages have no skip link. Admin not audited. |
| "manual keyboard testing" | The testing was scripted. No record of a person doing it. |
| "partially compliant" | This audit can't support or refute a compliance status. Who decides, on what evidence, is open. |
| "We aim to reply within 5 working days" | No owner, and `SUPPORT_EMAIL` is unset, so the address shows as a placeholder. |

**A university should treat the register, not the statement, as the current finding.** `[TO SUPPLY: reviewed statement. Lawyer and accessibility reviewer.]`

## What a university should plan for

Public-sector universities have their own duties. A VPAT or conformance report can't be supplied from this evidence. `[TO SUPPLY: whether and when one will be commissioned. Founder.]`
