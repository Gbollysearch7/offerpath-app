import { buildClaimInventory } from "@/lib/analysis/claims";
import { checkRewrite } from "@/lib/analysis/rewrite-check";
import { bandKey } from "@/lib/analysis/rubric";
import { MARK_AREAS, STRATA, type Dataset, type DocumentEntry, type FindingReview, type Mark, type RewriteItem, type RewriteReview } from "./dataset";
import type { DocumentText, PredictedFinding, Prediction } from "./engine";
import { clusterBootstrap, envelope, kendallTauB, krippendorffAlpha, mean, median, spearman, weightedKappa, wilson } from "./stats";

// Every number a report can show, computed for one slice of documents at a time. Nothing outside the slice is read,
// which is what keeps held-out marks out of development figures. There is deliberately no combined score anywhere:
// metrics are gated one by one (gates.ts), and a composite is exactly how a failed one would get hidden.

export const MIN_GROUPS_FOR_INTERVAL = 5;
export const DISAGREEMENT_FLAG_POINTS = 15;

export interface Metric {
  value: number | null;
  /** Items measured. Variants and findings make this larger than the number of independent CVs. */
  n: number;
  /** Independent CV groups behind the items: the number that really limits certainty. */
  n_groups: number;
  ci: [number, number] | null;
  note?: string;
}
export type MetricSet = Record<string, Metric>;

export interface MetricBundle {
  overall: MetricSet;
  subgroups: Record<string, Record<string, MetricSet>>;
}

export interface EvalContext {
  documents: DocumentEntry[];
  predictions: Map<string, Prediction>;
  texts: Map<string, DocumentText>;
  marks: Mark[];
  findingReviews: FindingReview[];
  missedIssues: Dataset["missedIssues"];
  rewriteItems: RewriteItem[];
  rewriteReviews: RewriteReview[];
  seed: string;
  iterations: number;
}

const PRIMARY = new Set(["original", "revision"]);
const isAdversarial = (d: DocumentEntry) => d.variant_kind.startsWith("adversarial_");
const round = (v: number | null) => (v === null ? null : Math.round(v * 10000) / 10000);

function statistic<T>(name: string, rows: T[], groupOf: (r: T) => string, stat: (rows: T[]) => number | null, ctx: EvalContext): Metric {
  const n_groups = new Set(rows.map(groupOf)).size;
  const value = rows.length ? stat(rows) : null;
  if (value === null) return { value: null, n: rows.length, n_groups, ci: null, note: rows.length ? "undefined on this data" : "nothing to measure" };
  if (n_groups < MIN_GROUPS_FOR_INTERVAL) return { value: round(value), n: rows.length, n_groups, ci: null, note: `too few independent groups for an interval (under ${MIN_GROUPS_FOR_INTERVAL})` };
  const boot = clusterBootstrap(rows, groupOf, stat, `${ctx.seed}|${name}`, ctx.iterations);
  return { value: round(value), n: rows.length, n_groups, ci: boot.ci && [round(boot.ci[0])!, round(boot.ci[1])!], note: boot.ci ? undefined : "interval undefined on most resamples" };
}

/** A proportion's interval is the wider of Wilson and the grouped bootstrap: the first handles 0 of n, the second handles clustering. */
function proportion<T>(name: string, rows: T[], groupOf: (r: T) => string, hit: (r: T) => boolean, ctx: EvalContext): Metric {
  const m = statistic(name, rows, groupOf, (rs) => rs.filter(hit).length / rs.length, ctx);
  if (m.value === null || m.n_groups < MIN_GROUPS_FOR_INTERVAL) return m;
  const ci = envelope(m.ci, wilson(rows.filter(hit).length, rows.length));
  return { ...m, ci: ci && [round(ci[0])!, round(ci[1])!] };
}

interface ScoreRow { group: string; adviser: number; ours: number; areas: Partial<Record<(typeof MARK_AREAS)[number], { adviser: number; ours: number }>>; }
interface MarkedDoc { group: string; marks: Mark[]; }

