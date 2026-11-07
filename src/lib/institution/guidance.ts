import type { InstitutionalGuidance } from "@/lib/types";
import type { InstitutionView } from "./types";

// OP-010 left `CvReviewPayload.institutionalGuidance` with no writer. It still has none, on purpose: a stored report is a
// historical record and guidance changes, so copying it in would either go stale or mean rewriting reports. The same
// shape is built here at read time and passed to the page, beside the analysis, and is never saved.
export function guidanceFromView(view: InstitutionView | null): InstitutionalGuidance | null {
  if (!view || view.resources.length === 0) return null;
  return {
    kind: "institutional_guidance",
    label: view.brandName || view.universityName,
    institutionId: view.universityId,
    version: view.updatedAt ?? "current",
    notes: view.resources.slice(0, 3).map((r) => ({ title: r.title, text: r.description })),
  };
}
