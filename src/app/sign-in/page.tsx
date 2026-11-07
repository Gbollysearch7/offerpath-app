import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/ui";
import { testSignIn } from "@/app/actions/auth";
import { demoLoginAllowed, featureFlags } from "@/lib/env";
import { DEMO_UNIVERSITY } from "@/lib/seed-data";
import { getProfile, isDemoMode } from "@/lib/session";
import { ssoUniversities } from "@/lib/sso";
import { SignInForms } from "./SignInForms";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string; admin?: string; deleted?: string }> }) {
  const sp = await searchParams;
  const profile = await getProfile();
  if (profile) redirect("/");
  const admin = sp.admin === "1";
  return (
    <div className="flex min-h-screen flex-wrap bg-white text-black">
      <section aria-label="About Offerpath" className="flex min-w-0 flex-[1_1_520px] flex-col justify-between gap-10 bg-canvas px-6 py-10 sm:px-14">
        <div className="flex items-center gap-2.5 text-[19px] font-medium tracking-[-0.02em]">
          <Logo size={30} />
          Offerpath
        </div>
        <div>
          <p className="m-0 text-[44px] leading-[1.08] tracking-[-2px] sm:text-[64px] sm:tracking-[-2.88px]">From first draft to signed offer.</p>
          <p className="mt-5 mb-0 max-w-[460px] text-lg leading-relaxed text-muted">Free for students at partner universities. Sign in with your university account to get started.</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {["Built with UK GDPR in mind", "Files stored in the UK or EU", "Working towards WCAG 2.2 AA"].map((t) => (
            <span key={t} className="rounded-full bg-white px-3 py-2 text-[13px] text-muted">
              {t}
            </span>
          ))}
        </div>
      </section>

      <main id="main" className="flex min-w-0 flex-[1_1_480px] items-center justify-center px-6 py-10 sm:px-14">
        <div className="flex w-full max-w-[420px] flex-col gap-5">
          <h1 className="m-0 text-[40px] font-normal leading-[1.1] tracking-[-1.8px]">{admin ? "Careers team sign in" : "Sign in"}</h1>
          {sp.deleted && <p role="status" className="m-0 rounded-2xl bg-mist px-4 py-3 text-sm">Your account has been deleted, with your CVs, reports and letters.</p>}
          {sp.error && <p role="alert" className="m-0 rounded-2xl border border-black px-4 py-3 text-sm">{sp.error}</p>}
          {isDemoMode() && demoLoginAllowed() && (
            <p className="m-0 rounded-2xl bg-mist px-4 py-3 text-[13px] leading-normal text-body">
              Demo mode: no database is connected, so sign-in opens a sample account with fictional data. Nothing leaves this server.
            </p>
          )}
          {(featureFlags.testLogin() || (isDemoMode() && demoLoginAllowed())) && (
            <div className="flex flex-col gap-3 rounded-3xl bg-mist p-5">
              <p className="m-0 text-[13px] leading-normal text-body">Testing phase: enter the app with a test account. No email needed.</p>
              <div className="flex flex-wrap gap-2.5">
                <form action={testSignIn} className="flex-1">
                  <button type="submit" className="min-h-12 w-full rounded-full border-0 bg-black px-5 text-[15px] font-medium text-white hover:bg-ink-2">
                    Enter as a student
                  </button>
                </form>
                <form action={testSignIn} className="flex-1">
                  <input type="hidden" name="admin" value="1" />
                  <button type="submit" className="min-h-12 w-full rounded-full border border-edge bg-white px-5 text-[15px] text-black hover:bg-paper">
                    Enter as careers team
                  </button>
                </form>
                {isDemoMode() && (
                  <form action={testSignIn} className="w-full">
                    <input type="hidden" name="adviser" value="1" />
                    <button type="submit" className="min-h-12 w-full rounded-full border border-edge bg-white px-5 text-[15px] text-black hover:bg-paper">
                      Enter as an adviser
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}
          <SignInForms admin={admin} universities={isDemoMode() && demoLoginAllowed() ? [DEMO_UNIVERSITY] : ssoUniversities()} />
          <p className="m-0 text-[13px] leading-normal text-subtle">
            Your university controls your data, and you can export or delete it at any time. <Link href="/legal/privacy">How we use your data</Link> · <Link href="/legal/terms">Terms</Link> · <Link href="/legal/accessibility">Accessibility</Link>
          </p>
          <p className="mt-2 mb-0 text-[13px] text-subtle">
            {admin ? (
              <>
                Student? <Link href="/sign-in">Sign in here</Link>
              </>
            ) : (
              <>
                Careers team? <Link href="/sign-in?admin=1">Sign in to the admin dashboard</Link>
              </>
            )}
          </p>
        </div>
      </main>
    </div>
  );
}
