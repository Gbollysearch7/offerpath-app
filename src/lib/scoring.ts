import "server-only";
import { aiEnabled, aiJudgeBullets } from "@/lib/ai";
import { AI_JUDGE_CONFIG, AI_JUDGE_MODEL, isCore, isRelevance } from "@/lib/analysis/judgment";
import { memoryStore, scoreCvWith, type JudgmentStore, type ScoreResult, type StoredJudgment } from "@/lib/scoring-core";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { alert } from "@/lib/log";
import { supabaseConfigured } from "@/lib/supabase/server";

export class ScoringUnavailableError extends Error {}

const g = globalThis as unknown as { __offerpathJudgments?: Map<string, StoredJudgment> };

/** The shared judgment cache. Keys are fingerprints of a bullet's words; no CV text or student is stored. */
function supabaseStore(): JudgmentStore {
  const db = supabaseAdmin();
  return {
    async get(keys) {
      const out = new Map<string, StoredJudgment>();
      for (let i = 0; i < keys.length; i += 200) {
        const { data, error } = await db.from("judgment_cache").select("key, judgment").in("key", keys.slice(i, i + 200));
        if (error) throw new Error(error.message);
        for (const row of data ?? []) if (isCore(row.judgment) || isRelevance(row.judgment)) out.set(row.key, row.judgment);
      }
      return out;
    },
    async putIfAbsent(entries) {
      if (!entries.length) return;
      const { error } = await db.from("judgment_cache").upsert(
        entries.map((e) => ({ key: e.key, judgment: e.judgment, judge: e.judge })),
        { onConflict: "key", ignoreDuplicates: true },
      );
      if (error) throw new Error(error.message);
    },
  };
}

function store(): JudgmentStore {
  return supabaseConfigured() ? supabaseStore() : memoryStore((g.__offerpathJudgments ??= new Map()));
}

/**
 * Scores a CV with Claude Haiku when configured, otherwise with the rule engine. Takes only the text and the target
 * sector: nothing about the student or their institution can reach the score, because nothing about them comes in.
 * The sector only reaches relevance, which carries no weight. If the judge fails there is no score at all, never a
 * rule-based stand-in: the two methods are separate scoring series (scoring-contract.ts).
 */
export async function scoreCv(text: string, sector: string): Promise<ScoreResult> {
  if (!aiEnabled()) return scoreCvWith(text, sector, { method: "rules", store: memoryStore(), judgeName: "rules" });
  try {
    return await scoreCvWith(text, sector, {
      method: "ai",
      store: store(),
      judgeName: AI_JUDGE_MODEL,
      quorum: AI_JUDGE_CONFIG.quorum,
      judge: async (bullets, s) => {
        const votes = await aiJudgeBullets(bullets, s, AI_JUDGE_CONFIG.votes);
        return new Map([...votes].map(([id, js]) => [id, js.map(({ result, verb, kind, relevance }) => ({ result, verb, kind, relevance }))]));
      },
    });
  } catch (e) {
    await alert("cv-scoring-failed", "CV scoring with Claude failed; students are seeing 'try again'.", { error: e });
    throw new ScoringUnavailableError("We couldn't score your CV just now. Nothing was saved. Try again in a minute.");
  }
}
