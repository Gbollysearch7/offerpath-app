// Matches an advert's requirements to what a CV shows, and turns that into evidence coverage (OP-013).
//
// JOB-SCORING VERSIONS
//   (none recorded)         Reports saved before this file. Dictionary keywords, a term counted as a
//                           must-have when it appeared twice, and 30 points given to every CV before any
//                           evidence. Those reports keep their saved numbers and show LEGACY_MATCH_NOTE
//                           (job-match-content.ts).
//   job-match-2026-11-06.1  This file. No starting score.
//
// THE MODEL
//   coverage = 100 x sum(weight x credit) / sum(weight), over stated requirements that can be checked.
//   weight:  essential 3, desirable 1, and half that for a soft skill.
//   credit:  explicit 1, contextual 0.5, weak 0.25, none 0.
//   Contextual and uncertain requirements, and conditions a CV can't settle, are shown but left out of the
//   denominator: the advert did not say they are required, or the CV is not the place to find out.
//   Fewer than MIN_ASSESSED stated requirements means no percentage at all.
// These weights and credits are product judgments. They have not been calibrated against adviser opinion
// or against outcomes. The number describes evidence for this advert. It is not a chance of being hired.
import type { Assessment, CoverageStatus, EvidenceLevel, EvidenceRef, Finding, JobMatch, JobMatchRequirement, JobRequirement, KeywordHit } from "@/lib/types";
import { documentVersion } from "./findings";
import { COVERAGE_MEANING, CREDIT, WEIGHTS } from "./job-match-content";
import { LEXICON_VERSION } from "./lexicon";
import { BULLET_RE, normaliseHeader } from "./parse";
import { type AdapterStatus, findTerm, fold, type RequirementExtraction, spellingsOf, termKey } from "./job-requirements";

export { COVERAGE_MEANING, CREDIT, LEGACY_MATCH_NOTE, WEIGHTS } from "./job-match-content";
export const JOB_SCORING_VERSION = "job-match-2026-11-06.1";
/** Below this many stated, checkable requirements a percentage would be one or no data points dressed up. */
export const MIN_ASSESSED = 2;

/* ---------- Reading the CV ---------- */

interface CvLine {
  text: string;
  start: number;
  /** activity: says what was done. list: names something without saying what was done with it. */
  kind: "activity" | "list";
  section: string | null;
}

const LIST_SECTIONS = new Set(["skills", "interests", "languages"]);

function readCvLines(cvText: string): CvLine[] {
  const lines: CvLine[] = [];
  let section: string | null = null;
  for (const m of cvText.matchAll(/[^\n]+/g)) {
    const header = normaliseHeader(m[0]);
    if (header) {
      section = header;
      continue;
    }
    // The quotation starts after any bullet mark: a student recognises their words, not the symbol.
    const lead = m[0].match(BULLET_RE)?.[0].length ?? m[0].length - m[0].trimStart().length;
    const text = m[0].slice(lead).trim();
    if (!text) continue;
    const words = text.split(/\s+/).length;
    const separators = (text.match(/[,|/•·]/g) ?? []).length;
    const bullet = BULLET_RE.test(m[0]);
    const list = (!!section && LIST_SECTIONS.has(section)) || (!bullet && words < 5) || (separators >= 2 && words / (separators + 1) <= (bullet ? 1.5 : 2.5));
    lines.push({ text, start: m.index + lead, kind: list ? "list" : "activity", section });
  }
  return lines;
}

// "No experience of X", "not yet used X": naming a thing to say you haven't done it isn't evidence of it.
const denies = (before: string) => /\b(?:no|not|never|without|lack(?:ing)?|unfamiliar)\b[^.,;]{0,40}$/i.test(before);

/* ---------- Related evidence ---------- */

// Things similar enough to be worth mentioning as transferable. Never counted as if the named thing were there.
const FAMILIES: string[][] = [
  ["terraform", "pulumi", "cloudformation", "ansible"],
  ["kubernetes", "docker", "openshift"],
  ["aws", "azure", "gcp"],
  ["tableau", "power bi", "looker", "qlik"],
  ["excel", "google sheets"],
  ["sql", "postgresql", "mysql", "sql server", "sqlite"],
  ["react", "vue", "angular", "svelte"],
  ["java", "kotlin", "scala"],
  ["javascript", "typescript"],
  ["jira", "asana", "trello"],
];

