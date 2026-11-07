# OP-029 report: procurement pack

Prepared 7 November 2026 by Claude, for review by people. Nothing was committed, pushed, deployed or sent. No live service was touched. No dev server or build was run. Only `docs/procurement/` and this report were written.

**Status: Implemented as drafts; external gates open.** No legal, security, data protection, accessibility or commercial reviewer has seen it. OP-029's acceptance ("named owners review commitments") is not met, because no reviewer has been named.

## Delivered

`docs/procurement/`: `README.md` (evidence levels), `01_SERVICE_DESCRIPTION.md`, `02_DATA_FLOWS_AND_PROCESSORS.md`, `03_RETENTION_AND_DELETION.md`, `04_SECURITY_CONTROLS.md`, `05_ACCESSIBILITY_FINDINGS.md` (provisional), `06_SUPPORT_AND_INCIDENTS.md`, `07_UNSUPPORTED_AND_DEPENDENCIES.md`, `08_CLAIMS_TABLE.md`, `09_OPEN_ITEMS.md` (20 facts to supply, 8 open conflicts, 21 commitments with blank reviewer names).

## Facts the founder must supply

Legal entity, address, company number; ICO number; data protection contact; support owner, address, targets and absence cover; insurance, if any; signed DPAs and transfer mechanisms for the four processors; Anthropic training and retention terms; provider retention and encryption evidence; plan and backup decision; restore rehearsal owner and result; ledger export owner; domain and real email delivery; alert destination; price, term and exit; reviewer names. Full list: `09_OPEN_ITEMS.md`.

## False or unsupported claims elsewhere (reported, not fixed)

| Where | Claim | Problem |
|---|---|---|
| `src/app/legal/privacy/page.tsx` | "Backups are overwritten within 35 days" | No backups run; DPA says 30 |
| `src/app/legal/sub-processors/page.tsx` | "Each is bound by a data processing agreement"; universities told before changes | No signed copy on file; no process |
| `src/app/_landing/Landing.tsx` | Anthropic under a DPA and transfer addendum, no training | Not evidenced |
| `src/app/_landing/Landing.tsx` | "Ready for pilots" | Backups, email, legal and migrations are open |
| `src/app/sign-in/page.tsx` | "Designed to WCAG 2.2 AA", "UK GDPR" | No conformance evidence or legal review |
| `src/app/legal/accessibility/page.tsx` | 44px targets, "fully accessible" Word, manual keyboard testing, 5 working days | Contradicted by the register; reply promise has no owner or address |
| `src/app/privacy/page.tsx` | Deletion "removes it all straight away"; exports "always" omit groups under five | Backups, ledger, kept records, provider copies; named student CSV exists |
| `docs/legal/DPIA_TEMPLATE.md` | "calibration with advisers", "DPA + UK IDTA with Anthropic", backup expiry | None has happened or is evidenced |
| `docs/legal/DPA_SCHEDULE_TEMPLATE.md` | Delete all data in 30 days at contract end; annual security summary; 48-hour breach notice; US transfers for AI only | No offboarding; no summary; OPERATIONS says 24 hours; Resend and Vercel transfers omitted |
| `src/lib/legal.ts`, `src/app/legal/cookies/page.tsx` | Sub-processor list complete; Plausible collects no personal data | Webhook and Plausible unlisted; from reading, Plausible would load on `/share/<token>` |

New findings not in the founder decision list: the 24 or 48 hour conflict; UK IDTA against Addendum; the sign-in selector hard-coded to fictional "University of Northfield", which blocks real SSO selection; no code enforces staff MFA; no contract-end deletion; staff accounts exempt from inactivity deletion; no malware or dependency scanning.

Stale: `STATUS_REGISTER.md` and `FOUNDER_DECISIONS.md` still show OP-021 and OP-022 as in progress or unreported, and don't carry their decisions. `.env.example` says nothing warns about missing `LEGAL_*`, though `env.ts` now does.

## Validation

| Check | Result |
|---|---|
| `npm run test:engine` | Exit 0: 938 pass, 0 fail, shared tree, about 05:07 |
| `npm run test:db` | Exit 0: schema 357 PASS, 0 FAIL; security 95 passed |
| Links, anchors and named evidence paths in the pack, by script | 133 links checked. One path missing, expected: `docs/CLAUDE_REPORT_OP-027.md`, which the pack states doesn't exist yet |
| Project ref, keys, sales wording, by pattern | None |

Not run: build, dev server, e2e, keyboard, sweep, `test:live`, typecheck, lint. Accessibility figures are copied from the register.

## Limitations

- **Reading coverage.** Read in full: the register's operating rules and OP-029, blueprint section 20, `docs/legal/`, status register, founder decisions, runbook, restore procedure, operations guide, reports OP-021, OP-022, OP-026, OP-028, release fixes, most of OP-025. Read in part: batch 01, OP-007 to OP-010, and batch 02 (selected sections). **OP-011 onward to OP-020 and the parser report were only keyword-scanned for data handling,** with validation and file-list sections excluded. A limit recorded only there could be missing.
- **OP-027 and OP-023 had no reports.** Accessibility is marked provisional. OP-023's AI feedback on written answers is flagged from a partial read of unfinished code; its data flow and retention must be added once it reports.
- The AI payload table comes from reading code, not captured traffic.
- Recommendations and open-conflict framing are my judgement and need a lawyer.

## Migration impact

None.

## Unresolved

Name the reviewers first (P-19). Then C-01 (30 or 35 days), C-02 (24 or 48 hours) and C-04 (contract-end deletion).
