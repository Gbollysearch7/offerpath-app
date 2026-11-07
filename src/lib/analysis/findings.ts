import type { Assessment, CheckKey, CheckResult, CvAnalysis, EvidenceRef, Finding, FindingSeverity, FindingStatus, LetterCheck } from "@/lib/types";
import { AREA_META, stepText } from "./cv";
import { normaliseText, sha256 } from "./fingerprint";
import { LEXICON_VERSION } from "./lexicon";
import { PARSER_VERSION } from "./parse";
import { supplementalFindings } from "./supplemental";

// Turns an analysis into findings: the one shape CV checks, letters and later tools share. Nothing here
// changes a score. Findings are read from the analysis the engine already produced, and the evidence
// they cite is found in the text itself rather than trusted from a list.

/** A check counts as passed from this score up: the same line the check page and "steps to improve" draw. */
export const PASS_SCORE = 8;

/** Checks that need bullet points to say anything. With none, the rubric scores them 0 and nothing was assessed. */
export const NEEDS_BULLETS = new Set<CheckKey>(["quant", "verbs", "accomp", "repeat", "filler", "buzz", "passive", "grammar", "bulletlen"]);
/** Checks whose verdict comes from the bullet judge; in AI mode that is the model, not an exact rule. */
const AI_JUDGED = new Set<CheckKey>(["quant", "verbs", "accomp", "sector"]);
const NO_BULLETS_ACTION = "Add bullet points (•) under each role and project, then upload again.";

export const LEGACY_LIMITS = [
  "This report was saved before Offerpath recorded findings, so these statuses are read from its saved scores.",
  "Evidence positions, confidence and the parser and word-list versions were not recorded for it and are shown as unknown.",
];

export const documentVersion = (text: string) => sha256(text);

/** The blocks of a CV that evidence can point at: the normalised text and each scored line. */
export function cvBlocks(text: string, lines: { text: string }[]): Record<string, string> {
  const blocks: Record<string, string> = { doc: normaliseText(text) };
  lines.forEach((l, i) => (blocks[`line:${i}`] = l.text));
  return blocks;
}

function checkStatus(c: CheckResult, bullets: number): FindingStatus {
  if (bullets === 0 && NEEDS_BULLETS.has(c.key)) return "not_applicable";
  return c.score >= PASS_SCORE ? "passed" : "needs_attention";
}

/** Severity follows the estimated score gain, the same arithmetic as "steps to improve". */
function checkSeverity(a: CvAnalysis, c: CheckResult, status: FindingStatus): FindingSeverity {
  const weight = AREA_META[c.area].weight;
  if (status === "passed" || !weight) return "info";
  const area = a.areas.find((x) => x.key === c.area)!;
  const gain = ((10 - c.score) / area.checks.length) * weight * 10;
  return gain >= 4 ? "high" : gain >= 2 ? "medium" : "low";
}

const esc = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

/** Where each flagged US variant actually sits, found in the text rather than copied from the check's list. */
function spellEvidence(c: CheckResult, blocks: Record<string, string>, doc: string): EvidenceRef[] {
  const words = (c.extras ?? []).map((e) => e.split(" → ")[0]).filter(Boolean);
  const refs: EvidenceRef[] = [];
  const found = new Set<string>();
  const scan = (block: string, ws: string[]) => {
    const text = blocks[block];
    if (text === undefined) return;
    for (const w of ws) {
      for (const m of text.matchAll(new RegExp(`\\b${esc(w)}\\b`, "gi"))) {
        refs.push({ documentVersion: doc, block, range: { start: m.index, end: m.index + m[0].length }, quote: m[0] });
        found.add(w);
      }
    }
  };
  for (const i of c.affected) scan(`line:${i}`, words);
  // A variant outside any bullet (a heading, the skills list) is cited from the whole text.
  scan("doc", words.filter((w) => !found.has(w)));
  return refs;
}

