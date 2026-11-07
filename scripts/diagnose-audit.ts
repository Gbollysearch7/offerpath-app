// Runs the two product failures reproduced in the November 2026 audit against the real analysis
// engine and reports what it actually does, next to the behaviour we want (OP-001).
//
//   npm run diagnose:audit                 observe: print the findings, exit 0
//   npm run --silent diagnose:audit -- --json  observe: machine-readable findings, exit 0
//   npm run diagnose:audit -- --check      gate: exit 1 while any desired gate is unmet
//   npm run diagnose:audit -- --check --json
//
// This script calls `analyseCv`, `findCheck`, `extractRequirements`, `matchRequirements` and the local
// proofreader directly. It contains no copy of their logic, so it cannot drift into agreeing with itself.
// It also contains no fix for these particular words. If a gate is unmet, that failure is the output,
// not a bug in the script.
import { analyseCv, findCheck } from "@/lib/analysis/cv";
import { matchRequirements } from "@/lib/analysis/job-match";
import { extractRequirements } from "@/lib/analysis/job-requirements";
import { LIKELY_MISSPELLING, localProvider } from "@/lib/analysis/proofreading/local";
import { runProofreading } from "@/lib/analysis/proofreading/run";
import { RUBRIC_VERSION } from "@/lib/analysis/rubric";
import type { ProofreadingReport, RequirementCategory } from "@/lib/types";
import {
  AUDIT_ADVERT,
  AUDIT_ADVERT_DESIRABLE,
  AUDIT_ADVERT_ESSENTIAL,
  AUDIT_CLEAN_CV,
  AUDIT_CV_EVIDENCE,
  AUDIT_MISSPELLED_CV,
  AUDIT_MISSPELLED_WORDS,
  AUDIT_SECTOR,
} from "../tests/fixtures/audit";

/** One thing we want to be true. `met` is measured from the observations, never asserted by hand. */
export interface Gate {
  /** Stable name, so a report can say which gate moved. */
  id: string;
  desired: string;
  observed: string;
  met: boolean;
  /** The task that is meant to make this gate pass. */
  followUp: string;
}

export interface SpellingObservations {
  cleanScore: number;
  misspelledScore: number;
  /** Core CV score. Equal scores mean the misspellings changed nothing. */
  cleanCvScore: number;
  misspelledCvScore: number;
  spellCheck: { name: string; score: number; summary: string; detail: string; stat: string; extras: string[] };
  consistencyCheck: { name: string; score: number; summary: string; detail: string; stat: string };
  /** Audit misspellings reported as spelling findings by the proofreader, with evidence in the source text. */
  wordsSurfaced: string[];
  wordsMissed: string[];
  /** How each proofreading run ended. "unavailable" can't meet a gate. */
  proofreadingStatus: { clean: ProofreadingReport["status"]; misspelled: ProofreadingReport["status"] };
  /** Words the proofreader reported as spelling mistakes in the clean CV. Should be none. */
  cleanWordsFlagged: string[];
  /** Strengths the misspelled CV is still credited with. */
  wells: string[];
}

export interface MatchingObservations {
  advert: string;
  cvEvidence: string;
  requirements: { term: string; occurrencesInAdvert: number; classifiedEssential: boolean; foundInCv: boolean }[];
  /** Advert terms the extractor never produced at all. */
  essentialTermsNotExtracted: string[];
  excelClassification: RequirementCategory | "not extracted";
  matchScore: { now: number; withAdded: number; tailored: number };
  /** Essential requirements shown to the student as having no CV evidence. */
  essentialGapsShown: string[];
  /** Score an advert's requirements get before any evidence is matched. */
  scoreWithNoEvidence: number;
}

export interface AuditDiagnostic {
  rubric: string;
  /** Rules mode only: the diagnostic must not spend money on model calls or depend on a provider. */
  method: "rules";
  spelling: SpellingObservations;
  matching: MatchingObservations;
  gates: Gate[];
}

/**
 * Adapter for the proofreading contract: a word counts only as a spelling finding whose evidence quotes it
 * at a recorded position. Echoing it in an explanation or a suggestion doesn't count, and neither does a
 * regional preference or an unrecognised word, neither of which claims a word is misspelled.
 */
export function reportedSpellingWords(p: ProofreadingReport): string[] {
  const quoted = p.findings.filter((f) => f.category === "spelling" && f.rule === LIKELY_MISSPELLING).flatMap((f) => f.evidence.filter((e) => e.range).map((e) => e.quote.toLowerCase()));
  return AUDIT_MISSPELLED_WORDS.filter((word) => quoted.includes(word));
}

