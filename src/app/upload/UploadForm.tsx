"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { uploadCv, type ReadingSummary, type ReadOutcome, type SourceReview } from "@/app/actions/cv";
import { FormError } from "@/components/client";
import { cx } from "@/components/ui";
import { CorrectionPanel, PastePanel, useAttemptKey } from "./SourceEditor";

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

const primaryBtn = "min-h-[50px] rounded-full border-0 bg-black px-[26px] text-[15px] font-medium text-white hover:bg-ink-2";
const secondaryBtn = "min-h-[50px] rounded-full border border-edge bg-white px-[26px] text-[15px] text-black hover:bg-paper";

/** The file could not be read as text or is outside a limit. Nothing was scored, and the panel says so. */
function OutcomePanel({ outcome, onReset, onPaste }: { outcome: ReadOutcome; onReset: () => void; onPaste: () => void }) {
  const unsupported = outcome.kind === "unsupported";
  return (
    <section role="alert" aria-labelledby="oc-h" data-outcome={outcome.code} className="flex flex-col gap-3.5 rounded-[22px] border border-black bg-white px-5 py-5">
      <p className="m-0 font-mono text-xs tracking-[0.04em] text-subtle">{unsupported ? "NOT SCORED · WE CAN'T READ THIS FILE AS TEXT" : "NOT SCORED · OUTSIDE A PROCESSING LIMIT"}</p>
      <h2 id="oc-h" className="m-0 text-[22px] font-normal leading-[1.2] tracking-[-0.03em]">{outcome.message}</h2>
      <p className="m-0 text-sm leading-[1.55] text-body">{outcome.detail}</p>
      {outcome.alternatives.length > 0 && (
        <div>
          <p className="m-0 mb-1.5 text-sm font-medium">What you can do</p>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm leading-[1.5] text-body">
            {outcome.alternatives.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="m-0 text-[13px] leading-[1.5] text-subtle">This is about the file, not your CV: nothing was scored and nothing was saved.</p>
      <div className="flex flex-wrap gap-3">
        {unsupported && (
          <button type="button" onClick={onPaste} className={primaryBtn}>
            Type or paste my CV text instead
          </button>
        )}
        <button type="button" onClick={onReset} className={secondaryBtn}>
          Choose a different file
        </button>
      </div>
    </section>
  );
}

/** Before a score exists the note is about the text, not a score. */
const CONFIDENCE_NOTE_UNSCORED: Record<ReadingSummary["confidence"]["band"], string> = {
  high: "The text we read should match your CV closely.",
  medium: "Some of the text may differ from your CV. Check it below before it is scored.",
  low: "The text we read may be quite different from your CV. Check it below before it is scored.",
};

const CONFIDENCE_NOTE: Record<ReadingSummary["confidence"]["band"], string> = {
  high: "The text we read should match your CV closely.",
  medium: "Some of the text may differ from your CV, so read the warnings before you act on the score.",
  low: "The text we read may be quite different from your CV. Treat this score as provisional and check the warnings.",
};

/**
 * Shown when the reading was not straightforward: pages, confidence and what to check. `scored` is false when the
 * confidence was below high: the text has not been scored, and the student corrects or confirms it first.
 */
function ReadingReview({ fileName, reading, scored, children, onContinue, onReset }: { fileName: string; reading: ReadingSummary; scored: boolean; children?: ReactNode; onContinue?: () => void; onReset: () => void }) {
  const { pages, confidence } = reading;
  const pagesText = pages.measured !== null ? `${pages.measured} ${pages.measured === 1 ? "page" : "pages"}, counted in your PDF.` : `About ${pages.estimated} ${pages.estimated === 1 ? "page" : "pages"}, estimated from the word count. A Word file has no pages until it is opened, so we can't count them.`;
  return (
    <main id="main" data-reading={confidence.band} data-scored={scored ? "yes" : "no"} className="mx-auto flex max-w-[760px] flex-col gap-6 px-4 py-12 sm:px-7 sm:py-16">
      <p className="m-0 font-mono text-xs text-brand">
        CV READ · {confidence.band.toUpperCase()} CONFIDENCE{scored ? "" : " · NOT SCORED YET"}
      </p>
      <h1 className="m-0 text-[36px] font-normal leading-[1.1] tracking-[-1.6px] sm:text-[44px] sm:tracking-[-1.98px]">Check how we read your file</h1>
      <p className="m-0 text-base leading-[1.55] text-body">
        {scored ? (
          <>
            We scored the text we could read from <span className="font-medium text-black">{fileName}</span>. Before you look at the score, here is what we noticed.
          </>
        ) : (
          <>
            We haven&apos;t scored <span className="font-medium text-black">{fileName}</span> yet. We weren&apos;t confident we read it the way you see it, so check the text below first: correct anything that&apos;s wrong, or score it as it is.
          </>
        )}
      </p>
      <section aria-labelledby="rd-h" className="flex flex-col gap-3 rounded-3xl bg-white px-6 py-5">
        <h2 id="rd-h" className="m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">
          HOW THE FILE WAS READ
        </h2>
        <p className="m-0 text-sm leading-[1.55]">
          <span className="font-medium">Pages.</span> {pagesText}
        </p>
        <p className="m-0 text-sm leading-[1.55]">
          <span className="font-medium">Reading confidence {confidence.score.toFixed(2)}, {confidence.band}.</span> {(scored ? CONFIDENCE_NOTE : CONFIDENCE_NOTE_UNSCORED)[confidence.band]} It describes how well we read the file, not how good your CV is.
        </p>
      </section>
      {reading.warnings.length > 0 && (
        <section aria-labelledby="wn-h" className="rounded-3xl bg-white px-6 py-2">
          <h2 id="wn-h" className="sr-only-abs">
            What we noticed
          </h2>
          <ul className="m-0 list-none p-0">
            {reading.warnings.map((w, i) => (
              <li key={w.code} className={cx("flex flex-col gap-1 py-4", i < reading.warnings.length - 1 && "border-b border-line")}>
                <p className="m-0 flex flex-wrap items-center gap-2 text-[15px] font-medium">
                  <span className={cx("rounded-full px-[9px] py-1 font-mono text-[11px] font-normal", w.severity === "caution" ? "bg-black text-white" : "bg-canvas text-muted")}>{w.severity === "caution" ? "CHECK" : "NOTE"}</span>
                  {w.message}
                </p>
                <p className="m-0 text-sm leading-[1.5] text-body">{w.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="m-0 rounded-[18px] bg-mist px-[18px] py-4 text-sm leading-[1.55] text-body">
        {scored ? "Your score covers only the text we read. If this doesn't match your CV, correct the text below and we'll score the corrected version, or export it again as a PDF with selectable text." : "A score covers only the text that was read. Correcting it here means the score is of your CV, not of how the file came out."}
      </p>
      {children}
      <div className="flex flex-wrap gap-3">
        {onContinue && (
          <button type="button" onClick={onContinue} className={primaryBtn}>
            See my results
          </button>
        )}
        <button type="button" onClick={onReset} className={secondaryBtn}>
          Upload a different file
        </button>
      </div>
    </main>
  );
}

/** The address of an unscored version's review, with the sector and stage it will be scored for. */
const reviewHref = (sourceId: string, sector: string, stage: string) => `/upload?${new URLSearchParams({ source: sourceId, sector, stage })}`;

export function UploadForm({
  sectors,
  stages,
  defaultSector,
  defaultStage,
  aside,
  initialReview = null,
  notice = null,
}: {
  sectors: string[];
  stages: string[];
  defaultSector: string;
  defaultStage: string;
  aside: ReactNode;
  /** A version read earlier and not yet scored, reopened from its address (after a refresh, or from the list of versions waiting). */
  initialReview?: SourceReview | null;
  notice?: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sector, setSector] = useState(defaultSector);
  const [stage, setStage] = useState(defaultStage);
  const [error, setError] = useState<string | null>(notice);
  const [outcome, setOutcome] = useState<ReadOutcome | null>(null);
  const [paste, setPaste] = useState(false);
  const [done, setDone] = useState<{ id: string; fileName: string; reading: ReadingSummary; leave: () => void } | null>(null);
  const [review, setReview] = useState<SourceReview | null>(initialReview);
  // Opening another waiting version (or a bad address) on this same page swaps it in without a remount, so an
  // address change that only restates the version on screen never discards what the student has typed.
  useEffect(() => {
    if (initialReview) setReview((r) => (r?.sourceId === initialReview.sourceId ? r : initialReview));
  }, [initialReview]);
  useEffect(() => {
    if (notice) setError(notice);
  }, [notice]);
  const attempt = useAttemptKey();
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
    setOutcome(null);
    setPaste(false);
    if (!f) return;
    if (!/\.(pdf|docx)$/i.test(f.name)) return setError("Upload a PDF or Word (.docx) file.");
    if (f.size > MAX) return setError("That file is over 2 MB. Try saving a smaller PDF.");
    setFile(f);
  };

  const reset = () => {
    setFile(null);
    setOutcome(null);
    setPaste(false);
    setDone(null);
    setReview(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
    // Leave the review address, so a refresh shows the upload form rather than the version just left.
    if (window.location.search) router.replace("/upload");
  };

  const submit = async () => {
    if (!file) return setError("Choose your CV first.");
    setBusy(true);
    setStep(0);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("sector", sector);
    fd.set("stage", stage);
    // The same file, sector and stage send the same key until the attempt lands, so a retry, a double click or a
    // refresh in the middle of submitting returns the version already saved instead of making a second one.
    const what = `upload|${sector}|${stage}|${file.name}|${file.size}|${file.lastModified}`;
    fd.set("key", attempt.key(what));
    const started = Date.now();
    try {
      const res = await uploadCv(fd);
      if (res.outcome) {
        setBusy(false);
        setOutcome(res.outcome);
        return;
      }
      // Read, but not scored: the confidence was below high, so the text is shown for review and correction first.
      if (res.review) {
        setBusy(false);
        setReview(res.review);
        // Give the review an address, so a refresh comes back to the same unscored version instead of losing it.
        // A router navigation (not a bare history change) keeps the page the server renders in step with the address.
        router.replace(reviewHref(res.review.sourceId, sector, stage));
        return;
      }
      if (res.error || !res.id) {
        setBusy(false);
        setError(res.error ?? "Something went wrong. Try again.");
        return;
      }
      const id = res.id;
      // The key is forgotten only as the student leaves for the report: a refresh before then (on the reading
      // screen, or during the pause below) and the same file sent again returns this report, not a second one.
      const leave = () => {
        attempt.done(what);
        router.push(`/reviews/${id}`);
      };
      // A clean reading goes straight to the score; a caution is shown first, with the same correction path.
      if (res.reading && res.showReading) {
        setBusy(false);
        setDone({ id, fileName: file.name, reading: res.reading, leave });
        return;
      }
      // Keep the progress screen up long enough to read.
      const wait = Math.max(0, 2600 - (Date.now() - started));
      setTimeout(leave, wait);
    } catch {
      setBusy(false);
      setError("Scoring didn't finish. Nothing was saved. Check your connection and try again.");
    }
  };

  if (review) {
    return (
      <ReadingReview fileName={review.fileName} reading={review.reading} scored={false} onReset={reset}>
        <CorrectionPanel key={review.sourceId} sourceId={review.sourceId} blocks={review.blocks} sector={sector} stage={stage} scoreAsIs intro={<h2 className="m-0 text-[22px] font-normal tracking-[-0.03em]">The text we read</h2>} />
      </ReadingReview>
    );
  }

  if (done) {
    return (
      <ReadingReview fileName={done.fileName} reading={done.reading} scored onContinue={done.leave} onReset={reset}>
        <div>
          <Link href={`/reviews/${done.id}/source?correct=1`} className={cx(secondaryBtn, "inline-flex items-center no-underline")}>
            Check and correct the text
          </Link>
        </div>
      </ReadingReview>
    );
  }

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
        {outcome && paste ? (
          <PastePanel file={file} sector={sector} stage={stage} onCancel={() => setPaste(false)} />
        ) : outcome ? (
          <OutcomePanel outcome={outcome} onReset={reset} onPaste={() => setPaste(true)} />
        ) : (
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
            <button type="button" onClick={() => inputRef.current?.click()} className={cx(primaryBtn, "mt-1.5")}>
              {file ? "Choose a different file" : "Choose a file"}
            </button>
          </div>
        )}
        <input ref={inputRef} id="cv-file" type="file" aria-label="CV file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only-abs" onChange={(e) => pick(e.target.files?.[0])} />
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
            Need a starting point? <Link href="/templates">Use a one-column template</Link>
          </p>
          <button type="button" onClick={submit} disabled={!file || !!outcome} className={cx(primaryBtn, "disabled:opacity-40")}>
            Score my CV
          </button>
        </div>
      </section>
      {aside}
    </main>
  );
}
