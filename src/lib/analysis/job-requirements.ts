// Reads requirements out of the words of a job advert (OP-012). Pure and deterministic: no provider,
// no clock, no network. An optional semantic adapter can add to this result through
// `mergeSemanticRequirements`, which validates everything it is given against the advert.
//
// What decides a category is what the advert says about a requirement (a cue in its clause, or the
// heading it sits under). How often a term appears is recorded as prominence and never read here to
// choose a category. The dictionaries below recognise and normalise terms; none of them is a list of
// what may be extracted, so a technology nobody has heard of is captured when the advert names it.
import { z } from "zod";
import type { EvidenceRef, JobRequirement, NotRequiredItem, RequirementCategory, RequirementKind } from "@/lib/types";
import { documentVersion } from "./findings";
import { DICTIONARY, TOOL_TERMS } from "./job";
import { SOFT_SKILLS } from "./lexicon";

/* ---------- Normalisation: aliases group the same thing, they do not limit what can be found ---------- */

/** Same length as the input, so offsets found in folded text are offsets in the original. */
export function fold(s: string): string {
  return s.replace(/[À-ɏ]/g, (c) => c.normalize("NFD")[0] ?? c);
}

/** canonical term -> other ways of writing it. Lower case, folded. */
export const TERM_ALIASES: Record<string, string[]> = {
  "financial modelling": ["financial modeling", "financial model", "financial models"],
  "stakeholder management": ["managing stakeholders", "stakeholder engagement"],
  "problem solving": ["problem-solving"],
  teamwork: ["team work", "team working", "teamworking", "working in a team"],
  analytical: ["analytic"],
  organisation: ["organization", "organisational", "organizational"],
  communication: ["communicate", "communicating", "communicator", "communicated"],
  collaboration: ["collaborate", "collaborated", "collaborating", "collaborative"],
  excel: ["microsoft excel", "ms excel"],
  word: ["microsoft word", "ms word"],
  powerpoint: ["microsoft powerpoint", "ms powerpoint", "power point"],
  javascript: ["js", "ecmascript"],
  typescript: ["ts"],
  postgresql: ["postgres"],
  aws: ["amazon web services"],
  gcp: ["google cloud platform", "google cloud"],
  kubernetes: ["k8s"],
  "node.js": ["nodejs", "node"],
  "machine learning": ["ml"],
  "ci/cd": ["cicd", "continuous integration"],
  "user experience": ["ux"],
  "power bi": ["powerbi"],
};

const ALIAS_TO_CANONICAL = new Map(Object.entries(TERM_ALIASES).flatMap(([canon, list]) => list.map((a) => [a, canon] as const)));

/** The key two spellings of one requirement share. Repetition and synonyms collapse onto it. */
export const termKey = (term: string): string => {
  const f = fold(term).toLowerCase().replace(/\s+/g, " ").trim();
  return ALIAS_TO_CANONICAL.get(f) ?? f;
};

/** Every way of writing a term we know of, including the term as the advert wrote it. */
export const spellingsOf = (term: string): string[] => {
  const key = termKey(term);
  return [...new Set([term, key, ...(TERM_ALIASES[key] ?? [])])];
};

// Names that are also everyday words, so only their capitalised form means the product or language.
const CASE_SENSITIVE = new Set(["go", "r", "c", "word", "access", "swift", "rust", "spark", "chef", "puppet", "ruby", "dart", "excel", "teams", "sheets", "shell", "ts", "js", "ml", "ux", "node"]);

const UPPER_ONLY = new Set(["ts", "js", "ml", "ux"]);

const escapeRe = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

/** Every place a term occurs in `text`, whole-word, with accents folded. Offsets are into `text`. */
export function findTerm(text: string, term: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const spelling of spellingsOf(term)) {
    const f = fold(spelling);
    const sensitive = CASE_SENSITIVE.has(f.toLowerCase());
    // A plural only for ordinary lower-case words: "dashboards" is "dashboard", but "Go" is not "Gos".
    const plural = /^[a-z][a-z ]{3,}$/.test(f) ? "s?" : "";
    const body = sensitive ? [...new Set([f.toUpperCase(), UPPER_ONLY.has(f.toLowerCase()) ? f.toUpperCase() : f.charAt(0).toUpperCase() + f.slice(1)])].map(escapeRe).join("|") : escapeRe(f);
    const re = new RegExp(`(?<![\\p{L}\\p{N}+#.])(?:${body})${plural}(?![\\p{L}\\p{N}+#]|\\.[\\p{L}\\p{N}])`, sensitive ? "gu" : "giu");
    for (const m of fold(text).matchAll(re)) out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out.sort((a, b) => a.start - b.start).filter((r, i, all) => i === 0 || r.start >= all[i - 1].end);
}

/* ---------- Cues ---------- */

const NEGATION: RegExp[] = [
  /\b(?:no|without)\s+((?:(?:prior|previous|formal|relevant|any|specific)\s+)*[^.,;:\n]{1,60}?)\s+(?:is\s+|are\s+)?(?:necessary|required|needed|essential|expected)\b/i,
  /\bno\s+need\s+(?:for|to have)\s+(?:a\s+|an\s+|any\s+)?([^.,;:\n]{1,60})/i,
  /\b(?:do not|don['’]t|dont|will not|won['’]t)\s+need\s+(?:to have\s+)?(?:a\s+|an\s+|any\s+)?([^.,;:\n]{1,60})/i,
  /\bwithout\s+((?:prior|previous|any)\s+experience)\b/i,
  /^(.{1,60}?)\s+(?:is\s+|are\s+)?not\s+(?:essential|required|necessary|needed|mandatory|a requirement)\b/i,
];
const NOT_ESSENTIAL_BUT = /\bnot\s+(?:essential|required|necessary|needed|mandatory)\b[^.;\n]{0,12}\b(?:but|though)\b/i;