function marksByDoc(ctx: EvalContext): Map<string, Mark[]> {
  const out = new Map<string, Mark[]>();
  for (const m of ctx.marks) out.set(m.document_id, [...(out.get(m.document_id) ?? []), m]);
  return out;
}

function scoreMetrics(docs: DocumentEntry[], ctx: EvalContext): MetricSet {
  const byDoc = marksByDoc(ctx);
  const primary = docs.filter((d) => PRIMARY.has(d.variant_kind));
  const out: MetricSet = {};
  // Withholding a score must not flatter the error figures unseen, so how often it happened is a metric of its own.
  out["coverage.scored_share"] = proportion("coverage", primary, (d) => d.group, (d) => ctx.predictions.get(d.id)?.coverage !== "withheld", ctx);

  const rows: ScoreRow[] = [];
  for (const d of primary) {
    const marks = byDoc.get(d.id);
    const p = ctx.predictions.get(d.id);
    if (!marks?.length || !p || p.coverage === "withheld") continue;
    const areas: ScoreRow["areas"] = {};
    for (const a of MARK_AREAS) {
      const given = marks.map((m) => m.areas[a]).filter((v): v is number => v !== undefined);
      if (given.length && p.areas[a] !== undefined) areas[a] = { adviser: mean(given), ours: p.areas[a] };
    }
    rows.push({ group: d.group, adviser: mean(marks.map((m) => m.overall)), ours: p.score, areas });
  }
  const g = (r: { group: string }) => r.group;
  const err = (r: ScoreRow) => r.ours - r.adviser;
  out["score.mae"] = statistic("mae", rows, g, (rs) => mean(rs.map((r) => Math.abs(err(r)))), ctx);
  out["score.rmse"] = statistic("rmse", rows, g, (rs) => Math.sqrt(mean(rs.map((r) => err(r) ** 2))), ctx);
  out["score.bias"] = statistic("bias", rows, g, (rs) => mean(rs.map(err)), ctx);
  out["score.within_5"] = proportion("w5", rows, g, (r) => Math.abs(err(r)) <= 5, ctx);
  out["score.within_10"] = proportion("w10", rows, g, (r) => Math.abs(err(r)) <= 10, ctx);
  out["rank.spearman"] = statistic("spearman", rows, g, (rs) => spearman(rs.map((r) => r.ours), rs.map((r) => r.adviser)), ctx);
  out["rank.kendall_tau_b"] = statistic("kendall", rows, g, (rs) => kendallTauB(rs.map((r) => r.ours), rs.map((r) => r.adviser)), ctx);
  out["band.exact_agreement"] = proportion("band", rows, g, (r) => bandKey(r.ours) === bandKey(r.adviser), ctx);
  for (const a of MARK_AREAS) {
    const areaRows = rows.filter((r) => r.areas[a]);
    if (areaRows.length) out[`area.${a}.mae`] = statistic(`area-${a}`, areaRows, g, (rs) => mean(rs.map((r) => Math.abs(r.areas[a]!.ours - r.areas[a]!.adviser))), ctx);
  }

  // How far advisers are from each other: the yardstick the app's error should be read against.
  const reviewed: MarkedDoc[] = primary.flatMap((d) => (byDoc.get(d.id)?.length ?? 0) >= 2 ? [{ group: d.group, marks: byDoc.get(d.id)! }] : []);
  const reviewerIds = [...new Set(reviewed.flatMap((r) => r.marks.map((m) => m.reviewer_id)))].sort();
  const alphaOf = (rs: MarkedDoc[]) => krippendorffAlpha(rs.map((r) => reviewerIds.map((id) => r.marks.find((m) => m.reviewer_id === id)?.overall ?? null)));
  out["reviewers.alpha"] = statistic("alpha", reviewed, g, alphaOf, ctx);
  out["reviewers.leave_one_out_mae"] = statistic("loo", reviewed, g, (rs) => mean(rs.flatMap((r) => r.marks.map((m) => {
    const others = r.marks.filter((o) => o !== m).map((o) => o.overall);
    return Math.abs(m.overall - mean(others));
  }))), ctx);
  return out;
}

