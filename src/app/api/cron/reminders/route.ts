import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { runDeadlineReminders } from "@/lib/jobs";
import { alert } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  try {
    return NextResponse.json(await runDeadlineReminders());
  } catch (e) {
    await alert("cron-reminders-failed", "The reminders job failed.", { error: e });
    return NextResponse.json({ error: "job failed" }, { status: 500 });
  }
}
