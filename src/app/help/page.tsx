import type { Metadata } from "next";
import Link from "next/link";
import { StudentShell } from "@/components/StudentShell";
import { requireStudent } from "@/lib/session";

export const metadata: Metadata = { title: "Help" };

const FAQ = [
  ["How is my Readiness Score worked out?", "We check your CV against 16 checks. Five areas make up the score: impact, clarity, structure and readability, UK spelling and consistency, and length and formatting. Each check is out of 10 and each area out of 100, and we weight impact and length most. Sector fit, how well your CV matches the sector you pick, is shown separately and never changes your score. The same CV gets the same score under the same scoring version, and your report tells you when that version has changed since your last upload."],
  ["Do I need to get 100?", "No. A score of 75 or more is strong. Take the advice that fits the roles you want and ignore the rest. If you think a score is wrong, talk to your careers adviser."],
  ["Will the rewrites make things up?", "They can make mistakes. We compare each suggestion with the entry it came from: figures, dates, names, tools, qualifications and words that raise your level of responsibility. We leave out or ask you about what doesn't match, but this is an automatic check and it can miss things, especially new details in plain words. Read each suggestion before you use it: check figures, responsibilities and outcomes, and replace any [placeholder] with information you can support."],
  ["What doesn't Offerpath check?", "More than you might expect, and we'd rather say so. The spelling check in your score compares your CV against a short list of UK/US variants. New reports also run a separate dictionary check, which doesn't change your score and can't spot a real word used wrongly. Nothing checks grammar or tense: writing consistency covers repeated words, bullet capitals and bullet endings only. Your page count is estimated from your word count. We read the text extracted from your file, so we can't see your layout or test an employer's screening software. Proofread your CV yourself and ask your careers adviser to read it."],
  ["Why can't my file be read?", "Scanned or photographed CVs don't contain text we can read. Export your CV from Word or Google Docs as a PDF, keep it under 2 MB, and remove any password."],
  ["Who can see my CV?", "Only you, unless you choose to let your careers adviser view it under Privacy and my data (an option your university may not have switched on yet). If you share your progress, your careers service can see your scores and activity next to your student number, but not your CV. Reports they export leave out any group smaller than five."],
];

export default async function HelpPage() {
  const { profile } = await requireStudent();
  return (
    <StudentShell profile={profile} active="dashboard">
      <main id="main" className="mx-auto flex max-w-[960px] flex-col gap-5 px-4 pt-10 pb-16 sm:px-7">
        <h1 className="m-0 text-[34px] font-normal leading-[1.1] tracking-[-1.5px] sm:text-[44px] sm:tracking-[-1.98px]">Help</h1>
        <section className="rounded-3xl bg-white px-[26px] py-3">
          {FAQ.map(([q, a], i) => (
            <details key={q} className={i < FAQ.length - 1 ? "border-b border-line py-4" : "py-4"}>
              <summary className="cursor-pointer text-base">{q}</summary>
              <p className="mt-2.5 mb-0 text-[15px] leading-relaxed text-body">{a}</p>
            </details>
          ))}
        </section>
        <p className="m-0 text-sm text-muted">
          Still stuck? Contact your university careers service, or see <Link href="/privacy">Privacy and my data</Link>.
        </p>
      </main>
    </StudentShell>
  );
}