// Always the local provider, whatever the environment says: the diagnostic must never send text anywhere.
const proofread = (text: string) => runProofreading(text, { provider: localProvider, language: "en-GB", timeoutMs: 30000 });

async function observeSpelling(): Promise<SpellingObservations> {
  const clean = analyseCv(AUDIT_CLEAN_CV, AUDIT_SECTOR);
  const bad = analyseCv(AUDIT_MISSPELLED_CV, AUDIT_SECTOR);
  const spell = findCheck(bad, "spell")!;
  const grammar = findCheck(bad, "grammar")!;
  const [cleanProof, badProof] = await Promise.all([proofread(AUDIT_CLEAN_CV), proofread(AUDIT_MISSPELLED_CV)]);
  const wordsSurfaced = reportedSpellingWords(badProof);
  return {
    cleanScore: findCheck(clean, "spell")!.score,
    misspelledScore: spell.score,
    cleanCvScore: clean.score,
    misspelledCvScore: bad.score,
    spellCheck: { name: spell.name, score: spell.score, summary: spell.summary, detail: spell.detail, stat: `${spell.stat.value} ${spell.stat.label}`, extras: spell.extras ?? [] },
    consistencyCheck: { name: grammar.name, score: grammar.score, summary: grammar.summary, detail: grammar.detail, stat: `${grammar.stat.value} ${grammar.stat.label}` },
    wordsSurfaced,
    wordsMissed: AUDIT_MISSPELLED_WORDS.filter((w) => !wordsSurfaced.includes(w)),
    proofreadingStatus: { clean: cleanProof.status, misspelled: badProof.status },
    cleanWordsFlagged: cleanProof.findings.filter((f) => f.category === "spelling").flatMap((f) => f.evidence.map((e) => e.quote)),
    wells: bad.wells.map((w) => `${w.area}: ${w.text}`),
  };
}

/** Adapter for the job-requirement contract (OP-012/013). A percentage withheld for a vague advert reads as -1, which meets no gate. */
function observeMatching(): MatchingObservations {
  const assess = (cv: string) => matchRequirements({ jobText: AUDIT_ADVERT, cvText: cv, extraction: extractRequirements(AUDIT_ADVERT) });
  const match = assess(AUDIT_CV_EVIDENCE);
  const hasTerm = (t: string) => match.requirements.some((r) => r.terms.some((x) => x.toLowerCase() === t.toLowerCase()));
  const excel = match.requirements.find((r) => r.terms.some((x) => x.toLowerCase() === "excel"));
  // A CV with none of the advert's terms, to see what the score floor is before any evidence exists.
  const noEvidence = assess("No relevant experience is described in this document.");
  const now = match.coverage.score ?? -1;
  return {
    advert: AUDIT_ADVERT,
    cvEvidence: AUDIT_CV_EVIDENCE,
    requirements: match.requirements.map((r) => ({ term: r.label, occurrencesInAdvert: r.occurrences, classifiedEssential: r.category === "essential", foundInCv: r.evidence.level === "explicit" || r.evidence.level === "weak" })),
    essentialTermsNotExtracted: AUDIT_ADVERT_ESSENTIAL.filter((t) => !hasTerm(t)),
    excelClassification: excel?.category ?? "not extracted",
    // Nothing is estimated any more: every figure is the coverage of this CV, until a revised document is measured.
    matchScore: { now, withAdded: now, tailored: now },
    essentialGapsShown: match.essentialGaps,
    scoreWithNoEvidence: noEvidence.coverage.score ?? -1,
  };
}

