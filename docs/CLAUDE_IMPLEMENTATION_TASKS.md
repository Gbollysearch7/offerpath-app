# Offerpath implementation register for Claude

Prepared 5 November 2026. Read [the product blueprint](COMPETITIVE_PRODUCT_BLUEPRINT.md) before implementing. This is a prioritised backlog, not a claim that these features are already implemented. Codex is the acceptance reviewer. The founder has authorised launching **batch 01 only** in the present session; later batches are ready for subsequent implementation.

## Operating rules

- Preserve the existing Next.js, TypeScript and repository architecture. Inspect current contracts before editing. Do not replace the application or introduce a second persistence path.
- Preserve the invariant: identical CV content under the same scoring version has the same core score regardless of student, institution or sector. Keep relevance separate.
- Report facts, uncertainty and assessment coverage explicitly. Never return a perfect score because an assessment failed or was skipped.
- Use synthetic fixtures. Do not commit CVs, credentials, browser state, production exports or external screenshot collections containing personal information.
- Never fabricate adviser approval, calibration results, accessibility conformance, procurement approval or production verification.
- Do not deploy, migrate a live database, publish, send emails, spend money on external evaluation traffic, commit, or push as part of this handoff.
- Do not edit the founder's existing changes under `src/app/_landing/`. Record relevant copy issues there for a later coordinated change.
- Every batch ends with a change report: task IDs, changed files, behaviour, validation commands/results, limitations, migration impact and unresolved questions. Mark partial work partial.

## Status vocabulary

`Open` → `Implemented` → `Locally verified` → `Adviser validated` / `Pilot validated` / `Production verified`, as applicable. A task cannot skip a required human or operational gate. The task descriptions below remain the baseline; implementation and review reports record actual status separately.

## Batch 01 — honest scope and reproducible audit cases

### OP-001 — Make the reproduced failures executable (P0)

**Scope:** new synthetic audit fixtures and a diagnostic script under `tests/fixtures/` and `scripts/`; a small package script if needed. Consult `src/lib/analysis/cv.ts`, `job.ts`, and existing test conventions.

**Build:** preserve the original clean CV, its four misspellings, and the Kubernetes/Terraform/Excel advert. Produce machine-readable observations alongside desired acceptance conditions. Separate currently unmet product gates from passing engine unit tests. A check mode should fail when the desired behaviour is absent; an observation mode may exit successfully while clearly reporting failed gates.

**Acceptance:** anyone can reproduce spelling failing to catch the four errors and requirement extraction missing essential technologies while promoting repeated desirable Excel. No test may assert that this incorrect behaviour is correct. No hardcoded production fix for these particular words. Diagnostics must invoke the real analysis functions and explain that matching repair and proofreading are later tasks.

**Validation:** run the diagnostic and record actual values and exit semantics; run existing engine tests. Dependencies: none.

### OP-002 — Correct misleading descriptions in the existing core (P0)

**Scope:** `src/lib/analysis/cv.ts`, `check-content.ts`, student report/help/privacy copy, and `src/app/admin/page.tsx`. Restrict edits to descriptions and presentation of the existing measurements.

**Build:** describe the spelling check as a limited UK/US variant check; describe grammar as basic writing consistency covering repeated words, initial capitals and bullet endings. Explain that both are incomplete proofreading. Describe the ATS check as a text readability heuristic without a universal compatibility guarantee. Identify word-derived page counts as estimates. Replace the nonexistent adviser score-override claim with the actual support/notes workflow. Replace absolute factual-fidelity claims in the permitted non-landing surfaces with review instructions.

**Acceptance:** the misspelled fixture no longer receives a message claiming correct spelling or grammar. Positive, negative and no-bullet paths remain understandable. Scores, check keys, cache identity, rubric version and stored history stay unchanged. Add meaningful copy/coverage tests, including an explicit guard that these changes do not alter numerical outputs for representative fixtures. Existing saved payloads may still contain legacy wording: disclose this and do not claim a completed migration.

