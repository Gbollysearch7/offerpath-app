# Thresholds pre-registration

Fill in `thresholds.template.json` **with the pilot partner, before anyone looks at held-out results.** The tool has no default numbers on purpose. What counts as good enough is a decision for careers professionals and the partner, and any number the tool suggested would look more authoritative than it is.

## How to fill it in

1. Copy the template next to the dataset, and set `dataset` and `dataset_version` to match `manifest.json`.
2. Agree each `threshold`, and write the reason in `why`. A useful reason refers to how advisers differ: an app can't reasonably be asked to agree with an adviser more closely than advisers agree with each other, and the development report shows `reviewers.leave_one_out_mae`.
3. Agree `minimum_heldout_groups` and `minimum_subgroup_groups`. Count independent CV groups, not documents.
4. Name the people agreeing in `agreed_by`. Real data needs at least one `pilot_partner` and the `founder`, with dates.
5. Run `freeze`, then send the printed thresholds hash to the pilot partner by email. That gives a dated record outside this machine.

## Rules the tool applies

- **No averaging.** Each gate stands alone. One failure fails the run, however good the rest are.
- **Subgroups count.** An `each:` gate is tested on every subgroup, so a strong overall figure can't cover a discipline where the app does badly.
- **A pass must be clear of doubt.** The cautious end of the 95% interval must clear the threshold. A good estimate on thin data is reported as inconclusive. With few groups, expect inconclusive results.
- **Required gates can't be removed.** The template's gates are all required. You may add others from the metric list in `scripts/calibration/gates.ts`.
- **Whether higher or lower is better is fixed** per metric, in the tool.
- **After opening, nothing moves.** Different thresholds, a different engine version or changed marks all make the tool refuse, and a new dataset with new held-out CVs is needed.

## Metrics

| Metric | Meaning |
|---|---|
| `score.mae` | Average gap in points between the app and the advisers' mean. |
| `rank.spearman` | Do the app and advisers put CVs in the same order? 1 is identical. |
| `coverage.scored_share` | Share of CVs given a score at all. Stops withholding from flattering the error. |
| `reviewers.alpha` | Krippendorff's alpha: how far advisers agree. A low value means the yardstick itself is uncertain. |
| `severity.weighted_kappa` | Agreement on how much valid findings matter, beyond chance. |
| `findings.review_coverage` | Share of the app's findings that advisers actually reviewed. |
| `findings.false_positive_rate` | Share of reviewed findings advisers rejected. A tie counts against the app. |
| `findings.missed_major_per_doc` | High-severity problems advisers found that the app didn't raise, per document per adviser. |
| `improvement.share_improved` | Share of CVs that advisers marked higher after the recommendations were applied. |
| `gaming.rewarded_share` | Share of adversarial variants (stuffing, fabricated figures, repetition, instructions) scoring above their original. |
| `rewrite.review_coverage` | Share of rewrites reviewed. |
| `rewrite.fidelity_failure_rate` | Share of rewrites advisers say invented a fact. |
| `rewrite.seniority_inflation_rate` | Share of rewrites that overstate responsibility. |
| `rewrite.unnecessary_change_rate` | Share of strong original lines changed for no benefit. |
| `rewrite.usefulness_mean` | Advisers' usefulness rating, 1 to 5. |
| `rewrite.check_missed_invention_rate` | Inventions (by advisers' judgment) that the rewrite check let through. |
| `rewrite.check_false_rejection_rate` | Faithful rewrites (by advisers' judgment) that the check blocked. |
