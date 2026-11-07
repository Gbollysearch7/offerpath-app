import { Eyebrow, Tag } from "@/components/ui";
import { normaliseText } from "@/lib/analysis/fingerprint";
import { describeChoice, dismissedIds, LANGUAGE_NAMES, splitFindings, type ProofreadingChoice } from "@/lib/analysis/proofreading/choices";
import { CATEGORY_LABELS, CATEGORY_ORDER, evidenceContext, findingsIn, proofreadingHeadline, regionalExplanation, UNRECOGNISED_LABEL, unrecognisedWords } from "@/lib/analysis/proofreading/view";
import type { ProofreadingFinding, ProofreadingReport } from "@/lib/types";
import { FindingChoice, LanguageChoice, PROOFREADING_STATUS_ID } from "./ProofreadingControls";

const MAX_PLACES = 3;
const COVERAGE_TAG = { assessed: "CHECKED", partial: "PARTLY CHECKED", not_assessed: "NOT ASSESSED" } as const;

function Finding({ f, doc, reportId, mode }: { f: ProofreadingFinding; doc: string; reportId: string; mode: "dismiss" | "reopen" }) {
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
      <FindingChoice reportId={reportId} findingId={f.id} word={f.evidence[0]?.quote ?? ""} mode={mode} />
    </li>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

/** The dictionary check, shown beside the variant-list score and never added to it. */
export function ProofreadingPanel({ reportId, report, text, choices }: { reportId: string; report: ProofreadingReport | undefined; text: string; choices: ProofreadingChoice[] }) {
  const doc = normaliseText(text);
  const split = report ? splitFindings(report, dismissedIds(choices, report.documentVersion)) : null;
  const open = split?.open;
  const dismissed = split?.dismissed ?? [];
  return (
    <section aria-labelledby="proofreading" className="flex flex-col gap-3.5 rounded-3xl bg-white px-[26px] py-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <Eyebrow id="proofreading">DICTIONARY CHECK</Eyebrow>
        <Tag tone="grey">NOT PART OF YOUR SCORE</Tag>
      </div>
      <p id={PROOFREADING_STATUS_ID} role="status" tabIndex={-1} className="m-0 text-base leading-relaxed">{proofreadingHeadline(open, dismissed.length)}</p>
      <p className="m-0 text-sm leading-[1.55] text-muted">The score above only compares your CV with a list of UK and US variants. This separate check doesn&apos;t change that score, and we never change your CV for you. Dismissing a suggestion applies to this CV on your account only: it doesn&apos;t change your score or our dictionary.</p>
      {report && <LanguageChoice reportId={reportId} language={report.language} names={LANGUAGE_NAMES} />}
      {report?.status === "partial" && report.limits.map((l) => <p key={l} className="m-0 rounded-2xl bg-mist px-4 py-3 text-sm leading-[1.55] text-body">{l}</p>)}
      {open && open.status !== "unavailable" && CATEGORY_ORDER.map((category) => {
        const findings = findingsIn(open, category);
        const coverage = open.coverage[category];
        const unknown = category === "spelling" ? unrecognisedWords(open) : [];
        return (
          <div key={category} className="border-t border-line pt-3.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="m-0 text-base font-medium">{CATEGORY_LABELS[category]}{findings.length ? ` · ${findings.length}` : ""}</h2>
              <Tag tone="grey">{COVERAGE_TAG[coverage.status]}</Tag>
            </div>
            <p className="mt-1.5 mb-0 text-sm leading-[1.55] text-muted">{coverage.note}</p>
            {category === "regional" && findings.length > 0 && <p className="mt-1.5 mb-0 text-sm leading-[1.55] text-body">{regionalExplanation(open.language)}</p>}
            {findings.length > 0 && <ul className="mt-3 mb-0 list-none p-0">{findings.map((f) => <Finding key={f.id} f={f} doc={doc} reportId={reportId} mode="dismiss" />)}</ul>}
            {unknown.length > 0 && (
              <details className="mt-3">
                <summary className="min-h-11 cursor-pointer py-2 text-[15px]">{UNRECOGNISED_LABEL} · {unknown.length}. Often names or specialist terms, not mistakes.</summary>
                <ul className="mt-1 mb-0 list-none p-0">{unknown.map((f) => <Finding key={f.id} f={f} doc={doc} reportId={reportId} mode="dismiss" />)}</ul>
              </details>
            )}
          </div>
        );
      })}
      {dismissed.length > 0 && (
        <details className="border-t border-line pt-3.5">
          <summary className="min-h-11 cursor-pointer py-2 text-[15px]">Dismissed by you · {dismissed.length}</summary>
          <ul className="mt-1 mb-0 list-none p-0">{dismissed.map((f) => <Finding key={f.id} f={f} doc={doc} reportId={reportId} mode="reopen" />)}</ul>
        </details>
      )}
      {choices.length > 0 && (
        <details className="border-t border-line pt-3.5">
          <summary className="min-h-11 cursor-pointer py-2 text-[15px]">Your choices on this CV · {choices.length}</summary>
          <ol className="mt-1 mb-0 list-none p-0">
            {choices.map((c) => (
              <li key={c.id} className="border-t border-line py-2 text-sm leading-[1.55] break-words text-body">
                <span className="text-muted">{when(c.createdAt)}: </span>
                {describeChoice(c)}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
