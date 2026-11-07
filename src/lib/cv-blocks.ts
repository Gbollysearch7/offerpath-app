import "server-only";
import { structureCv, withSavedLines } from "@/lib/analysis/tailor";
import { baseDocument } from "@/lib/analysis/tailor-edits";
import type { DocBlock } from "@/lib/documents-types";
import type { Repo } from "@/lib/repo/types";
import type { CvReviewPayload, TailorPayload } from "@/lib/types";

// A student's own CV as document blocks, ready to lay out in any template.

/** The latest uploaded CV, with any rewrites the student accepted swapped in. */
export async function myCvBlocks(repo: Repo): Promise<DocBlock[] | null> {
  const cv = await repo.latestReport<CvReviewPayload>("cv_review");
  if (!cv) return null;
  const lines = cv.payload.analysis.lines;
  const text = withSavedLines(cv.payload.text, lines);
  return structureCv(text, lines.map((l) => l.accepted ?? l.text));
}

/** One of the student's CVs, or the latest, with the version a download of it holds (OP-019). Null if it isn't theirs. */
export async function myCvDownload(repo: Repo, reportId: string | null): Promise<{ blocks: DocBlock[]; reportId: string; documentVersion: string } | null> {
  const cv = reportId ? await repo.getReport<CvReviewPayload>(reportId) : await repo.latestReport<CvReviewPayload>("cv_review");
  if (!cv || cv.row.type !== "cv_review") return null;
  const lines = cv.payload.analysis.lines;
  return { blocks: structureCv(withSavedLines(cv.payload.text, lines), lines.map((l) => l.accepted ?? l.text)), reportId: cv.row.id, documentVersion: baseDocument(cv.payload).version };
}

/** A tailored CV's text as document blocks. The caller says which text: the route uses `tailoredExport`, which picks the version. */
export async function tailoredCvBlocks(repo: Repo, p: TailorPayload, text: string): Promise<DocBlock[]> {
  const cv = await repo.getReport<CvReviewPayload>(p.cvReportId);
  // Known bullets let the layout spot bullets whose marks the PDF lost.
  const kept = p.edits ? p.edits.versions.flatMap((v) => Object.values(v.decisions).flatMap((d) => (d.text ? [d.text] : []))) : [];
  const bullets = [...(cv?.payload.analysis.lines.map((l) => l.text) ?? []), ...(p.tailored ?? []).map((t) => t.after), ...kept];
  return structureCv(text, bullets);
}
