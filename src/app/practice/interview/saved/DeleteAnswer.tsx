"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deletePracticeAnswer } from "@/app/actions/practice";
import { btn } from "@/components/ui";

export function DeleteAnswer({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setBusy(true);
    setError(null);
    const out = await deletePracticeAnswer(id).catch(() => ({ error: "We couldn't reach the server. Try again." }));
    setBusy(false);
    if (out.error) setError(out.error);
    else router.refresh();
  };
  if (!asking) {
    return (
      <button type="button" className={btn.secondary} onClick={() => setAsking(true)}>
        Delete<span className="sr-only-abs"> your answer to: {name}</span>
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-black">Delete this answer and its feedback? This can&apos;t be undone.</span>
      <button type="button" className={btn.primary} disabled={busy} onClick={remove}>
        {busy ? "Deleting…" : "Yes, delete"}
      </button>
      <button type="button" className={btn.secondary} disabled={busy} onClick={() => setAsking(false)}>
        Keep it
      </button>
      {error && (
        <p role="alert" className="m-0 w-full text-sm text-black">
          {error}
        </p>
      )}
    </div>
  );
}
