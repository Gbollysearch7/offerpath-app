"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { keepVersion, linkArtefact, stopTracking, trackRole, unlinkArtefact } from "@/app/actions/applications";
import { focusSoon } from "@/components/a11y";
import { FormError } from "@/components/client";

const EXPIRED = "Your session has expired. Sign in again, then come back to this page. Nothing here was changed.";
const FAILED = "The download didn't finish, and nothing has changed. Try again.";
// These sit on the grey application cards, where the usual soft button would disappear.
const onCard = "inline-flex min-h-[38px] items-center justify-center rounded-full border border-edge bg-white px-3.5 text-[13px] text-black no-underline hover:bg-paper hover:text-black disabled:opacity-50";

/** Fetches the file so a failure stays on this page with a message, instead of replacing the page with an error. A retry is just another click. */
export function DownloadButton({ href, label, name }: { href: string; label: string; name: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              const res = await fetch(href, { credentials: "same-origin" });
              if (res.status === 401) return setError(EXPIRED);
              if (!res.ok) {
                const body = (await res.json().catch(() => null)) as { error?: string } | null;
                return setError(body?.error ?? FAILED);
              }
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "download";
              document.body.append(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);
              router.refresh();
            } catch {
              setError(FAILED);
            }
          })
        }
        className={onCard}
      >
        {pending ? "Preparing" : label}
        <span className="sr-only-abs">: {name}</span>
      </button>
      {error && (
        <span className="w-full">
          <FormError message={error} />
        </span>
      )}
    </>
  );
}

function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      setError(null);
      const out = await fn();
      if (out.error) setError(out.error);
    });
  return { error, pending, run };
}

/** Puts a document in a slot. `holder` is the report this tab saw there, so another tab's change is refused rather than replaced. */
export function LinkPicker({ applicationId, holder, options, label }: { applicationId: string; holder: string | null; options: { id: string; label: string }[]; label: string }) {
  const [choice, setChoice] = useState("");
  const { error, pending, run } = useAction();
  if (!options.length) return null;
  return (
    <form
      className="flex w-full flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (choice) run(() => linkArtefact(applicationId, choice, holder));
      }}
    >
      <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs text-muted">
        {label}
        <select value={choice} onChange={(e) => setChoice(e.target.value)} className="min-h-[38px] w-full max-w-[320px] rounded-xl border border-edge bg-white px-2.5 text-[13px] text-black">
          <option value="">Choose a document</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending || !choice} className={onCard}>
        Link
      </button>
      <FormError message={error} />
    </form>
  );
}

export function SlotButtons({ applicationId, reportId, kind, name, linked, latest, kept }: { applicationId: string; reportId: string; kind: string; name: string; linked: boolean; latest: string | null; kept: boolean }) {
  const { error, pending, run } = useAction();
  const holder = linked ? reportId : null;
  return (
    <>
      {kept ? (
        <button type="button" disabled={pending} onClick={() => run(() => keepVersion(applicationId, reportId, kind, null, holder))} className={onCard}>
          Use the latest<span className="sr-only-abs"> version of {name}</span>
        </button>
      ) : (
        latest && (
          <button type="button" disabled={pending} onClick={() => run(() => keepVersion(applicationId, reportId, kind, latest, holder))} className={onCard}>
            Keep this version<span className="sr-only-abs"> of {name}</span>
          </button>
        )
      )}
      {linked && (
        <button type="button" disabled={pending} onClick={() => run(() => unlinkArtefact(applicationId, kind, reportId))} className="min-h-[38px] rounded-full border-0 bg-transparent px-2.5 text-[13px] text-muted hover:text-black">
          Unlink<span className="sr-only-abs"> {name}</span>
        </button>
      )}
      {error && (
        <span className="w-full">
          <FormError message={error} />
        </span>
      )}
    </>
  );
}

export function TrackRoleButton({ reportId, name }: { reportId: string; name: string }) {
  const { error, pending, run } = useAction();
  return (
    <>
      <button type="button" disabled={pending} onClick={() => run(() => trackRole(reportId))} className={onCard}>
        Track this role<span className="sr-only-abs">: {name}</span>
      </button>
      <FormError message={error} />
    </>
  );
}

export function AddToApplicationButton({ applicationId, reportId, name, role }: { applicationId: string; reportId: string; name: string; role: string }) {
  const { error, pending, run } = useAction();
  return (
    <>
      <button type="button" disabled={pending} onClick={() => run(() => linkArtefact(applicationId, reportId, null))} className={onCard}>
        Link to {role}
        <span className="sr-only-abs">: {name}</span>
      </button>
      <FormError message={error} />
    </>
  );
}

/** Asks first, and says what happens: the documents stay. */
export function StopTrackingButton({ applicationId, name }: { applicationId: string; name: string }) {
  const [asking, setAsking] = useState(false);
  const { error, pending, run } = useAction();
  const opener = useRef<HTMLButtonElement>(null);
  const questionId = useId();
  return asking ? (
    <span id={questionId} className="flex w-full flex-wrap items-center gap-2 text-[13px] text-muted">
      Stop tracking {name}? Your documents stay in My reports, but their links to this role go.
      <button type="button" disabled={pending} onClick={() => run(() => stopTracking(applicationId))} className={onCard}>
        Stop tracking
      </button>
      <button type="button" autoFocus aria-describedby={questionId} onClick={() => { setAsking(false); focusSoon(() => opener.current); }} className={onCard}>
        Keep it
      </button>
      <FormError message={error} />
    </span>
  ) : (
    <button ref={opener} type="button" onClick={() => setAsking(true)} className="min-h-[38px] rounded-full border-0 bg-transparent px-2.5 text-[13px] text-muted hover:text-black">
      Stop tracking<span className="sr-only-abs"> {name}</span>
    </button>
  );
}
