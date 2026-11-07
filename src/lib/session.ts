import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { readDemoSession } from "@/lib/demo-session";
import { demoLoginAllowed } from "@/lib/env";
import { demoRepo } from "@/lib/repo/demo";
import { supabaseRepo } from "@/lib/repo/supabase";
import type { Repo } from "@/lib/repo/types";
import { createSupabaseServer, supabaseConfigured } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export { readDemoSession, signDemoSession } from "@/lib/demo-session";

export const DEMO_COOKIE = "op_demo";

export const isDemoMode = () => !supabaseConfigured();

/** Returns the signed-in user's repo, or null when nobody is signed in. */
export const getRepo = cache(async (): Promise<Repo | null> => {
  if (isDemoMode()) {
    // A misconfigured production server has no demo: a demo cookie, even a validly signed one, opens nothing.
    if (!demoLoginAllowed()) return null;
    const session = readDemoSession((await cookies()).get(DEMO_COOKIE)?.value);
    if (!session) return null;
    return demoRepo(`${session.role}-${session.id}`, session.role);
  }
  const sb = await createSupabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  return supabaseRepo(sb, data.user.id);
});

export const getProfile = cache(async (): Promise<Profile | null> => {
  const repo = await getRepo();
  return repo ? repo.profile() : null;
});

/** For student pages: signed in, onboarded. */
export async function requireStudent(opts: { allowNotOnboarded?: boolean } = {}): Promise<{ repo: Repo; profile: Profile }> {
  const repo = await getRepo();
  if (!repo) redirect("/sign-in");
  const profile = await repo.profile();
  if (profile.role === "admin") redirect("/admin");
  if (!profile.onboarded && !opts.allowNotOnboarded) redirect("/onboarding");
  return { repo, profile };
}

export async function requireAdmin(): Promise<{ repo: Repo; profile: Profile }> {
  const repo = await getRepo();
  if (!repo) redirect("/sign-in?admin=1");
  const profile = await repo.profile();
  if (profile.role !== "admin") redirect("/dashboard");
  return { repo, profile };
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
}
