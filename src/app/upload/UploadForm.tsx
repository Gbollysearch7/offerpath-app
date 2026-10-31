"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { uploadCv } from "@/app/actions/cv";
import { FormError } from "@/components/client";
import { cx } from "@/components/ui";

const MAX = 2 * 1024 * 1024;
const STEPS = [
  ["Reading your file", "Checking the text is readable"],
  ["Finding your sections", "Education, experience, skills, contact"],
  ["Scoring your bullet points", "Impact, clarity and length"],
  ["Checking sector keywords", "Sector fit"],
  ["Ranking your fixes", "Biggest gains first"],
] as const;
const TIPS = [
  "While you wait: a recruiter's first read is quick, so clear results beat long descriptions.",
  "Numbers stick: \"12 events for 400 students\" beats \"organised events\".",
  "UK employers don't need a photo, date of birth or full address on your CV.",
];

export function UploadForm({ sectors, stages, defaultSector, defaultStage, aside }: { sectors: string[]; stages: string[]; defaultSector: string; defaultStage: string; aside: ReactNode }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sector, setSector] = useState(defaultSector);
  const [stage, setStage] = useState(defaultStage);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!busy) return;
    setSlow(false);
    const t = setInterval(() => setStep((s) => Math.min(STEPS.length - 1, s + 1)), 1800);
    const s = setTimeout(() => setSlow(true), 20_000);
    return () => {
      clearInterval(t);
      clearTimeout(s);
    };
  }, [busy]);

  const pick = (f: File | undefined | null) => {
    setError(null);
    if (!f) return;
    if (!/\.(pdf|docx)$/i.test(f.name)) return setError("Upload a PDF or Word (.docx) file.");
    if (f.size > MAX) return setError("That file is over 2 MB. Try saving a smaller PDF.");
    setFile(f);
  };

  const submit = async () => {
    if (!file) return setError("Choose your CV first.");
    setBusy(true);
    setStep(0);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("sector", sector);
    fd.set("stage", stage);
    const started = Date.now();
    try {
      const res = await uploadCv(fd);
      if (res.error || !res.id) {
        setBusy(false);
        setError(res.error ?? "Something went wrong. Try again.");
        return;
      }
      // Keep the progress screen up long enough to read.
      const wait = Math.max(0, 2600 - (Date.now() - started));
      setTimeout(() => router.push(`/reviews/${res.id}`), wait);
    } catch {
      setBusy(false);
      setError("Scoring didn't finish. Nothing was saved. Check your connection and try again.");
    }
  };

  if (busy) {
    const pct = Math.round(((step + 0.6) / STEPS.length) * 100);
    return (
      <main id="main" aria-live="polite" className="mx-auto flex max-w-[640px] flex-col gap-6 px-7 py-20">
        <p className="m-0 font-mono text-xs text-brand">{slow ? "TAKING LONGER THAN USUAL" : `ABOUT ${Math.max(2, (STEPS.length - step) * 3)} SECONDS LEFT`}</p>
        <h1 className="m-0 text-[44px] font-normal leading-[1.1] tracking-[-1.98px]">Reading your CV</h1>
        <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress" className="h-1 rounded-full bg-edge">
          <div className="h-1 rounded-full bg-black transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
        <ol className="mt-2 mb-0 list-none rounded-3xl bg-white px-6 py-2">
          {STEPS.map(([t, d], i) => {
            const k = i < step ? "done" : i === step ? "active" : "todo";
            return (
              <li key={t} className={cx("flex items-center gap-4 py-4", i < STEPS.length - 1 && "border-b border-line")}>
                {k === "done" && (
                  <svg width="24" height="24" viewBox="0 0 22 22" role="img" aria-label="Done" className="shrink-0">
                    <circle cx="11" cy="11" r="10" fill="#DCE6DF" />
                    <path d="M6.8 11.3l2.8 2.8 5.6-5.8" fill="none" stroke="#36604E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {k === "active" && (
                  <svg className="op-spin shrink-0" width="24" height="24" viewBox="0 0 24 24" role="img" aria-label="In progress">
                    <circle cx="12" cy="12" r="9.5" fill="none" stroke="#EEF2EF" strokeWidth="2.5" />
                    <path d="M12 2.5a9.5 9.5 0 0 1 9.5 9.5" fill="none" stroke="#000000" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
                {k === "todo" && (
                  <svg width="24" height="24" viewBox="0 0 24 24" role="img" aria-label="Waiting" className="shrink-0">
                    <circle cx="12" cy="12" r="9.5" fill="none" stroke="#DCE3DE" strokeWidth="2" />
                  </svg>
                )}
                <div>
                  <p className={cx("m-0 text-base", k === "todo" ? "text-subtle" : "text-black")}>{t}</p>
                  <p className="mt-[3px] mb-0 text-[13px] text-subtle">{d}</p>
                </div>
              </li>
            );
          })}
        </ol>
        <p className="m-0 rounded-[18px] bg-mist px-[18px] py-4 text-sm leading-[1.55] text-body">{slow ? "Still working. A new CV is read carefully the first time; uploading the same CV again is instant." : TIPS[step % TIPS.length]}</p>
      </main>
    );
  }

  return (
    <main id="main" className="mx-auto flex max-w-[1120px] flex-wrap items-start gap-6 px-4 pt-12 pb-16 sm:px-7">
      <div className="flex-[1_1_100%]">
        <h1 className="m-0 text-[34px] font-normal leading-[1.1] tracking-[-1.5px] sm:text-[44px] sm:tracking-[-1.98px]">Upload your CV</h1>
        <p className="mt-2.5 mb-0 text-base text-muted">You&apos;ll get a Readiness Score out of 100 and line-by-line feedback in about 20 seconds.</p>
      </div>

      <section aria-labelledby="up-h" className="flex min-w-0 flex-[999_1_560px] flex-col gap-[22px] rounded-[28px] bg-white p-5 sm:p-7">
        <h2 id="up-h" className="m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">
          YOUR CV
        </h2>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            pick(e.dataTransfer.files?.[0]);
          }}
          className={cx("flex flex-col items-center gap-3.5 rounded-[22px] border-[1.5px] border-dashed px-6 py-12 text-center", drag ? "border-brand bg-okbg" : "border-sage bg-paper")}
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-mint">
            <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 16V5M7 10l5-5 5 5M5 19h14" fill="none" stroke="#36604E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          {file ? (
            <>
              <p className="m-0 text-[22px] tracking-[-0.03em]">{file.name}</p>
              <p className="m-0 text-sm text-subtle">{(file.size / 1024).toFixed(0)} KB · ready to score</p>
            </>
          ) : (
            <>
              <p className="m-0 text-[22px] tracking-[-0.03em]">Drop your CV here</p>
              <p className="m-0 text-sm text-subtle">PDF or Word, up to 2 MB, in English</p>
            </>
          )}
          <input ref={inputRef} id="cv-file" type="file" aria-label="CV file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only-abs" onChange={(e) => pick(e.target.files?.[0])} />
          <button type="button" onClick={() => inputRef.current?.click()} className="mt-1.5 min-h-[50px] rounded-full border-0 bg-black px-[26px] text-[15px] font-medium text-white hover:bg-ink-2">
            {file ? "Choose a different file" : "Choose a file"}
          </button>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-[1_1_240px] flex-col gap-1.5 text-sm font-medium">
            Target sector
            <select value={sector} onChange={(e) => setSector(e.target.value)} className="min-h-12 rounded-[14px] border border-edge bg-white px-3.5 text-[15px] font-normal text-black">
              {sectors.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-[1_1_240px] flex-col gap-1.5 text-sm font-medium">
            Stage
            <select value={stage} onChange={(e) => setStage(e.target.value)} className="min-h-12 rounded-[14px] border border-edge bg-white px-3.5 text-[15px] font-normal text-black">
              {stages.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        <FormError message={error} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-sm text-muted">
            Need a starting point? <Link href="/templates">Use an ATS-friendly template</Link>
          </p>
          <button type="button" onClick={submit} disabled={!file} className="min-h-[50px] rounded-full border-0 bg-black px-[26px] text-[15px] font-medium text-white hover:bg-ink-2 disabled:opacity-40">
            Score my CV
          </button>
        </div>
      </section>
      {aside}
    </main>
  );
}
