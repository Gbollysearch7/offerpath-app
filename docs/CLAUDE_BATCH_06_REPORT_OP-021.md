# Offerpath batch 06 report: OP-021, institutional configuration and adviser work

Prepared 7 November 2026 by Claude, for independent acceptance review by Codex. Nothing was committed, pushed or deployed.
No migration was applied. No live database, `test:live`, paid provider, email or `next build` was used. All keys were blank
in the browser checks.

## What this task does and does not claim

- **Claims:** careers admins can configure branding, resources, programme groups, access policies and service contacts. A new
  adviser role sees only students who share progress and are in that adviser's groups. Notes, disagreement and referrals sit
  on one page for staff and one for the student, each with a named owner. Every access to a student, a CV or an
  export is in an append-only table. All of this holds in the real SQL under PGlite, in `supabaseRepo` over that SQL, and in
  the real server actions and routes in demo mode, with two universities.
- **Does not claim:** anything about real Supabase Auth or PostgREST, a production build, or real adviser use. No penetration
  test. No legal review of the privacy wording. **No notification is claimed delivered:** students get an in-app notice on
  their next page. No email is built or sent.
- **Scores:** unchanged. I edited no scoring, rubric, judgment or fingerprint file. The configuration tables have no column a
  scorer could read, and the frozen fixtures in `tests/scoring-contract.test.ts` still pass. The `src/lib/analysis` changes
  in `git status` belong to other tasks.
- **Adviser CV access:** still behind `ADVISER_CV_ACCESS`, still off. Legal review remains a human gate.

## Task status

| Task | Status | Notes |
|---|---|---|
| OP-021 | Implemented → Locally verified | One **unapplied** migration. No human or operational gate passed. |

## Founder decisions needed

1. **Who may switch report sharing (left open by OP-020).** I decided, for you to confirm: a careers admin can **stop** it at
   any moment, and only the operator can **start** it. Stopping only reduces exposure and the customer must be able to do it.
   Starting has open questions: your on-by-default answer and legal review of the notice. No function sets it to true, and the
   default stays off.
2. **Keeping the access log after account deletion.** Today the entry stays, with `student_id` removed and the staff member's
   name kept, for 24 months. This serves accountability, but it needs a DPA position. The 24 months is my placeholder.
3. **Default adviser policy.** `assigned` means an adviser with no groups sees nobody. An admin can choose `all`. I took
   least privilege.
4. **Email notices.** Not built, because they can't be proven without the production domain. Do you want them once it exists?
5. **Private notes.** Notes remain always visible to the student, as before. I added no staff-only notes, since those raise a
   subject-access question.
6. **Logos.** Not built: an externally hosted image would tell a third party each time a student opens a page. Branding is a
   name, one colour and a welcome message. Uploaded logos would be a later choice.

## Changed files

**New:**

- `supabase/migrations/20261107230000_institution_adviser_work.sql` (**not applied**).
- `src/lib/institution/`: `types.ts`, `permissions.ts` (the who-can-do-what table), `schema.ts`, `flow.ts` (the action
  boundary), `labels.ts`, `guidance.ts`.
- `src/lib/repo/supabase-institution.ts`, `src/lib/repo/demo-institution.ts`.
- `src/app/actions/adviser.ts`.
- `src/app/admin/institution/` (page, `InstitutionManager.tsx`), `src/app/admin/casework/page.tsx`,
  `src/app/admin/access-log/page.tsx`, `src/app/admin/team/AdviserManager.tsx`,
  `src/app/admin/students/[key]/CaseworkPanels.tsx`.
- `src/app/careers-service/` (page, `CaseworkNotice.tsx`, `CareersOnThisReport.tsx`, `ReferralAnswer.tsx`).
- `tests/adviser-db.test.ts` (15 tests), `tests/adviser-actions.test.ts` (9), `tests/institution-config.test.ts` (8).

**Mine to change:** `src/app/admin/page.tsx` (one sentence), `admin/export/route.ts`,
`admin/students/page.tsx`, `admin/students/[key]/page.tsx`, `admin/students/[key]/cv/[reportId]/route.ts`, `admin/team/page.tsx`.

**Shared files, small additive edits:**

