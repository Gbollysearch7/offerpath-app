"use client";

import { useState, useTransition } from "react";
import { setShareProgress } from "@/app/actions/cv";

export function ShareButton({ shared }: { shared: boolean }) {
  const [on, setOn] = useState(shared);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        aria-pressed={on}
        onClick={() =>
          start(async () => {
            await setShareProgress(!on);
            setOn(!on);
          })
        }
        className={on ? "inline-flex min-h-11 items-center gap-2 rounded-full border border-brand bg-okbg px-[18px] text-sm font-medium text-brand" : "inline-flex min-h-11 items-center gap-2 rounded-full border-0 bg-black px-[18px] text-sm font-medium text-white hover:bg-ink-2"}
      >
        {on ? "Shared with my adviser" : "Share with my adviser"}
      </button>
      <p aria-live="polite" className="m-0 text-xs text-subtle">
        {on ? "Your scores and activity are visible to your careers service. Your CV isn't." : ""}
      </p>
    </div>
  );
}
