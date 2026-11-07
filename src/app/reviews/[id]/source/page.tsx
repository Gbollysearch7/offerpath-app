import type { Metadata } from "next";
import Link from "next/link";
import { CorrectionPanel } from "@/app/upload/SourceEditor";
import { ResultsSidebar } from "@/components/ResultsSidebar";
import { StudentShell, WithSidebar } from "@/components/StudentShell";
import { btn, cx, Eyebrow, fmtShort, PageTitle } from "@/components/ui";
import { contentBlocks } from "@/lib/analysis/content";
import { lineage, SOURCE_KIND_LABEL } from "@/lib/sources";
import type { CvSource } from "@/lib/types";
import { loadCvReview } from "../../load";

export const metadata: Metadata = { title: "Source document" };

// Which text this report scored, every version of the document it belongs to, and the original file (OP-006).
// Everything shown comes from the signed-in student's own rows: `loadCvReview` and `listSources` are scoped to them.

const CONFIDENCE_NOTE = { high: "The text should match the file closely.", medium: "Some of the text may differ from the file.", low: "The text may be quite different from the file." } as const;
// Typed or corrected text was not read from a file: its confidence only says how well sections and bullets were found.
const TEXT_CONFIDENCE_NOTE = { high: "Sections and bullet points were found in this text as expected.", medium: "Some sections or bullet points weren't recognised in this text.", low: "Few sections or bullet points were recognised in this text." } as const;

function VersionStatus({ v, currentId }: { v: CvSource; currentId: string }) {
  if (v.id === currentId) return <span className="rounded-full bg-black px-2.5 py-1 font-mono text-[11px] text-white">THIS REPORT</span>;
  if (v.reportId) {
    return (
      <Link href={`/reviews/${v.reportId}`} className="rounded-full bg-canvas px-2.5 py-1 font-mono text-[11px] text-black no-underline hover:bg-mist">
        SCORED · SEE REPORT
      </Link>
    );
  }
  if (v.outcome) return <span className="rounded-full bg-canvas px-2.5 py-1 font-mono text-[11px] text-muted">NOT READABLE</span>;
  return <span className="rounded-full bg-canvas px-2.5 py-1 font-mono text-[11px] text-muted">NOT SCORED</span>;
}

