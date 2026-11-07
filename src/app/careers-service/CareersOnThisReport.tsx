import Link from "next/link";
import { Eyebrow, fmtDate } from "@/components/ui";
import { guidanceFromView } from "@/lib/institution/guidance";
import { getRepo } from "@/lib/session";

// Beside the automated report, never part of it: nothing here changes the score above, and nothing here is saved on it.
export async function CareersOnThisReport({ reportId }: { reportId: string }) {
  const repo = await getRepo();
  if (!repo) return null;
  const [view, casework] = await Promise.all([repo.myInstitution(), repo.myCasework()]);
  const withdrawn = new Set(casework.disagreements.filter((d) => d.kind === "withdrawal").map((d) => d.withdrawsId));
  const disagreements = casework.disagreements.filter((d) => d.reportId === reportId && d.kind === "disagreement" && !withdrawn.has(d.id));
  const guidance = guidanceFromView(view);
  if (disagreements.length === 0 && !guidance) return null;
  return (
    <section aria-labelledby="careers-h" className="flex flex-col gap-3 rounded-3xl bg-white px-6 py-[22px]">
      <Eyebrow id="careers-h">FROM YOUR CAREERS SERVICE · NOT PART OF YOUR SCORE</Eyebrow>
      {disagreements.map((d) => (
        <div key={d.id} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
          <p className="m-0 text-[15px] font-medium">
            {d.author} sees this differently{d.targetKind === "score" ? " from the automated score" : ` on ${d.judgment.name ?? "part of this report"}`}
          </p>
          <p className="mt-1 mb-0 whitespace-pre-line text-[15px] leading-relaxed">{d.rationale}</p>
          <p className="mt-1 mb-0 text-[13px] text-subtle">
            {fmtDate(d.createdAt)}. The automated result stays on your report as it was: {d.judgment.score ?? "no score"}{d.targetKind === "check" ? " out of 10" : ""}.
          </p>
        </div>
      ))}
      {guidance && (
        <div className="flex flex-col gap-1 border-t border-line pt-3 first:border-t-0 first:pt-0">
          <p className="m-0 text-[15px] font-medium">Support from {guidance.label}</p>
          <ul className="m-0 list-disc pl-5 text-sm leading-relaxed">
            {guidance.notes.map((n) => (
              <li key={n.title}>
                {n.title}
                {n.text && <span className="text-muted"> · {n.text}</span>}
              </li>
            ))}
          </ul>
          <Link href="/careers-service" className="text-sm">
            See everything from your careers service
          </Link>
        </div>
      )}
    </section>
  );
}
