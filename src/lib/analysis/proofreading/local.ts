import nspell from "nspell";
import { US_SPELLINGS } from "@/lib/analysis/lexicon";
import type { ProofreadingCoverage, ProofreadingLanguage } from "@/lib/types";
import type { ProofreadingProvider, ProofreadRequest, ProviderIssue, ProviderResult } from "./provider";
import { TERMINOLOGY, TERMINOLOGY_VERSION } from "./terminology";

// The default proofreader. It runs in this process, on this server, and sends nothing anywhere.
//
// What it can do: find words that are in neither the selected dictionary nor the terminology list, tell a
// valid other-variant spelling from a mistake by checking the other dictionary, and spot three mechanical
// punctuation patterns. What it can't do: read a sentence. A real word used wrongly ("form" for "from") and
// every grammar error pass straight through it, and the report says so in its coverage notes.

export const LOCAL_ENGINE_VERSION = "nspell-2.1.5+rules-2026-11-06.1";
export const LOCAL_DICTIONARY_VERSION = "dictionary-en-gb@3.0.0+dictionary-en@4.0.0";

export interface Speller {
  correct(word: string): boolean;
  suggest(word: string): string[];
}
export interface Spellers {
  gb: Speller;
  us: Speller;
}

let loading: Promise<Spellers> | null = null;