function lineEvidence(c: CheckResult, blocks: Record<string, string>, doc: string): EvidenceRef[] {
  return c.affected.filter((i) => `line:${i}` in blocks).map((i) => ({ documentVersion: doc, block: `line:${i}`, range: null, quote: blocks[`line:${i}`] }));
}

/**
 * Findings for a CV review. `engine` records them when the report is made, with evidence positions
 * checked against the text. `legacy` reads them from a report saved before findings existed: statuses
 * come from the saved scores and bullet count, nothing else is invented, and the limits say so.
 */
export function cvAssessment(a: CvAnalysis, text: string, origin: Assessment["origin"] = "engine"): Assessment {
  const doc = documentVersion(text);
  const blocks = cvBlocks(text, a.lines);
  const ai = a.meta.method === "ai";
  const findings: Finding[] = a.areas.flatMap((area) =>
    area.checks.map((c): Finding => {
      const status = checkStatus(c, a.meta.bullets);
      const judged = AI_JUDGED.has(c.key);
      return {
        id: c.key,
        check: c.key,
        status,
        severity: checkSeverity(a, c, status),
        confidence: origin === "legacy" ? null : ai && judged ? null : 1,
        method: a.meta.method ? (ai && judged ? "ai" : "rules") : null,
        explanation: c.detail,
        action: status === "not_applicable" ? NO_BULLETS_ACTION : status === "needs_attention" ? stepText(c) : null,
        evidence: origin === "engine" && c.key === "spell" ? spellEvidence(c, blocks, doc) : lineEvidence(c, blocks, doc),
      };
    }),
  );
  return {
    documentVersion: doc,
    versions: {
      parser: origin === "engine" ? PARSER_VERSION : null,
      rubric: a.meta.rubric ?? null,
      model: ai ? a.meta.judge ?? null : null,
      dictionary: origin === "engine" ? LEXICON_VERSION : null,
    },
    origin,
    limits: origin === "engine" ? [] : [...LEGACY_LIMITS],
    // Supplemental checks are recorded when a report is made. A legacy record never gains them: it reads as not assessed.
    findings: origin === "engine" ? [...findings, ...supplementalFindings(text, doc)] : findings,
  };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const LETTER_LIMITS = ["Letter checks record whether each check passed, not where in the letter; the letter itself is shown alongside them."];

/**
 * Findings for a cover letter review, from the checks `reviewLetter` produced. The keyword check is
 * the one that can't be read as a boolean: with no keywords to compare it was never assessed, so it
 * is not applicable without a job ad and uncertain when the ad yielded nothing to look for.
 */
export function letterAssessment(p: { letterText: string; jobText: string; checks: LetterCheck[]; keywordsUsed: string[]; keywordsMissing: string[] }, origin: Assessment["origin"] = "engine"): Assessment {
  const noKeywords = p.keywordsUsed.length + p.keywordsMissing.length === 0;
  const findings: Finding[] = p.checks.map((c) => {
    const status: FindingStatus = c.t === "Keywords from the job ad" && noKeywords ? (p.jobText.trim() ? "uncertain" : "not_applicable") : c.ok ? "passed" : "needs_attention";
    return {
      id: slug(c.t),
      check: c.t,
      status,
      severity: status === "needs_attention" ? "medium" : "info",
      confidence: origin === "legacy" ? null : 1,
      method: origin === "legacy" ? null : "rules",
      explanation: c.d,
      action: status === "needs_attention" ? c.d : status === "not_applicable" ? "Add the job ad to check keywords." : null,
      evidence: [],
    };
  });
  return {
    documentVersion: documentVersion(p.letterText),
    versions: { parser: null, rubric: null, model: null, dictionary: origin === "engine" ? LEXICON_VERSION : null },
    origin,
    limits: origin === "engine" ? [...LETTER_LIMITS] : [...LETTER_LIMITS, ...LEGACY_LIMITS],
    findings,
  };
}
