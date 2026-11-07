"use client";

import { useState, useTransition } from "react";
import { dismissFinding, reopenFinding, setProofreadingLanguage } from "@/app/actions/proofreading";
import type { ProofreadingLanguage } from "@/lib/types";

/** The panel's headline. It says what changed, and focus goes there because the button that was pressed has just moved. */
export const PROOFREADING_STATUS_ID = "proofreading-status";
const afterChange = () => document.getElementById(PROOFREADING_STATUS_ID)?.focus();

const BUTTON = "inline-flex min-h-11 items-center rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper disabled:opacity-60";

export function FindingChoice({ reportId, findingId, word, mode }: { reportId: string; findingId: string; word: string; mode: "dismiss" | "reopen" }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const label = mode === "dismiss" ? "Dismiss for this CV" : "Reopen";
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
      <button
        type="button"
        disabled={pending}
        aria-label={`${label}: ${word}`}
        className={BUTTON}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await (mode === "dismiss" ? dismissFinding : reopenFinding)(reportId, findingId);
            if (r.error) setError(r.error);
            else afterChange();
          })
        }
      >
        {pending ? "Saving…" : label}
      </button>
      {error && <p role="alert" className="m-0 text-sm text-body">{error}</p>}
    </div>
  );
}

export function LanguageChoice({ reportId, language, names }: { reportId: string; language: ProofreadingLanguage; names: Record<ProofreadingLanguage, string> }) {
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState(language);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="m-0 rounded-2xl bg-canvas px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await setProofreadingLanguage(reportId, picked);
          if (r.error) setError(r.error);
          else afterChange();
        });
      }}
    >
      <fieldset className="m-0 border-0 p-0">
        <legend className="p-0 text-[15px] font-medium">English to check against</legend>
        <div className="mt-1 flex flex-wrap items-center gap-x-5">
          {(Object.keys(names) as ProofreadingLanguage[]).map((l) => (
            <label key={l} className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-[15px]">
              <input type="radio" name="proofreading-language" value={l} checked={picked === l} onChange={() => setPicked(l)} />
              {names[l]}
            </label>
          ))}
          <button type="submit" disabled={pending} className={BUTTON}>
            {pending ? "Checking…" : "Check again"}
          </button>
        </div>
      </fieldset>
      <p className="mt-1 mb-0 text-sm leading-[1.55] text-muted">Applies to this CV and your next ones. It doesn&apos;t change your score.</p>
      {error && <p role="alert" className="mt-1.5 mb-0 text-sm text-body">{error}</p>}
    </form>
  );
}