interface FindingRow { group: string; check: string; finding: PredictedFinding; reviews: FindingReview[]; }

function findingRows(docs: DocumentEntry[], ctx: EvalContext): FindingRow[] {
  const byFinding = new Map<string, FindingReview[]>();
  for (const r of ctx.findingReviews) byFinding.set(r.finding_id, [...(byFinding.get(r.finding_id) ?? []), r]);
  return docs.filter((d) => PRIMARY.has(d.variant_kind)).flatMap((d) => (ctx.predictions.get(d.id)?.findings ?? []).map((f) => ({ group: d.group, check: f.check, finding: f, reviews: byFinding.get(f.id) ?? [] })));
}

const SEVERITY_LEVEL = { low: 0, medium: 1, high: 2 } as const;

function findingMetrics(rows: FindingRow[], ctx: EvalContext, prefix = ""): MetricSet {
  const g = (r: { group: string }) => r.group;
  const votes = (r: FindingRow) => ({ valid: r.reviews.filter((x) => x.verdict === "valid").length, notValid: r.reviews.filter((x) => x.verdict === "not_valid").length });
  const decided = rows.filter((r) => { const v = votes(r); return v.valid + v.notValid > 0; });
  // A tie counts against the finding. Advisers split on it, so the app hasn't earned the benefit of the doubt.
  const isFalse = (r: FindingRow) => { const v = votes(r); return v.notValid > 0 && v.notValid >= v.valid; };
  const severityRows = decided.filter((r) => !isFalse(r) && r.finding.severity !== "info").map((r) => {
    const levels = r.reviews.filter((x) => x.severity).map((x) => SEVERITY_LEVEL[x.severity!]);
    return { group: r.group, ours: SEVERITY_LEVEL[r.finding.severity as keyof typeof SEVERITY_LEVEL], adviser: Math.ceil(median(levels)) };
  });
  return {
    "findings.review_coverage": proportion(`${prefix}cov`, rows, g, (r) => r.reviews.length > 0, ctx),
    "findings.false_positive_rate": proportion(`${prefix}fp`, decided, g, isFalse, ctx),
    "findings.disputed_share": proportion(`${prefix}disp`, decided, g, (r) => { const v = votes(r); return v.valid > 0 && v.notValid > 0; }, ctx),
    "severity.exact_agreement": proportion(`${prefix}sev`, severityRows, g, (r) => r.ours === r.adviser, ctx),
    "severity.weighted_kappa": statistic(`${prefix}kappa`, severityRows, g, (rs) => weightedKappa(rs.map((r) => r.ours), rs.map((r) => r.adviser), 3), ctx),
  };
}

function missedMetrics(docs: DocumentEntry[], ctx: EvalContext): MetricSet {
  const byDoc = marksByDoc(ctx);
  const rows = docs.filter((d) => PRIMARY.has(d.variant_kind) && byDoc.get(d.id)?.length).map((d) => ({
    group: d.group,
    high: ctx.missedIssues.filter((m) => m.document_id === d.id && m.severity === "high").length / byDoc.get(d.id)!.length,
  }));
  return { "findings.missed_major_per_doc": statistic("missed", rows, (r) => r.group, (rs) => mean(rs.map((r) => r.high)), ctx) };
}