/** Turns observations into gates. Each gate is measured, so implementing a fix flips it without edits here. */
export function evaluateGates(s: SpellingObservations, m: MatchingObservations): Gate[] {
  const claimsCorrect = /spelling throughout|no spelling (mistakes|errors)|correctly spelled|no issues\b|no grammar issues/i;
  const spellText = `${s.spellCheck.summary} ${s.spellCheck.detail}`;
  const consistencyText = `${s.consistencyCheck.summary} ${s.consistencyCheck.detail}`;
  const namesItsCoverage = /variant/i.test(spellText) && /(not|other|isn't|aren't|does not|doesn't)/i.test(spellText);
  const namesConsistencyCoverage = ["repeated word", "lowercase", "ending"].every((t) => consistencyText.toLowerCase().includes(t));

  return [
    {
      id: "proofreading.detects-audit-misspellings",
      desired: `All ${AUDIT_MISSPELLED_WORDS.length} introduced misspellings are reported to the student (${AUDIT_MISSPELLED_WORDS.join(", ")})`,
      observed: `${s.wordsSurfaced.length} of ${AUDIT_MISSPELLED_WORDS.length} reported by the proofreader (run ${s.proofreadingStatus.misspelled})${s.wordsMissed.length ? `; missed ${s.wordsMissed.join(", ")}` : ""}. The separate variant-list check still scores ${s.misspelledScore}/10 on the misspelled CV and ${s.cleanScore}/10 on the clean one`,
      met: s.wordsMissed.length === 0 && s.proofreadingStatus.misspelled === "complete",
      followUp: "OP-007",
    },
    {
      id: "proofreading.clean-source-not-flagged",
      desired: "The clean CV the misspellings were introduced into gets no spelling findings from a run that actually finished",
      observed: `${s.cleanWordsFlagged.length} spelling findings on the clean CV${s.cleanWordsFlagged.length ? ` (${s.cleanWordsFlagged.join(", ")})` : ""}; run ${s.proofreadingStatus.clean}`,
      met: s.cleanWordsFlagged.length === 0 && s.proofreadingStatus.clean === "complete",
      followUp: "OP-007",
    },
    {
      id: "proofreading.spelling-message-states-its-coverage",
      desired: "The spelling message never claims the CV is correctly spelled, and says it only compares against a list of regional variants",
      observed: `${s.spellCheck.name}: "${s.spellCheck.summary}" — "${s.spellCheck.detail}"`,
      met: !claimsCorrect.test(spellText) && namesItsCoverage,
      followUp: "OP-002",
    },
    {
      id: "proofreading.consistency-message-states-its-coverage",
      desired: "The writing-consistency message never claims there are no grammar issues, and names the three things it checks",
      observed: `${s.consistencyCheck.name}: "${s.consistencyCheck.summary}" — "${s.consistencyCheck.detail}"`,
      met: !claimsCorrect.test(consistencyText) && namesConsistencyCoverage,
      followUp: "OP-002",
    },
    {
      id: "matching.essential-requirements-extracted",
      desired: `The advert's mandatory technologies are extracted: ${AUDIT_ADVERT_ESSENTIAL.join(", ")}`,
      observed: m.essentialTermsNotExtracted.length ? `Not extracted at all: ${m.essentialTermsNotExtracted.join(", ")}. Extracted instead: ${m.requirements.map((r) => r.term).join(", ") || "nothing"}` : "All extracted",
      met: m.essentialTermsNotExtracted.length === 0,
      followUp: "OP-012",
    },
    {
      id: "matching.essential-requirements-classified-essential",
      desired: `${AUDIT_ADVERT_ESSENTIAL.join(" and ")} are classified essential because the advert says "must have"`,
      observed: AUDIT_ADVERT_ESSENTIAL.map((t) => {
        const requirement = m.requirements.find((r) => r.term.toLowerCase() === t.toLowerCase());
        return `${t}: ${!requirement ? "absent" : requirement.classifiedEssential ? "essential" : "not essential"}`;
      }).join(", "),
      met: AUDIT_ADVERT_ESSENTIAL.every((t) => m.requirements.some((r) => r.term.toLowerCase() === t.toLowerCase() && r.classifiedEssential)),
      followUp: "OP-012",
    },
    {
      id: "matching.repeated-desirable-stays-desirable",
      desired: `${AUDIT_ADVERT_DESIRABLE.join(", ")} stays desirable even though the advert mentions it twice`,
      observed: `Excel appears ${m.requirements.find((r) => r.term.toLowerCase() === "excel")?.occurrencesInAdvert ?? 0} times and is classified ${m.excelClassification}`,
      met: m.excelClassification === "desirable",
      followUp: "OP-012",
    },
    {
      id: "matching.essential-evidence-gaps-visible",
      desired: `An Excel-only CV shows ${AUDIT_ADVERT_ESSENTIAL.join(" and ")} as essential requirements with no evidence`,
      observed: `Essential gaps shown: ${m.essentialGapsShown.join(", ") || "none"}. Match score ${m.matchScore.now}/100`,
      met: AUDIT_ADVERT_ESSENTIAL.every((t) => m.essentialGapsShown.some((g) => g.toLowerCase() === t.toLowerCase())),
      followUp: "OP-013",
    },
    {
      id: "matching.no-unconditional-baseline",
      desired: "A CV with no evidence for any requirement does not receive a fixed starting score",
      observed: `A CV with none of the advert's terms scores ${m.scoreWithNoEvidence}/100`,
      met: m.scoreWithNoEvidence === 0,
      followUp: "OP-013",
    },
  ];
}

export async function runAuditDiagnostic(): Promise<AuditDiagnostic> {
  const spelling = await observeSpelling();
  const matching = observeMatching();
  return { rubric: RUBRIC_VERSION, method: "rules", spelling, matching, gates: evaluateGates(spelling, matching) };
}

export type Mode = "observe" | "check";

/** Observing is data collection and succeeds. Checking is a gate and fails while any gate is unmet. */
export function exitCode(gates: Gate[], mode: Mode): number {
  return mode === "check" && gates.some((g) => !g.met) ? 1 : 0;
}

export function report(d: AuditDiagnostic, mode: Mode): string {
  const unmet = d.gates.filter((g) => !g.met);
  const out: string[] = [
    "Offerpath audit diagnostic (OP-001)",
    `Rubric ${d.rubric} · judged by ${d.method} · synthetic fixtures only`,
    "",
    "1. SPELLING AND WRITING CONSISTENCY",
    `   Clean CV scores ${d.spelling.cleanCvScore}/100, the same CV with ${AUDIT_MISSPELLED_WORDS.length} misspellings scores ${d.spelling.misspelledCvScore}/100.`,
    `   ${d.spelling.spellCheck.name}: ${d.spelling.spellCheck.score}/10 — ${d.spelling.spellCheck.summary}`,
    `      ${d.spelling.spellCheck.detail}`,
    `   ${d.spelling.consistencyCheck.name}: ${d.spelling.consistencyCheck.score}/10 — ${d.spelling.consistencyCheck.summary}`,
    `      ${d.spelling.consistencyCheck.detail}`,
    `   Proofreader (reported apart from the score): misspelled run ${d.spelling.proofreadingStatus.misspelled}, clean run ${d.spelling.proofreadingStatus.clean}, ${d.spelling.cleanWordsFlagged.length} spelling findings on the clean CV`,
    `   Misspellings reported to the student: ${d.spelling.wordsSurfaced.join(", ") || "none"}`,
    `   Misspellings missed: ${d.spelling.wordsMissed.join(", ") || "none"}`,
    "",
    "2. JOB REQUIREMENTS AND EVIDENCE MATCHING",
    `   Advert: ${d.matching.advert}`,
    `   CV evidence: ${d.matching.cvEvidence}`,
    ...d.matching.requirements.map((r) => `   - ${r.term}: ${r.occurrencesInAdvert}x in advert, ${r.classifiedEssential ? "essential" : "not essential"}, ${r.foundInCv ? "found in CV" : "not in CV"}`),
    `   Never extracted: ${d.matching.essentialTermsNotExtracted.join(", ") || "none"}`,
    `   Match score: ${d.matching.matchScore.now}/100 now, ${d.matching.matchScore.tailored}/100 tailored`,
    `   Score with no evidence at all: ${d.matching.scoreWithNoEvidence}/100`,
    "",
    `GATES: ${d.gates.length - unmet.length} met, ${unmet.length} unmet`,
    ...d.gates.map((g) => [`   [${g.met ? "met" : "UNMET"}] ${g.id}`, `      want: ${g.desired}`, `      got:  ${g.observed}`, ...(g.met ? [] : [`      fix in: ${g.followUp}`])].join("\n")),
    "",
  ];
  if (unmet.length) {
    out.push(
      `${unmet.length} desired gates are still unmet. This is the current state of the product, not a script error.`,
      `Open work: ${[...new Set(unmet.map((g) => g.followUp))].join("; ")}.`,
      mode === "check" ? "Exiting 1 because --check treats unmet gates as a failure." : "Exiting 0 because observation mode only collects data. Use --check to gate on these.",
    );
  } else {
    out.push("All desired gates are met.");
  }
  return out.join("\n");
}

async function main(argv: string[]): Promise<number> {
  const mode: Mode = argv.includes("--check") ? "check" : "observe";
  const d = await runAuditDiagnostic();
  process.stdout.write(argv.includes("--json") ? `${JSON.stringify(d, null, 2)}\n` : `${report(d, mode)}\n`);
  return exitCode(d.gates, mode);
}

// Only when run as a script, so tests can import the pieces above without executing anything.
if (process.argv[1] && /diagnose-audit\.ts$/.test(process.argv[1])) void main(process.argv.slice(2)).then((code) => (process.exitCode = code));