// What a soft skill looks like when it's shown rather than named.
export const SHOWN_BY: Record<string, RegExp> = {
  communication: /\b(?:present(?:ed|ing)|briefed|wrote|explained|liaised)\b/i,
  teamwork: /\b(?:collaborated|worked with|alongside|as part of a team|team of)\b/i,
  collaboration: /\b(?:worked with|alongside|cross-functional|team of)\b/i,
  leadership: /\b(?:led|managed a team|mentored|supervised|captain|president|chair(?:ed)?)\b/i,
  organisation: /\b(?:organised|coordinated|scheduled|planned)\b/i,
  "problem solving": /\b(?:solved|resolved|diagnosed|fixed|debugged)\b/i,
  negotiation: /\b(?:negotiated)\b/i,
  presentation: /\b(?:presented)\b/i,
};

const stem = (w: string) => w.slice(0, 5);
const contentWords = (s: string) => (fold(s).toLowerCase().match(/[\p{L}\d]{3,}/gu) ?? []).filter((w) => !["and", "the", "for", "with", "from", "into", "your"].includes(w));

const lineRef = (version: string, l: CvLine): EvidenceRef => ({ documentVersion: version, block: "doc", range: { start: l.start, end: l.start + l.text.length }, quote: l.text });

interface Found {
  level: EvidenceLevel;
  matchedTerm: string | null;
  refs: EvidenceRef[];
  note: string;
}

function degreeEvidence(req: JobRequirement, lines: CvLine[], version: string): Found {
  const degree = lines.filter((l) => /\b(?:BSc|BA|BEng|MEng|MSc|MA|MBA|PhD|LLB|LLM|degree|bachelor|master|undergraduate)\b/i.test(l.text));
  if (!degree.length) return { level: "none", matchedTerm: null, refs: [], note: "We found no degree in your CV." };
  const refs = degree.slice(0, 2).map((l) => lineRef(version, l));
  const all = degree.map((l) => l.text).join("\n");
  const grade = req.label.match(/2[:.]1|2[:.]2|first|1st/i)?.[0].toLowerCase() ?? null;
  // "degree in Law" or "law degree": the words before "degree" that aren't about level are the subject.
  const before = (req.label.match(/^(.*?)\s*degree/i)?.[1] ?? "").replace(/2[:.][12]|first[- ]class|1st|bachelor['’]?s?|master['’]?s?|undergraduate|postgraduate|qualifying|relevant|related|university|good|strong|BSc|BEng|MEng|MSc|PhD|MBA|LLB/gi, " ").trim();
  const subject = req.label.match(/\b(?:in|from)\s+(.+)$/i)?.[1] ?? (before || null);
  const anySubject = !subject || /\bany\b|\brelevant\b|\brelated\b/i.test(subject);
  const subjects = anySubject ? [] : subject.split(/,|\s+or\s+|\s+and\s+/i).map((s) => s.trim()).filter(Boolean);
  const gradeOk = !grade || /first|1st/i.test(all) || (/2[:.]1/.test(grade) && /2[:.]1/.test(all)) || (/2[:.]2/.test(grade) && /2[:.][12]/.test(all));
  const subjectOk = !subjects.length || subjects.some((s) => findTerm(all, s).length || contentWords(s).every((w) => fold(all).toLowerCase().includes(stem(w))));
  if (gradeOk && subjectOk) return { level: "explicit", matchedTerm: null, refs, note: "Your CV shows this." };
  return { level: "contextual", matchedTerm: null, refs, note: !gradeOk && !subjectOk ? "Your CV shows a degree, but not this grade or subject." : !gradeOk ? "Your CV shows a degree, but not the grade asked for." : "Your CV shows a degree, but not in the subject named." };
}

function findEvidence(req: JobRequirement, lines: CvLine[], version: string): Found {
  if (!req.assessable) return { level: "not_assessed", matchedTerm: null, refs: [], note: "A CV can't settle this. Check it yourself." };
  if (req.kind === "qualification") return degreeEvidence(req, lines, version);

  // Every spelling of every alternative, but one result: repeating a term or its synonyms adds nothing.
  const activity: { term: string; line: CvLine }[] = [];
  const listed: { term: string; line: CvLine }[] = [];
  for (const term of req.terms) {
    for (const spelling of [term, ...req.aliases.filter((a) => termKey(a) === termKey(term) || req.terms.length === 1)]) {
      for (const line of lines) {
        const hit = findTerm(line.text, spelling).find((r) => !denies(line.text.slice(0, r.start)));
        if (hit) (line.kind === "activity" ? activity : listed).push({ term, line });
      }
    }
  }
  if (activity.length) return { level: "explicit", matchedTerm: activity[0].term, refs: uniqueRefs(activity.map((a) => lineRef(version, a.line))), note: `Your CV shows ${activity[0].term} in what you did.` };
  if (listed.length) return { level: "weak", matchedTerm: listed[0].term, refs: uniqueRefs(listed.map((a) => lineRef(version, a.line))), note: `${listed[0].term} is named, but not shown in use. Add an example of how you used it.` };

  // Related, not the same: say what was found and let the student judge.
  for (const term of req.terms) {
    const key = termKey(term);
    const family = FAMILIES.find((f) => f.includes(key));
    for (const relative of family?.filter((f) => f !== key) ?? []) {
      const line = lines.find((l) => findTerm(l.text, relative).length);
      if (line) return { level: "contextual", matchedTerm: null, refs: [lineRef(version, line)], note: `Your CV doesn't name ${term}, but shows something related (${spellingsOf(relative)[0]}). It may be transferable: say so if it is.` };
    }
    const shown = SHOWN_BY[key];
    const showing = shown && lines.find((l) => l.kind === "activity" && shown.test(l.text));
    if (showing) return { level: "contextual", matchedTerm: null, refs: [lineRef(version, showing)], note: `This line suggests ${term.toLowerCase()} without naming it.` };
    const words = contentWords(term);
    if (words.length >= 2) {
      const line = lines.find((l) => l.kind === "activity" && words.every((w) => fold(l.text).toLowerCase().includes(stem(w))));
      if (line) return { level: "contextual", matchedTerm: null, refs: [lineRef(version, line)], note: `This line seems related to ${term.toLowerCase()} without naming it.` };
    }
  }
  return { level: "none", matchedTerm: null, refs: [], note: "We found no evidence of this in your CV. That doesn't mean you don't have it: add it if you do." };
}

