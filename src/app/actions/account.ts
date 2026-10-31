"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_COOKIE, getRepo, isDemoMode } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function deleteAccount(formData: FormData): Promise<void> {
  if (formData.get("confirm") !== "DELETE") redirect("/privacy?error=confirm");
  const repo = await getRepo();
  if (!repo) redirect("/sign-in");
  await repo.deleteAccount();
  if (isDemoMode()) (await cookies()).delete(DEMO_COOKIE);
  else await (await createSupabaseServer()).auth.signOut();
  redirect("/sign-in?deleted=1");
}
