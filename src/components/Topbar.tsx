import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import { cx, Logo } from "./ui";

export type TopbarActive = "dashboard" | "review" | "tailor" | "letters" | "opportunities" | "templates" | "practice" | null;

const ITEMS: [Exclude<TopbarActive, null>, string, string][] = [
  ["dashboard", "Dashboard", "/dashboard"],
  ["review", "CV review", "/reviews/latest"],
  ["tailor", "Tailor to a job", "/tailor"],
  ["letters", "Cover letters", "/letters"],
  ["opportunities", "Opportunities", "/opportunities"],
  ["templates", "Templates", "/templates"],
  ["practice", "Practice", "/practice"],
];

export function Topbar({ active, initials, name }: { active: TopbarActive; initials: string; name: string }) {
  return (
    <header className="w-full border-b border-mist bg-white">
      <div className="mx-auto flex min-h-[72px] max-w-[1440px] flex-wrap items-center gap-x-7 gap-y-2.5 px-4 py-3 sm:px-7">
        <Link href="/dashboard" className="flex items-center gap-2.5 text-lg font-medium tracking-[-0.02em] text-black no-underline hover:text-black">
          <Logo />
          Offerpath
        </Link>
        <nav aria-label="App" className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto lg:order-none lg:w-auto lg:flex-1 lg:flex-wrap">
          {ITEMS.map(([id, label, href]) => (
            <Link
              key={id}
              href={href}
              aria-current={id === active ? "page" : undefined}
              className={cx("shrink-0 rounded-full px-3.5 py-2.5 text-sm no-underline", id === active ? "bg-canvas font-medium text-black hover:text-black" : "text-muted hover:text-black")}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2.5 lg:ml-0">
          <Link href="/upload" className="inline-flex min-h-[42px] items-center gap-2 rounded-full bg-black px-[18px] text-sm font-medium text-white no-underline hover:bg-ink-2 hover:text-white">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M2.5 7a4.5 4.5 0 1 0 1.3-3.2M2.5 2v2.5H5" fill="none" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Re-score CV
          </Link>
          <details className="relative">
            <summary className="flex h-[42px] w-[42px] cursor-pointer list-none items-center justify-center rounded-full bg-canvas text-sm font-medium text-brand [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true">{initials}</span>
              <span className="sr-only-abs">Account menu for {name}</span>
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-56 rounded-2xl border border-line bg-white p-2 shadow-lg">
              <p className="m-0 px-3 py-2 text-sm font-medium">{name}</p>
              <Link href="/privacy" className="block rounded-xl px-3 py-2.5 text-sm text-ink-2 no-underline hover:bg-canvas hover:text-black">
                Privacy and my data
              </Link>
              <form action={signOut}>
                <button type="submit" className="block w-full rounded-xl border-0 bg-transparent px-3 py-2.5 text-left text-sm text-ink-2 hover:bg-canvas">
                  Sign out
                </button>
              </form>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
