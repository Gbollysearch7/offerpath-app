import type { Metadata } from "next";
import { StudentShell } from "@/components/StudentShell";
import { requireStudent } from "@/lib/session";
import { LinkedinStart } from "./LinkedinStart";

// Server actions on this page run as analysis jobs; every such page declares the same limit.
export const maxDuration = 60;

export const metadata: Metadata = { title: "LinkedIn review" };

export default async function LinkedinPage() {
  const { repo, profile } = await requireStudent();
  const cvs = await repo.listReports({ type: "cv_review", limit: 20 });
  return (
    <StudentShell profile={profile} active="linkedin">
      <LinkedinStart cvs={cvs.rows.map((c) => ({ id: c.id, label: c.title }))} />
    </StudentShell>
  );
}
