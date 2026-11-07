import type { ReactNode } from "react";
import { COVERAGE_MEANING, CREDIT, LEGACY_MATCH_NOTE, WEIGHTS } from "@/lib/analysis/job-match-content";
import { cx, ScoreRing } from "@/components/ui";
import type { EvidenceLevel, JobMatch, JobMatchRequirement, RequirementCategory } from "@/lib/types";

// Client-side code: this may import job-match-content, but not the engine, which needs Node crypto.

const CATEGORY_LABEL: Record<RequirementCategory, string> = { essential: "Essential", desirable: "Desirable", contextual: "Part of the work", uncertain: "Not clear" };
const EVIDENCE_LABEL: Record<EvidenceLevel, string> = { explicit: "Shown in what you did", contextual: "Related, not named", weak: "Named only", none: "No evidence found", not_assessed: "Check yourself" };
const EVIDENCE_TONE: Record<EvidenceLevel, string> = { explicit: "bg-okbg text-brand", contextual: "bg-canvas text-ink-2", weak: "bg-canvas text-ink-2", none: "bg-black text-white", not_assessed: "bg-canvas text-muted" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Requirement({ r, action }: { r: JobMatchRequirement; action?: ReactNode }) {
  return (
    <li className="flex flex-col gap-1.5 border-b border-line py-3.5 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-[15px]">
          {r.label}
          {r.orEquivalent && <span className="text-muted"> (or similar)</span>}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <span className={cx("rounded-full px-2.5 py-1 text-xs", EVIDENCE_TONE[r.evidence.level])}>{EVIDENCE_LABEL[r.evidence.level]}</span>
          {action}
        </span>
      </div>
      <p className="m-0 text-sm text-muted">{r.evidence.note}</p>
      {r.evidence.refs.map((e, i) => (
        <p key={i} className="m-0 text-[13px] text-ink-2">
          <span className="font-mono text-[11px] text-subtle">YOUR CV </span>“{e.quote}”
        </p>
      ))}
      <p className="m-0 text-[13px] text-ink-2">
        <span className="font-mono text-[11px] text-subtle">THE ADVERT </span>“{r.source.quote}”
      </p>
      {(r.category === "contextual" || r.category === "uncertain" || r.method === "ai") && <p className="m-0 text-[13px] text-muted">{r.reason}</p>}
    </li>
  );
}

function Group({ title, intro, items, action }: { title: string; intro?: string; items: JobMatchRequirement[]; action?: (label: string) => ReactNode }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">
        {title.toUpperCase()} · {items.length}
      </h3>
      {intro && <p className="m-0 text-sm text-muted">{intro}</p>}
      <ul className="m-0 list-none p-0">
        {items.map((r) => (
          <Requirement key={r.id} r={r} action={action?.(r.label)} />
        ))}
      </ul>
    </div>
  );
}

