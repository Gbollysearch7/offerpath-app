# Data Protection Impact Assessment: Offerpath (template)

Prepared by the operator for each partner university's data protection officer to review and adopt.
Not legal advice. Fill in the bracketed items and have it reviewed before launch.

## 1. The processing
- **Purpose:** feedback on students' CVs and cover letters, job-ad tailoring, application tracking, and aggregate careers-service reporting.
- **Controller:** [University]. **Processor:** [Operator]. **Sub-processors:** see `/legal/sub-processors`.
- **Data subjects:** students and recent graduates; careers staff (admins).
- **Personal data:** name, university email, optional student number, course, year, faculty, fee status; CV and cover letter content (may include contact details, work history, education, interests); scores; tracked applications; visa-sponsorship preference (may indicate nationality/immigration status: treat as sensitive context).
- **Special category data:** not requested. CVs may incidentally contain it (e.g. health, religion in volunteering). Students are told only to include what they would send an employer.
- **Volume:** [expected students per year]. **Retention:** until account deletion, or [24] months of inactivity.

## 2. Necessity and proportionality
- **Lawful basis:** public task (education and employability support) or legitimate interests: [University to confirm].
- **Minimisation:** no date of birth, address or photo requested. The careers service sees scores and activity (not CVs) only for students who opt in, and exports hide groups under five.
- **Transparency:** in-app privacy notice, explicit opt-in for sharing, "How your score is calculated" page.
- **Rights:** self-service export (ZIP) and deletion; other rights via the university DPO.

## 3. Automated processing
- Scores combine fixed rules with categorical judgments from an AI model, computed identically for every student. They are guidance only: no decision with legal or similarly significant effect is made automatically (UK GDPR Article 22 not engaged). Students are told how scores are calculated and can discuss them with an adviser.

## 4. Risks and mitigations
| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| Unauthorised access to CVs | Low / High | Row-level security, server-only writes, private storage, admins can't open CVs (unless adviser access is enabled with consent) |
| International transfer to AI provider | Medium / Medium | DPA + UK IDTA with Anthropic; no training on data; text sent only when AI feature used |
| Inaccurate or unfair scores | Medium / Medium | Fixed rubric, deterministic guardrails, same CV always same score, calibration with advisers, scores framed as guidance |
| Re-identification in reports | Low / Medium | Group-of-five threshold on exports, opt-in sharing |
| Prompt injection / manipulation | Low / Low | Untrusted-text handling, per-student caches, rule guardrails |
| Data kept too long | Medium / Low | Self-service deletion, inactivity purge, backup expiry |
| Breach at a sub-processor | Low / High | DPAs, breach notification terms, encryption in transit and at rest |

## 5. Sign-off
- DPO advice: [ ]   Residual risk accepted by: [ ]   Date: [ ]   Review date: [ ]
