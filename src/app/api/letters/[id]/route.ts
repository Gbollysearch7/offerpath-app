import { NextResponse, type NextRequest } from "next/server";
import { letterExport } from "@/lib/analysis/letter-edits";
import { noteDownload } from "@/lib/applications/flow";
import { toDocx, toPdf, type DocBlock } from "@/lib/documents";
import { getRepo } from "@/lib/session";
import type { CoverLetterPayload } from "@/lib/types";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const repo = await getRepo();
  if (!repo) return NextResponse.json({ error: "Sign in to download your letter." }, { status: 401 });
  const { id } = await params;
  const r = await repo.getReport<CoverLetterPayload>(id);
  if (!r || r.row.type !== "cover_letter") return NextResponse.json({ error: "Letter not found." }, { status: 404 });
  const format = request.nextUrl.searchParams.get("format") === "pdf" ? "pdf" : "docx";
  // The selected version, or the one asked for. Gaps not yet looked at stop the download here, not only on the page.
  const out = letterExport(r.payload, request.nextUrl.searchParams.get("version"));
  if (out.kind === "unknown-version") return NextResponse.json({ error: "Letter not found." }, { status: 404 });
  if (out.kind === "review") return NextResponse.json({ error: "This letter still has points to look at. Fill them in, or choose to keep them, on the letter's page.", items: out.items }, { status: 409 });
  const blocks: DocBlock[] = out.text
    .split(/\n\s*\n/)
    .filter((b) => b.trim())
    .map((b) => ({ kind: "para", text: b.trim() }));
  const bytes = format === "pdf" ? await toPdf(blocks) : await toDocx(blocks);
  await noteDownload(repo, { reportId: r.row.id, documentVersion: out.documentVersion, format });
  const name = `${r.payload.employer.replace(/[^\w]+/g, "_")}_cover_letter${out.versionN ? `_v${out.versionN}` : ""}.${format}`;
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
