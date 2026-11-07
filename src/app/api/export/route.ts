import JSZip from "jszip";
import { NextResponse } from "next/server";
import { getRepo } from "@/lib/session";
import { exportShareLinks } from "@/lib/sharing/flow";

// "Download my data": a ZIP of the profile, every report, every saved version of a CV's text, adviser notes and the original uploaded files.
export async function GET() {
  const repo = await getRepo();
  if (!repo) return NextResponse.json({ error: "Sign in to download your data." }, { status: 401 });
  const [profile, list, apps, files, sources, notes, choices, language, shareLinks] = await Promise.all([repo.profile(), repo.listReports({ limit: 1000 }), repo.applications(), repo.exportFiles(), repo.listSources(), repo.myAdviserNotes(), repo.proofreadingChoices(), repo.proofreadingLanguagePreference(), repo.shareLinks()]);
  const [links, downloads, actionChoices] = await Promise.all([repo.applicationLinks(), repo.artefactDownloads(), repo.actionChoices()]);
  const casework = await repo.myCasework();
  const practice = await repo.practiceAnswers();
  const zip = new JSZip();
  zip.file("profile.json", JSON.stringify(profile, null, 2));
  zip.file("applications.json", JSON.stringify(apps, null, 2));
  zip.file("application-documents.json", JSON.stringify({ links, downloads, recommendationChoices: actionChoices }, null, 2));
  // A version can be held without ever being scored, and a correction exists nowhere else, so reports alone aren't everything we hold.
  zip.file("cv-versions.json", JSON.stringify(sources.map((v) => ({ ...v, storagePath: undefined })), null, 2));
  zip.file("adviser-notes.json", JSON.stringify(notes, null, 2));
  zip.file("adviser-casework.json", JSON.stringify({ disagreements: casework.disagreements, referrals: casework.referrals, accessToYourRecord: casework.access }, null, 2));
  zip.file("proofreading-choices.json", JSON.stringify({ languagePreference: language, history: choices }, null, 2));
  zip.file("interview-practice.json", JSON.stringify(practice, null, 2));
  zip.file("share-links.json", JSON.stringify(exportShareLinks(shareLinks), null, 2));
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
