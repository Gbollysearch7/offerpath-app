"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createTailoredVersion, toggleKeyword } from "@/app/actions/tailor";
import { FormError } from "@/components/client";
import { cx, ScoreRing } from "@/components/ui";
import { CV_THEMES } from "@/lib/cv-themes";
import type { TailorPayload } from "@/lib/types";

type Tab = "missing" | "found" | "soft";

export function TailorView({ id, p, subtitle, auto }: { id: string; p: TailorPayload; subtitle: string; auto?: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("missing");
  const [view, setView] = useState<"ad" | "tailored">(p.tailored || auto ? "tailored" : "ad");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [template, setTemplate] = useState(CV_THEMES[1].slug);
  const [pending, start] = useTransition();
  const started = useRef(false);

  const missing = p.keywords.filter((k) => !k.inCv && !k.soft);
  const found = p.keywords.filter((k) => k.inCv);
  const soft = p.keywords.filter((k) => k.soft);
  const rows = tab === "missing" ? missing : tab === "found" ? found : soft;
  const mustMissing = missing.filter((k) => k.must).length;

  const run = (fn: () => Promise<{ error?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (res.error) setError(res.error);
      else after?.();
    });

  const tailor = () =>
    run(
      () => createTailoredVersion(id),
      () => {
        setView("tailored");
        router.refresh();
      },
    );

  // Arriving from "Tailor my CV": make the tailored version straight away, once.
  useEffect(() => {
    if (!auto || started.current) return;
    started.current = true;
    // Drop ?auto=1 without a navigation, which would cancel the refresh the action triggers.
    window.history.replaceState(null, "", `/tailor/${id}`);
    tailor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  const copyCv = async () => {
    if (!p.tailoredCv) return;
    try {
      await navigator.clipboard.writeText(p.tailoredCv);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Your browser blocked copying. Use Download instead.");
    }
  };

  const tabBtn = (t: Tab, label: string, n: number) => (
    <button key={t} role="tab" aria-selected={tab === t} aria-controls="kw-panel" onClick={() => setTab(t)} className={cx("min-h-10 rounded-full px-4 text-sm", tab === t ? "border-0 bg-black text-white" : "border border-edge bg-white text-black hover:bg-paper")}>
      {label} <span className={cx("font-mono text-xs", tab === t ? "opacity-80" : "text-subtle")}>{n}</span>
    </button>
  );

  return (
    <main id="main" className="mx-auto flex max-w-[1440px] flex-col gap-5 px-4 pt-6 pb-14 sm:px-7">
      <div className="flex flex-wrap items-end justify-between gap-4 px-1 pt-2 pb-1">
        <div className="min-w-0">
          <p className="m-0 font-mono text-xs text-brand">TAILOR TO A JOB</p>
          <h1 className="mt-1.5 mb-0 text-[32px] font-normal leading-[1.1] tracking-[-1.4px] sm:text-[44px] sm:tracking-[-1.98px]">
            {p.jobTitle}, {p.employer}
          </h1>
          <p className="mt-2 mb-0 text-[15px] text-muted">{subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Link href="/tailor" className="inline-flex min-h-11 items-center rounded-full border border-edge bg-white px-[18px] text-sm text-black no-underline hover:bg-paper hover:text-black">
            Change job ad
          </Link>
          <button type="button" disabled={pending} onClick={tailor} className="min-h-11 rounded-full border-0 bg-black px-[18px] text-sm font-medium text-white hover:bg-ink-2 disabled:opacity-60">
            {pending ? "Tailoring…" : p.tailored ? "Tailor again" : "Tailor my CV"}
          </button>
        </div>
      </div>
      <FormError message={error} />

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[1_1_480px] flex-col gap-5">
          <section aria-labelledby="m-h" className="flex flex-wrap items-center gap-6 rounded-3xl bg-white px-[26px] py-6">
            <div className="flex items-center gap-[18px]">
              <ScoreRing value={p.matchNow} size={104} stroke={8} color="#8FB3A1" label={`Match now ${p.matchNow}`}>
                <span className="text-[32px] leading-none tracking-[-0.04em]">{p.matchNow}</span>
                <span className="mt-[3px] font-mono text-[10px] text-subtle">NOW</span>
              </ScoreRing>
              <svg width="28" height="16" viewBox="0 0 28 16" aria-hidden="true">
                <path d="M2 8h22M18 3l5 5-5 5" fill="none" stroke="#5C6B66" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <ScoreRing value={p.matchTailored} size={104} stroke={8} color="#36604E" label={`Estimated match after tailoring ${p.matchTailored}`}>
                <span className="text-[32px] leading-none tracking-[-0.04em]">{p.matchTailored}</span>
                <span className="mt-[3px] font-mono text-[10px] text-subtle">TAILORED</span>
              </ScoreRing>
            </div>
            <div className="min-w-0 flex-[1_1_220px]">
              <h2 id="m-h" className="m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">
                JOB MATCH
              </h2>
              <p className="mt-2.5 mb-0 text-base leading-[1.55]">
                {p.aiTailored
                  ? p.matchTailored > p.matchNow
                    ? `The tailored version matches ${p.matchTailored}, up from ${p.matchNow}, using only what your CV already shows.`
                    : `The tailored version speaks the employer's language without claiming keywords your CV can't back up.${p.notEvidenced?.length ? " To raise your match, add real examples of what's listed under “Left out”." : ""}`
                  : missing.length === 0
                  ? "Your CV already covers the keywords this employer screens for."
                  : `Your CV is missing ${missing.length} keyword${missing.length === 1 ? "" : "s"} this employer screens for.${mustMissing ? ` Adding the ${mustMissing} must-have${mustMissing === 1 ? "" : "s"} should lift you towards ${p.matchTailored}.` : ""}`}
              </p>
            </div>
          </section>

          <section aria-labelledby="k-h" className="flex flex-col gap-4 rounded-3xl bg-white px-6 py-[22px]">
            <h2 id="k-h" className="sr-only-abs">
              Keywords
            </h2>
            <div role="tablist" aria-label="Keyword groups" className="flex flex-wrap gap-1.5">
              {tabBtn("missing", "Missing", missing.length)}
              {tabBtn("found", "Found", found.length)}
              {tabBtn("soft", "Soft skills", soft.length)}
            </div>
            <p className="m-0 text-sm leading-[1.55] text-muted">
              {tab === "missing" ? "These are in the job ad but not in your CV. Only add the ones that are true for you." : tab === "found" ? "These are in the job ad and already in your CV." : "Soft skills the ad mentions. Show them with an example rather than listing them."}
            </p>
            <div id="kw-panel" role="tabpanel" className="overflow-x-auto">
              {rows.length === 0 ? (
                <p className="m-0 py-3 text-sm text-muted">Nothing here.</p>
              ) : (
                <table className="w-full min-w-[460px] border-collapse text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="border-b border-line px-1.5 py-2 font-mono text-[11px] font-normal text-subtle">KEYWORD</th>
                      <th className="border-b border-line px-1.5 py-2 text-right font-mono text-[11px] font-normal text-subtle">IN AD</th>
                      <th className="border-b border-line px-1.5 py-2 font-mono text-[11px] font-normal text-subtle">{tab === "found" ? "STATUS" : "BEST PLACE"}</th>
                      <th className="border-b border-line px-1.5 py-2">
                        <span className="sr-only-abs">Action</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((k) => {
                      const added = p.added.includes(k.w);
                      return (
                        <tr key={k.w}>
                          <td className="border-b border-line px-1.5 py-3">
                            {k.w}
                            {k.must && !k.inCv && <span className="ml-1.5 rounded-full bg-black px-[7px] py-[3px] font-mono text-[10px] text-white">MUST</span>}
                          </td>
                          <td className="border-b border-line px-1.5 py-3 text-right font-mono">{k.n}×</td>
                          <td className="border-b border-line px-1.5 py-3 text-muted">{k.where}</td>
                          <td className="border-b border-line px-1.5 py-3 text-right">
                            {!k.inCv && (
                              <button type="button" disabled={pending} aria-pressed={added} onClick={() => run(() => toggleKeyword(id, k.w))} className={cx("min-h-[34px] rounded-full px-3 text-[13px]", added ? "border border-brand bg-okbg text-brand" : "border border-edge bg-white text-black hover:bg-paper")}>
                                {added ? "Added" : "Add"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>

        <section aria-labelledby="jd-h" className="flex min-w-0 flex-[1_1_480px] flex-col gap-3.5 rounded-3xl bg-white px-[26px] py-[22px]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="View" className="flex gap-1 rounded-full bg-canvas p-1">
              <button role="tab" aria-selected={view === "ad"} onClick={() => setView("ad")} className={cx("min-h-9 rounded-full border-0 px-4 text-sm", view === "ad" ? "bg-white text-black" : "bg-transparent text-muted")}>
                Job ad
              </button>
              <button role="tab" aria-selected={view === "tailored"} onClick={() => setView("tailored")} className={cx("min-h-9 rounded-full border-0 px-4 text-sm", view === "tailored" ? "bg-white text-black" : "bg-transparent text-muted")}>
                Tailored CV, side by side
              </button>
            </div>
            {view === "ad" && (
              <ul aria-label="Legend" className="m-0 flex list-none gap-3.5 p-0 text-[13px] text-muted">
                <li className="flex items-center gap-1.5">
                  <span className="h-3.5 w-3.5 rounded bg-mint" />
                  In your CV
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="h-0.5 w-3.5 bg-black" />
                  Missing
                </li>
              </ul>
            )}
          </div>
          <h2 id="jd-h" className="mt-1.5 mb-0 text-2xl font-normal tracking-[-0.04em]">
            {view === "ad" ? p.jobTitle : "Suggested changes"}
          </h2>
          {view === "ad" ? (
            <div className="text-[15px] leading-[1.8] text-ink-2">
              {p.jd.map((b, i) =>
                b.isH ? (
                  <p key={i} className="mt-3.5 mb-0.5 font-mono text-xs text-subtle">
                    {b.text}
                  </p>
                ) : (
                  <p key={i} className="mt-0 mb-1.5">
                    {b.segs!.map((s, j) =>
                      s.kind === "plain" ? (
                        <span key={j}>{s.t}</span>
                      ) : s.kind === "found" ? (
                        <mark key={j} className="rounded bg-mint px-[3px] py-px text-inherit">
                          {s.t}
                        </mark>
                      ) : (
                        <span key={j} className="border-b-2 border-black font-medium">
                          {s.t}
                          <span className="sr-only-abs"> (missing from your CV)</span>
                        </span>
                      ),
                    )}
                  </p>
                ),
              )}
            </div>
          ) : pending && !p.tailored ? (
            <div role="status" className="flex flex-col items-start gap-2 rounded-2xl bg-canvas p-5">
              <p className="m-0 text-[15px]">Tailoring your CV to {p.jobTitle}…</p>
              <p className="m-0 text-sm text-muted">This takes up to half a minute. We only use what&apos;s already in your CV.</p>
            </div>
          ) : !p.tailored ? (
            <div className="flex flex-col items-start gap-3 rounded-2xl bg-canvas p-5">
              <p className="m-0 text-[15px]">Press “Tailor my CV” and we&apos;ll rewrite your profile and most relevant bullets for this role, using only what&apos;s in your CV.</p>
              <p className="m-0 text-sm text-muted">Want particular keywords in? Pick them with “Add” first.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {p.tailoredCv && (
                <div className="flex flex-wrap items-center gap-2.5">
                  <button type="button" onClick={copyCv} className="min-h-10 rounded-full border-0 bg-black px-4 text-sm font-medium text-white hover:bg-ink-2">
                    {copied ? "Copied" : "Copy tailored CV"}
                  </button>
                  <label className="flex items-center gap-2 text-sm text-muted">
                    Template
                    <select value={template} onChange={(e) => setTemplate(e.target.value)} className="min-h-10 rounded-full border border-edge bg-white px-3 text-sm text-black">
                      {CV_THEMES.map((t) => (
                        <option key={t.slug} value={t.slug}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <a href={`/api/tailor/${id}?format=docx&template=${template}`} className="inline-flex min-h-10 items-center rounded-full border border-edge bg-white px-4 text-sm text-black no-underline hover:bg-paper hover:text-black">
                    Download Word
                  </a>
                  <a href={`/api/tailor/${id}?format=pdf&template=${template}`} className="inline-flex min-h-10 items-center rounded-full border border-edge bg-white px-4 text-sm text-black no-underline hover:bg-paper hover:text-black">
                    Download PDF
                  </a>
                  <span aria-live="polite" className="sr-only-abs">
                    {copied ? "Tailored CV copied" : ""}
                  </span>
                </div>
              )}
              {p.summary && (
                <div className="flex flex-col gap-1.5">
                  <p className="m-0 font-mono text-[11px] text-subtle">PROFILE · NEW, FOR THE TOP OF YOUR CV</p>
                  <p className="m-0 rounded-2xl border border-mint bg-okbg px-4 py-3.5 text-[15px] leading-normal">{p.summary}</p>
                </div>
              )}
              <div className="hidden grid-cols-2 gap-3 font-mono text-[13px] text-subtle sm:grid">
                <span>YOUR CV</span>
                <span>TAILORED</span>
              </div>
              {p.tailored.map((t, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  <p className="m-0 font-mono text-[11px] text-subtle">{t.where}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <p className="m-0 rounded-2xl bg-canvas px-4 py-3.5 text-[15px] leading-normal text-muted">
                      <span className="sr-only-abs">Your CV: </span>
                      {t.before}
                    </p>
                    <p className="m-0 rounded-2xl border border-mint bg-okbg px-4 py-3.5 text-[15px] leading-normal">
                      <span className="sr-only-abs">Tailored: </span>
                      {t.after}
                    </p>
                  </div>
                  {!!t.keywords?.length && (
                    <ul aria-label="What this line now matches in the ad" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                      {t.keywords.map((k) => (
                        <li key={k} className="rounded-full bg-mint px-2.5 py-1 text-xs">
                          {k}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              {!!p.skillsToAdd?.length && (
                <div className="flex flex-col gap-1.5">
                  <p className="m-0 font-mono text-[11px] text-subtle">SKILLS · YOUR CV SHOWS THESE BUT DOESN&apos;T NAME THEM</p>
                  <p className="m-0 rounded-2xl border border-mint bg-okbg px-4 py-3.5 text-[15px] leading-normal">{p.skillsToAdd.join(", ")}</p>
                </div>
              )}
              {!!p.notEvidenced?.length && (
                <div className="flex flex-col gap-1.5 rounded-2xl bg-canvas px-4 py-3.5">
                  <p className="m-0 text-sm font-medium">Left out: your CV doesn&apos;t show these yet</p>
                  <p className="m-0 text-sm text-muted">{p.notEvidenced.join(", ")}. If you have done them, add an example to your CV and tailor again.</p>
                </div>
              )}
              <p className="m-0 text-sm text-muted">
                {p.aiTailored ? "Fill in anything in [brackets] with your real numbers, or delete it. " : ""}Only keep a change if it&apos;s true. Edit the wording so it sounds like you, then re-score your CV.
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
