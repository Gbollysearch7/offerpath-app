import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StudentShell } from "@/components/StudentShell";
import { aiEnabled } from "@/lib/ai";
import { inventoryFor } from "@/lib/analysis/linkedin-check";
import { linkedinView, profileText } from "@/lib/analysis/linkedin-edits";
import { cvFor, readLinkedin } from "@/lib/linkedin-flow";
import { requireStudent } from "@/lib/session";
import { LinkedinReportView } from "./LinkedinReportView";

// Server actions on this page can call the provider; allow up to 60 seconds.
export const maxDuration = 60;

export const metadata: Metadata = { title: "LinkedIn review" };

export default async function LinkedinReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { repo, profile } = await requireStudent();
  const { id } = await params;
  const r = await readLinkedin(repo, id);
  if (!r) notFound();
  const cv = await cvFor(repo, r.payload);
  // Worked out here, so reading the page changes nothing and the browser gets only the current view.
  const view = linkedinView(r.payload, inventoryFor(r.payload, cv.text), cv);
  return (
    <StudentShell profile={profile} active="linkedin">
      <LinkedinReportView id={id} view={view} aim={r.payload.aim} cvName={r.payload.cv?.fileName ?? null} source={r.payload.source} allText={profileText(r.payload)} ai={aiEnabled()} />
    </StudentShell>
  );
}
