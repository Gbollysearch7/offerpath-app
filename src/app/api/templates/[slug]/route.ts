import { NextResponse, type NextRequest } from "next/server";
import { noteDownload } from "@/lib/applications/flow";
import { myCvDownload } from "@/lib/cv-blocks";
import { themeBySlug } from "@/lib/cv-themes";
import { templateBlocks, toDocx, toPdf } from "@/lib/documents";
import { getRepo } from "@/lib/session";

/** A template as Word or PDF, filled with the example CV or, with ?with=mine, the student's latest CV (or the one in ?report=). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const repo = await getRepo();
  if (!repo) return NextResponse.json({ error: "Sign in to download templates." }, { status: 401 });
  const theme = themeBySlug((await params).slug);
  if (!theme) return NextResponse.json({ error: "Template not found." }, { status: 404 });
  const mine = request.nextUrl.searchParams.get("with") === "mine";
  const own = mine ? await myCvDownload(repo, request.nextUrl.searchParams.get("report")) : null;
  const blocks = mine ? own?.blocks : templateBlocks(theme);
  if (!blocks) return NextResponse.json({ error: "Upload a CV first." }, { status: 404 });
  const format = request.nextUrl.searchParams.get("format") === "pdf" ? "pdf" : "docx";
  const bytes = format === "pdf" ? await toPdf(blocks, theme) : await toDocx(blocks, theme);
  if (own) await noteDownload(repo, { reportId: own.reportId, documentVersion: own.documentVersion, format });
  const name = mine ? `My_CV_${theme.name}` : `Offerpath_${theme.name}_CV_template`;
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${name.replace(/\s+/g, "_")}.${format}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
