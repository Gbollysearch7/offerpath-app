import type { Metadata } from "next";
import { AdminShell } from "@/components/AdminShell";
import { requireAdmin } from "@/lib/session";
import { ACCESS_LABEL, PERMISSIONS } from "@/lib/institution/permissions";
import { AdviserManager } from "./AdviserManager";
import { TeamManager } from "./TeamManager";

export const metadata: Metadata = { title: "Careers team" };

export default async function TeamPage() {
  const { repo, profile } = await requireAdmin();
  const [uni, team, advisers, config] = await Promise.all([repo.adminUniversity(), repo.adminTeam(), repo.adviserTeam(), repo.institutionConfig()]);
  return (
    <AdminShell
      profile={profile}
      university={uni.name}
      active="team"
      title="Careers team"
      intro={<>Careers admins can see the dashboard, student scores (for students who share their progress) and exports for your university, and run the service. Add colleagues by their university email; if they haven&apos;t signed in yet, they take up the role the first time they do.</>}
    >
      <TeamManager team={team} domain={uni.domain} />
      <AdviserManager team={advisers} groups={config.groups} domain={uni.domain} assigned={config.adviserScope === "assigned"} />
      <section aria-labelledby="perm-h" className="flex flex-col gap-3 rounded-3xl bg-white px-6 py-[22px]">
        <h2 id="perm-h" className="m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">
          WHO CAN DO WHAT
        </h2>
        <p className="m-0 text-sm text-muted">&quot;Students in scope&quot; means students at your university who share their progress and, for an adviser, whom your policy lets them see. Opening a student, a CV or an export is logged.</p>
        <div tabIndex={0} role="region" aria-labelledby="perm-h" className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="text-subtle">
                <th scope="col" className="py-2 pr-3 font-normal">Action</th>
                <th scope="col" className="py-2 pr-3 font-normal">Student</th>
                <th scope="col" className="py-2 pr-3 font-normal">Adviser</th>
                <th scope="col" className="py-2 font-normal">Careers admin</th>
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((p) => (
                <tr key={p.key} className="border-t border-line align-top">
                  <th scope="row" className="py-2 pr-3 font-normal">{p.label}</th>
                  <td className="py-2 pr-3">{ACCESS_LABEL[p.student]}</td>
                  <td className="py-2 pr-3">{ACCESS_LABEL[p.adviser]}</td>
                  <td className="py-2">{ACCESS_LABEL[p.admin]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AdminShell>
  );
}
