import { allWordsIn, normaliseText, stemsIn, withoutInstructions, type ClaimInventory } from "./claims";
import { checkProfile } from "./rewrite-check";

// A model's explanation of a suggestion ("why") is words shown to a student beside the suggestion, with no tick-box for
// them to confirm. So it passes only if the fact check has nothing at all to say about it, and it's short enough to read as
// one sentence. The fact check can't see a new fact in plain lower-case words (see docs/CLAUDE_BATCH_04_REPORT_OP-015.md),
// which matters here because nothing has to survive: every word must also be the student's own, or one of a closed list
// of words for talking about wording. A false alarm costs only the neutral sentence below, never the suggestion.

/** Rule-written, states no fact, and is what's shown when a model's explanation doesn't hold up. */
export const NEUTRAL_WHY = "Suggested wording for this section, based on what you gave us: check it is accurate and sounds like you before you keep it.";

const MAX_LENGTH = 300;
const HIDDEN_OR_MARKUP = /[\p{Cc}\p{Cf}\u2028\u2029<>{}[\]`\\]/u;
const URL_LIKE = /\bhttps?:|\bwww\.|@|\.[a-z]{2,}\//i;

// Words for talking about wording and nothing else. Deliberately no verb of doing or having done (worked, led, won, built,
// joined, promoted) and no noun for a job, place or award: those have to come from the student's own text.
const WORDS_FOR_WORDING = new Set(
  `a an and are as at be because but by can check clear clearer concise concrete did direct directly do does each example explain explains first for from give gives help helps how if in into is it its keep keeps kept leave leaves less like line lines long makes matches means more most no not of on one opens or our out own plain plainly point points reader readers real rather says say section sentence sentences short shorter show shows simple simpler so sounds specific starts stronger suggested that the their them then these this those to true up us use uses verb voice what which with word wording words you your based accurate level involvement action lead leads summary headline profile about before gave`.split(/\s+/),
);

const wordsOf = (text: string) => text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.,%£$-]*/gu)?.map((w) => w.replace(/[.,]+$/, "")) ?? [];

/** Whether a model's explanation can be shown. Anything it can't finish deciding, it hasn't passed. */
export function explanationIsSafe(inv: ClaimInventory, why: unknown): boolean {
  try {
    if (typeof why !== "string") return false;
    const text = why.trim();
    if (!text || text.length > MAX_LENGTH || HIDDEN_OR_MARKUP.test(text) || URL_LIKE.test(text)) return false;
    // Anything that normalising would change displays as something other than it is.
    if (normaliseText(text).replace(/'/g, "").replace(/"/g, "") !== text.replace(/[‘’']/g, "").replace(/[“”"]/g, "")) return false;
    if (withoutInstructions(text).removed > 0) return false;
    // A CV line has a minimum length, and opens with a capitalised verb. An explanation's first word is checked below instead.
    const firstWord = text.split(/\s+/)[0].replace(/[^\p{L}\p{N}]/gu, "");
    if (checkProfile(inv, text).issues.some((i) => i.severity !== "note" && i.key !== "not-a-cv-line:short" && !(i.code === "unsupported-entity" && i.severity === "confirm" && i.found === firstWord))) return false;
    const own = stemsIn(inv.entries.flatMap((e) => [e.heading, e.context, ...e.lines, ...e.factValues]).concat(inv.facts.map((f) => f.value)).join("\n"));
    const known = (word: string) => WORDS_FOR_WORDING.has(word.toLowerCase()) || allWordsIn(word, own);
    const words = wordsOf(text);
    return words.length > 0 && words.every(known);
  } catch {
    return false;
  }
}

/** The model's explanation if it holds up, otherwise the neutral one. Decides nothing about the suggestion. */
export function safeExplanation(inv: ClaimInventory, why: unknown): string {
  return explanationIsSafe(inv, why) ? (why as string).trim() : NEUTRAL_WHY;
}
