# Adviser marking guide

Blank sheets: `adviser-marks.template.csv` (blind marks), `finding-reviews.template.csv` and `missed-issues.template.csv` (after marking), and `rewrite-reviews.template.csv`. Normally the steward sends you a sheet already filled with your reviewer ID and the document IDs, in your own order.

Your judgment is the measure here, and it is fine to disagree with other advisers. Every adviser's mark is kept. Disagreement is reported rather than averaged away.

## Before you start

- Don't use Offerpath on these documents, or look at any Offerpath score for them, until your blind marks are returned.
- Don't discuss documents or marks with other advisers until you have all returned your sheets.
- If you think you recognise a student, stop and tell the steward. Don't mark that document.
- Don't write names, email addresses or anything else that could identify someone in the notes.

## Part 1: blind marks

Mark each document as you would judge it for a student applying for graduate roles in that discipline. Fill in one row per document.

| Column | What to enter |
|---|---|
| `overall_mark` | 0 to 100. See the guide below. Required. |
| `impact`, `clarity`, `structure`, `spelling`, `length` | Optional, 0 to 100. Leave blank rather than guess. |
| `saw_offerpath_output` | `no`. If you did see it, write `yes` and tell the steward: the mark can't be used, and that's fine. |
| `marked_at` | The date, as 2027-01-31. |
| `notes` | Optional. Why you marked it this way. No personal details. |

Guide for `overall_mark`. These are prompts, not rules:

| Mark | Reading |
|---|---|
| 0 to 49 | Needs substantial work before applying. |
| 50 to 74 | Usable, with clear improvements needed. |
| 75 to 89 | Strong, with small improvements possible. |
| 90 to 100 | Very strong. You would change little. |

Some documents may be versions of each other. Mark each one on its own merits.

**Return this sheet before starting part 2.** The tool won't release part 2 until your marks are in.

## Part 2: the app's findings (after your blind marks are in)

You'll now see what the app said about each document, without a score.

| Column | What to enter |
|---|---|
| `verdict` | `valid`: a fair point. `not_valid`: wrong, or not a real problem. `unsure`: you can't tell. |
| `severity` | For a valid finding only: `low` (polish), `medium` (worth fixing), `high` (would hurt an application). |
| `reviewed_at` | The date. |

On the missed issues sheet, add one row for each important problem the app didn't raise, with its `severity` and a short description. Add nothing if there's nothing to add.

## Part 3: rewrites

Compare each rewrite with its original line and the document it came from. Some originals are already strong and should not have been changed. Some rewrites are deliberately bad.

| Column | What to enter |
|---|---|
| `factual_fidelity` | `faithful`: says nothing the original doesn't support. `minor_issue`: a small stretch or a lost detail. `invented`: adds or moves a fact, such as a figure, employer, tool, or result. |
| `seniority` | `preserved`, `inflated` (for example "supported" became "led"), or `deflated`. |
| `clarity`, `usefulness` | 1 (poor) to 5 (excellent). Would this help the student? |
| `unnecessary_change` | `yes` if the original was fine and the change didn't help. Otherwise `no`. |
| `reviewed_at` | The date. |
