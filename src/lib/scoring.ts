import "server-only";
import { aiEnabled, aiJudgeBullets } from "@/lib/ai";
import { AI_JUDGE_MODEL, isCore, isRelevance } from "@/lib/analysis/judgment";
import { memoryStore, scoreCvWith, type JudgmentStore, type ScoreResult, type StoredJudgment } from "@/lib/scoring-core";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { alert } from "@/lib/log";
import { supabaseConfigured } from "@/lib/supabase/server";

export class ScoringUnavailableError extends Error {}

/** How many independent Haiku judgments to take for a new bullet (majority wins). */
const VOTES = Math.min(5, Math.max(1, Number(process.env.SCORING_VOTES ?? 3) || 3));

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

/** Scores a CV with Claude Haiku when configured, otherwise with the rule engine. */
export async function scoreCv(text: string, sector: string): Promise<ScoreResult> {
  if (!aiEnabled()) return scoreCvWith(text, sector, { method: "rules", store: memoryStore(), judgeName: "rules" });
  try {
    return await scoreCvWith(text, sector, {
      method: "ai",
      store: store(),
      judgeName: AI_JUDGE_MODEL,
      judge: async (bullets, s) => {
        const votes = await aiJudgeBullets(bullets, s, VOTES);
        return new Map([...votes].map(([id, js]) => [id, js.map(({ result, verb, kind, relevance }) => ({ result, verb, kind, relevance }))]));
      },
    });
  } catch (e) {
    await alert("cv-scoring-failed", "CV scoring with Claude failed; students are seeing 'try again'.", { error: e });
    throw new ScoringUnavailableError("We couldn't score your CV just now. Nothing was saved. Try again in a minute.");
  }
}
