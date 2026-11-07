# Offerpath batch 06 report: OP-022, privacy-aware institutional analytics

Prepared 7 November 2026 by Claude, for independent acceptance review by Codex. Nothing was committed, pushed or deployed.
No migration was applied. No live database, `test:live`, paid provider, email or `next build` was used. All keys were blank in
the browser check, which ran in a scratch copy.

## What this task does and does not claim

- **Claims:** the careers dashboard and its exports now separate invitations, activation, completed reviews, useful edits, repeat
  use and adviser referrals. Each figure shows its definition, date range, exclusions and denominator. Known synthetic events give
  known totals in the real SQL. Named differencing attacks across filters, date ranges and exports fail in tests.
- **Does not claim:** that identification is impossible against someone who already knows most of the population. Rounding and
  hiding are not differential privacy (see Limitations). Nothing has run on real Supabase or with real data, no statistician or
  privacy lawyer has reviewed the rules, and no adviser or university has seen the page.
- **"Invitations" is not invitations sent.** Offerpath sends none. The figure counts imported student records, and the page says so.
- **Scores:** unchanged. No scoring, rubric, judgment or fingerprint file was edited, `admin_analytics` is declared `stable` and
  a test compares every report byte for byte around a read. `analytics_normalise_text` copies the normaliser; it does not alter it.

## Task status

| Task | Status | Notes |
|---|---|---|
| OP-022 | Implemented → Locally verified | One **unapplied** migration. No human or operational gate passed. |

## Founder decisions needed

1. **Keep the named student CSV?** I kept it, off the dashboard, whole-list only, logged (`?pack=students`). It is one row per
   sharing student with score and flag. Removing it is the stronger reading of "no universal surveillance". Your call.
2. **Counting students who don't share.** Activation and the account total include them, as numbers only, because the page needs
   them to say how many students it leaves out. The notice says sharing is optional but not this. Needs legal review.
3. **The numbers themselves:** minimum 5, rounding to 5, averages and percentages at 25. Five was already the promise. The other
   two follow common UK practice from my memory of HESA's standard, which I did not check against the source. Please have them reviewed.
4. **Small pilots will see a lot of "Hidden".** Under 10 students no count within a group can show, and under 25 no average or
   percentage. I took privacy over usefulness. A small pilot needs its evidence from the pilot design, not this page.