function uniqueRefs(refs: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<number>();
  return refs.filter((r) => !seen.has(r.range!.start) && seen.add(r.range!.start)).slice(0, 2);
}

/* ---------- Coverage ---------- */

const counted = (r: JobMatchRequirement) => r.assessable && (r.category === "essential" || r.category === "desirable");
const weightOf = (r: JobRequirement) => (r.category === "essential" ? WEIGHTS.essential : WEIGHTS.desirable) * (r.soft ? WEIGHTS.softFactor : 1);

function coverage(requirements: JobMatchRequirement[], advertLength: number): JobMatch["coverage"] {
  const assessed = requirements.filter(counted);
  const possible = assessed.reduce((s, r) => s + weightOf(r), 0);
  const earned = assessed.reduce((s, r) => s + weightOf(r) * CREDIT[r.evidence.level as keyof typeof CREDIT], 0);
  const contextual = requirements.filter((r) => r.category === "contextual").length;
  const uncertain = requirements.filter((r) => r.category === "uncertain").length;
  const toConfirm = requirements.filter((r) => !r.assessable && r.category === "essential").length;
  const enough = assessed.length >= MIN_ASSESSED;
  const status: CoverageStatus = !enough ? "insufficient" : assessed.length < 4 || uncertain + contextual > assessed.length ? "limited" : "scored";
  const open = uncertain + contextual;
  const next = requirements.length ? "Use the list below as a guide, or paste a fuller job description." : "Paste a fuller job description, including what it asks of candidates.";
  const explanation = !enough
    ? `This advert doesn't state enough checkable requirements for a percentage to mean anything: we could read ${assessed.length === 0 ? "none" : "only one"} as clearly required or desirable${open ? `, and ${open} more ${open === 1 ? "is" : "are"} mentioned without saying whether ${open === 1 ? "it is" : "they are"} needed` : ""}${advertLength < 300 ? ". The advert is also very short" : ""}. ${next}`
    : status === "limited"
      ? open
        ? `Based on only part of this advert: ${assessed.length} requirements counted, ${open} left out because the advert doesn't say ${open === 1 ? "it is" : "they are"} needed. Read the list below as well as the number.`
        : `Based on only ${assessed.length} stated requirements, so read the list below as well as the number.`
      : `Based on ${assessed.length} stated requirements.`;
  return {
    status,
    score: enough ? Math.round((100 * earned) / possible) : null,
    explanation,
    earned: Math.round(earned * 100) / 100,
    possible,
    assessed: { essential: assessed.filter((r) => r.category === "essential").length, desirable: assessed.filter((r) => r.category === "desirable").length },
    notCounted: { contextual, uncertain, toConfirm },
  };
}

/** Assesses a CV against requirements already read from the advert. Requirements stay fixed, so before and after compare. */
export function matchRequirements(input: { jobText: string; cvText: string; extraction: RequirementExtraction; adapter?: AdapterStatus }): JobMatch {
  const cvVersion = documentVersion(input.cvText);
  const lines = readCvLines(input.cvText);
  const requirements: JobMatchRequirement[] = input.extraction.requirements.map((r) => ({ ...r, evidence: findEvidence(r, lines, cvVersion) }));
  const essential = requirements.filter((r) => r.category === "essential");
  return {
    version: JOB_SCORING_VERSION,
    method: requirements.some((r) => r.method === "ai") ? "rules+ai" : "rules",
    adapter: input.adapter ?? "not_used",
    advertVersion: documentVersion(input.jobText),
    cvVersion,
    requirements,
    notRequired: input.extraction.notRequired,
    coverage: coverage(requirements, input.jobText.length),
    essentialGaps: essential.filter((r) => r.evidence.level === "none").map((r) => r.label),
    essentialThin: essential.filter((r) => r.evidence.level === "weak" || r.evidence.level === "contextual").map((r) => r.label),
    toConfirm: essential.filter((r) => !r.assessable).map((r) => r.label),
  };
}

