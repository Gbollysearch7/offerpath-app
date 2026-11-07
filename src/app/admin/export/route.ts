import { NextResponse, type NextRequest } from "next/server";
import { analyticsCsvRows } from "@/lib/analytics/csv";
import { STATEMENTS } from "@/lib/analytics/definitions";
import { toCsv } from "@/lib/csv";
import { ACCESS_ACTION_LABEL } from "@/lib/institution/labels";
import type { ExportKind } from "@/lib/institution/types";
import { log } from "@/lib/log";
import { listPeriods } from "@/lib/periods";
import { getRepo, isDemoMode } from "@/lib/session";

export async function GET(request: NextRequest) {
  const repo = await getRepo();
  if (!repo) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const profile = await repo.profile();
  if (profile.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const sp = request.nextUrl.searchParams;
  const date = new Date().toISOString().slice(0, 10);

  // The trail comes first: if the entry can't be written, there is no file. RLS and the role check above are the same
  // ones the screens use, because these rows come from the same functions.
  const recorded = async (kind: ExportKind, count: number, detail: Record<string, unknown> = {}) => {
    try {
      await repo.adminRecordExport(kind, count, detail);
      return true;
    } catch (e) {
      log("error", "admin-export-log-failed", { error: e });
      return false;
    }
  };
  const unavailable = () => NextResponse.json({ error: "This export isn't available right now." }, { status: 503 });

  // OP-022: no file can be narrowed. Two narrowed files, or one beside the whole, could be subtracted to single someone out.
  // A filter is refused rather than ignored, so nobody takes a whole-university file for the group they asked about.
  if (sp.get("q") || sp.get("faculty") || (sp.get("filter") ?? "all") !== "all") return NextResponse.json({ error: "Exports can't be narrowed by search, faculty or filter, because comparing narrowed files could identify a student." }, { status: 400 });

  const csv = (rows: unknown[][], name: string) => new NextResponse(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-${date}.csv"`, "Cache-Control": "private, no-store" } });

  if (sp.get("pack") === "access") {
    const entries = await repo.adminAccessLog({ limit: 5000 });
    if (!(await recorded("export_access_log", entries.length))) return unavailable();
    return csv(
      [
        ["When", "Who", "Role", "Action", "Outcome", "Student"],
        ...entries.map((e) => [e.at, e.actor, e.actorRole, ACCESS_ACTION_LABEL[e.action] ?? e.action, e.outcome, e.studentGone ? "Account deleted" : (e.student ?? "")]),
      ],
      "offerpath-access-log",
    );
  }

  if (sp.get("pack") === "students") {
    // Named students who each chose to share, for a team acting on them: not analytics, not on the dashboard, and only ever the whole list.
    const cols = sp.getAll("cols");
    const want = (c: string) => cols.length === 0 || cols.includes(c);
    const page = await repo.adminStudents({ filter: "all", faculty: "", search: "", limit: 5000, offset: 0 });
    if (!(await recorded("export_students", page.total > 0 && page.total < 5 ? 0 : page.rows.length, { columns: cols }))) return unavailable();
    const sample: unknown[][] = isDemoMode() ? [[`SAMPLE DATA. ${STATEMENTS.sample}`]] : [];
    if (page.total > 0 && page.total < 5) return csv([...sample, ["Note"], ["Fewer than five students share their progress, so this list is hidden to protect privacy."]], "offerpath-students");
    const head = ["Student ID", "Course", "Year", "Status", "Faculty", ...(want("scores") ? ["Score", "Change"] : []), ...(want("activity") ? ["Last active", "Flag"] : [])];
    const rows = page.rows.map((s) => [s.id, s.course, s.year, s.status, s.faculty, ...(want("scores") ? [s.score, s.change] : []), ...(want("activity") ? [s.lastActive, s.flag] : [])]);
    return csv([...sample, head, ...rows], "offerpath-students");
  }

  // The default, and the Graduate Outcomes and TEF pack: the same published figures as the dashboard, for one fixed period.
  const period = listPeriods().find((p) => p.key === (sp.get("period") ?? "all"));
  if (!period) return NextResponse.json({ error: "That isn't a reporting period." }, { status: 400 });
  const tef = sp.get("pack") === "tef";
  let figures;
  try {
    figures = await repo.adminAnalytics(period.key);
  } catch (e) {
    log("error", "admin-analytics-failed", { error: e });
    return unavailable();
  }
  if (!(await recorded("export_outcomes", figures.breakdowns.length, { period: period.key, pack: tef ? "tef" : "analytics" }))) return unavailable();
  return csv(
    analyticsCsvRows(figures, {
      title: tef ? "Offerpath service figures for Graduate Outcomes and TEF context" : "Offerpath service analytics",
      periodLabel: period.label,
      generated: date,
      note: tef ? "Context about how a careers service was used. It is not Graduate Outcomes data and not evidence of employment." : undefined,
    }),
    `${figures.sample ? "SAMPLE-" : ""}${tef ? "offerpath-graduate-outcomes-tef" : "offerpath-analytics"}`,
  );
}
