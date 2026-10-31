"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { featureFlags } from "@/lib/env";
import { resetDemoUser } from "@/lib/repo/demo";
import { DEMO_COOKIE, getRepo, isDemoMode, readDemoSession, signDemoSession } from "@/lib/session";
import { clientIp, hit, TOO_MANY } from "@/lib/rate-limit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { Stage } from "@/lib/types";

export type AuthState = { error?: string; sent?: string } | null;

async function startDemo(role: "student" | "admin") {
  const store = await cookies();
  const existing = readDemoSession(store.get(DEMO_COOKIE)?.value);
  const id = existing?.role === role ? existing.id : crypto.randomUUID();
  store.set(DEMO_COOKIE, signDemoSession(role, id), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
  redirect(role === "admin" ? "/admin" : "/dashboard");
}

/** Where auth emails and SSO send people back to. Never taken from request headers. */
async function siteUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("NEXT_PUBLIC_SITE_URL must be set in production");
  return `http://${(await headers()).get("host") ?? "localhost:3000"}`;
}

/** Only partner universities' email domains (and their subdomains) can sign in. */
async function isPartnerDomain(email: string): Promise<boolean> {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  const { data, error } = await supabaseAdmin().from("universities").select("domain");
  if (error) throw new Error(error.message);
  return (data ?? []).some((u) => domain === u.domain || domain.endsWith(`.${u.domain}`));
}

export async function signInWithUniversity(formData: FormData) {
  const asAdmin = formData.get("admin") === "1";
  if (isDemoMode()) return startDemo(asAdmin ? "admin" : "student");
  // University single sign-on (SAML) is configured per university in Supabase.
  const sb = await createSupabaseServer();
  const domain = String(formData.get("domain") ?? "").trim();
  const { data, error } = await sb.auth.signInWithSSO({ domain, options: { redirectTo: `${await siteUrl()}/auth/callback` } });
  if (error || !data?.url) redirect(`/sign-in?error=${encodeURIComponent("University sign-in isn't set up for your university yet. Use the email link below.")}`);
  redirect(data.url);
}

export async function signInWithEmail(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = z.string().trim().email().safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address, like you@northfield.ac.uk." };
  if (isDemoMode()) await startDemo(formData.get("admin") === "1" ? "admin" : "student");
  if (!(await hit("signInPerIp", await clientIp())) || !(await hit("signInPerEmail", parsed.data))) return { error: TOO_MANY };
  if (!(await isPartnerDomain(parsed.data))) {
    return { error: "Offerpath is for students and staff at partner universities. Use your university email address." };
  }
  const sb = await createSupabaseServer();
  const { error } = await sb.auth.signInWithOtp({ email: parsed.data, options: { emailRedirectTo: `${await siteUrl()}/auth/callback` } });
  if (error) return { error: error.status === 429 ? "Too many sign-in emails. Wait a minute and try again." : "We couldn't send the link. Check the address and try again." };
  return { sent: parsed.data };
}

/** Test accounts at the test university. The admin one is made an admin on first sign-in. */
const TEST_ACCOUNTS = { student: "test.student@levelup-qa.ac.uk", admin: "test.careers@levelup-qa.ac.uk" } as const;

/** Testing phase only (TEST_LOGIN=true): sign straight in as a test account, without an email link. */
export async function testSignIn(formData: FormData) {
  const role = formData.get("admin") === "1" ? "admin" : "student";
  if (isDemoMode()) return startDemo(role);
  if (!featureFlags.testLogin()) redirect("/sign-in");
  const email = TEST_ACCOUNTS[role];
  const admin = supabaseAdmin();
  // Already registered is fine; any other failure shows up in generateLink below.
  await admin.auth.admin.createUser({ email, email_confirm: true });
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties?.hashed_token) {
    const offline = error?.message.includes("fetch failed");
    redirect(`/sign-in?error=${encodeURIComponent(offline ? "Can't reach the database. Check this computer is online, then try again." : `Test sign-in failed: ${error?.message ?? "no link was made"}.`)}`);
  }
  const sb = await createSupabaseServer();
  const { data: session, error: verifyError } = await sb.auth.verifyOtp({ type: "magiclink", token_hash: data.properties.hashed_token });
  if (verifyError || !session.user) redirect(`/sign-in?error=${encodeURIComponent("Test sign-in failed. Try again.")}`);
  await admin.from("profiles").update({ role, last_active_at: new Date().toISOString() }).eq("id", session.user.id);
  redirect("/");
}

export async function signOut() {
  if (isDemoMode()) {
    (await cookies()).delete(DEMO_COOKIE);
  } else {
    const sb = await createSupabaseServer();
    await sb.auth.signOut();
  }
  redirect("/sign-in");
}

const OnboardingSchema = z.object({
  stage: z.enum(["first", "penultimate", "final", "graduate"]),
  sectors: z.array(z.string().min(1).max(60)).min(1).max(3),
  visaSponsorship: z.boolean(),
  deadlineReminders: z.boolean(),
  shareProgress: z.boolean(),
});

export async function completeOnboarding(input: z.infer<typeof OnboardingSchema>): Promise<{ error?: string }> {
  const repo = await getRepo();
  if (!repo) return { error: "Your session has expired. Sign in again." };
  const parsed = OnboardingSchema.safeParse(input);
  if (!parsed.success) return { error: "Pick your stage and between one and three sectors." };
  await repo.updateProfile({ ...parsed.data, stage: parsed.data.stage as Stage, onboarded: true });
  return {};
}

/** Demo only: wipe this visitor's demo data and start again from the seed. */
export async function resetDemo() {
  const session = readDemoSession((await cookies()).get(DEMO_COOKIE)?.value);
  if (isDemoMode() && session) resetDemoUser(`${session.role}-${session.id}`);
  redirect("/onboarding");
}
