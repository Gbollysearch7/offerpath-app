import type { Finding } from "@/lib/types";
import { evidenceFor, plural, supplementalFinding, type CvReading } from "./supplemental-context";

// First-person pronouns (OP-009). The convention being explained is narrow: bullet points under a role usually
// drop "I" and "my". That isn't a grammar error, and it says nothing about a personal statement, a quotation, an
// interests section or a company called We Are Social, so none of those is flagged.

/** Sections whose lines are bullet-style evidence. Everything else (summary, header, skills, interests, references, contact) is left alone. */
const SCOPED = new Set(["experience", "projects", "activities", "achievements", "education"]);
/** Where first person is the normal register. Hits here are counted so the finding can say they were left alone. */
const STATEMENT = new Set(["summary", "header"]);

const SINGULAR = new Set(["i", "me", "my", "mine", "myself"]);

// Case-sensitive on purpose: "US", "ME", "MY" and "OUR" in capitals are abbreviations or headings, not pronouns.
const PRONOUN_RE = /(?<![\p{L}\p{N}\-/&.])(?<!\p{L}')(I|i|me|Me|my|My|mine|Mine|myself|Myself|we|We|our|Our|ours|Ours|ourselves|Ourselves|us|Us)(?![\p{L}\p{N}\-/&])/gu;
/** "Phase I", "Level I", "Henry I": the Roman numeral. */
const NUMERAL_BEFORE_RE = /\b(?:part|phase|level|stage|type|tier|grade|class|series|chapter|volume|vol|act|war|section|module|unit|henry|edward|elizabeth|charles|james|george|william|mary)\s*$/i;
/** "data mine", "coal mine": the noun, not the pronoun. */
const MINE_NOUN_BEFORE_RE = /\b(?:data|text|gold|coal|tin|copper|salt|diamond|silver|land|open-pit)\s*$/i;
/** "A L I C E": a name typed with letter spacing has letters in it, not pronouns. */
const LETTER_SPACED_RE = /^\s*(?:\S\s){3,}\S\s*$/;
const SINGLE_QUOTED_RE = /(^|[\s(])'[^']{1,200}'(?=[\s.,;:!?)]|$)/g;

/** Offsets of what is inside quotation marks on a line, and whether a double quotation is still open at the end of it. */
export function quotedSpans(line: string, open: boolean): { spans: [number, number][]; open: boolean } {
  const spans: [number, number][] = [];
  let from = open ? 0 : -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== '"') continue;
    if (from === -1) from = i;
    else {
      spans.push([from, i + 1]);
      from = -1;
    }
  }
  const stillOpen = from !== -1;
  if (stillOpen) spans.push([from, line.length]);
  for (const m of line.matchAll(SINGLE_QUOTED_RE)) spans.push([m.index + m[1].length, m.index + m[0].length]);
  return { spans, open: stillOpen };
}

export interface PronounHit {
  line: number;
  word: string;
  /** flagged: a first-person word in a bullet-style line. The others were left alone, for the reason named. */
  kind: "flagged" | "quotation" | "statement";
}

function isPronoun(line: string, word: string, at: number): boolean {
  const before = line.slice(Math.max(0, at - 24), at);
  const after = line.slice(at + word.length);
  if (word === "I" && NUMERAL_BEFORE_RE.test(before)) return false;
  // "i.e.", "(i)", "i)" are numbering and abbreviations. "I." with a capital is not worth guessing at either.
  if ((word === "i" || word === "I") && /^[.)]/.test(after)) return false;
  if ((word === "mine" || word === "Mine") && (MINE_NOUN_BEFORE_RE.test(before) || /^\s+(?:data|text|site|shaft|worker)/i.test(after))) return false;
  // A capitalised word followed by another capitalised word is a name: "Our Lady's School", "We Are Social".
  if (word !== "I" && /^[A-Z]/.test(word) && /^\s+[A-Z]/.test(after)) return false;
  return true;
}

/** Whether a line can be flagged at all. Education's non-bullet lines are mostly names of schools and courses, so only its sentences count. */
function inScope(cv: CvReading, line: number): boolean {
  if (cv.isHeading(line) || cv.isRole(line)) return false;
  if (!SCOPED.has(cv.sectionAt(line))) return false;
  return cv.sectionAt(line) !== "education" || cv.isBullet(line) || /[.!?]$/.test(cv.lines[line]);
}

export function pronounHits(cv: CvReading): PronounHit[] {
  const hits: PronounHit[] = [];
  let open = false;
  cv.lines.forEach((text, line) => {
    if (cv.isHeading(line) || cv.isRole(line) || cv.isBullet(line)) open = false;
    const quotes = quotedSpans(text, open);
    open = quotes.open;
    const section = cv.sectionAt(line);
    const scoped = inScope(cv, line);
    if ((!scoped && !STATEMENT.has(section)) || LETTER_SPACED_RE.test(text)) return;
    for (const m of text.matchAll(PRONOUN_RE)) {
      if (!isPronoun(text, m[0], m.index)) continue;
      const quoted = quotes.spans.some(([from, to]) => m.index >= from && m.index < to);
      hits.push({ line, word: m[0], kind: quoted ? "quotation" : scoped ? "flagged" : "statement" });
    }
  });
  return hits;
}

export function pronounFinding(cv: CvReading): Finding {
  const id = "supplemental.pronouns";
  const scopedLines = cv.lines.filter((_, i) => inScope(cv, i)).length;
  if (cv.parsed.sections.length === 0 || scopedLines === 0) {
    return supplementalFinding(id, "not_applicable", "We couldn't tell your bullet points from a personal statement, because we found no role or project lines to read, so pronouns weren't assessed.");
  }
  const hits = pronounHits(cv);
  const flagged = hits.filter((h) => h.kind === "flagged");
  const statement = hits.filter((h) => h.kind === "statement").length;
  const quotation = hits.filter((h) => h.kind === "quotation").length;
  const leftAlone = [statement ? `${statement} in your personal statement or at the top of your CV` : "", quotation ? `${quotation} inside a quotation` : ""].filter(Boolean).join(" and ");
  const leftAloneSentence = leftAlone ? ` We left ${leftAlone} alone: first person is normal there.` : "";

  if (!flagged.length) return supplementalFinding(id, "passed", `We found no first-person pronouns in your bullet points.${leftAloneSentence}`);

  const words = [...new Set(flagged.map((h) => `"${h.word}"`))].join(", ");
  const singular = flagged.filter((h) => SINGULAR.has(h.word.toLowerCase()));
  const lines = new Set(flagged.map((h) => h.line)).size;
  const evidence = evidenceFor(cv, flagged.map((h) => h.line));
  if (!singular.length) {
    return supplementalFinding(id, "uncertain", `${plural(lines, "line")} under your roles or projects ${lines === 1 ? "says" : "say"} ${words}. That can be right when you are crediting a team, and we can't tell from the text whether it is here.${leftAloneSentence}`, "Check each one says what you did yourself as well as what the team did. Don't claim sole credit for shared work.", evidence);
  }
  return supplementalFinding(id, "needs_attention", `${plural(lines, "line")} under your roles or projects ${lines === 1 ? "uses" : "use"} ${words}. It isn't a grammar mistake, but UK CV bullet points usually start from the verb and leave the pronoun out.${leftAloneSentence}`, "Start these lines from the verb if it reads as well: \"Led the society's...\" rather than \"I led the society's...\". Leave any you've written that way on purpose.", evidence);
}
