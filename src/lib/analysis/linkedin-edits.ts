import type { ConfirmedFact, ProofreadingFinding, ProofreadingReport, Finding } from "@/lib/types";
import { LINKEDIN_SECTION_LABEL, LINKEDIN_SECTIONS, type LinkedinPayload, type LinkedinSection, type LinkedinSectionKey, type LinkedinSuggestion, type LinkedinVersion } from "@/lib/linkedin-types";
import { normaliseText, type ClaimInventory } from "./claims";
import { safeExplanation } from "./explanation-check";
import { documentVersion } from "./findings";
import { summarise, type LinkedinSummary } from "./linkedin-assess";
import { checkSectionText, currentVersion, isUnresolvedBlank, sectionOf, stripBullet } from "./linkedin-check";
import { wordDiff, type DiffPart } from "./word-diff";

// OP-018: section versions and the student's decisions. Pure, with the same rules as OP-016: a suggestion changes nothing
// until it's kept, every keep or edit makes a new version, undo moves back without rewriting history, and feedback only
// ever describes the exact words it was made for.

export const MAX_VERSIONS = 30;
export const MAX_ASSESSMENTS = 20;
export const TOO_MANY_VERSIONS = "You've saved a lot of versions of this section. Start a new review to keep going.";

export function newSection(key: LinkedinSectionKey, text: string, at: string): LinkedinSection {
  return {
    key,
    versions: [{ id: "v1", n: 1, at, action: "start", label: "As you gave it to us", text, documentVersion: documentVersion(text), accepted: [], confirmed: [], facts: [] }],
    current: "v1",
    undoStack: [],
    suggestions: [],
    rejected: [],
    withheld: [],
    assessments: [],
    choices: [],
  };
}

const squash = (s: string) => normaliseText(s).replace(/\s+/g, " ").trim().toLowerCase();

/** The text with this suggestion applied, or null if the words it replaces aren't there any more. */
export function applySuggestion(current: string, s: Pick<LinkedinSuggestion, "before" | "after" | "basedOn">): string | null {
  if (s.before === null) return documentVersion(current) === s.basedOn ? s.after : null;
  const want = squash(stripBullet(s.before));
  const lines = current.split("\n");
  const at = lines.findIndex((l) => squash(stripBullet(l)) === want);
  if (at >= 0) {
    if (!s.after) lines.splice(at, 1);
    else lines[at] = `${/^\s*[•\-*–▪◦‣›]\s*/.exec(lines[at])?.[0] ?? ""}${s.after}`;
    return lines.join("\n").trim();
  }
  if (!current.includes(s.before)) return null;
  return current.replace(s.before, s.after).replace(/[ \t]{2,}/g, " ").replace(/ +\n/g, "\n").trim();
}

export function addVersion(section: LinkedinSection, input: { action: "typed" | "accepted"; label: string; text: string; suggestionId?: string; confirmed: string[]; facts: ConfirmedFact[]; at: string }): LinkedinSection | { error: string } {
  if (section.versions.length >= MAX_VERSIONS) return { error: TOO_MANY_VERSIONS };
  const now = currentVersion(section);
  const n = Math.max(...section.versions.map((v) => v.n)) + 1;
  const version: LinkedinVersion = {
    id: `v${n}`,
    n,
    at: input.at,
    action: input.action,
    label: input.label,
    text: input.text,
    documentVersion: documentVersion(input.text),
    accepted: input.suggestionId ? [...now.accepted, input.suggestionId] : now.accepted,
    confirmed: input.confirmed,
    facts: [...now.facts, ...input.facts],
  };
  return { ...section, versions: [...section.versions, version], current: version.id, undoStack: [...section.undoStack, now.id] };
}

export function undoSection(section: LinkedinSection): LinkedinSection | { error: string } {
  const back = section.undoStack[section.undoStack.length - 1];
  if (!back) return { error: "There's nothing to undo in this section." };
  return { ...section, current: back, undoStack: section.undoStack.slice(0, -1) };
}

/** On offer: not kept in the current text, not rejected, and its words are still there to change. */
export function openSuggestions(section: LinkedinSection): LinkedinSuggestion[] {
  const v = currentVersion(section);
  return section.suggestions.filter((s) => !v.accepted.includes(s.id) && !section.rejected.some((r) => r.suggestionId === s.id) && applySuggestion(v.text, s) !== null);
}

/* ---------- What the page shows ---------- */

export interface LinkedinIssueView {
  key: string;
  severity: "block" | "confirm" | "note";
  message: string;
}

export interface LinkedinSuggestionView {
  id: string;
  method: "rules" | "ai";
  why: string;
  before: string | null;
  after: string;
  diff: DiffPart[];
  issues: LinkedinIssueView[];
  blocked: boolean;
  hasBlank: boolean;
}

