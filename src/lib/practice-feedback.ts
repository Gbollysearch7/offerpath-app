import { blankBrackets, bracketsIn, buildClaimInventory, figuresIn, namesIn, normaliseText, readsLikeInstructions, stem, toolsIn, wordsIn, type ClaimInventory } from "@/lib/analysis/claims";
import { explanationIsSafe } from "@/lib/analysis/explanation-check";
import { findTerm } from "@/lib/analysis/job-requirements";
import { checkProfile } from "@/lib/analysis/rewrite-check";
import { PRACTICE_FEEDBACK_VERSION, type ContributionLevel, type PracticeFeedback, type PracticePart, type PracticeQuestion, type SubstanceLevel } from "./practice-types";

// OP-023: feedback on a written answer, deterministic and with no provider. It keeps two questions apart: can the shape of
// an answer be seen (structure), and is there anything in it someone could ask about (substance). STAR words only ever
// count towards the first. Words from the question don't count towards the second, so repeating it earns nothing.
//
// Every sentence here is a fixed template or the student's own words, so feedback can't introduce an experience. It reads
// wording only: it can't tell whether an answer is true or right, and a determined student can pad it with real-looking
// words. The thresholds are uncalibrated product judgments, and no adviser has reviewed them.

/** Unique content words below this: there's little in the answer to ask about. Uncalibrated. */
export const MIN_CONTENT_WORDS = 8;
/** Unique content words needed before an answer can read as concrete. Uncalibrated. */
export const CONCRETE_CONTENT_WORDS = 12;
/** A sentence with fewer content words than this says what happened in words that could describe anything. Uncalibrated. */
const CONCRETE_SENTENCE_WORDS = 3;
const QUOTE_LIMIT = 200;

const STOPWORDS = new Set(
  `a about above after again against all also although am among an and any are around as at away back be became because become been before being below between both but by can could did do does doing done down during each either else even ever every few for from further had has have having he her here hers him his how however i i'd i'll i'm i've if in into is it it's its itself just let let's may me might more most much must my myself near need no nor not now of off on once one only onto or other our ours ourselves out over own per quite rather same she should since so some still such than that the their theirs them themselves then there these they this those though through to too two under until up upon us very was we we'd we're we've were what when where whether which while who whom whose why will with within without would yes yet you your yours yourself`.split(/\s+/),
);

// What every answer could say about anything: the words of the method, and praise a student can give themselves.
const STOCK = new Set<string>(
  `situation task action result results star outcome outcomes context background challenge challenges challenging difficult goal goals objective objectives aim aims job work worked working works hard team teams teamwork people person everyone everybody somebody someone something anything everything nothing thing things stuff lot lots good great well better best nice really important key main big huge successfully successful success positive positively improve improved improving improvement improvements impact impacted achieve achieved achieving achievement achievements deliver delivered delivering ensure ensured ensuring took take taking taken make made making decide decided deciding decision needed needing want wanted use used using get got getting went go going come came give gave given handle handled handling deal dealt managed manage managing lead led leading helped help helping ownership initiative responsibility responsible skills skill experience experiences learned learnt learning learn lesson lessons company organisation organization business role position time times day days way ways part problem problems issue issues solution solutions end finally first next overall like able happy pleased proud enjoyed example instance tell tried try trying focused focus communicated communication collaborated collaboration worked effective effectively efficient efficiently strong strongly passionate motivated new different various several many stated describe describing answer question`.split(/\s+/),
);

