// OP-017: assesses a cover letter against the advert, the student's notes and their CV.
//
// LETTER-SCORING VERSIONS
//   (none recorded)            Reports saved before this file, from `reviewLetter` in letter.ts: 35 points before any
//                              evidence, set phrases for motivation, keywords, and a fixed 250 to 400 words. They keep their
//                              saved score and show LEGACY_LETTER_NOTE. `reviewLetter` stays so that remains reproducible.
//   letter-review-2026-11-07.1 This file. No starting score.
//
// THE MODEL
//   score = 100 x sum(weight x credit) / sum(weight), over the areas that could be assessed (letter-content.ts).
//   An area with nothing to assess against has no credit and leaves the denominator; under MIN_ASSESSED_WEIGHT there is no number.
//   A claim the CV doesn't back, a gap left to fill, the wrong name, or no specific reason for choosing the employer when we had
//   something to judge it by, holds the number at SCORE_CAP, below the "Strong" band.
//   Rules read the wording. They can't tell whether a reason is true or persuasive, and no adviser has validated them.
import type { Assessment, ConfirmedFact, EvidenceRef, Finding, FindingStatus, JobRequirement, LetterArea, LetterAreaKey, LetterContext, LetterFactIssue, LetterMotivation, LetterRequirement, LetterReview } from "@/lib/types";
import { bracketsIn, stemsIn } from "./claims";
import { documentVersion } from "./findings";
import { SHOWN_BY, matchRequirements } from "./job-match";
import { extractRequirements, findTerm, fold, termKey } from "./job-requirements";
import { checkLetterSentence, employerTokens, isGreeting, letterInventory, refersToEmployer, sentencesOf, SIGNOFF_RE, type LetterFactContext } from "./letter-check";
import { AREA_LABELS, AREA_WEIGHTS, LETTER_REVIEW_VERSION, MIN_ASSESSED_WEIGHT, SCORE_CAP, SCORE_MEANING } from "./letter-content";
import { LEXICON_VERSION, US_SPELLINGS } from "./lexicon";
import { WEIGHTS } from "./job-match-content";
import { wordCount } from "./parse";

export { LETTER_REVIEW_VERSION };

export interface LetterInput {
  letterText: string;
  jobTitle: string;
  employer: string;
  jobText: string;
  notes: string | null;
  addressee?: string | null;
  /** The name it should be signed with, when we know one. */
  name: string | null;
  cvText: string;
  facts?: ConfirmedFact[];
  format?: LetterContext["format"];
  /** The student's own stated limit. An advert's stated limit is read from the advert. */
  wordLimit?: number | null;
}

/* ---------- Reading the letter ---------- */

interface Span {
  text: string;
  start: number;
  end: number;
}

export interface ReadLetter {
  greeting: Span | null;
  signoff: Span | null;
  signedName: string | null;
  body: Span[];
  sentences: Span[];
}

/** Finds the greeting, the sign-off and the paragraphs in between, keeping offsets into the original text. */
export function readLetter(text: string): ReadLetter {
  const lines: Span[] = [];
  for (const m of text.matchAll(/[^\n]+/g)) if (m[0].trim()) lines.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  const g = lines.findIndex((l) => isGreeting(l.text) && l.text.trim().length < 80);
  let s = -1;
  for (let i = lines.length - 1; i > g; i--) if (SIGNOFF_RE.test(lines[i].text) && i >= lines.length - 4) { s = i; break; }
  const from = g >= 0 ? lines[g].end : 0;
  const to = s >= 0 ? lines[s].start : text.length;
  const body: Span[] = [];
  for (const m of text.slice(from, to).matchAll(/\S(?:[^\n]|\n(?!\s*\n))*/g)) {
    const t = m[0].replace(/\s+$/, "");
    const start = from + m.index;
    // Without a greeting, the contact block is the opening paragraph, not writing to assess.
    if (g < 0 && !body.length && (/@/.test(t) || wordCount(t) < 6)) continue;
    if (g >= 0 || wordCount(t) > 0) body.push({ text: t, start, end: start + t.length });
  }
  const sentences = body.flatMap((p) => sentencesOf(p.text).map((x) => ({ text: x.text, start: p.start + x.start, end: p.start + x.end })));
  const after = s >= 0 ? lines.slice(s + 1).map((l) => l.text.trim()).find((l) => l && !/@|\d{5}/.test(l)) ?? null : null;
  return { greeting: g >= 0 ? lines[g] : null, signoff: s >= 0 ? lines[s] : null, signedName: after, body, sentences };
}

const ref = (documentVersion: string, s: Span): EvidenceRef => ({ documentVersion, block: "doc", range: { start: s.start, end: s.end }, quote: s.text });

/* ---------- What makes a sentence specific ---------- */

// Words that would read the same about any employer. A sentence made only of these says nothing about this one.
const GENERIC = new Set(
  `a about after again all also always am an and any apply applying application applied are as at be because been before being best bring brilliant but by can career careers colleagues commitment committed companies company contribute contributing culture dedicated delighted develop developing development do drawn dynamic eager employer employers environment especially ethos excellence excellent excited exciting experience experiences extremely fantastic feel firm firms for forward from future get global good graduate graduates great grow growing growth had has have help helping highly hope i ideal impressed impressive in industry innovation innovative integrity interest interested interesting into is it its job jobs join joining just keen know knowledge leader leading learn learning like look looking love make making many me mission more most much my of on opportunities opportunity or organisation organisations organization our outstanding part particularly passion passionate people place placement position prestigious professional professionalism program programme progress proud put quality really reason reasons renowned reputable reputation respect respected role roles scheme sector skill skills so staff strong success successful team teams that the their them there these they thing things think this those to top truly use using value values very vision want was way we well were what when where which who why will wish with work working workplace world would you your bank banks banking business businesses admire admired attract attracted appeal appeals appealing believe enjoy forward-thinking thinking class world-class internship`.split(/\s+/),
);

