"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ShareOption } from "@/lib/sharing/flow";
import { DEFAULT_SHARE_EXPIRY_DAYS, DEFAULT_SHARE_SCOPE, SHARE_EXPIRY_DAYS, type ShareScope } from "@/lib/sharing/types";
import { announce } from "@/components/a11y";
import { createShareLink } from "./actions";

const dayLabel = (d: number) => (d === 1 ? "1 day" : `${d} days`);

/** Choose what to share and for how long, see exactly what a recipient gets, then create the link. Nothing is live before that. */
export function ShareForm({ reportId, options, neverShared }: { reportId: string; options: ShareOption[]; neverShared: string[] }) {
  const router = useRouter();
  const [scope, setScope] = useState<ShareScope>(DEFAULT_SHARE_SCOPE);
  const [days, setDays] = useState<number>(DEFAULT_SHARE_EXPIRY_DAYS);
  const [understood, setUnderstood] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const option = options.find((o) => o.scope === scope)!;

  const create = () =>
    start(async () => {
      setError("");
      const r = await createShareLink({ reportId, scope, expiryDays: days, previewDigest: option.digest });
      if ("error" in r) return setError(r.error ?? "");
      setCreated({ url: `${window.location.origin}${r.path}`, expiresAt: r.expiresAt });
      setCopied(false);
      setUnderstood(false);
      announce("Link created. Copy it now: it won't be shown again.");
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="choose-h" className="flex flex-col gap-4 rounded-3xl bg-white px-[26px] py-6">
        <h2 id="choose-h" className="m-0 text-xl font-normal tracking-[-0.03em]">
          What to share
        </h2>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-sm text-muted">Starts with the least. Choose more only if the person needs it.</legend>
          {options.map((o) => (
            <label key={o.scope} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border border-line px-4 py-3 text-[15px]">
              <input type="radio" name="scope" className="mt-1" checked={scope === o.scope} onChange={() => setScope(o.scope)} />
              <span className="min-w-0">
                <span className="block">{o.label}</span>
                <span className="block text-[13px] leading-normal text-muted">{o.includes.join(". ")}.</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1 text-sm">
          Stops working after
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="min-h-11 max-w-[220px] rounded-xl border border-edge bg-white px-3 text-[15px]">
            {SHARE_EXPIRY_DAYS.map((d) => (
              <option key={d} value={d}>
                {dayLabel(d)}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section aria-labelledby="preview-h" className="flex flex-col gap-3 rounded-3xl bg-white px-[26px] py-6">
        <h2 id="preview-h" className="m-0 text-xl font-normal tracking-[-0.03em]">
          Preview of what they will see
        </h2>
        <div className="rounded-2xl border border-line px-5 py-5" data-share-preview={option.scope} dangerouslySetInnerHTML={{ __html: option.html }} />
        <h3 className="mt-2 mb-0 text-[15px] font-medium">Never shared, whichever you choose</h3>
        <ul className="m-0 list-disc pl-5 text-sm leading-relaxed text-body">
          {neverShared.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="create-h" className="flex flex-col gap-3 rounded-3xl bg-white px-[26px] py-6">
        <h2 id="create-h" className="m-0 text-xl font-normal tracking-[-0.03em]">
          Create the link
        </h2>
        <p className="m-0 text-[15px] leading-normal text-body">
          <strong className="font-medium">Anyone who gets this link can open it</strong>, with no sign-in, until it expires or you switch it off. If it&apos;s forwarded, we can&apos;t tell who has it. Switching it off works straight away, but can&apos;t undo what someone has already read or saved. You&apos;ll see when it was opened, but not by whom. This is separate from sharing with your careers adviser, which you control under Privacy.
        </p>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-[15px]">
          <input type="checkbox" className="mt-1" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          <span>I understand that anyone with the link can see what&apos;s in the preview above.</span>
        </label>
        <div>
          <button type="button" disabled={!understood || pending} onClick={create} className="inline-flex min-h-11 items-center rounded-full border-0 bg-black px-[18px] text-sm font-medium text-white hover:bg-ink-2 disabled:opacity-60">
            {pending ? "Creating" : "Create link"}
          </button>
        </div>
        <p role="status" className="m-0 text-sm text-black">
          {error}
        </p>
        {created && (
          <div className="flex flex-col gap-2 rounded-2xl bg-mist px-4 py-4">
            <label htmlFor="share-url" className="text-sm font-medium">
              Your link. Copy it now: it won&apos;t be shown again, because we don&apos;t keep it.
            </label>
            <input id="share-url" autoFocus readOnly value={created.url} onFocus={(e) => e.target.select()} className="min-h-11 w-full min-w-0 rounded-xl border border-edge bg-white px-3 font-mono text-[13px]" />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(created.url);
                    setCopied(true);
                  } catch {
                    setError("Your browser blocked copying. Select the link above and copy it yourself.");
                  }
                }}
                className="inline-flex min-h-11 items-center rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper"
              >
                Copy link
              </button>
              <span role="status" className="text-sm text-black">
                {copied ? "Copied" : ""}
              </span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
