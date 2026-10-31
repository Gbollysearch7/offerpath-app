import "server-only";
import { headers } from "next/headers";
import { log } from "@/lib/log";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseConfigured } from "@/lib/supabase/server";

// Fixed-window limits. Uses the database (shared across instances) when Supabase is configured,
// otherwise an in-memory counter (demo mode, single process).

export const LIMITS = {
  signInPerEmail: { window: 15 * 60, max: 5 },
  signInPerIp: { window: 60 * 60, max: 30 },
  uploadPerUser: { window: 10 * 60, max: 10 },
  linkFetchPerUser: { window: 60 * 60, max: 30 },
  aiWritePerUser: { window: 10 * 60, max: 20 },
  importPerAdmin: { window: 60 * 60, max: 20 },
  pilotPerIp: { window: 60 * 60, max: 5 },
} as const;

export type LimitName = keyof typeof LIMITS;

const g = globalThis as unknown as { __offerpathRate?: Map<string, number> };

/** Records a hit; returns true if still within the limit. Fails open only if the limiter itself errors. */
export async function hit(name: LimitName, subject: string): Promise<boolean> {
  const { window, max } = LIMITS[name];
  const key = `${name}:${subject.toLowerCase()}`;
  if (supabaseConfigured()) {
    try {
      const { data, error } = await supabaseAdmin().rpc("rate_limit_hit", { p_key: key, p_window_seconds: window, p_max: max });
      if (error) throw new Error(error.message);
      return data === true;
    } catch (e) {
      log("error", "rate-limit-check-failed", { error: e });
      return true;
    }
  }
  const map = (g.__offerpathRate ??= new Map());
  const bucket = `${key}:${Math.floor(Date.now() / 1000 / window)}`;
  const n = (map.get(bucket) ?? 0) + 1;
  map.set(bucket, n);
  if (map.size > 50_000) map.clear();
  return n <= max;
}

/** The client's IP as reported by the hosting proxy. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export const TOO_MANY = "You're doing that a lot. Wait a few minutes and try again.";
