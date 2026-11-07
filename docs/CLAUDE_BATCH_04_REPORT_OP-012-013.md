# Offerpath batch 04 report: OP-012 and OP-013

Prepared 7 November 2026 by Claude, for independent acceptance review by Codex. Written while other agents
were working in the same uncommitted tree, so test totals include their tests and can move.

## What this does and does not claim

New tailor reports read requirements from the advert's own wording, match each one to quoted CV evidence and
report **evidence coverage** under a new version, `job-match-2026-11-06.1`. The unconditional 30 points are
gone from that version. It works deterministically with no AI key.

- It does **not** predict hiring or ATS outcomes, and the interface says so.
- The weights and credits are **uncalibrated product judgments**. No adviser has validated them or the
  extraction.
- The semantic adapter has **only been run against simulated responses**. `aiExtractRequirements` has never
  called a provider.
- It does **not** deliver OP-014: no student interpretation of requirements, no versioned revised documents,
  no accepted-text-equals-download guarantee.
- Nothing was committed, pushed, deployed or migrated. No live database or paid provider was touched.

## Task status

| Task | Status | Notes |
|---|---|---|
| OP-012 | Implemented → Locally verified | Rules verified by tests and in a browser. Adapter verified with simulated responses only. |
| OP-013 | Implemented → Locally verified | Old-report rendering verified through the real view outside a browser (see Validation). |

## Changed files

New, owned by this task:

- `src/lib/analysis/job-requirements.ts`: extraction, aliases, term matching, adapter validation and merge.
- `src/lib/analysis/job-match.ts`: evidence levels, coverage, version history, findings, prompts.
- `src/lib/analysis/job-match-content.ts`: weights, credits and wording. Client-safe, because the engine needs
  Node crypto and the report view is a client component.
- `src/app/tailor/[id]/JobMatchPanel.tsx`: coverage, gaps, requirements and the legacy note.
- `tests/job-requirements.test.ts`, `tests/job-match.test.ts`, `tests/fixtures/render-tailor.tsx`.

Edited, owned by this task: `src/lib/analysis/job.ts`, `src/app/tailor/[id]/TailorView.tsx`,
`src/app/tailor/page.tsx` (one sentence), `src/app/actions/tailor.ts`.

Edited, shared (small and additive unless stated):

- `src/lib/types.ts`: new job types; `matchNow` and `matchTailored` become nullable; optional `jobMatch` and
  `assessment` on `TailorPayload`.
- `src/lib/report-schema.ts`: the matching schema and `tailorProblems` in the write gate.
- `src/lib/services.ts`: `buildTailorPayload` body and imports. CV path untouched.
- `src/lib/ai.ts`: `aiExtractRequirements` and one import.
- `src/app/dashboard/page.tsx`: one condition, so a tailor row no longer gets a CV band label such as "Strong".
- `scripts/diagnose-audit.ts`: job adapter only (`observeMatching`, one type, one report word, header comment).
- `tests/audit.test.ts`: the adapter assertions and one comment. **Outside the listed ownership**, but they
  asserted the old adapter.
- `tests/payload.test.ts`: tailor numbers pinned to the new version (35/66 to 29/null), one message.
- `tests/fixtures/legacy-payloads.ts`: `LEGACY_TAILOR` now uses the old keyword functions directly. It used
  `buildTailorPayload`, which would have stopped producing a legacy shape.

## Behaviour

**Categories.** A cue in the clause decides first, then the heading above it. Occurrence count is stored as
prominence and is not read by classification.

| Category | Comes from | Counted |
|---|---|---|
| essential | "must have", "required", requirement headings | yes |
| desirable | "desirable", "a plus", "nice to have" | yes |
| contextual | "you will use", responsibilities sections, passing mentions | no |
| uncertain | "should have", a bare "Skills" heading, contradictions, wording that can't be read as a skill | no |

- Unknown names are captured from their shape and position. The dictionaries only normalise.
- "A or B", "A, B or C" and "A/B" are one requirement with alternatives. "or similar" and "such as" are
  recorded as accepting an equivalent.
- "No experience necessary" and similar go to `notRequired`, never to requirements, and are not highlighted.
- "Would be useful but is not essential" stays desirable.
- An advert that both requires and dismisses a term gets `uncertain`, not a guess.
- Right to work, driving licences, clearance, location, years of experience and English are kept but marked
  `assessable: false`. They appear under "Check these yourself" and are never gaps or part of the number.

**Evidence.**

| Level | Meaning | Credit |
|---|---|---|
| explicit | named in a line describing activity | 1 |
| contextual | related, not named (small family list, shown-by patterns, degree without the grade or subject) | 0.5 |
| weak | named only in a list | 0.25 |
| none | nothing found, or named only to deny it ("no experience of X") | 0 |

**Coverage.** `100 x sum(weight x credit) / sum(weight)`. Essential weighs 3, desirable 1, soft skills half.
Fewer than two counted requirements gives `score: null`, an explanation and "NOT SCORED". Essential gaps are
shown separately from the number in every status.

**Tailoring.**

- "Include" (formerly "Add") changes no score.
- `matchTailored` is null until an actual tailored CV is measured with `remeasure`, against the same saved
  requirements.
- Rule-based tailoring on new reports now produces prompts with blanks and never edits a student's line.
  **This goes slightly beyond OP-013.** Once Kubernetes was extracted, the old code would have appended
  "using Kubernetes" to a real bullet, automatically on arrival. OP-014 still owns the full flow.

