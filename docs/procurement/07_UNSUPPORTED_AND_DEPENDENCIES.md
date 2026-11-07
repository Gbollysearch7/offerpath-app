# Unsupported capabilities and external dependencies

**DRAFT. Not reviewed. Not a commitment, and not a roadmap.** Evidence levels are defined in the [README](README.md).

## The service does not do these

### Operations and contract

| Not supported | Detail |
|---|---|
| Backups | None running. No managed backups on the recorded plan. |
| Tested restore | Never rehearsed. No recovery time or point can be stated. |
| Service levels | No uptime, response or recovery commitment. No measured figure. |
| Staging environment | Doesn't exist. Migrations have run only in PGlite. |
| University offboarding | No deletion of a university's data, and no bulk return, at contract end. |
| Support desk | No owner, hours, response time or escalation route. |
| Status page, incident contact list, breach register | None. |
| Global AI spend ceiling | Per-student limits only (FD-07). |
| Load capacity | No load test. The analytics query is expected to take seconds at thousands of reports, untested. |
| Per-university database, region or key | One shared database, logically separated. |
| Background processing | Analysis runs inside the request, with a 60-second limit. |
| Certification, insurance, audit report, penetration test | None on file. |

### Sign-in and integration

| Not supported | Detail |
|---|---|
| Real SSO | Built, no provider connected. The selector on the sign-in page names one fictional university. Needs a paid Supabase plan. |
| Enforced staff MFA | No application enforcement. Setting not read. |
| SCIM, student-record, careers-system or VLE integration | None. Records come by CSV import or SSO attributes. The landing page's roadmap mentions integrations and a mobile app; neither exists. |
| Custom domain and university-branded email | No domain. No verified sender. |
| Email notices about casework | Students get an in-app notice on their next page. |
| Self-service removal of a university's imported student records | SQL only (FD-17). |
| Uploaded logos | Branding is a name, one colour and a welcome message. |
| Admin screen to turn on report sharing | Operator only, by database. Admins can stop it. |

### Assessment

| Not supported | Detail |
|---|---|
| Validated scoring | No adviser has marked anything. Calibration tooling exists with synthetic data only, labelled as not validation. |
| Prediction of employment or interview outcomes | Not attempted. Self-reported tracking figures are labelled as unchecked. |
| Grammar checking | "Not assessed". |
| Real words used wrongly | 0 of 14 on a held-out set. |
| Capitalised misspellings | Often missed, to avoid flagging names. |
| Proofreading of letters, adverts | Not covered. LinkedIn has limited coverage. |
| Applicant tracking system compatibility | Not tested and not guaranteed for any employer. |
| Fonts, alignment, spacing, colour in a CV | Always "not assessed". |
| OCR of scanned CVs | Not scored; student can type or paste. |
| Languages other than English | UK conventions, English only. |
| Guarantee that AI text is factual | Automated checks reduce the risk and don't remove it. Students must check each suggestion. Fidelity review by independent people hasn't happened. |
| LinkedIn access | Student pastes text or uploads an export. **The export reader hasn't been tried on a real archive** (FD-58). |
| Personalised interview coaching | Not established. OP-023 was building application-linked practice at the time of writing, with no report yet. |

### Privacy and accessibility

| Not supported | Detail |
|---|---|
| Adviser access to CVs | Off, pending legal review. |
| Formal anonymity of analytics | Rounding and hiding rules, not differential privacy. Not reviewed by a statistician or privacy lawyer. |
| Recall of text sent to providers | Not possible from this side. |
| Staff-only notes | Notes are visible to the student. |
| WCAG conformance claim | No evidence supports one. See [05_ACCESSIBILITY_FINDINGS.md](05_ACCESSIBILITY_FINDINGS.md). |
| Tagged PDFs | Untagged. Word is the structured option. |
| Assistive technology support | Untested. |

## Features that are built and off

| Feature | Switch | Today |
|---|---|---|
| Adviser CV access | `ADVISER_CV_ACCESS` | Absent. Legal review needed (FD-20). |
| Report sharing | `universities.report_sharing_enabled` | Off by default (FD-09) |
| External proofreading | `PROOFREADING_*` | Absent (FD-26) |
| Analytics | `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | Absent |

## External dependencies

If one of these fails or changes, the service is affected. No agreement with any of them is on file.

| Dependency | Needed for | If unavailable | Current state | Owner |
|---|---|---|---|---|
| Vercel | The whole application | Service down | Plan not read (FD-05) | Founder |
| Supabase | Database, sign-in, files | Service down | Free plan recorded; **pauses when idle** (FD-04) | Founder |
| Anthropic | AI scoring and AI writing | No score; rule-based drafts where they exist. Tested with simulated failures. | Key name exists; reason for replacement unknown (FD-06) | Founder |
| Resend, or another SMTP sender | Sign-in email, reminders, inactivity warnings | **Students can't sign in by email.** Inactive accounts aren't deleted. | Test sender recorded | Founder to assign |
| A domain | Email, redirects, uptime check | Email can't be properly sent | None (FD-14) | Founder |
| GitHub | Source, CI, uptime check | No releases through CI; no uptime email | Pauses after 60 days without commits | Founder to assign |
| Open source packages | Parsing, documents, proofreading | Maintenance risk. `nspell` last published 2022; word data 2020. | See `package.json`. UKACD notice question open (FD-24). | Founder to assign |
| University | Domain, records, DPO, adviser time | No onboarding | None named | Founder and university |
| Careers advisers | Content review, calibration, fidelity review | Content stays unreviewed: all 16 rows unticked in [CONTENT_REVIEW.md](../CONTENT_REVIEW.md) | None recruited | Founder to assign |
| Lawyer, DPO | Notice, terms, DPA, DPIA, retention decisions | Legal documents stay as templates | None named | Founder to assign |
| Students using assistive technology, independent auditor | Accessibility evidence | Accessibility stays untested by people | None | Founder to assign |

## Gates before a university could be onboarded

In the register's order ([STATUS_REGISTER.md](../STATUS_REGISTER.md)): independent review and commit; approve and apply migrations, tested on staging; backups and a rehearsed restore; real email and a domain; company and ICO details, lawyer and DPO sign-off, the 30 or 35 day decision; remove QA data, set missing variables, replace the Anthropic key; adviser review and calibration; then a pilot university. This pack adds: a support owner, the breach period, university offboarding, and signed processor agreements.
