# QA log

## 2026-10-26: full pass, demo mode (`npm start` on :3100, Chromium via Playwright)

Scope: every student screen and both admin screens from `design/*.dc.html`, at 1440px and 375px.

### What was run

| Area | Checks | Result |
|---|---|---|
| Auth | Logged-out access to 15 routes redirects to sign-in (admin routes to `?admin=1`); API/export return 401; invalid email error; demo cookie is httpOnly; sign out | Pass |
| Roles | Admin is redirected away from student pages; students can't reach `/admin`; second student gets 404 on first student's review | Pass |
| Onboarding | 3 steps, max 3 sectors enforced with message, saves and lands on upload | Pass |
| Upload | .txt rejected; blank (scan-like) PDF rejected with guidance; real PDF scored in ~3 s with Analysing screen; DOCX path covered by engine | Pass |
| Results | Overview, breakdown, all check pages, invalid check key → 404 | Pass |
| Line by line | Try another (counter drops), Use this rewrite persists after reload, copy | Pass |
| Examples / verbs | Tabs, search across categories, click-to-copy | Pass |
| Tailor | Empty submit error; pasted ad → keywords found/missing/soft, MUST flags, highlighted ad; Add keyword updates estimate; tailored side-by-side | Pass after fixes |
| Letters | Seeded review: checks, sign-off underline, keyword highlights; improved version; draft edit/delete/save; empty paragraph rejected; emoji OK; Word/PDF downloads valid | Pass after fixes |
| Opportunities | Type/sector/visa/30-day filters, Track, board move persists | Pass |
| Templates | 6 templates, Word + PDF downloads, unknown slug 404 | Pass |
| Privacy | Toggles persist, counts correct, ZIP export, delete needs exact "DELETE" | Pass |
| Admin | Dashboard KPIs/charts, students filters, CSV export, small groups hidden, TEF pack | Pass |
| Responsive | No horizontal page scroll at 375px on 12 key pages; tables and nav scroll inside their own containers | Pass |
| Accessibility | Every input labelled, every button/link named, one h1 per page, no duplicate ids | Pass after fix |
| Security | Search query with `<script>` and emoji is escaped; CSV cells neutralise formulas; security headers set | Pass |
| Console | No app errors (only deliberate 404 probes) | Pass |
| Automated | `npm test`: 10 engine tests + 19 database/RLS tests in PGlite; typecheck; lint; production build | Pass |

### Bugs found and fixed

1. **[Major] Link colours wrong everywhere** (green text on black buttons, green nav). Global `a {}` rule was unlayered and beat Tailwind v4 utilities. Fixed: base styles moved into `@layer base`.
2. **[Major] Rule-based letter draft invented a link between a CV line and a missing skill** ("…which taught me about SQL in practice"). Fixed: draft only restates CV lines, degree, skills line and the student's own note; regression test added.
3. **[Major] Near-empty CV scored ~40+** because line-based checks defaulted to 10/10 with no bullets. Fixed: those checks score 0 with guidance; test added.
4. **[Minor] Tailored estimate didn't change when adding keywords.** Fixed: recomputed on every toggle.
5. **[Minor] Tailored line read "drawing on stakeholder".** Fixed: tool-aware phrasing.
6. **[Minor] Letter draft too short (149 words) and didn't count the student's reason as "why this employer".** Fixed: now 250+ words from CV facts; reason phrased so the check passes.
7. **[Minor] PDF export dropped accented characters** (café → caf). Fixed: Latin-1 kept.
8. **[Minor] File inputs on upload/letter review had no accessible name.** Fixed.
9. **[Cosmetic] "1 of 1 reports", "Good structure. fix…", "sql" lower case, admin chart ticks 80/66/57.** Fixed.
10. **[Cosmetic] Skip link would never become visible on focus** (unlayered class). Fixed with a Tailwind `@utility`.

### Known limitations (not bugs)

- Demo mode keeps data in memory; restarting the server resets it. The demo cookie isn't signed, which is fine for fictional data but demo mode must never hold real data.
- University SSO needs SAML set up in Supabase per university; until then students use the email link.
- Deadline reminder emails are a stored preference only; no sender yet.
- Supabase mode is covered by the PGlite schema tests but not yet run against a live project (project creation needs approval).

