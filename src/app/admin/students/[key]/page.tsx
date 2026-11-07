import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";
import { Bar, Eyebrow, fmtDate } from "@/components/ui";
import { AREA_LABELS, bandLabel } from "@/lib/analysis/labels";
import { featureFlags } from "@/lib/env";
import { requireAdmin } from "@/lib/session";
import { NoteForm } from "./NoteForm";

export const metadata: Metadata = { title: "Student" };

export default async function StudentDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const { repo, profile } = await requireAdmin();
  const [uni, s] = await Promise.all([repo.adminUniversity(), repo.adminStudentDetail(key)]);
  if (!s) notFound();
  const latest = s.reports[0];
  const cvFeature = featureFlags.adviserCvAccess();
  return (
    <AdminShell profile={profile} university={uni.name} active="students" title={`Student ${s.studentNumber}`} intro={[s.course, s.year, s.faculty, s.feeStatus].filter(Boolean).join(" · ") || "No course details yet"}>
      <Link href="/admin/students" className="text-sm">
        Back to students
      </Link>
      <div className="flex flex-wrap items-start gap-5">
        <section aria-labelledby="sc-h" className="flex min-w-0 flex-[1_1_380px] flex-col gap-3 rounded-3xl bg-white px-6 py-[22px]">
          <Eyebrow id="sc-h">LATEST READINESS SCORE</Eyebrow>
          {latest ? (
            <>
              <p className="m-0 text-[44px] leading-none tracking-[-0.05em]">
                {latest.score ?? "–"} <span className="text-base tracking-normal text-brand">{latest.score != null && bandLabel(latest.score)}</span>
              </p>
              <p className="m-0 text-sm text-muted">
                {latest.title} · {fmtDate(latest.createdAt)}
              </p>
              {latest.areas?.map((a) => (
                <div key={a.key} className="grid grid-cols-[minmax(0,1fr)_120px_30px] items-center gap-3 text-sm">
                  {/* Current area name by key; the saved name is the fallback for a key this build doesn't know. */}
                  <span>{a.key in AREA_LABELS ? AREA_LABELS[a.key as keyof typeof AREA_LABELS] : a.name}</span>
                  <Bar pct={a.score} color={a.score >= 75 ? "#36604E" : "#8FB3A1"} />
                  <span className="text-right font-mono">{a.score}</span>
                </div>
              ))}
            </>
          ) : (
            <p className="m-0 text-sm text-muted">No CV reviewed yet.</p>
          )}
        </section>
        <section aria-labelledby="hist-h" className="flex min-w-0 flex-[1_1_320px] flex-col gap-2 rounded-3xl bg-white px-6 py-[22px]">
          <Eyebrow id="hist-h">CV REVIEWS</Eyebrow>
          {s.reports.length === 0 && <p className="m-0 text-sm text-muted">None yet.</p>}
          {s.reports.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 border-t border-line py-2.5 text-sm">
              <span className="flex-1">
                {r.title} <span className="text-subtle">· {fmtDate(r.createdAt)}</span>
              </span>
              <span className="font-mono">{r.score ?? "–"}</span>
              {cvFeature && r.hasFile && (
                <a href={`/admin/students/${s.key}/cv/${r.id}`} className="inline-flex min-h-9 items-center rounded-full border border-edge px-3 text-[13px] text-black no-underline hover:text-black">
                  Open CV
                </a>
              )}
            </div>
          ))}
          <p className="m-0 pt-2 text-[13px] text-subtle">
            {!cvFeature ? "Opening student CVs isn't switched on for your university yet." : s.cvSharing ? "This student has chosen to let advisers open their CV. Each opening is logged." : "This student hasn't chosen to share their CV with advisers."}
          </p>
        </section>
      </div>
      <section aria-labelledby="notes-h" className="flex flex-col gap-3 rounded-3xl bg-white px-6 py-[22px]">
        <Eyebrow id="notes-h">ADVISER NOTES · VISIBLE TO THE STUDENT</Eyebrow>
        {latest ? <NoteForm reportId={latest.id} studentKey={s.key} /> : <p className="m-0 text-sm text-muted">Notes can be added once the student has reviewed a CV.</p>}
        {s.notes.map((n) => (
          <div key={n.id} className="border-t border-line pt-3">
            <p className="m-0 whitespace-pre-line text-[15px] leading-relaxed">{n.note}</p>
            <p className="mt-1 mb-0 text-[13px] text-subtle">
              {n.author} · {fmtDate(n.createdAt)}
            </p>
          </div>
        ))}
      </section>
    </AdminShell>
  );
}