export default async function SourcePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ correct?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { repo, profile, report, a } = await loadCvReview(id);
  const { payload } = report;
  const sourceId = report.row.sourceId ?? null;
  const versions = sourceId ? lineage(await repo.listSources(), sourceId) : [];
  const current = versions.find((v) => v.id === sourceId) ?? null;
  const original = versions.find((v) => v.hasFile) ?? null;
  const doc = payload.document;
  const correcting = sp.correct === "1" && !!current?.document;
  const n = current ? versions.indexOf(current) + 1 : 0;

  return (
    <StudentShell profile={profile} active="review">
      <WithSidebar sidebar={<ResultsSidebar reviewId={id} areas={a.areas} active="source" />}>
        <PageTitle
          title="Source document"
          sub="The text this report scored, where it came from, and every version of it."
          actions={
            current?.document && !correcting ? (
              <Link href={`/reviews/${id}/source?correct=1`} className={btn.primary}>
                Correct this text
              </Link>
            ) : undefined
          }
        />

        <section aria-labelledby="scored-h" className="flex flex-col gap-3 rounded-3xl bg-white px-6 py-[22px]">
          <Eyebrow id="scored-h">WHAT THIS REPORT SCORED</Eyebrow>
          {doc ? (
            <>
              <p className="m-0 text-[22px] tracking-[-0.03em]">
                {SOURCE_KIND_LABEL[doc.source.kind]}
                {n > 0 && <span className="text-muted"> · version {n} of {versions.length}</span>}
              </p>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm leading-[1.55] text-body">
                <li>
                  <span className="font-medium text-black">File.</span> {payload.fileName}, reviewed {fmtShort(report.row.createdAt)}.
                </li>
                <li>
                  <span className="font-medium text-black">Pages.</span>{" "}
                  {doc.extraction.pages.measured !== null ? `${doc.extraction.pages.measured}, counted in the PDF.` : `About ${doc.extraction.pages.estimated}, estimated from the word count${doc.source.kind === "upload" ? " (a Word file has no pages until it is opened)" : " (typed or corrected text has no pages)"}.`}
                </li>
                <li>
                  <span className="font-medium text-black">Reading confidence {doc.extraction.confidence.score.toFixed(2)}, {doc.extraction.confidence.band}.</span> {(doc.source.kind === "upload" ? CONFIDENCE_NOTE : TEXT_CONFIDENCE_NOTE)[doc.extraction.confidence.band]}
                  {doc.extraction.warnings.length ? ` ${doc.extraction.warnings.length} ${doc.extraction.warnings.length === 1 ? "thing was" : "things were"} noticed when it was read.` : " Nothing was flagged when it was read."}
                </li>
                {doc.source.kind === "correction" && (
                  <li>
                    <span className="font-medium text-black">Corrected</span> by you on {fmtShort(doc.source.correctedAt)}: {doc.source.changes.length} {doc.source.changes.length === 1 ? "line" : "lines"} changed from the version it was made from.
                  </li>
                )}
                {doc.source.kind === "paste" && (
                  <li>
                    <span className="font-medium text-black">Typed or pasted</span> by you on {fmtShort(doc.source.pastedAt)}
                    {doc.source.original ? `, after ${doc.source.original.fileName} could not be read${doc.source.original.outcome ? ` (${doc.source.original.outcome.message.replace(/\.$/, "").toLowerCase()})` : ""}.` : "."}
                  </li>
                )}
                <li className="font-mono text-[11px] text-subtle">version {payload.assessment.documentVersion.slice(0, 16)} · read by {doc.extraction.extractor} · parsed by {doc.extraction.parser}</li>
              </ul>
              {doc.extraction.warnings.length > 0 && (
                <ul className="m-0 list-none border-t border-line p-0 pt-3">
                  {doc.extraction.warnings.map((w) => (
                    <li key={w.code} className="flex flex-wrap items-baseline gap-2 py-1 text-sm">
                      <span className={cx("rounded-full px-[9px] py-0.5 font-mono text-[11px]", w.severity === "caution" ? "bg-black text-white" : "bg-canvas text-muted")}>{w.severity === "caution" ? "CHECK" : "NOTE"}</span>
                      <span className="text-body">{w.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="m-0 text-sm leading-[1.55] text-body">This report was saved before Offerpath kept document versions, so how its text was read was not recorded. The text it scored is below.</p>
          )}
          <details className="rounded-2xl bg-canvas px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium">Show the text that was scored</summary>
            <pre className="m-0 mt-3 max-h-[480px] overflow-auto whitespace-pre-wrap font-sans text-[13px] leading-[1.55] text-body">{payload.text}</pre>
          </details>
        </section>

        {correcting && current?.document && (
          <section aria-labelledby="correct-h" className="flex flex-col gap-4 rounded-3xl bg-white px-6 py-[22px]">
            <Eyebrow id="correct-h">CORRECT THE TEXT</Eyebrow>
            <CorrectionPanel sourceId={current.id} blocks={contentBlocks(current.text)} sector={payload.sector} stage={payload.stage} scoreAsIs={false} cancelHref={`/reviews/${id}/source`} />
          </section>
        )}

        {versions.length > 0 && (
          <section aria-labelledby="versions-h" className="flex flex-col gap-3 rounded-3xl bg-white px-6 py-[22px]">
            <Eyebrow id="versions-h">VERSIONS</Eyebrow>
            <ol className="m-0 flex list-none flex-col p-0">
              {versions.map((v, i) => (
                <li key={v.id} className={cx("flex flex-col gap-2 py-3", i > 0 && "border-t border-line")}>
                  <div className="flex flex-wrap items-center gap-2.5 text-sm">
                    <span className="font-mono text-xs text-subtle">V{i + 1}</span>
                    <span className="font-medium">{SOURCE_KIND_LABEL[v.kind]}</span>
                    <span className="text-muted">{v.fileName}</span>
                    <span className="text-subtle">{fmtShort(v.createdAt)}</span>
                    <VersionStatus v={v} currentId={sourceId ?? ""} />
                  </div>
                  {v.outcome && <p className="m-0 text-sm text-body">{v.outcome.message} The file is kept as you uploaded it; the text came from you.</p>}
                  {v.document?.source.kind === "correction" && (
                    <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
                      {v.document.source.changes.slice(0, 40).map((c) => (
                        <li key={c.block} className="rounded-xl bg-canvas px-3 py-2">
                          <span className="block font-mono text-[11px] text-subtle">{c.where}</span>
                          <span className="block text-muted line-through decoration-muted/60">{c.before}</span>
                          <span className="block text-black">{c.after || <em>removed</em>}</span>
                        </li>
                      ))}
                      {v.document.source.changes.length > 40 && <li className="text-subtle">and {v.document.source.changes.length - 40} more</li>}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        <section aria-labelledby="orig-h" className="flex flex-col gap-3 rounded-3xl bg-white px-6 py-[22px]">
          <Eyebrow id="orig-h">YOUR ORIGINAL FILE</Eyebrow>
          {original ? (
            <>
              <p className="m-0 text-sm leading-[1.55] text-body">
                {original.fileName}, uploaded {fmtShort(original.createdAt)}. It is kept exactly as you uploaded it; corrections never change it.
              </p>
              <div className="flex flex-wrap gap-2.5">
                <a href={`/reviews/${id}/source/file`} download className={btn.secondary}>
                  Download {original.fileName}
                </a>
              </div>
              {original.text && original.id !== sourceId && (
                <details className="rounded-2xl bg-canvas px-4 py-3 text-sm">
                  <summary className="cursor-pointer font-medium">Show the text as it was read from the file</summary>
                  <pre className="m-0 mt-3 max-h-[480px] overflow-auto whitespace-pre-wrap font-sans text-[13px] leading-[1.55] text-body">{original.text}</pre>
                </details>
              )}
            </>
          ) : (
            <p className="m-0 text-sm leading-[1.55] text-body">{sourceId ? "This version was typed or pasted; there is no file behind it." : "No file is kept for this report."}</p>
          )}
        </section>
      </WithSidebar>
    </StudentShell>
  );
}
