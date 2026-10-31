import { NextResponse } from "next/server";
import { aiEnabled } from "@/lib/ai";
import { checkEnv } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// For uptime monitors. Reports what's working without revealing any configuration values.
export async function GET() {
  const env = checkEnv();
  let database: "ok" | "error" | "not-configured" = "not-configured";
  if (env.mode === "supabase") {
    try {
      const { error } = await supabaseAdmin().from("universities").select("id", { head: true, count: "exact" }).limit(1);
      database = error ? "error" : "ok";
    } catch {
      database = "error";
    }
  }
  const healthy = env.errors.length === 0 && database !== "error";
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", mode: env.mode, database, ai: aiEnabled() ? "claude" : "rules", time: new Date().toISOString() },
    { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
