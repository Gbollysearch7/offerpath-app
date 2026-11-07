import assert from "node:assert/strict";
import { test } from "node:test";
import type { DocumentEntry, FindingReview, Mark, RewriteItem, RewriteReview, VariantKind } from "../scripts/calibration/dataset";
import type { DocumentText, PredictedFinding, Prediction } from "../scripts/calibration/engine";
import { computeMetrics, documentTable, type EvalContext } from "../scripts/calibration/metrics";

// One tiny hand-built dataset with every figure worked out by hand in the comments. The data is invented: this tests
// the arithmetic of the metrics, and says nothing about Offerpath.

const near = (a: number | null | undefined, b: number, eps = 0.001) => assert.ok(typeof a === "number" && Math.abs(a - b) <= eps, `${a} should be ${b}`);

const CV = `Test Person
EXPERIENCE
Sales Assistant, Harlow Books | 2022 – 2023
• Trained 3 new starters on the till system.
• Answered customer questions about delivery times.
`;
const SOURCE = "Trained 3 new starters on the till system.";

function doc(id: string, variant_kind: VariantKind = "original", variant_of: string | null = null, discipline = "Law"): DocumentEntry {
  // A variant shares its base's group, as the import rules require.
  return { id, file: "", group: `g-${variant_of ?? id}`, discipline, career_stage: "c", document_style: "s", writing_strength: "w", variant_kind, variant_of, consent_ref: "", anonymisation_reviewed_by: "" };
}

function context(): EvalContext {
  const documents = [doc("d1"), doc("d2"), doc("d3"), doc("d4"), doc("d5"), doc("d6"), doc("d7", "applied_recommendations", "d1"), doc("d8", "applied_recommendations", "d2"), doc("d9", "adversarial_keyword_stuffing", "d1"), doc("d10", "adversarial_instruction_injection", "d2")];
  const pred = (id: string, score: number, coverage: Prediction["coverage"] = "complete", findings: PredictedFinding[] = []): [string, Prediction] => [id, { documentId: id, score, coverage, areas: { impact: score }, findings, identity: "test" }];
  const finding = (check: string, severity: PredictedFinding["severity"]): PredictedFinding => ({ id: `d1:${check}`, check, severity, explanation: "", action: null, quotes: [] });
  const predictions = new Map<string, Prediction>([
    pred("d1", 55, "complete", [finding("f1", "high"), finding("f2", "medium"), finding("f3", "medium"), finding("f4", "low"), finding("f5", "low"), finding("f6", "low")]),
    pred("d2", 60), pred("d3", 65), pred("d4", 90), pred("d5", 40, "withheld"), pred("d6", 80),
    pred("d7", 60), pred("d8", 62), pred("d9", 60), pred("d10", 60),
  ]);
  const mark = (document_id: string, reviewer_id: string, overall: number): Mark => ({ document_id, reviewer_id, overall, areas: {}, marked_at: "2027-01-01" });
  // Adviser means: d1 50, d2 60, d3 70, d4 80, d5 40, d6 90, d7 55, d8 58.
  const pairs: [string, number, number][] = [["d1", 45, 55], ["d2", 60, 60], ["d3", 65, 75], ["d4", 80, 80], ["d5", 35, 45], ["d6", 85, 95], ["d7", 55, 55], ["d8", 58, 58]];
  const marks = pairs.flatMap(([d, a, b]) => [mark(d, "R1", a), mark(d, "R2", b)]);
  const fr = (check: string, reviewer_id: string, verdict: FindingReview["verdict"], severity: FindingReview["severity"] = null): FindingReview => ({ finding_id: `d1:${check}`, document_id: "d1", reviewer_id, verdict, severity, reviewed_at: "2027-01-02" });
  const findingReviews = [
    fr("f1", "R1", "valid", "high"), fr("f1", "R2", "valid", "medium"),
    fr("f2", "R1", "not_valid"), fr("f2", "R2", "not_valid"),
    fr("f3", "R1", "valid", "low"), fr("f3", "R2", "not_valid"),
    fr("f4", "R1", "unsure"), fr("f4", "R2", "unsure"),
    // f5 is never reviewed.
    fr("f6", "R1", "valid", "medium"), fr("f6", "R2", "valid", "medium"),
  ];
  const item = (rewrite_id: string, kind: RewriteItem["kind"], rewrite: string): RewriteItem => ({ rewrite_id, document_id: "d1", kind, source_line: SOURCE, rewrite });
  const rewriteItems = [
    item("r1", "model_rewrite", "Trained 400 new starters on the till system."),
    item("r2", "model_rewrite", SOURCE),
    item("r3", "strong_original", SOURCE),
    item("r4", "adversarial", "Trained 400 new starters on the till system."),
    item("r5", "adversarial", SOURCE),
    item("r6", "model_rewrite", SOURCE), // never reviewed
  ];
  const rv = (rewrite_id: string, reviewer_id: string, fidelity: RewriteReview["fidelity"], usefulness: number, unnecessary_change = false, seniority: RewriteReview["seniority"] = "preserved"): RewriteReview => ({ rewrite_id, reviewer_id, fidelity, seniority, clarity: usefulness, usefulness, unnecessary_change, reviewed_at: "2027-01-03" });
  const rewriteReviews = [
    rv("r1", "R1", "invented", 4, false, "inflated"), rv("r1", "R2", "faithful", 2), // a tie: counted as a failure
    rv("r2", "R1", "faithful", 5), rv("r2", "R2", "faithful", 5),
    rv("r3", "R1", "faithful", 3, true), rv("r3", "R2", "faithful", 3, false), // a tie: counted as unnecessary
    rv("r4", "R1", "faithful", 3), rv("r4", "R2", "faithful", 3), // people say faithful, but the check blocks: a false rejection
    rv("r5", "R1", "invented", 3), rv("r5", "R2", "invented", 3), // people say invented, but the check passes: a miss
  ];
  const texts = new Map<string, DocumentText>(documents.map((d) => [d.id, { text: CV, band: null }]));
  return { documents, predictions, texts, marks, findingReviews, missedIssues: [{ document_id: "d1", reviewer_id: "R1", severity: "high", reviewed_at: "2027-01-02" }, { document_id: "d2", reviewer_id: "R1", severity: "low", reviewed_at: "2027-01-02" }], rewriteItems, rewriteReviews, seed: "test", iterations: 200 };
}

