"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { reviewDraft } from "@/app/actions/letters";
import { FormError } from "@/components/client";
import { onTabListKey } from "@/components/a11y";
import { AlertDot, CheckDot, cx, ScoreRing, scoreColor } from "@/components/ui";
import { bandLabel } from "@/lib/analysis/labels";
import type { CoverLetterPayload } from "@/lib/types";

const esc = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

function highlight(text: string, terms: string[], signoff: string | null): ReactNode[] {
  const parts = [...terms.map(esc), ...(signoff ? [esc(signoff)] : [])];
  if (!parts.length) return [text];
  const re = new RegExp(`(${parts.join("|")})`, "gi");
  return text.split(re).map((seg, i) => {
    if (signoff && seg.toLowerCase() === signoff.toLowerCase())
      return (
        <span key={i} className="border-b-2 border-black font-medium">
          {seg}
          <span className="sr-only-abs"> (to fix)</span>
        </span>
      );
    if (terms.some((t) => t.toLowerCase() === seg.toLowerCase()))
      return (
        <mark key={i} className="rounded bg-mint px-[3px] py-px text-inherit">
          {seg}
        </mark>
      );
    return <span key={i}>{seg}</span>;
  });
}

/** A review from before versioned letter scoring: its saved number and checks, unchanged. Anything further happens on a new copy. */
export function LetterReviewView({ id, p, score, downloadable }: { id: string; p: CoverLetterPayload; score: number | null; downloadable: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<"letter" | "ad">("letter");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const signoffBad = p.checks.find((c) => c.t === "Sign-off matches the greeting" && !c.ok);
  const signoff = signoffBad ? (p.letterText.match(/yours\s+(faithfully|sincerely)/i)?.[0] ?? null) : null;
  const blocks = p.letterText.split(/\n\s*\n/).filter((b) => b.trim());
  const convention = /faithfully/i.test(p.letterText) || /sincerely/i.test(p.letterText);

  const recheck = () =>
    start(async () => {
      setError(null);
      const res = await reviewDraft(id);
      if (res.error || !res.id) setError(res.error ?? "Something went wrong.");
      else router.push(`/letters/${res.id}`);
    });

  return (
    <main id="main" className="mx-auto flex max-w-[1440px] flex-col gap-5 px-4 pt-6 pb-14 sm:px-7">
      <div className="flex flex-wrap items-end justify-between gap-4 px-1 pt-2 pb-1">
        <div className="min-w-0">
          <p className="m-0 font-mono text-xs text-brand">COVER LETTER REVIEW</p>
          <h1 className="mt-1.5 mb-0 text-[32px] font-normal leading-[1.1] tracking-[-1.4px] sm:text-[44px] sm:tracking-[-1.98px]">{p.employer} cover letter</h1>
          <p className="mt-2 mb-0 text-[15px] text-muted">
            Checked against {p.jobTitle}, {p.employer} · UK conventions
          </p>
        </div>
        <Link href="/letters?mode=review" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-black px-[18px] text-sm font-medium text-white no-underline hover:bg-ink-2 hover:text-white">
          Re-score letter
        </Link>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[1_1_400px] flex-col gap-5 lg:max-w-[480px]">
          <section aria-labelledby="os-h" className="flex items-center gap-5 rounded-3xl bg-white px-6 py-[22px]">
            <ScoreRing value={score ?? 0} size={88} stroke={7} color={scoreColor(score ?? 0)} label={`Letter score ${score ?? "not recorded"}`}>
              <span className="text-[28px] tracking-[-0.04em]">{score ?? "–"}</span>
            </ScoreRing>
            <div>
              <h2 id="os-h" className="m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">
                OVERALL{score === null ? "" : ` · ${bandLabel(score).toUpperCase()}`} · EARLIER METHOD
              </h2>
              <p className="mt-2 mb-0 text-[15px] leading-normal">{p.summary}</p>
            </div>
          </section>

          <section aria-labelledby="ck-h" className="flex flex-col gap-2.5 rounded-3xl bg-white px-6 py-[22px]">
            <h2 id="ck-h" className="mt-0 mb-1.5 font-mono text-xs font-normal tracking-[0.04em] text-subtle">
              CORE CHECKS
            </h2>
            {[...p.checks].sort((a, b) => Number(a.ok) - Number(b.ok)).map((c) => (
              <div key={c.t} className={cx("flex gap-3 rounded-2xl px-3.5 py-3", c.ok ? "bg-white" : "bg-canvas")}>
                {c.ok ? <CheckDot size={20} /> : <AlertDot size={20} />}
                <div className="min-w-0">
                  <p className="m-0 text-[15px]">{c.t}</p>
                  <p className="mt-[3px] mb-0 text-[13px] leading-[1.45] text-muted">{c.d}</p>
                </div>
              </div>
            ))}
          </section>

          <section aria-labelledby="rw-h" className="flex flex-col gap-3.5 rounded-3xl bg-white px-6 py-[22px]">
            <h2 id="rw-h" className="m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">
              CHECK WITH THE CURRENT METHOD
            </h2>
            <p className="m-0 text-[15px] leading-[1.55]">This makes a new report from the same letter, which you can then edit. This report and its score stay as they are.</p>
            <FormError message={error} />
            <button type="button" disabled={pending} onClick={recheck} className="min-h-12 rounded-full border-0 bg-black text-[15px] font-medium text-white hover:bg-ink-2 disabled:opacity-50">
              {pending ? "Checking…" : "Check as a new letter"}
            </button>
            {downloadable && (
              <div className="flex flex-wrap justify-center gap-2.5">
                <a href={`/api/letters/${id}?format=docx`} className="text-sm">Download Word</a>
                <a href={`/api/letters/${id}?format=pdf`} className="text-sm">Download PDF</a>
              </div>
            )}
          </section>
        </div>

        <section aria-label="Your letter" className="flex min-w-0 flex-[999_1_560px] flex-col gap-[18px] rounded-3xl bg-white px-[26px] pt-[22px] pb-9">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="View" onKeyDown={onTabListKey} className="flex gap-1 rounded-full bg-canvas p-1">
              <button type="button" role="tab" id="view-tab-letter" aria-selected={tab === "letter"} tabIndex={tab === "letter" ? 0 : -1} onClick={() => setTab("letter")} className={cx("min-h-9 rounded-full border-0 px-4 text-sm", tab === "letter" ? "bg-white text-black" : "bg-transparent text-muted")}>
                Cover letter
              </button>
              <button type="button" role="tab" id="view-tab-ad" aria-selected={tab === "ad"} tabIndex={tab === "ad" ? 0 : -1} onClick={() => setTab("ad")} className={cx("min-h-9 rounded-full border-0 px-4 text-sm", tab === "ad" ? "bg-white text-black" : "bg-transparent text-muted")}>
                Job ad
              </button>
            </div>
            <span className="font-mono text-xs text-subtle">
              {p.words} WORDS · {p.paras} PARAGRAPHS
            </span>
          </div>
          {tab === "letter" ? (
            <div className="max-w-[680px] text-base leading-[1.75] text-ink-2">
              {blocks.map((b, i) => (
                <p key={i} className={cx("m-0 whitespace-pre-line", i > 0 && "mt-4")}>
                  {highlight(b, p.keywordsUsed, signoff)}
                </p>
              ))}
            </div>
          ) : (
            <div className="max-w-[680px] whitespace-pre-line text-[15px] leading-[1.75] text-ink-2">{p.jobText || "No job ad was added for this letter."}</div>
          )}
          {convention && tab === "letter" && (
            <div className="max-w-[680px] rounded-2xl bg-canvas px-4 py-3.5 text-sm leading-[1.55] text-body">
              <span className="font-medium text-black">UK convention:</span> use &quot;Yours faithfully&quot; with &quot;Dear Sir or Madam&quot;, and &quot;Yours sincerely&quot; when you address a named person or &quot;Dear Hiring Manager&quot;.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