**Validation:** engine tests, typecheck, lint; inspect the relevant rendered pages where feasible. Dependencies: OP-001 for evidence. Defer global band rename and landing copy to OP-003; do not modify `rubric.ts` in this batch.

## Batch 02 — evidence contracts, history and extraction

### OP-003 — Complete the claims inventory and presentation migration (P0)

**Scope:** rubric band presentation, report views, exports, help, templates, email and landing surfaces after the founder's changes are incorporated.

**Build:** replace the employment-outcome implication of “Interview-ready” with an assessed-document label; inventory every occurrence of ATS guarantees, proofreading guarantees and factual absolutes. Separate score thresholds from display labels so changing a label does not unnecessarily rerun cached judgments. Audit templates and illustrative examples that turn “supported” into “led” or invent metrics.

**Acceptance:** consistent labels across current views and historical report rendering; old numeric scores remain unchanged. Stored evidence is not silently rewritten. Guidance examples clearly identify hypothetical details and preserve levels of responsibility. Resolve the rubric's current versioning comment explicitly. Tests cover old and new reports. Dependencies: OP-002, OP-004 for the full historical adapter.

### OP-004 — Version assessment payloads and evidence (P0)

**Scope:** `src/lib/types.ts`, `src/lib/repo/types.ts`, both repository implementations, report consumers and the contract section of `PLAN.md` where applicable.

**Build:** versioned finding schema with assessment status, severity, confidence, method, source document version, stable block reference, explanation and suggested action. Add schema validation and adapters for existing report JSON. Distinguish unassessed from passed.

**Acceptance:** current and legacy fixtures render; invalid provider output cannot persist; out-of-range or mismatched evidence is rejected; unsupported historical detail remains unknown. Both repositories satisfy the same contract. Dependencies: none; coordinate with OP-002 to avoid overlapping edits.

### OP-005 — Preserve extraction structure and confidence (P0)

**Scope:** `src/lib/analysis/extract.ts`, `parse.ts`, upload actions, document metadata and fixtures.

**Build:** page count provenance, section/role/bullet boundaries, extraction warnings and confidence. Extend fixtures for columns, wrapped bullets, dates, letter-spaced headings, tables and scans. Avoid treating estimated DOCX pagination as measured.

**Acceptance:** expected structure assertions for fixtures; scan failures do not become poor CV judgments; actual and estimated metadata are distinguishable; processing limits reject pathological input safely. Dependencies: OP-004.

### OP-006 — Let students correct uncertain extraction (P1)

**Scope:** upload/review flow, document versioning, repository actions.

**Build:** extracted-text review when confidence is low; editable structured content, immutable original upload, new corrected version and provenance. Provide a usable alternative to unsupported scans before considering OCR.

**Acceptance:** corrected text is exactly what is assessed; original remains retrievable by its owner; refresh/retry does not duplicate versions; another user cannot alter or retrieve the source. Dependencies: OP-005.

## Batch 03 — dependable writing feedback

### OP-007 — Evaluate and integrate proofreading behind an adapter (P0)

**Scope:** new proofreading provider interface, server-side analysis, language settings, deployment documentation.

**Build:** compare at least two feasible approaches for accuracy, latency, cost, licensing and processing terms; implement the selected adapter with validated evidence spans. Separate spelling, grammar, punctuation and regional preference. A proposal requiring a new paid service needs a concrete decision before activation.

**Acceptance:** reviewed fixture catches all four audit misspellings without flagging the clean source; recognised specialist terms and names are covered by negative cases. Timeouts and malformed outputs produce unavailable/partial status. Report held-out precision and recall; no fabricated results. Dependencies: OP-004, OP-005. Human gate: approved provider/data handling and independently reviewed evaluation labels.

### OP-008 — Add contextual dismissal and terminology handling (P1)

**Scope:** finding UI, user/document preferences, relevant repository schema.

