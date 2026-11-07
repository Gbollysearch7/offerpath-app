# Production launch checklist

> **History. The current status is in [STATUS_REGISTER.md](STATUS_REGISTER.md).** Kept because the GitHub issue numbers and tag names are used elsewhere. Corrected 7 November 2026 for OP-028, where a line claimed more than its evidence. Open decisions are in [FOUNDER_DECISIONS.md](FOUNDER_DECISIONS.md), and the release steps in [RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md).

Each tag is built, then QA'd (typecheck, lint, tests, and a run of the feature) before the next starts.
Status: `[ ]` to do · `[~]` built, waiting on something from you · `[x]` done and verified.

## Blockers
- [x] **T01-checklist** This list.
- [x] **T02-prod-guard** Environment validation, demo mode can't run in production, `/api/health` endpoint.
- [~] **T03-email** Email sender (Resend), branded Supabase auth email templates, SMTP setup notes.
- [x] **T05-institution-data** Admin CSV import of student records (number, course, year, faculty, fee status); applied on sign-up.
- [x] **T06-admin-roles** Admins can add/remove other careers admins at their university.
- [x] **T07-opportunities** Careers teams manage their own opportunities (add, edit, remove, CSV import).
- [x] **T08-ui-truth** Remove or correct claims the app doesn't back up (adviser override, data location, WCAG badge, retention placeholder).
- [x] **T09-legal** Privacy notice, terms, accessibility statement, sub-processors, cookies page; DPIA/DPA templates; footer links.
- [x] **T23-deploy** Vercel config (UK region, crons), deploy guide, build warnings fixed.
- [x] **T24-live-db** Supabase project `levelup` (gceybiizflndbkkjzprb, London, Free plan) created, 9 migrations applied, security advisor clean, `npm run test:live` 52/52 on live data (27 October). QA records two more migrations pushed on 30 October, making 11. Nine more in the tree are not applied.

## Should do soon after
- [x] **T10-long-uploads** Longer server time limits for scoring, AI timeouts, clear progress and retry.
- [x] **T25-sso** SSO attribute mapping (faculty, course…) and an admin page showing SSO status.
- [~] **T04-reminders** Deadline reminder emails: scheduled job, sent once per deadline.
- [x] **T11-monitoring** Structured logs, server error reporting hook, alert webhook, health checks, AI failure alerts.
- [x] **T12-security** Content-Security-Policy with nonces, rate limits on sign-in and uploads, PDF parsing in an isolated worker.
- [~] **T13-ops** Backups, staging, migration and rollback process: **written down only**. No backup is running, staging doesn't exist and no restore has been rehearsed.
- [x] **T14-ci** GitHub Actions: typecheck, lint, tests, build on every push.
- [x] **T15-calibration** Rubric weights in one config file. The script ticked here was replaced by OP-011's tooling ([runbook](CALIBRATION_RUNBOOK.md)). No adviser has marked anything: see #11.
- [x] **T16-admin** Working term selector, paged student list, fuller Graduate Outcomes / TEF pack.
- [x] **T17-a11y** Automated accessibility audit (axe) and an end-to-end smoke test across every page; fix findings. Automated checks aren't conformance: see OP-027.

## Nice to have
- [x] **T18-landing** Marketing landing page from the design (page 3).
- [x] **T19-content** Full example CV templates; guidance marked for expert review.
- [x] **T20-adviser** Adviser features behind a flag: view CVs of students who consent, score review notes.
- [x] **T21-tools** Interview practice, aptitude practice, role roadmaps.
- [x] **T22-polish** App icon, social share image, optional privacy-friendly analytics.

## Before the first pilot

Written 2 November 2026. GitHub issue states weren't re-read for OP-028.

Tracked as GitHub issues with the `production` label; `blocker` ones come before any real student data.

- [~] **#1 CI on main** Fixed in PR #15; `main` now requires the `check` job to pass before merging.
- [ ] **#14 Supabase Pro + backups** The database is on the Free plan (pauses when idle, no point-in-time restore).
- [ ] **#2 Domain** Production runs on `offerpath-app-lake.vercel.app`; the demos and email default say `offerpath.app`.
- [ ] **#3 Email from your domain** `EMAIL_FROM` is Resend's test sender, which only delivers to the account owner.
- [ ] **#5 Production config** Recorded as deployed and healthy on 2 November. Seven variables are missing and Preview has none (`vercel env ls`, 7 November; see the [runbook](RELEASE_RUNBOOK.md#4-environment-variables)).
- [ ] **#8 Company and ICO details** The legal pages show placeholders until the `LEGAL_*` variables are set.
- [ ] **#9 Legal sign-off** · **#10 Adviser content review** · **#11 Scoring calibration** · **#12 First pilot university**
- [ ] **Test sign-in off** Since OP-026 `TEST_LOGIN` does nothing on any production or preview deployment, so the buttons are already gone once this code ships. `vercel env ls` on 7 November shows the variable isn't set on any environment, and the production sign-in page has no buttons. Still: delete the `test.student@` and `test.careers@levelup-qa.ac.uk` accounts and the `levelup-qa.ac.uk` university row from the production database before real students sign up.
- [ ] **#6 Staging** Preview has no variables, so previews are expected to fail at boot. They need `DEMO_MODE=true` and a `DEMO_SECRET` (Preview only) to run as a demo-data site, or a staging Supabase project to test migrations.
- [~] **#7 Monitoring** `.github/workflows/uptime.yml` checks `/api/health` every 15 minutes and emails on failure; chat alerts need `ALERT_WEBHOOK_URL`, which isn't set (7 November).
- [x] **#13 Secrets** Full git history scanned (no keys or env files); GitHub secret scanning and push protection on. Public vs private is still your call.
- [ ] **#4 Reminders** The `CRON_SECRET` name exists; confirm one reminder email arrives once email is on your domain.
