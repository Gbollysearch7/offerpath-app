# First deployment

Step by step, from nothing to a live pilot. Day-to-day running is in [OPERATIONS.md](OPERATIONS.md).

## 1. Supabase (production)

1. Create a project in the London region (`eu-west-2`) on the Pro plan, and turn on Point-in-Time Recovery.
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
   - SSO (if the university uses it): add their SAML provider and domain
   - Turn on MFA (TOTP) and ask admins to enrol
5. Storage: check the `cvs` bucket exists and is private (the migration creates it).
6. Run the security advisor and fix anything it reports.
7. Do **not** run `supabase/seed.sql` in production. It's fictional sample data for local and staging use.

## 2. Resend

Add and verify your sending domain (SPF, DKIM, DMARC). Use the API key for both `RESEND_API_KEY` and
Supabase SMTP.

## 3. Vercel

1. Import the repository. Framework: Next.js. `vercel.json` already sets the London region (`lhr1`) and the
   two cron jobs.
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

   Leave `DEMO_MODE` unset in production. The app refuses to start without a database unless it's set.
3. Add your domain and deploy. On startup the app checks its configuration and logs any problem.

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
- Scoring calibration against adviser scores: `npm run calibrate -- --dir calibration --ai`
- Real opportunities loaded (Admin → Opportunities, CSV import)
- Student records imported (Admin → Import) so course, faculty and fee status fill in at sign-up
