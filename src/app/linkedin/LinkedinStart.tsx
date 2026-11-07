"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createLinkedinReview } from "@/app/actions/linkedin";
import { useAttemptKey } from "@/app/upload/SourceEditor";
import { announce } from "@/components/a11y";
import { FormError } from "@/components/client";
import { btn, Card, cx, Eyebrow, PageTitle, pill } from "@/components/ui";
import { LINKEDIN_SECTION_LABEL, LINKEDIN_SECTIONS, type LinkedinSectionKey } from "@/lib/linkedin-types";

const field = "w-full rounded-[14px] border border-edge bg-white px-3.5 py-3 text-[15px] font-normal text-black";

const HINTS: Record<LinkedinSectionKey, string> = {
  headline: "The line under your name.",
  about: "Your summary, in full.",
  experience: "Each role on its own line with the organisation and dates, then what you did underneath.",
  education: "University, course and dates.",
  skills: "Separated by commas or on separate lines.",
  other: "Optional: certifications, projects, volunteering, awards or languages.",
};
const ROWS: Record<LinkedinSectionKey, number> = { headline: 2, about: 6, experience: 8, education: 3, skills: 3, other: 4 };

export function LinkedinStart({ cvs }: { cvs: { id: string; label: string }[] }) {
  const router = useRouter();
  const attempt = useAttemptKey();
  const [method, setMethod] = useState<"paste" | "export">("paste");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (fd: FormData) =>
    start(async () => {
      setError(null);
      fd.set("method", method);
      fd.set("key", attempt.key(`linkedin:${method}`));
      announce("Reading your profile.");
      const out = await createLinkedinReview(fd);
      if (out.id) router.push(`/linkedin/${out.id}`);
      else setError(out.error ?? "Something went wrong. Try again.");
    });

  return (
    <main id="main" className="mx-auto flex max-w-[960px] flex-col gap-5 px-4 pt-6 pb-14 sm:px-7">
      <PageTitle title="LinkedIn review" sub="Section-by-section feedback on your profile text, checked against what you tell us." />

      <Card className="flex flex-col gap-3 px-5 py-5 sm:px-6">
        <Eyebrow>WHAT WE CAN READ</Eyebrow>
        <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-body">
          <li>Text you paste below, one section at a time. A partial profile is fine, and so is an empty one if you choose a CV to start from.</li>
          <li>The CSV files from a data export you requested from LinkedIn yourself, as the ZIP or as separate files. We only read your profile files, and we don&apos;t keep the upload.</li>
          <li>A link isn&apos;t enough. We don&apos;t open profile links, and we never ask for your LinkedIn password.</li>
          <li>We don&apos;t look at or score photographs, appearance or personal traits.</li>
        </ul>
      </Card>

      {/* Not `action=`: React clears a form after its action runs, which would lose a whole pasted profile on any error. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(new FormData(e.currentTarget));
        }}
        className="flex flex-col gap-5"
      >
        <Card className="flex flex-col gap-4 px-5 py-5 sm:px-6">
          <div>
            <label htmlFor="li-aim" className="text-sm font-medium">
              What are you aiming for? <span className="font-normal text-muted">(optional)</span>
            </label>
            <p id="li-aim-hint" className="mt-1 mb-2 text-sm text-muted">
              For example, graduate data analyst roles. We treat this as what you want, never as a job you hold.
            </p>
            <input id="li-aim" name="aim" maxLength={160} aria-describedby="li-aim-hint" className={field} />
          </div>
          <div>
            <label htmlFor="li-cv" className="text-sm font-medium">
              Compare with a CV <span className="font-normal text-muted">(optional)</span>
            </label>
            <p id="li-cv-hint" className="mt-1 mb-2 text-sm text-muted">
              Suggestions can draw on it, and we&apos;ll point out where the two differ as guidance.
            </p>
            <select id="li-cv" name="cvReportId" defaultValue="none" aria-describedby="li-cv-hint" className={cx(field, "min-h-[50px]")}>
              <option value="none">Don&apos;t compare with a CV</option>
              {cvs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </Card>

        <Card className="flex flex-col gap-4 px-5 py-5 sm:px-6">
          <div role="group" aria-label="How to add your profile" className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={method === "paste"} onClick={() => setMethod("paste")} className={pill(method === "paste")}>
              Paste sections
            </button>
            <button type="button" aria-pressed={method === "export"} onClick={() => setMethod("export")} className={pill(method === "export")}>
              Upload export
            </button>
          </div>

          {method === "paste" ? (
            LINKEDIN_SECTIONS.map((k) => (
              <div key={k}>
                <label htmlFor={`li-${k}`} className="text-sm font-medium">
                  {LINKEDIN_SECTION_LABEL[k]}
                </label>
                <p id={`li-${k}-hint`} className="mt-1 mb-2 text-sm text-muted">
                  {HINTS[k]}
                </p>
                <textarea id={`li-${k}`} name={k} rows={ROWS[k]} aria-describedby={`li-${k}-hint`} className={field} />
              </div>
            ))
          ) : (
            <div>
              <label htmlFor="li-files" className="text-sm font-medium">
                Your LinkedIn export
              </label>
              <p id="li-files-hint" className="mt-1 mb-2 text-sm leading-relaxed text-muted">
                A ZIP or CSV files, up to 2 MB in total. We read Profile, Positions, Education, Skills, Certifications, Projects, Volunteering, Honors and Languages. From Profile we read only your headline and summary. A full archive may be too large: if so, upload those files on their own. Profile PDFs aren&apos;t supported, so paste those sections instead.
              </p>
              <input id="li-files" name="files" type="file" multiple accept=".zip,.csv" aria-describedby="li-files-hint" className="block w-full text-sm" />
            </div>
          )}
        </Card>

        <FormError message={error} />
        <div>
          <button type="submit" disabled={pending} className={btn.primary}>
            {pending ? "Reading your profile..." : "Review my profile"}
          </button>
        </div>
      </form>
    </main>
  );
}
