import type { GateResult } from "./gates";
import type { Metric, MetricSet } from "./metrics";
import { DISAGREEMENT_FLAG_POINTS } from "./metrics";
import { ILLUSTRATIVE_BANNER, SYNTHETIC_BANNER } from "./evidence";
import type { Report } from "./run";

// Turns a report into words. The evidence label sits on the first line, the last line, every gate row and every metric
// row, so a pasted table or a cropped screenshot still says what it is.

const num = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : String(v));
const interval = (ci: [number, number] | null) => (ci ? `${ci[0]} to ${ci[1]}` : "none");

const SECTIONS: [string, RegExp][] = [
  ["Score error and ranking", /^(score|rank|band|area|coverage)\./],
  ["Agreement between advisers", /^reviewers\./],
  ["Findings: false positives, severity and missed issues", /^(findings|severity)\./],
  ["Do recommendations improve adviser marks?", /^improvement\./],
  ["Gaming: adversarial variants against their originals", /^gaming\./],
  ["Rewrites: factual fidelity and usefulness", /^rewrite\./],
];

const metricRow = (name: string, m: Metric, label: string) => `| ${name} | ${num(m.value)} | ${interval(m.ci)} | ${m.n} | ${m.n_groups} | ${m.note ?? ""} | ${label} |`;
const METRIC_HEAD = ["| Metric | Value | 95% interval | Items | Independent groups | Note | Data |", "|---|---|---|---|---|---|---|"];

function metricTables(metrics: MetricSet, label: string): string[] {
  const out: string[] = [];
  for (const [title, re] of SECTIONS) {
    const names = Object.keys(metrics).filter((n) => re.test(n));
    if (!names.length) continue;
    out.push(`### ${title}`, "", ...METRIC_HEAD, ...names.map((n) => metricRow(n, metrics[n], label)), "");
  }
  return out;
}

const gateRow = (g: GateResult, label: string) => `| ${g.outcome} | ${g.metric} | ${g.subgroup ?? "overall"} | ${g.direction} ${g.threshold} | ${num(g.value)} | ${interval(g.ci)} | ${g.n_groups} | ${g.reason} | ${label} |`;

function outcomeSentence(r: Report): string {
  const failed = r.gates.filter((g) => g.outcome === "FAIL").length;
  const unsure = r.gates.filter((g) => g.outcome === "INCONCLUSIVE").length;
  const counts = `${failed} failed, ${unsure} inconclusive, ${r.gates.length - failed - unsure} passed, of ${r.gates.length} checks.`;
  if (r.outcome === "NOT_ASSESSED") return "No thresholds were tested. This run is for development only.";
  if (r.outcome === "NOT_MET") return `Thresholds NOT MET. ${counts} One failed gate fails the run, and no average can offset it.`;
  if (r.outcome === "INCONCLUSIVE") return `INCONCLUSIVE. ${counts} This is not a pass.`;
  return `Thresholds met on this dataset only. ${counts} This does not prove accuracy in general.`;
}

