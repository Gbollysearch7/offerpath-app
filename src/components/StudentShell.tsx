import type { ReactNode } from "react";
import { initials } from "@/lib/session";
import type { Profile } from "@/lib/types";
import { SiteFooter } from "./SiteFooter";
import { Topbar, type TopbarActive } from "./Topbar";

export function StudentShell({ profile, active, children }: { profile: Profile; active: TopbarActive; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-black">
      <a href="#main" className="sr-only-abs focus:static focus:m-2 focus:inline-block focus:rounded-full focus:bg-black focus:px-4 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <Topbar active={active} initials={initials(profile.fullName)} name={profile.fullName} />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}

/** Two-column layout used by the results pages: sidebar + main. */
export function WithSidebar({ sidebar, children, narrow = false }: { sidebar: ReactNode; children: ReactNode; narrow?: boolean }) {
  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 pt-6 pb-14 sm:px-7 lg:flex-row lg:items-start">
      {sidebar}
      <main id="main" className={`flex min-w-0 flex-[999_1_640px] flex-col gap-5 ${narrow ? "lg:max-w-[920px]" : ""}`}>
        {children}
      </main>
    </div>
  );
}
