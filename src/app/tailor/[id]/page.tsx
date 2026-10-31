import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StudentShell } from "@/components/StudentShell";
import { fmtShort } from "@/components/ui";
import { requireStudent } from "@/lib/session";
import type { TailorPayload } from "@/lib/types";
import { TailorView } from "./TailorView";

// Server actions on this page can call Claude; allow up to 60 seconds.
export const maxDuration = 60;

export const metadata: Metadata = { title: "Tailor to a job" };

export default async function TailorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ auto?: string }> }) {
  const { id } = await params;
  const auto = (await searchParams).auto === "1";
  const { repo, profile } = await requireStudent();
  const r = await repo.getReport<TailorPayload>(id);
  if (!r || r.row.type !== "tailor") notFound();
  const p = r.payload;
  return (
    <StudentShell profile={profile} active="tailor">
      <TailorView id={id} p={p} auto={auto && !p.tailored} subtitle={`Compared with ${p.cvFileName}${p.deadline ? ` · deadline ${fmtShort(p.deadline)}` : ""}`} />
    </StudentShell>
  );
}
