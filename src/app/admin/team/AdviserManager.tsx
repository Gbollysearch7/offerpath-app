"use client";

import { useState, useTransition } from "react";
import { setAdviser, setAdviserGroups } from "@/app/actions/adviser";
import { FormError } from "@/components/client";
import type { AdviserTeam, ProgrammeGroup } from "@/lib/institution/types";

export function AdviserManager({ team, groups, domain, assigned }: { team: AdviserTeam; groups: ProgrammeGroup[]; domain: string; assigned: boolean }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const change = (target: string, on: boolean) =>
    start(async () => {
      setError(null);
      setStatus(null);
      const r = await setAdviser(target, on);
      if (r.error) setError(r.error);
      else {
        setStatus(r.status === "invited" ? `${target} will become an adviser when they first sign in.` : r.status === "granted" ? `${target} is now an adviser.` : `${target} is no longer an adviser. This applies from their next request.`);
        if (on) setEmail("");
      }
    });
  return (
    <section aria-labelledby="adv-h" className="flex flex-col gap-3 rounded-3xl bg-white px-6 py-[22px]">
      <h2 id="adv-h" className="m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">
        ADVISERS
      </h2>
      <p className="m-0 text-sm leading-relaxed text-muted">
        Advisers can see students, leave notes, record disagreement and manage referrals. They can&apos;t see the dashboard, export, import or change anything about the service. {assigned ? "Under your policy they see only students in the groups you give them, so an adviser with no groups sees nobody." : "Under your policy they see every student who shares their progress."}
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          change(email.trim(), true);
        }}
      >
        <label className="flex min-w-0 flex-1 basis-[240px] flex-col gap-1.5 text-sm font-medium">
          University email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`name@${domain || "your-university.ac.uk"}`} className="min-h-12 rounded-[14px] border border-edge px-3.5 text-[15px] font-normal" />
        </label>
        <button type="submit" disabled={pending || !email} className="min-h-12 rounded-full border-0 bg-black px-[18px] text-sm font-medium text-white hover:bg-ink-2 disabled:opacity-60">
          Add adviser
        </button>
      </form>
      <FormError message={error} />
      {status && (
        <p role="status" className="m-0 text-sm text-brand">
          {status}
        </p>
      )}
      {team.advisers.map((a) => (
        <Adviser key={a.id} adviser={a} groups={groups} disabled={pending} onRemove={() => change(a.email, false)} />
      ))}
      {team.pending.map((p) => (
        <div key={p.email} className="flex flex-wrap items-center gap-3 border-t border-line pt-2.5 text-sm">
          <span className="min-w-0 flex-1 break-words">{p.email} <span className="text-subtle">· hasn&apos;t signed in yet</span></span>
          <button type="button" disabled={pending} onClick={() => change(p.email, false)} className="min-h-10 rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper" aria-label={`Cancel invitation for ${p.email}`}>
            Cancel
          </button>
        </div>
      ))}
    </section>
  );
}

function Adviser({ adviser, groups, disabled, onRemove }: { adviser: AdviserTeam["advisers"][number]; groups: ProgrammeGroup[]; disabled: boolean; onRemove: () => void }) {
  const [chosen, setChosen] = useState(adviser.groupIds);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      setError(null);
      setSaved(false);
      const r = await setAdviserGroups(adviser.id, chosen);
      if (r.error) setError(r.error);
      else setSaved(true);
    });
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 break-words text-[15px]">
          {adviser.name} <span className="text-[13px] text-subtle">· {adviser.email}</span>
        </span>
        <button type="button" disabled={disabled} onClick={onRemove} className="min-h-10 rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper" aria-label={`Remove ${adviser.name} as an adviser`}>
          Remove
        </button>
      </div>
      {groups.length > 0 && (
        <fieldset className="m-0 flex flex-wrap items-center gap-3 border-0 p-0 text-sm">
          <legend className="mb-1 p-0 text-[13px] text-subtle">Programme groups</legend>
          {groups.map((g) => (
            <label key={g.id} className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={chosen.includes(g.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, g.id] : chosen.filter((x) => x !== g.id))} className="h-5 w-5" />
              {g.name}
            </label>
          ))}
          <button type="button" disabled={pending} onClick={save} className="min-h-10 rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper" aria-label={`Save groups for ${adviser.name}`}>
            Save groups
          </button>
        </fieldset>
      )}
      <FormError message={error} />
      {saved && <p role="status" className="m-0 text-sm text-brand">Saved. This applies from their next request.</p>}
    </div>
  );
}
