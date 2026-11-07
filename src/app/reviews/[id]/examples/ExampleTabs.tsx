"use client";

import { useState } from "react";
import { onTabListKey } from "@/components/a11y";
import { CopyButton } from "@/components/client";
import { pill } from "@/components/ui";

export function ExampleTabs({ data }: { data: [string, [string, string[]][]][] }) {
  const [cat, setCat] = useState(0);
  return (
    <>
      <div role="tablist" aria-label="Experience type" onKeyDown={onTabListKey} className="flex flex-wrap gap-2">
        {data.map(([t], i) => (
          <button key={t} type="button" role="tab" id={`ex-tab-${i}`} aria-selected={cat === i} tabIndex={cat === i ? 0 : -1} aria-controls="ex-panel" onClick={() => setCat(i)} className={pill(cat === i)}>
            {t}
          </button>
        ))}
      </div>
      <section id="ex-panel" role="tabpanel" aria-labelledby={`ex-tab-${cat}`} className="rounded-3xl bg-white px-[26px] py-2">
        {data[cat][1].map(([line, tags], i, arr) => (
          <div key={line} className={`flex flex-wrap items-center gap-x-5 gap-y-3 py-5 ${i < arr.length - 1 ? "border-b border-line" : ""}`}>
            <div className="min-w-0 flex-[1_1_420px]">
              <p className="m-0 text-[17px] leading-[1.55] tracking-[-0.01em]">{line}</p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span key={t} className="rounded-full bg-canvas px-[9px] py-1 font-mono text-[11px] text-muted">
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <CopyButton text={line} copiedLabel="Copied to clipboard" className="min-h-10 rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper">
              Use as a starting point
            </CopyButton>
          </div>
        ))}
      </section>
    </>
  );
}
