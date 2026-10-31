import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireStudent } from "@/lib/session";
import { OnboardingFlow } from "./OnboardingFlow";

export const metadata: Metadata = { title: "Welcome" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { profile } = await requireStudent({ allowNotOnboarded: true });
  if (profile.onboarded && !(await searchParams).edit) redirect("/dashboard");
  return (
    <OnboardingFlow
      firstName={profile.fullName.split(" ")[0] || "there"}
      initial={{
        stage: profile.stage ?? "final",
        sectors: profile.sectors,
        visaSponsorship: profile.visaSponsorship,
        deadlineReminders: profile.deadlineReminders,
        shareProgress: profile.shareProgress,
      }}
    />
  );
}
