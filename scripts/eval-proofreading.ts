// Precision and recall of the local proofreader on a labelled set (OP-007).
//
//   npm run --silent eval:proofreading                 the held-out set, readable summary
//   npm run --silent eval:proofreading -- --json       the same as JSON
//   npm run --silent eval:proofreading -- <file>       another file in the same format
//
// Labels are inline: [[wrong text|category|correct text]]. Everything unmarked is asserted correct. The
// held-out set was written by an AI agent working blind to the engine and its word lists. No human has
// reviewed it, so these figures don't meet the register's human gate, however good they look.
import { readFileSync } from "node:fs";
import { normaliseText } from "@/lib/analysis/fingerprint";
import { localProvider } from "@/lib/analysis/proofreading/local";
import { runProofreading } from "@/lib/analysis/proofreading/run";

export interface Label {
  start: number;
  end: number;
  wrong: string;
  category: string;
  correct: string;
}

const MARK = /\[\[([^|\]]*)\|([^|\]]*)\|([^\]]*)\]\]/g;

/** Strips the markup and records where each label ends up in the text the engine will see. */
export function parseMarkup(raw: string): { text: string; labels: Label[] } {
  const marked = normaliseText(raw);
  const labels: Label[] = [];
  let text = "";
  let at = 0;
  for (const m of marked.matchAll(MARK)) {
    text += marked.slice(at, m.index);
    labels.push({ start: text.length, end: text.length + m[1].length, wrong: m[1], category: m[2], correct: m[3] });
    text += m[1];
    at = m.index + m[0].length;
  }
  return { text: text + marked.slice(at), labels };
}

export interface Tally {
  flagged: number;
  truePositives: number;
  falsePositives: number;
  labelled: number;
  missed: number;
  precision: number | null;
  recall: number | null;
}

const ratio = (a: number, b: number) => (b ? a / b : null);

/** 95% Wilson interval, so a small sample can't pass itself off as a precise figure. */
export function wilson(hits: number, n: number): [number, number] | null {
  if (!n) return null;
  const z = 1.96;
  const p = hits / n;
  const d = 1 + (z * z) / n;
  const mid = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(mid - spread) / d, (mid + spread) / d];
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

