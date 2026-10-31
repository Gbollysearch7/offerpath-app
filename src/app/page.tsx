import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/session";
import { Landing } from "./_landing/Landing";

export const metadata: Metadata = {
  title: { absolute: "Offerpath: CV feedback and careers support for UK universities" },
  description: "Line-by-line CV feedback built for UK graduate recruitment, from first draft to signed offer. Free pilots open for UK universities.",
};

export default async function Home() {
  const profile = await getProfile();
  if (!profile) return <Landing />;
  if (profile.role === "admin") redirect("/admin");
  redirect(profile.onboarded ? "/dashboard" : "/onboarding");
}
