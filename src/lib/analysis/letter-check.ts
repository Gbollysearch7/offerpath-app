import { z } from "zod";
import type { ConfirmedFact, LetterParagraph, SavedIssue } from "@/lib/types";
import { allWordsIn, blankBrackets, buildClaimInventory, normaliseText, stemsIn, withoutInstructions, type ClaimInventory } from "./claims";
import { checkProfile, confirmationsNeeded, withPlaceholders, type RewriteCheck, type RewriteIssue } from "./rewrite-check";

// OP-017, OP-015: the same fact check every generated rewrite goes through, applied to a letter one sentence at a time.
// A letter says two kinds of thing. What the student did has to be in the CV or their notes: an advert mentioning Tableau
// doesn't let a model say they used it. What the employer is or does has to be in the advert or the notes, because we hold no
// other information about employers and don't look any up. It is a rule set, with OP-015's limits: facts in plain lower-case
// words that match no pattern get through.

export interface LetterFactContext {
  employer: string;
  jobTitle: string;
  addressee: string | null;
  jobText: string;
  notes: string | null;
  name: string | null;
}

const esc = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
const wordRe = (w: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(w)}(?=$|[^\\p{L}\\p{N}])`, "iu");
const tokensOf = (s: string | null) => (s ?? "").split(/[\s,./&()-]+/).filter((w) => w.length > 1);

export const employerTokens = (employer: string) => tokensOf(employer);

/** Sentences of a passage, with where each one starts. A decimal or a "£1.5m" doesn't end one. */
export function sentencesOf(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  for (const m of text.matchAll(/\S(?:[\s\S]*?)(?:[.!?]+(?=["'”’)]*(?:\s|$))["'”’)]*|$)/g)) {
    const raw = m[0];
    const trimmed = raw.replace(/\s+$/, "");
    if (trimmed) out.push({ text: trimmed, start: m.index, end: m.index + trimmed.length });
  }
  return out;
}

/** The sentence refers to the employer: by name, as "your ...", or as "the firm" and the like. */
export function refersToEmployer(sentence: string, employer: string): boolean {
  if (employerTokens(employer).some((t) => t.length > 2 && !/^(the|ltd|plc|llp|inc|group|limited|and|of)$/i.test(t) && wordRe(`${t}`).test(sentence.replace(/[’']s\b/g, "")))) return true;
  return /\b(?:your|you)\b/i.test(sentence) || /\bthe (?:firm|company|bank|organisation|organization|business|employer|department|charity|trust)\b/i.test(sentence);
}

const OWN_ACTION = /\bI(?:\s+\w+ly|\s+also|\s+then|\s+have|\s+had|['’]ve)?\s+(?:\w+ed|built|led|ran|wrote|made|won|taught|drew|cut|set|grew|sold|spoke|kept|gave|took|began|brought|held|drove|oversaw|sought|told|found|did|saw|went|got|put|learnt|use|using|know|can)\b/i;

/**
 * A name at this position is being said about the employer: it follows "your ..." or the employer's name, or the sentence
 * has the student doing nothing. "I used Tableau at Northbank" is about the student; "your Leeds team uses Tableau" isn't.
 */
function aboutEmployerAt(sentence: string, found: string, employer: string): boolean {
  if (!refersToEmployer(sentence, employer)) return false;
  const at = found ? sentence.toLowerCase().indexOf(found.toLowerCase()) : -1;
  if (at < 0) return !OWN_ACTION.test(sentence);
  const before = sentence.slice(0, at);
  const owners = [/\byour\b/i, /\byou\b/i, ...employerTokens(employer).filter((t) => t.length > 2).map((t) => new RegExp(`${esc(t)}(?:[’']s)?\\b`, "i"))];
  for (const re of owners) {
    const m = re.exec(before);
    if (m && before.slice(m.index + m[0].length).split(/\s+/).filter(Boolean).length <= 6) return true;
  }
  return !OWN_ACTION.test(before);
}

// Plain-word statements of fact about an employer. Praise with nothing behind it is judged under motivation; these assert something happened or is so.
const EMPLOYER_CLAIMS = /\b(recent(?:ly)?|award(?:s|ed)?|ranked|named|founded|established|largest|biggest|market[- ]leading|market leader|acquir\w*|merg\w*|launch\w*|expan\w*|partner(?:ed|ship|ships)|opened|announced|headquarter\w*|revenue|turnover|net zero|sponsor\w*|fastest|number one|leading)\b/gi;

const FACT_CODES = new Set<RewriteIssue["code"]>(["unsupported-figure", "figure-from-other-entry", "figure-from-other-line", "figure-unit-changed", "figure-noun-changed", "vague-quantity", "unsupported-date", "date-from-other-entry", "unsupported-entity", "entity-from-other-entry", "entity-elsewhere-in-cv", "unsupported-qualification", "unsupported-outcome", "scope-inflated"]);

const inSource = (found: string, source: string) => !!found && wordRe(found).test(source);

/** Blanks words that are the application's own furniture, keeping every offset where it was. */
function maskOwnNames(text: string, ctx: LetterFactContext): string {
  let out = text;
  for (const t of [...tokensOf(ctx.employer), ...tokensOf(ctx.jobTitle), ...tokensOf(ctx.addressee), ...tokensOf(ctx.name)]) {
    if (t.length < 3) continue;
    out = out.replace(new RegExp(`(^|[^\\p{L}\\p{N}])(${esc(t)})((?:[’']s)?)(?=$|[^\\p{L}\\p{N}])`, "giu"), (_, a: string, b: string, c: string) => a + " ".repeat(b.length + c.length));
  }
  return out;
}

const ORDINARY = new Set(["cv", "uk"]);
const DEGREE_IN_CV = /\b(?:BSc|BA|BEng|MEng|MSc|MA|MBA|PhD|LLB|LLM|degree|bachelor|master|undergraduate)\b/i;

const verdictOf = (issues: RewriteIssue[]): RewriteCheck["verdict"] => (issues.some((i) => i.severity === "block") ? "block" : issues.some((i) => i.severity === "confirm") ? "confirm" : "pass");

/** One sentence of a letter. Sentence-initial capitals aren't names here: letters don't open every line with a verb as CV lines do. */
export function checkLetterSentence(inv: ClaimInventory, sentence: string, ctx: LetterFactContext): RewriteCheck {
  const normal = normaliseText(sentence).replace(/\s+/g, " ").trim();
  const masked = maskOwnNames(normal, ctx);
  const raw = checkProfile(inv, masked);
  const source = `${ctx.jobText}\n${ctx.notes ?? ""}`;
  const firstWord = normal.split(/\s+/)[0]?.replace(/[^\p{L}\p{N}]/gu, "") ?? "";
  const issues: RewriteIssue[] = [];
  for (const i of raw.issues) {
    if (i.code === "unsupported-entity" && i.severity === "confirm" && i.found === firstWord) continue;
    if (i.code === "dropped-figure") continue;
    // Words every letter may use, which aren't claims about anyone.
    if (ORDINARY.has(i.found.toLowerCase())) continue;
    // A CV line needs a minimum length. "Thank you." doesn't.
    if (i.key === "not-a-cv-line:short") continue;
    // "My degree" is what a BSc is: the word on its own doesn't claim a different qualification.
    if (i.code === "unsupported-qualification" && /^degree$/i.test(i.found) && DEGREE_IN_CV.test(inv.entries.map((e) => `${e.heading}\n${e.context}\n${e.lines.join("\n")}`).join("\n"))) continue;
    if (FACT_CODES.has(i.code) && aboutEmployerAt(normal, i.found, ctx.employer)) {
      if (inSource(i.found, source)) continue;
      issues.push({ code: "unsupported-employer-fact", severity: "block", found: i.found, key: `unsupported-employer-fact:${i.found.toLowerCase()}`, message: `"${i.found}" is about ${ctx.employer || "the employer"}, and it isn't in the advert or your notes. Keep it only if you can point to a source.` });
      continue;
    }
    issues.push(i);
  }
  if (refersToEmployer(normal, ctx.employer)) {
    for (const m of blankBrackets(masked).matchAll(EMPLOYER_CLAIMS)) {
      const found = m[0];
      if (inSource(found, source) || issues.some((i) => i.key === `unsupported-employer-fact:${found.toLowerCase()}`)) continue;
      if (!aboutEmployerAt(normal, found, ctx.employer)) continue;
      issues.push({ code: "unsupported-employer-fact", severity: "block", found, key: `unsupported-employer-fact:${found.toLowerCase()}`, message: `"${found}" states something about ${ctx.employer || "the employer"} that isn't in the advert or your notes. Keep it only if you can point to a source.` });
    }
  }
  return { ...raw, issues, verdict: verdictOf(issues) };
}

/** What may be relied on: the CV, what the student has confirmed, and their notes, which are their own statement. Instructions in any of it give no evidence. */
export function letterInventory(cvText: string, facts: ConfirmedFact[], notes: string | null, at = "1970-01-01T00:00:00.000Z"): ClaimInventory {
  const clean = notes ? withoutInstructions(notes).text.trim() : "";
  const fromNotes: ConfirmedFact[] = clean
    ? [{ id: "notes", kind: "statement", value: clean, issue: "notes", quote: clean, scope: "cv", entryId: null, entryHeading: null, lineText: null, provenance: { by: "student", how: "typed", sourceVersion: "notes", validator: "notes", reportId: "", at } }]
    : [];
  return buildClaimInventory(cvText, [...facts, ...fromNotes]);
}

export const isGreeting = (s: string) => /^\s*dear\b/i.test(s);
export const SIGNOFF_RE = /^\s*(yours\s+(?:faithfully|sincerely|truly)|kind(?:est)?\s+regards|best\s+regards|best\s+wishes|warm\s+regards|regards|many\s+thanks|thank\s+you)\s*,?\s*$/i;
export const isSignoff = (s: string) => SIGNOFF_RE.test(s.split("\n")[0]);

/** A whole paragraph, sentence by sentence: the issues together, and the first key seen for each. */
export function checkLetterText(inv: ClaimInventory, text: string, ctx: LetterFactContext): RewriteCheck {
  const checks = sentencesOf(text).map((s) => checkLetterSentence(inv, s.text, ctx));
  const issues: RewriteIssue[] = [];
  for (const i of checks.flatMap((c) => c.issues)) if (!issues.some((x) => x.key === i.key)) issues.push(i);
  return { validator: checks[0]?.validator ?? "", verdict: verdictOf(issues), issues, used: checks.flatMap((c) => c.used), questions: [...new Set(checks.flatMap((c) => c.questions))], unchanged: false, entry: null, sourceHadInstructions: checks.some((c) => c.sourceHadInstructions) };
}

export const toSavedIssues = (c: RewriteCheck): SavedIssue[] => c.issues.filter((i) => i.severity !== "block").map((i) => ({ code: i.code, severity: i.severity === "note" ? "note" : "confirm", found: i.found, key: i.key, message: i.message, ...(i.from ? { from: i.from } : {}) }));

/** Keeps what holds up in a generated paragraph: a repair to a blank where that is all it needs, otherwise the sentence goes and only the reason stays. */
export function cleanGenerated(inv: ClaimInventory, text: string, ctx: LetterFactContext): { text: string; check: RewriteCheck; removed: string[]; lostEmployerReason: boolean } {
  const kept: string[] = [];
  const removed: string[] = [];
  let lostEmployerReason = false;
  for (const s of sentencesOf(text.replace(/\s+/g, " ").trim())) {
    const first = checkLetterSentence(inv, s.text, ctx);
    if (first.verdict !== "block") {
      kept.push(normaliseText(s.text));
      continue;
    }
    // The repair works on the masked offsets, which are the normalised sentence's own.
    const repaired = withPlaceholders(s.text, first);
    const second = repaired ? checkLetterSentence(inv, repaired, ctx) : null;
    if (repaired && second && second.verdict !== "block") {
      kept.push(repaired);
      continue;
    }
    if (first.issues.some((i) => i.code === "unsupported-employer-fact")) lostEmployerReason = true;
    removed.push(first.issues.find((i) => i.severity === "block")?.message ?? "It didn't hold up against your CV.");
  }
  const out = kept.join(" ");
  return { text: out, check: checkLetterText(inv, out, ctx), removed, lostEmployerReason };
}

const CV_SECTIONS = /^(?:EDUCATION|EXPERIENCE|WORK EXPERIENCE|EMPLOYMENT|PROJECTS|SKILLS|VOLUNTEERING|LEADERSHIP|ACTIVITIES|ACHIEVEMENTS|AWARDS|PROFILE|SUMMARY|INTERESTS|CERTIFICATIONS)$/;
/** Shown when none of a model's source tags hold up. Says who wrote the paragraph, which is the one thing known about it. */
export const NEUTRAL_SOURCE = "WRITING TOOL";

/**
 * A model's source tags are shown beside its paragraph, so "CV · GOOGLE INTERNSHIP" would say something the fact check on
 * the paragraph never read. A tag stays only if what it names is there: the student's CV, the advert, or notes they did add.
 */
export function safeSources(tags: string[], inv: ClaimInventory, ctx: LetterFactContext): string[] {
  const cv = stemsIn(inv.entries.flatMap((e) => [e.heading, e.context, ...e.lines, ...e.factValues]).join("\n"));
  const advert = stemsIn(ctx.jobText);
  const out = tags.flatMap((raw): string[] => {
    const tag = normaliseText(raw).replace(/\s+/g, " ").trim().toUpperCase();
    if (tag === "UK CONVENTION" || tag === "CV" || tag === "JOB AD") return [tag];
    if (tag === "YOU ADDED") return ctx.notes?.trim() ? [tag] : [];
    const m = /^(CV|JOB AD) · (.+)$/.exec(tag);
    if (!m) return [];
    if (m[1] === "CV") return CV_SECTIONS.test(m[2]) || allWordsIn(m[2], cv) ? [tag] : [];
    return allWordsIn(m[2], advert) ? [tag] : ["JOB AD"];
  });
  return out.length ? [...new Set(out)] : [NEUTRAL_SOURCE];
}

export const LetterDraftSchema = z.array(z.object({ text: z.string().max(4000), src: z.array(z.string().max(80)).max(10) })).min(1).max(12);

export interface CheckedDraft {
  paragraphs: LetterParagraph[];
  withheld: { where: string; reason: string }[];
  claims: { text: string; issues: SavedIssue[] }[];
}

/**
 * Every generated draft passes through here before it can be saved. The greeting and the signature are ours, so a model
 * can't invent a recruiter or sign with the wrong name. Null: nothing usable came back, and the caller falls back or fails.
 */
export function checkLetterDraft(raw: unknown, inv: ClaimInventory, ctx: LetterFactContext & { name: string }): CheckedDraft | null {
  const parsed = LetterDraftSchema.safeParse(raw);
  if (!parsed.success) return null;
  const withheld: CheckedDraft["withheld"] = [];
  const claims: CheckedDraft["claims"] = [];
  const body: LetterParagraph[] = [];
  let signoff: string | null = null;
  let lostReason = false;
  parsed.data.forEach((p, i) => {
    if (isGreeting(p.text)) return;
    if (isSignoff(p.text)) {
      signoff = p.text.split("\n")[0].replace(/,\s*$/, "").trim();
      return;
    }
    const out = cleanGenerated(inv, p.text, ctx);
    for (const reason of out.removed) withheld.push({ where: `Paragraph ${i + 1}`, reason });
    lostReason ||= out.lostEmployerReason;
    if (!out.text) return;
    const saved = toSavedIssues(out.check).filter((x) => x.severity === "confirm");
    if (saved.length) claims.push({ text: out.text, issues: saved });
    body.push({ text: out.text, src: safeSources(p.src, inv, ctx) });
  });
  if (!body.length) return null;
  if (lostReason && body.length) {
    const last = body[body.length - 1];
    body[body.length - 1] = { text: `${last.text} [your reason for choosing this employer, and where you found it]`, src: [...last.src, "ADD YOUR REASON"] };
  }
  const greet = ctx.addressee?.trim() ? ctx.addressee.trim().replace(/,.*$/, "") : "Hiring Manager";
  const formal = /sir|madam/i.test(greet);
  const close = signoff ?? (formal ? "Yours faithfully" : "Yours sincerely");
  return {
    paragraphs: [{ text: `Dear ${greet},`, src: [ctx.addressee ? "YOU ADDED" : "UK CONVENTION"] }, ...body, { text: `${close},\n${ctx.name}`, src: ["UK CONVENTION"] }],
    withheld,
    claims,
  };
}

export { confirmationsNeeded };
