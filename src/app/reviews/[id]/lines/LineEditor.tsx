"use client";

import { useRef, useState, useTransition } from "react";
import { focusSoon } from "@/components/a11y";
import { acceptRewrite, rewriteLine, undoAccepted } from "@/app/actions/cv";
import { CopyButton, FormError } from "@/components/client";
import { AlertDot, Arrow, CheckDot, ScoreRing, scoreColor } from "@/components/ui";
import type { RewriteCheck } from "@/lib/analysis/rewrite-check";
import { wordDiff } from "@/lib/analysis/word-diff";
import type { LineResult } from "@/lib/types";

type CheckedLine = LineResult & { check: RewriteCheck };

export function LineEditor({ reviewId, lines: initial, start, left: initialLeft, limit, ai }: { reviewId: string; lines: CheckedLine[]; start: number; left: number; limit: number; ai: boolean }) {
  const [lines, setLines] = useState(initial);
  const [i, setI] = useState(start);
  const [left, setLeft] = useState(initialLeft);
  const [variant, setVariant] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [asked, setAsked] = useState<RewriteCheck["issues"]>([]);
  const [conflict, setConflict] = useState(false);
  const [pending, start_] = useTransition();
  const editButton = useRef<HTMLButtonElement>(null);
  const c = lines[i];
  const strong = c.rewrite.startsWith("This line is already strong");
  // While the student is typing, what needs confirming comes from the server's check of their words.
  const toConfirm = editing === null ? c.check.issues.filter((x) => x.severity === "confirm") : asked;
  const unconfirmed = toConfirm.some((x) => !ticked.includes(x.key));
  const dropped = c.check.issues.filter((x) => x.severity === "note");

  const go = (n: number) => {
    const next = (n + lines.length) % lines.length;
    setI(next);
    setError(null);
    setStatus(null);
    setNote(null);
    setTicked([]);
    setEditing(null);
    setAsked([]);
    window.history.replaceState(null, "", `?i=${next}`);
  };

  const tryAnother = () =>
    start_(async () => {
      setError(null);
      setStatus(null);
      const res = await rewriteLine(reviewId, i, variant);
      if (res.error) setError(res.error);
      if (res.left !== undefined) setLeft(res.left);
      if (res.rewrite && res.check) {
        const check = res.check;
        setNote(res.note ?? null);
        setTicked([]);
        setLines((ls) => ls.map((l, k) => (k === i ? { ...l, rewrite: res.rewrite!, aiRewrite: res.ai, check } : l)));
        setVariant((v) => v + 1);
      }
    });

  const use = (text: string | null, typed = false) =>
    start_(async () => {
      setError(null);
      const expected = c.accepted ?? null;
      const res = await acceptRewrite(reviewId, i, text, ticked, { typed, expected });
      if (res.conflict) setConflict(true);
      if (res.error) {
        if (typed && res.check) setAsked(res.check.issues.filter((x) => x.severity === "confirm"));
        return setError(res.error);
      }
      setLines((ls) => ls.map((l, k) => (k === i ? { ...l, accepted: text ?? undefined, acceptedHistory: [...(l.acceptedHistory ?? []), { text: expected, check: l.acceptedCheck ?? null, at: "" }] } : l)));
      setEditing(null);
      setAsked([]);
      setTicked([]);
      setStatus(text ? "Saved. Your score is still for the CV as uploaded: upload the updated CV to score it." : "Back to your own wording.");
    });

  const undo = () =>
    start_(async () => {
      setError(null);
      const res = await undoAccepted(reviewId, i, c.accepted ?? null);
      if (res.conflict) setConflict(true);
      if (res.error) return setError(res.error);
      setLines((ls) => ls.map((l, k) => (k === i ? { ...l, accepted: res.accepted ?? undefined, acceptedHistory: (l.acceptedHistory ?? []).slice(0, -1) } : l)));
      setStatus(res.accepted ? `Back to your earlier version: ${res.accepted}` : "Back to your own wording.");
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
            <>
              <p className="mt-3 mb-0 flex gap-2 text-sm text-brand">
                <CheckDot size={18} label={null} /> Your saved version: {c.accepted}
              </p>
              <p className="mt-1.5 mb-0 text-sm text-muted">The line score and analysis here are for the wording above it, as uploaded. Your saved version hasn&apos;t been scored.</p>
            </>
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
        {!pending && !strong && !c.check.unchanged && (
          <p className="m-0 text-sm text-muted">
            <span className="font-medium text-black">What changes: </span>
            {wordDiff(c.text, c.rewrite).map((d, n) =>
              d.kind === "same" ? (
                <span key={n}>{d.t} </span>
              ) : d.kind === "added" ? (
                <ins key={n} className="rounded bg-mint px-0.5 text-black no-underline">
                  <span className="sr-only-abs">added: </span>
                  {d.t}{" "}
                </ins>
              ) : (
                <del key={n}>
                  <span className="sr-only-abs">removed: </span>
                  {d.t}{" "}
                </del>
              ),
            )}
          </p>
        )}
        {conflict && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border-2 border-black px-4 py-3 text-sm">
            <span>This line changed in another tab or window. Nothing was saved from here.</span>
            <button type="button" onClick={() => window.location.reload()} className="min-h-10 rounded-full border-0 bg-black px-4 text-sm font-medium text-white">
              Reload the latest version
            </button>
          </div>
        )}
        {editing !== null && (
          <label className="flex flex-col gap-1 text-sm">
            Your wording. Anything your CV doesn&apos;t show for this entry, we&apos;ll ask you to confirm.
            <textarea autoFocus value={editing} onChange={(e) => setEditing(e.target.value)} rows={3} className="rounded-2xl border border-edge bg-white p-3 text-[15px] text-black" />
          </label>
        )}
        {note && (
          <p role="status" className="m-0 text-sm text-black">
            {note}
          </p>
        )}
        {!pending && toConfirm.length > 0 && (
          <fieldset className="m-0 flex flex-col gap-2.5 rounded-2xl border border-edge p-4">
            <legend className="px-1 text-sm font-medium text-black">Is this accurate? Tick each one to use this version.</legend>
            {toConfirm.map((x) => (
              <label key={x.key} className="flex items-start gap-2.5 text-sm leading-[1.45] text-black">
                <input type="checkbox" className="mt-[3px] size-4 shrink-0" checked={ticked.includes(x.key)} onChange={(e) => setTicked((t) => (e.target.checked ? [...t, x.key] : t.filter((k) => k !== x.key)))} />
                <span>{x.message}</span>
              </label>
            ))}
          </fieldset>
        )}
        {!pending && c.check.questions.length > 0 && (
          <div className="text-sm text-black">
            <p className="m-0 font-medium">Only you can fill the [brackets]:</p>
            <ul className="mt-1 mb-0 list-disc pl-5">
              {c.check.questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </div>
        )}
        {!pending && dropped.length > 0 && <p className="m-0 text-sm text-muted">{dropped.map((x) => x.message).join(" ")}</p>}
        {!pending && !strong && editing === null && c.check.used.some((u) => u.kind === "figure" || u.kind === "date" || u.kind === "entity") && (
          <p className="m-0 text-sm text-muted">
            From your CV, under {c.check.entry?.heading}: {[...new Set(c.check.used.filter((u) => u.kind !== "qualification" && u.kind !== "responsibility").map((u) => u.value))].join(", ")}
          </p>
        )}
        {!strong && <p className="m-0 text-sm text-muted">We compare each suggestion with this entry in your CV: figures, dates, names, tools, qualifications and words that raise your level of responsibility. This is an automatic check and it can miss things, especially new details in plain words, so make sure the wording accurately describes your contribution before you use it.</p>}
        <FormError message={error} />
        {status && (
          <p role="status" className="m-0 text-sm text-brand">
            {status}
          </p>
        )}
        {editing !== null ? (
          <div className="flex flex-wrap gap-2.5">
            <button type="button" disabled={pending || unconfirmed || editing.trim().length < 3} onClick={() => use(editing, true)} className="min-h-[46px] rounded-full border-0 bg-black px-[22px] text-[15px] font-medium text-white hover:bg-ink-2 disabled:opacity-50">
              Save my wording
            </button>
            <button type="button" disabled={pending} onClick={() => { setEditing(null); setAsked([]); setTicked([]); focusSoon(() => editButton.current); }} className="min-h-[46px] rounded-full border border-edge bg-white px-5 text-[15px] text-black hover:bg-paper">
              Cancel
            </button>
          </div>
        ) : !strong && (
          <div className="flex flex-wrap gap-2.5">
            <button type="button" disabled={pending || unconfirmed} onClick={() => use(c.rewrite)} className="min-h-[46px] rounded-full border-0 bg-black px-[22px] text-[15px] font-medium text-white hover:bg-ink-2 disabled:opacity-50">
              {c.accepted === c.rewrite ? "Saved" : "Use this rewrite"}
            </button>
            <button type="button" disabled={pending || left <= 0} onClick={tryAnother} className="min-h-[46px] rounded-full border border-edge bg-white px-5 text-[15px] text-black hover:bg-paper disabled:opacity-50">
              Try another
            </button>
            <button ref={editButton} type="button" disabled={pending} onClick={() => { setEditing(c.accepted ?? c.rewrite); setTicked([]); setAsked([]); setStatus(null); }} className="min-h-[46px] rounded-full border border-edge bg-white px-5 text-[15px] text-black hover:bg-paper">
              Edit
            </button>
            {c.accepted && (
              <button type="button" disabled={pending} onClick={() => use(null)} className="min-h-[46px] rounded-full border border-edge bg-white px-5 text-[15px] text-black hover:bg-paper">
                Keep my original
              </button>
            )}
            {!!c.acceptedHistory?.length && (
              <button type="button" disabled={pending} onClick={undo} className="min-h-[46px] rounded-full border border-edge bg-white px-5 text-[15px] text-black hover:bg-paper">
                Undo
              </button>
            )}
            {!unconfirmed && (
              <CopyButton text={c.rewrite} className="min-h-[46px] rounded-full border-0 bg-transparent px-4 text-[15px] text-muted hover:text-black">
                Copy
              </CopyButton>
            )}
          </div>
        )}
      </section>
    </>
  );
}
