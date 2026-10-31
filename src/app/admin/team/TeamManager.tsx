"use client";

import { useState, useTransition } from "react";
import { setAdmin } from "@/app/actions/admin";
import { FormError } from "@/components/client";
import type { AdminTeam } from "@/lib/repo/types";

export function TeamManager({ team, domain }: { team: AdminTeam; domain: string }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const change = (target: string, admin: boolean) =>
    start(async () => {
      setError(null);
      setStatus(null);
      const res = await setAdmin(target, admin);
      if (res.error) setError(res.error);
      else {
        setStatus(res.status === "invited" ? `${target} will become an admin when they first sign in.` : res.status === "granted" ? `${target} is now a careers admin.` : `${target} is no longer a careers admin.`);
        if (admin) setEmail("");
      }
    });

  return (
    <>
      <section aria-labelledby="add-h" className="flex flex-col gap-3 rounded-3xl bg-white px-6 py-[22px]">
        <h2 id="add-h" className="m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">
          ADD A CAREERS ADMIN
        </h2>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            change(email.trim(), true);
          }}
        >
          <label className="flex min-w-[280px] flex-1 flex-col gap-1.5 text-sm font-medium">
            University email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`name@${domain || "your-university.ac.uk"}`} className="min-h-12 rounded-[14px] border border-edge px-3.5 text-[15px] font-normal" />
          </label>
          <button type="submit" disabled={pending || !email} className="min-h-12 rounded-full border-0 bg-black px-[18px] text-sm font-medium text-white hover:bg-ink-2 disabled:opacity-60">
            Add admin
          </button>
        </form>
        <FormError message={error} />
        {status && (
          <p role="status" className="m-0 text-sm text-brand">
            {status}
          </p>
        )}
      </section>

      <section aria-labelledby="team-h" className="rounded-3xl bg-white px-6 py-[22px]">
        <h2 id="team-h" className="mt-0 mb-2 font-mono text-xs font-normal tracking-[0.04em] text-subtle">
          ADMINS · {team.admins.length}
        </h2>
        {team.admins.map((a) => (
          <div key={a.email} className="flex flex-wrap items-center gap-3 border-t border-line py-3">
            <span className="flex-1">
              <span className="block text-[15px]">
                {a.name} {a.you && <span className="ml-1 rounded-full bg-mint px-2 py-0.5 text-xs text-brand">You</span>}
              </span>
              <span className="block text-[13px] text-subtle">{a.email}</span>
            </span>
            <button type="button" disabled={pending} onClick={() => change(a.email, false)} className="min-h-10 rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper disabled:opacity-60" aria-label={`Remove ${a.email} as admin`}>
              Remove
            </button>
          </div>
        ))}
        {team.pending.length > 0 && (
          <>
            <h2 className="mt-5 mb-2 font-mono text-xs font-normal tracking-[0.04em] text-subtle">INVITED, NOT SIGNED IN YET · {team.pending.length}</h2>
            {team.pending.map((p) => (
              <div key={p.email} className="flex flex-wrap items-center gap-3 border-t border-line py-3">
                <span className="flex-1 text-[15px]">{p.email}</span>
                <button type="button" disabled={pending} onClick={() => change(p.email, false)} className="min-h-10 rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper disabled:opacity-60" aria-label={`Cancel invitation for ${p.email}`}>
                  Cancel invite
                </button>
              </div>
            ))}
          </>
        )}
      </section>
    </>
  );
}
