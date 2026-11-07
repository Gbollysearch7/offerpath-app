# Offerpath procurement pack

**DRAFT. Not reviewed by anyone. Not an offer, contract or commitment. Do not send to a university until every reviewer in [09_OPEN_ITEMS.md](09_OPEN_ITEMS.md) has been named and has signed off.**

Written 7 November 2026 by Claude (an AI agent) from the repository, for review by people. Nothing here has had legal, security, data protection or commercial review. It is written for a university procurement officer or data protection officer.

## The position today

- **Nothing about the current code is verified in production.** Production runs code no later than commit `8545550` (2 November 2026). This pack mostly describes the working tree, which is uncommitted (309 changed or new paths on 7 November 2026) and has had no independent review beyond tasks OP-001 and OP-002.
- **22 database migrations exist in the working tree. 11 are recorded as applied to the live database,** the last record being 30 October 2026. The other 11 have run only in PGlite, an in-memory test database.
- **Backups are not running. No restore has ever been rehearsed.** The database is recorded on Supabase's Free plan, which has no managed backups.
- **No real email delivery has been recorded.** Students sign in by emailed link, so student sign-in on production is unproven.
- **No university, student or adviser has used the service.** No adviser has validated any score. No person using assistive technology has tested it.
- **Not on file:** company details, ICO registration, insurance, a signed contract, signed processor agreements, any certification, any penetration test.

## How to read a claim

Every factual statement in this pack sits at one of these levels. Only the last two say anything about the running service.

| Level | Meaning | What it does not mean |
|---|---|---|
| **Not built** | The capability does not exist. | |
| **Documented only** | A procedure or policy is written down. Nobody has run it. | That it works. |
| **Built** | Code exists in the working tree. No test exercises the point. | That it is deployed. |
| **Locally tested** | Automated tests or a local browser pass, on a developer's machine. Tests use fakes, PGlite, or demo mode with fictional data. | That it works on real Supabase, on Vercel, or with a real AI provider, unless stated. That it is deployed. |
| **Seen on live, older code** | Observed against the live project on a recorded date, on code older than the working tree. | That it still holds, or holds for the current code. |
| **Seen in production** | A read-only check against the production site on a recorded date, of the narrow thing named. | Anything beyond that narrow thing. |
| **Verified in production** | The current code, on production, tested end to end. **No item in this pack is at this level.** | |
| **External gate** | Code can't establish it. Only the named person or a third party can. | |

Placeholders look like `[TO SUPPLY: what. Who supplies it.]`. A placeholder means the fact is not known to the author. It does not mean the fact is false.

"Founder to assign" means no person has been named for the role. The founder is the only person the project documents name.

## Contents

| Document | Covers |
|---|---|
| [01_SERVICE_DESCRIPTION.md](01_SERVICE_DESCRIPTION.md) | What the service does, for whom, and how it is deployed |
| [02_DATA_FLOWS_AND_PROCESSORS.md](02_DATA_FLOWS_AND_PROCESSORS.md) | Each processor, what it receives and where; proofreading; roles |
| [03_RETENTION_AND_DELETION.md](03_RETENTION_AND_DELETION.md) | Retention, deletion, backups, the erasure ledger and its limits |
| [04_SECURITY_CONTROLS.md](04_SECURITY_CONTROLS.md) | Controls and the level of evidence for each |
| [05_ACCESSIBILITY_FINDINGS.md](05_ACCESSIBILITY_FINDINGS.md) | **Provisional.** OP-027 was still working when this was written |
| [06_SUPPORT_AND_INCIDENTS.md](06_SUPPORT_AND_INCIDENTS.md) | Support, monitoring, incident handling, recovery |
| [07_UNSUPPORTED_AND_DEPENDENCIES.md](07_UNSUPPORTED_AND_DEPENDENCIES.md) | What the service does not do, and what it depends on |
| [08_CLAIMS_TABLE.md](08_CLAIMS_TABLE.md) | Every claim, with evidence, owner and date |
| [09_OPEN_ITEMS.md](09_OPEN_ITEMS.md) | Facts to supply, open conflicts, commitments needing a named reviewer |

## Keeping it true

This pack goes out of date as the tree changes. Before it leaves the building, the release owner re-runs the commands in [08_CLAIMS_TABLE.md](08_CLAIMS_TABLE.md), re-checks [STATUS_REGISTER.md](../STATUS_REGISTER.md), and moves each claim's level only on evidence. A template, a passing local test or this document does not move a claim to production.

Sign-off record: see [09_OPEN_ITEMS.md](09_OPEN_ITEMS.md). All blank.
