import type { Metadata } from "next";
import Link from "next/link";
import { StudentShell } from "@/components/StudentShell";
import { Tick } from "@/components/ui";
import { SECTORS, STAGES } from "@/lib/analysis/lexicon";
import { requireStudent } from "@/lib/session";
import { UploadForm } from "./UploadForm";

// Server actions on this page can call Claude; allow up to 60 seconds.
export const maxDuration = 60;

export const metadata: Metadata = { title: "Upload your CV" };

const GUIDES = ["Text you can select, not a scan or photo", "Just your CV, no cover letter or extra pages", "Not password protected", "Written in English", "Up to 2 MB"];

export default async function UploadPage() {
  const { profile } = await requireStudent();
  const defaultSector = profile.sectors.find((s) => (SECTORS as readonly string[]).includes(s)) ?? SECTORS[0];
  const stageMap: Record<string, string> = { first: STAGES[2], penultimate: STAGES[1], final: STAGES[0], graduate: STAGES[0] };
  const defaultStage = stageMap[profile.stage ?? "final"];
  return (
    <StudentShell profile={profile} active="review">
      <UploadForm
        sectors={[...SECTORS]}
        stages={[...STAGES]}
        defaultSector={defaultSector}
        defaultStage={defaultStage}
        aside={
          <aside aria-labelledby="gl-h" className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
            <section className="rounded-[28px] bg-white px-[26px] py-6">
              <h2 id="gl-h" className="mt-0 mb-3.5 font-mono text-xs font-normal tracking-[0.04em] text-subtle">
                BEFORE YOU UPLOAD
              </h2>
              <ul className="m-0 flex list-none flex-col gap-3 p-0 text-[15px] leading-[1.45]">
                {GUIDES.map((g) => (
                  <li key={g} className="flex gap-2.5">
                    <Tick />
                    {g}
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-[28px] bg-mist px-6 py-[22px]">
              <p className="m-0 text-base font-medium">Your data, your call</p>
              <p className="mt-1.5 mb-0 text-sm leading-[1.55] text-body">
                Your CV is stored in the UK or EU and only used to give you feedback. Your adviser can&apos;t see it unless you choose to share it. You can <Link href="/privacy">delete it any time</Link>.
              </p>
            </section>
          </aside>
        }
      />
    </StudentShell>
  );
}
