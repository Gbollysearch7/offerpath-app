import { STRATA } from "./dataset";
import type { Metric, MetricBundle, MetricSet } from "./metrics";

// Pre-registered thresholds. Each gate stands alone: one failed gate fails the run, whatever the others say, and a
// subgroup gate is checked for every subgroup. There is no weighted total to average a failure into.
//
// A gate passes only if the cautious end of the interval clears the threshold. A good point estimate on thin data is
// "inconclusive". A metric that couldn't be measured is "inconclusive" too, never a pass.

export const THRESHOLDS_SCHEMA = "offerpath-thresholds/1";

/** Whether a higher or lower value is better is fixed here, so a threshold can't be written the easy way round. */
export const METRIC_DIRECTION: Record<string, "max" | "min"> = {
  "score.mae": "max",
  "score.rmse": "max",
  "score.within_5": "min",
  "score.within_10": "min",
  "rank.spearman": "min",
  "rank.kendall_tau_b": "min",
  "band.exact_agreement": "min",
  "coverage.scored_share": "min",
  "reviewers.alpha": "min",
  "findings.review_coverage": "min",
  "findings.false_positive_rate": "max",
  "findings.missed_major_per_doc": "max",
  "severity.exact_agreement": "min",
  "severity.weighted_kappa": "min",
  "improvement.mean_change": "min",
  "improvement.share_improved": "min",
  "gaming.rewarded_share": "max",
  "gaming.mean_uplift": "max",
  "rewrite.review_coverage": "min",
  "rewrite.fidelity_failure_rate": "max",
  "rewrite.fidelity_any_issue_rate": "max",
  "rewrite.seniority_inflation_rate": "max",
  "rewrite.unnecessary_change_rate": "max",
  "rewrite.clarity_mean": "min",
  "rewrite.usefulness_mean": "min",
  "rewrite.check_missed_invention_rate": "max",
  "rewrite.check_false_rejection_rate": "max",
};

/** Dropping one of these from a pre-registration is how an inconvenient result avoids being tested, so a freeze refuses it. */
export const REQUIRED_GATES: { metric: string; scope: string }[] = [
  { metric: "score.mae", scope: "overall" },
  { metric: "score.mae", scope: "each:discipline" },
  { metric: "rank.spearman", scope: "overall" },
  { metric: "coverage.scored_share", scope: "overall" },
  { metric: "reviewers.alpha", scope: "overall" },
  { metric: "severity.weighted_kappa", scope: "overall" },
  { metric: "findings.review_coverage", scope: "overall" },
  { metric: "findings.false_positive_rate", scope: "overall" },
  { metric: "findings.false_positive_rate", scope: "each:check" },
  { metric: "findings.missed_major_per_doc", scope: "overall" },
  { metric: "improvement.share_improved", scope: "overall" },
  { metric: "gaming.rewarded_share", scope: "each:variant_kind" },
  { metric: "rewrite.review_coverage", scope: "overall" },
  { metric: "rewrite.fidelity_failure_rate", scope: "overall" },
  { metric: "rewrite.seniority_inflation_rate", scope: "overall" },
  { metric: "rewrite.unnecessary_change_rate", scope: "overall" },
  { metric: "rewrite.usefulness_mean", scope: "overall" },
  { metric: "rewrite.check_missed_invention_rate", scope: "overall" },
  { metric: "rewrite.check_false_rejection_rate", scope: "overall" },
];

const SCOPES = ["overall", ...STRATA.map((s) => `each:${s}`), "each:check", "each:variant_kind"];

export interface Gate { metric: string; scope: string; threshold: number; why: string; }
export interface Thresholds {
  schema: string;
  dataset: string;
  dataset_version: string;
  minimum_heldout_groups: number;
  minimum_subgroup_groups: number;
  agreed_by: { name: string; role: string; date: string }[];
  gates: Gate[];
}

