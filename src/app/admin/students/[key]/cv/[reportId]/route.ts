import { NextResponse } from "next/server";
import { featureFlags } from "@/lib/env";
import { isStaff } from "@/lib/institution/permissions";
import { log } from "@/lib/log";
import { getRepo } from "@/lib/session";

// Advisers open a CV only when the feature is switched on and the student has opted in.
export async function GET(_req: Request, { params }: { params: Promise<{ key: string; reportId: string }> }) {
  if (!featureFlags.adviserCvAccess()) return NextResponse.json({ error: "Not available." }, { status: 404 });
  const repo = await getRepo();
  if (!repo || !isStaff((await repo.profile()).role)) return NextResponse.json({ error: "Careers staff only." }, { status: 403 });
  const { reportId } = await params;
  // Both the access and any refusal are recorded in the database, in staff_access_log, by the call that decides them.
  const link = await repo.adminCvLink(reportId);
  if (!link) return NextResponse.json({ error: "This student hasn't shared their CV." }, { status: 404 });
  log("info", "adviser-cv-opened", { adviser: repo.userId, report: reportId });
  return NextResponse.redirect(link);
}
