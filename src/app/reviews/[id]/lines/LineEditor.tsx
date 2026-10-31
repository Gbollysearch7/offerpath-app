"use client";

import { useState, useTransition } from "react";
import { acceptRewrite, rewriteLine } from "@/app/actions/cv";
import { CopyButton, FormError } from "@/components/client";
import { AlertDot, Arrow, CheckDot, ScoreRing, scoreColor } from "@/components/ui";
import type { LineResult } from "@/lib/types";

export function LineEditor({ reviewId, lines: initial, start, left: initialLeft, limit, ai }: { reviewId: string; lines: LineResult[]; start: number; left: number; limit: number; ai: boolean }) {
  const [lines, setLines] = useState(initial);
  const [i, setI] = useState(start);
  const [left, setLeft] = useState(initialLeft);
  const [variant, setVariant] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, start_] = useTransition();
  const c = lines[i];
  const strong = c.rewrite.startsWith("This line is already strong");

  const go = (n: number) => {
    const next = (n + lines.length) % lines.length;
    setI(next);
    setError(null);
    setStatus(null);
    window.history.replaceState(null, "", `?i=${next}`);
  };

  const tryAnother = () =>
    start_(async () => {
      setError(null);
      const res = await rewriteLine(reviewId, i, variant);
      if (res.error) setError(res.error);
      if (res.left !== undefined) setLeft(res.left);
      if (res.rewrite) {
        setLines((ls) => ls.map((l, k) => (k === i ? { ...l, rewrite: res.rewrite!, aiRewrite: res.ai } : l)));
        setVariant((v) => v + 1);
      }
    });

  const use = (text: string | null) =>
    start_(async () => {
      const res = await acceptRewrite(reviewId, i, text);
      if (res.error) return setError(res.error);
      setLines((ls) => ls.map((l, k) => (k === i ? { ...l, accepted: text ?? undefined } : l)));
      setStatus(text ? "Saved. Update this line in your CV, then re-score it." : "Rewrite removed.");
    });

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4 px-1 pt-2 pb-1">
        <div>
          <h1 className="m-0 text-[34px] font-normal leading-[1.1] tracking-[-1.5px] sm:text-[44px] sm:tracking-[-1.98px]">Line by line</h1>
          <p className="mt-2 mb-0 text-[15px] text-muted">Improve your CV one bullet point at a time.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => go(i - 1)} className="inline-flex min-h-[42px] items-center gap-1.5 rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper">
            <Arrow dir="left" />
            Previous
          </button>
          <span className="px-1.5 font-mono text-xs text-muted" aria-live="polite">
            LINE {i + 1} OF {lines.length}
          </span>
          <button type="button" onClick={() => go(i + 1)} className="inline-flex min-h-[42px] items-center gap-1.5 rounded-full border-0 bg-black px-4 text-sm text-white hover:bg-ink-2">
            Next
            <Arrow color="#FFFFFF" />
          </button>
        </div>
      </div>

      <section aria-label="Current line" className="flex flex-wrap items-center gap-6 rounded-3xl bg-white px-7 py-[26px]">
        <div className="min-w-0 flex-[1_1_420px]">
          <p className="m-0 font-mono text-xs text-subtle">{c.where}</p>
          <p className="mt-2.5 mb-0 text-[22px] leading-[1.45] tracking-[-0.02em]">{c.text}</p>
          {c.accepted && (
            <p className="mt-3 mb-0 flex gap-2 text-sm text-brand">
              <CheckDot size={18} label={null} /> Your saved version: {c.accepted}
            </p>
          )}
        </div>
        <ScoreRing value={c.score} of={10} size={88} stroke={7} color={scoreColor(c.score, 10)} label={`Line score ${c.score} out of 10`}>
          <span className="text-[28px] leading-none tracking-[-0.04em]">{c.score}</span>
          <span className="mt-[3px] font-mono text-[10px] text-subtle">LINE SCORE</span>
        </ScoreRing>
      </section>

      <section aria-labelledby="an-h" className="flex flex-col gap-[18px] rounded-3xl bg-white px-7 py-6">
        <h2 id="an-h" className="m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">
          ANALYSIS
        </h2>
        <div className="flex flex-wrap gap-6">
          {c.cols.map((col) => (
            <div key={col.name} className="flex min-w-0 flex-[1_1_220px] flex-col gap-3">
              <p className="m-0 text-base tracking-[-0.02em]">{col.name}</p>
              {col.items.map((it) => (
                <div key={it.t} className="flex items-start gap-2.5 text-sm leading-[1.45]">
                  {it.ok ? <CheckDot /> : <AlertDot />}
                  <span className={it.ok ? "text-muted" : "text-black"}>{it.t}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="ai-h" className="flex flex-col gap-4 rounded-3xl bg-white px-7 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="ai-h" className="m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">
            SUGGESTED REWRITE
          </h2>
          <span className="text-[13px] text-subtle">
            {c.aiRewrite ? "AI-assisted" : "Suggested"}
            {ai && ` · ${Math.max(0, left)} of ${limit} AI rewrites left today`}
          </span>
        </div>
        <p aria-live="polite" className="m-0 rounded-2xl border border-mint bg-okbg px-[18px] py-4 text-[17px] leading-relaxed">
          {pending ? "Writing a new version…" : c.rewrite}
        </p>
        {!strong && <p className="m-0 text-sm text-muted">Numbers in [brackets] are placeholders for your real figures. We never add facts you didn&apos;t give us.</p>}
        <FormError message={error} />
        {status && (
          <p role="status" className="m-0 text-sm text-brand">
            {status}
          </p>
        )}
        {!strong && (
          <div className="flex flex-wrap gap-2.5">
            <button type="button" disabled={pending} onClick={() => use(c.rewrite)} className="min-h-[46px] rounded-full border-0 bg-black px-[22px] text-[15px] font-medium text-white hover:bg-ink-2 disabled:opacity-50">
              {c.accepted === c.rewrite ? "Saved" : "Use this rewrite"}
            </button>
            <button type="button" disabled={pending || left <= 0} onClick={tryAnother} className="min-h-[46px] rounded-full border border-edge bg-white px-5 text-[15px] text-black hover:bg-paper disabled:opacity-50">
              Try another
            </button>
            <CopyButton text={c.rewrite} className="min-h-[46px] rounded-full border-0 bg-transparent px-4 text-[15px] text-muted hover:text-black">
              Copy
            </CopyButton>
          </div>
        )}
      </section>
    </>
  );
}
