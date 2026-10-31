import type { Metadata } from "next";
import { AdminShell } from "@/components/AdminShell";
import { requireAdmin } from "@/lib/session";
import { TeamManager } from "./TeamManager";

export const metadata: Metadata = { title: "Careers team" };

export default async function TeamPage() {
  const { repo, profile } = await requireAdmin();
  const [uni, team] = await Promise.all([repo.adminUniversity(), repo.adminTeam()]);
  return (
    <AdminShell
      profile={profile}
      university={uni.name}
      active="team"
      title="Careers team"
      intro={<>Careers admins can see the dashboard, student scores (for students who share their progress) and exports for your university. Add colleagues by their university email; if they haven&apos;t signed in yet, they become an admin the first time they do.</>}
    >
      <TeamManager team={team} domain={uni.domain} />
    </AdminShell>
  );
}