| File | Edit |
|---|---|
| `src/lib/types.ts` | `Role` gains `"adviser"` |
| `src/lib/session.ts` | Adviser redirects; new `requireStaff()` |
| `src/lib/demo-session.ts` | Accepts the adviser role |
| `src/lib/repo/types.ts` | `Repo extends InstitutionRepo`; optional fields on `StudentDetail` |
| `src/lib/repo/supabase.ts` | Spreads the new methods; `adminCvLink` checks the flag |
| `src/lib/repo/demo.ts` | Adviser profile, role checks, spreads the new methods, sample student scoped |
| `src/lib/rate-limit.ts` | `adviserWritePerUser` |
| `src/lib/jobs.ts` | Purge of log entries over 24 months |
| `src/app/page.tsx` | Adviser redirect |
| `src/app/actions/auth.ts`, `src/app/sign-in/page.tsx` | Demo-only "Enter as an adviser" |
| `src/app/actions/admin.ts` | `addAdviserNote` goes through the flow, so advisers can use it |
| `src/app/api/export/route.ts` | `adviser-casework.json` in "Download my data" |
| `src/app/reviews/[id]/page.tsx` | One import, one `<CareersOnThisReport>` line |
| `src/app/privacy/page.tsx` | Two sentences |
| `src/app/legal/privacy/page.tsx` | One sentence, **needs legal review** |
| `src/components/AdminNav.tsx`, `AdminShell.tsx`, `StudentShell.tsx`, `Topbar.tsx` | Menu derived from permissions; notice; one link |
| `docs/OPERATIONS.md` | Lifecycle rows |

**Tests I changed that I did not write:**

| File | Change | Reason |
|---|---|---|
| `supabase/tests/security.test.mjs` | `general` set gains `staff_university`, `my_institution`, `my_casework`, `my_casework_unseen`, `mark_casework_seen`, `respond_to_referral` | The guard lists what signed-in users may call. The `my_*` functions and `respond_to_referral` take the user from `auth.uid()`; `staff_university` is the new gate. |
| `supabase/tests/security.test.mjs` | The `admin_*` gate check now names nine adviser functions that must start from `staff_university()`; all others must still start from `admin_university()` | Advisers share those nine. The named list is tighter than widening the regex. |
| `supabase/tests/security.test.mjs` | The cascade check excepts `staff_access_log.student_id` | The trail outlives the account on purpose, with the id nulled. Founder decision 2. |
| `tests/security-tenancy.test.ts` | "Every admin page requires an admin": exactly three named pages use `requireStaff()` instead | Advisers need those pages. Every other page must still use `requireAdmin()`. |
| `tests/fixtures/fake-supabase.ts` | `staff_access_log` table | The fake throws on unmodelled tables, and `runRetention` now purges this one. |
| `supabase/tests/schema.test.mjs` | Extended as asked: one block, 41 `op021:`/`trail:` checks | Requested. |

## Behaviour

**Who can do what.** `src/lib/institution/permissions.ts` is the statement of record. `/admin/team` renders it, the admin menu
is derived from it, and `tests/adviser-db.test.ts` checks eleven of its rows against the database for each staff role.

| Action | Student | Adviser | Careers admin |
|---|---|---|---|
| Open an original CV file | Own | Only with the student's opt-in, once switched on | Same |
| Read CV text, line feedback, letters, tailored CVs, LinkedIn | Own | No | No |
| See scores; read and add notes; disagree; refer | Own (cannot disagree) | Students in scope | Students in scope |
| Student list | No | Students in scope | Students in scope |
| Dashboard, exports, access log, configuration, team, import | Export and log: own | No | Yes |
| Change a score or automated judgment | No | No | No |

"In scope" is one function, `staff_can_see()`, read on every call: same university, the student has `share_progress`, and for
an adviser the university's policy allows it. Group membership is derived from the imported faculty and course.

**Configuration** (`/admin/institution`). Branding, a welcome message, adviser policy, programme groups, resources (for everyone
or one group), service contacts. Colours under 4.5:1 on white and non-https URLs are refused, at both schema and database where
possible. A settings request with an extra field such as `weights` is refused rather than ignored. The page states plainly
that report links can only be stopped there and that adviser CV access isn't a setting.

**The unused guidance field (OP-010).** Still has no writer, on purpose. A stored report is a historical record, and copying
guidance in would either go stale or mean rewriting reports. `guidanceFromView()` builds the same shape at read time, and
`CareersOnThisReport` shows it beside the analysis under "NOT PART OF YOUR SCORE". Never saved.

**One workflow, with owners.** `/admin/students/[key]` explains the four parts in order, then has the panels:

| Item | Owner | Student |
|---|---|---|
| Sharing | The student, who can stop at any time | Switches on `/privacy` |
| Note | Its author, by name | Sees it |
| Disagreement | Its author, by name | Sees it beside the unchanged automated result |
| Referral | A named owner; next step shown at every status | Accepts or declines; only they can |

Referral statuses: `proposed` → `accepted`/`declined` (student only) → `in_progress` → `closed`, or `withdrawn` by staff from
`proposed`. Only the owner or a careers admin can move one. It can only pass to someone who could see that student anyway.
Every change is a row in `adviser_referral_events`. `/admin/casework` is the queue. A referral whose student has stopped sharing
is counted, not shown.

