# Founder decisions

Every open decision from the implementation reports, in one place. Consolidated 7 November 2026 for OP-028 from every `docs/CLAUDE_*REPORT*.md` and [CODEX_BATCH_01_REVIEW.md](CODEX_BATCH_01_REVIEW.md). Recommendations are advice: nothing here has been decided. Record the answer, date and name by adding them to the row. Statuses and evidence are in [STATUS_REGISTER.md](STATUS_REGISTER.md).

OP-021, OP-027 and the LinkedIn fix were still in progress when this was written, and no report from them was available. Add their open questions when they report.

Where a row says "as built", the code already does that and changes nothing unless you decide otherwise.

## A. Before any production deploy

| ID | Decision | Recommendation | Blocks | Source |
|---|---|---|---|---|
| <a id="fd-01"></a>FD-01 | **Approve the migrations.** Files 12 to 20 have run only in PGlite. | Approve 12 to 19 once a staging run passes. Decide on 20 once OP-021 reports and `test:db` passes. Approve as a batch, in the [runbook's order](RELEASE_RUNBOOK.md#2-migration-order), because this code needs them together. | The whole release. Uploads, deletion, spelling and dashboard fail on this code without them. | Each report's "Migration impact" |
| <a id="fd-02"></a>FD-02 | **Codex review.** Every report since batch 01 was written "for independent acceptance review by Codex". Only OP-001 and OP-002 have [been reviewed](CODEX_BATCH_01_REVIEW.md). | Require it before merging. Give Codex the whole tree and each report's "Checks Codex must rerun". The work is also uncommitted, so commit it in reviewable pieces first. | Merge, so everything after it | All reports |
| <a id="fd-03"></a>FD-03 | **Backups: 30 or 35 days?** The privacy notice says 35 and [OPERATIONS.md](OPERATIONS.md) says 35. The [DPA schedule](legal/DPA_SCHEDULE_TEMPLATE.md) says "up to 30 days for deletion and backup expiry" and deletion of all data within 30 days of contract end. | **30.** A university will hold you to the contract, and a 35-day backup breaches it. Keep the weekly dumps for 28 days, change the notice to "within 30 days", and have the lawyer confirm. | Legal sign-off, procurement pack, setting up backups | [OP-026](CLAUDE_REPORT_OP-026.md) decision 2 |
| <a id="fd-04"></a>FD-04 | **Database plan.** Free has no managed backups and pauses when idle. Pro has 7 days of daily backups. PITR costs from about $100 a month and replaces the dailies. [DEPLOY.md](DEPLOY.md) says to turn PITR on. | Pro before any real data. For the first pilot, daily backups plus the weekly dump are enough if losing up to a day is acceptable to the university; add PITR when volume or the contract calls for it. | Real student data, restore rehearsal on production-grade settings, SSO (Pro feature) | Checklist #14 |
| <a id="fd-05"></a>FD-05 | **Vercel plan limit.** OP-025 assumed the plan can run 60-second functions and the crons. The plan in use wasn't read. Vercel's limits page (7 November 2026) gives Hobby a 300-second maximum and allows these cron counts, so duration is not the constraint. It gives runtime logs **1 hour on Hobby, 1 day on Pro**. | Confirm the plan in the dashboard. Prefer Pro: an hour of logs isn't enough for incidents. Also check Vercel's terms on commercial use, which that page doesn't cover. Consider a log drain if you want the 30 days the notice allows. | Monitoring, incident response, the OP-025 metrics | [OP-025](CLAUDE_REPORT_OP-025.md) Q6 |
| <a id="fd-06"></a>FD-06 | **Anthropic key replacement.** Named by the brief. **No report records why it's needed**, so please confirm the reason. `ANTHROPIC_API_KEY` exists on Production; its value and validity weren't checked. | Issue a new, production-only key in its own workspace, with a spend limit (FD-07), update Vercel, redeploy, then delete the old one ([OPERATIONS.md](OPERATIONS.md#secrets)). Don't share it with local development. | AI feedback in production. Without a working key, scoring falls to the rule engine or fails. | Brief |
| <a id="fd-07"></a>FD-07 | **Global daily spend ceiling.** None was built. Today there are per-student limits and the provider's own limit. | Set a monthly limit on the Anthropic workspace before launch, and don't build an in-app ceiling yet. Revisit once the pilot gives a real cost per student. The alert `ai-budget-exhausted` covers running out. | Launch without unbounded cost | [OP-025](CLAUDE_REPORT_OP-025.md) Q4 |
| <a id="fd-08"></a>FD-08 | **Remove `levelup-qa.ac.uk` data.** Two accounts and a university row. Existence not re-checked; the query is in the [runbook](RELEASE_RUNBOOK.md#3-pre-flight-read-only-checks). | Delete before any real student signs up, after taking a backup. Delete the accounts through Auth, so the cascade runs and files go, then the university row. Don't do it by hand-written SQL on tables. | Real student data | [OP-026](CLAUDE_REPORT_OP-026.md) decision 8 |
| <a id="fd-13"></a>FD-13 | **Should a missing `CRON_SECRET` or `RESEND_API_KEY` stop production?** The default is now yes: the production build fails without them. Everything else only warns. Confirm, or move names in `REQUIRED_IN_PRODUCTION` ([report](CLAUDE_REPORT_RELEASE_FIXES.md)). | Make both errors for `VERCEL_ENV=production`, not for preview. Add `EMAIL_FROM` and `LEGAL_*` to the check, and show degraded state in `/api/health`. A code change for an agent. | Privacy promise being reliably kept | [OP-026](CLAUDE_REPORT_OP-026.md) decision 7, [runbook section 9](RELEASE_RUNBOOK.md#9-what-a-missing-variable-does) |
| <a id="fd-14"></a>FD-14 | **Production domain.** Production runs on `offerpath-app-lake.vercel.app`; demos and the email default say `offerpath.app`. | Choose and buy it now. Email, the site URL, Auth redirects and uptime all depend on it. | Real email, so student sign-in | Checklist #2 |
| <a id="fd-15"></a>FD-15 | **Company and ICO details.** The legal pages show placeholders. | Supply them. Code can't establish that a company or ICO registration exists. | Legal sign-off, going live | Checklist #8 |
| <a id="fd-16"></a>FD-16 | **Staging.** [OPERATIONS.md](OPERATIONS.md) describes a staging project. No Preview variables exist, so previews are expected to fail. | A separate Supabase project with fictional data. Needed to test migrations and rollback. Demo-mode previews test the build only. | Preview check in the runbook, safe migration | Checklist #6 |
| <a id="fd-22"></a>FD-22 | **Who rehearses the restore, and with what data?** | A named person, on two throwaway projects, with fictional data, as written in [RESTORE_PROCEDURE.md](RESTORE_PROCEDURE.md). A drill with a real backup needs the DPO's agreement and should wait until one exists. | OP-028 acceptance | OP-028 |

## B. Before real students: data protection and legal

These need a lawyer or DPO as well as you. Nobody has been named. Founder to assign.

| ID | Decision | Recommendation | Blocks | Source |
|---|---|---|---|---|
| FD-17 | `student_records` after account deletion: kept as the university's data with no self-service removal. | Keep as built and write the position into the DPA. Build a controller removal route with OP-021. | DPA | [OP-026](CLAUDE_REPORT_OP-026.md) decision 3 |
| FD-18 | `pilot_requests` retention: names and emails, no rule. | Delete 12 months after the last contact, by the weekly job. | Privacy notice accuracy | OP-026 decision 4 |
| FD-19 | Held CV versions wait for account deletion, up to 24 months of inactivity. Should they expire? | Expire unscored held versions after 90 days. | Retention schedule | OP-026 decision 5, [OP-006](CLAUDE_BATCH_02_REPORT.md) Q2 |
| FD-20 | Adviser access log. `/privacy` promises every access is logged, and that log lived only in application logs, which last a day or less. | Rely on OP-021's durable `staff_access_log` once applied. Keep `ADVISER_CV_ACCESS` off until it is. | Turning on adviser CV access | OP-026 decision 6 |
| <a id="fd-21"></a>FD-21 | **Built, unapplied, and still needs decisions.** A restore brings back accounts deleted since the backup. A ledger now records them, using the opaque id rather than the suggested hash ([details](RESTORE_PROCEDURE.md#erasures-after-a-restore)). To decide with the DPO: is keeping it lawful and for how long, does the notice change, who runs the off-site export and how often. | Add a minimal deletion ledger: a hash of the user id and a date, no other data, kept as long as the longest backup. Needs DPO review. | Honest restore, the erasure promise | OP-028 |
| FD-23 | Keep analysis job rows 90 days, and share link logs 90 days after expiry? | Keep, and list them in the DPA retention schedule. | DPA | [OP-025](CLAUDE_REPORT_OP-025.md) Q5, [OP-020](CLAUDE_BATCH_06_REPORT_OP-020.md) Q4 |
| FD-24 | UKACD dictionary licence notice: does server-side use need a visible notice? | Add an attribution line on the legal pages; it costs nothing. Lawyer to confirm. | Legal sign-off | [OP-007](CLAUDE_BATCH_03_REPORT_OP-007.md) decision 3 |
| FD-25 | New privacy clauses from OP-008, OP-018, OP-020 and OP-026 need review. `legal.lastUpdated` still says 27 October 2026 although the notice has changed since. | Lawyer reviews the whole notice at once. Update the date when they sign off. | Legal sign-off (#9) | OP-008 Q4, OP-018 Q6, OP-020 Q4, OP-026 decision 2 |
| <a id="fd-26"></a>FD-26 | Grammar coverage: stay local, self-host or buy? Paid or remote sends CV text to a new processor. | Stay local for the first pilot, with grammar shown as not assessed. If advisers want it, trial self-hosting first. | Any claim to check grammar | OP-007 decision 1 |
| FD-27 | `TEST_LOGIN`: buttons go on production and every preview, with no override. Previews with `DEMO_MODE` remain the way to get one-click access. | Confirm, as built. The variable isn't on Vercel today ([E1](STATUS_REGISTER.md#e1)). | Nothing further | OP-026 decision 1 |
| FD-28 | Link scanners: add a click-through page so scanners don't read the share summary or inflate the access log? | Yes, before turning sharing on anywhere. | Sharing on at a university | OP-020 Q3 |

## B2. Public claims and legal wording

Added 7 November 2026 by the claims fixes ([report](CLAUDE_REPORT_CLAIMS_FIXES.md)). The pages now say these aren't in place, or carry a marked placeholder. Replace the wording once each is decided. Recommendations are advice, and need a lawyer where legal.

| ID | Decision | Recommendation | Blocks | Source |
|---|---|---|---|---|
| <a id="fd-80"></a>FD-80 | **Data processing agreements and transfer safeguard** with Supabase, Anthropic, Vercel and Resend. None is on file. Anthropic's published commercial terms incorporate its DPA by reference, but which terms this account accepted hasn't been checked. UK IDTA or UK Addendum is also open. | File a signed or accepted copy of each before any real data. Lawyer chooses the safeguard. Then update the privacy notice, sub-processors page, `src/lib/legal.ts`, landing `TRUST`, DPIA and DPA template. | Any pilot. The pages now say an agreement "is required before any pilot goes live", which is itself a commitment: confirm it. | OP-029 P-06, conflict list |
| <a id="fd-81"></a>FD-81 | **Anthropic no-training and retention, for this account.** The pages now quote only the published terms ("may not train models on customer content", read 7 November 2026). | Confirm the account is on those terms, and record the retention period. Remove the placeholder from the notice. | Notice, DPIA | OP-029 P-07 |
| <a id="fd-82"></a>FD-82 | **Breach notice: 24 or 48 hours?** [OPERATIONS.md](OPERATIONS.md) and [RESTORE_PROCEDURE.md](RESTORE_PROCEDURE.md) say 24; the DPA template said 48 and now has a marked gap. | **None given: a legal and founder decision.** One number must then go in all three, and it must be one you can actually meet. | DPA | OP-029 C-02 |
| <a id="fd-83"></a>FD-83 | **Staff MFA isn't enforced.** Nothing in `src` checks it (`grep -rnEi "\baal\b\|aal2\|mfa" src` finds nothing). [DEPLOY.md](DEPLOY.md) only says to turn on TOTP and ask admins to enrol. Not built in this work. | **Require MFA for staff and admin accounts** (`admin` and `adviser` roles) before any real student data, enforced in code rather than requested. These accounts see many students, and they're exempt from inactivity deletion. Students can stay on email links. | Real student data; security questionnaires | OP-029 X-09 |
| <a id="fd-84"></a>FD-84 | **What the notice says about backups.** No backups run. "35 days" is gone; the notice has a conditional sentence and a placeholder. Depends on [FD-03](#fd-03), [FD-04](#fd-04) and [FD-21](#fd-21). | Decide those, start backups, then state the period and the erasure ledger position in the notice. | Legal sign-off | OP-029 R-01, R-03 |
| <a id="fd-85"></a>FD-85 | **Contract-end deletion isn't built.** The DPA template's promise is now marked as open. No procedure, university-wide delete or bulk return exists. | Decide what is deleted and returned, including the ledger, cache and provider logs. Build and test it before signing a term that promises it. | DPA | OP-029 C-04 |
| <a id="fd-86"></a>FD-86 | **Accessibility statement:** formal compliance status, who answers requests, and how quickly. "Partially compliant" and "5 working days" have been removed, because nothing supported them. | Set an owner and address (`SUPPORT_EMAIL`). Run the manual scripts in [ACCESSIBILITY_REGISTER.md](ACCESSIBILITY_REGISTER.md), then let the reviewer set the status. | Legal sign-off | OP-029, register |
| <a id="fd-87"></a>FD-87 | **When can the landing page say "Ready for pilots" again?** It now says "Getting ready for pilots". | Once backups, real email, migrations and FD-80 are closed. | Landing wording | OP-029 |
| <a id="fd-88"></a>FD-88 | **Sub-processor change notice and annual security summary.** The DPA template offers both; no process or document exists. The page now says the notice route will be agreed before a pilot. | Write a one-page process and name an owner, or remove them from the template. | DPA | OP-029 |
| <a id="fd-89"></a>FD-89 | **Which universities get SSO.** The fictional selector is gone: production offers university sign-in only for those in `SSO_UNIVERSITIES`, and none is set. Each also needs a SAML provider in Supabase, a paid plan feature ([FD-04](#fd-04)). The landing page says SSO isn't yet connected. | Leave it unset until a university's provider has passed a real sign-in. | SSO at a university | OP-029 S-09, S-10 |
| <a id="fd-90"></a>FD-90 | **Not changed, for the lawyer:** cookies page says Plausible "collects no personal data", and it would load on `/share/<token>` if switched on; neither Plausible nor the alert webhook is on the sub-processor list, and both are off today. The retention email says "your account and everything in it". `legal.lastUpdated` still shows 27 October (FD-25). | Keep both off until reviewed and listed. Review the rest with the notice. | Turning either on; legal sign-off | OP-029 F-11 |

## C. Sharing, advisers and institutions

| ID | Decision | Recommendation | Blocks | Source |
|---|---|---|---|---|
| <a id="fd-09"></a>FD-09 | **Sharing on by default for each university?** Off as built. | Keep off. Turn it on per university, when asked in writing. | Whether any student sees sharing | [OP-020](CLAUDE_BATCH_06_REPORT_OP-020.md) |
| FD-29 | Who may switch sharing: operator or careers admins? OP-021's unapplied migration gives admins a stop switch (`admin_stop_report_sharing`) only. | As OP-021 is building: operator turns it on, admins can stop it. | OP-021 acceptance | OP-020 Q2 |
| <a id="fd-10"></a>FD-10 | **Adviser notes on LinkedIn reports.** The applied `admin_add_note` accepts any report id of a sharing student. | Refuse them. OP-021's unapplied migration limits notes to `cv_review`, so this is fixed once it's applied. Confirm that's the intent. | OP-018 and OP-021 acceptance | [OP-018](CLAUDE_BATCH_05_REPORT_OP-018.md) Q2 |
| FD-30 | Should advisers ever see LinkedIn reviews, opt-in? | Not in the first pilot. | OP-021 scope | OP-018 Q3 |
| FD-31 | Should advisers see that a student has a held version? And on the dashboard? | Student dashboard yes, advisers no. | OP-006 follow-up | OP-006 Q4 |
| FD-32 | Should advisers see spelling dismissals? | No: students would use the feature less if watched. | OP-021 scope | OP-008 Q5 |
| FD-33 | Should an adviser with consent see which version went to which role? | Not until a careers team asks. | OP-021 scope | [OP-019](CLAUDE_BATCH_06_REPORT_OP-019.md) Q6 |
| FD-34 | OP-022: `admin_outcomes_pack` counts duplicate uploads. Should role-derived applications count as tracked? | Fix the duplicates in OP-022. Count them, labelled separately. | Outcome figures shown to universities | OP-019 Q1 |
| FD-35 | CSV export could allow differencing between two narrowed exports. | Handle in OP-022's reporting rules. | Analytics claims | OP-026 limitations |

## D. Scoring and content, usually with an adviser

Named by the brief first. Decisions that change numbers should go in one bundled bump, and before the OP-011 held-out set is opened. Careers adviser: Founder to assign.

| ID | Decision | Recommendation | Blocks | Source |
|---|---|---|---|---|
| <a id="fd-11"></a>FD-11 | **US-English scoring penalty.** A student who chose US English still loses points on the variant list, because the same CV must score the same. | Keep for the UK pilot, and say so plainly on the check. Have calibration test removing regional variants from the core score, and if it holds, remove them in a rubric bump. | OP-011 calibration | [OP-008](CLAUDE_BATCH_03_REPORT_OP-008.md) Q1 |
| <a id="fd-12"></a>FD-12 | **Uncapped invented-fact letter score.** A letter with unsourced employer claims scores 85. They're flagged and unconfirmed, not capped, because a student's claim might be true. | Apply the existing 74 cap until the student confirms the claim. A high score over a flagged, possibly invented fact undercuts the fidelity promise. Bump the letter version; old reports keep their numbers. | OP-017 acceptance, letter scores reaching students | [OP-017](CLAUDE_BATCH_05_REPORT_OP-017.md) |
| FD-36 | Which engine does calibration test: rules or the AI judge? | The AI judge, since that's what students get with a key set. | OP-011 | [OP-011](CLAUDE_BATCH_03_REPORT_OP-011.md) Q1 |
| FD-37 | Held-out share of 40%, the required gates, and the 60% withhold line. | Advisers agree them before results are seen. | OP-011 | OP-011 Q3, [OP-010](CLAUDE_BATCH_03_REPORT_OP-010.md) Q4 |
| FD-38 | Compare pre-OP-004 reports? Removed as built, so some students lose their improvement figure. | Keep. Check how many are affected at pre-flight. | Release note | OP-010 Q1 |
| FD-39 | Scores can fall on re-upload after the parser bump (85 → 79). Is a note needed beyond "scored under different rules"? | Yes, one sentence, reviewed by an adviser. | Release | [Parser report](CLAUDE_REPORT_PARSER_BUMP.md) Q3 |
| FD-40 | Bundle any OP-011 bump with the parser bump? | Yes: ship together, because each bump restarts every student's history. | Release timing | Parser report Q2 |
| FD-41 | Should proofreading ever count in the composite? A CV with four typos still scores 83. | Keep it separate until calibrated. | Calibration | OP-007 Q5, [batch 01](CLAUDE_BATCH_01_REPORT.md) Q3 |
| FD-42 | Show the collapsed unrecognised-words list? | Keep; advisers to judge. | Adviser review | OP-007 Q3 |
| FD-43 | Independent review of proofreading labels, ideally with consented real CVs. | Assign an adviser; the human gate for OP-007. | OP-007 validation | OP-007 decision 2 |
| FD-44 | Terminology list owner. | Careers adviser, recorded in `TERMINOLOGY_REVIEW`. | OP-008 "reviewed" label | OP-007 decision 4, OP-008 Q3 |
| FD-45 | Dismissals carry to a new version of the same CV? | Keep to the same text, as built. Consider corrections only, later. | None | OP-008 Q2 |
| FD-46 | "Readiness Score" implies readiness for employment. Rename? | Advisers to suggest a name; touches the landing page. | Claims review | [OP-003](CLAUDE_BATCH_02_REPORT.md) Q3 |
| FD-47 | "Very strong" top band wording; pass line of 8/10 even with a found item. | Keep; advisers to confirm. | Adviser review | OP-003 Q1 and Q2, OP-004 Q1 |
| FD-48 | Finding severity comes from potential score gain, which also feeds next-action ranking. | Give each check its own importance, as a content decision with advisers. | OP-019 ranking review | OP-004 Q7, OP-019 Q3 and Q4 |
| FD-49 | Coverage notes: every check, or only those easily over-read? | Only those easily over-read. | None | Batch 01 Q2 |
| FD-50 | Date overlaps where the lower entry is later on both dates: flag gently? "Uncertain" right for we/our/us? | Stay silent on overlaps; advisers to decide on the pronoun wording. | OP-009 scoring use | [OP-009](CLAUDE_BATCH_03_REPORT_OP-009.md) Q1 to Q3 |
| FD-51 | Job-match weights (3/1, half for soft skills), credits (1/0.5/0.25), "What we look for" headings. | Keep until calibration. | OP-012/013 validation | [OP-012/013](CLAUDE_BATCH_04_REPORT_OP-012-013.md) Q1 and Q2 |
| FD-52 | Letter weights, the 50-weight minimum, the 74 cap and length bands; greeting and sign-off guidance. | Keep until an adviser reviews them. | OP-017 validation | OP-017 Q1 and Q2 |
| FD-53 | Should an unsourced employer claim in a student's own letter affect the number more? | Answered by FD-12. | With FD-12 | OP-017 Q5 |
| FD-54 | 220-character LinkedIn headline figure, and all LinkedIn advice. | Adviser to review and check against LinkedIn. | OP-018 validation | [CONTENT_REVIEW.md](CONTENT_REVIEW.md) |

## E. Product behaviour

Lower stakes. "Keep as built" is safe for the pilot unless noted.

| ID | Decision | Recommendation | Blocks | Source |
|---|---|---|---|---|
| FD-55 | Failed attempts don't use a student's quota, but have their own cap. This doubles worst-case spend per student. Are the caps right? | Keep; review with real costs. | Cost model | OP-025 Q1 |
| FD-56 | 40 concurrent jobs. | Set from the real Anthropic rate limit once the production key exists. | Load behaviour | OP-025 Q2 |
| FD-57 | LinkedIn limit of 10 AI uses a day. | Keep. | None | OP-018 Q4 |
| FD-58 | Can someone test a real LinkedIn archive export? | Yes, before describing the export reader as supported. | Export reader claim | OP-018 Q1 |
| FD-59 | Do confirmed facts carry between CV, letters and LinkedIn? | Not yet, as built. | None | OP-014 Q2, OP-017 Q6, OP-018 Q5 |
| FD-60 | Tailoring without a key is prompt-only. | Accept; production has a key. | None | OP-012/013 Q3 |
| FD-61 | Should the semantic adapter share the `tailor` limit? | Keep. | None | OP-012/013 Q4 |
| FD-62 | Direct re-score of saved lines from the line editor? | Later. Re-upload works. | None | OP-014 Q3 |
| FD-63 | Should blocked rewrites refund the daily count? | Yes, as OP-025 does for validator blocks. Confirm it applies here. | None | OP-015 Q5 |
| FD-64 | Skills-section tool: confirm or block? "Helped organise" to "Organised": confirm? Figures from another entry confirmable when typed? | Keep confirm on all three, and watch for false questions. | Adviser review | OP-015 Q1 and Q2, OP-014 Q5 |
| FD-65 | Old read-only letter with an editable copy; "Write an improved version" on the same report. | Keep. | None | OP-017 Q3 and Q4 |
| FD-66 | Should marking "applied" keep the last downloaded version automatically? | Keep it explicit. | None | OP-019 Q5 |
| FD-67 | Split interview-practice linking out of OP-019 into OP-023. | Yes. | Register accuracy | OP-019 Q2 |
| FD-68 | Should a `low` reading be scored, and should the review screen show below `high` only? Hold `medium`? | Keep holding low and medium. Advisers to judge the screen rule. | Adviser review | OP-005 Q1 and Q2, OP-006 Q1 |
| FD-69 | Corrected report carrying the original `storage_path`? Record a "text normalised" flag? Extend versions to letters? Scan-alternative wording? | No, yes, later, and keep both. | None | OP-006 Q3, Q5, Q6, Q7 |
| FD-70 | Demo seed keeps a v0 report; bulk upgrade of old rows; "can't read this report" state; stored label names. | Keep, leave rows to upgrade on edit, add the state, leave stored names. | None | OP-004 Q2 to Q4, OP-003 Q7 |
| FD-71 | Version held across a parser bump: re-read from its stored file before scoring? | Yes, later. | None | Parser report Q5 |

## F. For the reviewer, not the founder

Listed so they aren't lost. Owner: Codex, or an agent the founder assigns.

| ID | Question | Source |
|---|---|---|
| FD-72 | Is the quorum correctly unversioned? Do `rubric.ts` lines 9 to 11 need rewording? Is `LEXICON_VERSION` sufficient? | OP-010 Q2, parser report Q1 |
| FD-73 | Is a rule-based fallback or validator block the right meaning of "failed attempt"? Is `improveLetter` returning an error during an outage acceptable? | OP-025 Q7 and Q8 |
| FD-74 | Should the proofreading writer use `ifRevision`? `normaliseHeader` with the current section? `WEAK_VERBS.helped` meant to ship under this lexicon? | OP-014 Q4, parser report Q4 and Q6 |
| FD-75 | `updateReport` extra round trip; `FINDING_STATUS_LABEL` re-export; PLAN.md label line. | OP-004 Q6, OP-003 Q6 and Q8 |
| FD-76 | Parallel agents sharing `.next` caused 404s; give them a separate `distDir`? | OP-009 Q4 |
| FD-77 | Should the score breakdown quote measured pages? Who owns the area-label rename? | OP-005 Q4, batch 01 Q1 |
| FD-79 | Small stale items in files OP-028 doesn't own: `.gitignore` still allows the deleted `calibration/adviser_scores.example.csv`; `rubric.ts:2` suggests adjusting weights after calibrating; `ai.ts:12` says every feature falls back to rules, which OP-012 and OP-025 changed; `legal.lastUpdated` (FD-25). | OP-011 Q4, OP-028 |
| FD-78 | Limits and tests noted only in reports: `/admin/students/[key]/cv/[reportId]` logs the URL's key, and the conditional write hasn't run against a real PostgREST. | OP-026, OP-017 |

## G. Closed, with evidence

| Question | Answer | Evidence |
|---|---|---|
| Is `SCORING_VOTES` set in production? (OP-010 Q3, OP-025 Q3) | No | [E1](STATUS_REGISTER.md#e1) |
| Does production use `TEST_LOGIN`? (OP-026) | Variable absent, and no test buttons on the page | [E1, E2](STATUS_REGISTER.md#e1) |
| Should failed attempts use quota? (OP-010 Q6) | Settled by OP-025; caps remain as FD-55 | [OP-025](CLAUDE_REPORT_OP-025.md) |
| One bundled bump for the parser fixes? (OP-010 Q5, OP-011 Q2) | Done in the tree; FD-40 remains for any further bump | [Parser report](CLAUDE_REPORT_PARSER_BUMP.md) |
| Finding id scheme (OP-004 Q5); gated parser changes (OP-005 Q3) | Delivered by OP-007 and the parser report | Those reports |
| Who fixes `WEAK_VERBS.helped`? (OP-015 Q4) Who builds OP-016 for letters? (OP-014 Q1) | Done by OP-014/016 and OP-017 | [OP-014/016](CLAUDE_BATCH_04_REPORT_OP-014-016.md), [OP-017](CLAUDE_BATCH_05_REPORT_OP-017.md) |
| Storage ETag needed? (OP-005 Q5) | No | [OP-026](CLAUDE_REPORT_OP-026.md) |
| Landing claims: "Calibrated with advisers", "never invented", "We never add facts", "Interview-ready", "ATS-friendly" (OP-003 Q4 and Q5, OP-011 Q5, OP-015 Q3) | Gone from `src` | `grep -rnE` on those strings, 7 November 2026: no matches |
| Stale calibrate command in `DEPLOY.md` (OP-011 Q4) | Already fixed | [DEPLOY.md](DEPLOY.md) |
