import type { Metadata } from "next";
import { AdminShell } from "@/components/AdminShell";
import { SECTORS } from "@/lib/analysis/lexicon";
import { requireAdmin } from "@/lib/session";
import { OpportunityManager } from "./OpportunityManager";

export const metadata: Metadata = { title: "Opportunities" };

export default async function AdminOpportunitiesPage() {
  const { repo, profile } = await requireAdmin();
  const [uni, opps] = await Promise.all([repo.adminUniversity(), repo.adminOpportunities()]);
  return (
    <AdminShell
      profile={profile}
      university={uni.name}
      active="opportunities"
      title="Opportunities"
      intro={<>Add the graduate schemes, internships, placements and spring weeks your students should see. Your listings are only shown to students at {uni.name || "your university"}. Shared listings come from Offerpath and can&apos;t be edited here.</>}
    >
      <OpportunityManager opps={opps} sectors={[...SECTORS]} today={new Date().toISOString().slice(0, 10)} />
    </AdminShell>
  );
}
