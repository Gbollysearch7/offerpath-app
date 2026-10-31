"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { createLetterDraft, createLetterReview } from "@/app/actions/letters";
import { FormError } from "@/components/client";
import { cx } from "@/components/ui";

const field = "min-h-[50px] rounded-[14px] border border-edge bg-white px-3.5 text-[15px] font-normal text-black";
const MODES = [
  ["Write one for me", "We draft a letter from your CV and the job ad. You edit and approve it."],
  ["Review my letter", "Upload a letter you’ve written and get checks and suggestions."],
] as const;

export function LetterStart({ initialMode, jobs, cvs }: { initialMode: number; jobs: { id: string; label: string }[]; cvs: { id: string; label: string }[] }) {
  const router = useRouter();
  const [mode, setMode] = useState(initialMode);
  const [job, setJob] = useState(jobs[0]?.id ?? "new");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = (fd: FormData) =>
    start(async () => {
      setError(null);
      const res = mode === 0 ? await createLetterDraft(fd) : await createLetterReview(fd);
      if (res.error || !res.id) setError(res.error ?? "Something went wrong.");
      else router.push(`/letters/${res.id}`);
    });

  return (
    <main id="main" className="mx-auto flex max-w-[960px] flex-col gap-6 px-4 pt-12 pb-16 sm:px-7">
      <div>
        <h1 className="m-0 text-[34px] font-normal leading-[1.1] tracking-[-1.5px] sm:text-[44px] sm:tracking-[-1.98px]">Cover letters</h1>
        <p className="mt-2.5 mb-0 text-base text-muted">Built from your CV and the job ad, following UK conventions. We never add facts you didn&apos;t give us.</p>
      </div>
      <div role="radiogroup" aria-label="What do you want to do?" className="flex flex-wrap gap-4">
        {MODES.map(([t, d], i) => (
          <button key={t} type="button" role="radio" aria-checked={mode === i} onClick={() => setMode(i)} className={cx("flex-[1_1_300px] rounded-3xl border-2 bg-white px-[26px] py-6 text-left text-black", mode === i ? "border-black" : "border-transparent hover:border-edge")}>
            <span className="block text-2xl tracking-[-0.04em]">{t}</span>
            <span className="mt-1.5 block text-[15px] leading-normal text-muted">{d}</span>
          </button>
        ))}
      </div>

      {cvs.length === 0 && mode === 0 ? (
        <section className="flex flex-col items-start gap-3 rounded-[28px] bg-white p-7">
          <p className="m-0 text-lg">Upload a CV first</p>
          <p className="m-0 text-sm text-muted">We write your letter only from facts in your CV.</p>
          <Link href="/upload" className="inline-flex min-h-11 items-center rounded-full bg-black px-[18px] text-sm font-medium text-white no-underline hover:text-white">
            Upload my CV
          </Link>
        </section>
      ) : (
        <form action={submit} className="flex flex-col gap-[18px] rounded-[28px] bg-white p-5 sm:p-7">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Job
            <select name="tailorReportId" value={job} onChange={(e) => setJob(e.target.value)} className={field}>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.label}
                </option>
              ))}
              <option value="new">Paste a new job ad</option>
            </select>
          </label>
          {job === "new" && (
            <>
              <div className="flex flex-wrap gap-4">
                <label className="flex flex-[1_1_220px] flex-col gap-1.5 text-sm font-medium">
                  Job title
                  <input name="jobTitle" required placeholder="Analyst Graduate Scheme" className={field} />
                </label>
                <label className="flex flex-[1_1_220px] flex-col gap-1.5 text-sm font-medium">
                  Employer
                  <input name="employer" required placeholder="Northbank" className={field} />
                </label>
              </div>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Job ad text <span className="font-normal text-subtle">So we can check keywords</span>
                <textarea name="jobText" rows={5} placeholder="Paste the role description and requirements." className="resize-y rounded-[14px] border border-edge p-3.5 text-[15px] font-normal leading-[1.55]" />
              </label>
            </>
          )}

          {mode === 0 ? (
            <>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                CV to draw from
                <select name="cvReportId" className={field}>
                  {cvs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                <span>
                  Who is it addressed to? <span className="font-normal text-subtle">Optional, a name lets us use &quot;Yours sincerely&quot;</span>
                </span>
                <input type="text" name="addressee" placeholder="For example, Ms Taylor, Graduate Recruitment" className={field} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Anything you want us to mention?
                <textarea name="notes" rows={3} placeholder="For example, why this firm, a conversation at a careers fair" className="resize-y rounded-[14px] border border-edge p-3.5 text-[15px] font-normal" />
              </label>
            </>
          ) : (
            <>
              <div className="flex flex-col items-center gap-3 rounded-[20px] border-[1.5px] border-dashed border-sage bg-paper px-6 py-9 text-center">
                <p className="m-0 text-xl tracking-[-0.03em]">{fileName ?? "Drop your cover letter here"}</p>
                <p className="m-0 text-sm text-subtle">PDF or Word, up to 2 MB, or paste the text below</p>
                <input ref={fileRef} type="file" name="file" aria-label="Cover letter file" accept=".pdf,.docx" className="sr-only-abs" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)} />
                <button type="button" onClick={() => fileRef.current?.click()} className="min-h-[46px] rounded-full border-0 bg-black px-[22px] text-[15px] text-white hover:bg-ink-2">
                  Choose a file
                </button>
              </div>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Or paste your letter
                <textarea name="letterText" rows={8} className="resize-y rounded-[14px] border border-edge p-3.5 text-[15px] font-normal leading-[1.55]" />
              </label>
            </>
          )}
          <FormError message={error} />
          <button type="submit" disabled={pending} className="inline-flex min-h-[52px] items-center self-start rounded-full border-0 bg-black px-[26px] text-[15px] font-medium text-white hover:bg-ink-2 disabled:opacity-60">
            {pending ? (mode === 0 ? "Writing your draft…" : "Checking…") : mode === 0 ? "Write my draft" : "Review my letter"}
          </button>
        </form>
      )}
    </main>
  );
}