export async function evaluate(docs: { id: string; text: string }[]) {
  const flags: { doc: string; category: string; quote: string; start: number; end: number; suggestions: string[]; label: Label | null }[] = [];
  const allLabels: { doc: string; label: Label; caughtAs: string | null }[] = [];
  const unavailable: string[] = [];
  let wordsChecked = 0;
  let wordsSkipped = 0;
  let words = 0;
  for (const d of docs) {
    const { text, labels } = parseMarkup(d.text);
    if (normaliseText(text) !== text) throw new Error(`${d.id}: stripped text isn't normalised, so offsets wouldn't line up`);
    words += text.split(/\s+/).filter(Boolean).length;
    const p = await runProofreading(text, { provider: localProvider, language: "en-GB", timeoutMs: 30000 });
    if (p.status !== "complete") unavailable.push(`${d.id}:${p.status}`);
    wordsChecked += p.stats.wordsChecked;
    wordsSkipped += p.stats.wordsSkipped;
    const docFlags = p.findings.flatMap((f) => f.evidence.map((e) => ({ doc: d.id, category: f.category, quote: e.quote, start: e.range!.start, end: e.range!.end, suggestions: f.suggestions })));
    for (const f of docFlags) flags.push({ ...f, label: labels.find((l) => overlaps(l, f)) ?? null });
    for (const label of labels) allLabels.push({ doc: d.id, label, caughtAs: docFlags.find((f) => overlaps(label, f))?.category ?? null });
  }

  const tally = (category: string, labelCats: string[]): Tally => {
    const mine = flags.filter((f) => f.category === category);
    const tp = mine.filter((f) => f.label && labelCats.includes(f.label.category)).length;
    const labelled = allLabels.filter((l) => labelCats.includes(l.label.category));
    const caught = labelled.filter((l) => l.caughtAs === category).length;
    return { flagged: mine.length, truePositives: tp, falsePositives: mine.length - tp, labelled: labelled.length, missed: labelled.length - caught, precision: ratio(tp, mine.length), recall: ratio(caught, labelled.length) };
  };
  const spellingFlags = flags.filter((f) => f.category === "spelling" && f.label?.category === "spelling");
  const lower = (s: string) => s.toLowerCase();
  const top1 = spellingFlags.filter((f) => f.suggestions[0] && lower(f.suggestions[0]) === lower(f.label!.correct)).length;
  const top3 = spellingFlags.filter((f) => f.suggestions.some((s) => lower(s) === lower(f.label!.correct))).length;

  const nonWord = tally("spelling", ["spelling"]);
  return {
    sample: { docs: docs.length, words, wordsChecked, wordsSkipped, labels: Object.fromEntries(["spelling", "spelling-realword", "regional", "punctuation", "grammar"].map((c) => [c, allLabels.filter((l) => l.label.category === c).length])) },
    unavailable,
    spellingNonWord: { ...nonWord, recallCi95: wilson(nonWord.flagged - nonWord.falsePositives, nonWord.labelled), precisionCi95: wilson(nonWord.truePositives, nonWord.flagged) },
    spellingIncludingRealWord: tally("spelling", ["spelling", "spelling-realword"]),
    regional: tally("regional", ["regional"]),
    punctuation: tally("punctuation", ["punctuation"]),
    grammar: { labelled: allLabels.filter((l) => l.label.category === "grammar").length, note: "Not assessed by this engine, so it can't be scored." },
    /** The rule that must hold: a regional spelling is never reported as a misspelling. */
    regionalReportedAsSpelling: flags.filter((f) => f.category === "spelling" && f.label?.category === "regional").map((f) => f.quote),
    suggestions: { outOf: spellingFlags.length, top1, top3 },
    falsePositives: flags.filter((f) => !f.label).map((f) => `${f.doc}: ${f.category}: ${f.quote}`),
    crossCategory: flags.filter((f) => f.label && !(f.category === f.label.category || (f.category === "spelling" && f.label.category === "spelling-realword"))).map((f) => `${f.doc}: flagged ${f.category}, labelled ${f.label!.category}: ${f.quote}`),
    missed: allLabels.filter((l) => !l.caughtAs && l.label.category !== "grammar").map((l) => `${l.doc}: ${l.label.category}: ${l.label.wrong}`),
  };
}

async function main(argv: string[]) {
  const file = argv.find((a) => !a.startsWith("--")) ?? "tests/fixtures/proofreading/heldout.json";
  const { docs } = JSON.parse(readFileSync(file, "utf8")) as { docs: { id: string; text: string }[] };
  const r = await evaluate(docs);
  if (argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
    return;
  }
  const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);
  const row = (name: string, t: Tally) => `${name}: precision ${pct(t.precision)} (${t.truePositives}/${t.flagged}), recall ${pct(t.recall)} (${t.labelled - t.missed}/${t.labelled})`;
  process.stdout.write(
    [
      `Sample: ${r.sample.docs} synthetic CVs, ${r.sample.words} words, labels ${JSON.stringify(r.sample.labels)}. AI-written labels: NOT independently reviewed.`,
      row("Spelling, non-word errors", r.spellingNonWord),
      row("Spelling, including real-word errors", r.spellingIncludingRealWord),
      row("Regional preference", r.regional),
      row("Punctuation (three patterns)", r.punctuation),
      `Grammar: ${r.grammar.labelled} labelled, not assessed.`,
      `Regional words reported as misspellings: ${r.regionalReportedAsSpelling.length}`,
      "",
    ].join("\n"),
  );
}

if (process.argv[1] && /eval-proofreading\.ts$/.test(process.argv[1])) void main(process.argv.slice(2));