**Disagreement.** Names a report and the score, an area or a check. The database reads the automated result from the report
into `judgment_snapshot`, so the caller can't supply it and the record survives later re-scoring. A trigger refuses any edit,
including by the table's owner, except a foreign key going null when an adviser's account is deleted. A change of mind is a new
`withdrawal` row; the original stays. Tested byte-identical on the report row.

**Revocation applies on the next access.** Tested for: stopping sharing, CV opt-out, a group removed, the imported faculty
changing, the policy narrowing, and the role removed. A re-appointed adviser starts with no groups.

**The access trail** (`staff_access_log`). Written in the same transaction as the access. Records opening a student, opening a
CV, notes, disagreements, referrals, exports and configuration and role changes. Refused views, CV opens, disagreements and
referrals are logged too; those functions return null rather than raise, because a raise would roll the entry back. There is no
column for IP address, browser or location. Careers admins read all of their university's entries at `/admin/access-log`;
students see theirs on `/careers-service`; advisers see none. A student who has stopped sharing appears as "Not sharing" in the
admin view. A guessed id from another university names no student on the guesser's side. The app log's use of the URL `key`,
OP-026's limitation, is gone.

**Exports.** Careers admins only, at route and SQL. The entry is written first; if it fails, the route returns 503 and no file.
Search text isn't kept, because it can be a student number. Rows come from the same functions as the screens, so a revoked
student leaves the next export. New `/admin/export?pack=access`. "Download my data" gains `adviser-casework.json`.

**Tightened while here.**

- OP-018's question: `admin_add_note` now refuses anything but a CV review. It still raises, as before, so a refused note isn't
  logged.
- `admin_student_detail` returned each check's `summary`, `detail` and `extras`, which can quote the CV, though no page rendered
  them. It now returns names and scores only.
- `admin_set_role(false)` could demote anybody at the university. It now touches only admins.

**Before the migration is applied.** Student-side reads return empty, so student pages keep working. `/admin/institution`,
`/admin/casework`, `/admin/access-log` and `/admin/team` will error, and exports return 503. **Apply it before deploying this
code.**

## Validation: commands and actual results

Run on this tree, 7 November 2026, with other agents working in it.

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0: 0 errors, 3 warnings (`tests/e2e/keyboard.mjs:360`, `:919`, `tests/e2e/smoke.mjs:38`; none mine) |
| `npm run test:engine` | exit 0: **851 tests, 851 pass, 0 fail** |
| OP-021 tests alone | **32 tests, 32 pass, 0 fail** |
| `npm run test:db` | exit 0: **433 PASS, 0 FAIL**, 41 of them OP-021 |
| `git diff --check` | exit 0 |

The two OP-019 guard failures you warned of did not appear in this run, so that agent's code passed at that moment. A typecheck
run mid-task showed three errors in `.next/types/validator.ts` naming my new routes, from the dev server on port 3000 regenerating
those files. They had cleared by the final run. I didn't touch that server.

**Coverage of the acceptance.**

| Requirement | Test |
|---|---|
| None of it can alter the score | `institution-config`: same CV, opposite configuration, two universities; report byte-identical; schemas refuse scoring fields. `adviser-db`: migration can't write to reports |
| Disagreement attributed, history intact | `adviser-db` "a disagreement is attributed" |
| Database boundary | `adviser-db`: direct table access, every staff and admin function by role |
| Repository boundary | `adviser-db` "a two-university journey", through `supabaseRepo` and the flows |
| Action boundary | `adviser-actions`: real server actions, signed sessions |
| Guessed ids across universities | `adviser-db` "another university's admin and adviser"; `adviser-actions` "two universities" (source file, letter, tailor, export routes) |
| Advisers see only what's authorised | `adviser-db` scope tests; `adviser-actions` page guards; browser |
| Revocation | `adviser-db`, `adviser-actions`, browser |
| Exports carry the controls | `adviser-actions` "exports", including a failed log; `adviser-db` |
| UI matches privileges | `adviser-db` permissions test; `institution-config` navigation; browser |

**Do the tests bite?** Each control was undone, one at a time, in a scratch copy, running only the three OP-021 files.

- **The first complete run was invalid, and I discarded it.** It reported 40 of 40, but my copy left out `.env.example`, so a
  guard test failed in every copy. Reading the results showed "admin can start sharing" had been caught by nothing else. An
  earlier attempt also aborted when one mutation hit the script's time limit; the final run had none.
- I fixed the copy and added a test that calling stop twice can't turn sharing back on.
- **Final run: 40 of 40 caught, and none by that guard.**
- Script: `/private/tmp/claude-501/-Users-gbolahan-Documents-NEW-ME-LevelUp/70ce5228-d909-41a7-b749-2bc52131c2e0/scratchpad/op021-mutate.py`.
  Results: `op021-mutate.txt` in the same folder.