export function renderReport(r: Report): string {
  const label = r.dataset.kind === "synthetic" ? "SYNTHETIC" : r.split === "development" ? "DEVELOPMENT" : "HELD-OUT";
  const notice = [
    r.dataset.kind === "synthetic" ? "Every mark and review in this dataset is invented, to prove the tool works. No figure below says anything about Offerpath's accuracy." : "",
    r.split === "development" ? "This is development data. It may be used for tuning and is never evidence of accuracy." : "",
    r.dataset.kind === "real" && r.split === "heldout" ? "Advisers' judgments measured on untouched data. It counts only once the founder and pilot partner accept it, with its limitations." : "",
    r.look === "repeat" ? "This is an exact repeat of the first look at held-out data, not a new test." : "",
  ].filter(Boolean);
  const lines: string[] = [
    `# ${r.evidence_status}`,
    "",
    `Offerpath calibration report: ${r.dataset.name} version ${r.dataset.version}, ${r.split} split.`,
    "",
    ...notice.map((n) => `> ${n}`),
    "",
    "## Outcome",
    "",
    outcomeSentence(r),
    "",
    ...r.blockers.map((b) => `- Blocker: ${b}`),
    ...(r.blockers.length ? [""] : []),
    "## Human gates",
    "",
    ...r.human_gates.map((g) => `- ${g}`),
    "",
    "## Sample",
    "",
    `- Documents: ${r.sample.documents}. Independent CV groups: ${r.sample.independent_groups}. Variants are not independent, so read certainty from the group count.`,
    `- Reviewers: ${r.sample.reviewers}. Adviser marks: ${r.sample.adviser_marks}. Documents where advisers are ${DISAGREEMENT_FLAG_POINTS}+ points apart: ${r.sample.disagreement_flags}.`,
    `- Findings raised: ${r.sample.findings_raised}. Reviews of findings this engine doesn't raise: ${r.sample.stale_finding_reviews}. Rewrites: ${r.sample.rewrite_items}.`,
    `- Scores withheld: ${r.sample.withheld_scores} (left out of error figures, and counted in coverage). Marked incomplete: ${r.sample.incomplete_scores}.`,
    `- Variants: ${Object.entries(r.sample.by_variant).map(([k, v]) => `${k} ${v}`).join(", ")}.`,
    `- Disciplines: ${Object.entries(r.sample.by_discipline).map(([k, v]) => `${k} ${v}`).join(", ")}.`,
    `- Withdrawn groups: ${r.sample.withdrawn_groups}.`,
    "",
    "## Versions",
    "",
    `- Engine: \`${r.versions.engine_identity}\``,
    `- Extractor: ${r.versions.extractor}. Coverage policy: ${r.versions.coverage_policy}. Tool: ${r.versions.tool}.`,
    `- Dataset hash: \`${r.dataset.data_hash}\``,
    `- Intervals: 95%, group-level percentile bootstrap, ${r.versions.bootstrap_iterations} resamples, widened to Wilson for proportions. Seed: \`${r.versions.bootstrap_seed}\``,
    `- Report hash: \`${r.report_hash}\``,
    "",
  ];
  if (r.freeze) {
    lines.push("## Pre-registration", "", `- Frozen ${r.freeze.frozen_at}, thresholds hash \`${r.freeze.thresholds_hash}\`. Replaced before opening: ${r.freeze.replaced_before_opening}.`, ...r.freeze.agreed_by.map((a) => `- Agreed by ${a.name} (${a.role}), ${a.date}.`), "");
    const order = { FAIL: 0, INCONCLUSIVE: 1, PASS: 2 };
    const sorted = [...r.gates].sort((a, b) => order[a.outcome] - order[b.outcome]);
    lines.push("## Gates, failures first", "", "| Result | Metric | Subgroup | Threshold | Value | 95% interval | Independent groups | Why | Data |", "|---|---|---|---|---|---|---|---|---|", ...sorted.map((g) => gateRow(g, label)), "");
  }
  lines.push("## Metrics", "", ...metricTables(r.metrics.overall, label));
  for (const [scope, subs] of Object.entries(r.metrics.subgroups)) {
    if (!Object.keys(subs).length) continue;
    lines.push(`## By ${scope.replace("each:", "").replace(/_/g, " ")}`, "");
    for (const [name, set] of Object.entries(subs)) {
      const keep = Object.keys(set).filter((k) => /^(score\.mae|rank\.spearman|coverage\.|findings\.false_positive_rate|severity\.exact|gaming\.)/.test(k));
      lines.push(`### ${name}`, "", ...METRIC_HEAD, ...keep.map((k) => metricRow(k, set[k], label)), "");
    }
  }
  lines.push("## Document by document", "", "Each adviser's own mark is kept. Disagreement is shown and is not settled by this tool.", "", "| Document | Group | Variant | Adviser marks | Range | Offerpath | Coverage | Difference from mean | Data |", "|---|---|---|---|---|---|---|---|---|");
  for (const d of r.documents) {
    lines.push(`| ${d.document} | ${d.group} | ${d.variant} | ${Object.entries(d.adviser_marks).map(([k, v]) => `${k}: ${v}`).join("; ") || "unmarked"} | ${num(d.adviser_range)}${d.disagreement_flag ? " (flagged)" : ""} | ${d.offerpath} | ${d.coverage} | ${num(d.difference)} | ${label} |`);
  }
  lines.push("", `**${r.evidence_status}**`, "");
  return lines.join("\n");
}

export interface DemoRow { id: string; mark: number; score: number; }

/** The `--demo` view. Its output has no gates, no file and no way into a dataset. */
export function renderDemo(rows: DemoRow[], identity: string): string {
  return [
    `# ${ILLUSTRATIVE_BANNER}`,
    "",
    "These marks were made up so the layout can be seen without real data. No adviser gave them. They are not calibration, and the tool refuses them as validation.",
    "The rows are four versions of one person's CV: one independent group, so no statistic is shown.",
    "",
    `Engine: \`${identity}\``,
    "",
    "| Document | Illustrative mark | Offerpath | Difference | Data |",
    "|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.id} | ${r.mark} | ${r.score} | ${r.score - r.mark} | ILLUSTRATIVE |`),
    "",
    `**${ILLUSTRATIVE_BANNER}**`,
    "",
  ].join("\n");
}

export const syntheticFooter = `${SYNTHETIC_BANNER}. Recruiting reviewers, consented examples and agreed thresholds remain open human gates.`;
