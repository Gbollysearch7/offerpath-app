"use client";

import { useMemo, useState } from "react";
import { pill, SearchIcon } from "@/components/ui";

export function VerbBank({ data, weak }: { data: [string, string[]][]; weak: { from: string; to: string }[] }) {
  const [cat, setCat] = useState(0);
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const verbs = useMemo(() => {
    if (!q.trim()) return data[cat][1];
    const all = [...new Set(data.flatMap(([, v]) => v))];
    return all.filter((v) => v.toLowerCase().includes(q.trim().toLowerCase()));
  }, [cat, q, data]);

  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      setCopied(v);
      setTimeout(() => setCopied(null), 1400);
    } catch {
      setCopied(null);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4 px-1 pt-2 pb-1">
        <div>
          <h1 className="m-0 text-[34px] font-normal leading-[1.1] tracking-[-1.5px] sm:text-[44px] sm:tracking-[-1.98px]">Action verb bank</h1>
          <p className="mt-2 mb-0 text-[15px] text-muted">Start every bullet with a verb that shows what you did. Choose by the skill you want to show.</p>
        </div>
        <label className="flex min-h-[42px] min-w-[240px] items-center gap-2 rounded-full bg-white px-3.5">
          <SearchIcon />
          <span className="sr-only-abs">Search verbs</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search verbs" className="flex-1 border-0 bg-transparent text-sm outline-none" />
        </label>
      </div>
      {weak.length > 0 && (
        <div className="flex items-center gap-3.5 rounded-[20px] bg-white px-[18px] py-4">
          <span className="shrink-0 rounded-full bg-black px-[9px] py-1 font-mono text-[11px] text-white">YOUR CV</span>
          <p className="m-0 text-sm leading-normal">
            Swap your weak verbs:{" "}
            {weak.map((w, i) => (
              <span key={w.from}>
                <span className="text-subtle line-through">{w.from}</span> → {w.to}
                {i < weak.length - 1 ? ", " : "."}
              </span>
            ))}
          </p>
        </div>
      )}
      {!q.trim() && (
        <div role="tablist" aria-label="Skill" className="flex flex-wrap gap-2">
          {data.map(([t], i) => (
            <button key={t} role="tab" aria-selected={cat === i} aria-controls="verb-panel" onClick={() => setCat(i)} className={pill(cat === i)}>
              {t}
            </button>
          ))}
        </div>
      )}
      <section id="verb-panel" aria-label="Verbs" className="grid grid-cols-2 gap-2.5 rounded-3xl bg-white p-[26px] sm:grid-cols-3 md:grid-cols-4">
        {verbs.length === 0 && <p className="col-span-full m-0 text-sm text-muted">No verbs match “{q}”.</p>}
        {verbs.map((v) => (
          <button key={v} type="button" onClick={() => copy(v)} className="min-h-12 rounded-[14px] border-0 bg-canvas text-[15px] text-black hover:bg-mist" aria-label={`Copy ${v}`}>
            {copied === v ? "Copied" : v}
          </button>
        ))}
      </section>
      <p className="m-0 px-1 text-[13px] text-subtle" aria-live="polite">
        {copied ? `“${copied}” copied to your clipboard.` : "Click a verb to copy it."}
      </p>
    </>
  );
}
