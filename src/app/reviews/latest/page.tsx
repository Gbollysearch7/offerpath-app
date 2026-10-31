import { redirect } from "next/navigation";
import { requireStudent } from "@/lib/session";

export default async function LatestReview() {
  const { repo } = await requireStudent();
  const latest = await repo.listReports({ type: "cv_review", limit: 1 });
  redirect(latest.rows[0] ? `/reviews/${latest.rows[0].id}` : "/upload");
}