**Browser.** Scratch copy with `node_modules` symlinked, no `.env*`, all keys blank,
`DEMO_REPORT_SHARING=true`, `next dev` on port 3921, stopped afterwards. Port 3000 was not touched. Scripts: `op021-browser.mjs` and
`op021-report.mjs`, results `op021-browser.txt`, in that scratchpad folder.

| Page | axe (WCAG 2.2 AA tags) | 390px scroll/client width |
|---|---|---|
| Your service, empty and filled | 0 violations | 390/390 |
| Careers team | 0 violations | 390/390 |
| Student page, as admin and as adviser | 0 violations | 390/390 |
| Student list, as adviser | 0 violations | 390/390 |
| Referrals, as admin and as adviser | 0 violations | 390/390 |
| Access log | 0 violations | 390/390 |
| Careers service, as student | 0 violations | 390/390 |
| CV report with the new section | 0 violations | 390/390 |

The first axe pass found one real fault: a button reading "No thanks" labelled "Decline the referral". It now reads "Decline".

Also seen in Chrome:

- the adviser's menu is only Students and Referrals; seven admin URLs redirect them; `/admin/export` gives them 403;
- a student sees the in-app notice, accepts a referral, and the notice clears;
- after the student flips the real share switch: adviser's page 404, list and admin CSV without them, log says "Not sharing", queue says one referral hidden;
- adviser CV route 404 with the flag off;
- the only console error was that expected 404.

After the browser pass I removed one unused constraint from the migration and changed tests only. No page changed. Dev mode
only; automated axe does not establish accessibility conformance.

## Limitations

- **Unverified without a real database:** that PostgREST runs volatile functions in a writable transaction as expected (it should
  for POST), real JWT behaviour, and the migration on Supabase's Postgres. `in_programme_group` takes a table row type, which
  PostgREST never sees, as it's internal.
- **The CV path.** The database can't read an env var, so a careers staff member calling `admin_cv_path` directly gets a path
  (logged). A path opens nothing: signing needs the service role, which the app uses only with the flag on.
- **A signed CV link lasts 60 seconds,** so revocation within that minute doesn't recall a link already issued. Applies only once
  the flag is on. A downloaded copy can't be recalled.
- **The student list isn't logged per view,** only opening a student and exporting. It holds no CV content.
- **A page reload writes another log entry.** No deduplication: complete but noisy. Next prefetching wasn't exercised in a production build.
- **A refused note isn't logged** (see above).
- **Export differencing remains,** as OP-026 noted: narrowing by search or faculty across two exports can defeat the under-five rule. Left for OP-022, which owns it.
- **Group names must match imported spelling,** ignoring case. A misspelt faculty matches nobody, which fails closed.
- **Demo mode** shares one sample student across visitors, and one visitor opting out hides that student for all. Its adviser
  identity and rules are a parallel implementation, tested by the same behaviours but not the same code as the SQL.
- **The retention purge** is tested only as far as the fake client; the real delete isn't exercised.

## Migration impact

**One new file, `supabase/migrations/20261107230000_institution_adviser_work.sql`. It is NOT applied to any database.** The directory
was re-listed immediately before naming and again at the end; it sorts after every file (`20261107220000_application_links.sql`).

It adds nine tables with row-level security on and no policy or grant, so they are function-only. It also adds the `adviser`
role, `pending_admins.staff_role`, `profiles.casework_seen_at`, and replaces `handle_new_user`, `admin_student_detail`,
`admin_cv_path`, `admin_add_note`, `admin_students`, `admin_set_role` and `admin_list_team`. No existing data is changed. Validated in
PGlite only. It needs all unapplied earlier migrations first.

## Unresolved questions

1. **Founder:** the six decisions above.
2. **Legal:** the privacy notice sentence, 24-month log retention, keeping pseudonymised entries after deletion, and adviser CV access itself.
3. **OP-022:** export differencing, and which of these events it should count.
4. **Later:** adding staff outside the careers team, and whether advisers should see a group-level dashboard. Neither was asked for.

## Checks Codex must rerun

```
npm run typecheck && npm run lint && npm run test:engine && npm run test:db && git diff --check
NODE_OPTIONS=--conditions=react-server npx tsx --tsconfig tsconfig.json --test tests/adviser-db.test.ts tests/adviser-actions.test.ts tests/institution-config.test.ts
ls supabase/migrations | tail -3
```

Worth attacking:

- `staff_can_see` and each function's use of it, especially `admin_casework` and the `staff` list in `admin_student_detail`;
- `refuse_history_rewrite` (is any column path missed?);
- `log_staff_access` being unreachable, and whether any route to student data skips it;
- whether `my_casework` exposes anything about staff a student shouldn't see;
- `admin_set_adviser` on someone with their own student reports;
- the demo `sample-` id mapping, which exists only in demo mode;
- the decision that an admin may stop, but not start, report links.
