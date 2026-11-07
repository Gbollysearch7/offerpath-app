import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { JOB_POLICY } from "@/lib/analysis/job-state";
import { alert, log } from "@/lib/log";
import { PRICING_VERSION } from "@/lib/provider";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseConfigured } from "@/lib/supabase/server";

// OP-025: run daily by /api/cron/analysis. Settles work whose server is gone across every student (each student's own
// is also settled when they next ask for anything), purges old job rows, and reports how analysis has been doing.

export interface WorkflowMetrics {
  workflow: string;
  jobs: number;
  completed: number;
  partial: number;
  failed: number;
  in_flight: number;
  refused: number;
  attempts: number;
  failures: number;
  error_rate: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  provider_calls: number;
  provider_retries: number;
  input_tokens: number;
  output_tokens: number;
  cost_micros: number;
  cost_per_completed_micros: number | null;
  cost_incomplete_jobs: number;
}

/** Enough attempts to mean something, and enough of them failing to act on. Starting values, not calibrated. */
const ALERT = { minAttempts: 20, errorRate: 0.2 };

export function workflowsToAlert(rows: WorkflowMetrics[]) {
  return rows.filter((r) => r.attempts >= ALERT.minAttempts && Number(r.error_rate ?? 0) >= ALERT.errorRate);
}

const numeric = (r: Record<string, unknown>): WorkflowMetrics => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === "workflow" || v === null ? v : Number(v)])) as unknown as WorkflowMetrics;

export async function runAnalysisHousekeeping(admin: () => SupabaseClient = supabaseAdmin, now = new Date()) {
  if (!supabaseConfigured() && admin === supabaseAdmin) return { skipped: "demo mode" };
  const db = admin();
  const sweep = await db.rpc("sweep_analysis_jobs", { p_user_id: null, p_queued_expiry_seconds: JOB_POLICY.queuedExpirySeconds, p_retain_days: JOB_POLICY.retainDays });
  if (sweep.error) throw new Error(sweep.error.message);
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const res = await db.rpc("analysis_metrics", { p_since: since });
  if (res.error) throw new Error(res.error.message);
  const rows = ((res.data ?? []) as Record<string, unknown>[]).map(numeric);
  for (const row of rows) log("info", "analysis-metrics", { window: "24h", pricing: PRICING_VERSION, ...row });
  const bad = workflowsToAlert(rows);
  if (bad.length) await alert("analysis-error-rate", `Analysis failure rate is high in the last 24 hours: ${bad.map((r) => `${r.workflow} ${Math.round(Number(r.error_rate) * 100)}% of ${r.attempts} attempts`).join("; ")}.`);
  return { sweep: sweep.data, metrics: rows };
}