const LABEL = /^\s*(?:the\s+)?(situation|task|action|result|s|t|a|r)\s*[:\-–—]\s*/i;
const SENTENCE_BREAK = /(?<=[.!?])\s+|\n+/;
const NOT_AN_ACT = /^(?:am|was|were|have|had|think|thought|feel|felt|believe|believed|want|wanted|would|will|can|could|should|hope|hoped|need|needed|must|may|might|do|did|don't|didn't|like|love|enjoy|enjoyed|know|knew|guess|mean|am|see|saw)$/i;
const FIRST_PERSON_ACT = /\bI\s+(?:then\s+|also\s+|personally\s+|\w+ly\s+)?([A-Za-z'-]+)/g;
const WE = /\b(we|the team|the group|everyone)\b/i;
const RESULT_WORDS = /\b(results?|outcomes?|which meant|so that|led to|achieved|increased|decreased|reduced|saved|won|grew|improved|raised|cut|finished|launched|ended up|by the end|afterwards|because of (?:this|that|it))\b/i;
const CONTEXT_WORDS = /\b(when|during|while|last (?:year|summer|term|month)|in my|as (?:a|an|the)|at (?:my|the|university)|in (?:19|20)\d\d)\b/i;
const TASK_WORDS = /\b(my (?:task|job|role|aim|goal|responsibility) was|i (?:needed|had|was asked|was responsible) to|i was responsible for|we (?:needed|had) to|the (?:task|aim|goal) was)\b/i;
const REASON_WORDS = /\b(because|since|which is why|that's why|so that|as it|the reason)\b/i;
const LEARNED_WORDS = /\b(learn(?:ed|t)?|lesson|differently|next time|now i|i would (?:change|do|have)|i'd (?:change|do|have)|taught me)\b/i;
const NOT_DONE = /\b(haven't|have not|hasn't|not yet|no direct|don't have|do not have|never used|not used|am learning|i'm learning|am teaching myself|i'm teaching myself)\b/i;
// Claims that say how much or how well, which need something behind them in the same sentence.
const VAGUE_CLAIM = /\b(significantly|substantially|massively|hugely|greatly|dramatically|hugely|exceeded|outstanding|record-breaking|transformed|revolutioni[sz]ed|single-handedly|increased|reduced|improved|boosted|the best|always|everyone (?:said|agreed|loved)|all of the)\b/i;
// What a check result may report as a claim in an answer. Shape and wording findings are about CV lines, and don't apply to speech.
const CLAIM_CODES = new Set(["unsupported-figure", "unsupported-date", "unsupported-entity", "unsupported-qualification", "responsibility-raised", "scope-inflated"]);

const cut = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= QUOTE_LIMIT ? t : t.slice(0, Math.max(t.slice(0, QUOTE_LIMIT).lastIndexOf(" "), 60));
};

const STOCK_STEMS = new Set([...STOCK].map(stem));

function stemsOf(s: string, ignore: Set<string>): string[] {
  return wordsIn(blankBrackets(s))
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 2 && !/^\d/.test(w) && !STOPWORDS.has(w) && !STOCK.has(w))
    .map(stem)
    .filter((w) => !ignore.has(w) && !STOCK_STEMS.has(w));
}

const lowerWords = (s: string) => wordsIn(s).map((w) => w.toLowerCase());

interface Sentence {
  raw: string;
  /** Without a "Result:" style label. */
  text: string;
  content: string[];
  act: boolean;
  figures: string[];
}

function read(answer: string, ignore: Set<string>): { sentences: Sentence[]; ignored: number } {
  const sentences: Sentence[] = [];
  let ignored = 0;
  for (const raw of normaliseText(answer).split(SENTENCE_BREAK).map((s) => s.trim()).filter(Boolean)) {
    if (readsLikeInstructions(raw)) {
      ignored++;
      continue;
    }
    const text = raw.replace(LABEL, "");
    const blanked = blankBrackets(text);
    const acts = [...blanked.matchAll(FIRST_PERSON_ACT)].some((m) => !NOT_AN_ACT.test(m[1]));
    sentences.push({ raw, text, content: stemsOf(text, ignore), act: acts, figures: figuresIn(blanked).filter((f) => f.kind === "figure" && !f.vague).map((f) => f.raw) });
  }
  return { sentences, ignored };
}

function detailsIn(sentences: Sentence[], questionText: string): string[] {
  const echoed = new Set(lowerWords(questionText));
  const out: string[] = [];
  for (const s of sentences) {
    const blanked = blankBrackets(s.text);
    out.push(...s.figures);
    out.push(...toolsIn(blanked).filter((t) => !echoed.has(t.toLowerCase())));
    out.push(...namesIn(blanked).filter((n) => (!n.initial || n.distinctive) && !echoed.has(n.raw.toLowerCase()) && !/^(I|STAR)$/.test(n.raw)).map((n) => n.raw));
  }
  return [...new Map(out.map((d) => [d.toLowerCase(), d])).values()];
}

const hasTerm = (answer: string, terms: string[] = []) => terms.some((t) => t && findTerm(answer, t).length > 0);

function partSeen(p: PracticePart, a: { answer: string; concreteAct: boolean; concreteResult: boolean; sentences: Sentence[]; details: string[]; content: number }): boolean {
  const text = a.sentences.map((s) => s.text).join(" ");
  switch (p.check) {
    case "own_action":
      return a.concreteAct;
    case "result":
      return a.concreteResult;
    case "reason":
      return a.sentences.some((s) => REASON_WORDS.test(s.text) && s.content.length >= 2);
    case "experience":
      return a.sentences.some((s) => /\b(i|my)\b/i.test(s.text) && s.content.length >= CONCRETE_SENTENCE_WORDS);
    case "learned":
      return a.sentences.some((s) => LEARNED_WORDS.test(s.text) && s.content.length >= 1);
    case "named":
      return a.details.length > 0;
    case "terms":
      return hasTerm(text, p.terms);
    case "honest_gap":
      return hasTerm(text, p.terms) || NOT_DONE.test(text);
    case "topic":
      return a.content >= 5;
  }
}

const SUBSTANCE: Record<SubstanceLevel, string> = {
  little: "There isn't much here that someone could ask you about yet. It may sound like an answer, but it doesn't say what actually happened.",
  some: "There's some real detail here, but parts of it are still general. Look at what's listed below.",
  concrete: "That isn't a verdict on the answer: we can't tell whether it's accurate or what an interviewer would think.",
};

function contributionOf(q: PracticeQuestion, sentences: Sentence[], concrete: Sentence[]): PracticeFeedback["contribution"] {
  if (!q.parts.some((p) => p.check === "own_action" || p.check === "experience")) return { level: "not_asked", summary: "This question isn't asking about something you did.", quotes: [] };
  const shared = sentences.filter((s) => WE.test(s.text) && !s.act);
  const level: ContributionLevel = concrete.length && shared.length ? "mixed" : concrete.length ? "clear" : shared.length ? "shared" : "unclear";
  const summary: Record<ContributionLevel, string> = {
    clear: "You say what you did yourself. These are the sentences that show it.",
    mixed: "Some of this says what you did yourself, and some of it says what the group did. An interviewer may ask which parts were yours.",
    shared: 'This talks about what the group did. It doesn\'t yet say what your own part was. Saying "we" is fine if it\'s accurate, but add what you did.',
    unclear: "We couldn't find a sentence saying what you did yourself, in enough detail to be clear.",
    not_asked: "",
  };
  const quotes = (level === "shared" ? shared : concrete).slice(0, 2).map((s) => cut(s.raw));
  return { level, summary: summary[level], quotes };
}

function unsupportedIn(sentences: Sentence[], inv: ClaimInventory | null, allowed: string): PracticeFeedback["unsupported"]["items"] {
  const items: PracticeFeedback["unsupported"]["items"] = [];
  const seen = new Set<string>();
  const known = new Set(lowerWords(allowed));
  const add = (kind: "not_on_cv" | "no_detail", quote: string, note: string) => {
    const key = `${kind}:${quote.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      items.push({ kind, quote, note });
    }
  };
  for (const s of sentences) {
    if (inv) {
      const first = lowerWords(s.text)[0];
      for (const issue of checkProfile(inv, s.text).issues) {
        if (!CLAIM_CODES.has(issue.code) || issue.severity === "note" || !issue.found) continue;
        const found = issue.found.toLowerCase();
        // The employer's name, the question's own words, and a capital that only marks the start of a sentence aren't claims about the student.
        if (found === first || lowerWords(issue.found).every((w) => known.has(w))) continue;
        add("not_on_cv", issue.found, `"${issue.found}" isn't on the CV version you chose. If it's true, be ready to explain it, and think about adding it to your CV. If it isn't, take it out.`);
      }
    }
    const vague = s.text.match(VAGUE_CLAIM);
    if (vague && !s.figures.length) add("no_detail", cut(s.raw), `This says "${vague[0]}" with nothing to show by how much or how you know. Add what you can actually back up, or say it more plainly.`);
  }
  return items;
}

export interface FeedbackInput {
  question: PracticeQuestion;
  answer: string;
  /** The CV version the question came from. Null in general practice: nothing is compared, and the feedback says so. */
  cvText: string | null;
  /** Other text a claim may fairly come from: the advert, the role and the employer. */
  context?: string;
}

export function practiceFeedback({ question, answer, cvText, context = "" }: FeedbackInput): PracticeFeedback {
  // The question's own words are "worth nothing" here, so repeating them can't look like evidence. CV text quoted in it is part of that.
  const ignore = new Set(stemsOf(question.q, new Set()));
  const { sentences, ignored } = read(answer, ignore);
  const allContent = new Set(sentences.flatMap((s) => s.content));
  const words = answer.trim().split(/\s+/).filter(Boolean).length;
  const details = detailsIn(sentences, question.q);
  const concreteActs = sentences.filter((s) => s.act && s.content.length >= CONCRETE_SENTENCE_WORDS);
  const concreteResult = sentences.some((s) => RESULT_WORDS.test(s.text) && (s.figures.length > 0 || s.content.length >= 2));

  const needsStory = question.parts.some((p) => p.check === "own_action");
  let level: SubstanceLevel;
  if (allContent.size < MIN_CONTENT_WORDS || (needsStory && !concreteActs.length && !details.length)) level = "little";
  else if (needsStory) level = concreteActs.length && concreteResult && details.length && allContent.size >= CONCRETE_CONTENT_WORDS ? "concrete" : "some";
  else level = details.length && sentences.some((s) => REASON_WORDS.test(s.text)) && allContent.size >= CONCRETE_CONTENT_WORDS ? "concrete" : "some";

  const parts = question.parts.map((p) => ({ id: p.id, label: p.label, seen: partSeen(p, { answer, concreteAct: concreteActs.length > 0, concreteResult, sentences, details, content: allContent.size }) }));

  const has = (label: string) => normaliseText(answer).split(SENTENCE_BREAK).some((s) => new RegExp(`^\\s*(?:the\\s+)?${label}\\s*[:\\-–—]`, "i").test(s));
  const whole = sentences.map((s) => s.text).join(" ");
  const structure: PracticeFeedback["structure"] = [
    { key: "situation", label: "Situation", seen: has("situation") || CONTEXT_WORDS.test(whole) },
    { key: "task", label: "Task", seen: has("task") || TASK_WORDS.test(whole) },
    { key: "action", label: "Action", seen: has("action") || sentences.some((s) => s.act) },
    { key: "result", label: "Result", seen: has("result") || RESULT_WORDS.test(whole) },
  ];

  const inv = cvText ? buildClaimInventory(cvText) : null;
  const items = unsupportedIn(sentences, inv, `${question.q}\n${context}`);
  const blanks = bracketsIn(answer).slice(0, 10);

  const clearer: string[] = [];
  const missing = (id: string) => parts.some((p) => p.id === id && !p.seen);
  if (missing("own-action")) clearer.push("Say what you did yourself, in a sentence starting with \"I\" and naming the actual work.");
  if (missing("result")) clearer.push("Say what changed because of what you did, if you know. Only use what really happened.");
  if (needsStory && !details.length) clearer.push("Add one detail you could explain if asked, such as a real figure or the name of what you worked on. Leave it out if you don't have one.");
  if (blanks.length) clearer.push("Replace the blanks in square brackets with what really happened, or take them out.");
  if (words < 120) clearer.push(`It's ${words} words. About 150 to 300 is roughly two minutes spoken, if you have more that's true to say.`);
  if (words > 320) clearer.push(`It's ${words} words. About 150 to 300 is roughly two minutes spoken, so look for what you could cut.`);

  return {
    version: PRACTICE_FEEDBACK_VERSION,
    method: "rules",
    words,
    structure,
    substance: { level, summary: SUBSTANCE[level], details: details.slice(0, 8) },
    contribution: contributionOf(question, sentences, concreteActs),
    parts,
    unsupported: { compared: !!cvText, items: items.slice(0, 8) },
    clearer,
    modelNotes: [],
    blanks,
    ignoredSentences: ignored,
  };
}

/* ---------- What a model may add ---------- */

// Words for talking about an answer. They are added to the words a comment may use, alongside the student's own. No verb of
// having done something, no job, employer or award, and no praise: those can only come from what the student wrote.
const WORDS_FOR_FEEDBACK = `answer answers asked question questions claim claims detail details evidence figure figures part parts yourself mention mentions mentioned explain explains missing whether unclear vague general specific happened what said saying could would might interviewer ask asks tell tells sure actually exactly much many who when where why how own add adding say sentence contribution result reason reasons cv experience doesn't don't isn't aren't didn't`;

/** Praise, verdicts and anything about the person. A comment using these goes, even if the student's own answer used the word. */
const NEVER_IN_A_COMMENT = /\b(excellent|impressive|outstanding|great|perfect|amazing|strong|strongest|brilliant|fantastic|well done|good job|hire|hired|hireable|hirable|employab\w*|offer|personality|accent|appearance|confident|confidence|charisma\w*|articulate|natural|shortlist\w*|interview-ready|guarantee\w*|score|rating|out of \d+)\b/i;

export interface ModelNotesInput {
  raw: unknown;
  rules: PracticeFeedback;
  question: PracticeQuestion;
  answer: string;
  cvText: string | null;
}

const asDraft = (raw: unknown): { notAnswered: unknown[]; observations: unknown[] } | null => {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { notAnswered?: unknown; observations?: unknown };
  return Array.isArray(r.notAnswered) && Array.isArray(r.observations) ? { notAnswered: r.notAnswered, observations: r.observations } : null;
};

/**
 * Merges what a model returned into the rule feedback. It can only add a comment tied to words the student really wrote, or
 * mark a part as not answered. It can't raise the substance level, mark a part as answered, change the structure, remove a
 * claim or add a mark, so the worst bad output can do is be dropped. A comment must also pass the same check as any other
 * model explanation, with its words limited to the student's own text and a closed list. It can still recombine those words
 * into something misleading: the check is a rule set, and the report says so.
 */
export function withModelNotes({ raw, rules, question, answer, cvText }: ModelNotesInput): { feedback: PracticeFeedback; offered: number; kept: number } {
  const draft = asDraft(raw);
  if (!draft) return { feedback: rules, offered: 0, kept: 0 };
  const said = normaliseText(answer);
  const inv = buildClaimInventory([answer, question.q, cvText ?? "", WORDS_FOR_FEEDBACK].join("\n"));
  const notes: PracticeFeedback["modelNotes"] = [];
  for (const o of draft.observations.slice(0, 6)) {
    const x = o as { kind?: unknown; quote?: unknown; comment?: unknown };
    if (x.kind !== "contribution" && x.kind !== "unsupported" && x.kind !== "clearer") continue;
    if (typeof x.quote !== "string" || typeof x.comment !== "string") continue;
    const quote = x.quote.trim();
    if (quote.length < 8 || quote.length > 400 || !said.includes(normaliseText(quote))) continue;
    if (readsLikeInstructions(quote) || NEVER_IN_A_COMMENT.test(x.comment) || !explanationIsSafe(inv, x.comment)) continue;
    notes.push({ kind: x.kind, quote, comment: x.comment.trim() });
  }
  const flagged = new Set(draft.notAnswered.filter((id): id is string => typeof id === "string"));
  const parts = rules.parts.map((p) => (p.seen && flagged.has(p.id) ? { ...p, seen: false, flaggedByModel: true } : p));
  const changed = parts.filter((p) => p.flaggedByModel).length;
  const kept = notes.length + changed;
  if (!kept) return { feedback: rules, offered: draft.observations.length + flagged.size, kept: 0 };
  return { feedback: { ...rules, method: "rules+ai", parts, modelNotes: notes }, offered: draft.observations.length + flagged.size, kept };
}
