import type { Metadata } from "next";
import { StudentShell } from "@/components/StudentShell";
import { requireStudent } from "@/lib/session";
import { OpportunitiesView } from "./OpportunitiesView";

export const metadata: Metadata = { title: "Opportunities" };

export default async function OpportunitiesPage() {
  const { repo, profile } = await requireStudent();
  const [opps, apps] = await Promise.all([repo.opportunities(), repo.applications()]);
  return (
    <StudentShell profile={profile} active="opportunities">
      <OpportunitiesView opps={opps} apps={apps} defaultSector={profile.sectors[0] ?? "All sectors"} defaultVisa={profile.visaSponsorship} today={new Date().toISOString().slice(0, 10)} />
    </StudentShell>
  );
}
