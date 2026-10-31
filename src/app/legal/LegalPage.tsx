import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/SiteFooter";
import { Logo } from "@/components/ui";
import { legal } from "@/lib/legal";

export function LegalPage({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-black">
      <header className="mx-auto flex w-full max-w-[860px] items-center justify-between gap-4 px-6 py-7">
        <Link href="/" className="flex items-center gap-2.5 text-lg font-medium text-black no-underline hover:text-black">
          <Logo />
          Offerpath
        </Link>
        <Link href="/sign-in" className="text-sm">
          Sign in
        </Link>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-[860px] flex-1 flex-col gap-5 px-6 pb-16">
        <div>
          <h1 className="m-0 text-[36px] font-normal leading-[1.1] tracking-[-1.6px] sm:text-[44px] sm:tracking-[-1.98px]">{title}</h1>
          <p className="mt-2 mb-0 text-sm text-subtle">Last updated {legal.lastUpdated}</p>
        </div>
        {intro && <div className="rounded-3xl bg-mist px-6 py-5 text-[15px] leading-relaxed text-body">{intro}</div>}
        <article className="flex flex-col gap-6 rounded-3xl bg-white px-6 py-7 text-[15px] leading-relaxed text-body sm:px-8 [&_h2]:m-0 [&_h2]:text-xl [&_h2]:font-normal [&_h2]:tracking-[-0.03em] [&_h2]:text-black [&_li]:mb-1.5 [&_p]:m-0 [&_section]:flex [&_section]:flex-col [&_section]:gap-2.5 [&_ul]:m-0 [&_ul]:pl-5">
          {children}
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