const m = computeMetrics(context());
const o = m.overall;

test("score error, worked by hand: withheld scores are left out of the error and counted in coverage", () => {
  // Scored and marked primary documents: d1 +5, d2 0, d3 -5, d4 +10, d6 -10. d5 is withheld.
  assert.equal(o["score.mae"].n, 5);
  near(o["score.mae"].value, 6); // (5+0+5+10+10)/5
  near(o["score.rmse"].value, 7.0711); // sqrt(250/5)
  near(o["score.bias"].value, 0);
  near(o["score.within_5"].value, 0.6);
  near(o["score.within_10"].value, 1);
  near(o["coverage.scored_share"].value, 5 / 6);
});

test("variants are excluded from accuracy figures: the applied and adversarial rows don't enter score error", () => {
  assert.equal(o["score.mae"].n_groups, 5);
  assert.equal(o["coverage.scored_share"].n, 6);
});

test("ranking and band agreement, worked by hand", () => {
  // Advisers 50,60,70,80,90 against ours 55,60,65,90,80: ranks differ by one on two rows. 1 - 6*2/(5*24) = 0.9.
  near(o["rank.spearman"].value, 0.9);
  // 9 of 10 pairs concordant: (9-1)/10.
  near(o["rank.kendall_tau_b"].value, 0.8);
  // Bands agree on d1, d2 and d3 only. d4 is high vs top, and d6 top vs high.
  near(o["band.exact_agreement"].value, 0.6);
});

test("adviser disagreement: alpha and each adviser against the others, worked by hand", () => {
  // Six primary documents with two marks. Absolute gaps 10, 0, 10, 0, 10, 10, in each direction: mean 40/6... per reviewer.
  near(o["reviewers.leave_one_out_mae"].value, (10 + 10 + 0 + 0 + 10 + 10 + 0 + 0 + 10 + 10 + 10 + 10) / 12);
  assert.ok(o["reviewers.alpha"].value! > 0.8 && o["reviewers.alpha"].value! < 1);
  assert.equal(o["reviewers.alpha"].n, 6);
});

test("false positives, worked by hand: a tie counts against the app, unsure and unreviewed don't count at all", () => {
  // Reviewed: f1,f2,f3,f4,f6 of 6. Decided: f1,f2,f3,f6. False: f2 (both no) and f3 (a tie).
  near(o["findings.review_coverage"].value, 5 / 6);
  assert.equal(o["findings.false_positive_rate"].n, 4);
  near(o["findings.false_positive_rate"].value, 0.5);
  near(o["findings.disputed_share"].value, 0.25);
});

test("severity, worked by hand: only findings advisers accept, compared at the rounded-up median", () => {
  // f1: ours high, advisers high+medium, median rounds up to high: agree. f6: ours low, advisers medium: disagree.
  assert.equal(o["severity.exact_agreement"].n, 2);
  near(o["severity.exact_agreement"].value, 0.5);
});

test("missed issues, worked by hand: high severity only, per document per adviser", () => {
  // One high on d1 with 2 advisers: 0.5. Five other documents: 0. The low on d2 doesn't count. 0.5/6.
  near(o["findings.missed_major_per_doc"].value, 0.5 / 6);
});

