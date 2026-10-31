import type { Metadata } from "next";
import { ResultsSidebar } from "@/components/ResultsSidebar";
import { StudentShell, WithSidebar } from "@/components/StudentShell";
import { PageTitle } from "@/components/ui";
import { EXAMPLE_LINES } from "@/lib/content";
import { loadCvReview } from "../../load";
import { ExampleTabs } from "./ExampleTabs";

export const metadata: Metadata = { title: "Example CV lines" };

export default async function ExamplesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile, a } = await loadCvReview(id);
  return (
    <StudentShell profile={profile} active="review">
      <WithSidebar sidebar={<ResultsSidebar reviewId={id} areas={a.areas} active="samples" />}>
        <PageTitle title="Example CV lines" sub="Strong bullet points from typical student experiences. Use them for ideas, then write your own with your real numbers." />
        <ExampleTabs data={EXAMPLE_LINES} />
      </WithSidebar>
    </StudentShell>
  );
}
