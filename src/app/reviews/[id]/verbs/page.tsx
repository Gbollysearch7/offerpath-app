import type { Metadata } from "next";
import { ResultsSidebar } from "@/components/ResultsSidebar";
import { StudentShell, WithSidebar } from "@/components/StudentShell";
import { findCheck } from "@/lib/analysis/cv";
import { WEAK_VERBS } from "@/lib/analysis/lexicon";
import { VERB_BANK } from "@/lib/content";
import { loadCvReview } from "../../load";
import { VerbBank } from "./VerbBank";

export const metadata: Metadata = { title: "Action verb bank" };

export default async function VerbsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile, a } = await loadCvReview(id);
  const weak = (findCheck(a, "verbs")?.extras ?? []).slice(0, 4).map((w) => ({ from: w.charAt(0).toUpperCase() + w.slice(1), to: WEAK_VERBS[w]?.[0] ?? "Delivered" }));
  return (
    <StudentShell profile={profile} active="review">
      <WithSidebar sidebar={<ResultsSidebar reviewId={id} areas={a.areas} active="verbsbank" />}>
        <VerbBank data={VERB_BANK} weak={weak} />
      </WithSidebar>
    </StudentShell>
  );
}