test("improvement, worked by hand: adviser marks before and after the recommendations", () => {
  // d7 against d1: +5. d8 against d2: -2.
  near(o["improvement.mean_change"].value, 1.5);
  near(o["improvement.share_improved"].value, 0.5);
  // App: d7 60 vs 55, up (agrees). d8 62 vs 60, up (advisers went down).
  near(o["improvement.app_direction_agreement"].value, 0.5);
});

test("improvement compares the same adviser before and after, so a change of adviser can't read as improvement", () => {
  const ctx = context();
  // d7's marks now come from a harsher adviser, R3, plus R1. Only R1 marked both d1 (45) and d7 (55): +10.
  ctx.marks = ctx.marks.map((x) => (x.document_id === "d7" && x.reviewer_id === "R2" ? { ...x, reviewer_id: "R3", overall: 20 } : x));
  near(computeMetrics(ctx).overall["improvement.mean_change"].value, (10 - 2) / 2);
});

test("gaming, worked by hand, overall and per kind so one bad kind can't hide", () => {
  // Stuffing d9 60 vs d1 55: rewarded. Injection d10 60 vs d2 60: not rewarded.
  near(o["gaming.rewarded_share"].value, 0.5);
  near(o["gaming.mean_uplift"].value, 2.5);
  const kinds = m.subgroups["each:variant_kind"];
  near(kinds.adversarial_keyword_stuffing["gaming.rewarded_share"].value, 1);
  near(kinds.adversarial_instruction_injection["gaming.rewarded_share"].value, 0);
});

test("rewrite fidelity and usefulness, worked by hand", () => {
  near(o["rewrite.review_coverage"].value, 5 / 6);
  // Reviewed model rewrites: r1 (a tie on invented, so a failure) and r2.
  assert.equal(o["rewrite.fidelity_failure_rate"].n, 2);
  near(o["rewrite.fidelity_failure_rate"].value, 0.5);
  near(o["rewrite.seniority_inflation_rate"].value, 0.5);
  near(o["rewrite.usefulness_mean"].value, 4); // r1 mean 3, r2 mean 5
  near(o["rewrite.unnecessary_change_rate"].value, 1);
});

test("the rewrite check is compared with people, both ways: people, not the fixture's author, decide what is invented", () => {
  // Invented per people: r1 (blocked, so caught) and r5 (identical text passes, so missed).
  assert.equal(o["rewrite.check_missed_invention_rate"].n, 2);
  near(o["rewrite.check_missed_invention_rate"].value, 0.5);
  // Faithful per people: r2 and r3 (pass), r4 (blocked, so a false rejection).
  assert.equal(o["rewrite.check_false_rejection_rate"].n, 3);
  near(o["rewrite.check_false_rejection_rate"].value, 1 / 3);
});

test("under five independent groups there is no interval, and the note says so", () => {
  assert.equal(o["rewrite.fidelity_failure_rate"].ci, null);
  assert.match(o["rewrite.fidelity_failure_rate"].note!, /too few independent groups/);
  assert.ok(o["score.mae"].ci, "five groups is enough to try");
});

test("a proportion of 0 of n keeps a non-zero upper bound", () => {
  const ctx = context();
  const none = computeMetrics({ ...ctx, findingReviews: [], rewriteItems: [], rewriteReviews: [] }).overall;
  assert.equal(none["findings.false_positive_rate"].value, null, "no reviews means unmeasured, not a perfect score");
  assert.equal(none["rewrite.fidelity_failure_rate"].value, null);
  near(none["score.within_10"].value, 1);
  assert.ok(none["score.within_10"].ci![0] < 1, "5 of 5 still has an interval below 1");
});

test("a constant score gives an undefined rank, not a good one", () => {
  const ctx = context();
  const flat = new Map([...ctx.predictions].map(([k, p]) => [k, { ...p, score: 70 }]));
  assert.equal(computeMetrics({ ...ctx, predictions: flat }).overall["rank.spearman"].value, null);
});

test("each adviser's own mark stays in the document table, and wide disagreement is flagged", () => {
  const ctx = context();
  ctx.marks = ctx.marks.map((x) => (x.document_id === "d6" && x.reviewer_id === "R2" ? { ...x, overall: 40 } : x));
  const rows = documentTable(ctx);
  const d6 = rows.find((r) => r.document === "d6")!;
  assert.deepEqual(d6.adviser_marks, { R1: 85, R2: 40 });
  assert.equal(d6.adviser_range, 45);
  assert.equal(d6.disagreement_flag, true);
  const d5 = rows.find((r) => r.document === "d5")!;
  assert.equal(d5.difference, null, "a withheld score has no difference to report");
  assert.equal(rows.find((r) => r.document === "d2")!.disagreement_flag, false);
});
