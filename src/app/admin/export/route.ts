import { NextResponse, type NextRequest } from "next/server";
import { toCsv } from "@/lib/csv";
import { findPeriod } from "@/lib/periods";
import { getRepo } from "@/lib/session";

export async function GET(request: NextRequest) {
  const repo = await getRepo();
  if (!repo) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const profile = await repo.profile();
  if (profile.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const sp = request.nextUrl.searchParams;
  const date = new Date().toISOString().slice(0, 10);

  const csv = (rows: unknown[][], name: string) => new NextResponse(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-${date}.csv"` } });

  if (sp.get("pack") === "tef") {
    // Graduate Outcomes / TEF evidence: engagement funnel overall and by faculty, year and fee status.
    const period = findPeriod(sp.get("period") ?? "all");
    const [o, pack] = await Promise.all([repo.adminOverview({ from: period.from, to: period.to }), repo.adminOutcomesPack({ from: period.from, to: period.to })]);
    const head = ["Breakdown", "Group", "Students", "Uploaded a CV", "Re-scored a CV", "Improved by 10+ points", "Strong or better (75+)", "Tracked applications", "Reached interview", "Received an offer", "Average score", "Average improvement"];
    const rows = pack.map((r) =>
      r.suppressed
        ? [r.dimension, r.group, "Fewer than 5 students (hidden)", "", "", "", "", "", "", "", "", ""]
        : [r.dimension, r.group, r.students, r.uploadedCv, r.reuploaded, r.improved10, r.strongOrBetter, r.trackedApplications, r.reachedInterview, r.receivedOffer, r.avgScore ?? "", r.avgImprovement ?? ""],
    );
    return csv(
      [
        ["Offerpath Graduate Outcomes and TEF evidence pack"],
        ["University", o.universityName],
        ["Period", period.label],
        ["Generated", date],
        ["Scope", "Students who chose to share their progress; groups of fewer than five are hidden"],
        [],
        head,
        ...rows,
      ],
      "offerpath-graduate-outcomes-tef",
    );
  }

  const filter = (["all", "needs", "home", "international"] as const).find((f) => f === sp.get("filter")) ?? "all";
  const cols = sp.getAll("cols");
  const want = (c: string) => cols.length === 0 || cols.includes(c);
  const page = await repo.adminStudents({ filter, faculty: sp.get("faculty") ?? "", search: sp.get("q") ?? "", limit: 5000, offset: 0 });
  if (page.total > 0 && page.total < 5) return csv([["Note"], ["This view has fewer than five students, so it is hidden to protect privacy."]], "offerpath-students");
  const head = ["Student ID", "Course", "Year", "Status", "Faculty", ...(want("scores") ? ["Score", "Change"] : []), ...(want("activity") ? ["Last active", "Flag"] : [])];
  const rows = page.rows.map((s) => [s.id, s.course, s.year, s.status, s.faculty, ...(want("scores") ? [s.score, s.change] : []), ...(want("activity") ? [s.lastActive, s.flag] : [])]);
  return csv([head, ...rows], "offerpath-students");
}