/** The saved requirements measured against a revised CV: the real document, not a guess about it. */
export const remeasure = (match: JobMatch, jobText: string, cvText: string): JobMatch => {
  const requirements = match.requirements.map((r) => {
    const saved: Partial<JobMatchRequirement> = { ...r };
    delete saved.evidence;
    return saved as JobRequirement;
  });
  return matchRequirements({ jobText, cvText, extraction: { requirements, notRequired: match.notRequired }, adapter: match.adapter });
};

/* ---------- The other shapes the report keeps ---------- */

const named = (l: EvidenceLevel) => l === "explicit" || l === "weak";

/** The keyword list the tailoring tools work from, one entry per requirement however often the advert repeats it. */
export function keywordsFromMatch(match: JobMatch, placeOf: (r: JobMatchRequirement) => string): KeywordHit[] {
  return match.requirements
    .filter((r) => r.assessable && r.kind !== "qualification" && r.category !== "uncertain")
    .map((r) => ({ w: r.label, n: r.occurrences, must: r.category === "essential", where: named(r.evidence.level) ? "Already in your CV" : placeOf(r), soft: r.soft, inCv: named(r.evidence.level) }));
}

/** Terms to mark in the advert. Things the advert says aren't needed stay unmarked. */
export function highlightTerms(match: JobMatch): { hits: { w: string; inCv: boolean }[]; aliases: Record<string, string[]> } {
  const hits: { w: string; inCv: boolean }[] = [];
  const aliases: Record<string, string[]> = {};
  for (const r of match.requirements) {
    if (!r.assessable || r.kind === "qualification") continue;
    for (const term of r.terms) {
      hits.push({ w: term, inCv: named(r.evidence.level) });
      aliases[term.toLowerCase()] = [...new Set([...spellingsOf(term).map((s) => s.toLowerCase()), ...r.aliases.map((a) => a.toLowerCase())])].filter((s) => s !== term.toLowerCase());
    }
  }
  return { hits, aliases };
}

/**
 * What to do about requirements the CV doesn't show, as prompts with blanks for the student to fill. Rule-based
 * tailoring has no way to know what a student did, so it never writes a requirement into one of their lines.
 */
export function evidencePrompts(match: JobMatch, labels: string[]): { where: string; before: string; after: string }[] {
  return match.requirements
    .filter((r) => labels.includes(r.label))
    .map((r) => ({
      where: r.label.toUpperCase(),
      before: r.evidence.level === "none" ? `Your CV doesn't show ${r.label} yet.` : r.evidence.note,
      after: r.soft ? `If it's true of you, add an example that shows it: [what you did], [the result].` : `If you've really used it, add a line that says how: [what you did] using ${r.label}, [the result].`,
    }));
}

const findingStatus = (r: JobMatchRequirement): Finding["status"] => {
  if (!r.assessable || r.category === "uncertain" || r.category === "contextual") return "uncertain";
  return r.evidence.level === "explicit" ? "passed" : "needs_attention";
};
const findingSeverity = (r: JobMatchRequirement): Finding["severity"] => {
  if (findingStatus(r) !== "needs_attention") return "info";
  if (r.evidence.level === "none") return r.category === "essential" ? "high" : "medium";
  return r.category === "essential" ? "medium" : "low";
};

/** The same result in the shape every other report's findings use. Evidence cites the advert first, then the CV. */
export function jobMatchAssessment(match: JobMatch): Assessment {
  return {
    documentVersion: match.cvVersion,
    versions: { parser: null, rubric: match.version, model: null, dictionary: LEXICON_VERSION },
    origin: "engine",
    limits: [COVERAGE_MEANING, "Finding no evidence in a CV doesn't mean the student lacks the skill. Weights and credits are uncalibrated product judgments."],
    findings: match.requirements.map((r) => ({
      id: r.id,
      check: r.label,
      status: findingStatus(r),
      severity: findingSeverity(r),
      confidence: null,
      method: r.method === "ai" ? "ai" : "rules",
      explanation: `${r.reason} ${r.evidence.note}`,
      action: findingStatus(r) === "needs_attention" ? r.evidence.note : null,
      evidence: [r.source, ...r.evidence.refs],
    })),
  };
}
