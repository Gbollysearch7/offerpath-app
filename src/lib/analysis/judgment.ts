import { bulletKey, sha256 } from "./fingerprint";
import { DUTY_PHRASES, EXTRA_HARD_TERMS, NUMBER_RE, STRONG_VERBS, WEAK_VERBS } from "./lexicon";

// A judgment is the categorical verdict on one bullet. Claude Haiku produces these in AI mode;
// the rule engine produces them otherwise. The score is always computed from judgments by code,
// never by the model, so the same judgments always give the same score.

export const RESULT = ["measured", "partial", "none"] as const;
export const VERB = ["strong", "ok", "weak"] as const;
export const KIND = ["achievement", "duty"] as const;
export const RELEVANCE = ["high", "some", "none"] as const;

export interface BulletJudgment {
  result: (typeof RESULT)[number]; // measured: a concrete number/outcome; partial: an outcome without scale; none
  verb: (typeof VERB)[number]; // strength of the opening verb
  kind: (typeof KIND)[number]; // what they achieved vs. what the job was
  relevance: (typeof RELEVANCE)[number]; // to the target sector
}

/** Bump when the rubric, prompt or criteria change. Old judgments are then ignored, not mixed in. */
export { RUBRIC_VERSION } from "./rubric";
import { RUBRIC_VERSION } from "./rubric";
export const AI_JUDGE_MODEL = "claude-haiku-5-5";

/**
 * Names JUDGE_SYSTEM in ai.ts. The prompt decides verdicts, and the cache key does not contain it, so a prompt change
 * must bump this and RUBRIC_VERSION together: the rubric bump is what stops the new prompt reading verdicts cached
 * under the old one. tests/scoring-contract.test.ts holds the prompt's hash and fails until both are bumped.
 */
export const JUDGE_PROMPT_VERSION = "judge-prompt-2026-11-06.1";

/**
 * The model configuration every first judgment is made under. Part of the scoring contract, so it is fixed here and
 * not per deployment. A verdict is published only when at least `quorum` of `votes` came back: a degraded provider
 * must not make one lone vote the permanent answer for a bullet, for every student.
 */
export const AI_JUDGE_CONFIG = { model: AI_JUDGE_MODEL, promptVersion: JUDGE_PROMPT_VERSION, votes: 3, quorum: 2, chunk: 25, maxTokens: 6000, effort: "medium" } as const;

export type ScoringMethod = "ai" | "rules";

/** The part of a judgment that is about the bullet alone, whatever sector the student targets. */
export type CoreJudgment = Pick<BulletJudgment, "result" | "verb" | "kind">;
/** The part that depends on the target sector. */
export type RelevanceJudgment = Pick<BulletJudgment, "relevance">;

/**
 * Cache keys for one bullet's judgment. They depend only on the words, the rubric and the judge, not on
 * who uploaded it, so the same bullet gets the same verdict for everyone. The core verdict ignores the
 * sector too, so changing sector can only change relevance.
 */
export function coreKey(text: string, rubric: string = RUBRIC_VERSION): string {
  return sha256([rubric, AI_JUDGE_MODEL, "core", bulletKey(text)].join("\u0000"));
}

export function relevanceKey(text: string, sector: string, rubric: string = RUBRIC_VERSION): string {
  return sha256([rubric, AI_JUDGE_MODEL, "relevance", sector.toLowerCase(), bulletKey(text)].join("\u0000"));
}

const HARD_NUMBER_RE = /(\d|£|\$|€|%)/;

/**
 * Deterministic limits on what any judge can claim, checked against the bullet's actual words.
 * They stop a manipulated or mistaken judgment from inflating (or unfairly deflating) a score:
 * no "measured" result without a number, weak verbs stay weak, duty phrasing stays a duty.
 */
export function applyGuardrails(text: string, j: BulletJudgment, sectorKeywords: string[] = []): BulletJudgment {
  const fw = firstWord(text);
  const lower = text.toLowerCase();
  const out = { ...j };
  if (out.result === "measured" && !NUMBER_RE.test(text)) out.result = "partial";
  if (out.result === "none" && HARD_NUMBER_RE.test(text) && STRONG_VERBS.includes(fw)) out.result = "partial";
  if (WEAK_VERBS[fw] && fw !== "used" && fw !== "served") out.verb = "weak";
  else if (out.verb === "weak" && STRONG_VERBS.includes(fw)) out.verb = "strong";
  if (DUTY_PHRASES.some((p) => lower.includes(p))) out.kind = "duty";
  // "Highly relevant" needs at least one recognisable sector or professional term in the bullet itself.
  if (out.relevance === "high" && sectorKeywords.length && ![...sectorKeywords, ...EXTRA_HARD_TERMS].some((k) => k.length > 2 && lower.includes(k))) out.relevance = "some";
  return out;
}

const firstWord = (s: string) => (s.trim().split(/\s+/)[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");

/** Judgment from the rule engine alone. Deterministic by construction. */
export function ruleJudgment(text: string, sectorKeywords: string[]): BulletJudgment {
  const fw = firstWord(text);
  const lower = text.toLowerCase();
  const hits = sectorKeywords.filter((k) => lower.includes(k)).length;
  return {
    result: NUMBER_RE.test(text) ? "measured" : /\b(improv|increas|reduc|cut|grew|won|exceed|saved|raised|launched)/i.test(text) ? "partial" : "none",
    verb: WEAK_VERBS[fw] && fw !== "used" && fw !== "served" ? "weak" : STRONG_VERBS.includes(fw) ? "strong" : "ok",
    kind: DUTY_PHRASES.some((p) => lower.includes(p)) ? "duty" : "achievement",
    relevance: hits >= 2 ? "high" : hits === 1 ? "some" : "none",
  };
}

/**
 * Majority vote across several judgments of the same bullet. Ties fall to the middle value,
 * then to the more conservative one, so a single outlier can't flip a verdict.
 */
export function majority(votes: BulletJudgment[]): BulletJudgment {
  const pick = <T extends string>(field: keyof BulletJudgment, order: readonly T[]): T => {
    const counts = new Map<T, number>();
    for (const v of votes) counts.set(v[field] as T, (counts.get(v[field] as T) ?? 0) + 1);
    const max = Math.max(...counts.values());
    const top = order.filter((o) => counts.get(o) === max);
    if (top.length === 1) return top[0];
    const middle = order[Math.floor(order.length / 2)];
    return top.includes(middle) ? middle : top[top.length - 1];
  };
  return { result: pick("result", RESULT), verb: pick("verb", VERB), kind: pick("kind", KIND), relevance: pick("relevance", RELEVANCE) };
}

export function isCore(x: unknown): x is CoreJudgment {
  const j = x as CoreJudgment;
  return !!j && (RESULT as readonly string[]).includes(j.result) && (VERB as readonly string[]).includes(j.verb) && (KIND as readonly string[]).includes(j.kind);
}

export function isRelevance(x: unknown): x is RelevanceJudgment {
  return !!x && (RELEVANCE as readonly string[]).includes((x as RelevanceJudgment).relevance);
}

export function isJudgment(x: unknown): x is BulletJudgment {
  const j = x as BulletJudgment;
  return !!j && (RESULT as readonly string[]).includes(j.result) && (VERB as readonly string[]).includes(j.verb) && (KIND as readonly string[]).includes(j.kind) && (RELEVANCE as readonly string[]).includes(j.relevance);
}
