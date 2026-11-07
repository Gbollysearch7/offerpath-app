"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { dismissAction, reopenAction } from "@/app/actions/applications";
import { FormError } from "@/components/client";
import { btn } from "@/components/ui";
import { DISMISS_REASON_LABEL, DISMISS_REASONS, type DismissReason } from "@/lib/applications/types";

export interface ActionView {
  key: string;
  title: string;
  why: string;
  href: string;
  cta: string;
  chips: string[];
}

function ActionRow({ action }: { action: ActionView }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<DismissReason | "">("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const id = `dismiss-${action.key.replace(/[^\w-]/g, "-")}`;
  return (
    <li className="flex flex-col gap-2 rounded-2xl bg-canvas px-4 py-3.5">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-[1_1_260px]">
          <p className="m-0 text-[15px] [overflow-wrap:anywhere]">{action.title}</p>
          <p className="mt-1 mb-0 text-[13px] leading-normal text-muted [overflow-wrap:anywhere]">{action.why}</p>
          <p className="mt-1.5 mb-0 font-mono text-[11px] text-muted">{action.chips.join(" · ")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={action.href} className={btn.soft}>
            {action.cta}
          </Link>
          <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="min-h-[38px] rounded-full border-0 bg-transparent px-2.5 text-[13px] text-muted hover:text-black">
            Dismiss<span className="sr-only-abs">: {action.title}</span>
          </button>
        </div>
      </div>
      {open && (
        <form
          id={id}
          className="flex flex-wrap items-end gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason) return setError("Choose a reason.");
            start(async () => {
              setError(null);
              // On failure the choice stays selected, so nothing has to be chosen again.
              const out = await dismissAction(action.key, reason);
              if (out.error) setError(out.error);
            });
          }}
        >
          <label className="flex min-w-0 flex-col gap-1 text-[13px] text-muted">
            Why are you dismissing this?
            <select value={reason} onChange={(e) => setReason(e.target.value as DismissReason)} className="min-h-10 max-w-full rounded-xl border border-edge bg-white px-3 text-sm text-black">
              <option value="">Choose a reason</option>
              {DISMISS_REASONS.map((r) => (
                <option key={r} value={r}>
                  {DISMISS_REASON_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={pending} className={btn.soft}>
            {pending ? "Saving" : "Dismiss it"}
          </button>
        </form>
      )}
      <FormError message={error} />
    </li>
  );
}

export function NextActions({ actions, dismissed }: { actions: ActionView[]; dismissed: { key: string; title: string; reason: DismissReason; at: string }[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section aria-labelledby="next-h" className="flex flex-col gap-3 rounded-3xl bg-white px-4 py-[22px] sm:px-6">
      <h2 id="next-h" className="m-0 text-lg font-normal tracking-[-0.02em]">
        What to do next
      </h2>
      {actions.length ? (
        <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
          {actions.map((a) => (
            <ActionRow key={a.key} action={a} />
          ))}
        </ol>
      ) : (
        <p className="m-0 text-sm text-muted">Nothing needs you right now. There&apos;s no need to upload the same CV again: it will get the same result.</p>
      )}
      {dismissed.length > 0 && (
        <details className="text-[13px] text-muted">
          <summary className="min-h-8 cursor-pointer">Dismissed ({dismissed.length})</summary>
          <FormError message={error} />
          <ul className="mt-2 mb-0 flex list-none flex-col gap-2 p-0">
            {dismissed.map((d) => (
              <li key={d.key} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-[1_1_220px] [overflow-wrap:anywhere]">
                  {d.title} <span className="text-muted">({DISMISS_REASON_LABEL[d.reason]})</span>
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      setError(null);
                      const out = await reopenAction(d.key);
                      if (out.error) setError(out.error);
                    })
                  }
                  className={btn.soft}
                >
                  Bring back<span className="sr-only-abs">: {d.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