const DESIRABLE_RE = /\b(desirable|nice[- ]to[- ]haves?|preferred|preferable|preferably|ideally|advantageous|an advantage|a plus|a bonus|bonus|beneficial|would be (?:great|good|useful|helpful|nice)|welcome|helpful|useful)\b/i;
const ESSENTIAL_RE = /\b(must[- ]haves?|must|essentials?|required|requires?|requirements?|mandatory|need to have|you(?:['’]ll| will) need|we need|you need|we require|non-negotiable|necessary)\b/i;
const UNCERTAIN_RE = /\b(should (?:have|be|know)|you(?:['’]ll| will) have|ideal candidate|looking for|expected to have)\b/i;
const USAGE_RE = /\b(?:is|are) used\b|\b(?:you|we|you['’]ll|you will|team|teams)\s+(?:will\s+|also\s+|often\s+)?(?:use|uses|using|work with|works with)\b/i;

// Text that sounds like a condition but is about the application process, or says nothing about the candidate.
const ADMIN_RE = /\b(apply|applying|submitted|closing date|deadline|salary|per annum|pension|holiday|equal opportunit\w+|reasonable adjustments?|we welcome|all applicants|applications? (?:must|should|close|will|are))\b/i;

// Longest first, so "you must have" goes as one piece rather than leaving "you have".
const CUE_STRIP = new RegExp(
  `\\b(?:${[
    "ideal candidates? (?:will|would|should) have", "you must have", "you must be", "you should have", "you should be", "you should know", "you(?:['’]ll| will) have", "you(?:['’]ll| will) need", "we require", "we need", "you need", "need to have", "we(?:['’]re| are) looking for", "looking for", "expected to have", "ideal candidates?",
    "must[- ]haves?", "must have", "must be", "must hold", "must possess", "must know", "must demonstrate", "must",
    "(?:is |are )?not (?:essential|required|necessary|needed|mandatory)", "(?:would be|is|are) (?:a |an )?(?:plus|bonus|advantage|advantageous|desirable|beneficial|preferred|welcome|helpful|useful|great|good|nice|essential|required|necessary|mandatory|a requirement)", "(?:is|are) a requirement",
    "nice[- ]to[- ]haves?", "essentials?", "desirable", "required", "requires?", "requirements?", "mandatory", "minimum", "non-negotiable", "necessary", "preferred", "preferable", "preferably", "ideally", "advantageous", "an advantage", "a plus", "a bonus", "bonus", "beneficial", "welcome", "helpful", "useful",
  ].join("|")})\\b`,
  "gi",
);

const LEAD = /^(?:(?:a|an|the|some|any|at least|your|our|strong|solid|good|great|excellent|exceptional|outstanding|proven|demonstrable|demonstrated|working|practical|hands[- ]on|basic|advanced|deep|sound|clear|relevant|previous|prior|professional|in[- ]depth|extensive|confident|must|have|has|having|be|being|with|using|of|in|to|and|or|is|are|you|we|use|also|either|able to|ability to)\s+|(?:experience|knowledge|understanding|familiarity|proficiency|proficient|expertise|skills?|background|exposure|competence|competency|capability|comfortable|fluency|fluent|grasp|command|mastery|confidence|use)\s+(?:of|with|in|using|to|at|on)\s+)/i;
const TRAIL = /\s+(?:skills?|experience|knowledge|proficiency|expertise|abilities|ability|background|tools?|tooling|platforms?|software|would|be|a|an|is|are|for this (?:role|job|position)|for the (?:role|job|position)|in this role|day[- ]to[- ]day|every day|daily)$/i;

const tidy = (s: string) => s.replace(/\s+/g, " ").replace(/^[\s:;,.\-–—•*·()]+|[\s:;,.\-–—•*·()]+$/g, "");

function cleanSegment(raw: string): string {
  let s = tidy(raw);
  for (let i = 0; i < 8; i++) {
    const next = tidy(s.replace(LEAD, "").replace(TRAIL, ""));
    if (next === s) break;
    s = next;
  }
  return s;
}

/* ---------- Term shapes ---------- */

// Capitalised words that are never the name of a skill. Sentence openers, and things adverts capitalise.
const NOT_A_NAME = new Set(
  "a an and any at be being but by can do for from have if in is it its join key may must no not of on or our role skills skill experience knowledge ability degree team teams the this to uk us eu usa we who will with you your yours they their these those strong excellent good great proven candidate candidates applicant applicants company graduate junior senior intern internship placement analyst scheme programme london manchester birmingham leeds bristol edinburgh glasgow cardiff belfast liverpool sheffield nottingham england scotland wales ireland britain monday tuesday wednesday thursday friday saturday sunday january february march april june july august september october november december cv phd".split(" "),
);
// Lower-case single words that an explicit cue can sit in front of without naming anything checkable.
const GENERIC_WORD = new Set(
  "ability abilities attitude candidate candidates enthusiasm motivated motivation passion passionate enthusiastic energy drive willingness eagerness interest curiosity flexibility experience skills skill knowledge work working role job team learning growth success".split(" "),
);
const ATOMIC_SLASH = /\b(?:CI\/CD|TCP\/IP|UI\/UX|A\/B|R&D|PL\/SQL|I\/O)\b/gi;

const isNamedToken = (t: string): boolean => {
  const w = t.replace(/^[("'“‘]+|[)"'”’,:;.]+$/g, "");
  if (!w || NOT_A_NAME.has(fold(w).toLowerCase())) return false;
  return /^\p{Lu}/u.test(w) || /^\.\p{L}/u.test(w) || /\p{Ll}\p{Lu}/u.test(w) || /^\p{L}+[+#]+$/u.test(w) || /\p{L}\d|\d\p{L}/u.test(w) || /^\p{L}[\p{L}\d]*\.(?:js|net|io|py)$/iu.test(w);
};
// Internal capitals, digits or symbols: shaped like a product name even at the start of a sentence.
const isDistinctiveToken = (t: string): boolean => /\p{Ll}\p{Lu}|\p{L}\d|\d\p{L}|[+#]|^\.\p{L}|^\p{Lu}{2,}$/u.test(t.replace(/[,:;.)]+$/, ""));

/** Runs of capitalised or product-shaped words: "Power BI", "Zorblax", "C++". */
function namedRuns(segment: string): string[] {
  const tokens = segment.split(/\s+/).filter(Boolean);
  const runs: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length) runs.push(run.join(" ").replace(/[,:;.)]+$/, ""));
    run = [];
  };
  tokens.forEach((t) => (isNamedToken(t) ? run.push(t) : flush()));
  flush();
  return runs;
}

const RECOGNISED = [...new Set([...SOFT_SKILLS, ...DICTIONARY])].filter((t) => t.length > 1).sort((a, b) => b.length - a.length);
const lowerHas = (lower: string, term: string) => new RegExp(`(?<![a-z0-9])${escapeRe(term)}(?![a-z0-9])`).test(lower);

function dictionaryHit(segment: string): string | null {
  const lower = fold(segment).toLowerCase();
  return RECOGNISED.find((term) => [term, ...(TERM_ALIASES[term] ?? [])].some((s) => lowerHas(lower, s))) ?? null;
}

/** "sql" to "SQL", "power bi" to "Power BI": dictionary terms are stored lower case. */
function displayName(term: string): string {
  const upper = new Set(["sql", "aws", "api", "vba", "cad", "seo", "nhs", "gcp"]);
  if (upper.has(term)) return term.toUpperCase();
  if (term === "power bi") return "Power BI";
  return term.charAt(0).toUpperCase() + term.slice(1);
}

interface Term {
  term: string;
  kind: RequirementKind;
  soft: boolean;
  /** False when the words could not be read as something checkable. Such an item is uncertain whatever its clause says. */
  confident: boolean;
}

/** Reads one list segment. Named words win over dictionary phrases, since "Azure" in "Azure reporting" is the requirement. */
function interpret(rawSegment: string, explicit: boolean): Term[] {
  const seg = cleanSegment(rawSegment);
  if (!seg || seg.length < 1) return [];
  const words = seg.split(" ");
  // "An interest in markets" asks for an attitude. Neither a CV keyword nor its absence says anything about it.
  if (/^(?:interest|passion|enthusiasm|curiosity|appetite|desire|keenness|willingness|eagerness)\b/i.test(seg)) return words.length <= 6 ? [{ term: seg, kind: "skill", soft: true, confident: false }] : [];
  const dict = dictionaryHit(seg);
  const asDict = (d: string): Term => ({ term: displayName(d), kind: TOOL_TERMS.has(d) ? "tool" : "skill", soft: SOFT_SKILLS.includes(d), confident: true });
  // "Attention to detail": a capital only because it opens the line, followed by ordinary words.
  const proseOpening = words.length > 1 && /^\p{Lu}\p{Ll}+$/u.test(words[0]) && !isNamedToken(words[1]) && !isDistinctiveToken(words[0]);
  const runs = namedRuns(seg).filter((r) => !(proseOpening && r === words[0].replace(/[,:;.)]+$/, "")));
  if (dict && (dict.includes(" ") || !runs.length || termKey(runs[0]) === termKey(dict))) return [asDict(dict)];
  if (runs.length) return runs.map((r) => ({ term: r, kind: "tool" as const, soft: false, confident: true }));
  if (dict) return [asDict(dict)];
  if (explicit && words.length === 1 && /^[\p{L}][\p{L}\d.+#-]*$/u.test(seg) && !GENERIC_WORD.has(seg.toLowerCase()) && !NOT_A_NAME.has(seg.toLowerCase())) return [{ term: seg, kind: "skill", soft: false, confident: true }];
  if (words.length <= 6 && !words.every((w) => GENERIC_WORD.has(w.toLowerCase()) || NOT_A_NAME.has(w.toLowerCase()))) return [{ term: seg, kind: "skill", soft: false, confident: false }];
  return [];
}

/* ---------- Conditions read from fixed patterns ---------- */

const ELIGIBILITY_RE = /\b(?:(?:the\s+)?right to work[^,.;\n]{0,30}|eligib(?:le|ility) to work[^,.;\n]{0,30}|(?:full\s+|valid\s+|clean\s+|uk\s+)*driving licen[cs]e|(?:sc|dv|security)\s+clearance|dbs(?:\s+check)?|work permit|visa sponsorship)/gi;
const LOCATION_RE = /\b(?:based in|located in|on[- ]site in|work from our|relocat\w+ to|commut\w+ to)\s+[^,.;\n]{1,40}|\b(?:hybrid|on[- ]site|fully remote)\s+(?:working|role|position)\b/gi;
const YEARS_RE = /(?:at least\s+|minimum(?:\s+of)?\s+)?\b(\d{1,2})\s*(?:\+|-\s*\d{1,2}|–\s*\d{1,2})?\s*(?:years?|yrs?)['’]?\s*(?:of\s+)?(?:([\p{L}][^,.;\n]{0,40}?)\s+)?experience\b(?:\s+(?:in|with|of|using)\s+([^,.;\n]{1,40}))?/giu;
const DEGREE_RE = /(?:(?:a|an|at least a|minimum of a|minimum)\s+)?(?:(?:2:1|2:2|2\.1|2\.2|first[- ]class|1st)\s+)?(?:(?:bachelor['’]?s?|master['’]?s?|undergraduate|postgraduate|BSc|BEng|MEng|MSc|PhD|MBA|LLB)\s+)?degree(?:\s+(?:in|from)\s+[^,.;\n]{1,50}?(?:,\s*\p{Lu}[\p{L}]*)*(?:\s+or\s+[^,.;\n]{1,30}?)?)?(?=\s*,|\s+and\s|\s*\.|\s*;|\s*$)/giu;
const GENERIC_EXPERIENCE = /^(?:(?:some|any|relevant|previous|prior|work|industry|professional|practical)\s+)*experience$/i;

/* ---------- Walking the advert ---------- */

type Strength = 1 | 2 | 3; // 1 a mention, 2 the heading it sits under, 3 a cue in its own clause
type Section = "essential" | "desirable" | "uncertain" | "contextual" | "ignored" | "none";

interface Clause {
  text: string;
  start: number;
  section: Section;
  heading: string | null;
}

function headingKind(line: string): { section: Section; heading: string } | null {
  const clean = tidy(line).replace(/:$/, "");
  if (!clean || clean.length > 60 || /[.!?]$/.test(line.trim())) return null;
  const l = clean.toLowerCase().replace(/[’]/g, "'");
  const endsColon = /:\s*$/.test(line);
  const caps = /^[^a-z]*$/.test(clean) && /[A-Z]{3}/.test(clean) && clean.includes(" ");
  // Without a colon or capitals, a short line is only a heading if it reads like one: "Requirements gathering with clients" isn't.
  const words = clean.split(/\s+/).length;
  if (!endsColon && !caps && !/^[A-Z]{3,}$/.test(clean) && words > (/^(?:what|who|you)\b/i.test(clean) ? 6 : 3)) return null;
  if (/^(?:about us|about the company|who we are|benefits|what we offer|what's in it|perks|why join|why work|salary|how to apply|next steps|equal opportunit|diversity|our values|our culture|the company|company)\b/.test(l)) return { section: "ignored", heading: clean };
  if (/^(?:(?:key |main |your )?responsibilities|(?:about )?the role|what you(?:'ll| will) (?:do|be doing)|your role|day[- ]to[- ]day|what the job involves|(?:main )?duties|role overview|job description|the job)\b/.test(l)) return { section: "contextual", heading: clean };
  if (/^(?:(?:desirable|preferred|nice[- ]to[- ]have|bonus|advantageous)\b|.{0,30}\b(?:would be (?:great|nice|a plus)|nice[- ]to[- ]have|desirable|bonus points?)\b)/.test(l)) return { section: "desirable", heading: clean };
  if (/^(?:essential|required|must[- ]haves?|(?:key |minimum |job )?requirements?|minimum|mandatory|person specification|qualifications|what (?:you(?:'ll| will)? )?need|what we need|you(?:'ll| will) need|what we(?:'re| are)? look(?:ing)? for|who we(?:'re| are) looking for|what you(?:'ll| will) bring|you (?:will )?have)\b/.test(l)) return { section: "essential", heading: clean };
  if (/^(?:(?:key |your )?skills|about you|who you are|(?:the )?ideal candidate|your profile|candidate profile|(?:your )?experience)\b/.test(l)) return { section: "uncertain", heading: clean };
  if (endsColon || caps) return { section: "none", heading: clean };
  return null;
}

const SENTENCE_END = /(?<!\b(?:e\.g|i\.e|etc|vs|inc|ltd))[.!?](?=\s|$)|;/gi;

function clausesOf(advert: string): Clause[] {
  const out: Clause[] = [];
  let section: Section = "none";
  let heading: string | null = null;
  for (const lineMatch of advert.matchAll(/[^\n]+/g)) {
    const raw = lineMatch[0];
    // A list item is content, even one as short as a heading.
    const found = /^\s*[•*·–—-]\s+/.test(raw) ? null : headingKind(raw);
    if (found) {
      section = found.section;
      heading = found.heading;
      continue;
    }
    let from = 0;
    const ends = [...raw.matchAll(SENTENCE_END)].map((m) => m.index + 1);
    for (const end of [...ends, raw.length]) {
      if (end <= from) continue;
      const piece = raw.slice(from, end);
      const lead = piece.length - piece.trimStart().length;
      const bullet = piece.trimStart().match(/^[•*·–—-]\s+/)?.[0].length ?? 0;
      const text = piece.trim().replace(/^[•*·–—-]\s+/, "").trimEnd();
      if (text) out.push(...splitMixed({ text, start: lineMatch.index + from + lead + bullet, section, heading }));
      from = end;
    }
  }
  return out;
}

const cueCategory = (s: string): "essential" | "desirable" | null => (DESIRABLE_RE.test(s) ? "desirable" : ESSENTIAL_RE.test(s) ? "essential" : null);

/** "Kubernetes is essential and Excel is desirable" holds two clauses with two different meanings. */
function splitMixed(c: Clause): Clause[] {
  if (NOT_ESSENTIAL_BUT.test(c.text)) return [c];
  for (const m of c.text.matchAll(/\s+(?:and|but|while|whereas|although|though)\s+|,\s+(?:(?:and|but)\s+)?|\s*[–—]\s+/gi)) {
    const left = c.text.slice(0, m.index);
    const right = c.text.slice(m.index + m[0].length);
    const a = cueCategory(left);
    const b = cueCategory(right);
    if (a && b && a !== b) return [{ ...c, text: left }, ...splitMixed({ ...c, text: right, start: c.start + m.index + m[0].length })];
  }
  return [c];
}

interface Observed {
  terms: Term[];
  label: string;
  aliases: string[];
  orEquivalent: boolean;
  category: RequirementCategory;
  strength: Strength;
  reason: string;
  clause: Clause;
  assessable: boolean;
  kind: RequirementKind;
}

function classify(c: Clause): { category: RequirementCategory; strength: Strength; reason: string } {
  const under = c.heading ? `under the heading “${c.heading}”` : "";
  if (NOT_ESSENTIAL_BUT.test(c.text) || DESIRABLE_RE.test(c.text)) return { category: "desirable", strength: 3, reason: "The advert's wording marks this as desirable." };
  if (ESSENTIAL_RE.test(c.text)) return { category: "essential", strength: 3, reason: "The advert's wording marks this as required." };
  if (USAGE_RE.test(c.text)) return { category: "contextual", strength: 2, reason: "The advert describes this as part of the work, without saying candidates need it already." };
  if (c.section === "essential" || c.section === "desirable") return { category: c.section, strength: 2, reason: `Listed ${under}.` };
  if (UNCERTAIN_RE.test(c.text)) return { category: "uncertain", strength: 2, reason: "The advert mentions this but doesn't say whether it is required." };
  if (c.section === "uncertain") return { category: "uncertain", strength: 2, reason: `Listed ${under}, which doesn't say whether it is required.` };
  return { category: "contextual", strength: 1, reason: "Mentioned in the advert with no statement that candidates need it." };
}

/** Parenthetical spelling of the term before it: "Kubernetes (K8s)". Returned text has it removed. */
function takeInlineAliases(text: string): { text: string; aliases: Map<string, string[]> } {
  const aliases = new Map<string, string[]>();
  const out = text.replace(/([\p{L}\d.+#-]+)\s*\(([\p{L}\d.+#/-]{1,20})\)/gu, (whole, before: string, inside: string) => {
    if (/^(?:e\.g|i\.e|etc|or|and|essential|required|desirable|preferred)/i.test(inside) || !isNamedToken(before) || !isNamedToken(inside)) return whole;
    aliases.set(termKey(before), [...(aliases.get(termKey(before)) ?? []), inside]);
    return before;
  });
  return { text: out, aliases };
}

interface Group {
  alternatives: string[];
  orEquivalent: boolean;
}

/** Splits a requirement list into groups: separate items are all needed, the members of one group are alternatives. */
function groupsOf(text: string): Group[] {
  // Protect names containing a slash before treating slashes as "or".
  const atoms: string[] = [];
  const shielded = text
    .replace(ATOMIC_SLASH, (m) => {
      atoms.push(m);
      return `ATOM${atoms.length - 1}ATOM`;
    })
    .replace(/\band\s*\/\s*or\b/gi, " or ")
    .replace(/\s*\(\s*(?:e\.g\.?|i\.e\.?|such as|for example|including)\s*/gi, " such as ")
    .replace(/\)/g, " ")
    .replace(/\(/g, ", ");
  const restore = (s: string) => s.replace(/ATOM(\d+)ATOM/g, (_, i) => atoms[Number(i)]);
  const groups: Group[] = [];
  const pushGroup = (parts: string[]) => {
    const equivalent = parts.filter((p) => /^(?:(?:an?\s+)?(?:similar|equivalent|comparable|other|another)\b)/i.test(p.trim()));
    groups.push({ alternatives: parts.filter((p) => !equivalent.includes(p)).map(restore), orEquivalent: equivalent.length > 0 });
  };
  const splitOr = (s: string) => s.split(/\s+or\s+|(?<=[\p{L}\d+#])\s*\/\s*(?=[\p{L}.])/u).map((p) => p.trim()).filter(Boolean);

  // Examples: "BI tools such as X or Y" means either will do, and the general words before it are not a term.
  const example = shielded.match(/\b(?:such as|including|for example|e\.g\.?)\s+/i);
  if (example) {
    const before = shielded.slice(0, example.index);
    const list = shielded.slice(example.index! + example[0].length);
    const named = list.split(/,|\s+and\s+|\s+or\s+/i).map((p) => p.trim()).filter(Boolean);
    if (before.trim() && namedRuns(cleanSegment(before)).length) groups.push(...groupsOf(before));
    groups.push({ alternatives: named.map(restore), orEquivalent: true });
    return groups;
  }

  const hasAnd = /\s+and\s+|\s+&\s+|\s+as well as\s+/i.test(shielded);
  if (!hasAnd && /,/.test(shielded) && /\s+or\s+/i.test(shielded)) {
    // "Python, Java or Go": one choice, not three requirements.
    pushGroup(shielded.split(/,|\s+or\s+/i).map((p) => p.trim()).filter(Boolean));
    return groups.filter((g) => g.alternatives.length);
  }
  for (const seg of shielded.split(/,|\s+and\s+|\s+&\s+|\s+as well as\s+|\s+plus\s+/i)) if (seg.trim()) pushGroup(splitOr(seg));
  return groups.filter((g) => g.alternatives.length);
}

const labelOf = (terms: Term[]) => (terms.length < 3 ? terms.map((t) => t.term).join(" or ") : `${terms.slice(0, -1).map((t) => t.term).join(", ")} or ${terms[terms.length - 1].term}`);

function observeClause(c: Clause, notRequired: NotRequiredItem[], ref: (start: number, end: number) => EvidenceRef): Observed[] {
  const clause = c.text;
  const source = () => ref(c.start, c.start + clause.length);
  if (c.section === "ignored" || ADMIN_RE.test(clause)) return [];

  // Negation first: nothing named here can become a requirement.
  if (!NOT_ESSENTIAL_BUT.test(clause)) {
    for (const re of NEGATION) {
      const m = clause.match(re);
      if (!m) continue;
      const subject = tidy(m[1]);
      notRequired.push({ label: subject.charAt(0).toUpperCase() + subject.slice(1), terms: groupsOf(subject).flatMap((g) => g.alternatives.flatMap((a) => interpret(a, true).map((t) => t.term))), source: source() });
      return [];
    }
  }

  const { category, strength, reason } = classify(c);
  const out: Observed[] = [];
  const condition = (label: string, kind: RequirementKind) => out.push({ terms: [{ term: label, kind, soft: false, confident: true }], label, aliases: [], orEquivalent: false, category, strength, reason, clause: c, assessable: false, kind });

  // Patterns take their words out of the clause, so "a 2:1 degree" doesn't also become a list item.
  let rest = clause;
  rest = rest.replace(ELIGIBILITY_RE, (m) => (condition(tidy(m), "eligibility"), " , "));
  rest = rest.replace(LOCATION_RE, (m) => (condition(tidy(m), "location"), " , "));
  rest = rest.replace(YEARS_RE, (m, _n, mid?: string, after?: string) => {
    condition(`${tidy(m.match(/\d[^a-z]*(?:years?|yrs?)/i)?.[0] ?? m)}' experience`, "experience");
    return ` , ${mid ?? ""} ${after ?? ""} , `;
  });
  rest = rest.replace(DEGREE_RE, (m) => {
    const label = tidy(m.replace(/^(?:a|an|at least a|minimum of a|minimum)\s+/i, ""));
    out.push({ terms: [{ term: label, kind: "qualification", soft: false, confident: true }], label, aliases: [], orEquivalent: false, category, strength, reason, clause: c, assessable: true, kind: "qualification" });
    return " , ";
  });

  const explicit = strength >= 2 && (category === "essential" || category === "desirable" || category === "uncertain");

  if (explicit) {
    if (GENERIC_EXPERIENCE.test(cleanCue(rest))) {
      condition(tidy(cleanCue(rest)), "experience");
      return out;
    }
    const { text, aliases } = takeInlineAliases(cleanCue(rest));
    for (const g of groupsOf(text)) {
      const terms: Term[] = g.alternatives.flatMap((a) => (GENERIC_EXPERIENCE.test(tidy(a)) ? [] : interpret(a, true)));
      if (g.alternatives.some((a) => GENERIC_EXPERIENCE.test(tidy(a)))) condition(tidy(g.alternatives.find((a) => GENERIC_EXPERIENCE.test(tidy(a)))!), "experience");
      if (!terms.length) continue;
      const uncertainWording = terms.some((t) => !t.confident);
      out.push({
        terms,
        label: labelOf(terms),
        aliases: terms.flatMap((t) => aliases.get(termKey(t.term)) ?? []),
        orEquivalent: g.orEquivalent,
        category: uncertainWording ? "uncertain" : category,
        strength: uncertainWording ? 1 : strength,
        reason: uncertainWording ? "We couldn't read this as a specific skill to look for, so it isn't counted." : reason,
        clause: c,
        assessable: !uncertainWording,
        kind: terms[0].kind,
      });
    }
    return out;
  }

  // Narrative: only named tools and well-known multi-word terms, and proper names only after a word that introduces a tool.
  const seen = new Set<string>();
  const mention = (t: Term) => {
    const key = termKey(t.term);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ terms: [t], label: t.term, aliases: [], orEquivalent: false, category, strength, reason, clause: c, assessable: true, kind: t.kind });
  };
  const subject = rest.match(/^\s*(.{1,40}?)\s+(?:is|are)\s+used\b/i);
  if (subject) for (const g of groupsOf(subject[1])) for (const a of g.alternatives) interpret(a, true).filter((t) => t.confident).forEach(mention);
  for (const m of rest.matchAll(/\b(?:using|use|uses|with|in|via|including|such as|like)\s+([^.;:\n]{1,80})/gi)) {
    for (const seg of m[1].split(/,|\s+and\s+|\s+or\s+/i)) {
      const runs = namedRuns(seg.trim().split(/\s+(?:to|for|in|at|on|by|every|across)\s+/i)[0]);
      if (!runs.length) break;
      for (const r of runs) mention({ term: r, kind: "tool", soft: false, confident: true });
    }
  }
  for (const token of rest.split(/\s+/)) if (isDistinctiveToken(token) && isNamedToken(token)) mention({ term: token.replace(/[,:;.)]+$/, ""), kind: "tool", soft: false, confident: true });
  const lower = fold(rest).toLowerCase();
  for (const term of DICTIONARY) {
    if (!(term.includes(" ") || TOOL_TERMS.has(term)) || term.length < 2) continue;
    if ([term, ...(TERM_ALIASES[term] ?? [])].some((s) => new RegExp(`(?<![a-z0-9])${escapeRe(s)}(?![a-z0-9])`).test(lower))) mention({ term: displayName(term), kind: TOOL_TERMS.has(term) ? "tool" : "skill", soft: SOFT_SKILLS.includes(term), confident: true });
  }
  return out;
}

const cleanCue = (s: string) => s.replace(CUE_STRIP, " ").replace(/^\s*[:\-–—]+\s*/, " ");

/* ---------- Result ---------- */

export interface RequirementExtraction {
  requirements: JobRequirement[];
  notRequired: NotRequiredItem[];
}

const CATEGORY_ORDER: RequirementCategory[] = ["essential", "desirable", "contextual", "uncertain"];
/** Most requirements one report records. An advert longer than this is cut, and the limit is stated. */
export const MAX_REQUIREMENTS = 60;

const groupKey = (terms: string[]) => [...new Set(terms.map(termKey))].sort().join(" | ");

function occurrences(advert: string, terms: string[], aliases: string[]): number {
  const ranges = [...terms, ...aliases].flatMap((t) => findTerm(advert, t));
  return new Set(ranges.map((r) => r.start)).size;
}

/** Reads an advert into requirements. Same text in, same result out. */
export function extractRequirements(advert: string): RequirementExtraction {
  const version = documentVersion(advert);
  const ref = (start: number, end: number): EvidenceRef => ({ documentVersion: version, block: "doc", range: { start, end }, quote: advert.slice(start, end) });
  const notRequired: NotRequiredItem[] = [];
  const observed = clausesOf(advert).flatMap((c) => observeClause(c, notRequired, ref));

  const merged = new Map<string, Observed>();
  for (const o of observed) {
    const key = groupKey(o.terms.map((t) => t.term));
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, o);
      continue;
    }
    prev.aliases = [...new Set([...prev.aliases, ...o.aliases])];
    if (o.strength > prev.strength) {
      merged.set(key, { ...o, aliases: prev.aliases });
    } else if (o.strength === prev.strength && o.category !== prev.category) {
      const firm = (c: RequirementCategory) => c === "essential" || c === "desirable";
      if (firm(o.category) && firm(prev.category)) {
        prev.category = "uncertain";
        prev.reason = "The advert describes this as both required and desirable, so we don't count it either way.";
      } else if (CATEGORY_ORDER.indexOf(o.category) < CATEGORY_ORDER.indexOf(prev.category)) {
        merged.set(key, { ...o, aliases: prev.aliases });
      }
    }
  }

  // A term mentioned in passing belongs to the alternative group that already holds it, not a second requirement.
  const groups = [...merged.values()].filter((o) => o.terms.length > 1);
  const inGroup = new Set(groups.flatMap((g) => g.terms.map((t) => termKey(t.term))));
  const negated = new Set(notRequired.flatMap((n) => n.terms.map(termKey)));

  const requirements: JobRequirement[] = [...merged.values()]
    .filter((o) => !(o.terms.length === 1 && o.strength === 1 && inGroup.has(termKey(o.terms[0].term))))
    .map((o) => {
      const conflict = o.terms.every((t) => negated.has(termKey(t.term))) && o.kind !== "experience";
      return {
        id: "",
        label: o.label,
        kind: o.kind,
        category: conflict ? ("uncertain" as const) : o.category,
        terms: o.terms.map((t) => t.term),
        aliases: o.aliases,
        orEquivalent: o.orEquivalent,
        soft: o.terms.every((t) => t.soft),
        occurrences: o.assessable && o.kind !== "qualification" ? occurrences(advert, o.terms.map((t) => t.term), o.aliases) : 1,
        reason: conflict ? "The advert both asks for this and says it isn't needed, so we don't count it either way." : o.reason,
        source: ref(o.clause.start, o.clause.start + o.clause.text.length),
        method: "rules" as const,
        assessable: o.assessable,
      };
    });
  return { requirements: finish(requirements), notRequired };
}

function finish(list: JobRequirement[]): JobRequirement[] {
  return [...list]
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || (a.source.range?.start ?? 0) - (b.source.range?.start ?? 0))
    .slice(0, MAX_REQUIREMENTS)
    .map((r, i) => ({ ...r, id: `req-${i + 1}` }));
}

/* ---------- The optional semantic adapter ---------- */

export const SemanticRequirementsSchema = z.object({
  requirements: z
    .array(
      z.object({
        label: z.string().min(1).max(120),
        terms: z.array(z.string().min(1).max(60)).min(1).max(8),
        category: z.enum(["essential", "desirable", "contextual", "uncertain"]),
        kind: z.enum(["skill", "tool", "qualification", "experience", "location", "eligibility"]),
        quote: z.string().min(1).max(600),
      }),
    )
    .max(MAX_REQUIREMENTS),
});
export type SemanticRequirements = z.infer<typeof SemanticRequirementsSchema>;

export type AdapterStatus = "not_used" | "applied" | "failed";

/** Rules-first: a provider call is only worth its cost when the rules left most of the advert undecided. */
export function needsSemanticReview(x: RequirementExtraction): boolean {
  const firm = x.requirements.filter((r) => r.assessable && (r.category === "essential" || r.category === "desirable")).length;
  const open = x.requirements.filter((r) => r.category === "uncertain" || r.category === "contextual").length;
  return firm < 2 || open > firm;
}

/** Finds a quotation in the advert, allowing only for differences in whitespace. */
function locate(advert: string, quote: string): { start: number; end: number } | null {
  const pattern = quote.trim().split(/\s+/).map(escapeRe).join("\\s+");
  if (!pattern) return null;
  const m = advert.match(new RegExp(pattern));
  return m && m.index !== undefined ? { start: m.index, end: m.index + m[0].length } : null;
}

/**
 * Adds a semantic adapter's reading to the rules' reading, trusting none of it. Malformed output is
 * discarded whole. An item survives only if its quotation is in the advert and its terms are in that
 * quotation, and only if the quotation doesn't contradict its category. A requirement whose category
 * the rules read from the advert's own words stays as the rules read it: the adapter can decide what
 * the rules left open, and add what they missed.
 */
export function mergeSemanticRequirements(advert: string, rules: RequirementExtraction, raw: unknown): { extraction: RequirementExtraction; status: AdapterStatus; rejected: number } {
  if (raw === undefined) return { extraction: rules, status: "not_used", rejected: 0 };
  const parsed = SemanticRequirementsSchema.safeParse(raw);
  if (!parsed.success) return { extraction: rules, status: "failed", rejected: 0 };

  const version = documentVersion(advert);
  const list = [...rules.requirements];
  const negated = new Set(rules.notRequired.flatMap((n) => n.terms.map(termKey)));
  let rejected = 0;
  for (const item of parsed.data.requirements) {
    const at = locate(advert, item.quote);
    if (!at) {
      rejected++;
      continue;
    }
    const quote = advert.slice(at.start, at.end);
    const terms = [...new Set(item.terms.map((t) => t.trim()).filter(Boolean))];
    const contradicted = NEGATION.some((re) => re.test(quote)) || (item.category === "essential" && DESIRABLE_RE.test(quote) && !ESSENTIAL_RE.test(quote)) || (item.category === "desirable" && ESSENTIAL_RE.test(quote) && !DESIRABLE_RE.test(quote));
    if (!terms.length || contradicted || terms.some((t) => !findTerm(quote, t).length || negated.has(termKey(t)))) {
      rejected++;
      continue;
    }
    const key = groupKey(terms);
    const existing = list.findIndex((r) => groupKey(r.terms) === key);
    const source: EvidenceRef = { documentVersion: version, block: "doc", range: at, quote };
    const assessable = item.kind !== "location" && item.kind !== "eligibility";
    const entry = (): JobRequirement => ({ id: "", label: terms.join(" or "), kind: item.kind, category: item.category, terms, aliases: [], orEquivalent: false, soft: terms.every((t) => SOFT_SKILLS.includes(termKey(t))), occurrences: occurrences(advert, terms, []), reason: "Read from the quoted wording by the AI reading of the advert; the quotation was checked against the advert.", source, method: "ai", assessable });
    if (existing < 0) list.push(entry());
    else if (list[existing].category === "uncertain" || list[existing].category === "contextual") {
      // Only what the rules didn't settle. A conflict in the advert's own wording stays visible as uncertain.
      if (!/both/.test(list[existing].reason)) list[existing] = { ...entry(), aliases: list[existing].aliases };
    }
  }
  return { extraction: { requirements: finish(list), notRequired: rules.notRequired }, status: "applied", rejected };
}

/**
 * Runs the rules, and the adapter when one is supplied and the rules left the advert open. Whatever
 * the adapter does (throw, time out, return nonsense), the answer is still the rules' reading.
 */
export async function extractWithAdapter(advert: string, adapter?: () => Promise<unknown>): Promise<{ extraction: RequirementExtraction; status: AdapterStatus; rejected: number }> {
  const rules = extractRequirements(advert);
  if (!adapter || !needsSemanticReview(rules)) return { extraction: rules, status: "not_used", rejected: 0 };
  let raw: unknown;
  try {
    raw = await adapter();
  } catch {
    return { extraction: rules, status: "failed", rejected: 0 };
  }
  // A null is how the provider wrapper reports a failed call.
  if (raw === null || raw === undefined) return { extraction: rules, status: "failed", rejected: 0 };
  return mergeSemanticRequirements(advert, rules, raw);
}