export function thresholdProblems(t: Thresholds, ds: { name: string; version: string; kind: string }): string[] {
  const p: string[] = [];
  if (t.schema !== THRESHOLDS_SCHEMA) p.push(`schema must be ${THRESHOLDS_SCHEMA}.`);
  if (t.dataset !== ds.name || t.dataset_version !== ds.version) p.push(`these thresholds name ${t.dataset}@${t.dataset_version}, but the dataset is ${ds.name}@${ds.version}.`);
  if (!Number.isInteger(t.minimum_heldout_groups) || t.minimum_heldout_groups < 1) p.push("minimum_heldout_groups must be agreed and filled in.");
  if (!Number.isInteger(t.minimum_subgroup_groups) || t.minimum_subgroup_groups < 1) p.push("minimum_subgroup_groups must be agreed and filled in.");
  const seen = new Set<string>();
  for (const g of t.gates ?? []) {
    const at = `gate ${g.metric} (${g.scope})`;
    if (!METRIC_DIRECTION[g.metric]) p.push(`${at}: not a metric that can be gated.`);
    if (!SCOPES.includes(g.scope)) p.push(`${at}: scope must be one of ${SCOPES.join(", ")}.`);
    if (typeof g.threshold !== "number" || !Number.isFinite(g.threshold)) p.push(`${at}: threshold is blank. Agree a number with the pilot partner.`);
    if (!g.why?.trim()) p.push(`${at}: record why this number was agreed.`);
    if (seen.has(`${g.metric}|${g.scope}`)) p.push(`${at}: listed twice.`);
    seen.add(`${g.metric}|${g.scope}`);
  }
  for (const r of REQUIRED_GATES) if (!seen.has(`${r.metric}|${r.scope}`)) p.push(`required gate missing: ${r.metric} (${r.scope}). It can't be left out.`);
  const named = (t.agreed_by ?? []).filter((a) => a.name?.trim() && a.date?.trim());
  if (ds.kind === "real") {
    if (!named.some((a) => a.role === "pilot_partner")) p.push("agreed_by must name someone from the pilot partner (role pilot_partner), with a date.");
    if (!named.some((a) => a.role === "founder")) p.push("agreed_by must name the founder (role founder), with a date.");
  } else if (!named.length) p.push("agreed_by must say who wrote these thresholds.");
  return p;
}

export type GateOutcome = "PASS" | "FAIL" | "INCONCLUSIVE";
export interface GateResult {
  metric: string;
  scope: string;
  subgroup: string | null;
  direction: "at most" | "at least";
  threshold: number;
  value: number | null;
  ci: [number, number] | null;
  n: number;
  n_groups: number;
  outcome: GateOutcome;
  reason: string;
}

function judge(gate: Gate, subgroup: string | null, m: Metric | undefined, minGroups: number): GateResult {
  const max = METRIC_DIRECTION[gate.metric] === "max";
  const base = { metric: gate.metric, scope: gate.scope, subgroup, direction: max ? "at most" : "at least", threshold: gate.threshold, value: m?.value ?? null, ci: m?.ci ?? null, n: m?.n ?? 0, n_groups: m?.n_groups ?? 0 } as const;
  if (!m || m.value === null) return { ...base, outcome: "INCONCLUSIVE", reason: "not measured on this data" };
  if (m.n_groups < minGroups) return { ...base, outcome: "INCONCLUSIVE", reason: `only ${m.n_groups} independent groups; ${minGroups} were agreed as the minimum` };
  const clears = (v: number) => (max ? v <= gate.threshold : v >= gate.threshold);
  if (!clears(m.value)) return { ...base, outcome: "FAIL", reason: "the estimate itself misses the threshold" };
  if (!m.ci) return { ...base, outcome: "INCONCLUSIVE", reason: "no confidence interval could be computed" };
  const cautious = max ? m.ci[1] : m.ci[0];
  if (!clears(cautious)) return { ...base, outcome: "INCONCLUSIVE", reason: `the estimate clears it, but the cautious end of the interval (${cautious}) does not` };
  return { ...base, outcome: "PASS", reason: "the cautious end of the interval clears it" };
}

export function evaluateGates(t: Thresholds, bundle: MetricBundle): GateResult[] {
  const out: GateResult[] = [];
  for (const g of t.gates) {
    if (g.scope === "overall") {
      out.push(judge(g, null, bundle.overall[g.metric], t.minimum_heldout_groups));
      continue;
    }
    const subs: Record<string, MetricSet> = bundle.subgroups[g.scope] ?? {};
    const names = Object.keys(subs);
    if (!names.length) out.push(judge(g, "(no subgroup present)", undefined, t.minimum_subgroup_groups));
    for (const s of names) out.push(judge(g, s, subs[s][g.metric], t.minimum_subgroup_groups));
  }
  return out;
}

export type RunOutcome = "NOT_MET" | "INCONCLUSIVE" | "MET";

/** No averaging: the run takes the worst result of any gate, and preconditions can only make it worse. */
export function runOutcome(results: GateResult[], blockers: string[] = []): RunOutcome {
  if (results.some((r) => r.outcome === "FAIL")) return "NOT_MET";
  if (blockers.length || !results.length || results.some((r) => r.outcome === "INCONCLUSIVE")) return "INCONCLUSIVE";
  return "MET";
}
