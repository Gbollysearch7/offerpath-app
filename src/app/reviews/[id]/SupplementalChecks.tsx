import { Eyebrow, Tag } from "@/components/ui";
import { supplementalRows } from "@/lib/analysis/supplemental";
import type { Assessment } from "@/lib/types";

/** The supplemental checks on the report overview. Nothing here counts towards the score, and the section says so. */
export function SupplementalChecks({ assessment }: { assessment: Pick<Assessment, "findings"> }) {
  const rows = supplementalRows(assessment);
  return (
    <section id="supplemental" aria-labelledby="sup-h" className="flex flex-col gap-4 rounded-3xl bg-white px-[26px] py-6" data-supplemental-checks>
      <div>
        <Eyebrow id="sup-h">MORE WRITING CHECKS</Eyebrow>
        <p className="mt-2 mb-0 text-sm leading-normal text-muted">Dates, pronouns and consistency. These are guidance only: they aren&apos;t counted in your score, and no adviser has validated them yet.</p>
      </div>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {rows.map((r) => (
          <li key={r.key} className="rounded-2xl border border-line px-4 py-3.5" data-supplemental={r.key} data-status={r.status}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 text-[15px] font-normal">{r.label}</h3>
              <Tag tone={r.status === "passed" ? "green" : "grey"}>{r.statusLabel.toUpperCase()}</Tag>
            </div>
            <p className="mt-1.5 mb-0 text-sm leading-normal text-body">{r.explanation}</p>
            {r.action && <p className="mt-1.5 mb-0 text-sm leading-normal text-body">{r.action}</p>}
            {r.quotes.length > 0 && (
              <ul className="mt-2.5 mb-0 flex list-none flex-col gap-1 p-0" aria-label="Lines from your CV">
                {r.quotes.map((q, i) => (
                  <li key={i} className="rounded-xl bg-canvas px-3 py-2 text-[13px] leading-snug break-words text-body">
                    {q}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
