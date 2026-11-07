# Claude execution prompt — Offerpath batch 01

The founder has explicitly authorised Codex to launch you on the first implementation batch and then independently review your changes. You are working in `/Users/gbolahan/Documents/NEW ME/LevelUp`.

Read `docs/COMPETITIVE_PRODUCT_BLUEPRINT.md` and `docs/CLAUDE_IMPLEMENTATION_TASKS.md`. Implement **OP-001 and OP-002 only**, then stop. You are implementing a bounded trust/diagnostics improvement, not the full roadmap. Do not declare full proofreading, contextual matching or CareerSet parity achieved.

## Protected work and boundaries

The following files already contain the founder's uncommitted changes. Do not modify or revert any of them, or any other file under `src/app/_landing/`:

- `src/app/_landing/Landing.tsx`
- `src/app/_landing/demos/OfferpathHero.css`
- `src/app/_landing/demos/OfferpathHero.tsx`
- `src/app/_landing/demos/TrackerDemo.css`
- `src/app/_landing/demos/TrackerDemo.tsx`

Do not commit, push, deploy, install dependencies, call external model APIs for app analysis, operate live services, read `.env*`/credentials/private CVs, or change database migrations. Do not change scoring numbers/formulas, check keys, rubric/cache/fingerprint versions or authentication. Do not edit `src/lib/analysis/rubric.ts`; global band naming is deferred to OP-003. Do not change the blueprint or task register. Do not delegate additional agents.

Permitted output: synthetic fixture(s), diagnostic script, targeted tests, package script if useful, description changes in `src/lib/analysis/cv.ts` and `check-content.ts`, necessary non-landing report/help/privacy/admin presentation copy, and `docs/CLAUDE_BATCH_01_REPORT.md`.

## Exact reproduced audit inputs

Clean CV:

```text
Alex Example
alex@example.com 07700 900123 linkedin.com/in/alex
EDUCATION
Example University 2023 - 2026
BSc Computing
EXPERIENCE
Analyst | Example Ltd | 2025 - Present
• Managed customer relationships and improved team reporting accuracy by 20%.
• Developed financial reports and presented recommendations to 12 colleagues.
SKILLS
Excel SQL Python Communication
```

Create the misspelled variant by replacing `customer relationships` with `custmer relatonships`, `financial` with `finanical`, and `recommendations` with `recomendations`. Both currently score 10/10 on spell and grammar. Do not fix the numeric engine in this batch. Instead report the known missing detection and ensure the messages accurately describe the limited existing checks.

Advert:

```text
Must have Kubernetes and Terraform. Desirable: Excel. Excel is used for occasional reporting.
```

CV evidence for matching: `Excel`. The current dictionary/frequency engine misses Kubernetes and Terraform, marks Excel as essential, and returns 77. The diagnostic's desired gate is both technologies identified essential, Excel desirable, and essential evidence gaps exposed. Do not hardcode a repair or endorse the current output in a passing regression test.

## Required implementation detail

1. Add a diagnostic with JSON output showing actual observations and clearly named unmet desired gates. Default observation mode may succeed as a data-collection operation; `--check` must return nonzero while desired quality gates are unmet. Validate the script itself with explicit scenarios and document commands. The diagnostic must call real analysis functions, not copy their logic.
2. Rename current general spelling/grammar labels to accurately scoped names and update positive, negative, static guidance, area explanations and empty-bullet messages as appropriate. Explain that regional variants are preferences, not inherently spelling mistakes; a limited rule check is not comprehensive proofreading.
3. Replace screening-software/layout guarantees with observed text readability and explicit assessment limits. Label word-derived page counts as estimates in summary/stat/detail.
4. Remove the admin claim that advisers can override scores. Correct absolute rewrite-factuality copy on permitted help/privacy/report surfaces, explaining the need for student review. Log protected landing and global band issues as deferred.
5. Preserve every numeric result, check key and version identifier. Add focused tests verifying scoped coverage messages and numeric stability on representative inputs; avoid superficial snapshots of unrelated implementation details.
6. Describe limitations of legacy saved payloads; do not silently rewrite their historical content. If safe current-view contextual text can clarify the limit without altering stored data, implement it and test it.

## Validation and report

Run `npm run typecheck`, `npm run lint`, and `npm run test:engine` if permitted. The sandbox may prevent `tsx` IPC or the monitoring test's local listener. A useful alternative is `NODE_OPTIONS=--conditions=react-server node --import tsx --test tests/*.test.ts`; report environmental failures rather than editing tests to hide them. Do not run `test:live`.

Write `docs/CLAUDE_BATCH_01_REPORT.md` with task status, changed files, actual test outcomes, diagnostic observations, remaining limitations and any checks Codex must rerun. Explicitly state that the underlying proofreading and matching defects remain open for OP-007 and OP-012/013. Stop after reporting. Codex will inspect the diff, rerun checks and decide acceptance.
