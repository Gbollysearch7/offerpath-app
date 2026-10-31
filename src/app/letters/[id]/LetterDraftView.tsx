"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteParagraph, editParagraph, reviewDraft, saveLetter } from "@/app/actions/letters";
import { FormError } from "@/components/client";
import { AlertDot, CheckDot } from "@/components/ui";
import type { CoverLetterPayload } from "@/lib/types";

export function LetterDraftView({ id, p }: { id: string; p: CoverLetterPayload }) {
  const router = useRouter();
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const header = p.letterText.split(/\n\s*\n/)[0] ?? "";

  const run = (fn: () => Promise<{ error?: string; id?: string }>, after?: (r: { id?: string }) => void) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (res.error) setError(res.error);
      else after?.(res);
    });

  return (
    <main id="main" className="mx-auto flex max-w-[1440px] flex-col gap-5 px-4 pt-6 pb-14 sm:px-7">
      <div className="flex flex-wrap items-end justify-between gap-4 px-1 pt-2 pb-1">
        <div className="min-w-0">
          <p className="m-0 font-mono text-xs text-brand">DRAFT{p.aiAssisted ? " · AI-ASSISTED" : ""}</p>
          <h1 className="mt-1.5 mb-0 text-[32px] font-normal leading-[1.1] tracking-[-1.4px] sm:text-[44px] sm:tracking-[-1.98px]">Your {p.employer} cover letter</h1>
          <p className="mt-2 mb-0 text-[15px] text-muted">
            Written from {p.cvFileName ?? "your CV"} and the {p.jobTitle} ad. Edit anything before you send it.
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <a href={`/api/letters/${id}?format=docx`} className="inline-flex min-h-11 items-center rounded-full border border-edge bg-white px-[18px] text-sm text-black no-underline hover:bg-paper hover:text-black">
            Download Word
          </a>
          <a href={`/api/letters/${id}?format=pdf`} className="inline-flex min-h-11 items-center rounded-full border border-edge bg-white px-[18px] text-sm text-black no-underline hover:bg-paper hover:text-black">
            Download PDF
          </a>
          <button type="button" disabled={pending || p.saved} onClick={() => run(() => saveLetter(id))} className="min-h-11 rounded-full border-0 bg-black px-[18px] text-sm font-medium text-white hover:bg-ink-2 disabled:opacity-60">
            {p.saved ? "Saved to reports" : "Save to reports"}
          </button>
        </div>
      </div>
      <FormError message={error} />

      <div className="flex flex-wrap items-start gap-5">
        <section aria-label="Draft letter" className="flex min-w-0 flex-[999_1_600px] flex-col gap-1.5 rounded-3xl bg-white px-6 py-9 sm:px-11">
          <p className="mt-0 mb-[18px] whitespace-pre-line text-[15px] leading-[1.7] text-muted">{header}</p>
          {p.paragraphs.map((para, i) => (
            <div key={i} className="relative -mx-3.5 rounded-[14px] border border-transparent px-3.5 py-3 hover:border-line">
              {editing === i ? (
                <div className="flex flex-col gap-2">
                  <label className="sr-only-abs" htmlFor={`para-${i}`}>
                    Paragraph {i + 1}
                  </label>
                  <textarea id={`para-${i}`} value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.max(3, Math.ceil(draft.length / 80))} className="w-full resize-y rounded-[14px] border border-edge p-3 text-base leading-[1.75]" autoFocus />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={pending} onClick={() => run(() => editParagraph(id, i, draft), () => setEditing(null))} className="min-h-9 rounded-full border-0 bg-black px-4 text-sm text-white disabled:opacity-60">
                      Save paragraph
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className="min-h-9 rounded-full border border-edge bg-white px-4 text-sm text-black">
                      Cancel
                    </button>
                    <button type="button" disabled={pending} onClick={() => run(() => deleteParagraph(id, i), () => setEditing(null))} className="min-h-9 rounded-full border-0 bg-transparent px-3 text-sm text-muted hover:text-black">
                      Delete paragraph
                    </button>
                  </div>
                </div>
              ) : (
                <p className="m-0 whitespace-pre-line text-base leading-[1.75]">{para.text}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {para.src.map((s) => (
                  <span key={s} className="rounded-full bg-canvas px-2 py-[3px] font-mono text-[11px] text-muted">
                    {s}
                  </span>
                ))}
                {editing !== i && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(i);
                      setDraft(para.text);
                    }}
                    className="min-h-[26px] rounded-full border-0 bg-transparent px-2.5 text-xs text-brand hover:underline"
                  >
                    Rewrite paragraph
                  </button>
                )}
              </div>
            </div>
          ))}
        </section>

        <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-4 lg:max-w-[400px]">
          <section aria-labelledby="q-h" className="flex flex-col gap-3 rounded-3xl bg-white px-6 py-[22px]">
            <h2 id="q-h" className="m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">
              QUICK CHECK
            </h2>
            {p.checks.map((c) => (
              <div key={c.t} className="flex items-start gap-2.5 text-sm">
                {c.ok ? <CheckDot /> : <AlertDot />}
                <span>
                  {c.t}
                  <span className="block text-[13px] text-muted">{c.d}</span>
                </span>
              </div>
            ))}
          </section>
          <section className="rounded-3xl bg-mist px-[22px] py-5">
            <p className="m-0 text-base font-medium">Every claim has a source</p>
            <p className="mt-1.5 mb-0 text-sm leading-[1.55] text-body">The tags under each paragraph show which CV line or part of the job ad it came from. If something isn&apos;t true, edit it or delete it.</p>
          </section>
          <button type="button" disabled={pending} onClick={() => run(() => reviewDraft(id), (r) => r.id && router.push(`/letters/${r.id}`))} className="inline-flex min-h-12 items-center justify-center rounded-full border border-edge bg-white text-sm text-black hover:bg-paper disabled:opacity-60">
            Run a full review on this draft
          </button>
        </aside>
      </div>
    </main>
  );
}
