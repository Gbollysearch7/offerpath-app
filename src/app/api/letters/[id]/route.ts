import { NextResponse, type NextRequest } from "next/server";
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
  const blocks: DocBlock[] = r.payload.letterText
    .split(/\n\s*\n/)
    .filter((b) => b.trim())
    .map((b) => ({ kind: "para", text: b.trim() }));
  const bytes = format === "pdf" ? await toPdf(blocks) : await toDocx(blocks);
  const name = `${r.payload.employer.replace(/[^\w]+/g, "_")}_cover_letter.${format}`;
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
