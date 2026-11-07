import type { CvReviewPayload, ProofreadingFinding, ProofreadingLanguage, ProofreadingReport } from "@/lib/types";

// What a student decided about proofreading on their own CV (OP-008): dismissing a suggestion, reopening it, and
// picking which English to check against. Each decision is one row in an append-only history, and the current state
// is read back from that history, so the state and its audit trail can't disagree.
//
// A dismissal belongs to one student and one document (the sha256 of the text). Nothing here reads or writes a
// score, a report's analysis, the terminology list or the dictionaries. Only the panel and the data export read it.

export type ProofreadingChoiceKind = "dismiss" | "reopen" | "language";

export interface ProofreadingChoice {
  id: string;
  /** The report the choice was made on. */
  reportId: string;
  /** Which text it applies to. The same text scored again shows the same dismissals; changed text starts afresh. */
  documentVersion: string;
  kind: ProofreadingChoiceKind;
  /** The finding, for dismiss and reopen. */
  findingId: string | null;
  /** The student's word, as a finding on our server quoted it. Never taken from the request. */
  quote: string | null;
  /** The English chosen, for a language choice. */
  language: ProofreadingLanguage | null;
  /** Who made it. Only students make these; the column exists so the history says so in every row. */
  actor: "student";
  createdAt: string;
}

/** The client names a report and a finding or language, and nothing else: everything else is read from the report. */
export type ProofreadingChoiceInput = { reportId: string; kind: "dismiss" | "reopen"; findingId: string } | { reportId: string; kind: "language"; language: ProofreadingLanguage };

/** The report isn't this student's, has no such finding, or has no proofreading to make a choice about. Nothing was saved. */
export class ChoiceNotFoundError extends Error {
  constructor() {
    super("Finding not found");
  }
}

export const MAX_FINDING_ID_CHARS = 300;
const MAX_QUOTE_CHARS = 200;

/** Both repositories build the row to save here, from the report they read with the student's own session. */
export function choiceFor(payload: Pick<CvReviewPayload, "proofreading"> | null | undefined, input: ProofreadingChoiceInput): Omit<ProofreadingChoice, "id" | "createdAt" | "actor"> {
  const proofreading = payload?.proofreading;
  if (!proofreading) throw new ChoiceNotFoundError();
  const base = { reportId: input.reportId, documentVersion: proofreading.documentVersion };
  if (input.kind === "language") return { ...base, kind: "language", findingId: null, quote: null, language: input.language };
  const finding = proofreading.findings.find((f) => f.id === input.findingId);
  if (!finding) throw new ChoiceNotFoundError();
  return { ...base, kind: input.kind, findingId: finding.id, quote: (finding.evidence[0]?.quote ?? "").slice(0, MAX_QUOTE_CHARS), language: null };
}

/** The ids dismissed on one document: for each finding, its latest dismiss or reopen. `choices` are oldest first. */
export function dismissedIds(choices: readonly ProofreadingChoice[], documentVersion: string | undefined): ReadonlySet<string> {
  const dismissed = new Set<string>();
  for (const c of choices) {
    if (c.documentVersion !== documentVersion || !c.findingId) continue;
    if (c.kind === "dismiss") dismissed.add(c.findingId);
    else if (c.kind === "reopen") dismissed.delete(c.findingId);
  }
  return dismissed;
}

/** Splits a report's findings into those still open and those the student dismissed. The saved report is left alone. */
export function splitFindings(report: ProofreadingReport, dismissed: ReadonlySet<string>): { open: ProofreadingReport; dismissed: ProofreadingFinding[] } {
  return { open: { ...report, findings: report.findings.filter((f) => !dismissed.has(f.id)) }, dismissed: report.findings.filter((f) => dismissed.has(f.id)) };
}

export const LANGUAGE_NAMES: Record<ProofreadingLanguage, string> = { "en-GB": "UK English", "en-US": "US English" };

/** One line of the student's history, in the panel. Says who did it, because the history exists to tell that apart. */
export function describeChoice(c: Pick<ProofreadingChoice, "kind" | "quote" | "language">): string {
  if (c.kind === "language") return `You chose to check this CV in ${LANGUAGE_NAMES[c.language!]}.`;
  return c.kind === "dismiss" ? `You dismissed the suggestion for "${c.quote}".` : `You reopened the suggestion for "${c.quote}".`;
}