**Build:** document-scoped dismissal, language preference and reviewed terminology. Explain regional suggestions without classifying valid US English as incorrect spelling. Avoid global dictionary changes from one student's dismissal.

**Acceptance:** dismiss/reopen works and survives refresh; no cross-account effects; official names remain unchanged; audit history identifies student choices. Dependencies: OP-007.

### OP-009 — Add date ordering, pronouns and consistency (P1)

**Scope:** parser, check registry, scoring configuration, detailed feedback.

**Build:** section-aware chronological ordering with incomplete-date uncertainty; context-aware pronoun guidance; observable date, punctuation and heading consistency. Start new checks as supplemental until their scoring effect is validated.

**Acceptance:** overlapping work/study is allowed; “Present,” year-only, month/year and nested roles work; appropriate pronouns are not blanket errors; text-only input does not claim font/alignment verification. Dependencies: OP-004, OP-005. Numeric changes require OP-010/011.

### OP-010 — Version scoring and define incomplete coverage (P0)

**Scope:** `rubric.ts`, `fingerprint.ts`, `judgment.ts`, actions and canonical judgment persistence.

**Build:** explicit parser/model/rubric versions, normalisation contract, concurrency-safe canonical publication, retry semantics and incomplete-coverage policy. Preserve prior scores when rules change. Separate supplemental institutional guidance from the common score.

**Acceptance:** simultaneous first analyses agree; identical content under a version is invariant across account/sector/institution; provider failure does not award full marks; cached correction has a documented version path; incompatible historical scores are not compared as improvement. Dependencies: OP-004; coordinate OP-007 before selecting composite coverage rules.

### OP-011 — Build independent calibration and evaluation tooling (P0)

**Scope:** `scripts/calibrate.ts`, calibration fixtures/docs, reporting output.

**Build:** adviser-label import, dataset versioning, grouped development/held-out split, score/error/ranking metrics and confidence reporting. Include factual fidelity and usefulness evaluations. Clearly isolate illustrative demo marks.

**Acceptance:** variants of a CV cannot leak across splits; reports identify sample, version and uncertainty; failed thresholds cannot be hidden by averaging; tuning is evaluated on untouched data. Dependencies: OP-010 for version contracts. Human gate: recruit reviewers, acquire consented examples and agree thresholds before inspecting held-out results.

## Batch 04 — contextual job matching and factual edits

### OP-012 — Extract requirements from the actual advert (P0)

**Scope:** `src/lib/analysis/job.ts`, types, provider adapter and tailoring UI.

**Build:** essential/desirable/contextual/uncertain categories, source quotations, explicit alternatives, negation and qualifications. Use dictionaries for aliases, not as the sole allowed vocabulary. Validate semantic output against source text.

**Acceptance:** the audit advert identifies Kubernetes and Terraform as essential and Excel as desirable despite repetition. Unseen technology examples also pass. “A or B” and “no experience necessary” retain meaning. Malformed provider results fail safely. Dependencies: OP-001, OP-004.

### OP-013 — Match requirement evidence and replace the arbitrary baseline (P0)

**Scope:** job scoring, report schema, result UI, version history.

**Build:** explicit/contextual/weak/no-evidence categories with source references; documented weighted coverage; separate essential gaps; deduplication; uncertain-denominator handling. Remove the unconditional thirty-point starting score in a new scoring version.

**Acceptance:** Excel-only input cannot conceal the audit's two essential gaps; repetition and synonyms do not inflate coverage; vague adverts do not receive invented certainty; the score is labelled evidence coverage, not hiring probability. Dependencies: OP-012, OP-010.

### OP-014 — Connect tailoring edits to actual versioned rescoring (P0)

**Scope:** tailor actions, editor, repositories, before/after UI.

**Build:** actual revised-document assessment; clearly separated hypothetical preview; student interpretation of irrelevant requirements with provenance. Preserve original and edited versions.

