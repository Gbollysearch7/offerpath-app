# Data processing agreement: processing schedule (template)

To attach to the agreement between [University] (controller) and [Operator] (processor) under UK GDPR Article 28.
Not legal advice; have your legal team complete and review it.

**DRAFT FOR LEGAL REVIEW. No lawyer has approved this document.** Marked on 7 November 2026. Text in `[OPEN: ...]` is undecided or isn't built: it can't be offered as a term until the linked decision in `docs/FOUNDER_DECISIONS.md` is closed.

| Item | Detail |
|---|---|
| Subject matter | Provision of the Offerpath careers platform to the controller's students and careers staff |
| Duration | Term of the services agreement, plus `[OPEN: period for deletion and backup expiry. This template said up to 30 days; the notice said 35; no backups run. FD-03, FD-84, FD-85.]` |
| Nature and purpose | Storing and analysing CVs, cover letters and job adverts to give feedback; tracking applications; aggregate reporting to the careers service |
| Personal data | Name, university email, student number, course, year, faculty, fee status, CV and cover letter content, scores, application tracking, preferences |
| Data subjects | Students and graduates of the controller; careers staff |
| Sub-processors | As listed at `/legal/sub-processors`. `[OPEN: proposed 30 days' notice of changes with a right to object. No process exists to do this yet. FD-88.]` |
| Location | Primary storage UK/EU; transfers to the US for AI processing (Anthropic). `[OPEN: Resend and Vercel transfers were omitted here and need assessing; the transfer safeguard, UK IDTA or UK Addendum, is undecided and none is on file. FD-80.]` |
| Security | Encryption in transit (TLS); `[OPEN: encryption at rest, to be evidenced from providers. P-08.]` Row-level access control; least-privilege service keys; per-user rate and usage limits; logging without CV content |
| Assistance | Self-service export and deletion for data subject requests; breach notification without undue delay and within `[OPEN: number of hours. This template said 48; docs/OPERATIONS.md says 24. A legal and founder decision, FD-82. Not decided here.]` of becoming aware |
| End of contract | `[OPEN: NOT BUILT. Proposed: deletion of all controller data within 30 days, or return in a standard format on request. No offboarding procedure, university-wide deletion or bulk return exists, and the erasure ledger, judgment cache and provider logs aren't decided. Don't offer this until FD-85 is closed.]` |
| Audit | `[OPEN: proposed annual security summary on request and reasonable audit rights on notice. No summary exists. FD-88.]` |
