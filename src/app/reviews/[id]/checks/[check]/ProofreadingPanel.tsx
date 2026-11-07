import { Eyebrow, Tag } from "@/components/ui";
import { normaliseText } from "@/lib/analysis/fingerprint";
import { CATEGORY_LABELS, CATEGORY_ORDER, evidenceContext, findingsIn, proofreadingHeadline } from "@/lib/analysis/proofreading/view";
import type { ProofreadingFinding, ProofreadingReport } from "@/lib/types";

const MAX_PLACES = 3;
const COVERAGE_TAG = { assessed: "CHECKED", partial: "PARTLY CHECKED", not_assessed: "NOT ASSESSED" } as const;

function Finding({ f, doc }: { f: ProofreadingFinding; doc: string }) {
  const places = f.evidence.filter((e) => e.range);
  return (
    <li className="border-t border-line py-3.5">
      {places.slice(0, MAX_PLACES).map((e) => {
        const c = evidenceContext(doc, e.range!);
        return (
          <p key={e.range!.start} className="mt-0 mb-1.5 text-[15px] leading-normal break-words">
            {c.before}
            <mark className="rounded bg-mist px-1 font-medium text-black">{c.match}</mark>
            {c.after}
          </p>
        );
      })}
      {places.length > MAX_PLACES && <p className="mt-0 mb-1.5 text-sm text-muted">And {places.length - MAX_PLACES} more {places.length - MAX_PLACES === 1 ? "place" : "places"}.</p>}
      <p className="mt-1.5 mb-0 text-sm leading-[1.55] text-body">{f.explanation}</p>
      {f.action && <p className="mt-1 mb-0 text-sm leading-[1.55] text-body">{f.action}</p>}
    </li>
  );
}

/** The dictionary check, shown beside the variant-list score and never added to it. */
export function ProofreadingPanel({ report, text }: { report: ProofreadingReport | undefined; text: string }) {
  const doc = normaliseText(text);
  return (
    <section aria-labelledby="proofreading" className="flex flex-col gap-3.5 rounded-3xl bg-white px-[26px] py-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <Eyebrow id="proofreading">DICTIONARY CHECK</Eyebrow>
        <Tag tone="grey">NOT PART OF YOUR SCORE</Tag>
      </div>
      <p className="m-0 text-base leading-relaxed">{proofreadingHeadline(report)}</p>
      <p className="m-0 text-sm leading-[1.55] text-muted">The score above only compares your CV with a list of UK and US variants. This separate check doesn&apos;t change that score, and we never change your CV for you.</p>
      {report?.status === "partial" && report.limits.map((l) => <p key={l} className="m-0 rounded-2xl bg-mist px-4 py-3 text-sm leading-[1.55] text-body">{l}</p>)}
      {report && report.status !== "unavailable" && CATEGORY_ORDER.map((category) => {
        const findings = findingsIn(report, category);
        const coverage = report.coverage[category];
        return (
          <div key={category} className="border-t border-line pt-3.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="m-0 text-base font-medium">{CATEGORY_LABELS[category]}{findings.length ? ` · ${findings.length}` : ""}</h2>
              <Tag tone="grey">{COVERAGE_TAG[coverage.status]}</Tag>
            </div>
            <p className="mt-1.5 mb-0 text-sm leading-[1.55] text-muted">{coverage.note}</p>
            {findings.length > 0 && <ul className="mt-3 mb-0 list-none p-0">{findings.map((f) => <Finding key={f.id} f={f} doc={doc} />)}</ul>}
          </div>
        );
      })}
    </section>
  );
}
