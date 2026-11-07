import { buildClaimInventory, figuresIn, readsLikeInstructions, withoutInstructions } from "@/lib/analysis/claims";
import { sha256 } from "@/lib/analysis/fingerprint";
import type { JobMatch, JobMatchRequirement } from "@/lib/types";
import { interviewQuestions, type InterviewQuestion } from "./practice";
import type { PracticeObjective, PracticePart, PracticeQuestion } from "./practice-types";

// OP-023: questions for one application, written by rules from the CV version the student chose and the advert's own
// requirements. No model writes a question or a reason. Every quote is taken word for word from those two texts, and a
// requirement or CV line that reads like instructions to software is left out instead of being repeated to the student.
// The templates are product judgments pending adviser review (docs/CONTENT_REVIEW.md).

export const MAX_QUESTIONS = 8;
const QUOTE_LIMIT = 220;
const MAX_CV_LINE_QUESTIONS = 3;

const part = (id: string, label: string, check: PracticePart["check"], terms?: string[]): PracticePart => (terms ? { id, label, check, terms } : { id, label, check });
const OWN_ACTION = part("own-action", "What you did yourself", "own_action");
const RESULT = part("result", "What happened as a result", "result");
const REASON = part("reason", "Your reasons", "reason");
const EXPERIENCE = part("experience", "How your own experience connects to it", "experience");
const LEARNED = part("learned", "What you learned or would change", "learned");
const TOPIC = part("topic", "An answer to what was asked", "topic");
const NAMED = part("named", "Something specific, by name", "named");

/* ---------- General practice: the static bank, with the same shape ---------- */

const EXTRA_PARTS: Record<string, PracticePart[]> = {
  g4: [part("priorities", "How you prioritised", "reason")],
  g5: [LEARNED],
  g7: [NAMED],
  t1: [LEARNED],
};

function staticParts(q: InterviewQuestion): PracticePart[] {
  const extra = EXTRA_PARTS[q.id] ?? [];
  if (q.kind === "competency") return [OWN_ACTION, RESULT, ...extra];
  if (q.kind === "motivation") return [REASON, EXPERIENCE, ...extra];
  return [TOPIC, REASON, ...extra];
}

/** No application needed. Says plainly that it's general, so nothing pretends to be about this student. */
export function generalQuestions(sector: string): PracticeQuestion[] {
  return interviewQuestions(sector).map((q) => ({
    id: q.id,
    q: q.q,
    kind: q.kind,
    tip: q.tip,
    why: sector && !/^g\d/.test(q.id) ? `A typical question for ${sector} roles. It isn't based on your CV or on one particular role.` : "A typical interview question. It isn't based on your CV or on one particular role.",
    grounds: null,
    parts: staticParts(q),
    focus: q.kind === "motivation" ? ["motivation"] : ["essential"],
  }));
}

/* ---------- Questions for one application ---------- */

export interface GroundedInput {
  role: string;
  org: string;
  /** The exact text of the version the student chose. */
  cvText: string;
  /** Null when there's no advert to read. */
  match: JobMatch | null;
  advertText: string | null;
  /** Requirements the student said don't apply to them. They aren't asked about. */
  notRelevant: string[];
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
/** Shows a quote as it stands, without doubling up its own full stop. */
const cvSays = (quote: string) => `Your CV says: "${quote}"${/[.!?]$/.test(quote) ? "" : "."}`;

/** Word for word from `source`, or null. A long quote is cut, never reworded: the cut text is still in the source. */
function quoteFrom(source: string, raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text || !source.includes(text) || withoutInstructions(text).removed > 0) return null;
  if (text.length <= QUOTE_LIMIT) return text;
  const cut = text.slice(0, QUOTE_LIMIT);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), 40));
}

const askable = (r: JobMatchRequirement) => r.assessable && r.kind !== "location" && r.kind !== "eligibility" && !readsLikeInstructions(r.label) && withoutInstructions(r.label).removed === 0;

