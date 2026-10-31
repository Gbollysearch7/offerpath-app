# Offerpath build plan

Source of truth for the design: `design/*.dc.html`, imported from page 4 ("Web app (v2 style)") of the
OfferPath UI Redesign canvas. Owned by `senior-tech-lead`; update the API contract here before changing it.

## Stack

- **Next.js 15 (App Router) + TypeScript + Tailwind v4**: server components by default, server actions for writes.
- **Supabase** (via the `supabase-new` MCP): Postgres, Auth (magic link, SAML SSO when a university enables it), Storage for CV files.
- **Analysis engine** (`src/lib/analysis`): deterministic CV / job ad / cover letter checks.
- **CV scoring** (`src/lib/scoring-core.ts`, `src/lib/scoring.ts`): Claude Haiku (`claude-haiku-5-5`) answers four categorical questions per bullet (result, verb, kind, relevance), 3 votes, majority wins. Code computes the score from those answers plus exact rule checks. Judgments are cached forever by `sha256(rubric, judge, sector, normalised bullet words)`, so the same CV always gets the same score and edits only re-judge changed bullets. If the judge fails, the upload fails cleanly rather than mixing methods. Without an API key, the rule engine supplies the judgments.
- **Claude (optional)**: `claude-opus-5-5` for bullet rewrites and letter drafts when `ANTHROPIC_API_KEY` is set, with server-side refusal fallback. Falls back to the rule-based engine on any error.
- **Demo mode**: when Supabase env vars are missing, an in-memory store (`src/lib/repo/demo.ts`) with fictional seed data stands in, behind the same `Repo` interface.

## Screens → routes

| Prototype artboard | Route | Notes |
|---|---|---|
| App 08 Sign in | `/sign-in` | University SSO button + email magic link; `?admin=1` for careers staff |
| App 09 Onboarding | `/onboarding` | Stage, up to 3 sectors, preferences |
| App 01 My reports | `/dashboard` | Filters, search, pagination via query string |
| App 02 Upload CV | `/upload` | Drag and drop, PDF/DOCX ≤ 2 MB |
| App 10 Analysing | `/upload` (in-place state) | Shown while the upload runs |
| App 03 Results overview | `/reviews/[id]` | Score ring, history chart, steps, strengths |
| App 11 Score breakdown | `/reviews/[id]/breakdown` | |
| App 04 Check detail | `/reviews/[id]/checks/[check]` | All 16 checks, static guidance in `check-content.ts` |
| App 05 Line by line | `/reviews/[id]/lines?i=` | Rewrite, try another, save, copy |
| App 12 Example CV lines | `/reviews/[id]/examples` | |
| App 13 Action verb bank | `/reviews/[id]/verbs` | Search across all categories |
| App 14 Tailor start | `/tailor` | CV + job link or text, or a tracked role |
| App 06 Tailor result | `/tailor/[id]` | Keyword tabs, add keywords, side-by-side tailored lines |
| App 15 Cover letter start | `/letters` | Write or review mode |
| App 16 Letter draft | `/letters/[id]` (mode draft) | Edit/delete paragraphs, Word/PDF download |
| App 07 Letter review | `/letters/[id]` (mode review) | Core checks, improved version |
| App 17 Opportunities | `/opportunities` | Browse + application board |
| App 18 CV templates | `/templates` | Generated Word/PDF downloads |
| App 19 Privacy and my data | `/privacy` | Sharing toggles, ZIP export, delete account |
| Admin 01 Dashboard | `/admin` | Aggregates via `admin_overview()` |
| Admin 02 Students | `/admin/students` | Filters, CSV export |

Extra routes not in the prototype: `/help`, `/privacy-notice`, `/reviews/latest`, `/auth/callback`, `/api/*`.

## Data model (supabase/migrations)

- `universities(id, name, domain)`: email domain → university on sign-up.
- `profiles(id → auth.users, role, university_id, stage, sectors[], visa_sponsorship, deadline_reminders, share_progress, onboarded_at, course, faculty, fee_status, student_number, last_active_at)`.
- `reports(id, user_id, type cv_review|tailor|cover_letter, title, score, payload jsonb, storage_path)`: payload shapes are `CvReviewPayload`, `TailorPayload`, `CoverLetterPayload` in `src/lib/types.ts`.
- `opportunities(id, role, org, location, type, sector, sponsors_visa, closes_on, description)`: public read.
- `applications(id, user_id, opportunity_id, role, org, status saved|applied|tests|interview|offer, closes_on)`.
- `ai_usage(user_id, day, kind, count)`: daily limits (25 line rewrites, 10 letters).
- `bullet_judgments(key, judgment, judge)`: shared, append-only judgment cache. No CV text stored. Service role only.

Security: RLS on every table; reports are read-only for students (the server writes them and their scores
with the service role); students can only update whitelisted profile columns; admin data only via
security definer RPCs that include students with `share_progress = true` and hide groups under five.
CV files live in the private `cvs` bucket under `<user_id>/…`.

## API contract (server actions in `src/app/actions`)

| Action | Input | Output |
|---|---|---|
| `uploadCv` | FormData `file`, `sector`, `stage` | `{ id } \| { error }` |
| `rewriteLine` | reportId, line index, variant | `{ rewrite, left } \| { error }` |
| `acceptRewrite` | reportId, index, text \| null | `{} \| { error }` |
| `createTailor` | FormData `cvReportId`, `url` \| `text` \| `opportunityId`, `title?`, `employer?` | `{ id } \| { error }` |
| `toggleKeyword` / `createTailoredVersion` | reportId (+ keyword) | `{} \| { error }` |
| `createLetterDraft` / `createLetterReview` | FormData (job, CV, addressee, notes / letter file or text) | `{ id } \| { error }` |
| `improveLetter` / `reviewDraft` | reportId | `{ id } \| { error }` |
| `editParagraph` / `deleteParagraph` / `saveLetter` | reportId (+ index, text) | `{} \| { error }` |
| `trackOpportunity` / `moveApplication` | id, on / status | `{} \| { error }` |
| `setShareProgress` / `setDeadlineReminders` | boolean | void |
| `completeOnboarding` | stage, sectors[1..3], prefs | `{} \| { error }` |
| `deleteAccount` | FormData `confirm=DELETE` | redirect |

Route handlers: `GET /api/templates/[slug]?format=docx|pdf`, `GET /api/letters/[id]?format=docx|pdf`,
`GET /api/export` (ZIP), `GET /admin/export` (CSV, `?pack=tef` for the summary pack).

## Tasks

- [x] Role skills (`.claude/skills`)
- [x] Design tokens from the prototype (`globals.css`)
- [x] Analysis engine + unit tests (`npm run test:engine`)
- [x] All 21 prototype screens built and wired
- [x] Demo mode repo + seed
- [x] Supabase schema, RLS, storage, admin RPCs + tests in PGlite (`npm run test:db`)
- [x] Supabase repo implementation
- [x] Consistent AI scoring with Claude Haiku: rubric, voting, judgment cache, guarantee tests, live-tested
- [ ] Create the `offerpath` Supabase project in supabase-new, apply migration + seed, set env vars (needs user approval)
- [ ] Enable SAML SSO per partner university (Supabase Pro feature)
- [ ] Deadline reminder emails (preference is stored; sending job not built)