/** Do the app's recommendations help? Original and revised CVs, each marked blind by advisers. */
function improvementMetrics(docs: DocumentEntry[], ctx: EvalContext): MetricSet {
  const byDoc = marksByDoc(ctx);
  const byId = new Map(docs.map((d) => [d.id, d]));
  const rows = docs.filter((d) => d.variant_kind === "applied_recommendations" && d.variant_of).flatMap((d) => {
    const after = byDoc.get(d.id);
    const before = byDoc.get(d.variant_of!);
    const pa = ctx.predictions.get(d.id);
    const pb = ctx.predictions.get(d.variant_of!);
    if (!after?.length || !before?.length || !pa || !pb || !byId.has(d.variant_of!)) return [];
    // The same advisers on both sides, or a change of adviser would read as a change in the CV.
    const paired = after.flatMap((m) => {
      const earlier = before.find((b) => b.reviewer_id === m.reviewer_id);
      return earlier ? [m.overall - earlier.overall] : [];
    });
    return paired.length ? [{ group: d.group, adviser: mean(paired), ours: pa.score - pb.score }] : [];
  });
  const g = (r: { group: string }) => r.group;
  return {
    "improvement.mean_change": statistic("imp-mean", rows, g, (rs) => mean(rs.map((r) => r.adviser)), ctx),
    "improvement.share_improved": proportion("imp-share", rows, g, (r) => r.adviser > 0, ctx),
    "improvement.app_direction_agreement": proportion("imp-dir", rows, g, (r) => Math.sign(r.ours) === Math.sign(r.adviser), ctx),
  };
}

/** Gaming needs no adviser: a stuffed, fabricated, repeated or instruction-carrying CV should not score above its original. */
function gamingMetrics(docs: DocumentEntry[], ctx: EvalContext): MetricSet {
  const rows = docs.filter((d) => isAdversarial(d) && d.variant_of).flatMap((d) => {
    const pa = ctx.predictions.get(d.id);
    const pb = ctx.predictions.get(d.variant_of!);
    return pa && pb ? [{ group: d.group, uplift: pa.score - pb.score }] : [];
  });
  const g = (r: { group: string }) => r.group;
  return {
    "gaming.rewarded_share": proportion("gaming-share", rows, g, (r) => r.uplift > 0, ctx),
    "gaming.mean_uplift": statistic("gaming-mean", rows, g, (rs) => mean(rs.map((r) => r.uplift)), ctx),
  };
}

function rewriteMetrics(docs: DocumentEntry[], ctx: EvalContext): MetricSet {
  const groupOf = new Map(docs.map((d) => [d.id, d.group]));
  const items = ctx.rewriteItems.filter((i) => groupOf.has(i.document_id));
  const inventories = new Map<string, ReturnType<typeof buildClaimInventory>>();
  const verdict = (item: RewriteItem) => {
    const text = ctx.texts.get(item.document_id)?.text ?? "";
    const inv = inventories.get(item.document_id) ?? buildClaimInventory(text);
    inventories.set(item.document_id, inv);
    return checkRewrite(inv, { index: inv.bullets.findIndex((b) => b?.raw === item.source_line), text: item.source_line }, item.rewrite).verdict;
  };
  const rows = items.map((item) => {
    const reviews = ctx.rewriteReviews.filter((r) => r.rewrite_id === item.rewrite_id);
    const share = (test: (r: RewriteReview) => boolean) => reviews.filter(test).length * 2 >= reviews.length && reviews.some(test);
    return { group: groupOf.get(item.document_id)!, item, reviews, invented: share((r) => r.fidelity === "invented"), faithful: reviews.length > 0 && reviews.every((r) => r.fidelity === "faithful"), anyIssue: share((r) => r.fidelity !== "faithful"), inflated: share((r) => r.seniority === "inflated"), unnecessary: share((r) => r.unnecessary_change), verdict: verdict(item) };
  });
  const g = (r: { group: string }) => r.group;
  const reviewed = rows.filter((r) => r.reviews.length);
  const model = reviewed.filter((r) => r.item.kind === "model_rewrite");
  const strong = reviewed.filter((r) => r.item.kind === "strong_original");
  const avg = (key: "clarity" | "usefulness") => (rs: typeof model) => mean(rs.map((r) => mean(r.reviews.map((x) => x[key]))));
  return {
    "rewrite.review_coverage": proportion("rw-cov", rows, g, (r) => r.reviews.length > 0, ctx),
    "rewrite.fidelity_failure_rate": proportion("rw-fid", model, g, (r) => r.invented, ctx),
    "rewrite.fidelity_any_issue_rate": proportion("rw-any", model, g, (r) => r.anyIssue, ctx),
    "rewrite.seniority_inflation_rate": proportion("rw-sen", model, g, (r) => r.inflated, ctx),
    "rewrite.unnecessary_change_rate": proportion("rw-unn", strong, g, (r) => r.unnecessary, ctx),
    "rewrite.clarity_mean": statistic("rw-cla", model, g, avg("clarity"), ctx),
    "rewrite.usefulness_mean": statistic("rw-use", model, g, avg("usefulness"), ctx),
    // How the rule check (OP-015) compares with people. Both errors, because a check that blocks everything also catches every invention.
    "rewrite.check_missed_invention_rate": proportion("rw-miss", reviewed.filter((r) => r.invented), g, (r) => r.verdict === "pass", ctx),
    "rewrite.check_false_rejection_rate": proportion("rw-rej", reviewed.filter((r) => r.faithful), g, (r) => r.verdict === "block", ctx),
    "rewrite.check_false_question_rate": proportion("rw-q", reviewed.filter((r) => r.faithful), g, (r) => r.verdict === "confirm", ctx),
  };
}