**Acceptance:** clicking “Add” cannot create evidenced competence; accepted text matches the downloaded file; dismissal does not silently erase mandatory qualifications; refresh/retry stays idempotent. Dependencies: OP-013, OP-016.

### OP-015 — Validate rewrites against source claims (P0)

**Scope:** `src/lib/analysis/tailor.ts`, `src/lib/ai.ts`, rewrite actions, claim inventory.

**Build:** source-linked entities, figures, dates, responsibility and role relations. Constrain outputs and independently validate factual changes. Ask for missing facts rather than inventing them.

**Acceptance:** numbers cannot move between unrelated roles; supported cannot become led without confirmation; fabricated employers/tools/qualifications are blocked or explicitly surfaced; strong unchanged text is allowed; prompt injection cannot override restrictions. Measure false rejections as well as missed inventions. Dependencies: OP-004, OP-005. Human gate: independent fidelity review under OP-011.

### OP-016 — Add selective acceptance, undo and stale-result protection (P1)

**Scope:** review/letter/tailor editors, version store, exports.

**Build:** per-suggestion diff, accept/reject, undo, saved version history and visible reassessment state. Detect conflicting editing tabs. Review unresolved placeholders before download.

**Acceptance:** accepted edits survive refresh; undo restores the correct version; historical assessment cannot masquerade as assessment of edited text; exports contain the selected version; ownership checks protect every action. Dependencies: OP-004, OP-015.

## Batch 05 — cover letters and LinkedIn parity

### OP-017 — Deepen cover-letter assessment (P1)

**Scope:** `src/lib/analysis/letter.ts`, cover-letter actions and result UI.

**Build:** evidence-backed hard/soft requirement coverage, employer/role motivation, factual consistency with CV, relevant examples and contextual length/greeting advice. Distinguish missing employer information from poor motivation.

**Acceptance:** generic employer-name insertion does not count as researched motivation; no invented company facts; skill evidence is source-linked; valid atypical letter lengths are explained contextually; accepted edits/export/history work. Dependencies: OP-012, OP-015, OP-016.

### OP-018 — Implement LinkedIn review as a complete report workflow (P1)

**Scope:** `ReportType`, schema migration, both repositories, new route/actions, dashboard filters, export and deletion.

**Build:** student-pasted or supported exported profile input; section feedback for headline, about, experience, education and other relevant sections; source-based suggestions and copy/export controls. Do not imply that the product scrapes or publishes to LinkedIn.

**Acceptance:** full and partial profiles work; empty sections receive useful advice; profile reports persist and filter correctly; invalid and cross-tenant access are rejected; deletion includes every artefact; old report types still work. Dependencies: OP-004, OP-007, OP-015, OP-016.

## Batch 06 — connected student and adviser journeys

### OP-019 — Link application artefacts and prioritise useful actions (P1)

**Scope:** application tracker, dashboard, report relationships and repositories.

**Build:** connect a role with the exact CV, tailoring review, letter and interview practice version; show freshness and next useful actions. Prioritise severity, confidence and effort rather than score chasing.

**Acceptance:** returning students can identify the right application/download; unrelated applications remain separate; deleted relationships behave predictably; improvement counts exclude duplicate submissions. Dependencies: OP-014, OP-016, OP-017.

### OP-020 — Add scoped, expiring and revocable report sharing (P1)

**Scope:** share actions, tokens, preview, repository policies and access records.

**Build:** separate opt-in adviser access from bearer links; explicit shared scope; minimal default disclosure; expiration and revocation. Explain what any recipient can access before activation.

**Acceptance:** revoked/expired links fail; tokens reveal no private content in URLs; scope cannot be increased by changing parameters; previews match disclosures; no cross-tenant access; deletion invalidates links. Dependencies: OP-004, OP-016.

### OP-021 — Strengthen institutional configuration and adviser work (P1)

**Scope:** admin routes/actions, institution config, role policies and repository/schema tests.

**Build:** scoped branding/resources/groups/access, adviser notes, disagreement and referral tracking. Keep core scoring institution-independent. Define who can view each document and student action.

