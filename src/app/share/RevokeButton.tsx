"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { announce } from "@/components/a11y";
import { revokeShareLink } from "./actions";

export function RevokeButton({ linkId, name }: { linkId: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await revokeShareLink(linkId);
            if ("error" in r) setError(r.error ?? "");
            else {
              announce(`Link switched off: ${name}.`);
              router.refresh();
            }
          })
        }
        className="inline-flex min-h-11 items-center rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper disabled:opacity-60"
      >
        {pending ? "Switching off" : "Switch off"}
        <span className="sr-only-abs"> link: {name}</span>
      </button>
      <p role="status" className="m-0 text-xs text-black">
        {error}
      </p>
    </div>
  );
}