const words = (s: string): string[] => [...(fold(s).toLowerCase().replace(/[’']s\b/g, "").match(/[\p{L}\d][\p{L}\d-]*/gu) ?? [])];

/** The words left once the employer's name, the job title, the advert's skill terms and anything generic are taken out. */
function specificWords(sentence: string, removed: Set<string>): string[] {
  return words(sentence).filter((w) => w.length > 2 && !GENERIC.has(w) && !removed.has(w) && !/^\d+$/.test(w));
}

const CLOSING = /\b(thank you|thanks for|hear from you|speak with you|meet you|discuss|your time|your consideration|considering my|enclosed|attached)\b/i;
const PERSONAL = /\b(met|spoke|spoken|talked|attended|visited|shadowed|interned|volunteered|worked (?:with|alongside)|customer of|client of|careers? fair|open day|insight (?:day|event)|webinar|alumn\w*|banked with|used your|use your|grew up|home ?town|my (?:mother|father|mum|dad|parents?|family|brother|sister|grandmother|grandfather|aunt|uncle|friend|cousin|tutor|lecturer|mentor|supervisor|manager))\b/i;
const FIRST_PERSON = /\b(?:I|I['’]m|I['’]ve|my|me|myself)\b/;
const MOTIVE = /\b(want|wish|hope|keen|like|enjoy|interest\w*|appeal\w*|suits?|why|because|since|looking|learn|excited|drawn|love|aim|goal|plan|curious|would)\b/i;

/** Sentences of an advert or notes: a line break ends one too, because headings and list items have no full stop. */
function sourceSentences(text: string): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(/[^\n]+/g)) for (const s of sentencesOf(m[0])) out.push({ text: s.text, start: m.index + s.start, end: m.index + s.end });
  return out;
}

/** Overlap of a sentence's specific words with a source, and the source sentence that shares the most. */
function bestSource(specific: string[], source: Span[], removed: Set<string>): { span: Span; shared: number } | null {
  let best: { span: Span; shared: number } | null = null;
  const mine = new Set<string>(specific.flatMap((w) => [...stemsIn(w)]));
  for (const s of source) {
    const theirs = specificWords(s.text, removed);
    const shared = new Set(theirs.filter((w) => [...stemsIn(w)].some((x) => mine.has(x)))).size;
    if (shared > (best?.shared ?? 0)) best = { span: s, shared };
  }
  return best;
}

function assessMotivation(r: ReadLetter, ctx: { employer: string; jobTitle: string; jobText: string; notes: string | null; requirementWords: Set<string> }, doc: string): { motivation: LetterMotivation; area: Pick<LetterArea, "status" | "severity" | "credit" | "explanation" | "action" | "evidence"> } {
  const removed = new Set([...employerTokens(ctx.employer).map((t) => fold(t).toLowerCase()), ...words(ctx.jobTitle), ...ctx.requirementWords]);
  const advertVersion = documentVersion(ctx.jobText);
  const advert = sourceSentences(ctx.jobText);
  const notesText = ctx.notes?.trim() ?? "";
  const notesVersion = documentVersion(notesText);
  const notes = sourceSentences(notesText);
  const aboutEmployer = advert.filter((s) => (/\b(we|our|us)\b/i.test(s.text) || refersToEmployer(s.text.replace(/\b(?:you|your)\b/gi, ""), ctx.employer)) && specificWords(s.text, removed).length >= 3);
  const employerInfo: LetterMotivation["employerInfo"] = wordCount(notesText) >= 3 ? "notes" : aboutEmployer.length ? "advert" : "none";
  const name = ctx.employer || "this employer";

  // A reason needn't name the employer, if what it says is what the advert or notes say about them.
  const material_ = [...aboutEmployer, ...notes];
  const candidates = r.sentences.filter((s) => !CLOSING.test(s.text) && (FIRST_PERSON.test(s.text) || MOTIVE.test(s.text)) && (refersToEmployer(s.text, ctx.employer) || (bestSource(specificWords(s.text, removed), material_, removed)?.shared ?? 0) >= 2));
  const graded = candidates.map((s) => {
    const specific = specificWords(s.text, removed);
    const fromNotes = bestSource(specific, notes, removed);
    const fromAdvert = bestSource(specific, aboutEmployer, removed);
    return { s, specific, fromNotes, fromAdvert };
  });
  const sourced = graded.find((g) => (g.fromNotes?.shared ?? 0) >= 2) ?? graded.find((g) => (g.fromAdvert?.shared ?? 0) >= 2);
  if (sourced) {
    const useNotes = (sourced.fromNotes?.shared ?? 0) >= 2;
    const span = useNotes ? sourced.fromNotes!.span : sourced.fromAdvert!.span;
    const source: EvidenceRef = { documentVersion: useNotes ? notesVersion : advertVersion, block: "doc", range: { start: span.start, end: span.end }, quote: span.text };
    return {
      motivation: { verdict: "specific_sourced", employerInfo, quote: ref(doc, sourced.s), source },
      area: { status: "passed", severity: "info", credit: 1, explanation: `Gives a reason that matches what ${useNotes ? "your notes say" : "the advert says"} about ${name}.`, action: null, evidence: [ref(doc, sourced.s), source] },
    };
  }
  const personal = graded.find((g) => PERSONAL.test(g.s.text) && g.specific.length >= 2);
  if (personal) {
    return {
      motivation: { verdict: "specific_personal", employerInfo, quote: ref(doc, personal.s), source: null },
      area: { status: "passed", severity: "info", credit: 1, explanation: `Gives a reason from your own experience of ${name}. It doesn't need more than this if it's accurate.`, action: null, evidence: [ref(doc, personal.s)] },
    };
  }
  const unverified = graded.find((g) => g.specific.length >= 3);
  if (unverified) {
    return {
      motivation: { verdict: "specific_unverified", employerInfo, quote: ref(doc, unverified.s), source: null },
      area: { status: "uncertain", severity: "low", credit: 0.75, explanation: `This is a specific reason, which is good. We can't check it, because it isn't in the advert or your notes.`, action: "Keep it if you can point to where you found it. We don't look up employers, so we can't confirm it.", evidence: [ref(doc, unverified.s)] },
    };
  }
  const generic = graded[0] ?? null;
  if (employerInfo === "none") {
    return {
      motivation: { verdict: "information_missing", employerInfo, quote: generic ? ref(doc, generic.s) : null, source: null },
      area: {
        status: "uncertain",
        severity: "info",
        credit: null,
        explanation: `We only have ${name}'s name, nothing about what it does, so we can't judge how well this letter fits it. This isn't a comment on your motivation.${generic ? " As written, this sentence could go to any employer." : ""}`,
        action: "Add the advert, or a note saying what you've found out and where. We won't add facts about the employer ourselves.",
        evidence: generic ? [ref(doc, generic.s)] : [],
      },
    };
  }
  const material = aboutEmployer[0] ?? (notes[0] && employerInfo === "notes" ? notes[0] : null);
  const hint = material ? ` You gave us this to work from: “${material.text.slice(0, 160)}”.` : "";
  if (generic) {
    return {
      motivation: { verdict: "generic", employerInfo, quote: ref(doc, generic.s), source: null },
      area: { status: "needs_attention", severity: "medium", credit: 0.25, explanation: `This names ${name}, but take the name out and it could go to any employer.${hint}`, action: "Say what specifically draws you here, in your own words. One clear reason is enough.", evidence: [ref(doc, generic.s)] },
    };
  }
  return {
    motivation: { verdict: "absent", employerInfo, quote: null, source: null },
    area: { status: "needs_attention", severity: "medium", credit: 0, explanation: `The letter doesn't say why you chose ${name}.${hint}`, action: "Add one specific reason. One sentence is enough if it's clear.", evidence: [] },
  };
}

function assessRole(r: ReadLetter, jobTitle: string, jobText: string, employer: string, doc: string, requirementWords: Set<string>): Pick<LetterArea, "status" | "severity" | "credit" | "explanation" | "action" | "evidence"> {
  const removedTitle = new Set([...employerTokens(employer).map((t) => fold(t).toLowerCase()), ...words(jobTitle)]);
  const advert = sourceSentences(jobText);
  const titleWords = words(jobTitle).filter((w) => w.length > 3);
  const namesRole = (s: string) => titleWords.some((w) => words(s).includes(w)) || /\b(?:this|the) (?:role|position|job|scheme|programme|internship|placement)\b/i.test(s);
  const graded = r.sentences.filter((s) => FIRST_PERSON.test(s.text) && !CLOSING.test(s.text)).map((s) => {
    const specific = specificWords(s.text, removedTitle);
    const shared = bestSource(specific.filter((w) => !requirementWords.has(w)), advert, new Set([...removedTitle, ...requirementWords]));
    return { s, specific, shared };
  });
  const linked = graded.find((g) => MOTIVE.test(g.s.text) && (g.shared?.shared ?? 0) >= 2);
  if (linked) return { status: "passed", severity: "info", credit: 1, explanation: "Connects you to what this role involves, in terms the advert uses.", action: null, evidence: [ref(doc, linked.s), { documentVersion: documentVersion(jobText), block: "doc", range: { start: linked.shared!.span.start, end: linked.shared!.span.end }, quote: linked.shared!.span.text }] };
  const own = graded.find((g) => MOTIVE.test(g.s.text) && namesRole(g.s.text) && g.specific.length >= 2);
  if (own) {
    if (!jobText.trim()) return { status: "passed", severity: "info", credit: 1, explanation: "Gives your reason for this role. Add the advert and we can compare it with what the role involves.", action: null, evidence: [ref(doc, own.s)] };
    return { status: "passed", severity: "info", credit: 0.75, explanation: "Gives your reason for this role, though in different terms from the advert.", action: null, evidence: [ref(doc, own.s)] };
  }
  const named = r.sentences.find((s) => namesRole(s.text));
  if (named) return { status: "needs_attention", severity: "medium", credit: 0.25, explanation: "Names the role, but doesn't say why you want this work.", action: jobText.trim() ? "Pick one thing the advert says you'd do, and say why it interests you." : "Say what about this work interests you.", evidence: [ref(doc, named)] };
  return { status: "needs_attention", severity: "medium", credit: 0, explanation: `The letter doesn't mention the ${jobTitle || "role"} or say why you want it.`, action: "Say which role you're applying for and why it interests you.", evidence: [] };
}

/* ---------- Requirements: demonstrated, not merely mentioned ---------- */

const PAST_ACTION = /\bI(?:\s+\w+ly|\s+also|\s+then)?\s+(?:\w{2,}ed|built|led|ran|wrote|made|won|taught|drew|cut|set|grew|sold|spoke|kept|gave|took|began|brought|held|drove|oversaw|sought|told|found|did|went|got|put|learnt)\b/i;
const PERFECT_ACTION = /\bI\s+have\s+(?:\w+ly\s+|also\s+)?(?:\w{2,}ed|built|led|run|written|made|won|taught|drawn|set|grown|sold|given|taken|begun|brought|held|driven)\b/i;
const denies = (before: string) => /\b(?:no|not|never|without|lack(?:ing)?|unfamiliar)\b[^.,;]{0,40}$/i.test(before);

/** Says what was done, rather than claiming a quality. */
export function describesAction(sentence: string): boolean {
  if (PAST_ACTION.test(sentence)) return true;
  return PERFECT_ACTION.test(sentence) && wordCount(sentence) >= 10;
}

const softMention = (sentence: string, key: string) => {
  const base = key.slice(0, 5);
  return new RegExp(`\\b${base.replace(/[^\p{L}]/gu, "")}\\w*`, "iu").test(sentence) || (key === "teamwork" && /\bteam player\b/i.test(sentence));
};

function assessRequirement(req: JobRequirement, cv: LetterRequirement["cv"], r: ReadLetter, doc: string): LetterRequirement {
  let mention: { s: Span; term: string } | null = null;
  let shown: { s: Span; term: string } | null = null;
  for (const term of req.terms) {
    const spellings = [term, ...req.aliases];
    for (const s of r.sentences) {
      const hit = spellings.flatMap((sp) => findTerm(s.text, sp)).find((h) => !denies(s.text.slice(0, h.start)));
      const named = !!hit || (req.soft && softMention(s.text, termKey(term)));
      if (named && describesAction(s.text)) shown ??= { s, term };
      else if (named) mention ??= { s, term };
      else if (req.soft && SHOWN_BY[termKey(term)]?.test(s.text) && describesAction(s.text)) shown ??= { s, term };
    }
  }
  const found = shown ?? mention;
  const level: LetterRequirement["level"] = shown ? "demonstrated" : mention ? "mentioned" : "absent";
  const cvNone = cv.level === "none";
  const note =
    level === "demonstrated"
      ? cvNone ? "Shown with an example here, but your CV doesn't show it. Make sure the two agree." : "Shown with an example of what you did."
      : level === "mentioned"
        ? "Named here without saying what you did with it. An example would show it."
        : cvNone ? "Not in your letter or your CV, so it doesn't count against this letter. Add it only if it's true."
          : cv.level === "not_checked" ? "Not in your letter." : "Your CV shows this, but your letter doesn't use it.";
  return { id: req.id, label: req.label, category: req.category as "essential" | "desirable", soft: req.soft, level, term: found?.term ?? null, letter: found ? ref(doc, found.s) : null, advert: req.source, cv, counted: false, note };
}

const weightOf = (r: LetterRequirement) => (r.category === "essential" ? WEIGHTS.essential : WEIGHTS.desirable) * (r.soft ? WEIGHTS.softFactor : 1);
const creditOf = (r: LetterRequirement) => (r.level === "demonstrated" ? (r.cv.level === "none" ? 0.5 : 1) : r.level === "mentioned" ? 0.25 : 0);

/** A letter can't cover everything, so only the most important few count; what the CV shows nothing for counts only if the letter claims it. */
function scoreGroup(list: LetterRequirement[], top: number): { credit: number | null; counted: LetterRequirement[] } {
  const eligible = list.filter((r) => !(r.cv.level === "none" && r.level === "absent"));
  const chosen = [...eligible].sort((a, b) => weightOf(b) - weightOf(a) || creditOf(b) - creditOf(a)).slice(0, top);
  for (const r of chosen) r.counted = true;
  if (!chosen.length) return { credit: null, counted: [] };
  const possible = chosen.reduce((s, r) => s + weightOf(r), 0);
  return { credit: chosen.reduce((s, r) => s + weightOf(r) * creditOf(r), 0) / possible, counted: chosen };
}

/* ---------- Length ---------- */

const ADVERT_LIMIT = /\b(?:no more than|not more than|maximum of|max(?:imum)?\.?|up to|limit of|at most|under|within|fewer than|less than)\s+(\d[\d,]*)\s*(words?|characters?)\b|\b(\d[\d,]*)[- ](word|character)s?\s+(?:limit|maximum|max|cover letter|statement|answer|response)\b/i;

/** A limit the advert states, as it states it. */
export function limitInAdvert(jobText: string): LetterContext["limit"] {
  const m = ADVERT_LIMIT.exec(jobText);
  if (!m) return null;
  const amount = Number((m[1] ?? m[3]).replace(/,/g, ""));
  if (!amount) return null;
  const unit = /char/i.test(m[2] ?? m[4]) ? "characters" : "words";
  return { amount, unit, source: "advert", ref: { documentVersion: documentVersion(jobText), block: "doc", range: { start: m.index, end: m.index + m[0].length }, quote: m[0] } };
}

function assessLength(bodyText: string, words: number, ctx: LetterContext): LetterReview["length"] & { status: FindingStatus; severity: LetterArea["severity"]; credit: number; action: string | null } {
  const ok = { status: "passed" as FindingStatus, severity: "info" as LetterArea["severity"], credit: 1, action: null };
  if (ctx.limit) {
    const n = ctx.limit.unit === "words" ? words : bodyText.length;
    const whose = ctx.limit.source === "advert" ? "The advert sets" : "You told us the form sets";
    if (n > ctx.limit.amount) return { status: "needs_attention", severity: "high", credit: 0, action: `Cut ${n - ctx.limit.amount} ${ctx.limit.unit}: a form may cut off or refuse anything over the limit.`, words, verdict: "over_limit", explanation: `${whose} a limit of ${ctx.limit.amount} ${ctx.limit.unit}, and this is ${n}.` };
    return { ...ok, words, verdict: "fits_limit", explanation: `${n} of ${ctx.limit.amount} ${ctx.limit.unit}. ${whose} this limit, so a shorter answer than a usual letter is right here.` };
  }
  if (ctx.format === "statement") {
    if (words < 40) return { status: "needs_attention", severity: "low", credit: 0.5, action: "Check what the form asks. A sentence or two more may give room for one reason and one example.", words, verdict: "very_short", explanation: `${words} words is very short, even for a form answer.` };
    return { ...ok, words, verdict: "fits_limit", explanation: `${words} words. Application statements vary, so check this against any limit on the form. Tell us the limit and we'll compare.` };
  }
  if (words < 80) return { status: "needs_attention", severity: "medium", credit: 0.25, action: "Unless the employer asked for something this brief, add a reason for applying and an example. If this is for a form, choose “Application form or statement”.", words, verdict: "very_short", explanation: `${words} words leaves little room for both a reason and an example.` };
  if (words < 150) return { ...ok, words, verdict: "short", explanation: `${words} words is shorter than many UK letters. That's fine for an email application or where brevity is asked for, as long as the reason and the example are both here.` };
  if (words <= 450) return { ...ok, words, verdict: "typical", explanation: `${words} words, which fits on one page, as many UK letters do.` };
  if (words <= 650) return { ...ok, words, verdict: "long", explanation: `${words} words is longer than many UK letters. That can be right where an employer asks you to address several criteria, such as academic, public sector or competency-based applications. Otherwise, check that every paragraph earns its place.` };
  return { status: "needs_attention", severity: "low", credit: 0.5, action: "Unless the employer asked for this much detail, choose your strongest examples.", words, verdict: "very_long", explanation: `${words} words won't fit on one page. Some applications ask for this much, so check what the employer wants.` };
}

/* ---------- Placeholders ---------- */

const OTHER_BLANKS = /<[^<>\n]{2,40}>|\{\{?[^{}\n]{1,40}\}?\}|\b(?:your name|company name|employer name|job title|hiring manager name|insert [a-z ]{2,30}|xxx+|lorem ipsum|tbc)\b/gi;

/** What's left to fill in: brackets, and the other ways a template shows a gap. Text in an unsure case is shown to the student, not removed. */
export function placeholdersIn(text: string): string[] {
  return [...new Set([...bracketsIn(text), ...(text.match(OTHER_BLANKS) ?? [])])];
}

/* ---------- The whole assessment ---------- */

const normName = (s: string) => fold(s).toLowerCase().replace(/[^\p{L} ]/gu, " ").replace(/\s+/g, " ").trim();

export function assessLetter(input: LetterInput): LetterReview {
  const doc = documentVersion(input.letterText);
  const r = readLetter(input.letterText);
  const hasAdvert = !!input.jobText.trim();
  const notes = input.notes?.trim() || null;
  const format = input.format ?? "letter";
  const limit: LetterContext["limit"] = input.wordLimit ? { amount: input.wordLimit, unit: "words", source: "student", ref: null } : hasAdvert ? limitInAdvert(input.jobText) : null;
  const context: LetterContext = { format, limit };
  const cvVersion = input.cvText.trim() ? documentVersion(input.cvText) : null;
  const statement = format === "statement" || (!!limit && limit.amount <= (limit.unit === "words" ? 250 : 1500));

  // Requirements come from the advert's reading (OP-012), and what the CV shows from the same matcher as tailoring (OP-013).
  const extraction = hasAdvert ? extractRequirements(input.jobText) : { requirements: [], notRequired: [] };
  const match = cvVersion ? matchRequirements({ jobText: input.jobText, cvText: input.cvText, extraction }) : null;
  const countable = extraction.requirements.filter((q) => q.assessable && (q.category === "essential" || q.category === "desirable"));
  const requirements = countable.map((q) => {
    const m = match?.requirements.find((x) => x.id === q.id);
    return assessRequirement(q, m ? { level: m.evidence.level, refs: m.evidence.refs } : { level: "not_checked", refs: [] }, r, doc);
  });
  const hard = requirements.filter((q) => !q.soft);
  const soft = requirements.filter((q) => q.soft);
  const hardScore = scoreGroup(hard, statement ? 3 : 6);
  const softScore = scoreGroup(soft, statement ? 2 : 3);
  const requirementWords = new Set(extraction.requirements.flatMap((q) => [...q.terms, ...q.aliases]).flatMap((t) => words(t)));

  const areas: LetterArea[] = [];
  const add = (key: LetterAreaKey, impact: LetterArea["impact"], a: Pick<LetterArea, "status" | "severity" | "credit" | "explanation" | "action" | "evidence">) => areas.push({ key, label: AREA_LABELS[key], weight: AREA_WEIGHTS[key], impact, ...a });

  const { motivation, area: motivationArea } = assessMotivation(r, { employer: input.employer, jobTitle: input.jobTitle, jobText: input.jobText, notes, requirementWords }, doc);
  add("employer_motivation", "meaning", motivationArea);
  add("role_motivation", "meaning", assessRole(r, input.jobTitle, input.jobText, input.employer, doc, requirementWords));

  const skillsArea = (key: "hard_skills" | "soft_skills", list: LetterRequirement[], score: ReturnType<typeof scoreGroup>, name: string) => {
    if (!hasAdvert) return add(key, "meaning", { status: "not_applicable", severity: "info", credit: null, explanation: `Add the advert to compare your letter with its ${name} requirements.`, action: "Add the advert.", evidence: [] });
    if (score.credit === null) return add(key, "meaning", { status: "uncertain", severity: "info", credit: null, explanation: list.length ? `Your CV shows none of the ${list.length} ${name} requirement${list.length === 1 ? "" : "s"} we read in the advert, so this doesn't count against the letter. Add them only if they're true.` : `We couldn't read any stated ${name} requirements in this advert.`, action: null, evidence: [] });
    const shown = score.counted.filter((q) => q.level === "demonstrated");
    const named = score.counted.filter((q) => q.level === "mentioned");
    const absent = score.counted.filter((q) => q.level === "absent");
    const parts = [`${shown.length} of ${score.counted.length} ${name} requirement${score.counted.length === 1 ? "" : "s"} shown with an example`, named.length ? `named without an example: ${named.map((q) => q.label).join(", ")}` : "", absent.length ? `not in the letter: ${absent.map((q) => q.label).join(", ")}` : ""].filter(Boolean);
    const good = score.credit >= 0.7;
    add(key, "meaning", { status: good ? "passed" : "needs_attention", severity: good ? "info" : "medium", credit: score.credit, explanation: `${parts.join("; ")}.`, action: good ? null : "Pick the most important and say what you did with them, using an example from your CV.", evidence: [...named, ...shown].flatMap((q) => (q.letter ? [q.letter] : [])).slice(0, 3) });
  };
  skillsArea("hard_skills", hard, hardScore, "technical");
  skillsArea("soft_skills", soft, softScore, "interpersonal");

  // Examples, linked to the CV line that backs each up.
  const cvLines: Span[] = [];
  for (const m of input.cvText.matchAll(/[^\n]+/g)) {
    const lead = m[0].length - m[0].replace(/^[\s•·*›\-–—]+/, "").length;
    const t = m[0].slice(lead).replace(/\s+$/, "");
    if (wordCount(t) >= 4) cvLines.push({ text: t, start: m.index + lead, end: m.index + lead + t.length });
  }
  const examples = r.sentences.filter((s) => describesAction(s.text) && (wordCount(s.text) >= 8 || /\d/.test(s.text))).map((s) => {
    const mine = stemsIn(s.text);
    const line = cvLines.map((l) => ({ l, n: [...stemsIn(l.text)].filter((x) => mine.has(x) && !GENERIC.has(x)).length })).sort((a, b) => b.n - a.n)[0];
    return { quote: ref(doc, s), cv: line && line.n >= 3 && cvVersion ? { documentVersion: cvVersion, block: "doc", range: { start: line.l.start, end: line.l.end }, quote: line.l.text } : null };
  });
  const need = statement ? 1 : 2;
  add("examples", "meaning", examples.length >= need
    ? { status: "passed", severity: "info", credit: 1, explanation: `${examples.length} example${examples.length === 1 ? "" : "s"} of what you've done${cvVersion ? `, ${examples.filter((e) => e.cv).length} linked to a line in your CV` : ""}. Study, part-time work and societies all count.`, action: null, evidence: examples.slice(0, 2).map((e) => e.quote) }
    : { status: "needs_attention", severity: "medium", credit: examples.length / need, explanation: examples.length ? `One example of what you've done, and a second would help the reader believe the rest.` : "No sentence describes something you did. Most sentences say what you are or want, rather than what you've done.", action: "Add an example from your CV. Study, part-time work and societies all count.", evidence: examples.map((e) => e.quote) });

  // Consistency with the CV: the same check a generated rewrite goes through.
  const factIssues: LetterFactIssue[] = [];
  if (cvVersion) {
    const ctx: LetterFactContext = { employer: input.employer, jobTitle: input.jobTitle, addressee: input.addressee ?? (r.greeting?.text.replace(/^\s*dear\s+/i, "").replace(/,\s*$/, "") ?? null), jobText: input.jobText, notes, name: input.name ?? r.signedName };
    const inv = letterInventory(input.cvText, input.facts ?? [], notes);
    for (const s of r.sentences) {
      // A blank isn't a claim: it's reported under details, and the rest of the sentence is still checked.
      const check = checkLetterSentence(inv, s.text.replace(/\[[^\]\n]*\]/g, ""), ctx);
      for (const i of check.issues) {
        if (i.severity === "note" || i.code === "not-a-cv-line" || factIssues.some((x) => x.code === i.code && x.found === i.found)) continue;
        // The student's own story of how they know the employer isn't a claim about the employer's business.
        if (i.code === "unsupported-employer-fact" && PERSONAL.test(s.text)) continue;
        factIssues.push({ code: i.code, severity: i.severity as "block" | "confirm", found: i.found, message: i.message, quote: ref(doc, s) });
      }
    }
  }
  // A student's statement about the employer isn't an inconsistency with their CV: it's something to source, reported with their reason.
  const aboutThem = factIssues.filter((i) => i.code === "unsupported-employer-fact");
  const aboutMe = factIssues.filter((i) => i.code !== "unsupported-employer-fact");
  const blocks = aboutMe.filter((i) => i.severity === "block").length;
  const confirms = aboutMe.length - blocks;
  if (aboutThem.length) {
    const area = areas.find((a) => a.key === "employer_motivation")!;
    const named = [...new Set(aboutThem.map((i) => `“${i.found}”`))].slice(0, 4).join(", ");
    area.explanation += ` Check where this came from: ${named} ${aboutThem.length === 1 ? "isn't" : "aren't"} in the advert or your notes, and we can't confirm ${aboutThem.length === 1 ? "it" : "them"}.`;
    area.action ??= "Keep these only if you can point to a source.";
    if (area.status === "passed") {
      area.status = "uncertain";
      area.severity = "low";
    }
    for (const i of aboutThem) if (!area.evidence.some((e) => e.quote === i.quote.quote)) area.evidence.push(i.quote);
  }
  add("cv_consistency", "meaning", !cvVersion
    ? { status: "not_applicable", severity: "info", credit: null, explanation: "No CV is linked, so we couldn't compare your letter with it.", action: "Upload a CV to compare the two.", evidence: [] }
    : aboutMe.length
      ? { status: blocks ? "needs_attention" : "uncertain", severity: blocks ? "high" : "low", credit: Math.max(0, 1 - 0.34 * blocks - 0.1 * confirms), explanation: `${aboutMe.length} point${aboutMe.length === 1 ? "" : "s"} your CV doesn't back up: ${aboutMe.slice(0, 3).map((i) => i.message).join(" ")} You may know something your CV leaves out, so check these rather than changing them automatically.`, action: "Check each one is accurate. Add it to your CV if it's true, or change the letter.", evidence: aboutMe.slice(0, 3).map((i) => i.quote) }
      : { status: "passed", severity: "info", credit: 1, explanation: "We found no figure, name or qualification that your CV doesn't back up. Our rules can miss claims in plain words, so read it through yourself.", action: null, evidence: [] });

  // Structure.
  const bodyText = r.body.map((b) => b.text).join("\n\n");
  const firstBody = r.sentences.slice(0, 2).map((s) => s.text).join(" ");
  const opensWithPurpose = /\b(apply|applying|application|interested in|writing)\b/i.test(firstBody) || refersToEmployer(firstBody, input.employer);
  const closes = /\b(discuss|interview|hear from|thank|forward to|welcome the chance|meet|speak)\b/i.test(r.sentences.slice(-2).map((s) => s.text).join(" "));
  const words_ = wordCount(bodyText);
  const structureGaps = [!statement && !opensWithPurpose && "an opening that says what you're applying for", !statement && !closes && "a closing line", !statement && words_ > 180 && r.body.length < 2 && "paragraph breaks"].filter(Boolean) as string[];
  add("structure", "style", structureGaps.length
    ? { status: "needs_attention", severity: "low", credit: structureGaps.length === 1 ? 0.5 : 0.25, explanation: `The letter doesn't have ${structureGaps.join(" or ")}.`, action: `Consider adding ${structureGaps.join(" and ")}.`, evidence: [] }
    : { status: "passed", severity: "info", credit: 1, explanation: statement ? "Says what it's for and gets to the point, which suits a short answer." : "Has an opening, a body and a close.", action: null, evidence: [] });

  const length = assessLength(bodyText, words_, context);
  add("length", length.verdict === "over_limit" ? "meaning" : "style", { status: length.status, severity: length.severity, credit: length.credit, explanation: length.explanation, action: length.action, evidence: context.limit?.ref ? [context.limit.ref] : [] });

  // Clarity: optional, and always tied to the passage.
  const longOnes = r.sentences.filter((s) => wordCount(s.text) > 40);
  add("clarity", "style", longOnes.length
    ? { status: "needs_attention", severity: "low", credit: Math.max(0.25, 1 - 0.25 * longOnes.length), explanation: `${longOnes.length} sentence${longOnes.length === 1 ? " is" : "s are"} over 40 words, which can be hard to follow.`, action: "Consider splitting these. This is a style choice.", evidence: longOnes.slice(0, 2).map((s) => ref(doc, s)) }
    : { status: "passed", severity: "info", credit: 1, explanation: "No very long sentences.", action: null, evidence: [] });

  // Details: blanks and a wrong name affect meaning; the rest is guidance.
  const placeholders = placeholdersIn(input.letterText);
  const found = r.signedName;
  const expected = input.name;
  const wrongName = !!expected && !!found && normName(expected) !== normName(found);
  const greeting = r.greeting?.text.replace(/^\s*dear\s+/i, "").replace(/,\s*$/, "").trim() ?? null;
  const signoff = r.signoff?.text.trim().replace(/,$/, "") ?? null;
  const sirMadam = !!greeting && /\b(sir|madam|whom it may concern)\b/i.test(greeting);
  const signoffOdd = !!signoff && !!greeting && ((sirMadam && /sincerely/i.test(signoff)) || (!sirMadam && /faithfully/i.test(signoff)));
  const usSpell = Object.keys(US_SPELLINGS).filter((w) => new RegExp(`\\b${w}\\b`, "i").test(input.letterText));
  const hasEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(input.letterText);
  const hasPhone = /(\+44|0)\s?\d[\d\s]{8,}/.test(input.letterText);
  const notes_: string[] = [];
  const passages: EvidenceRef[] = [];
  let mechanicsCredit = 1;
  let meaning = false;
  if (placeholders.length) {
    notes_.push(`There ${placeholders.length === 1 ? "is a gap" : "are gaps"} to fill: ${placeholders.slice(0, 3).join(", ")}.`);
    mechanicsCredit -= 0.5;
    meaning = true;
  }
  if (wrongName) {
    notes_.push(`It's signed "${found}", but your CV says "${expected}".`);
    mechanicsCredit -= 0.5;
    meaning = true;
  }
  if (format === "letter" && (!hasEmail || !hasPhone)) {
    notes_.push(`We couldn't find your ${[!hasEmail && "email", !hasPhone && "phone number"].filter(Boolean).join(" or ")} in the letter. Many letters carry them in the header, unless the application form already has them.`);
    mechanicsCredit -= 0.2;
  }
  if (format === "letter" && !greeting) {
    notes_.push("There's no greeting. A named person is often preferred where you can find one, and “Dear Hiring Manager” is common otherwise.");
    mechanicsCredit -= 0.2;
  }
  if (signoffOdd) {
    notes_.push(`“${signoff}” after “Dear ${greeting}” is unusual: UK guidance often pairs “Yours faithfully” with “Dear Sir or Madam” and “Yours sincerely” with a name. Conventions vary, so treat this as optional.`);
    mechanicsCredit -= 0.1;
    if (r.signoff) passages.push(ref(doc, { ...r.signoff, text: r.signoff.text }));
  }
  if (usSpell.length) {
    notes_.push(`US spellings, optional for a UK application: ${usSpell.slice(0, 3).map((w) => `"${w}" to "${US_SPELLINGS[w]}"`).join(", ")}.`);
    mechanicsCredit -= 0.1;
  }
  add("mechanics", meaning ? "meaning" : "style", notes_.length
    ? { status: "needs_attention", severity: meaning ? "high" : "low", credit: Math.max(0, mechanicsCredit), explanation: notes_.join(" "), action: meaning ? "Fix these before you send it." : "Optional: these are conventions rather than errors.", evidence: passages }
    : { status: "passed", severity: "info", credit: 1, explanation: format === "statement" ? "No gaps left to fill." : `No gaps left to fill, and the details are there${greeting ? `. Addressed to ${greeting}` : ""}.`, action: null, evidence: [] });

  // The number.
  const assessed = areas.filter((a) => a.credit !== null);
  const assessedWeight = assessed.reduce((s, a) => s + a.weight, 0);
  const total = areas.reduce((s, a) => s + a.weight, 0);
  const enough = assessedWeight >= MIN_ASSESSED_WEIGHT;
  const raw = enough ? Math.round((100 * assessed.reduce((s, a) => s + a.weight * a.credit!, 0)) / assessedWeight) : null;
  // A strong-looking number mustn't sit on top of a claim the CV doesn't back, a gap, the wrong name or no real reason for applying.
  const noReason = motivation.verdict === "generic" || motivation.verdict === "absent";
  const mustFix = blocks > 0 || placeholders.length > 0 || wrongName || noReason;
  const score = raw !== null && mustFix ? Math.min(raw, SCORE_CAP) : raw;
  const missing = areas.filter((a) => a.credit === null).map((a) => a.label.toLowerCase());
  const coverage: LetterReview["coverage"] = !enough ? "not_scored" : assessedWeight === total ? "complete" : "partial";
  const scoreNote = !enough ? `We could only assess part of this letter (${missing.join(", ")} couldn't be), so we haven't given a number. Add the advert or link a CV to get one.` : coverage === "partial" ? `Based on part of the letter: ${missing.join(", ")} couldn't be assessed and aren't in this number. ${SCORE_MEANING}` : SCORE_MEANING;
  const capNote = raw !== null && score !== raw ? ` Held at ${SCORE_CAP} until the points marked as affecting meaning are dealt with.` : "";

  return {
    version: LETTER_REVIEW_VERSION,
    method: "rules",
    letterVersion: doc,
    advertVersion: hasAdvert ? documentVersion(input.jobText) : null,
    notesVersion: notes ? documentVersion(notes) : null,
    cvVersion,
    context,
    score,
    coverage,
    scoreNote: scoreNote + capNote,
    areas,
    motivation,
    requirements,
    toConfirm: extraction.requirements.filter((q) => !q.assessable && q.category === "essential").map((q) => q.label),
    examples,
    factIssues,
    length: { words: length.words, verdict: length.verdict, explanation: length.explanation },
    placeholders,
    signedName: { expected: expected ?? null, found },
  };
}

/** The saved shape of an assessment: passages it refers to, or a statement of what's absent. */
export function letterReviewAssessment(review: LetterReview): Assessment {
  const findings: Finding[] = review.areas.map((a) => ({ id: a.key.replace(/_/g, "-"), check: a.label, status: a.status, severity: a.severity, confidence: null, method: "rules", explanation: a.explanation, action: a.action, evidence: a.evidence }));
  return {
    documentVersion: review.letterVersion,
    versions: { parser: null, rubric: review.version, model: null, dictionary: LEXICON_VERSION },
    origin: "engine",
    limits: ["Rules read the wording of the letter. They can't tell whether a reason is true or persuasive, and no adviser has validated them yet."],
    findings,
  };
}

export const letterSummary = (review: LetterReview): string => {
  const rank = { high: 0, medium: 1, low: 2, info: 3 };
  const todo = review.areas.filter((a) => a.status === "needs_attention").sort((a, b) => Number(a.impact === "style") - Number(b.impact === "style") || rank[a.severity] - rank[b.severity]);
  if (!todo.length) return "We found nothing to change in what we could check. Read it aloud once more and check every fact before you send it.";
  const first = todo[0];
  return `Start with ${first.label.toLowerCase()}: ${first.action ?? first.explanation}`;
};
