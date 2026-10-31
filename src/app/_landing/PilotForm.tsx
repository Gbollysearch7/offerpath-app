"use client";

import { useActionState } from "react";
import { type PilotState, requestPilot } from "@/app/actions/pilot";

const field = "min-h-[52px] rounded-[14px] border border-edge bg-white px-[18px] text-base font-normal text-black";

export function PilotForm() {
  const [state, action, pending] = useActionState<PilotState, FormData>(requestPilot, null);

  // A fresh form per response, so React's post-submit reset can't wipe the values sent back on error.
  const v = state?.values;

  if (state?.ok) {
    return (
      <div role="status" className="flex min-w-0 flex-[1_1_400px] flex-col gap-3 rounded-[32px] bg-canvas p-8">
        <p className="m-0 text-[28px] tracking-[-0.04em]">Thanks, we&apos;ve got it.</p>
        <p className="m-0 text-base leading-relaxed text-muted">We&apos;ll email you to arrange a call. We only use your details for that.</p>
      </div>
    );
  }

  return (
    <form key={v ? JSON.stringify(v) + state?.error : "new"} action={action} className="flex min-w-0 flex-[1_1_400px] flex-col gap-4 rounded-[32px] bg-canvas p-6 sm:p-8">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Your name
        <input name="name" defaultValue={v?.name} type="text" required maxLength={120} autoComplete="name" className={field} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        University
        <input name="university" defaultValue={v?.university} type="text" required maxLength={160} autoComplete="organization" className={field} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Your role
        <input name="role" defaultValue={v?.role} type="text" maxLength={120} autoComplete="organization-title" placeholder="For example, Head of Careers" className={field} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Work email
        <input name="email" defaultValue={v?.email} type="email" required maxLength={254} autoComplete="email" className={field} />
      </label>
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input name="website" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {state?.error && (
        <p role="alert" className="m-0 rounded-xl bg-white px-4 py-3 text-sm text-black">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="op-arrow mt-1.5 inline-flex min-h-14 items-center justify-center gap-2.5 rounded-full border-0 bg-black text-base font-medium text-white hover:bg-ink-2 disabled:opacity-60">
        {pending ? "Sending…" : "Request a pilot conversation"}
        <svg width="16" height="16" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M2 7h9M7.5 3.5L11 7l-3.5 3.5" fill="none" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <p className="m-0 text-[13px] text-subtle">
        We only use your details to arrange the call. <a href="/legal/privacy">Privacy notice</a>
      </p>
    </form>
  );
}
