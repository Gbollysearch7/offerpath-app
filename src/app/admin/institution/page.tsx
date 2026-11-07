import type { Metadata } from "next";
import { AdminShell } from "@/components/AdminShell";
import { featureFlags } from "@/lib/env";
import { requireAdmin } from "@/lib/session";
import { InstitutionManager } from "./InstitutionManager";

export const metadata: Metadata = { title: "Your service" };

export default async function InstitutionPage() {
  const { repo, profile } = await requireAdmin();
  const [uni, config] = await Promise.all([repo.adminUniversity(), repo.institutionConfig()]);
  return (
    <AdminShell profile={profile} university={uni.name} active="institution" title="Your service" intro="What students at your university see from your careers service, and who on your team can see which students. None of it changes a score: the CV score is worked out the same way for every student at every university.">
      <InstitutionManager config={config} adviserCvOn={featureFlags.adviserCvAccess()} />
    </AdminShell>
  );
}
