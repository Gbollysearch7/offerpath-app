import type { CvReviewPayload, ProofreadingCategory, ProofreadingFinding, ProofreadingLanguage, ProofreadingReport } from "@/lib/types";

// What the report pages say about a proofreading run. Kept apart from the page so every state has a test:
// the words below must never turn "didn't run" or "couldn't look" into anything that reads as a pass.

export const CATEGORY_LABELS: Record<ProofreadingCategory, string> = {
  spelling: "Possible spelling mistakes",
  regional: "Regional preferences",
  punctuation: "Punctuation",
  grammar: "Grammar",
};

export const UNRECOGNISED_LABEL = "Words we don't recognise";
// Written out, not imported from local.ts: this file is presentation and shouldn't pull in the dictionary engine.
const isUnrecognised = (f: ProofreadingFinding) => f.rule === "unrecognised-word";
/** Possible mistakes: what a count may call a mistake. A word we merely don't know is listed apart, and isn't one. */
export const possibleMistakes = (p: ProofreadingReport | undefined) => p?.findings.filter((f) => f.category === "spelling" && !isUnrecognised(f)) ?? [];
export const unrecognisedWords = (p: ProofreadingReport | undefined) => p?.findings.filter(isUnrecognised) ?? [];

export const CATEGORY_ORDER: ProofreadingCategory[] = ["spelling", "regional", "punctuation", "grammar"];

export const NOT_ASSESSED_OLD_REPORT = "Not assessed. This report was made before the dictionary check existed, so its spelling wasn't checked this way. That doesn't mean it passed. Upload your CV again to run it.";

/**
 * The sentence at the top of the panel. Only ever describes what was looked at, never the CV as a whole. `dismissed`
 * is how many suggestions of any kind the student has set aside: the student's decision isn't our finding, so
 * dismissing the last one can't read as a clean result.
 */
export function proofreadingHeadline(p: ProofreadingReport | undefined, dismissed = 0): string {
  if (!p) return NOT_ASSESSED_OLD_REPORT;
  if (p.status === "unavailable") return p.limits[0] ?? "Not assessed. The check didn't run.";
  const spelling = possibleMistakes(p).length;
  const none = dismissed ? "No likely typos left to look at." : "No likely typos in the text this check covers.";
  const found = spelling ? `${spelling} possible spelling ${spelling === 1 ? "mistake" : "mistakes"} to look at.` : `${none} That doesn't prove your spelling is correct.`;
  const set = dismissed ? ` You've dismissed ${dismissed} ${dismissed === 1 ? "suggestion" : "suggestions"} on this CV.` : "";
  return `${p.status === "partial" ? "Part of your CV was checked. " : ""}${found}${set}`;
}

/** Why a regional suggestion is there. A valid spelling in another English is never called wrong. */
export function regionalExplanation(language: ProofreadingLanguage): string {
  const [yours, other] = language === "en-GB" ? ["UK", "US"] : ["US", "UK"];
  return `These are valid ${other} spellings. We point them out only because you've chosen ${yours} English and an employer may expect it. Leave them as they are in a quotation, an official organisation's name or a product name, or if you're writing for an employer who uses ${other} English.`;
}

/** The line a piece of evidence sits on, split around it, so the student sees the word where they wrote it. */
export function evidenceContext(doc: string, range: { start: number; end: number }): { before: string; match: string; after: string } {
  const from = doc.lastIndexOf("\n", range.start - 1) + 1;
  const to = doc.indexOf("\n", range.end);
  return { before: doc.slice(from, range.start).replace(/^• /, ""), match: doc.slice(range.start, range.end), after: doc.slice(range.end, to === -1 ? doc.length : to) };
}

export const findingsIn = (p: ProofreadingReport | undefined, c: ProofreadingCategory): ProofreadingFinding[] => (c === "spelling" ? possibleMistakes(p) : p?.findings.filter((f) => f.category === c) ?? []);

/** For the overview: one short line, or null for a report with nothing new to say. */
export function proofreadingSummary(payload: Pick<CvReviewPayload, "proofreading">, dismissed: ReadonlySet<string> = new Set()): string {
  const p = payload.proofreading;
  if (!p || p.status === "unavailable") return "Not assessed";
  const spelling = possibleMistakes(p).filter((f) => !dismissed.has(f.id)).length;
  const set = p.findings.filter((f) => dismissed.has(f.id)).length;
  const found = spelling ? `${spelling} possible ${spelling === 1 ? "mistake" : "mistakes"}` : set ? "No likely typos left" : "No likely typos";
  return set ? `${found}, ${set} dismissed` : found;
}
