"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createTailor } from "@/app/actions/tailor";
import { FormError } from "@/components/client";
import { cx } from "@/components/ui";

const field = "min-h-[50px] rounded-[14px] border border-edge bg-white px-3.5 text-[15px] font-normal text-black";

export function TailorStartForm({ cvs }: { cvs: { id: string; label: string }[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (fd: FormData) =>
    start(async () => {
      setError(null);
      const res = await createTailor(fd);
      if (res.error || !res.id) setError(res.error ?? "Something went wrong.");
      else router.push(`/tailor/${res.id}?auto=1`);
    });

  return (
    <form action={submit} aria-labelledby="f-h" className="flex min-w-0 flex-[999_1_560px] flex-col gap-[18px] rounded-[28px] bg-white p-5 sm:p-7">
      <h2 id="f-h" className="m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">
        1 · CHOOSE A CV
      </h2>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        <span className="sr-only-abs">CV</span>
        <select name="cvReportId" className={field}>
          {cvs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <h2 className="mt-2.5 mb-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">2 · ADD THE JOB AD</h2>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Link to the job ad
        <input type="url" name="url" placeholder="https://careers.example.co.uk/graduate-analyst" className={field} />
        <span className="font-normal text-subtle">We read the role, employer and deadline from the page. Some sites, like LinkedIn, block this: paste the text instead.</span>
      </label>
      <div className="flex items-center gap-3 text-[13px] text-subtle">
        <span className="h-px flex-1 bg-line" />
        or paste the text
        <span className="h-px flex-1 bg-line" />
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        <span className="sr-only-abs">Job ad text</span>
        <textarea name="text" rows={8} placeholder="Paste the role description, responsibilities and requirements. Leave out salary and company background." className="resize-y rounded-[14px] border border-edge p-3.5 text-[15px] font-normal leading-[1.55]" />
      </label>
      <div className="flex flex-wrap gap-4">
        <label className="flex flex-[1_1_220px] flex-col gap-1.5 text-sm font-medium">
          Job title <span className="font-normal text-subtle">Optional</span>
          <input name="title" placeholder="Analyst Graduate Scheme" className={field} />
        </label>
        <label className="flex flex-[1_1_220px] flex-col gap-1.5 text-sm font-medium">
          Employer <span className="font-normal text-subtle">Optional</span>
          <input name="employer" placeholder="Northbank" className={field} />
        </label>
      </div>
      <FormError message={error} />
      <button type="submit" disabled={pending} className={cx("inline-flex min-h-[52px] items-center self-start rounded-full border-0 bg-black px-[26px] text-[15px] font-medium text-white hover:bg-ink-2 disabled:opacity-60")}>
        {pending ? "Reading the job ad…" : "Tailor my CV"}
      </button>
    </form>
  );
}

export function TrackedRoleButton({ opportunityId, title, sub, highlight }: { opportunityId: string; title: string; sub: string; highlight?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const fd = new FormData();
            fd.set("opportunityId", opportunityId);
            const res = await createTailor(fd);
            if (res.error || !res.id) setError(res.error ?? "Something went wrong.");
            else router.push(`/tailor/${res.id}?auto=1`);
          })
        }
        className={cx("flex flex-col gap-1 rounded-2xl border-0 px-4 py-3.5 text-left text-black hover:bg-mist", highlight ? "bg-mint" : "bg-canvas")}
      >
        <span className="text-[15px]">{title}</span>
        <span className="text-[13px] text-muted">{pending ? "Reading the job ad…" : sub}</span>
      </button>
      <FormError message={error} />
    </>
  );
}
