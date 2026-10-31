"use client";

import { useEffect, useState } from "react";

const STOPS = [
  { id: "tour-score", t: "Your Readiness Score", d: "A score out of 100 across five areas, with your sector fit shown underneath. Click any area to see the checks behind it." },
  { id: "tour-history", t: "Score history", d: "Every time you re-score your CV, the new score is added here so you can see progress." },
  { id: "tour-highlights", t: "Your next steps", d: "The fixes that will lift your score most, biggest gains first, plus what's already working." },
];

export function ShowAround() {
  const [i, setI] = useState<number | null>(null);

  useEffect(() => {
    if (i === null) return;
    const el = document.getElementById(STOPS[i].id);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.classList.add("ring-2", "ring-brand");
    return () => el?.classList.remove("ring-2", "ring-brand");
  }, [i]);

  return (
    <div className="relative">
      <button type="button" aria-expanded={i !== null} onClick={() => setI(i === null ? 0 : null)} className="inline-flex min-h-[42px] items-center gap-2 rounded-full border border-edge bg-white px-[18px] text-sm text-black hover:bg-paper">
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 1.5l1.5 4 4 1.5-4 1.5L8 12.5 6.5 8.5l-4-1.5 4-1.5z" fill="none" stroke="#36604E" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
        {i === null ? "Show me around" : "End tour"}
      </button>
      {i !== null && (
        <div role="dialog" aria-label="Tour" className="absolute right-0 z-20 mt-2 w-72 rounded-2xl bg-black p-4 text-white shadow-xl">
          <p className="m-0 font-mono text-[11px] text-sage">
            {i + 1} OF {STOPS.length}
          </p>
          <p className="mt-1 mb-0 text-base">{STOPS[i].t}</p>
          <p className="mt-1 mb-3 text-sm leading-normal text-night-text">{STOPS[i].d}</p>
          <div className="flex justify-between">
            <button type="button" disabled={i === 0} onClick={() => setI(i - 1)} className="min-h-9 rounded-full border border-night-3 bg-transparent px-3 text-sm text-white disabled:opacity-40">
              Back
            </button>
            <button type="button" onClick={() => setI(i + 1 < STOPS.length ? i + 1 : null)} className="min-h-9 rounded-full border-0 bg-white px-4 text-sm text-black">
              {i + 1 < STOPS.length ? "Next" : "Done"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
