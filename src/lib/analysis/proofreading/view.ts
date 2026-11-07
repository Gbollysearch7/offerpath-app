import type { CvReviewPayload, ProofreadingCategory, ProofreadingFinding, ProofreadingReport } from "@/lib/types";

// What the report pages say about a proofreading run. Kept apart from the page so every state has a test:
// the words below must never turn "didn't run" or "couldn't look" into anything that reads as a pass.

export const CATEGORY_LABELS: Record<ProofreadingCategory, string> = {
  spelling: "Possible spelling mistakes",
  regional: "Regional preferences",
  punctuation: "Punctuation",
  grammar: "Grammar",
};

export const CATEGORY_ORDER: ProofreadingCategory[] = ["spelling", "regional", "punctuation", "grammar"];

export const NOT_ASSESSED_OLD_REPORT = "Not assessed. This report was made before the dictionary check existed, so its spelling wasn't checked this way. That doesn't mean it passed. Upload your CV again to run it.";

/** The sentence at the top of the panel. Only ever describes what was looked at, never the CV as a whole. */
export function proofreadingHeadline(p: ProofreadingReport | undefined): string {
  if (!p) return NOT_ASSESSED_OLD_REPORT;
  if (p.status === "unavailable") return p.limits[0] ?? "Not assessed. The check didn't run.";
  const n = (c: ProofreadingCategory) => p.findings.filter((f) => f.category === c).length;
  const spelling = n("spelling");
  const found = spelling ? `${spelling} possible spelling ${spelling === 1 ? "mistake" : "mistakes"} to look at.` : "No unknown words in the text this check covers. That doesn't prove your spelling is correct.";
  return p.status === "partial" ? `Part of your CV was checked. ${found}` : found;
}

/** The line a piece of evidence sits on, split around it, so the student sees the word where they wrote it. */
export function evidenceContext(doc: string, range: { start: number; end: number }): { before: string; match: string; after: string } {
  const from = doc.lastIndexOf("\n", range.start - 1) + 1;
  const to = doc.indexOf("\n", range.end);
  return { before: doc.slice(from, range.start).replace(/^• /, ""), match: doc.slice(range.start, range.end), after: doc.slice(range.end, to === -1 ? doc.length : to) };
}

export const findingsIn = (p: ProofreadingReport | undefined, c: ProofreadingCategory): ProofreadingFinding[] => p?.findings.filter((f) => f.category === c) ?? [];

/** For the overview: one short line, or null for a report with nothing new to say. */
export function proofreadingSummary(payload: Pick<CvReviewPayload, "proofreading">): string {
  const p = payload.proofreading;
  if (!p || p.status === "unavailable") return "Not assessed";
  const spelling = findingsIn(p, "spelling").length;
  return spelling ? `${spelling} possible ${spelling === 1 ? "mistake" : "mistakes"}` : "No unknown words";
}
