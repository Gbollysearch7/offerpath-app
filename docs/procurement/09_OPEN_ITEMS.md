# Open items: facts to supply, conflicts, and commitments to review

**DRAFT. Internal working list until the sign-off below is complete.** Nothing goes to a university until every commitment has a named human reviewer and a date.

## Facts to supply

| ID | Fact | Who must supply it | Blocks |
|---|---|---|---|
| P-01 | Legal entity name, registered address, company number | Founder | Everything contractual |
| P-02 | ICO registration number | Founder | Legal pages, DPA |
| P-03 | Data protection contact | Founder | Legal pages, DPA |
| P-04 | Support address, owner, hours, targets, escalation, absence cover | Founder | [06](06_SUPPORT_AND_INCIDENTS.md) |
| P-05 | Insurance held, if any | Founder | Any insurance answer. Don't claim it otherwise. |
| P-06 | Signed DPAs and transfer mechanism for Supabase, Anthropic, Vercel, Resend | Founder to assign | Sub-processor list, notice, DPA |
| P-07 | Anthropic: no-training terms, retention period, whether zero data retention applies | Founder | Notice, DPIA |
| P-08 | Retention at Resend, Vercel and Supabase Auth logs; encryption at rest evidence | Founder to assign | [03](03_RETENTION_AND_DELETION.md), [04](04_SECURITY_CONTROLS.md) |
| P-09 | Regions: Supabase re-read; Vercel plan, edge and memory settings; Resend region | Founder to assign | Location answers |
| P-10 | Supabase plan and backup decision ([FD-04](../FOUNDER_DECISIONS.md#fd-04)) | Founder | Backups |
| P-11 | Who rehearses the restore, then the result: date, person, durations, data lost ([FD-22](../FOUNDER_DECISIONS.md#fd-22)) | Founder | Recovery answers |
| P-12 | Who exports the ledger, how often, where; ledger lawfulness and period ([FD-21](../FOUNDER_DECISIONS.md#fd-21)) | Founder, DPO | Erasure answers |
| P-13 | Domain and verified sender; a real delivery record, both email paths | Founder | Sign-in |
| P-14 | Which service receives alerts | Founder | Sub-processor list |
| P-15 | Information security policy, staff vetting and training, leaver process: whatever exists | Founder | Security questionnaire |
| P-16 | Reason for replacing the Anthropic key ([FD-06](../FOUNDER_DECISIONS.md#fd-06)) | Founder | Release |
| P-17 | Price, term, exit, handover, continuity | Founder, commercial reviewer | Contract |
| P-18 | Lawful basis, controller and processor roles, DPIA adoption | University DPO, lawyer | Going live at a university |
| P-19 | Names of a legal, security, data protection, accessibility and commercial reviewer | Founder | The table below |
| P-20 | Independent accessibility audit and student testing, if commissioned | Founder | [05](05_ACCESSIBILITY_FINDINGS.md) |

## Open conflicts

Shown as open. No document has been changed to hide any of them.

| ID | Conflict | Sources | Owner |
|---|---|---|---|
| C-01 | **Backup period: 30 or 35 days.** No backups exist to apply it to. | Notice and OPERATIONS say 35; DPA template says 30. [FD-03](../FOUNDER_DECISIONS.md#fd-03). | Founder, lawyer |
| C-02 | **Breach notice: 24 or 48 hours.** Not in the founder decision list. | OPERATIONS and RESTORE_PROCEDURE say 24; DPA template says 48. | Founder, lawyer |
| C-03 | **Transfers.** "UK IDTA" against "UK International Data Transfer Addendum". The DPA's Location row mentions AI only, while `legal.ts` puts Resend in "US / EU" and Vercel on a global edge. | DPA, DPIA, `legal.ts`, notice, landing | Lawyer |
| C-04 | **"All controller data within 30 days" at contract end** against what is kept: ledger never purged, cache never purged, 24-month access log, imported records, provider copies. No offboarding exists. | DPA template; [03](03_RETENTION_AND_DELETION.md) | Founder, lawyer, DPO |
| C-05 | **"Exports always leave out groups smaller than five"** against the named student CSV (`?pack=students`), kept pending a founder decision. | `src/app/privacy/page.tsx`; [OP-022 report](../CLAUDE_BATCH_06_REPORT_OP-022.md) | Founder, lawyer |
| C-06 | **Templates lag the product.** DPA's personal data omits LinkedIn text, casework, staff names and ledger ids. DPIA omits the adviser role, counting of non-sharers, and hasn't been updated for sharing links. | `docs/legal/` | Lawyer, DPO |
| C-07 | **Log retention.** Notice says up to 30 days; Vercel gives 1 hour or 1 day by plan. A short window is permitted by the notice, but limits incident work. | Notice; [FD-05](../FOUNDER_DECISIONS.md#fd-05) | Founder |
| C-08 | **"Removes it all straight away"** against backups, the ledger, kept records and provider copies. | `src/app/privacy/page.tsx`; [03](03_RETENTION_AND_DELETION.md) | Lawyer |

## Commitments needing a named reviewer

Each row is something a draft document or public page promises. **None has been reviewed. Every "Named reviewer" and "Date" is blank on purpose.** A role is not a name.

| ID | Commitment as written | Where | Can it be kept today? | Reviewer role | Named reviewer | Date |
|---|---|---|---|---|---|---|
| K-01 | Breach notice within 24 or 48 hours | OPERATIONS, DPA | **No:** conflict; no on-call or contact list | Legal, security | | |
| K-02 | Delete all controller data within 30 days of contract end, or return it | DPA | **No:** not built | Legal, DPO | | |
| K-03 | Backups overwritten within 30 or 35 days | Notice, DPA, OPERATIONS | **No backups** | Legal, operations | | |
| K-04 | Inactive accounts deleted after 24 months, warned 30 days before | Notice | **Not proven:** needs real email and a job run | DPO | | |
| K-05 | 30 days' notice of sub-processor changes, with a right to object | DPA, sub-processors page | **No process** | Legal, commercial | | |
| K-06 | Annual security summary; reasonable audit rights | DPA | **No summary exists** | Security, commercial | | |
| K-07 | Reply to accessibility requests within 5 working days | Statement | **No owner; address unset** | Accessibility, operations | | |
| K-08 | Encryption in transit and at rest, RLS, least-privilege keys, usage limits, logging without CV content | DPA | Part; see [04](04_SECURITY_CONTROLS.md) | Security | | |
| K-09 | US transfers under a named safeguard; DPAs with every provider | Notice, DPA, landing | **Not evidenced** | Legal | | |
| K-10 | Anthropic doesn't train on student text | Notice, `/privacy`, landing, DPIA | **Not evidenced** | Legal | | |
| K-11 | Students can export and delete their data themselves, straight away | Notice, `/privacy` | Locally tested; see C-08 | DPO | | |
| K-12 | Logs expire within 30 days | Notice | Depends on plan; not read | DPO, operations | | |
| K-13 | Share links last 30 days at most; removed 90 days after expiry | Notice | Locally tested; off | DPO | | |
| K-14 | Staff access log kept 24 months; identity removed on deletion | Notice | Locally tested; unapplied. Staff name stays. | DPO | | |
| K-15 | Careers staff never see a CV without opt-in | Notice, `/privacy` | Locally tested; flag off | DPO, security | | |
| K-16 | Exports leave out groups under five; counts rounded | `/privacy`, landing | Locally tested; see C-05 | DPO, statistics | | |
| K-17 | Accounts stored in the UK or EU | Notice, upload page, sign-in, landing | Recorded for the database; not re-read | Legal, operations | | |
| K-18 | Scores are guidance and no significant automated decision is made | Notice, DPIA | Depends on university use | DPO | | |
| K-19 | Students told in-app of material terms changes; university told of suspensions | Terms | No process | Legal | | |
| K-20 | Adviser CV access only after legal review | `/privacy`, landing | Off today | Legal | | |
| K-21 | Any support, availability or recovery target eventually offered | Not yet written | Nothing to review | Commercial, operations | | |

## Sign-off

No reviewer has seen this pack.

| Area | Named reviewer | Date | Outcome |
|---|---|---|---|
| Legal | `[TO SUPPLY. Founder.]` | | Not reviewed |
| Data protection | `[TO SUPPLY. Founder.]` | | Not reviewed |
| Security | `[TO SUPPLY. Founder.]` | | Not reviewed |
| Accessibility | `[TO SUPPLY. Founder.]` | | Not reviewed |
| Commercial | `[TO SUPPLY. Founder.]` | | Not reviewed |
| Operations (release owner) | `[TO SUPPLY. Founder.]` | | Not reviewed |
