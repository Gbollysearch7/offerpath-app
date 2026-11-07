# Content for expert review

Everything a student reads as advice was written for the build and should be checked by a qualified careers
adviser (and the legal pages by a lawyer and the university DPO) before launch. Tick each when reviewed.

| Content | File | Reviewer | Status |
|---|---|---|---|
| Guidance on each of the 16 checks (insight, "read more", before/after examples) | `src/lib/analysis/check-content.ts` | Careers adviser | [ ] |
| Scoring rubric: area weights, line penalties, targets, band thresholds | `src/lib/analysis/rubric.ts` | Careers adviser + calibration (`npm run calibrate`) | [ ] |
| Band, area, check and finding-status labels shown to students | `src/lib/analysis/labels.ts` | Careers adviser | [ ] |
| Proofreading terminology and official names (OP-008); record the reviewer in `TERMINOLOGY_REVIEW` | `src/lib/analysis/proofreading/terminology.ts` | Careers adviser | [ ] |
| Word lists: weak/strong verbs, filler, buzzwords, duty phrases, US→UK spellings, section names | `src/lib/analysis/lexicon.ts` | Careers adviser | [ ] |
| Sector keyword lists (10 sectors) | `src/lib/analysis/lexicon.ts` (`SECTOR_KEYWORDS`) | Employer-relations team | [ ] |
| AI judging rubric given to Claude Haiku | `src/lib/ai.ts` (`JUDGE_SYSTEM`) | Careers adviser | [ ] |
| Example CV lines and action verb bank | `src/lib/content.ts` | Careers adviser | [ ] |
| Nine example CVs behind the 12 templates (law, data and research added 2026-10-30) | `src/lib/cv-examples.ts` | Careers adviser | [ ] |
| Cover letter checks and UK conventions; rule-based draft wording | `src/lib/analysis/letter.ts` | Careers adviser | [ ] |
| LinkedIn review advice, empty-section advice, rule-built suggestions and the 220-character headline figure, which has not been checked against LinkedIn (OP-018) | `src/lib/analysis/linkedin-assess.ts`, `linkedin-suggest.ts` | Careers adviser | [ ] |
| Interview questions, aptitude practice and role roadmaps | `src/lib/practice.ts` | Careers adviser | [ ] |
| Interview practice: grounded question templates and "why this question" wording; feedback wording, the substance thresholds and the model's instructions (OP-023) | `src/lib/practice-questions.ts`, `src/lib/practice-feedback.ts`, `src/lib/ai.ts` (`PRACTICE_RULES`) | Careers adviser | [ ] |
| Sample opportunities (fictional) — replace with real listings | `src/lib/seed-data.ts`, `supabase/seed.sql` | Careers team | [ ] |
| Privacy notice, terms, accessibility statement, cookies, sub-processors | `src/app/legal/*` | Lawyer + DPO | [ ] |
| DPIA and DPA schedule templates | `docs/legal/*` | DPO | [ ] |
| Email copy (reminders, retention warning, sign-in) | `src/lib/email.ts`, `supabase/templates/*` | Careers team | [ ] |

When changing any number in `rubric.ts`, the word lists in `lexicon.ts` or `JUDGE_SYSTEM`, bump `RUBRIC_VERSION` in
`rubric.ts`. Wording in `labels.ts`, `check-content.ts` and the check copy in `cv.ts` is looked up at render time and
never bumps the version (see the note at the top of `rubric.ts`).
