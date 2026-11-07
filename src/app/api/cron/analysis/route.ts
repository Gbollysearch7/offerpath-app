import { NextResponse } from "next/server";
import { runAnalysisHousekeeping } from "@/lib/analysis-metrics";
import { cronAuthorized } from "@/lib/cron-auth";
import { alert } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  try {
    return NextResponse.json(await runAnalysisHousekeeping());
  } catch (e) {
    await alert("cron-analysis-failed", "The analysis housekeeping job failed.", { error: e });
    return NextResponse.json({ error: "job failed" }, { status: 500 });
  }
}