**Semantic adapter.** It is called only when the rules leave the advert undecided, and it shares the `tailor`
daily limit. Malformed output, a throw or a null falls back to the rules with status `failed`. An item is
dropped if its quote isn't in the advert, its term isn't in the quote, the quote contradicts its category, or
the term is negated. It can decide what the rules left open and add new items, but not overrule a stated cue.

## Schema and write gate

`TailorPayload.jobMatch` and `.assessment` are optional and `PAYLOAD_VERSION` is unchanged. Findings use the
batch 02 `Finding` and `EvidenceRef` shapes, with the advert quotation first. `toStored` rejects:

- a different advert hash;
- `matchNow` differing from coverage;
- an advert quotation not at its stated offset;
- CV evidence from another CV version;
- evidence cited on a requirement marked none;
- an assessment without a job match.

## Legacy adapter rules

A report without `jobMatch` predates versioned job scoring.

- Its saved `matchNow`, `matchTailored` and keywords are returned unchanged and nothing is invented.
- The old rings render under a limited-evidence note.
- "Add" and rule-based tailoring no longer change its numbers. **This is a behaviour change.**
- `matchScores`, with its 30-point base, survives for one production caller: the AI branch on a legacy report,
  so the result stays comparable with that report's saved number. No new report reaches it.

## Validation: commands and actual results

Run with `ANTHROPIC_API_KEY` blank.

| Command | Result |
|---|---|
| `npm run typecheck` | status 0 |
| `npm run lint` | status 0: 0 errors, 1 warning in `tests/e2e/smoke.mjs` (not this task). Run before the last test edit; eslint on this task's files re-run after it, status 0 |
| `npm run test:engine` | exit 0: 383 tests, 383 pass, 0 fail (other agents' tests included) |
| `tests/job-requirements.test.ts` and `tests/job-match.test.ts` | 48 tests, 48 pass |
| `git diff --check` | exit 0 |
| `npm run diagnose:audit` | exit 0 |
| `npm run diagnose:audit -- --check` | exit 0, GATES: 9 met, 0 unmet |

The audit advert gives Kubernetes and Terraform as essential and Excel as desirable at 2 occurrences. Coverage
is 4/100 on the Excel-only CV and 0/100 with no evidence.

**The gates can fail.** `tests/job-match.test.ts` feeds the old keyword output through the same `evaluateGates`:
all 5 matching gates are unmet and `--check` logic returns 1.

**Old-report rendering.** Three tests render the real `TailorView` to HTML through `render-tailor.tsx`, from a
stored payload through `fromStored`. Only the router and server actions are stubbed. The old report shows
`Match now 35`, `Estimated match after tailoring 66` and the note. This was **not** seen in a browser, because
no demo path reaches a legacy report.

**Browser check.** `next dev -p 3600` with Supabase, Resend and Anthropic blanked and `DEMO_MODE=true`. The boot
log said `"mode":"demo"`. The server was stopped by PID. The driving script is not in the repo; its steps were sign in, submit each
advert, Include, Tailor, reload, dashboard, 390px width.

| Check | Observed |
|---|---|
| Audit advert with the demo CV | 14 of 100, "2 essential requirements with no evidence", Kubernetes and Terraform listed |
| Include, tailor, reload | still 14; gap still shown; prompt with blanks; no bullet altered |
| Vague advert | "NOT SCORED", explanation, no ring, dashboard shows "–" |
| 390px | 0px horizontal overflow |

**The shared `.next` did conflict.** Dev servers on :3000 and :3500 (and :3700 earlier) shared the directory.
- One sign-in timed out and passed on retry.
- `tsc` once reported transient `.next/types` TS6053 errors.
- Each browser run logged a 404 and a MIME error for `/_next/static/chunks/app/page.js`. I attribute this to
  the sharing but did not prove it. It should be rechecked on a clean server.
- The :3000 listener's PID changed between my checks (44216 to 51318) before I started any server. I did not
  stop it and don't know why it changed.

## Limitations

- CV quotations can't be checked at the write gate, because a tailor report doesn't store the CV. They are
  built from the CV text, tested, and tied to it by `cvVersion`.
- Extraction is heuristic and English-only. Multilingual support is limited to accent folding.
- Unfamiliar sectors were sampled with a few synthetic adverts, not evaluated.
- Treating "What we look for" as essential is a judgment, and it can overstate a gap.
- Lower-case generic phrases can become uncertain items or, as single words, requirements.
- The AI branch of `createTailoredVersion` and the action wiring for the adapter have no direct test. Their
  parts (`remeasure`, `extractWithAdapter`) do.
- Letter reviews still use `jobKeywords`, so letter scores are unchanged and letters keep the old reading.
- `tests/e2e/smoke.mjs` and `test:db` were not run. No schema changed.
- `src/app/_landing/demos/TailorDemo.tsx` and other marketing copy were not inspected or edited, and may still
  describe a before-and-after match.

## Migration impact

None. No SQL. `reports.score` is already nullable, and the check constraint allows it.

## Checks Codex must rerun

1. All commands in the table above.
2. Swap names in the audit advert for invented ones and confirm the same structure returns.
3. Confirm `buildTailorPayload` never calls `matchScores`.
4. Feed malformed adapter output through `extractWithAdapter`.
5. Recheck the tailor pages on a clean dev server for the console errors above.

## Unresolved questions for Codex or the founder

1. Are the weights (3/1, half for soft skills) and credits (1/0.5/0.25) acceptable before adviser calibration?
2. Should headings like "What we look for" be essential or uncertain?
3. Is prompt-only rule-based tailoring acceptable until OP-014, given that it removes the old no-key rewrites?
4. Should the semantic adapter keep sharing the `tailor` daily limit?
