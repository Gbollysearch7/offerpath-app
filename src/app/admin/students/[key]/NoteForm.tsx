"use client";

import { useState, useTransition } from "react";
import { addAdviserNote } from "@/app/actions/admin";
import { FormError } from "@/components/client";

export function NoteForm({ reportId, studentKey }: { reportId: string; studentKey: string }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const res = await addAdviserNote(reportId, studentKey, note);
          if (res.error) setError(res.error);
          else setNote("");
        });
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Add a note about their latest CV
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} className="resize-y rounded-[14px] border border-edge p-3 text-[15px] font-normal" />
      </label>
      <FormError message={error} />
      <button type="submit" disabled={pending || note.trim().length < 2} className="min-h-11 self-start rounded-full border-0 bg-black px-[18px] text-sm font-medium text-white hover:bg-ink-2 disabled:opacity-50">
        {pending ? "Saving…" : "Save note"}
      </button>
    </form>
  );
}
