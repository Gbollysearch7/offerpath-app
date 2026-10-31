import { NextResponse } from "next/server";
import { featureFlags } from "@/lib/env";
import { log } from "@/lib/log";
import { getRepo } from "@/lib/session";

// Advisers open a CV only when the feature is switched on and the student has opted in.
export async function GET(_req: Request, { params }: { params: Promise<{ key: string; reportId: string }> }) {
  if (!featureFlags.adviserCvAccess()) return NextResponse.json({ error: "Not available." }, { status: 404 });
  const repo = await getRepo();
  if (!repo || (await repo.profile()).role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const { key, reportId } = await params;
  const link = await repo.adminCvLink(reportId);
  if (!link) return NextResponse.json({ error: "This student hasn't shared their CV." }, { status: 404 });
  log("info", "adviser-cv-opened", { adviser: repo.userId, student: key, report: reportId });
  return NextResponse.redirect(link);
}
