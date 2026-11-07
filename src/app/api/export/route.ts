import JSZip from "jszip";
import { NextResponse } from "next/server";
import { getRepo } from "@/lib/session";

// "Download my data": a ZIP of the profile, every report, every saved version of a CV's text, adviser notes and the original uploaded files.
export async function GET() {
  const repo = await getRepo();
  if (!repo) return NextResponse.json({ error: "Sign in to download your data." }, { status: 401 });
  const [profile, list, apps, files, sources, notes] = await Promise.all([repo.profile(), repo.listReports({ limit: 1000 }), repo.applications(), repo.exportFiles(), repo.listSources(), repo.myAdviserNotes()]);
  const zip = new JSZip();
  zip.file("profile.json", JSON.stringify(profile, null, 2));
  zip.file("applications.json", JSON.stringify(apps, null, 2));
  // A version can be held without ever being scored, and a correction exists nowhere else, so reports alone aren't everything we hold.
  zip.file("cv-versions.json", JSON.stringify(sources.map(({ storagePath: _storagePath, ...v }) => v), null, 2));
  zip.file("adviser-notes.json", JSON.stringify(notes, null, 2));
  const reports = zip.folder("reports")!;
  for (const row of list.rows) {
    const full = await repo.getReport(row.id);
    reports.file(`${row.createdAt.slice(0, 10)}_${row.type}_${row.id.slice(0, 8)}.json`, JSON.stringify(full, null, 2));
  }
  const uploads = zip.folder("uploads")!;
  files.forEach((f, i) => uploads.file(`${i + 1}_${f.name}`, f.bytes));
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="offerpath-my-data-${new Date().toISOString().slice(0, 10)}.zip"`, "Cache-Control": "private, no-store" },
  });
}
