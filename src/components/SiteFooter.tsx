import Link from "next/link";

const LINKS: [string, string][] = [
  ["Privacy notice", "/legal/privacy"],
  ["Terms", "/legal/terms"],
  ["Accessibility", "/legal/accessibility"],
  ["Cookies", "/legal/cookies"],
  ["Sub-processors", "/legal/sub-processors"],
];

export function SiteFooter({ dark = false }: { dark?: boolean }) {
  return (
    <footer className={dark ? "border-t border-night-3 px-4 py-6 text-night-text" : "border-t border-line px-4 py-6 text-subtle sm:px-7"}>
      <nav aria-label="Legal" className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
        <span>© {new Date().getFullYear()} Offerpath</span>
        {LINKS.map(([label, href]) => (
          <Link key={href} href={href} className={dark ? "text-night-text no-underline hover:text-white" : "text-subtle no-underline hover:text-black"}>
            {label}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