**Acceptance:** two-institution tests cover direct actions, exports and guessed identifiers; revocation works; adviser disagreement is attributed and never rewrites history; admin UI matches actual privileges. Dependencies: OP-004, OP-010, OP-020.

### OP-022 — Deliver useful, privacy-aware institutional analytics (P1)

**Scope:** event definitions, aggregate queries, dashboard and exports.

**Build:** activation, completion, useful edits, repeat use and referrals with denominators/date ranges; small-group handling; consent and selection-bias explanations.

**Acceptance:** synthetic events yield known totals; duplicates and failed analyses do not inflate completion; score improvement is not labelled employment success; restricted data cannot be reconstructed through filters. Dependencies: OP-019, OP-021.

## Batch 07 — differentiation after the core is trusted

### OP-023 — Personalise interview practice with application evidence (P2)

**Scope:** `src/lib/practice.ts`, practice routes/actions, structured evaluation.

**Build:** role/CV-specific questions, relevance explanations and evidence-based answer feedback; distinguish STAR structure from substantive answers. Start with text practice.

**Acceptance:** questions refer accurately to the selected application; an empty STAR template is not praised as strong evidence; feedback cannot introduce experiences; saved practice observes deletion and role permissions. Dependencies: OP-012, OP-015, OP-019. Human gate: adviser evaluation.

### OP-024 — Make career exploration explainable and current (P2)

**Scope:** pathways/opportunities content and recommendation logic.

**Build:** interest/evidence-based role suggestions, reasons, realistic skill gaps, linked learning actions, opportunity source/freshness and eligibility context.

**Acceptance:** explanations are traceable; outdated/unavailable opportunities have a clear state; no invented vacancies or guaranteed job outcomes; recommendations can be corrected by the student. Dependencies: OP-019 and validated content ownership. Human gate: careers-service review.

## Parallel release work — run alongside implementation, not after everything else

### OP-025 — Make analysis recoverable and observable (P0)

**Scope:** analysis actions/jobs, provider wrappers, monitoring, storage and cost accounting.

**Build:** state machine, bounded retries/timeouts, idempotency, concurrency limits and safe diagnostics. Preserve successful previous results during failure. Track latency, error rates and cost per completed workflow.

**Acceptance:** simulated outages, invalid output, repeat clicks, session expiry and concurrent requests recover predictably; logs omit CV text/secrets; quotas fail understandably; no orphaned or double-charged work. Dependencies: OP-004; coordinate canonical scoring with OP-010.

### OP-026 — Extend security, retention and deletion verification (P0)

**Scope:** upload validation, server actions, repository policies, temporary files, all new report types.

**Build:** malformed-file limits, untrusted-document/prompt protections, tenant isolation, secret-safe logging, documented data lifecycle and deletion coverage. Reuse existing controls where verified.

**Acceptance:** adversarial synthetic files remain bounded; cross-user/cross-institution tests deny access; deleted accounts lose document/generated/temp artefacts according to documented retention; no demo bypass in production configuration. Dependencies: incremental with OP-004 and each new workflow.

### OP-027 — Audit accessibility and core journey usability (P1)

**Scope:** existing components, new flows, editors, previews and exported documents.

**Build:** keyboard/focus/labels/contrast/zoom checks, automated axe coverage and manual assistive-technology task scripts; mobile source-feedback navigation; readable error states.

**Acceptance:** named student tasks work without pointer or colour cues; exports retain usable headings/text/reading order; issue register records manual results and limitations. No conformance claim from automated checks alone. Dependencies: incremental after each UI batch. Human gate: representative user testing.

### OP-028 — Reconcile operational documentation and rehearse recovery (P0 before production)

**Scope:** `docs/LAUNCH_CHECKLIST.md`, operations documentation, deployment configuration and runbooks.

**Build:** one owner/evidence/date status register; verify mail, onboarding, recovery, domains, monitoring and development route isolation. Write restore procedure and rehearse using isolated test resources when authorised.

