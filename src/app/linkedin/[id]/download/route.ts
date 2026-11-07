import { NextResponse } from "next/server";
import { profileText, sectionsWithBlanks } from "@/lib/analysis/linkedin-edits";
import { sha256 } from "@/lib/analysis/fingerprint";
import { noteDownload } from "@/lib/applications/flow";
import { readLinkedin } from "@/lib/linkedin-flow";
import { getRepo } from "@/lib/session";

// The student's current words as a text file. Built per request and not stored.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const repo = await getRepo();
  if (!repo) return NextResponse.json({ error: "Sign in to download this." }, { status: 401 });
  const { id } = await params;
  const r = await readLinkedin(repo, id);
  if (!r) return NextResponse.json({ error: "Review not found." }, { status: 404 });
  const blanks = sectionsWithBlanks(r.payload);
  if (blanks.length) return NextResponse.json({ error: `Fill in the blanks in square brackets first (${blanks.join(", ")}).` }, { status: 409 });
  const text = profileText(r.payload);
  await noteDownload(repo, { reportId: id, documentVersion: sha256(text), format: "txt" });
  return new NextResponse(text, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="linkedin-profile-text.txt"`, "Cache-Control": "private, no-store" },
  });
}
