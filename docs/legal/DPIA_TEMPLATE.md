# Data Protection Impact Assessment: Offerpath (template)

Prepared by the operator for each partner university's data protection officer to review and adopt.
Not legal advice. Fill in the bracketed items and have it reviewed before launch.

**DRAFT FOR LEGAL REVIEW. No lawyer or DPO has approved this document.** Wording changed on 7 November 2026 so that it says only what is true today. `[NOT IN PLACE]` marks a mitigation that doesn't exist yet: it is a plan, not a fact, and must not be relied on until the linked decision in `docs/FOUNDER_DECISIONS.md` is closed.

## 1. The processing
- **Purpose:** feedback on students' CVs and cover letters, job-ad tailoring, application tracking, and aggregate careers-service reporting.
- **Controller:** [University]. **Processor:** [Operator]. **Sub-processors:** see `/legal/sub-processors`.
- **Data subjects:** students and recent graduates; careers staff (admins).
- **Personal data:** name, university email, optional student number, course, year, faculty, fee status; CV and cover letter content (may include contact details, work history, education, interests); scores; tracked applications; visa-sponsorship preference (may indicate nationality/immigration status: treat as sensitive context).
- **Special category data:** not requested. CVs may incidentally contain it (e.g. health, religion in volunteering). Students are told only to include what they would send an employer.
- **Volume:** [expected students per year]. **Retention:** until account deletion, or [24] months of inactivity.

## 2. Necessity and proportionality
- **Lawful basis:** public task (education and employability support) or legitimate interests: [University to confirm].
- **Minimisation:** no date of birth, address or photo requested. The careers service sees scores and activity (not CVs) only for students who opt in, and summary exports hide groups under five. Careers teams can also export a named list of sharing students, when five or more share, and a log of staff access naming students.
- **Transparency:** in-app privacy notice, explicit opt-in for sharing, "How your score is calculated" page.
- **Rights:** self-service export (ZIP) and deletion; other rights via the university DPO.

## 3. Automated processing
- Scores combine fixed rules with categorical judgments from an AI model, computed identically for every student. They are guidance only: no decision with legal or similarly significant effect is made automatically (UK GDPR Article 22 not engaged). Students are told how scores are calculated and can discuss them with an adviser.

## 4. Risks and mitigations
| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| Unauthorised access to CVs | Low / High | Row-level security, server-only writes, private storage, admins can't open CVs (unless adviser access is enabled with consent) |
| International transfer to AI provider | Medium / Medium | Text sent only when AI feature used. `[NOT IN PLACE: DPA and UK transfer safeguard on file with Anthropic, required before any pilot goes live; which safeguard is open, FD-80.]` Anthropic's published commercial terms say it may not train models on customer content. `[NOT CONFIRMED for this account, FD-81.]` |
| Inaccurate or unfair scores | Medium / Medium | Fixed rubric, deterministic guardrails, same CV always same score, scores framed as guidance. `[NOT IN PLACE: calibration with advisers. Tooling exists and has only been tested on synthetic data; no adviser has marked anything, FD-36, FD-37.]` |
| Re-identification in reports | Low / Medium | Group-of-five threshold on summary exports and on the named list as a whole, opt-in sharing. Named exports exist for careers teams, see section 2. |
| Prompt injection / manipulation | Low / Low | Untrusted-text handling, per-student caches, rule guardrails |
| Data kept too long | Medium / Low | Self-service deletion. Inactivity deletion is built for student accounts, needs working email for its warning, and hasn't been run on production. `[NOT IN PLACE: backup expiry. No backups run; period undecided, FD-03, FD-04, FD-84.]` |
| Breach at a sub-processor | Low / High | Encryption in transit. `[NOT IN PLACE: DPAs and breach notification terms on file, FD-80. Evidence of encryption at rest from providers, P-08 in docs/procurement/09_OPEN_ITEMS.md.]` |

## 5. Sign-off
- DPO advice: [ ]   Residual risk accepted by: [ ]   Date: [ ]   Review date: [ ]
