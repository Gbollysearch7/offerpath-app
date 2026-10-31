import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { runRetention } from "@/lib/jobs";
import { alert } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  try {
    return NextResponse.json(await runRetention());
  } catch (e) {
    await alert("cron-retention-failed", "The retention job failed.", { error: e });
    return NextResponse.json({ error: "job failed" }, { status: 500 });
  }
}
