import Link from "next/link";
import type { AreaResult } from "@/lib/types";
import { checkBadge, cx } from "./ui";

export type SidebarActive = "overview" | "breakdown" | "lines" | "samples" | "verbsbank" | string;

const link = (on: boolean) =>
  cx("flex min-h-[38px] items-center gap-2.5 rounded-xl px-2.5 text-sm no-underline", on ? "bg-black font-medium text-white hover:text-white" : "text-ink-2 hover:bg-canvas hover:text-black");

function Items({ reviewId, areas, active }: { reviewId: string; areas: AreaResult[]; active: SidebarActive }) {
  const base = `/reviews/${reviewId}`;
  const top: [string, string, string][] = [
    ["overview", "Overview", base],
    ["breakdown", "Score breakdown", `${base}/breakdown`],
  ];
  const tools: [string, string, string][] = [
    ["lines", "Line by line", `${base}/lines`],
    ["samples", "Example CV lines", `${base}/examples`],
    ["verbsbank", "Action verb bank", `${base}/verbs`],
  ];
  const L = ([id, label, href]: [string, string, string]) => (
    <Link key={id} href={href} aria-current={id === active ? "page" : undefined} className={link(id === active)}>
      {label}
    </Link>
  );
  return (
    <>
      {top.map(L)}
      <div className="mx-2.5 my-2 h-px bg-line" />
      {tools.map(L)}
      {areas.map((g) => (
        <div key={g.key} className="flex flex-col gap-0.5">
          <p className="mx-2.5 mt-4 mb-1.5 font-mono text-[11px] tracking-[0.04em] text-subtle">
            {g.name.toUpperCase()} · <span className="text-black">{g.score}</span>
          </p>
          {g.checks.map((c) => {
            const on = c.key === active;
            return (
              <Link key={c.key} href={`${base}/checks/${c.key}`} aria-current={on ? "page" : undefined} className={link(on)}>
                <span className="flex-1">{c.name}</span>
                <span className={cx("inline-flex h-[22px] min-w-[26px] items-center justify-center rounded-full px-1.5 font-mono text-xs", checkBadge(c.score))}>
                  <span className="sr-only-abs">Score </span>
                  {c.score}
                </span>
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

export function ResultsSidebar(props: { reviewId: string; areas: AreaResult[]; active: SidebarActive }) {
  return (
    <div className="w-full lg:max-w-[280px] lg:flex-[1_1_260px]">
      <details className="rounded-3xl bg-white px-3.5 py-3 lg:hidden">
        <summary className="cursor-pointer px-2.5 py-2 font-mono text-[11px] tracking-[0.04em] text-subtle">RESULTS AND FEEDBACK</summary>
        <nav aria-label="Results and feedback (mobile)" className="flex flex-col gap-0.5 pt-2">
          <Items {...props} />
        </nav>
      </details>
      <nav aria-label="Results and feedback" className="hidden w-full flex-col gap-0.5 rounded-3xl bg-white px-3.5 pt-[18px] pb-[22px] lg:flex">
        <p className="mx-2.5 mt-1 mb-2.5 font-mono text-[11px] tracking-[0.04em] text-subtle">RESULTS AND FEEDBACK</p>
        <Items {...props} />
      </nav>
    </div>
  );
}
