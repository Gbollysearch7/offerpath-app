import "server-only";
import { structureCv } from "@/lib/analysis/tailor";
import type { DocBlock } from "@/lib/documents-types";
import type { Repo } from "@/lib/repo/types";
import type { CvReviewPayload, TailorPayload } from "@/lib/types";

// A student's own CV as document blocks, ready to lay out in any template.

/** The latest uploaded CV, with any rewrites the student accepted swapped in. */
export async function myCvBlocks(repo: Repo): Promise<DocBlock[] | null> {
  const cv = await repo.latestReport<CvReviewPayload>("cv_review");
  if (!cv) return null;
  let text = cv.payload.text;
  const lines = cv.payload.analysis.lines;
  for (const l of lines) {
    if (!l.accepted) continue;
    const words = l.text.split(/\s+/).filter(Boolean).map((w) => w.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"));
    if (words.length) text = text.replace(new RegExp(words.join("\\s+")), () => l.accepted!);
  }
  return structureCv(text, lines.map((l) => l.accepted ?? l.text));
}

/** A tailored CV, or null if it has no tailored text yet. */
export async function tailoredCvBlocks(repo: Repo, p: TailorPayload): Promise<DocBlock[] | null> {
  if (!p.tailoredCv) return null;
  const cv = await repo.getReport<CvReviewPayload>(p.cvReportId);
  // Known bullets let the layout spot bullets whose marks the PDF lost.
  const bullets = [...(cv?.payload.analysis.lines.map((l) => l.text) ?? []), ...(p.tailored ?? []).map((t) => t.after)];
  return structureCv(p.tailoredCv, bullets);
}