5. **`trackedApplications` (OP-019's question).** Role-derived applications count, since the student chose to track them. Definition says "including roles they only saved".

## Changed files

**New:**

- `supabase/migrations/20261108090000_institutional_analytics.sql` (**not applied**).
- `src/lib/analytics/`: `rules.ts`, `types.ts`, `definitions.ts`, `csv.ts`, `sample.ts`.
- `tests/analytics.test.ts` (16), `tests/analytics-db.test.ts` (23), `tests/analytics-actions.test.ts` (5),
  `tests/fixtures/analytics-publication-cases.json`.

**Mine to change:** `src/app/admin/page.tsx` (rewritten), `src/app/admin/export/route.ts`, `src/app/admin/students/page.tsx` (export section only).

**Shared files, small edits:**

| File | Edit |
|---|---|
| `src/lib/repo/types.ts` | `adminAnalytics` replaces `adminOverview` and `adminOutcomesPack`; their types removed |
| `src/lib/repo/supabase.ts`, `src/lib/repo/demo.ts` | The same swap |
| `src/lib/seed-data.ts` | `ADMIN_SAMPLE` keeps only `students`; the old unrounded sample figures are gone |

**Tests I changed that I did not write:**

| File | Change | Reason |
|---|---|---|
| `tests/adviser-actions.test.ts` | The named list is now `?pack=students`; `?q=…` asserts 400 instead of 200; the no-trail test also covers `pack=students` | The default export is aggregate, and narrowing is refused |
| `tests/adviser-db.test.ts` | `admin_overview`/`admin_outcomes_pack` become `admin_analytics` in the role lists and permissions probe; the two-university count reads exact rows as owner | Old functions dropped; a published count of 1 or 2 is hidden by design |
| `supabase/tests/security.test.mjs` | Same swap in four places; the outcomes-pack line removed | Old functions dropped |
| `supabase/tests/schema.test.mjs` | Old overview and pack checks rewritten for exact rows and published form; the `improved10` series check removed (now in `analytics-db`, "scores are compared only within one version set"); one `op022:` block added | Old functions dropped; extension requested |
| `tests/e2e/live.mjs` | The student-denied RPC check calls `admin_analytics`. **Edited, not run** | Old function dropped |

## Behaviour

**Measures.** All text is in `definitions.ts`, used by both page and files.

| Measure | Counts | Out of | Left out |
|---|---|---|---|
| Invitations | Imported student records, today | None | Staff; sign-ups with no record |
| Activation | Records matched to a confirmed account made in the period | Imported records | Unconfirmed, staff, deleted; no-record accounts (count shown) |
| Sharing | Confirmed accounts that share, today | Confirmed accounts | Unconfirmed, staff, deleted |
| Completed reviews | Students with a CV text first reviewed in the period, scored and fully assessed; plus distinct versions | Sharing students with an account by period end | Duplicates, incomplete, failed (each counted) |
| Useful edits | Students who made an edit they still keep: CV line, correction, tailored or letter decision, LinkedIn section past version 1 | Same | Rejected, undone, never acted on |
| Repeat use | Students with a further, different version reviewed in the period | Students with a completed review by period end | Same text again; first reviews |
| Adviser referrals / accepted | Students referred, not withdrawn; of those, accepted | Sharing students / those referred | Withdrawn; stopped sharing |
| Tracking, interview, offer | Self-reported, by role added in the period | Sharing students | Labelled unchecked and not an employment outcome |
| Scores | Average latest; improved by 10+ on different text; bands | Students in the one version set | Other sets (count shown), no set, incomplete |

**Duplicates (OP-019's open item).** `reuploaded` and `improved10` are gone. `analytics_doc_key` hashes the same normalised text the
student's dashboard compares, so a re-export is a duplicate, including of a CV reviewed in an earlier period. Failed analyses save no report, and are counted from `analysis_jobs` only as an exclusion.

**One version set (OP-010).** Figures come from the set most students are in, named on the page; a tie goes to the alphabetically last
identity. Others are set aside and counted. A jump from 40 to 90 across versions is not an improvement. OP-010's limitation that averages included withheld and incomplete scores is closed for this page.

**Publication rules** (SQL, because an admin can call the database directly; `rules.ts` mirrors them for demo mode; one fixture checks both):

| Attack | Control |
|---|---|
| Filter differencing | `admin_analytics(p_period)` has no filter. No cross-tabs. Exports with `q`, `faculty` or `filter` get 400, logged nothing |
| Sliding date windows | Named terms and years only. `admin_overview` and `admin_outcomes_pack`, which took any dates over PostgREST, are dropped |
| Year minus term; all time minus year | A term or year is withheld while any period it could be subtracted against holds 1 to 4 people |
| Total minus visible groups | Small groups are hidden unnamed. If what's hidden totals under 5, the next smallest goes too |
| Subtracting two counts | Rounded to 5, so a difference is never exact and one student moves a figure by 0 or 5 |
| "All" or "none" in a group | A count within a group needs 5 on each side. Hidden looks the same either way |
| Backing out one score from averages | Average needs 25, whole number, beside a rounded count: the range exceeds 100 points |
| Percentages reversed into counts | Calculated only from the rounded figures, and only at 25+ |
| Watching a figure move | Figures stop at the end of yesterday |
| Comparing screen and file | One function, one published object. Files are built from it |

**No surveillance by default.** The dashboard reads only published figures, and a test holds it to that. The default export is aggregate.
The named list has to be asked for, is whole-list only, and is logged. Advisers get no dashboard.

**Removed from the page, on purpose:** the weekly score chart (a sliding set of small windows across version sets), the
home/international chart (now one breakdown among three), "new this month". The TEF pack is now described as context, not evidence.

**Sample data.** Banner on the page, first row of each file, `SAMPLE-` in the file name, also on the named list in demo mode. Sample figures run through the same rules.

**What suppression does and doesn't protect.** Careers staff can already see a sharing student's score, change, last activity, flag and
referrals on the student list and page, by that student's consent (OP-021). So for those attributes the rules protect the figures and files that travel to other people, not against the admin. Self-reported offers and interviews, useful edits, repeat use and failures aren't shown per student, so there the rules do protect against the admin too.

## Validation: commands and actual results

Run on this tree, 7 November 2026, with other agents working in it.

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0, no problems reported |
| `npm run test:engine` | exit 0: **938 tests, 938 pass, 0 fail** |
| OP-022 tests alone | **44 tests, 44 pass, 0 fail** (16 + 5 + 23) |
| `npm run test:db` | exit 0: **452 PASS, 0 FAIL**, 9 of them `op022:` |
| `git diff --check` | exit 0 |

Mid-task, `tests/adviser-actions.test.ts`, `tests/security-tenancy.test.ts` and typecheck failed because the fixes agent was part way through `src/lib/analysis/explanation-check.ts`. A re-run after they finished was clean, and those results are the ones above.

**Coverage of the acceptance.** All in `tests/analytics-db.test.ts` (real SQL) unless named.

| Requirement | Test |
|---|---|
| Synthetic events give known totals | "known synthetic events give known exact totals"; "what a careers admin sees is those totals under the rules" |
| Duplicates and failures don't inflate | "duplicates and failed analyses don't inflate completion"; "a duplicate of a CV reviewed in an earlier period" |
| One version set | "scores are compared only within one version set"; "improvement needs two different texts" |
| Differencing by filter | "a filter attack"; "a group attack"; "an attribute attack" |
| Differencing by date | "a date attack"; "a term attack"; "a year attack"; "a timing attack"; "a neighbour attack" |
| Differencing by export | `analytics-actions`: "a narrowed export is refused", "a date range can't be chosen", "screen and every file show the same numbers" |
| Arithmetic attacks, every size in a grid | `analytics.test.ts`: group-size, subtraction, adding one student, averages |
| Not employment; selection bias | `analytics.test.ts`: "the wording never treats…"; page and file checks |
| Definition, range, exclusions, denominator | `analytics.test.ts`: "every measure the blueprint names…"; browser |
| Sample labelled | `analytics.test.ts`, `analytics-actions`, browser |
| No surveillance by default | `analytics.test.ts`: "the dashboard names no student"; `analytics-actions`: "the default export is the aggregate figures"; "nothing a careers admin receives could name a student" |
| Consent, two universities, roles | "consent:" (two tests); "two universities" |
| No score changes | "reading the figures changes no score and no report" |
| SQL and TypeScript agree | "the SQL rules give the same answers"; "what counts as the same CV"; "named periods have the same boundaries" |

**Do the tests bite?** 41 controls were undone one at a time in a scratch copy, running only the three OP-022 files.

- **39 of 41 were caught on the first run**, against a clean baseline.
- **One miss was a real gap, now fixed.** Removing `share_progress` from `analytics_reviews` went unnoticed, because the student rows filter too, but the version rows rely on it, so a non-sharing student's score could have reached the averages. I added "consent: the score of a student who doesn't share…"; re-running that mutation fails that test. The code itself was right.
- **One miss is an equivalent mutant.** Dropping "two versions" from the improved numerator changes nothing: with one version, first equals latest, so the difference can't reach 10.
- Script: `/private/tmp/claude-501/-Users-gbolahan-Documents-NEW-ME-LevelUp/70ce5228-d909-41a7-b749-2bc52131c2e0/scratchpad/op022-mutate.py`. Results: `/private/tmp/claude-501/-Users-gbolahan-Documents-NEW-ME-LevelUp/70ce5228-d909-41a7-b749-2bc52131c2e0/scratchpad/op022-mutate.txt`.

**Browser.** Scratch copy with `node_modules` symlinked, no `.env*`, keys blank, `next dev` on port 3922, stopped afterwards. Script `/private/tmp/claude-501/-Users-gbolahan-Documents-NEW-ME-LevelUp/70ce5228-d909-41a7-b749-2bc52131c2e0/scratchpad/op022-browser.mjs`, results `/private/tmp/claude-501/-Users-gbolahan-Documents-NEW-ME-LevelUp/70ce5228-d909-41a7-b749-2bc52131c2e0/scratchpad/op022-browser.txt`.

| Page | axe (WCAG 2.2 AA tags) | 390px scroll/client width |
|---|---|---|
| Dashboard, all time | 0 violations | 390/390 |
| Dashboard, academic year | 0 violations | 390/390 |
| Students, with the changed export section | 0 violations | 390/390 |

Also seen: the sample banner, both statements, all six measures each with its four labels, no small group named, a `SAMPLE-` file name, 400 on a narrowed export. The only console error was that expected 400. After this pass one sentence changed (the banner no longer says "Sample data" twice), and it was not re-run in a browser. Dev mode only. Automated axe does not establish accessibility conformance.

## Limitations

- **Not differential privacy.** Rounding is deterministic. An admin watching day by day can see a figure cross a rounding boundary and learn that some count is near it. Someone who knows every other student's exact data could still infer the last one where a boundary falls. Tested, stated, not solved.
- **Identity by outside knowledge.** Published faculty, year and fee-status rows are not personal, but a university knows its own cohorts. A group of five where everything else is known is not protected beyond the rules above.
- **Stopping sharing moves past figures,** as do deleted accounts. A student leaving can cross a rounding boundary in closed periods. Consent wins over stable history, so old exports won't reproduce exactly.
- **A withheld period needs only one small period.** A handful of test accounts in an old year withholds every year and term view until they're deleted. It fails closed. All time stays available.
- **Withheld state** is tested in SQL and in the CSV. It wasn't seen in a browser, because the demo's sample is never withheld.
- **Demo mode** implements the rounding and hiding rules in TypeScript, with the fixture as the link, but not the period guard. Sample figures also appear on periods that haven't started.
- **Unverified without a real database:** PostgREST calling `admin_analytics`, its speed, and the regex normaliser on Supabase's Postgres. It normalises every sharing student's CV text on each read, twice. Not load tested; expect seconds at thousands of reports. No caching was added, as a cache would need its own controls.
- **Normaliser copy.** SQL and TypeScript are compared on 25 hostile strings, and a test fails if `NORMALISER_VERSION` is bumped, but it is still a copy.
- **Failure counts undercount old periods,** because `analysis_jobs` is purged after its retention period. The page says so.
- **Referral acceptance and application status are today's,** not as they stood in the period. Definitions say so.
- **Landing copy, not edited (founder's files):** `src/app/_landing/Landing.tsx:61-62` ("Privacy-safe exports", "Evidence for your reporting") and `demos/CohortDashboard.tsx` (an average score, 1,240 active students) describe the old dashboard. Suggest "context for" instead of "evidence for".
- `src/app/privacy/page.tsx:83` says exports "always leave out groups smaller than five". True of figures, but not obviously of the named list. For legal review, along with decision 2. `docs/QA.md:25` still describes the old dashboard (OP-028).

## Migration impact

**One new file, `supabase/migrations/20261108090000_institutional_analytics.sql`. It is NOT applied to any database.** The directory was re-listed immediately before naming and it sorted after every file then. `20261108100000_erasure_ledger.sql` from the fixes agent has since landed after it; they touch nothing in common.

It adds **no table and no column**, so there is nothing new for row-level security to cover. It adds 15 internal functions, none callable by any signed-in or signed-out user, and `admin_analytics(text)` for careers admins. It **drops** `admin_overview` and `admin_outcomes_pack`, so old code's dashboard and new code without the migration both fail: **apply and deploy together.** Rolling back means restoring those two function bodies. It needs all earlier unapplied migrations first. Validated in PGlite only.

## Checks Codex must rerun

```
npm run typecheck && npm run lint && npm run test:engine && npm run test:db && git diff --check
NODE_OPTIONS=--conditions=react-server npx tsx --tsconfig tsconfig.json --test tests/analytics.test.ts tests/analytics-actions.test.ts tests/analytics-db.test.ts
ls supabase/migrations | tail -3
```

Worth attacking:

- Combinations I didn't name: three periods together, breakdown rows against headline figures, the `needs` block against the student list.
- `analytics_period_withheld`: is any counted event missing from its `activity` list? Useful edits are approximated there by `reports.updated_at`.
- Whether the term guard should use the same population as each figure.
- `analytics_normalise_text` against `normaliseText` on your own input.
- Whether keeping the named list meets "no universal surveillance by default".

## Unresolved questions

1. **Founder:** the five decisions above.
2. **Legal:** counting non-sharers, the privacy sentence, whether rounded figures are anonymous in law.
3. **Statistical review** of the thresholds, and of whether a group minimum should rise above 5.
4. **OP-030:** the pilot's measures (false-alarm rate, adviser-rated improvement, time to first improvement, cost per workflow) aren't here. They need data this product doesn't collect.
