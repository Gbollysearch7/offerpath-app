"use client";

import { useEffect, useState } from "react";

// Sample data only: a fictional student and university. Counts up to 68, then shows a fix being applied.

const DELAYS = ["op-d1", "op-d2", "op-d3", "op-d4", "op-d5", "op-d6"];
const KPIS = [["Active students", "1,240"], ["Average score", "71"], ["Improvement", "+14"], ["CVs reviewed", "3,580"]];
const FACULTIES: [string, number][] = [["Business", 74], ["Engineering", 70], ["Humanities", 66], ["Sciences", 72]];

const band = (s: number) => (s >= 90 ? "Interview-ready" : s >= 75 ? "Strong" : s >= 50 ? "Getting there" : "Needs work");

export function HeroPreview() {
  const [count, setCount] = useState(68);
  const [after, setAfter] = useState(false);
  const [motion, setMotion] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setMotion(true);
    setCount(0);
    let n = 0;
    const counter = setInterval(() => {
      n = Math.min(68, n + 2);
      setCount(n);
      if (n >= 68) clearInterval(counter);
    }, 30);
    const swap = setInterval(() => setAfter((a) => !a), 3600);
    return () => {
      clearInterval(counter);
      clearInterval(swap);
    };
  }, []);

  const score = after && count >= 68 ? 72 : count;
  const areas: [string, number][] = [["Impact", after ? 66 : 58], ["Clarity", 72], ["Structure and ATS", 80], ["Sector fit", 61], ["Spelling and grammar", 92], ["Length and formatting", 74]];

  return (
    <div className="flex flex-wrap gap-5 rounded-[40px] bg-canvas p-4 sm:p-7">
      <div className="flex min-w-0 flex-[1_1_460px] flex-col gap-5 rounded-[28px] bg-white p-5 text-left sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <p className="m-0 font-mono text-xs text-subtle">SAMPLE STUDENT · ECONOMICS, YEAR 3</p>
          <span className="rounded-full bg-mint px-3 py-1.5 text-[13px] font-medium text-brand">{band(score)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-[26px]">
          <div className="relative h-[132px] w-[132px] flex-none">
            <svg width="132" height="132" viewBox="0 0 120 120" role="img" aria-label={`Sample Readiness Score ${score} out of 100`}>
              <circle cx="60" cy="60" r="50" fill="none" stroke="#EEF2EF" strokeWidth="9" />
              <circle cx="60" cy="60" r="50" fill="none" stroke="#36604E" strokeWidth="9" strokeLinecap="round" strokeDasharray="314.2" strokeDashoffset={(314.2 * (1 - score / 100)).toFixed(1)} transform="rotate(-90 60 60)" style={{ transition: "stroke-dashoffset 700ms cubic-bezier(.2,.7,.2,1)" }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[44px] leading-none tracking-[-0.05em] tabular-nums">{score}</span>
              <span className="mt-1.5 font-mono text-[11px] text-subtle">READINESS</span>
            </div>
          </div>
          <div className="flex min-w-[220px] flex-auto flex-col gap-2.5">
            {areas.map(([n, v], i) => (
              <div key={n} className="grid grid-cols-[minmax(0,1fr)_96px_26px] items-center gap-2.5 text-[13px]">
                <span className="truncate text-muted">{n}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-line">
                  <span className={`op-grow ${DELAYS[i]} block h-1.5 rounded-full bg-sage`} style={{ width: `${v}%` }} />
                </span>
                <span className="text-right font-mono text-xs">{v}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex min-h-[118px] flex-col gap-2 rounded-[22px] bg-canvas px-5 py-[18px]" aria-live={motion ? "off" : undefined}>
          <p className="m-0 font-mono text-xs text-brand">{after ? "+4 IMPACT · FIX APPLIED" : "−4 IMPACT · EXPERIENCE, LINE 6"}</p>
          {after ? (
            <div key="after" className="op-swap flex flex-col gap-2">
              <p className="m-0 text-base leading-normal">
                Organised <span className="rounded-lg border-[1.5px] border-dashed border-sage px-2 py-px text-brand">12</span> society events for <span className="rounded-lg border-[1.5px] border-dashed border-sage px-2 py-px text-brand">400+</span> students.
              </p>
              <p className="m-0 text-[13px] text-subtle">Numbers come from the student. Rewrites never invent facts.</p>
            </div>
          ) : (
            <div key="before" className="op-swap flex flex-col gap-2">
              <p className="m-0 text-base leading-normal">Helped organise events for the Economics Society.</p>
              <p className="m-0 text-[13px] text-subtle">No result shown. What changed because of your work?</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-[18px] rounded-[28px] bg-white p-5 text-left sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <p className="m-0 text-base font-medium tracking-[-0.01em]">Careers dashboard</p>
          <span className="rounded-full bg-canvas px-2.5 py-1 font-mono text-[11px] text-muted">SAMPLE DATA · FICTIONAL UNIVERSITY</span>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {KPIS.map(([l, v]) => (
            <div key={l} className="flex-[1_1_110px] rounded-2xl bg-canvas px-3.5 py-3">
              <p className="m-0 text-xs text-subtle">{l}</p>
              <p className="mt-1 mb-0 text-[28px] tracking-[-0.04em] tabular-nums">{v}</p>
            </div>
          ))}
        </div>
        <p className="mt-1 mb-0 text-[13px] font-medium">Average score by faculty</p>
        <div className="flex flex-col gap-2.5">
          {FACULTIES.map(([n, v], i) => (
            <div key={n} className="grid grid-cols-[110px_minmax(0,1fr)_26px] items-center gap-2.5 text-[13px]">
              <span className="text-muted">{n}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-line">
                <span className={`op-grow ${DELAYS[i + 1]} block h-2.5 rounded-full bg-brand`} style={{ width: `${v}%` }} />
              </span>
              <span className="text-right font-mono text-xs">{v}</span>
            </div>
          ))}
        </div>
        <div className="mt-auto flex items-center gap-2.5 rounded-2xl bg-canvas px-3.5 py-3 text-[13px] text-body">
          <span className="op-breathe h-2 w-2 flex-none rounded-full bg-brand" />3 students may need a hand this week
        </div>
      </div>
    </div>
  );
}