const valuesOf = (docs: DocumentEntry[], key: "discipline" | "career_stage" | "document_style" | "writing_strength") => [...new Set(docs.map((d) => d[key]))].sort();

export function computeMetrics(ctx: EvalContext): MetricBundle {
  const docs = ctx.documents;
  const allFindings = findingRows(docs, ctx);
  const overall: MetricSet = { ...scoreMetrics(docs, ctx), ...findingMetrics(allFindings, ctx), ...missedMetrics(docs, ctx), ...improvementMetrics(docs, ctx), ...gamingMetrics(docs, ctx), ...rewriteMetrics(docs, ctx) };
  const subgroups: MetricBundle["subgroups"] = {};
  for (const s of STRATA) {
    subgroups[`each:${s}`] = {};
    for (const v of valuesOf(docs, s)) subgroups[`each:${s}`][v] = scoreMetrics(docs.filter((d) => d[s] === v), { ...ctx, seed: `${ctx.seed}|${s}=${v}` });
  }
  subgroups["each:check"] = {};
  for (const c of [...new Set(allFindings.map((r) => r.check))].sort()) subgroups["each:check"][c] = findingMetrics(allFindings.filter((r) => r.check === c), { ...ctx, seed: `${ctx.seed}|check=${c}` }, c);
  subgroups["each:variant_kind"] = {};
  for (const k of [...new Set(docs.filter(isAdversarial).map((d) => d.variant_kind))].sort()) {
    const base = docs.filter((d) => d.variant_kind === k || !isAdversarial(d));
    subgroups["each:variant_kind"][k] = gamingMetrics(base, { ...ctx, seed: `${ctx.seed}|kind=${k}` });
  }
  return { overall, subgroups };
}

export interface DocumentRow {
  document: string;
  group: string;
  variant: string;
  adviser_marks: Record<string, number>;
  adviser_mean: number | null;
  adviser_range: number | null;
  disagreement_flag: boolean;
  offerpath: number;
  coverage: string;
  difference: number | null;
}

/** Row by row, keeping each adviser's own mark. Disagreement stays visible and is never averaged away. */
export function documentTable(ctx: EvalContext): DocumentRow[] {
  const byDoc = marksByDoc(ctx);
  return ctx.documents.map((d) => {
    const marks = byDoc.get(d.id) ?? [];
    const p = ctx.predictions.get(d.id)!;
    const values = marks.map((m) => m.overall);
    const avg = values.length ? mean(values) : null;
    const range = values.length ? Math.max(...values) - Math.min(...values) : null;
    return {
      document: d.id,
      group: d.group,
      variant: d.variant_kind,
      adviser_marks: Object.fromEntries(marks.map((m) => [m.reviewer_id, m.overall])),
      adviser_mean: round(avg),
      adviser_range: range,
      disagreement_flag: range !== null && range >= DISAGREEMENT_FLAG_POINTS,
      offerpath: p.score,
      coverage: p.coverage,
      difference: avg === null || p.coverage === "withheld" ? null : round(p.score - avg),
    };
  });
}
