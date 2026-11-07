import { NextResponse } from "next/server";
import { noteDownload } from "@/lib/applications/flow";
import { getRepo } from "@/lib/session";
import { lineage } from "@/lib/sources";

// The original file behind one of the signed-in student's reports (OP-006). The report is looked up with their
// own repository, so another user's id yields 404 whatever they type; in Supabase the download itself runs under
// their session and the bucket policy only opens their own folder.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const repo = await getRepo();
  if (!repo) return NextResponse.json({ error: "Sign in to download your file." }, { status: 401 });
  const { id } = await params;
  const report = await repo.getReport(id);
  const sourceId = report?.row.sourceId;
  if (!report || !sourceId) return NextResponse.json({ error: "No file is kept for this report." }, { status: 404 });
  const original = lineage(await repo.listSources(), sourceId).find((v) => v.hasFile);
  const file = original ? await repo.sourceFile(original.id) : null;
  if (!file) return NextResponse.json({ error: "No file is kept for this report." }, { status: 404 });
  await noteDownload(repo, { reportId: report.row.id, documentVersion: original!.documentVersion, format: "original" });
  const name = file.name.replace(/[^\w.-]+/g, "_").slice(0, 100) || "cv";
  return new NextResponse(Buffer.from(file.bytes), {
    headers: { "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" },
  });
}
