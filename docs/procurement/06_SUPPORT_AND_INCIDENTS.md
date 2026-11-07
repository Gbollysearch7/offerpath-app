# Support and incident handling

**DRAFT. Not reviewed. Nothing here is a service level.** Evidence levels are defined in the [README](README.md).

**No support arrangement exists.** The items below separate what is written from what would have to be agreed.

## Support

| Item | Position |
|---|---|
| Support address | `[TO SUPPLY: address. Founder.]` `SUPPORT_EMAIL` is missing on production ([E1](../STATUS_REGISTER.md#e1)), so legal pages show a placeholder and pilot enquiries aren't emailed. |
| Support owner | `[TO SUPPLY: named person. Founder.]` |
| Hours and channels | `[TO SUPPLY: hours and channels. Founder.]` |
| Response and resolution times | **None set.** `[TO SUPPLY: targets, if any will be offered. Founder with commercial reviewer.]` |
| Escalation route | `[TO SUPPLY: route and named people. Founder.]` |
| Cover for absence | **None documented.** The founder is the only person the project documents name. A two-year service must survive one person's absence, and this has not been addressed. `[TO SUPPLY: cover arrangement. Founder.]` |
| University's first contact | `[TO SUPPLY: careers contact and DPO at each university. University.]` |
| Students' route | Accessibility statement names the support address and "5 working days". Privacy notice sends rights requests to the university's DPO. Disagreement over a score goes to an adviser. |

## Availability and service levels

**No uptime figure exists and none is offered.** No measured history of availability has been read. The terms of use say availability can't be promised.

Maintenance windows, notice of changes and scoring-version changes: `[TO SUPPLY: commitments, if any. Founder.]` A scoring bump starts a new score series for every student, which is visible to them.

## Monitoring

| Control | Position | Level |
|---|---|---|
| Uptime check | `.github/workflows/uptime.yml`, every 15 minutes, 3 tries. Emails the repository owner on failure. Runs not read. **GitHub pauses it after 60 days with no commits.** Must change with the domain. | Built; runs not read |
| `/api/health` | Checks the database and reports the mode. **Stays 200 when email, cron or AI keys are missing or wrong.** | Not read on production for OP-028 or this pack |
| Alert channel | Code exists. **`ALERT_WEBHOOK_URL` is missing, so alerts reach logs only.** | Locally tested; not configured |
| Logs | Vercel, 1 hour on Hobby or 1 day on Pro per its limits page, 7 November 2026. Plan not read. **A short log window limits any investigation.** | Not verified |
| Reminder and retention job failures | Alert, if the channel existed | Locally tested |
| Status page for universities | None | Not built |

## Incident procedure

Written in [OPERATIONS.md](../OPERATIONS.md). **Documented only:** never run, and no named on-call person. Not reviewed.

1. **Contain.** Roll back, or turn off the feature with its variable. For a suspected breach, rotate the service role key first.
2. **Assess.** What data, how many people, which universities, from Supabase and Vercel logs.
3. **Tell the university's DPO.** The university is the controller and decides on ICO reporting within 72 hours.
4. **Fix and review.** Write up the cause and fix, and add a test.

### Open conflict: 24 or 48 hours

| Document | What it says |
|---|---|
| [OPERATIONS.md](../OPERATIONS.md), [RESTORE_PROCEDURE.md](../RESTORE_PROCEDURE.md) | Tell the university DPO **within 24 hours** of becoming aware |
| [DPA schedule template](../legal/DPA_SCHEDULE_TEMPLATE.md) | "without undue delay and **within 48 hours**" |

**Unresolved. No founder decision records it** (not in [FOUNDER_DECISIONS.md](../FOUNDER_DECISIONS.md)). `[TO SUPPLY: the period to commit to. Founder with lawyer.]` Whichever is chosen needs a contact list and someone on call, neither of which exists.

Not in place: a breach register, a contact list per university, notification templates, a rehearsal, a process for a breach at a sub-processor, an agreed notice period from processors.

## Recovery

| Item | Position |
|---|---|
| Backups | **Not running** |
| Restore | **Not rehearsed.** No result, no measured time. |
| Recovery point and recovery time objectives | **None set, and none can be stated.** `[TO SUPPLY: after FD-04 and a rehearsal. Founder.]` |
| Plan | [FD-04](../FOUNDER_DECISIONS.md#fd-04) and [FD-22](../FOUNDER_DECISIONS.md#fd-22) are open. |
| App rollback | Vercel instant rollback, written, not run. **Once students have used new code, rollback isn't known to be safe.** |
| Database rollback | Migrations can't be cleanly undone. Roll forward, tested on staging, which doesn't exist. |
| Provider outage | AI: scoring gives no score rather than a guess, with a retry and quota returned. Locally tested with simulated failures; no real outage. |
| Continuity if the operator stops | `[TO SUPPLY: exit, escrow or handover position. Founder with commercial reviewer.]` Not addressed. |

## Change management

Written in [RELEASE_RUNBOOK.md](../RELEASE_RUNBOOK.md). **Not exercised.** CI workflow runs typecheck, lint, engine, database, build and e2e tests; whether `main` requires it was last recorded 2 November. Independent review by another AI agent (Codex) has covered OP-001 and OP-002 only.
