# Security controls

**DRAFT. Not reviewed by a security reviewer. Not a commitment.** Evidence levels are defined in the [README](README.md).

**No penetration test has been done. No certification is held. No independent security assessment exists.** OP-026, OP-021, OP-022 and OP-025 are the implementing agents' own work, awaiting acceptance review. `[TO SUPPLY: security reviewer's name. Founder.]`

Tests ran on the shared working tree on 7 November 2026: `npm run test:engine` 938 pass, 0 fail; `npm run test:db` 357 + 95 checks pass, 0 fail. Both run locally against fakes, demo mode and PGlite.

## Access and identity

| Control | How | Level | Gap |
|---|---|---|---|
| No passwords: emailed one-time link, or SAML SSO | Supabase Auth; `src/app/actions/auth.ts` | Seen on live, older code, except email | **No real delivery recorded.** No SSO provider connected. |
| Only partner domains can sign up | Trigger on `auth.users` | Seen on live, 27 October | Hand-set per university in SQL |
| Test and demo sign-in can't reach production | `testLoginEnabled`, `demoLoginAllowed`; `tests/security-auth.test.ts` | Locally tested. On production: variable absent, no buttons ([E1, E2](../STATUS_REGISTER.md#e1)). | **Previews** with no variables open a fictional demo by design. Not yet run on Vercel. |
| Staff multi-factor authentication | A Supabase setting, per [DEPLOY.md](../DEPLOY.md) | **Not verified. Setting not read.** | **No application code requires a second factor** (a search for `aal` and `mfa` in `src/` finds nothing), so enrolment isn't enforced. |
| Staff roles: careers admin, adviser | `src/lib/institution/permissions.ts`; `tests/adviser-db.test.ts` checks eleven rows per role | Locally tested; unapplied migration | No real adviser use |
| Account recovery | A new sign-in link | Depends on email. **Open.** | No steps written for a lost admin |
| Staff leaving: removal of access | Admins can remove admins and advisers | Locally tested | `[TO SUPPLY: operator's own joiner and leaver process. Founder.]` |

## Tenant and data separation

| Control | How | Level | Gap |
|---|---|---|---|
| Row-level security on every table | Migrations; `supabase/tests/*.mjs`. Live checks on 27 October through the public API. | Seen on live, older code, for the original tables. Newer tables: locally tested. | PGlite stubs `auth.uid()`. No real PostgREST for the new tables. |
| Students can't read each other's data | `tests/security-tenancy.test.ts` at repository, action and route layers | Locally tested; seen on live for the original routes | |
| Staff can't reach another university | `staff_can_see()`, `tests/adviser-db.test.ts` "two universities" | Locally tested; unapplied | |
| All universities share one database | One project; logical separation by row. | Design fact | No per-university region or instance. Another live app is in the same Supabase organisation, in a separate project. |
| Students can't write scores | `20261027090000_scoring_integrity.sql` | Seen on live, 27 October | |
| Sign-up metadata can't claim student fields | `20261107120000_security_hardening.sql` | Locally tested. **Not applied, so the gap remains on the live database as recorded.** | From recollection of Supabase's SSO behaviour; needs a real SSO test |
| Students can't delete their own stored original | Same migration | Same | Same |
| Service role key is server-only | Test: "the service-role client: never in browser code" | Locally tested | |
| Staff access log, append-only, written with the access | `staff_access_log`; 40 of 40 mutations caught by tests (OP-021) | Locally tested; unapplied | Student list views not logged per view. A refused note isn't logged. **Until applied, adviser access is logged only in application logs,** which last a day or less. |

## Files and input

| Control | How | Level | Gap |
|---|---|---|---|
| Private bucket, 2 MB, PDF and Word only | `20261026120000_initial_schema.sql` | Seen on live, older code | |
| Signed link for adviser CV view, 60 seconds | `src/lib/repo/supabase.ts`; feature off | Locally tested | A link issued can't be recalled inside its minute |
| Parsing bombs bounded: 20 MB zip output, 1,000 entries, 10 PDF pages, 40,000 characters, worker heap, 512 MB growth, 20 s | `src/lib/analysis/extract.ts`; `tests/security-uploads.test.ts` | Locally tested | **Whether workers run on Vercel is unverified.** If they can't start, parsing falls back to in-process with no limit. The peak measured (under 850 MB) exceeds a 512 MB function. Vercel's memory setting not read. |
| Malware scanning of uploads | None | **Not built** | Files are parsed for text and stored. They aren't scanned. |
| Link fetching guarded against internal addresses | `src/lib/safe-fetch.ts`; 15+ attack URLs (QA log) | Seen on live, older code | |
| Prompt injection: delimiters, instruction removal, tag defusing, output validation, no tools | `src/lib/ai.ts`, `src/lib/analysis/` | Locally tested | **No real model has been tested on hostile text.** |

## Transport, headers, encryption

| Control | How | Level | Gap |
|---|---|---|---|
| TLS, HSTS, frame denial, nonce-based CSP | `next.config.ts`, `src/middleware.ts` | **Seen in production,** 7 November 2026, on `/sign-in` only ([E2](../STATUS_REGISTER.md#e2)) | One page |
| Encryption at rest | Stated by the DPA template. A feature of the provider, not this code. | **No evidence on file.** | `[TO SUPPLY: provider documentation or attestation. Founder.]` |
| Backup encryption | Procedure says encrypt | **Not built:** no backups | |
| Share-link protection: 256-bit token, only a hash stored, no-referrer, noindex | `tests/sharing*.test.ts` | Locally tested; unapplied; off | Token appears in hosting logs |

## Logging and secrets

| Control | How | Level | Gap |
|---|---|---|---|
| Logs omit document text and secrets | `src/lib/log.ts`; `tests/security-logging.test.ts`, with canaries | Locally tested | Can't recognise a name in free text |
| Secrets only in Vercel variables | `vercel env ls`, names only | Seen in production for names | Values not read |
| Git history scan, secret scanning, push protection | Checklist #13 | Recorded 2 November, not re-read | Repository visibility undecided |
| Anthropic key replacement | [FD-06](../FOUNDER_DECISIONS.md#fd-06) | **Open.** No report records why it's needed. | |
| Dependency vulnerability scanning | No Dependabot or `npm audit` step in `.github/` (searched) | **Not built** | `nspell` last published 2022, word data from 2020 |

## Abuse and cost

| Control | How | Level | Gap |
|---|---|---|---|
| Per-user and per-IP rate limits | `src/lib/rate-limit.ts` | Locally tested; seen on live for original limits | **Fails open** if its own database call errors, by design, with errors logged |
| Daily AI limits per student; a failure cap | `ai_usage`; `tests/recovery*.test.ts` | Locally tested; part unapplied | Numbers are judgement. Failure cap doubles worst-case spend. |
| Provider spend ceiling | Provider's own setting | **Not verified.** | No global ceiling in the app (FD-07) |

## Not in place

Penetration test. Certification (Cyber Essentials, ISO 27001, SOC 2 or any other). Load test. Staging environment. Recent security advisor run (last recorded clean on 27 October, for 9 migrations). A written information security policy. Staff vetting or training records: `[TO SUPPLY: whatever exists. Founder.]` The annual security summary the DPA template offers does not exist.

**Known data on the live database to clear before students arrive:** two test accounts and a test university row (`levelup-qa.ac.uk`), existence not re-checked ([FD-08](../FOUNDER_DECISIONS.md#fd-08)).

`[TO SUPPLY: security reviewer's sign-off and date. Named reviewer.]`