function requirementQuestion(r: JobMatchRequirement, input: GroundedInput, headingOf: (quote: string) => string | null): PracticeQuestion | null {
  const advertQuote = input.advertText ? quoteFrom(input.advertText, r.source.quote) : null;
  const says = advertQuote ? `: "${advertQuote}"` : "";
  const stop = /[.!?]$/.test(advertQuote ?? "") ? "" : ".";
  const where = r.category === "essential" ? `The advert lists ${r.label} as essential${says}${stop}` : r.category === "desirable" ? `The advert says ${r.label} is desirable${says}${stop}` : r.category === "contextual" ? `The advert mentions ${r.label} as part of the work${says}, without saying you need it already.` : `The advert mentions ${r.label}${says}, but doesn't settle whether you need it.`;
  const requirement = { id: r.id, label: r.label, category: r.category, advertQuote };
  const named = part("requirement", `Whether you talk about ${r.label}`, "terms", [...r.terms, ...r.aliases, r.label]);
  const level = r.evidence.level;
  if (level === "none" || level === "not_assessed") {
    if (r.category !== "essential" && r.category !== "desirable") return null;
    return {
      id: `gap:${r.id}`,
      q: `The advert asks for ${r.label}, and this version of your CV doesn't show it. If an interviewer asked you about it, what would you say?`,
      kind: "competency",
      tip: "Keep to what's true. If you haven't done it, say so, then talk about the closest thing you really have done.",
      why: `${where} We didn't find it in this version of your CV, so it's worth knowing what you'd say. That doesn't mean you shouldn't apply.`,
      grounds: { requirement, cv: null, gap: true },
      parts: [part("honest", `Where you honestly stand on ${r.label}`, "honest_gap", [...r.terms, ...r.aliases, r.label]), part("closest", "The closest thing you really have done", "experience")],
      focus: ["gaps"],
    };
  }
  const refs = r.evidence.refs.map((x) => quoteFrom(input.cvText, x.quote)).filter((x): x is string => !!x);
  const quote = refs[0] ?? null;
  const heading = quote ? headingOf(quote) : null;
  const cv = quote ? { heading, quote } : null;
  const under = heading ? ` under ${heading}` : "";
  if (level === "weak") {
    return {
      id: `req:${r.id}`,
      q: r.kind === "tool" ? `Your CV names ${r.label}, but doesn't say what you did with it. Tell me about a time you actually used it: what was the task, what did you do yourself, and what happened?` : `Your CV names ${r.label}, but doesn't say much about it. Give me one real example: what was the task, what did you do yourself, and what happened?`,
      kind: "competency",
      tip: "One real example is enough. If you've only used it a little, say that.",
      why: `${where} This version of your CV names it only in a list${under}, so you may be asked what's behind it.`,
      grounds: { requirement, cv, gap: false },
      parts: [named, OWN_ACTION, RESULT],
      focus: r.category === "essential" ? ["essential", "cv"] : ["cv"],
    };
  }
  const shown = quote ? `${cvSays(quote)} ` : "";
  return {
    id: `req:${r.id}`,
    q:
      r.kind === "tool"
        ? `${shown}The advert asks for ${r.label}. Walk me through how you've used it: what did you do yourself, and what came of it?`
        : r.kind === "qualification"
          ? `${shown}The advert asks for ${r.label}. Tell me about one piece of work from it that's relevant to this role: what did you do yourself, and what came of it?`
          : `${shown}The advert asks for ${r.label}. Give me one example that shows it: what did you do yourself, and what came of it?`,
    kind: "competency",
    tip: "Say what you did, not just what the team did. Only include what really happened.",
    why: level === "explicit" ? `${where} This version of your CV mentions it${under}, so you could be asked to back that up.` : `${where} This version of your CV shows something related${under}, but doesn't name it, so you may need to explain the connection.`,
    grounds: { requirement, cv, gap: false },
    parts: [named, OWN_ACTION, RESULT],
    focus: r.category === "essential" ? ["essential", "cv"] : ["cv"],
  };
}

const rank = (q: PracticeQuestion) => {
  const c = q.grounds?.requirement?.category;
  if (c === "essential" && !q.grounds?.gap) return 0;
  if (c === "essential") return 1;
  if (q.id === "motivation") return 2;
  if (c === "desirable" && !q.grounds?.gap) return 3;
  if (q.id.startsWith("line:")) return 4;
  if (c === "desirable") return 5;
  return 6;
};

/** Every question this application can support, most useful first. The same inputs always give the same questions. */
export function groundedQuestions(input: GroundedInput): PracticeQuestion[] {
  const inv = buildClaimInventory(input.cvText);
  const headingOf = (quote: string) => clean(inv.entries.find((e) => e.rawLines.some((l) => l.includes(quote)) || e.lines.some((l) => l.includes(quote)))?.heading ?? "") || null;
  const out: PracticeQuestion[] = [];

  const skip = new Set(input.notRelevant);
  for (const r of input.match?.requirements ?? []) {
    if (!askable(r) || skip.has(r.id)) continue;
    const q = requirementQuestion(r, input, headingOf);
    if (q) out.push(q);
  }

  const role = clean(input.role);
  const org = clean(input.org);
  if (role && org && !readsLikeInstructions(role) && !readsLikeInstructions(org)) {
    out.push({
      id: "motivation",
      q: `Why do you want this ${role} role at ${org}?`,
      kind: "motivation",
      tip: "Name something specific about this employer, then connect it to something you've really done.",
      why: `You're applying for ${role} at ${org}, so the answer should be about them and not employers in general.`,
      grounds: null,
      parts: [REASON, part("employer", `Something about ${org}`, "terms", [org]), EXPERIENCE],
      focus: ["motivation"],
    });
  }

  const quoted = new Set(out.flatMap((q) => (q.grounds?.cv ? [q.grounds.cv.quote] : [])));
  const lines = inv.bullets.map((b) => b.text.trim()).filter((t) => t.split(/\s+/).length >= 4 && input.cvText.includes(t) && ![...quoted].some((q) => t.includes(q) || q.includes(t)));
  // Lines with a figure first: that's where an interviewer is most likely to ask how you know.
  const ordered = [...lines.filter((t) => figuresIn(t).length), ...lines.filter((t) => !figuresIn(t).length)];
  for (const line of [...new Set(ordered)].slice(0, MAX_CV_LINE_QUESTIONS)) {
    const quote = quoteFrom(input.cvText, line);
    if (!quote) continue;
    const heading = headingOf(quote);
    out.push({
      id: `line:${sha256(line).slice(0, 12)}`,
      q: `${cvSays(quote)} Talk me through it: what was your part, and what happened because of it?`,
      kind: "competency",
      tip: "If others were involved, say which part was yours. Only use figures you could explain.",
      why: `This line is on the CV version you chose${heading ? `, under ${heading}` : ""}. It isn't one of the advert's requirements, but anything on your CV can come up.`,
      grounds: { requirement: null, cv: { heading, quote }, gap: false },
      parts: [OWN_ACTION, RESULT],
      focus: ["cv"],
    });
  }
  return out.map((q, i) => [q, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([q]) => q);
}

/** The set shown for a chosen objective. An objective with nothing to offer returns nothing, and the page says so. */
export function questionsFor(all: PracticeQuestion[], objective: PracticeObjective): PracticeQuestion[] {
  return (objective === "all" ? all : all.filter((q) => q.focus.includes(objective))).slice(0, MAX_QUESTIONS);
}
