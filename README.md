# Offerpath

CV reviews, job tailoring, cover letters and an opportunities tracker for UK university students, plus a
careers-team dashboard. Built from the "Web app (v2 style)" prototype in `design/`.

## Run it

```bash
npm install
cp .env.example .env.local   # optional: leave empty for demo mode
npm run dev                  # http://localhost:3000
```

With no Supabase keys the app runs in **demo mode**: sign-in opens a fictional student (Jordan Reed) or,
from "Careers team? Sign in…", a fictional admin. Data lives in memory and resets when the server restarts.
On a production or preview deployment, demo mode needs `DEMO_MODE=true`; otherwise every request fails, by design.

## How CV scoring works

Claude Haiku answers four fixed questions about each bullet (measurable result? verb strength? achievement
or duty? sector relevance?). It never gives a number; code calculates the score from those answers plus
exact checks. Each bullet's answers are cached by a fingerprint of its words, so **the same CV always gets
the same score** (even re-exported as Word or PDF) and editing a CV only re-judges the bullets you changed.
See `src/lib/scoring-core.ts` and `tests/scoring.test.ts`. Changing the rubric? Bump `RUBRIC_VERSION` in
`src/lib/analysis/rubric.ts`.

## Connect Supabase

1. Create a project (UK/EU region) and apply `supabase/migrations/*.sql` in order, then `supabase/seed.sql`. Local and staging only: never run the seed in production.
2. Put the project URL, anon key and service role key in `.env.local`.
3. In Supabase Auth, set the site URL and add `<site>/auth/callback` as a redirect URL.
4. To make someone a careers admin: `update profiles set role = 'admin' where email = '…';`

## Check it

```bash
npm run typecheck && npm run lint
npm test          # engine + scoring-guarantee tests + database schema/RLS tests (PGlite, no server needed)
npm run build
```

## Layout

- `src/app`: routes, server actions (`actions/`), route handlers (`api/`, `admin/export`)
- `src/lib/analysis`: rule-based CV, job ad and cover letter analysis
- `src/lib/repo`: `Repo` interface with demo and Supabase implementations
- `src/lib/ai.ts`, `src/lib/provider.ts`: Claude calls. With no key the rule engine is used; on a provider failure, what happens depends on the workflow
- `supabase/`: migrations, seed and schema tests
- `docs/PLAN.md`: routes, data model, API contract, task list
- `docs/STATUS_REGISTER.md`: current launch status. Also `docs/FOUNDER_DECISIONS.md`, `docs/RELEASE_RUNBOOK.md`, `docs/RESTORE_PROCEDURE.md`
- `.claude/skills`: the tech lead, frontend, backend and QA role skills