/** Builds both dictionaries once per process. A failed load isn't remembered, so the next report retries. */
export function loadSpellers(): Promise<Spellers> {
  loading ??= (async () => {
    // Imported here, not at the top: each package reads its files when imported, and most requests never get this far.
    const [gb, us] = await Promise.all([import("dictionary-en-gb"), import("dictionary-en")]);
    return { gb: nspell(gb.default), us: nspell(us.default) };
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

const MAX_FINDINGS = 150;
const MAX_SUGGESTIONS = 3;
const YIELD_EVERY = 250;

// URLs, addresses and paths: nothing in them is a word to check.
const NOT_PROSE = /\bhttps?:\/\/\S+|\bwww\.\S+|\S+@\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|io|ai|dev|co|uk|ac|edu|gov|me|app)\b(?:\/\S*)?/gi;
const WORD = /[A-Za-zÀ-ɏ]+(?:['-][A-Za-zÀ-ɏ]+)*/g;
const FOREIGN = /[À-ɏ]/;
// Touching any of these makes a token part of something else: file.py, node_modules, C#, S3, 2nd, A/B.
const JOINED = /[0-9_@#+=&\\/.]/;

/** Short halves of a hyphenated word that are fine beside a real word, though not words themselves. */
const PREFIXES = new Set(["pre", "post", "non", "sub", "multi", "anti", "inter", "intra", "semi", "bi", "tri", "cross", "self", "co", "de", "re"]);

const mask = (s: string) => " ".repeat(s.length);
const isCapitalised = (w: string) => /^[A-Z][a-z'-]*$/.test(w);
const isAllCaps = (w: string) => /^[A-Z'-]+$/.test(w);
const stripPossessive = (w: string) => w.replace(/'s$/i, "").replace(/s'$/i, "s");

/** -ize is an accepted UK spelling (Oxford), so it isn't a preference to raise; -yze stays US-only. */
const oxfordToUk = (w: string) => w.replace(/iz(e|es|ed|er|ers|ing|ation|ations|ational)$/i, "is$1");

/** Matches a suggestion to the source's case, so a capitalised word gets a capitalised replacement and a heading gets capitals. */
function matchCase(suggestion: string, source: string): string {
  if (isAllCaps(source)) return suggestion.toUpperCase();
  if (isCapitalised(source)) return suggestion.charAt(0).toUpperCase() + suggestion.slice(1);
  return suggestion;
}

/** Best replacements in the source's case. A proper noun is no replacement for a lower-case word while a common word is on offer. */
function suggestionsFor(speller: Speller, word: string): string[] {
  const all = speller.suggest(word);
  const common = /^[a-z]/.test(word) ? all.filter((s) => /^[a-z]/.test(s)) : all;
  return (common.length ? common : all).slice(0, MAX_SUGGESTIONS).map((s) => matchCase(s, word));
}

/** Bullets and sentences. Elsewhere (names, role lines, headings, skills) a capitalised word is taken to be a name. */
function isProseLine(line: string): boolean {
  if (/^• /.test(line)) return true;
  const words = line.match(WORD) ?? [];
  return words.length >= 6 && words.filter((w) => /^[a-z]/.test(w)).length / words.length > 0.5;
}

const firstInSentence = (lineSoFar: string) => {
  const before = lineSoFar.replace(/^• /, "").trimEnd();
  return !before || /[.!?]["')]?$/.test(before);
};

interface Token {
  word: string;
  start: number;
  /** Where it sits decides whether a capital means a name or just the start of a sentence. */
  kind: "lower" | "caps" | "name" | "sentence-start";
}

/** Splits a document into words to check, plus a count of those deliberately left alone. Offsets are into `text`. */
export function tokenise(text: string): { tokens: Token[]; skipped: number } {
  const masked = text.replace(NOT_PROSE, mask);
  const tokens: Token[] = [];
  let skipped = 0;
  let offset = 0;
  for (const line of masked.split("\n")) {
    const prose = isProseLine(line);
    for (const m of line.matchAll(WORD)) {
      const word = m[0];
      const start = offset + m.index;
      const before = line[m.index - 1] ?? " ";
      const after = line[m.index + word.length] ?? " ";
      const joined = JOINED.test(before) || (after === "." ? /\S/.test(line[m.index + word.length + 1] ?? " ") : JOINED.test(after));
      if (joined || word.length < 3 || FOREIGN.test(word)) {
        skipped++;
      } else if (isAllCaps(word)) {
        // Short capitals are nearly always acronyms. A long run of them is a heading, worth checking.
        if (word.length <= 6) skipped++;
        else tokens.push({ word, start, kind: "caps" });
      } else if (isCapitalised(word)) {
        tokens.push({ word, start, kind: prose && firstInSentence(line.slice(0, m.index)) ? "sentence-start" : "name" });
      } else if (/^[a-z'-]+$/.test(word)) {
        tokens.push({ word, start, kind: "lower" });
      } else {
        // Capitals inside a word: JavaScript, iPhone, McDonald.
        skipped++;
      }
    }
    offset += line.length + 1;
  }
  return { tokens, skipped };
}

function regionalMessage(word: string, suggestion: string | undefined, language: ProofreadingLanguage): string {
  const [theirs, ours] = language === "en-GB" ? ["US", "UK"] : ["UK", "US"];
  const swap = suggestion ? ` ${ours} employers usually expect "${suggestion}".` : "";
  return `"${word}" is a valid ${theirs} spelling, so this is a preference rather than a mistake.${swap} Keep it if it's part of a name, a quotation or a product.`;
}

function punctuationIssues(text: string): ProviderIssue[] {
  const masked = text.replace(NOT_PROSE, mask);
  const issues: ProviderIssue[] = [];
  const add = (rule: string, re: RegExp, message: string, fix: (quote: string) => string) => {
    for (const m of masked.matchAll(re)) {
      issues.push({ category: "punctuation", rule, start: m.index, end: m.index + m[0].length, quote: m[0], message, suggestions: [fix(m[0])] });
    }
  };
  add("space-before-punctuation", /(?<=[A-Za-z0-9)]) +[,;:.!?](?=\s|$)/gm, "There's a space before this punctuation mark.", (q) => q.trim());
  add("doubled-punctuation", /,{2,}|;{2,}|(?<!\.)\.\.(?!\.)/g, "This punctuation mark is doubled.", (q) => q[0]);
  add("no-space-after-comma", /(?<=[a-z]),(?=[A-Za-z])/g, "There's no space after this comma.", () => ", ");
  return issues;
}

const coverageNotes = (status: "assessed" | "partial"): { spelling: ProofreadingCoverage; regional: ProofreadingCoverage; punctuation: ProofreadingCoverage; grammar: ProofreadingCoverage } => ({
  spelling: { status, note: "Words in lower case and the first word of each bullet or sentence, compared with a dictionary and a list of workplace terms. Capitalised words elsewhere, short acronyms and words with digits are treated as names and left unchecked. A real word used wrongly, such as \"form\" for \"from\", can't be detected." },
  regional: { status, note: "A word in the other English variant's dictionary is shown as a preference, never as a mistake. -ize spellings are accepted as UK English." },
  punctuation: { status: "partial", note: "Three mechanical patterns only: a space before punctuation, a doubled mark, and a comma with no space after it." },
  grammar: { status: "not_assessed", note: "Not assessed. This check doesn't read sentences, so grammar, tense and word choice need your own proofreading and your careers adviser." },
});

/**
 * The checking itself, separate from loading, so tests can hand it a stub speller. Checks the clock between
 * words and stops with a partial result when the signal fires; loading the dictionaries can't be interrupted.
 */
export async function checkText(text: string, { gb, us }: Spellers, language: ProofreadingLanguage, signal: AbortSignal): Promise<ProviderResult> {
  const [primary, other] = language === "en-GB" ? [gb, us] : [us, gb];
  const { tokens, skipped } = tokenise(text);

  // A capitalised word used mid-sentence or on a role line is this document's own name, so the same word
  // opening a bullet is that name too, not a typo. Case-sensitive: lower-case "monzo" gets no such pass.
  const names = new Set(tokens.filter((t) => t.kind === "name").map((t) => t.word));
  const issues: ProviderIssue[] = punctuationIssues(text);
  const verdicts = new Map<string, { category: "spelling" | "regional"; suggestions: string[] } | null>();
  let wordsChecked = 0;
  let namesSkipped = 0;
  let truncated: string | null = null;

  const known = (w: string) => {
    const bare = stripPossessive(w);
    if (primary.correct(w) || primary.correct(bare) || TERMINOLOGY.has(bare.toLowerCase())) return true;
    return language === "en-GB" && primary.correct(oxfordToUk(bare));
  };
  const judge = (w: string) => {
    if (verdicts.has(w)) return verdicts.get(w)!;
    let verdict: { category: "spelling" | "regional"; suggestions: string[] } | null = null;
    if (!known(w)) {
      const bare = stripPossessive(w).toLowerCase();
      if (other.correct(stripPossessive(w))) {
        const fromList = language === "en-GB" ? US_SPELLINGS[bare] : undefined;
        verdict = { category: "regional", suggestions: fromList ? [matchCase(fromList, w)] : suggestionsFor(primary, w) };
      } else {
        verdict = { category: "spelling", suggestions: suggestionsFor(primary, w) };
      }
    }
    verdicts.set(w, verdict);
    return verdict;
  };
  const report = (word: string, start: number) => {
    const verdict = judge(word);
    if (!verdict) return;
    const message = verdict.category === "regional"
      ? regionalMessage(word, verdict.suggestions[0], language)
      : `"${word}" isn't in our ${language === "en-GB" ? "UK" : "US"} English dictionary or our list of workplace terms, so it may be misspelled. If it's a name or a specialist term, it's fine as it is.`;
    issues.push({ category: verdict.category, rule: verdict.category === "regional" ? "other-variant" : "unknown-word", start, end: start + word.length, quote: word, message, suggestions: verdict.suggestions });
  };

  for (let i = 0; i < tokens.length; i++) {
    if (i % YIELD_EVERY === 0) {
      await new Promise((r) => setImmediate(r));
      if (signal.aborted) {
        truncated = `The check ran out of time after ${wordsChecked} of ${tokens.length} words. The rest weren't checked.`;
        break;
      }
    }
    const t = tokens[i];
    if (t.kind === "name" || (t.kind === "sentence-start" && names.has(t.word))) {
      namesSkipped++;
      continue;
    }
    wordsChecked++;
    if ([...verdicts.values()].filter(Boolean).length >= MAX_FINDINGS) {
      truncated = `We stopped after ${MAX_FINDINGS} different suggestions, which usually means the text wasn't read cleanly from your file. Check the extracted text.`;
      break;
    }
    if (t.word.includes("-") && !known(t.word)) {
      // Check the parts, and point only at the part in doubt.
      let at = t.start;
      for (const part of t.word.split("-")) {
        if (part.length >= 3 && !PREFIXES.has(part.toLowerCase())) report(part, at);
        at += part.length + 1;
      }
    } else {
      report(t.word, t.start);
    }
  }

  const status = truncated ? "partial" : "complete";
  return {
    status,
    engine: LOCAL_ENGINE_VERSION,
    dictionary: LOCAL_DICTIONARY_VERSION,
    terminology: TERMINOLOGY_VERSION,
    coverage: coverageNotes(truncated ? "partial" : "assessed"),
    stats: { wordsChecked, wordsSkipped: skipped + namesSkipped },
    limits: truncated ? [truncated] : [],
    issues: issues.sort((a, b) => a.start - b.start),
  };
}

export const localProvider: ProofreadingProvider = {
  id: "local-hunspell",
  sendsTextOffServer: false,
  async proofread({ text, language, signal }: ProofreadRequest) {
    return checkText(text, await loadSpellers(), language, signal);
  },
};
