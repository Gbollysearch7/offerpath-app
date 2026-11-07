import type { ReactNode } from "react";
import type { Profile } from "@/lib/types";
import { AdminNav } from "./AdminNav";
import { SiteFooter } from "./SiteFooter";

export function AdminShell({ profile, university, active, title, intro, children }: { profile: Profile; university: string; active: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-black lg:flex-row">
      <AdminNav active={active} university={university} name={profile.fullName} title={profile.role === "adviser" ? "Careers adviser" : "Careers admin"} role={profile.role} />
      <main id="main" className="flex min-w-0 max-w-[1180px] flex-1 flex-col gap-5 px-4 pt-7 pb-14 sm:px-8">
        <div>
          <h1 className="m-0 text-[36px] font-normal leading-[1.1] tracking-[-1.6px] sm:text-[44px] sm:tracking-[-1.98px]">{title}</h1>
          {intro && <p className="mt-2 mb-0 max-w-[760px] text-[15px] leading-relaxed text-muted">{intro}</p>}
        </div>
        {children}
        <SiteFooter />
      </main>
    </div>
  );
}
