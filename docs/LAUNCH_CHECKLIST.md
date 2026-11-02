# Production launch checklist

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
- [x] **T24-live-db** Supabase project `levelup` (gceybiizflndbkkjzprb, London, Free plan) created, 9 migrations applied, security advisor clean, `npm run test:live` 52/52 on live data.

## Should do soon after
- [x] **T10-long-uploads** Longer server time limits for scoring, AI timeouts, clear progress and retry.
- [x] **T25-sso** SSO attribute mapping (faculty, course…) and an admin page showing SSO status.
- [~] **T04-reminders** Deadline reminder emails: scheduled job, sent once per deadline.
- [x] **T11-monitoring** Structured logs, server error reporting hook, alert webhook, health checks, AI failure alerts.
- [x] **T12-security** Content-Security-Policy with nonces, rate limits on sign-in and uploads, PDF parsing in an isolated worker.
- [x] **T13-ops** Backups, staging, migration and rollback process (operations guide, Supabase CLI config).
- [x] **T14-ci** GitHub Actions: typecheck, lint, tests, build on every push.
- [x] **T15-calibration** Rubric weights in one config file, plus a calibration script comparing scores to adviser marks.
- [x] **T16-admin** Working term selector, paged student list, fuller Graduate Outcomes / TEF pack.
- [x] **T17-a11y** Automated accessibility audit (axe) and an end-to-end smoke test across every page; fix findings.

## Nice to have
- [x] **T18-landing** Marketing landing page from the design (page 3).
- [x] **T19-content** Full example CV templates; guidance marked for expert review.
- [x] **T20-adviser** Adviser features behind a flag: view CVs of students who consent, score review notes.
- [x] **T21-tools** Interview practice, aptitude practice, role roadmaps.
- [x] **T22-polish** App icon, social share image, optional privacy-friendly analytics.

## Before the first pilot (2026-11-02)
Tracked as GitHub issues with the `production` label; `blocker` ones come before any real student data.

- [~] **#1 CI on main** Fixed in PR #15; `main` now requires the `check` job to pass before merging.
- [ ] **#14 Supabase Pro + backups** The database is on the Free plan (pauses when idle, no point-in-time restore).
- [ ] **#2 Domain** Production runs on `offerpath-app-lake.vercel.app`; the demos and email default say `offerpath.app`.
- [ ] **#3 Email from your domain** `EMAIL_FROM` is Resend's test sender, which only delivers to the account owner.
- [ ] **#5 Production config** Deployed and healthy; the legal details below are still missing.
- [ ] **#8 Company and ICO details** The legal pages show placeholders until the `LEGAL_*` variables are set.
- [ ] **#9 Legal sign-off** · **#10 Adviser content review** · **#11 Scoring calibration** · **#12 First pilot university**
- [ ] **Test sign-in off** Remove `TEST_LOGIN` from the Production environment before real students sign up.
- [~] **#6 Staging** Preview deployments need `DEMO_MODE=true` and a `DEMO_SECRET` (Preview only) to run as a demo-data staging site.
- [~] **#7 Monitoring** `.github/workflows/uptime.yml` checks `/api/health` every 15 minutes and emails on failure; chat alerts need `ALERT_WEBHOOK_URL`.
- [x] **#13 Secrets** Full git history scanned (no keys or env files); GitHub secret scanning and push protection on. Public vs private is still your call.
- [ ] **#4 Reminders** `CRON_SECRET` is set; confirm one reminder email arrives once email is on your domain.