**Acceptance:** stale contradictory claims are resolved; backup restore has an actual dated result; email tests distinguish sandbox from real delivery; every unresolved item has an owner. Dependencies: OP-025, OP-026. External gate: production owner supplies/verifies configuration; no live changes authorised by this document alone.

### OP-029 — Assemble a truthful procurement pack (P1 before institutional sale)

**Scope:** service description, data flow, processors, retention, accessibility findings, support and incident documentation.

**Build:** concrete evidence and draft contractual/service material reflecting actual deployment; explicit unsupported capabilities and external dependencies.

**Acceptance:** each claim has evidence/owner/date; no invented insurance, legal approval or certification; named owners review commitments. Dependencies: OP-021, OP-026, OP-027, OP-028. External gates: appropriate legal/security/commercial reviewers.

### OP-030 — Run the pilot and decide the next release on evidence (P1)

**Scope:** pilot protocol, measurement instrument, anonymised evaluation reporting and release register.

**Build:** defined cohort/sponsor/scope, predetermined usefulness/fidelity/error/support/cost targets, baseline tasks and feedback capture. Report failures, uncertainty and selection limits.

**Acceptance:** real pilot data, adviser ratings and support observations exist; no fabricated participant outcomes or causal employment claims; release decision cites met/unmet gates; commercial case uses actual costs and institution needs. Dependencies: OP-011, OP-025–029, plus features promised in pilot scope. Human gate: real participating institution and students.

## Review protocol for Codex

1. Read the task and blueprint together. Compare the implementation with the user problem, not only Claude's summary.
2. Inspect the full diff and confirm protected files and unrelated work were preserved.
3. Reproduce the original defect and at least one positive, negative and failure case. For numeric changes, inspect versioning and historical behaviour.
4. Run typecheck/lint and the relevant engine, database or browser tests. Document permission-limited tests accurately. Do not run `test:live` without an explicitly authorised live-test scope.
5. Inspect accessible UI and evidence presentation where behaviour is visible. Check whether a high score masks missing coverage.
6. Check ownership, privacy, data lifecycle and external-provider failure for new persisted/AI workflows.
7. Classify findings by severity, return concrete repairs, and rerun affected checks after changes.
8. Record accepted tasks, partial tasks and outstanding human/operational gates. Do not equate local verification with CareerSet parity.

## Evidence map

| Finding | Primary implementation/evidence location | Follow-up |
|---|---|---|
| Regional spelling mistaken for general proofreading | `src/lib/analysis/cv.ts`, `check-content.ts` | OP-001/002/007/008 |
| Essentiality inferred from repetition; unknown terms excluded | `src/lib/analysis/job.ts` | OP-001/012/013 |
| Text heuristics imply ATS/layout certainty | `cv.ts`, `check-content.ts` | OP-002/003/005 |
| Estimated pages look measured | `cv.ts` | OP-002/005 |
| Score override claim exceeds adviser workflow | `src/app/admin/page.tsx` | OP-002/021 |
| LinkedIn absent from report types | `src/lib/types.ts`, repositories | OP-018 |
| Rewrite figure presence does not prove source-role fidelity | `src/lib/analysis/tailor.ts` | OP-015 |
| Static practice is narrower than personalised coaching | `src/lib/practice.ts` | OP-023 |
| Illustrative calibration is not independent validation | `scripts/calibrate.ts`, calibration docs | OP-011/030 |
| Launch notes conflict and operational evidence remains incomplete | `docs/LAUNCH_CHECKLIST.md`, operations docs | OP-028/029 |

## What this plan deliberately does not claim

The screenshot comparison is evidence of visible workflows, not of CareerSet's internal algorithms or superior accuracy. The founder's £34,000/two-year benchmark is unverified contract information, not general market pricing. No completion date or fixed implementation cost is promised without capacity and provider decisions. Batch estimates should be made after the foundational contracts and evaluation approach are agreed.
