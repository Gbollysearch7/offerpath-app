import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import { cx, Logo } from "./ui";

const ITEMS: [string, string, string][] = [
  ["dashboard", "Dashboard", "/admin"],
  ["students", "Students", "/admin/students"],
  ["import", "Import student records", "/admin/import"],
  ["opportunities", "Opportunities", "/admin/opportunities"],
  ["team", "Careers team", "/admin/team"],
  ["settings", "Settings and SSO", "/admin/settings"],
  ["reports", "Reports and exports", "/admin/students#export"],
];

export function AdminNav({ active, university, name, title }: { active: string; university: string; name: string; title: string }) {
  const initials = name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  return (
    <nav aria-label="Admin" className="flex w-full flex-col gap-1 bg-night px-4 py-6 text-white lg:min-h-screen lg:w-[260px]">
      <Link href="/admin" className="flex items-center gap-2.5 px-2 text-lg font-medium tracking-[-0.02em] text-white no-underline hover:text-white">
        <Logo dark />
        Offerpath
      </Link>
      <div className="mx-2 my-[18px] rounded-[14px] bg-night-2 px-3.5 py-3">
        <p className="m-0 font-mono text-[10px] text-sage">CAREERS ADMIN</p>
        <p className="mt-1 mb-0 text-sm">{university}</p>
      </div>
      {ITEMS.map(([id, label, href]) => (
        <Link
          key={id}
          href={href}
          aria-current={id === active ? "page" : undefined}
          className={cx("flex min-h-[42px] items-center rounded-xl px-3 text-sm no-underline", id === active ? "bg-white font-medium text-black hover:text-black" : "text-night-text hover:bg-night-2 hover:text-white")}
        >
          {label}
        </Link>
      ))}
      <div className="mt-6 flex items-center gap-2.5 border-t border-night-3 px-2 pt-3 lg:mt-auto">
        <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-night-3 text-[13px]">{initials}</span>
        <span className="flex-1 text-[13px] leading-[1.35]">
          {name}
          <br />
          <span className="text-night-muted">{title}</span>
        </span>
        <form action={signOut}>
          <button type="submit" className="min-h-9 rounded-full border border-night-3 bg-transparent px-3 text-xs text-night-text hover:text-white">
            Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}
