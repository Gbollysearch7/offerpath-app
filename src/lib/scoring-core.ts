import { analyseCv, cvBullets } from "@/lib/analysis/cv";
import { applyGuardrails, coreKey, isCore, isJudgment, isRelevance, majority, relevanceKey, type BulletJudgment, type CoreJudgment, type RelevanceJudgment, type ScoringMethod } from "@/lib/analysis/judgment";
import { SECTOR_KEYWORDS } from "@/lib/analysis/lexicon";
import type { CvAnalysis } from "@/lib/types";

// The scoring pipeline, with the judge and the cache injected so tests can prove its guarantees:
//  1. The same CV text always gets the same score, for every student (every bullet's judgment is
//     cached by the fingerprint of its words, not by who uploaded it).
//  2. Changing the target sector only re-judges relevance; whether a bullet shows a result, opens with a
//     strong verb or reads like a duty is judged once per bullet, for every sector.
//  3. Editing a CV only re-judges the bullets that changed; everything else keeps its judgment.
//  4. A score never mixes AI and rule judgments: if the AI judge fails, scoring fails cleanly.
//  5. The first judgment stored for a key is permanent under that key, and every judgment passes deterministic
//     guardrails, so text inside a CV can't inflate a score or be re-rolled for a better one. A wrong verdict is
//     corrected by a RUBRIC_VERSION bump, which changes every key and leaves the old rows and reports as they are.
//
// Publication and retries. `putIfAbsent` is the one publication point and must be atomic per key (the primary key
// and `on conflict do nothing` in Supabase). Everyone re-reads after writing, so simultaneous first analyses that
// judged differently all score from whichever verdict landed first. An attempt is all or nothing: if any bullet
// lacks a quorum of valid votes, or the store fails, it throws before publishing anything of its own, no report is
// saved, and a retry starts again from whatever is published by then. No score is ever produced from a partial set.

export type StoredJudgment = CoreJudgment | RelevanceJudgment;

export interface JudgmentStore {
  get(keys: string[]): Promise<Map<string, StoredJudgment>>;
  /** Insert-if-absent. The first judgment stored for a key wins, forever. */
  putIfAbsent(entries: { key: string; judgment: StoredJudgment; judge: string }[]): Promise<void>;
}

/** Returns every vote for each id; throws if any bullet can't be judged. */
export type JudgeFn = (bullets: { id: number; text: string }[], sector: string) => Promise<Map<number, BulletJudgment[]>>;

export interface ScoreResult {
  analysis: CvAnalysis;
  method: ScoringMethod;
  judgedNow: number; // bullets sent to the judge this time
  reused: number; // bullets whose judgment came from the cache
}

export interface ScoreDeps {
  method: ScoringMethod;
  store: JudgmentStore;
  judge?: JudgeFn;
  judgeName: string;
  /** Valid votes a bullet needs before its verdict can be published. Production passes AI_JUDGE_CONFIG.quorum. */
  quorum?: number;
  /** The rubric version the cache keys are computed under. Only tests of the version path pass this. */
  rubric?: string;
}

export async function scoreCvWith(text: string, sector: string, deps: ScoreDeps): Promise<ScoreResult> {
  const bullets = cvBullets(text);
  if (deps.method === "rules" || bullets.length === 0) {
    // No bullets means no judge ran, whatever was asked for: the result says "rules", as the report does.
    return { analysis: analyseCv(text, sector), method: "rules", judgedNow: 0, reused: 0 };
  }
  if (!deps.judge) throw new Error("AI scoring needs a judge");

  const core = bullets.map((b) => coreKey(b.text, deps.rubric));
  const rel = bullets.map((b) => relevanceKey(b.text, sector, deps.rubric));
  const keys = [...new Set([...core, ...rel])];
  const cached = await deps.store.get(keys);
  // A bullet goes to the judge if either half is missing, once per distinct bullet; only the missing half is stored.
  const todo = new Map<string, number>();
  bullets.forEach((_, i) => {
    if ((!cached.has(core[i]) || !cached.has(rel[i])) && !todo.has(rel[i])) todo.set(rel[i], i);
  });

  if (todo.size) {
    const idx = [...todo.values()];
    const votes = await deps.judge(idx.map((i, id) => ({ id, text: bullets[i].text })), sector);
    const fresh = idx.flatMap((i, id) => {
      const v = (votes.get(id) ?? []).filter(isJudgment);
      if (v.length < Math.max(1, deps.quorum ?? 1)) throw new Error(`Only ${v.length} valid judgments for bullet ${id}`);
      const { result, verb, kind, relevance } = majority(v);
      return [
        ...(cached.has(core[i]) ? [] : [{ key: core[i], judgment: { result, verb, kind }, judge: deps.judgeName }]),
        ...(cached.has(rel[i]) ? [] : [{ key: rel[i], judgment: { relevance }, judge: deps.judgeName }]),
      ];
    });
    await deps.store.putIfAbsent(fresh);
  }

  // Re-read everything from the store so concurrent uploads of the same new bullet agree on one judgment.
  const final = await deps.store.get(keys);
  const judgments = bullets.map((b, i) => {
    const c = final.get(core[i]);
    const r = final.get(rel[i]);
    if (!isCore(c) || !isRelevance(r)) throw new Error("Judgment missing after storing");
    return applyGuardrails(b.text, { ...c, ...r }, SECTOR_KEYWORDS[sector] ?? SECTOR_KEYWORDS["Finance and banking"]);
  });
  const distinct = new Set(rel).size;
  return { analysis: analyseCv(text, sector, { judgments, method: "ai" }), method: "ai", judgedNow: todo.size, reused: distinct - todo.size };
}

/** In-memory store for demo mode and tests. */
export function memoryStore(map = new Map<string, StoredJudgment>()): JudgmentStore {
  return {
    async get(keys) {
      return new Map(keys.filter((k) => map.has(k)).map((k) => [k, map.get(k)!]));
    },
    async putIfAbsent(entries) {
      for (const e of entries) if (!map.has(e.key)) map.set(e.key, e.judgment);
    },
  };
}