**Verdict: PASS** (10 bugs found, all fixed and re-tested; 0 open)

## 2026-10-27: Claude Haiku scoring and score consistency

Requirement: uploading the same CV again must give the same score; a CV at 100 must stay at 100.

| Check | How | Result |
|---|---|---|
| Raw Haiku variance (why caching is needed) | Live: same 17 bullets judged 3 times, no cache | result/verb/kind identical; relevance differed on 3/17 |
| Same CV, same score | Live in the app: Sam_Lee_CV.pdf uploaded twice | 62 and 62, every area and check identical; 2nd upload judged 0 bullets |
| Re-exported CV | Live: same CV as .docx | 62, identical breakdown |
| Edits only re-judge changed bullets | Live: v3 after v6 judged 8 new bullets, reused 9 | Pass |
| Stronger CV scores higher | Live: v6 79 vs v3 56 | Pass |
| Guarantees with a random judge | `tests/scoring.test.ts` (run 10x): repeat uploads, re-exports, 100 stays 100, single-bullet edits, concurrency, judge failure caches nothing, per-sector | 19/19 pass every run |
| Off-list AI answers | Mocked API returning "excellent" | Vote rejected by schema validation, majority from valid votes |
| Score tampering | `npm run test:db`: students can't insert reports or change scores; judgment cache unreadable; judgments immutable | 28/28 pass |

Fixed during this pass: client bundle pulled in server crypto via `STAGE_OPTIONS` (moved to `lib/stages.ts`).

Notes: first upload of a new CV takes about 10-13 s (3 parallel Haiku calls); repeats are instant.
Changing the rubric or judge model (`RUBRIC_VERSION`) intentionally starts a fresh judgment cache.

**Verdict: PASS**

## 2026-10-27: security pass (own audit + independent review)

Threat model: a signed-in student calling the Supabase APIs directly with their own token, anonymous visitors, hostile CV / job ad / letter text, and AI cost abuse.

| # | Finding | Severity | Fix | Proof |
|---|---|---|---|---|
| 1 | Prompt injection in CV text; shared judgment cache let one student poison others' verdicts | High | Per-student cache; CV text delimited and declared data-only; deterministic guardrails (no "measured" without a number, weak verbs stay weak, duty phrasing stays duty, "high" relevance needs a sector term) | scoring + security tests |
| 2 | SSRF in job ad links (redirects, DNS to private IPs, hex IPv4-mapped IPv6) | High | Connect-time DNS check, manual redirects with per-hop checks, ports 80/443, size/time caps | 15+ attack URLs blocked live; tests |
| 3 | ReDoS: email regex quadratic on a long run of characters, about 35 min freeze from one 2 MB upload | High | Bounded regexes run per line; text capped at 40k chars; .txt removed | Reproduced (40k chars = 851 ms) then fixed (7 ms); test |
| 4 | Unbounded AI calls per upload (limit counted uploads, not bullets) | High | Max 60 bullets × 600 chars judged; all model inputs truncated; CV scoring 20/day | tests |
| 5 | Zip/Flate bombs in DOCX/PDF | Medium | Declared uncompressed size checked before inflating; PDFs over 10 pages refused | zip-bomb test |
| 6 | Unconfirmed sign-ups counted in admin KPIs; sharing defaulted on | Medium | Only confirmed accounts counted; share_progress defaults off (explicit opt-in) | DB test |
| 7 | Students could edit faculty/fee status and inject CSV formulas; insert fake applications | Medium | Institution fields not student-editable, control chars rejected; CSV cells sanitised; applications inserted only by the server for real opportunities, students can change status only | DB + CSV tests |
| 8 | Account deletion could leave CV files | Medium | Delete every object under the student's folder (errors stop the deletion); students can't upload directly; failed saves clean up their file | code review |
| 9 | Anyone could sign up with any email (incl. via the public auth API) | Medium | Partner domains only, enforced in app and in the sign-up trigger | DB test |
| 10 | Magic-link destination from request header | Medium | `NEXT_PUBLIC_SITE_URL` (required in production) | code review |
| 11 | AI limit race; demo mode unlimited AI by clearing cookies | Medium | Atomic reserve-before-call; demo-wide daily AI caps | code review |
| 12 | Students could write their own scores via the API | High | Reports read-only for students; server writes with service role | DB test |
| 13 | Demo cookie forgeable (admin view) | Low | HMAC-signed cookie | test + live (forged cookie → sign-in) |
| 14 | Raw DB errors to client; misleading privacy copy; missing IPv6 ranges | Low | Invalid ids return "not found"; only app-written messages shown; copy fixed; ranges added | tests |

