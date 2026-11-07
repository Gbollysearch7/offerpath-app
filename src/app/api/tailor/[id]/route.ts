import { NextResponse, type NextRequest } from "next/server";
import { noteDownload } from "@/lib/applications/flow";
import { tailoredCvBlocks } from "@/lib/cv-blocks";
import { CV_THEMES, themeBySlug } from "@/lib/cv-themes";
import { tailoredExport } from "@/lib/analysis/tailor-edits";
import { toDocx, toPdf } from "@/lib/documents";
import { getRepo } from "@/lib/session";
import type { TailorPayload } from "@/lib/types";

/** The tailored CV as a Word or PDF file, in the template the student picked (?template=slug). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const repo = await getRepo();
  if (!repo) return NextResponse.json({ error: "Sign in to download your CV." }, { status: 401 });
  const { id } = await params;
  const r = await repo.getReport<TailorPayload>(id);
  if (!r || r.row.type !== "tailor") return NextResponse.json({ error: "Tailored CV not found." }, { status: 404 });
  // The selected version, or the one asked for. Blanks not yet reviewed stop the download here, not only on the page.
  const out = tailoredExport(r.payload, request.nextUrl.searchParams.get("version"));
  if (out.kind === "placeholders") return NextResponse.json({ error: "This version still has blanks to fill. Fill them in, or choose to keep them, on the tailoring page.", placeholders: out.placeholders }, { status: 409 });
  if (out.kind !== "ready") return NextResponse.json({ error: "Tailored CV not found." }, { status: 404 });
  const blocks = await tailoredCvBlocks(repo, r.payload, out.text);
  const theme = themeBySlug(request.nextUrl.searchParams.get("template")) ?? CV_THEMES[1];
  const format = request.nextUrl.searchParams.get("format") === "pdf" ? "pdf" : "docx";
  const bytes = format === "pdf" ? await toPdf(blocks, theme) : await toDocx(blocks, theme);
  await noteDownload(repo, { reportId: r.row.id, documentVersion: out.documentVersion, format });
  const name = `CV_${r.payload.employer}_${r.payload.jobTitle}${out.versionN ? `_v${out.versionN}` : ""}`.replace(/[^\w]+/g, "_").slice(0, 80);
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${name}.${format}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
