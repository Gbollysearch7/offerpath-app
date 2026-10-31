// Compares Offerpath's Readiness Scores with careers advisers' marks for the same CVs.
//
//   npm run calibrate -- --dir calibration            (CVs + calibration/adviser_scores.csv)
//   npm run calibrate -- --dir calibration --ai       (score with Claude Haiku instead of rules)
//   npm run calibrate -- --demo                       (built-in sample, to see the output)
//
// adviser_scores.csv: file,score  (score 0-100; average several advisers' marks if you have them).
// Use at least 30 CVs, marked by advisers who haven't seen Offerpath's score.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { aiJudgeBullets } from "@/lib/ai";
import { analyseCv } from "@/lib/analysis/cv";
import { extractText } from "@/lib/analysis/extract";
import { AI_JUDGE_MODEL } from "@/lib/analysis/judgment";
import { AREA_WEIGHTS, BANDS, RUBRIC_VERSION } from "@/lib/analysis/rubric";
import { parseCsv } from "@/lib/csv";
import { memoryStore, scoreCvWith } from "@/lib/scoring-core";
import { DEMO_CVS } from "@/lib/seed-data";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => args[args.indexOf(`--${name}`) + 1];
const SECTOR = opt("sector") ?? "Finance and banking";

function pearson(x: number[], y: number[]) {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}
const ranks = (v: number[]) => {
  const sorted = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array(v.length);
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1][0] === sorted[i][0]) j++;
    for (let k = i; k <= j; k++) r[sorted[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r as number[];
};
const band = (s: number) => BANDS.find((b) => s >= b.min)!.label;

async function load(): Promise<{ name: string; text: string; adviser: number }[]> {
  if (flag("demo")) {
    // Illustrative marks only, so the report can be seen without real data.
    const marks = [48, 57, 69, 80];
    return DEMO_CVS.map((c, i) => ({ name: c.fileName, text: c.text, adviser: marks[i] }));
  }
  const dir = opt("dir") ?? "calibration";
  const csvPath = join(dir, "adviser_scores.csv");
  if (!existsSync(csvPath)) throw new Error(`Missing ${csvPath} (columns: file,score)`);
  const [header, ...rows] = parseCsv(readFileSync(csvPath, "utf8"));
  const fi = header.findIndex((h) => /file/i.test(h));
  const si = header.findIndex((h) => /score|mark/i.test(h));
  const files = new Set(readdirSync(dir));
  const out = [];
  for (const r of rows) {
    const name = r[fi]?.trim();
    const adviser = Number(r[si]);
    if (!name || !files.has(name) || !Number.isFinite(adviser)) {
      console.warn(`skipping row: ${r.join(",")}`);
      continue;
    }
    out.push({ name, text: await extractText(new Uint8Array(readFileSync(join(dir, name))), name), adviser });
  }
  return out;
}

(async () => {
  const items = await load();
  if (items.length < 3) throw new Error("Need at least 3 scored CVs (30+ recommended).");
  const store = memoryStore();
  const results = [];
  for (const it of items) {
    const a = flag("ai")
      ? (await scoreCvWith(it.text, SECTOR, { method: "ai", store, judgeName: AI_JUDGE_MODEL, judge: async (b, s) => { const v = await aiJudgeBullets(b, s, 3); return new Map([...v].map(([id, js]) => [id, js.map(({ result, verb, kind, relevance }) => ({ result, verb, kind, relevance }))])); } })).analysis
      : analyseCv(it.text, SECTOR);
    results.push({ ...it, ours: a.score, areas: Object.fromEntries(a.areas.map((x) => [x.key, x.score])) as Record<string, number> });
  }
  const ours = results.map((r) => r.ours);
  const adv = results.map((r) => r.adviser);
  const mae = results.reduce((s, r) => s + Math.abs(r.ours - r.adviser), 0) / results.length;
  const bias = results.reduce((s, r) => s + (r.ours - r.adviser), 0) / results.length;
  const bandAgree = results.filter((r) => band(r.ours) === band(r.adviser)).length / results.length;

  console.log(`\nCalibration · ${results.length} CVs · ${RUBRIC_VERSION} · ${flag("ai") ? AI_JUDGE_MODEL : "rule engine"} · sector ${SECTOR}\n`);
  console.table(results.map((r) => ({ file: r.name, adviser: r.adviser, offerpath: r.ours, diff: r.ours - r.adviser })));
  console.log(`Pearson correlation   ${pearson(ours, adv).toFixed(2)}   (0.7+ is good agreement)`);
  console.log(`Spearman (rank) corr  ${pearson(ranks(ours), ranks(adv)).toFixed(2)}   (do we put CVs in the same order?)`);
  console.log(`Mean absolute diff    ${mae.toFixed(1)} points`);
  console.log(`Average bias          ${bias >= 0 ? "+" : ""}${bias.toFixed(1)} points (${bias > 0 ? "we score higher than advisers" : "we score lower than advisers"})`);
  console.log(`Same band             ${(bandAgree * 100).toFixed(0)}% of CVs\n`);
  console.log("How each area tracks the advisers' marks (higher = area agrees with advisers):");
  for (const key of Object.keys(AREA_WEIGHTS)) {
    const r = pearson(results.map((x) => x.areas[key]), adv);
    console.log(`  ${key.padEnd(10)} weight ${String(AREA_WEIGHTS[key as keyof typeof AREA_WEIGHTS]).padEnd(5)} correlation ${r.toFixed(2)}`);
  }
  console.log("\nTo adjust: edit src/lib/analysis/rubric.ts (raise weights of areas that agree, lower those that don't), bump RUBRIC_VERSION, and run this again.");
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
