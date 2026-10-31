import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { requireStudent } from "@/lib/session";
import type { CvReviewPayload } from "@/lib/types";

export const loadCvReview = cache(async (id: string) => {
  const { repo, profile } = await requireStudent();
  const report = await repo.getReport<CvReviewPayload>(id);
  if (!report || report.row.type !== "cv_review") notFound();
  return { repo, profile, report, a: report.payload.analysis };
});