Results: 30 unit/security tests, 36 database checks, lint, production build: all pass. Live smoke: Haiku scoring, SSRF refusal in the UI, public job ad read.

Known and accepted: a student can still "re-roll" a bullet's verdict by changing its words (bounded by guardrails and 20 scorings/day, affects only their own score); keyword stuffing can raise the keyword half of the sector check; no CSP header yet; sign-in email volume relies on Supabase's built-in rate limits; PDF text extraction runs in-process (bounded by size, page and text caps, not a separate sandbox).

**Verdict: PASS**

## 2026-10-27: launch tags T20–T23 and T13/T14/T17

Run against the production build (`npm run build && DEMO_MODE=true npm start`).

| Tag | What was checked | Result |
|---|---|---|
| T20-adviser | Flag off: CV route returns "Not available". Flag on, signed out: "Admins only". Admin opens a student, sees history, saves a note; the student sees it on their review. DB: consent enforced in `admin_student_detail`, `admin_cv_path`, `admin_add_note` | PASS |
| T21-tools | Interview practice: sector questions, STAR feedback (weak answer 0/10, structured answer ≥ 9/10, same answer same feedback). Aptitude: timer, scoring (1 of 5 marked correctly), worked answers. Roadmaps: "You are here" from the student's stage, sector from their own preference order. 5 unit tests | PASS |
| T18-landing | Matches Landing_v2 at 1440 and 375 (no sideways scroll). Pilot form: server-side validation, typed values kept after an error (bug found and fixed: React reset the form), honeypot, rate limit 5/hour per IP, saved server-only (DB tests: students and anonymous visitors can't read requests), notification to `SUPPORT_EMAIL`. Copy corrected to match the product (practice tools live; no MFA or "override" claims) | PASS |
| T22-polish | Favicon (replaced the Next.js default), SVG icon, Apple icon, social share image, web manifest, robots (only public pages indexable), sitemap. All return 200 with correct types and are linked from the page head | PASS |
| T17-a11y | New `npm run test:e2e`: crawls 77 pages as visitor, student and admin; axe WCAG 2.2 AA, console errors, sideways scroll at 375px. Found and fixed: text links told apart by colour only (now underlined in running text), account button's accessible name didn't contain its visible text. Now 0 serious/critical, 0 minor | PASS |
| T13/T14/T23 | `docs/OPERATIONS.md`, `docs/DEPLOY.md` (checked against the code: two wrong details fixed), `.github/workflows/ci.yml` (valid YAML; runs every check above), `vercel.json` (London region, two crons). Build warnings fixed (workspace root, dynamic require); CV parsing re-checked after the change: PDF uploaded, parsed in the worker and scored by Haiku | PASS |

Totals: 53 unit tests, 86 database checks, 77-page e2e and accessibility crawl, lint, typecheck, warning-free production build.

Not run: the CI workflow itself on GitHub (the project isn't a git repository yet); anything needing the live Supabase project (T24).

**Verdict: PASS**

## 2026-10-27: T24 live database

Project `levelup` (ref `gceybiizflndbkkjzprb`, eu-west-2, Free plan). All migrations applied with `supabase db push`.

Security advisor: flagged `my_university()` and `my_admin_university()` as callable by signed-out visitors (they returned null, but shouldn't be callable). Fixed in `20261027210000_lock_helper_functions.sql`, with a new database check that no security definer function is callable by `anon` (88/88). The remaining advisor notes are intended: server-only tables have RLS with no policies (deny all), and admin RPCs check the caller's role inside.

`npm run test:live` (new, `tests/e2e/live.mjs`) against the live project, 52/52:
- partner-domain gate (database trigger and sign-in page), profile linked to university
- onboarding saved; two uploads of the same CV saved with the identical score (Haiku), file in the private bucket, score shown after reload
- every student and admin page loads with no console errors
- RLS through the public API: another student can't read reports, profiles or CV files, can't make themselves admin, can't overwrite a score, can't call admin RPCs; signed-out visitors can't read universities or call helpers; another student's review URL shows not found; students are redirected from /admin
- pilot request saved; account deletion needs exact DELETE, signs out, removes profile, reports and files
- the test deletes everything it creates; the database was confirmed empty afterwards

Not tested: real sign-in emails (needs a verified sending domain in Resend and Supabase SMTP set to Resend).

**Verdict: PASS**

## 2026-10-27: real CV through the live app

A real, designed PDF CV (letter-spaced headings, no bullet characters, two-line bullets, side-by-side header) uploaded through the live app on the `levelup` project.

Found and fixed:
- **[Blocker] Real-world PDF layout scored 24 by the backup engine, and Claude was never used.** Letter-spaced headings ("W O R K E X P E R I E N C E") weren't recognised, so no sections or bullets were found, and with zero bullets the AI judge was skipped. Parser now matches spaced headings, treats lines starting with an action verb as bullets (not role lines with dates), and joins wrapped lines that start with a capital. Same CV: 26 of 26 bullets found, scored by Claude Haiku at 81, identical on re-upload. `RUBRIC_VERSION` bumped to `rubric-2026-10-27.3`.
- **[Major] Bullets attached to the wrong job.** The PDF drew all job headings before all bullets. Text is now rebuilt in reading order from positions on the page; two-column pages are detected and read one column at a time, contact column first.
- **[Major] Rewrites overclaimed.** "Supported…" became "Built…", "Helped manage…" became "Managed…". AI prompt and the rule-based verb list now keep the level of involvement ("Contributed to", "Jointly managed"). Checked with Haiku on four real lines.
- **[Major] Cover letters signed with a name guessed from the email address** ("Qa Real"). Letters now use the name on the CV.
- **[Minor] "AI-assisted" label shown on rule-based suggestions.** Now shown only when Claude wrote the suggestion.
- **[Minor] Name not found** when contact lines sit above it or the first line isn't the name (also affected the example CV). Now checks the first five lines.
- **[Minor] "Resize 0 bullets" step** when no bullets are found. Now asks for bullets.
- **[Minor] Cover letter pages and the landing page had no `<main id="main">`** for the skip link. Fixed; the e2e crawl now checks every page for exactly one.

New tests: parser for this layout, reading order (headings drawn first, two columns), the real worker on a PDF, honest rewrites.

Follow-up: present-tense verbs for current roles ("Run", "Lead") were flagged "Start with an action verb"; fixed, `RUBRIC_VERSION` now `rubric-2026-10-27.4`. The line-by-line view was walked through all 26 lines in the app.

Totals: 59 unit, 88 database, 52 live, 77-page e2e and accessibility crawl, lint, typecheck, build. Test data deleted after each live run; database confirmed empty.

**Verdict: PASS**

## 2026-10-28: line-by-line suggestions and Accomplishments

Same real CV, reviewed line by line.

Found and fixed:
- **[Major] Rule-based suggestions put `[number]` inside phrases** ("uses [number] customer preferences", "Hyros [number] reports", "an international [number] customer base"). Placeholders now go only at the end of the sentence, or straight after the change for lines that already say "Improved…" ("Improved email engagement by [X%] through…").
- **[Major] Suggestions ran to 30–36 words, with endings that didn't fit** ("reaching [number] people" on an SEO dashboard line). Long lines are cut at a clause break (", enabling…", ", and collaborated…", ": …") before the ending is added; every suggestion on this CV is now 25 words or fewer. "People" endings are used only for events, societies and similar. Vague claims become the placeholder ("significantly more output" → "[X%] more output"), and buzzwords are dropped. Endings rotate by line so the page doesn't read like one template.
- **[Major] Suggestions ignored the AI judgment that scored the line.** A line marked "result not sized" or "reads like a duty" could get no suggestion. Suggestions, and "Try another" without AI, now use the same judgment as the line score.
- **[Major] Accomplishments lost 3 points per duty line regardless of CV length**, so 4 duty lines in 26 scored 0/10. Now scored by share, like Action verbs: 4 in 26 scores 7, 4 in 6 still scores 0. Same CV now 85 (was 81). `RUBRIC_VERSION` now `rubric-2026-10-28.1`.

New tests: placeholder position and length on real lines, rewrite follows the line's judgment, Accomplishments by share.

Totals: 62 unit, 88 database, 52 live, lint, typecheck. The demo-mode e2e crawl wasn't rerun because the dev server is in live mode. Test data deleted; database confirmed empty.

**Verdict: PASS**

## 2026-10-28: "same CV scored 90, then 83"

Reported by the product owner in a live session. Both reports had identical text and bullets; the first was scored for Marketing and media, the second for Finance and banking (Sector relevance 100 vs 50). Scoring was deterministic; the sector had changed without the student noticing.

Fixed:
- **[Major] Onboarding pre-selected Finance and banking and Consulting** for every new student. It now starts with nothing selected (at least one is still required).
- **[Major] The upload form reset to the first profile sector on every upload.** It now defaults to the sector of the student's last CV review.
- **[Minor] "Down 7 since your last upload" when the last upload was for another sector.** The overview now says the last upload was scored for a different sector, so the scores don't compare.

Checked in the app on the reported account.

**Verdict: PASS**

## 2026-10-30: same CV, same score, whatever the sector or student

Product owner's requirement: the score must come from the CV alone, never from history or settings.

What could move a score for the same CV before, and the fix:
- **Target sector (counted 15%).** The Readiness Score is now CV quality only: Impact 30%, Length 23.5%, Clarity 17.5%, Structure 17.5%, Spelling 11.5% (the old proportions). Sector fit is shown under the score as "Fit for <sector> · Not counted in your score", and its step shows "Fit" instead of points.
- **Judgments cached per student and per sector.** A new student or sector meant Claude judged the bullets again, so Accomplishments could move (8 → 9). Judgments now live in one shared cache (`judgment_cache`) keyed only by a hash of the bullet's words, rubric and judge. Result, verb and duty/achievement are judged once per bullet for every sector; only relevance is per sector. The cache holds labels and hashes, no CV text and no student, and the first verdict is permanent, so it can't be re-rolled.
- **Rubric changes.** The only remaining cause. The overview now says the scoring was updated since the last upload, not "Down N".
- The "remember last sector" default from 28 Oct was removed; it isn't needed.

Proof on the live app with the real CV: one student uploaded it for Marketing and media, Finance and banking, Technology, then Marketing again, and a second student uploaded it for Consulting. Score 90 every time; Impact 80 every time; fit 100 / 40 / 60 / 100 / 70. A repeat upload took 3 seconds; a new sector about 16 (relevance only).

Also fixed: the live suite shared a domain with manual test accounts and failed to start when one existed (now has its own); the retention test was flaky at the exact 24-month boundary.

Totals: 63 unit, 91 database, 53 live (now checks a different-sector re-upload), lint, typecheck. Migration `20261030090000_shared_judgment_cache.sql` pushed to `levelup`.

**Verdict: PASS**

## 2026-10-30 · Tailor a CV from a job link

Feature: paste a job ad link and Offerpath reads the page, then Claude tailors the CV to it. It rewrites the profile and the most relevant bullets, names skills the CV shows, and lists keywords it left out because the CV doesn't show them. The tailored CV can be copied or downloaded.

- Job pages: the schema.org JobPosting is read first (title, employer, closing date, clean description). Greenhouse "Job Application for X at Y" titles are read too, and otherwise the page text is used. Lever puts the JobPosting about 716 KB into the page, so job-ad fetches now read up to 1.5 MB.
- Guardrails in code: a rewrite or profile that adds a number the CV doesn't contain is dropped. So are one-word swaps, unknown line ids, and skills already in the CV or also listed as unproven. The "after" match is measured on the tailored text, not estimated.
- Limit: 10 tailorings a day (`ai_usage` kind `tailor`, migration 20261030120000, pushed live). The rule-based version is the fallback.
- Live check, real CV: Monzo (Greenhouse) and Spotify (Lever) links were read in 1–3s and tailored by 11–13s. The result showed without a reload and the console had no errors. Checked at 1440 and 375 px.
- Bugs found and fixed during the pass: the result needed a reload (`?auto=1` was cleared with a navigation); Lever showed "the employer" (fetch cap); cosmetic rewrites; and one rewrite added "pacing", an activity the CV doesn't mention (prompt tightened).
- Tests: 67 engine, 94 database, 53/53 live; typecheck and lint clean (one older warning in smoke.mjs).

**PASS**

### Follow-up: formatted download (Word and PDF)

- `/api/tailor/[id]?format=docx|pdf` returns the tailored CV laid out as a CV. It needs a signed-in user (401 otherwise) and the student's own report.
- `structureCv` turns extracted text into name, contact line, headings, role lines with right-aligned dates, bullets and list items. Spaced-out headings use standard labels, and spaced-out taglines are rebuilt from the CV's words plus a built-in list. Bullets whose marks the PDF lost are recognised from the analysis, and wrapped lines are joined.
- Live check: downloaded both files through the buttons and checked the render. The Word file has a right tab at 9706 twips on A4 (Quick Look's preview ignores it; Word doesn't).
- Known limit: two-column skills sections in the source PDF come out of text extraction interleaved, so the student may need to tidy that section in Word.
- Tests: 68 engine, 94 database. The live suite passed 53/53 on 2 of 3 runs; the other run hit a 30s page-load timeout on the dev server.

## 2026-10-30 · CV design templates (12)

- 12 designs in `src/lib/cv-themes.ts`, built from one theme so the Word file, PDF and preview match: Classic, Centred, Modern, Executive, Compact, Technical, Skills first, Creative brief, Minimal, Academic, City, Bold. They differ in font, accent, name style, heading style (rule, rule above, double, band, bar, plain), date position, bullet and spacing. All single column.
- The gallery shows real previews and can switch to "My CV" (the latest upload with accepted rewrites). There's a full-page preview at /templates/[slug], and the tailored CV downloads in any template.
- ATS checks: each template's PDF is read back with the same extractor we use for uploads. Name, bullets, every heading and the role dates come back intact. Testing found that letter spacing splits words ("P R I Y A") above about 9% of the font size, so themes are capped at 7% (`MAX_TRACKING`) and a test enforces it.
- Band headings use a light tint with accent text. The macOS preview drops paragraph shading, and the earlier white-on-colour headings disappeared there.
- Live check: 12 cards, the "My CV" gallery and the full-page preview at 1440 and 375 px (no horizontal scroll, no console errors). All 24 "with my CV" downloads returned 200. Rendered Executive (PDF), Bold (Word) and Technical (PDF) and checked them.
- Tests: 70 engine (incl. 4 template tests), 53/53 live. Three new example CVs added to the content review list.

**PASS**

## 2026-10-30 · CV templates: layout polish pass (real CV, all 12 templates, PDF + Word + preview)

Rendered the founder's own CV and every example CV in all 12 templates and checked every page.

Fixed:
- Letter-spaced headings lost their names ("Publication history" and "Certifications" both became "Achievements"; "Languages" became "Skills"). Headings now keep their own wording.
- The tagline under the name ("Product growth & marketing technology") was mixed into the contact line. It is now its own line, found wherever the PDF puts it in the header.
- Wrapped lines in skills / certificates sections each became a separate bullet. Running text now stays one paragraph; short list lines stay bullets.
- PDF: bullets split across pages, and headings / job titles were left at the foot of a page. Each bullet and paragraph now stays whole, and a heading keeps the block under it.
- PDF: a few lines spilling onto an extra page. Spacing tightens slightly (down to 84%) when that saves the page.
- Contact line broke inside items ("London, / United Kingdom") and before separators. It now breaks between items and evens out two lines (PDF, Word, preview).
- Example CVs showed raw "|" separators on school lines; now "·" like everything else.

Tests added: heading names and list paragraphs, clean page breaks for every template (read back with pdf.js), contact line breaks. Engine tests 73/73. Live check: 12 cards, previews correct, 24/24 downloads with the real CV, no console errors.

Not verifiable here: Microsoft Word could not be scripted to export PDFs, so Word output was checked with Quick Look, which ignores right-aligned date tab stops and band shading. **PASS**
