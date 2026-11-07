"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { approvePracticeVersion } from "@/app/actions/practice";
import { btn } from "@/components/ui";

export function ApproveVersion({ applicationId, reportId, kind, version, holder, label }: { applicationId: string; reportId: string; kind: "cv" | "tailor"; version: string; holder: string | null; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const approve = async () => {
    setBusy(true);
    setError(null);
    const out = await approvePracticeVersion(applicationId, reportId, kind, version, holder).catch(() => ({ error: "We couldn't reach the server. Try again." }));
    setBusy(false);
    if (out.error) setError(out.error);
    else router.refresh();
  };
  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" className={btn.primary} disabled={busy} onClick={approve}>
        {busy ? "Working…" : "Practise from this version"}
        <span className="sr-only-abs">: {label}</span>
      </button>
      {error && (
        <p role="alert" className="m-0 text-sm text-black">
          {error}
        </p>
      )}
    </div>
  );
}
