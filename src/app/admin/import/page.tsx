import type { Metadata } from "next";
import { AdminShell } from "@/components/AdminShell";
import { requireAdmin } from "@/lib/session";
import { ImportForm } from "./ImportForm";

export const metadata: Metadata = { title: "Import student records" };

export default async function ImportPage() {
  const { repo, profile } = await requireAdmin();
  const uni = await repo.adminUniversity();
  return (
    <AdminShell
      profile={profile}
      university={uni.name}
      active="import"
      title="Import student records"
      intro={<>Upload a CSV from your student records system. It fills in student number, course, year, faculty and fee status, now for students who already use Offerpath and on sign-up for everyone else. Students can&apos;t change these fields themselves.</>}
    >
      <ImportForm domain={uni.domain} />
    </AdminShell>
  );
}