export function JobMatchPanel({ match, tailoredScore, requirementAction }: { match: JobMatch; tailoredScore: number | null; requirementAction?: (label: string) => ReactNode }) {
  const { coverage: c } = match;
  const of = (cat: RequirementCategory) => match.requirements.filter((r) => r.category === cat);
  const assessedTotal = c.assessed.essential + c.assessed.desirable;
  return (
    <>
      <section aria-labelledby="cov-h" className="flex flex-wrap items-center gap-6 rounded-3xl bg-white px-[26px] py-6">
        {c.score !== null ? (
          <ScoreRing value={c.score} size={104} stroke={8} color="#36604E" label={`Evidence coverage ${c.score} out of 100`}>
            <span className="text-[32px] leading-none tracking-[-0.04em]">{c.score}</span>
            <span className="mt-[3px] font-mono text-[10px] text-subtle">OF 100</span>
          </ScoreRing>
        ) : (
          <p className="m-0 flex h-[104px] w-[104px] items-center justify-center rounded-full border-2 border-dashed border-edge text-center font-mono text-[11px] text-subtle">NOT SCORED</p>
        )}
        <div className="min-w-0 flex-[1_1_220px]">
          <h2 id="cov-h" className="m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">
            EVIDENCE COVERAGE
          </h2>
          <p className="mt-2.5 mb-0 text-base leading-[1.55]">{c.explanation}</p>
          <p className="mt-2 mb-0 text-sm text-muted">{COVERAGE_MEANING}</p>
          {tailoredScore !== null && <p className="mt-2 mb-0 text-sm">Measured on your tailored CV: {tailoredScore} of 100, with the same requirements. Check each change is true.</p>}
        </div>
        {assessedTotal > 0 && (
          <details className="flex-[1_1_100%] text-sm text-muted">
            <summary className="cursor-pointer">How this was worked out</summary>
            <p className="mt-2 mb-0">
              {plural(assessedTotal, "requirement")} counted: {c.assessed.essential} essential (weight {WEIGHTS.essential}) and {c.assessed.desirable} desirable (weight {WEIGHTS.desirable}); soft skills count half. Evidence earns full credit when shown in what you did, {CREDIT.contextual} when only related, {CREDIT.weak} when only named, and nothing when not found. Your CV earned {c.earned} of {c.possible} weighted points. Saying a skill more often earns nothing extra.
            </p>
            <p className="mt-2 mb-0">
              Not counted: {c.notCounted.contextual} part of the work, {c.notCounted.uncertain} not clear, {c.notCounted.toConfirm} for you to check. These weights are our judgment and haven&apos;t been calibrated against advisers or hiring outcomes. Scoring version {match.version}.
              {match.adapter === "failed" ? " The optional AI reading of the advert wasn't available, so this uses the rules alone." : ""}
            </p>
          </details>
        )}
      </section>

      {match.essentialGaps.length > 0 && (
        <section aria-labelledby="gap-h" className="flex flex-col gap-2 rounded-3xl border-2 border-black bg-white px-[26px] py-5">
          <h2 id="gap-h" className="m-0 text-lg font-normal">
            {plural(match.essentialGaps.length, "essential requirement")} with no evidence
          </h2>
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {match.essentialGaps.map((g) => (
              <li key={g} className="rounded-full bg-black px-3 py-1 text-sm text-white">
                {g}
              </li>
            ))}
          </ul>
          <p className="m-0 text-sm text-muted">The advert asks for these and your CV doesn&apos;t show them, whatever the number above says. That isn&apos;t proof you lack them: if you have them, add a real example.</p>
        </section>
      )}

      {match.toConfirm.length > 0 && (
        <section aria-labelledby="conf-h" className="flex flex-col gap-1.5 rounded-3xl bg-white px-[26px] py-5">
          <h2 id="conf-h" className="m-0 text-base font-normal">
            Check these yourself
          </h2>
          <p className="m-0 text-sm text-muted">The advert requires these, but a CV can&apos;t settle them, so they aren&apos;t in the number: {match.toConfirm.join("; ")}.</p>
        </section>
      )}

      <section aria-labelledby="req-h" className="flex flex-col gap-5 rounded-3xl bg-white px-6 py-[22px]">
        <h2 id="req-h" className="m-0 text-2xl font-normal tracking-[-0.04em]">
          What the advert asks for
        </h2>
        {match.requirements.length === 0 && <p className="m-0 text-sm text-muted">We couldn&apos;t find specific skills, tools or qualifications in this advert.</p>}
        <Group title={CATEGORY_LABEL.essential} items={of("essential")} action={requirementAction} />
        <Group title={CATEGORY_LABEL.desirable} items={of("desirable")} action={requirementAction} />
        <Group title={CATEGORY_LABEL.contextual} intro="Mentioned as part of the job. The advert doesn't say you need these already, so they aren't counted." items={of("contextual")} action={requirementAction} />
        <Group title={CATEGORY_LABEL.uncertain} intro="We can't tell whether these are required, so they aren't counted. Read the advert's wording and decide." items={of("uncertain")} />
        {match.notRequired.length > 0 && (
          <div className="flex flex-col gap-1">
            <h3 className="m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">THE ADVERT SAYS YOU DON&apos;T NEED</h3>
            <ul className="m-0 list-none p-0">
              {match.notRequired.map((n) => (
                <li key={n.source.range?.start ?? n.label} className="py-1.5 text-[15px]">
                  {n.label}
                  <span className="block text-[13px] text-ink-2">“{n.source.quote}”</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </>
  );
}

/** Shown above a report made before versioned job scoring. Its saved numbers stay exactly as they were. */
export function LegacyMatchNote() {
  return (
    <p role="note" className="m-0 rounded-3xl border-2 border-edge bg-white px-[26px] py-5 text-[15px] leading-[1.55]">
      {LEGACY_MATCH_NOTE}
    </p>
  );
}
