import type { ScoringRecord } from "@/lib/types";
import { NORMALISER_VERSION, sha256 } from "./fingerprint";
import { AI_JUDGE_MODEL, JUDGE_PROMPT_VERSION, type ScoringMethod } from "./judgment";
import { LEXICON_VERSION } from "./lexicon";
import { PARSER_VERSION } from "./parse";
import { RUBRIC_VERSION } from "./rubric";

// What a Readiness Score means, as data: the versions of everything that turned text into the number.
//
// Every new report records a ScoringRecord (`analysis.meta.scoring`). Its `identity` joins the versions and the method,
// and two scores may be compared only when their series match: same identity, and both fully assessed. A bump of any
// component, or a different method, therefore starts a new series. Older reports keep their numbers and stop being
// compared with newer ones. Nothing rescores them and nothing rewrites them. See the note at the top of rubric.ts for
// which component to bump when, and supabase/migrations/20261106120000_score_series.sql for the same rule in SQL, kept
// equal by tests/fixtures/score-series-cases.json.

/**
 * What the normaliser and judge prompt were called when versions started being recorded here. Neither changed in
 * OP-010, so a report with the other versions recorded (OP-004 onwards) but not these two was made under them.
 * They are facts about the past and never change, whatever the current constants become.
 */
export const FIRST_RECORDED = { normaliser: "normaliser-2026-11-06.1", judgePrompt: "judge-prompt-2026-11-06.1" } as const;

type IdentityParts = Pick<ScoringRecord, "method" | "rubric" | "parser" | "lexicon" | "normaliser" | "judgePrompt" | "model">;

export const scoringIdentity = (v: IdentityParts): string => [v.method, v.rubric, v.parser, v.lexicon, v.normaliser, v.judgePrompt ?? "-", v.model ?? "-"].join("|");

/** The record for a report scored now. `text` is the normalised text the score was computed from. */
export function scoringRecord(method: ScoringMethod, text: string): ScoringRecord {
  const ai = method === "ai";
  const parts: IdentityParts = { method, rubric: RUBRIC_VERSION, parser: PARSER_VERSION, lexicon: LEXICON_VERSION, normaliser: NORMALISER_VERSION, judgePrompt: ai ? JUDGE_PROMPT_VERSION : null, model: ai ? AI_JUDGE_MODEL : null };
  const identity = scoringIdentity(parts);
  // Leaves out the sector, which the score never depends on: equal content under one identity has one core fingerprint.
  return { ...parts, identity, coreFingerprint: sha256([identity, text].join("\u0000")) };
}

/** What a saved report says about how it was scored. Anything it did not record is null, and null stays unknown. */
export interface SeriesFields {
  identity: string | null;
  method: string | null;
  rubric: string | null;
  parser: string | null;
  dictionary: string | null;
  model: string | null;
  bullets: number | null;
  band: string | null;
}

export function seriesFields(payload: unknown): SeriesFields {
  const p = payload as {
    analysis?: { meta?: { scoring?: { identity?: string }; method?: string; rubric?: string; bullets?: number } };
    assessment?: { versions?: { parser?: string | null; dictionary?: string | null; model?: string | null } };
    document?: { extraction?: { confidence?: { band?: string } } };
  } | null;
  const meta = p?.analysis?.meta;
  const versions = p?.assessment?.versions;
  return {
    identity: meta?.scoring?.identity ?? null,
    method: meta?.method ?? null,
    rubric: meta?.rubric ?? null,
    parser: versions?.parser ?? null,
    dictionary: versions?.dictionary ?? null,
    model: versions?.model ?? null,
    bullets: meta?.bullets ?? null,
    band: p?.document?.extraction?.confidence?.band ?? null,
  };
}

/**
 * The series a saved score belongs to, or null when it must not be compared with anything: its coverage was incomplete
 * (no bullets were assessed, or a low-confidence reading was scored), or it does not say how it was scored. Unknown is
 * not treated as compatible. Reports from before OP-004 record no parser version, and the parser did change under the
 * same rubric version before then.
 */
export function scoreSeries(f: SeriesFields): string | null {
  if (f.bullets === 0 || f.band === "low") return null;
  if (f.identity) return f.identity;
  if (!f.method || !f.rubric || !f.parser || !f.dictionary) return null;
  return scoringIdentity({ method: f.method as ScoringMethod, rubric: f.rubric, parser: f.parser, lexicon: f.dictionary, normaliser: FIRST_RECORDED.normaliser, judgePrompt: f.method === "ai" ? FIRST_RECORDED.judgePrompt : null, model: f.model });
}

/** Whether a change between two saved scores can be reported as a change. */
export const comparableScores = (a: string | null | undefined, b: string | null | undefined): boolean => !!a && a === b;
