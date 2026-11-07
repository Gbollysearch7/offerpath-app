# First deployment

Step by step, from nothing to a live pilot, for a **new** project. Day-to-day running is in [OPERATIONS.md](OPERATIONS.md). To release to the existing production project, use [RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md); current status is in [STATUS_REGISTER.md](STATUS_REGISTER.md).

## 1. Supabase (production)

1. Create a project in the London region (`eu-west-2`) on the Pro plan. Decide on Point-in-Time Recovery first ([FD-04](FOUNDER_DECISIONS.md#fd-04)): it's a paid add-on that replaces the daily backups. The existing project `levelup` is recorded on Free.
2. Link and push the schema:
   ```sh
   supabase link --project-ref <ref>
   supabase db push            # applies every file in supabase/migrations
   ```
3. Add the partner university and its email domain (this controls who can sign up):
   ```sql
   insert into public.universities (name, domain) values ('University of …', 'uni.ac.uk');
   ```
   Then add its first admin from Admin → Team once you can sign in, or insert into `public.pending_admins`.
4. Auth settings (Dashboard → Authentication):
   - Site URL: `https://<your domain>`; redirect URL: `https://<your domain>/auth/callback`
   - SMTP: Resend (`smtp.resend.com`, port 465, user `resend`, password = Resend API key), sender on your domain
   - Email templates: paste `supabase/templates/magic_link.html` and `confirmation.html`
   - SSO (if the university uses it): add their SAML provider and domain, then list the university in `SSO_UNIVERSITIES` in Vercel (`Name=domain`, semicolons between universities). The sign-in page offers university sign-in only for those listed.
   - Turn on MFA (TOTP) and ask admins to enrol
5. Storage: check the `cvs` bucket exists and is private (the migration creates it).
6. Run the security advisor and fix anything it reports.
7. Do **not** run `supabase/seed.sql` in production. It's fictional sample data for local and staging use.

## 2. Resend

Add and verify your sending domain (SPF, DKIM, DMARC). Use the API key for both `RESEND_API_KEY` and
Supabase SMTP.

## 3. Vercel

1. Import the repository. Framework: Next.js. `vercel.json` already sets the London region (`lhr1`) and the
   three cron jobs.
2. Environment variables (Production, and separately for Preview pointing at staging):

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API (server only, never `NEXT_PUBLIC_`) |
   | `NEXT_PUBLIC_SITE_URL` | `https://<your domain>` |
   | `ANTHROPIC_API_KEY` | Anthropic console |
   | `RESEND_API_KEY`, `EMAIL_FROM`, `SUPPORT_EMAIL` | Resend; `Offerpath <no-reply@yourdomain>`; your inbox (pilot requests go here) |
   | `CRON_SECRET` | `openssl rand -hex 32` |
   | `ALERT_WEBHOOK_URL` | Slack or Teams incoming webhook |
   | `LEGAL_*` | Company name, number, address, ICO registration (see `.env.example`) |
   | Optional | `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`, `RETENTION_INACTIVE_MONTHS` (default 24), `ADVISER_CV_ACCESS` (only after legal review) |

   Leave `DEMO_MODE` unset in production. A production build on Vercel fails if a required variable is missing (`REQUIRED_IN_PRODUCTION` in `src/lib/env.ts`), and `DEMO_MODE` doesn't get past that. Elsewhere, without a database and without it, or with a required variable missing, the build still succeeds but every request returns 500, including `/api/health` ([details](RELEASE_RUNBOOK.md#9-what-a-missing-variable-does)).
3. Add your domain and deploy. The configuration is checked when the server starts, not at build, so check `/api/health` after every deploy.

### Proofreading (OP-007)

The dictionary check runs inside the app with no extra setup and no outside service. No student text leaves the server, so it adds no sub-processor. It uses `nspell` (MIT) with `dictionary-en-gb` and `dictionary-en` (SCOWL word lists and Ispell-derived affix files; see each package's `license` file, whose UKACD section asks for its notice to be kept with the data). `next.config.ts` keeps these three unbundled, because the dictionaries read their files relative to the package. Expect about 100 ms and 65 MB once per server process. A production build hasn't been run with them yet: after the first deploy, upload a CV with a typo and confirm the spelling page lists it rather than "couldn't run".

Optional settings, all safe to leave unset:

| Variable | Default | Meaning |
|---|---|---|
| `PROOFREADING_LANGUAGE` | `en-GB` | `en-US` swaps which variant counts as the regional preference. The default for a student who hasn't chosen; their own choice (OP-008) overrides it. |
| `PROOFREADING_TIMEOUT_MS` | `5000` | Time budget, 100 to 30000. Running out gives a partial or unavailable report, never a pass. |
| `PROOFREADING_PROVIDER` | local | `off` reports "not assessed". `languagetool` is inactive unless both settings below are set; without them the local check keeps running. |
| `PROOFREADING_EXTERNAL_TEXT_APPROVED`, `PROOFREADING_LANGUAGETOOL_URL` | unset | **Don't set these without the founder decision in `docs/CLAUDE_BATCH_03_REPORT_OP-007.md`.** They send student CV text to that server, which means updating the sub-processor list, the DPA schedule, the DPIA and the privacy page first. The adapter has only been tested against a fake server. |

## 4. Check it works

- `https://<domain>/api/health` returns `"status": "ok"`, `"mode": "supabase"` and `"database": "ok"`
- The landing page loads; send a test pilot request and check it arrives at `SUPPORT_EMAIL`
- Sign in with a partner-university email; an email from any other domain is refused
- Upload a CV, check the score, re-upload the same file and check the score is identical
- Sign in as the admin and check the dashboard
- Run each cron job once by hand (see OPERATIONS.md) and check the response
- From your machine: `E2E_BASE_URL=https://<staging domain> npm run test:e2e` against **staging** in demo mode,
  or click through the main flows on production

## 5. Before students arrive

- Legal: privacy notice, terms and DPA signed off (see `docs/legal/` and `docs/CONTENT_REVIEW.md`)
- Careers adviser review of all advice content (`docs/CONTENT_REVIEW.md`)
- Scoring calibration against independent adviser marks: follow `docs/CALIBRATION_RUNBOOK.md`
- Real opportunities loaded (Admin → Opportunities, CSV import)
- Student records imported (Admin → Import) so course, faculty and fee status fill in at sign-up