export interface LinkedinSectionView {
  key: LinkedinSectionKey;
  label: string;
  text: string;
  original: string;
  changed: boolean;
  diff: DiffPart[];
  /** Saved versions so far, and which this is. */
  versionNumber: number;
  versions: number;
  canUndo: boolean;
  hasBlank: boolean;
  /** The feedback below describes earlier words, not the words shown. */
  stale: boolean;
  findings: Finding[];
  guidance: Finding[];
  limits: string[];
  proofreading: { status: ProofreadingReport["status"]; open: ProofreadingFinding[]; dismissed: ProofreadingFinding[] } | null;
  suggestions: LinkedinSuggestionView[];
  withheld: string[];
}

export interface LinkedinView {
  revision: number | null;
  summary: LinkedinSummary;
  sections: LinkedinSectionView[];
  cvChanged: boolean;
  cvGone: boolean;
}

function dismissedIn(section: LinkedinSection, doc: string): Set<string> {
  const out = new Set<string>();
  for (const c of section.choices) {
    if (c.documentVersion !== doc) continue;
    if (c.kind === "dismiss") out.add(c.findingId);
    else out.delete(c.findingId);
  }
  return out;
}

export function sectionView(p: Pick<LinkedinPayload, "sections">, section: LinkedinSection, inv: ClaimInventory): LinkedinSectionView {
  const v = currentVersion(section);
  const original = section.versions[0].text;
  const exact = section.assessments.find((a) => a.assessment.documentVersion === v.documentVersion);
  const shown = exact ?? section.assessments[section.assessments.length - 1];
  const all = shown?.assessment.findings ?? [];
  const pr = exact?.proofreading ?? null;
  const dismissed = exact ? dismissedIn(section, v.documentVersion) : new Set<string>();
  return {
    key: section.key,
    label: LINKEDIN_SECTION_LABEL[section.key],
    text: v.text,
    original,
    changed: v.text !== original,
    diff: wordDiff(original, v.text),
    versionNumber: v.n,
    versions: section.versions.length,
    canUndo: section.undoStack.length > 0,
    hasBlank: isUnresolvedBlank(v.text),
    stale: !exact,
    findings: all.filter((f) => !f.id.startsWith("consistency-")),
    guidance: all.filter((f) => f.id.startsWith("consistency-")),
    limits: shown?.assessment.limits ?? [],
    proofreading: pr ? { status: pr.status, open: pr.findings.filter((f) => !dismissed.has(f.id)), dismissed: pr.findings.filter((f) => dismissed.has(f.id)) } : null,
    suggestions: openSuggestions(section).map((s) => {
      const check = s.after ? checkSectionText(p, inv, section.key, s.after, { before: s.before }) : null;
      return {
        id: s.id,
        method: s.method,
        // Judged again on read: an explanation saved before this check, or against text that has since changed.
        why: s.method === "ai" ? safeExplanation(inv, s.why) : s.why,
        before: s.before,
        after: s.after,
        diff: wordDiff(s.before ?? v.text, s.after),
        issues: (check?.issues ?? []).map((i) => ({ key: i.key, severity: i.severity, message: i.message })),
        blocked: check?.verdict === "block",
        hasBlank: isUnresolvedBlank(s.after),
      };
    }),
    withheld: section.withheld,
  };
}

export function linkedinView(p: LinkedinPayload, inv: ClaimInventory, cv: { gone: boolean; changed: boolean }): LinkedinView {
  return { revision: p.editRevision ?? null, summary: summarise(p), sections: LINKEDIN_SECTIONS.map((k) => sectionView(p, sectionOf(p, k), inv)), cvChanged: cv.changed, cvGone: cv.gone };
}

/* ---------- Copy and export ---------- */

export const NOT_ON_LINKEDIN = "Saved in Offerpath only. None of this is on LinkedIn until you paste it there yourself.";

export const sectionsWithBlanks = (p: Pick<LinkedinPayload, "sections">) => LINKEDIN_SECTIONS.filter((k) => isUnresolvedBlank(currentVersion(sectionOf(p, k)).text));

/** The student's current words, section by section, for copying or the download. */
export function profileText(p: Pick<LinkedinPayload, "sections">): string {
  const parts = LINKEDIN_SECTIONS.map((k) => ({ label: LINKEDIN_SECTION_LABEL[k], text: currentVersion(sectionOf(p, k)).text.trim() })).filter((s) => s.text);
  return [NOT_ON_LINKEDIN, ...parts.map((s) => `${s.label.toUpperCase()}\n${s.text}`)].join("\n\n") + "\n";
}
