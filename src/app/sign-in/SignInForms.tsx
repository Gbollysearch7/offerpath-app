"use client";

import { useActionState } from "react";
import { signInWithEmail, signInWithUniversity, type AuthState } from "@/app/actions/auth";
import { FormError } from "@/components/client";
import { SearchIcon } from "@/components/ui";

const UNIVERSITIES = [{ name: "University of Northfield", domain: "northfield.ac.uk" }];

export function SignInForms({ admin }: { admin: boolean }) {
  const [state, emailAction, pending] = useActionState<AuthState, FormData>(signInWithEmail, null);

  if (state?.sent) {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-3xl bg-canvas p-6">
        <p className="m-0 text-lg tracking-[-0.02em]">Check your inbox</p>
        <p className="m-0 text-sm leading-normal text-muted">
          We sent a sign-in link to <span className="font-medium text-black">{state.sent}</span>. It works once and expires in an hour.
        </p>
      </div>
    );
  }

  return (
    <>
      <form action={signInWithUniversity} className="flex flex-col gap-5">
        {admin && <input type="hidden" name="admin" value="1" />}
        <label className="flex flex-col gap-2 text-sm font-medium">
          Your university
          <span className="flex min-h-[54px] items-center gap-2.5 rounded-2xl border border-edge bg-white px-4">
            <SearchIcon />
            <input type="search" name="university" list="universities" defaultValue={UNIVERSITIES[0].name} className="flex-1 border-0 bg-transparent text-base font-normal outline-none" />
          </span>
        </label>
        <datalist id="universities">
          {UNIVERSITIES.map((u) => (
            <option key={u.domain} value={u.name} />
          ))}
        </datalist>
        <input type="hidden" name="domain" value={UNIVERSITIES[0].domain} />
        <button type="submit" className="inline-flex min-h-14 items-center justify-center gap-2.5 rounded-full border-0 bg-black text-base font-medium text-white hover:bg-ink-2">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 10l8-5 8 5M6 10v8M10 10v8M14 10v8M18 10v8M3 20h18" fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Continue with university sign-in
        </button>
      </form>
      <div className="flex items-center gap-3 text-[13px] text-subtle">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
      <form action={emailAction} className="flex flex-col gap-5" noValidate>
        {admin && <input type="hidden" name="admin" value="1" />}
        <label className="flex flex-col gap-2 text-sm font-medium">
          University email
          <input type="email" name="email" required autoComplete="email" placeholder="you@northfield.ac.uk" aria-invalid={!!state?.error} className="min-h-[54px] rounded-2xl border border-edge px-4 text-base font-normal" />
        </label>
        <FormError message={state?.error} />
        <button type="submit" disabled={pending} className="min-h-[54px] rounded-full border border-edge bg-white text-base text-black hover:bg-paper disabled:opacity-60">
          {pending ? "Sending…" : "Email me a sign-in link"}
        </button>
      </form>
    </>
  );
}
