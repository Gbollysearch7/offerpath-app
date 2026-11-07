"use client";

import { useState, useTransition } from "react";
import { answerReferral } from "@/app/actions/adviser";
import { FormError } from "@/components/client";

export function ReferralAnswer({ id, target }: { id: string; target: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const answer = (accept: boolean) =>
    start(async () => {
      setError(null);
      const r = await answerReferral(id, accept);
      if (r.error) setError(r.error);
    });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => answer(true)} className="min-h-11 rounded-full border-0 bg-black px-[18px] text-sm font-medium text-white hover:bg-ink-2 disabled:opacity-50" aria-label={`Accept the referral to ${target}`}>
          Accept
        </button>
        <button type="button" disabled={pending} onClick={() => answer(false)} className="min-h-11 rounded-full border border-edge bg-white px-[18px] text-sm text-black hover:bg-paper disabled:opacity-50" aria-label={`Decline the referral to ${target}`}>
          Decline
        </button>
      </div>
      <FormError message={error} />
    </div>
  );
}
