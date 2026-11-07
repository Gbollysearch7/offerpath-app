# Calibration runbook

For a careers adviser and the founder running a real calibration of Offerpath. No real calibration has been run yet, and the tool holds no results.

**What this answers:** on these documents, does Offerpath agree with independent advisers well enough to meet targets agreed in advance? It can't prove accuracy in general. Thirty CVs support a first investigation.

## People, and what only they can do

| Who | What they do |
|---|---|
| Founder | Recruits the partner. Decides which engine version is tested. Applies tuning. |
| Pilot partner | Agrees thresholds before results exist. Accepts or rejects the result. |
| Data steward (at the institution) | Collects consent, holds raw CVs and the key file, and anonymises. |
| At least 2 independent, qualified advisers | Mark blind. They must not work for Offerpath or see its scores first. |

The tool cannot recruit anyone, obtain consent or decide what "good enough" means. It records what people attest and can't check that it is true.

## Before you start

1. **Settle the engine first.** Opening held-out data works once per engine version, and any version bump afterwards spends it. Pending parser fixes and numeric changes (OP-010 lists one estimated to move a CV from 22 to 87) should ship *before* this starts. Those moves are estimates and aren't validated.
2. **Test what students get.** Live scoring uses the AI judge when a key is configured. If that is what students see, use `--ai --allow-paid-provider` on `evaluate`, `freeze` and `findings-sheets`. It costs money and sends CV text to the provider, so consent must cover it.
3. **Allow for sample size.** Aim for at least 30 independent people across disciplines, career stages, document styles and writing strengths, and more if you want subgroup results. Variants of one CV count as one. Below 30 groups, a report can't reach "met".
4. **See the flow on invented data:** `npm run calibrate -- synthetic --out /tmp/calibration-practice`. Its output says SYNTHETIC, NOT VALIDATION, and that is all it is.

## The steps

Run commands from the repository. `D` is the dataset folder, such as `calibration/pilot-2027-a`. Git ignores that location, and the tool refuses real data anywhere it could be committed.

| # | Who | Do this |
|---|---|---|
| 1 | Steward | Complete [the consent and anonymisation checklist](calibration/CONSENT_AND_ANONYMISATION_CHECKLIST.md). Fill in [the intake sheet](calibration/intake.template.csv), giving every CV from one person the same `group_label`. Include any adversarial variants and "after recommendations" versions. |
| 2 | Steward | `npm run calibrate -- anonymise --intake intake.csv --raw RAW --out D --key-out KEY --name pilot-2027-a --version 1`. Keep `RAW` and `KEY` away from `D`. |
| 3 | Steward | Read every document against `anonymisation-log.csv`, fix what remains, then put your initials in `anonymisation_reviewed_by` in `manifest.json`. Add `reviewers.csv` from [its template](calibration/reviewers.template.csv). |
| 4 | Founder | `npm run calibrate -- validate --dir D`, then `npm run calibrate -- split --dir D`. A split is never redone, so finish collecting documents first. |
| 5 | Advisers | `npm run calibrate -- marking-sheets --dir D` makes one sheet each. Mark blind, following [the marking guide](calibration/ADVISER_MARKING_SHEET.md). |
| 6 | Founder | For each returned sheet: `npm run calibrate -- import --dir D --sheet marks --file F`. A bad row stops the import and is named. |
| 7 | Advisers | `npm run calibrate -- findings-sheets --dir D --split development`. Review them, then import with `--sheet findings` and `--sheet missed`. |
| 8 | Founder | Add rewrites to `rewrite-items.csv`, including strong originals that should stay unchanged. Run `npm run calibrate -- rewrite-sheets --dir D`. Advisers review them, then import with `--sheet rewrites`. |
| 9 | Founder | `npm run calibrate -- evaluate --dir D --split development`. Tune here if needed, and bump the version as `rubric.ts` describes. **This data is for tuning and is never evidence.** Don't change a weight just because an area correlates with total marks on a small set. |
| 10 | Founder and partner | Agree thresholds with [the pre-registration guide](calibration/THRESHOLDS_PREREGISTRATION.md). The tool proposes no numbers. |
| 11 | Founder | `npm run calibrate -- freeze --dir D --thresholds thresholds.json`. Email the printed hash to the partner, which gives a dated record outside this machine. |
| 12 | Advisers | `npm run calibrate -- findings-sheets --dir D --split heldout`, then review and import as in step 7. |
| 13 | Founder, with the partner told | `npm run calibrate -- evaluate --dir D --split heldout --open-heldout`. This is the one look. It writes `reports/`. Any result but "met" exits non-zero. |
| 14 | Founder and partner | Read the report and record the decision. |

## Reading the report

- **Thresholds NOT MET** means at least one gate failed. No average can offset it. Failures are listed first.
- **INCONCLUSIVE** is not a pass. Usually there's too little data: the cautious end of the interval must clear the threshold.
- **Thresholds met on this dataset** means only that. It counts as evidence once the founder and partner accept it, with its limitations and the release it applied to.
- **Compare with advisers.** `reviewers.leave_one_out_mae` shows how far advisers are from each other. Flagged documents show where they disagree, and the tool doesn't settle it.

## If something goes wrong

| Situation | What to do |
|---|---|
| The engine needs changing after step 13 | The held-out set is spent and the tool refuses it. Make the change, and test on a new dataset with **new** held-out CVs. |
| An adviser saw a score before marking | Don't use that mark. Another adviser marks the document. |
| Two CVs flagged as near-duplicates at step 4 | Put them in one group. If the steward has checked they are different people, list them under `confirmed_distinct` with a reason. |
| A student withdraws | Follow the withdrawal section of the checklist. After step 13, the first report stands and the withdrawal becomes a limitation. |
| The tool refuses something | Read the message. Refusals exit with code 3 and exist to stop a misleading claim. Don't edit the lock or ledger files to get round them. |

## Never say

- That Offerpath is "validated" or "adviser approved" because of a synthetic, development or `--demo` run.
- That demo marks came from advisers. `npm run calibrate -- --demo` is a layout preview, and the tool refuses demo material as evidence.
- That a result on one dataset proves accuracy in general, or predicts interviews or jobs.

## OP-015 rewrite fixture review

The rewrite check's test cases were written by its author, so they need independent reading. `npm run calibrate -- op015-pack --out PACK` makes a blind sheet and two invented CVs. Send those, and **keep back** the `author-labels.DO-NOT-SEND.json` file. Then run `npm run calibrate -- op015-compare --reviews FILE`. This reviews the fixtures. It doesn't measure live rewrites.
