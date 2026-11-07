import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildClaimInventory } from "@/lib/analysis/claims";
import { checkRewrite } from "@/lib/analysis/rewrite-check";
import { parseCsv, toCsv } from "@/lib/csv";
import { FAITHFUL, INVENTIONS, KNOWN_MISSES, LINES, REWRITE_CV } from "../../tests/fixtures/rewrite-cases";
import { HELD_FAITHFUL, HELD_INVENTIONS, HELD_LINES, HELDOUT_CV } from "../../tests/fixtures/rewrite-heldout";

import { ImportError, sha } from "./dataset";
import { SYNTHETIC_BANNER } from "./evidence";
import { wilson } from "./stats";

// OP-015's fidelity fixtures were written by the author of the rules they test, so they need independent eyes. This
// sends them out with the author's labels removed and compares what reviewers say with the labels and with the check.
// The CVs are invented. What a real reviewer's answers give is a review of fixtures, not a measure of live rewrites.

const FIXTURE_BANNER = "OP-015 FIXTURE REVIEW, NOT VALIDATION OF LIVE REWRITES";

type AuthorLabel = "faithful" | "invention";

interface PackItem { id: string; cv: "cv-a.txt" | "cv-b.txt"; line: string; rewrite: string; author_label: AuthorLabel; }

function allItems(): PackItem[] {
  const a = (rows: { line: keyof typeof LINES; rewrite: string }[], label: AuthorLabel) => rows.map((r) => ({ cv: "cv-a.txt" as const, line: LINES[r.line], rewrite: r.rewrite, author_label: label }));
  const b = (rows: { line: keyof typeof HELD_LINES; rewrite: string }[], label: AuthorLabel) => rows.map((r) => ({ cv: "cv-b.txt" as const, line: HELD_LINES[r.line], rewrite: r.rewrite, author_label: label }));
  const items = [...a(FAITHFUL, "faithful"), ...a(INVENTIONS, "invention"), ...a(KNOWN_MISSES, "invention"), ...b(HELD_FAITHFUL, "faithful"), ...b(HELD_INVENTIONS, "invention")];
  // Shuffled by content hash, so labels can't be read off the order they were written in.
  return items.map((it) => ({ ...it, id: `op015-${sha(`${it.line}|${it.rewrite}`).slice(0, 10)}` })).sort((x, y) => x.id.localeCompare(y.id));
}

export const OP015_COLUMNS = ["item_id", "source_cv", "source_line", "rewrite", "reviewer_id", "factual_fidelity", "seniority", "reviewed_at", "notes"] as const;

/** Writes the blind sheet and the two CVs. The author's labels go to a separate file that reviewers must not receive. */
export function writeOp015Pack(out: string): { items: number; sheet: string; key: string } {
  mkdirSync(out, { recursive: true });
  const items = allItems();
  writeFileSync(join(out, "cv-a.txt"), REWRITE_CV);
  writeFileSync(join(out, "cv-b.txt"), HELDOUT_CV);
  const sheet = join(out, "fidelity-review-sheet.csv");
  writeFileSync(sheet, `${toCsv([[...OP015_COLUMNS], ...items.map((i) => [i.id, i.cv, i.line, i.rewrite, "", "", "", "", ""])])}\n`);
  const key = join(out, "author-labels.DO-NOT-SEND.json");
  writeFileSync(key, `${JSON.stringify({ warning: "The author's labels. Send reviewers only the sheet and the two CVs.", labels: Object.fromEntries(items.map((i) => [i.id, i.author_label])) }, null, 2)}\n`);
  return { items: items.length, sheet, key };
}

export interface Op015Comparison {
  banner: string;
  items_in_pack: number;
  items_reviewed: number;
  reviewers: string[];
  author_disagreements: { item: string; author: AuthorLabel; reviewers: string }[];
  check_missed_inventions: { count: number; of: number; ci: [number, number] | null };
  check_false_rejections: { count: number; of: number; ci: [number, number] | null };
  check_false_questions: { count: number; of: number; ci: [number, number] | null };
}

/** Reviewers decide what counts as an invention here, not the fixture's author. Any synthetic row labels the whole result. */
export function compareOp015(reviewsCsv: string): Op015Comparison {
  const [header, ...rows] = parseCsv(reviewsCsv, 100_000);
  const names = (header ?? []).map((h) => h.trim().toLowerCase());
  const missing = OP015_COLUMNS.filter((c) => !names.includes(c));
  if (missing.length) throw new ImportError([`Missing columns: ${missing.join(", ")}.`]);
  const at = (r: string[], c: string) => (r[names.indexOf(c)] ?? "").trim();
  const items = new Map(allItems().map((i) => [i.id, i]));
  const problems: string[] = [];
  const reviews = new Map<string, string[]>();
  const reviewers = new Set<string>();
  rows.forEach((r, i) => {
    if (at(r, "factual_fidelity") === "") return;
    if (!items.has(at(r, "item_id"))) problems.push(`row ${i + 2}: unknown item_id.`);
    if (!at(r, "reviewer_id")) problems.push(`row ${i + 2}: reviewer_id is required.`);
    if (!["faithful", "minor_issue", "invented"].includes(at(r, "factual_fidelity"))) problems.push(`row ${i + 2}: factual_fidelity must be faithful, minor_issue or invented.`);
    reviewers.add(at(r, "reviewer_id"));
    reviews.set(at(r, "item_id"), [...(reviews.get(at(r, "item_id")) ?? []), at(r, "factual_fidelity")]);
  });
  if (problems.length) throw new ImportError(problems);

  const inventory = { "cv-a.txt": buildClaimInventory(REWRITE_CV), "cv-b.txt": buildClaimInventory(HELDOUT_CV) };
  const verdictOf = (i: PackItem) => {
    const inv = inventory[i.cv];
    return checkRewrite(inv, { index: inv.bullets.findIndex((b) => b?.raw === i.line), text: i.line }, i.rewrite).verdict;
  };
  const author_disagreements: Op015Comparison["author_disagreements"] = [];
  let invented = 0, missed = 0, faithful = 0, rejected = 0, questioned = 0;
  for (const [id, verdicts] of reviews) {
    const item = items.get(id)!;
    const saysInvented = verdicts.filter((v) => v === "invented").length * 2 >= verdicts.length;
    const saysFaithful = verdicts.every((v) => v === "faithful");
    if ((item.author_label === "invention") !== saysInvented) author_disagreements.push({ item: id, author: item.author_label, reviewers: verdicts.join(", ") });
    const verdict = verdictOf(item);
    if (saysInvented) {
      invented++;
      if (verdict === "pass") missed++;
    }
    if (saysFaithful) {
      faithful++;
      if (verdict === "block") rejected++;
      if (verdict === "confirm") questioned++;
    }
  }
  const rate = (count: number, of: number) => ({ count, of, ci: wilson(count, of) });
  const synthetic = [...reviewers].some((r) => r.startsWith("SYNTH-"));
  return {
    banner: synthetic ? `${SYNTHETIC_BANNER}. ${FIXTURE_BANNER}` : FIXTURE_BANNER,
    items_in_pack: items.size,
    items_reviewed: reviews.size,
    reviewers: [...reviewers].sort(),
    author_disagreements,
    check_missed_inventions: rate(missed, invented),
    check_false_rejections: rate(rejected, faithful),
    check_false_questions: rate(questioned, faithful),
  };
}

export const readOp015Reviews = (path: string) => compareOp015(readFileSync(path, "utf8"));
