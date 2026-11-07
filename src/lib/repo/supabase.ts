import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { scoreContext } from "@/lib/analysis/coverage";
import { sha256 } from "@/lib/analysis/fingerprint";
import { checkDocument, fromStored, toStored } from "@/lib/report-schema";
import type { Application, AppStatus, CvSource, Opportunity, Profile, ReportRow, ReportType } from "@/lib/types";
import { removeUserFiles, sweepUserFiles } from "@/lib/account-deletion";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sameAttempt, SourceConflictError, type AdminOverview, type AiKind, type AdminTeam, type ImportResult, type OutcomeRow, type Repo, type SourceInput, type StudentDetail, type StudentPage } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any -- rows come back untyped from PostgREST */

const BUCKET = "cvs";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toProfile(r: any): Profile {
  return {
    id: r.id,
    fullName: r.full_name ?? "",
    email: r.email ?? "",
    role: r.role,
    universityId: r.university_id,
    universityName: r.universities?.name ?? null,
    stage: r.stage,
    sectors: r.sectors ?? [],
    visaSponsorship: r.visa_sponsorship,
    deadlineReminders: r.deadline_reminders,
    shareProgress: r.share_progress,
    adviserCanViewCv: r.adviser_can_view_cv,
    onboarded: !!r.onboarded_at,
    course: r.course,
    yearOfStudy: r.year_of_study,
    feeStatus: r.fee_status,
    faculty: r.faculty,
    studentNumber: r.student_number,
  };
}

const toRow = (r: any): ReportRow => ({ id: r.id, type: r.type, title: r.title, score: r.score, createdAt: r.created_at, sourceId: r.source_id ?? null });

// A list reads only what `seriesFields` reads out of each payload, not the payloads themselves. Reads old rows as well
// as new ones and needs no migration. A JSON path yields null when a report did not record it.
const LIST_COLUMNS =
  "id, type, title, score, created_at, source_id, s_identity:payload->analysis->meta->scoring->>identity, s_method:payload->analysis->meta->>method, s_rubric:payload->analysis->meta->>rubric, s_bullets:payload->analysis->meta->>bullets, s_parser:payload->assessment->versions->>parser, s_dictionary:payload->assessment->versions->>dictionary, s_model:payload->assessment->versions->>model, s_band:payload->document->extraction->confidence->>band";

const toListRow = (r: any): ReportRow => ({
  ...toRow(r),
  ...(r.type === "cv_review"
    ? { scoring: scoreContext({ identity: r.s_identity ?? null, method: r.s_method ?? null, rubric: r.s_rubric ?? null, parser: r.s_parser ?? null, dictionary: r.s_dictionary ?? null, model: r.s_model ?? null, bullets: r.s_bullets == null ? null : Number(r.s_bullets), band: r.s_band ?? null }) }
    : {}),
});
const CONTENT_TYPES: Record<string, string> = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
const contentTypeFor = (name: string) => CONTENT_TYPES[name.toLowerCase().split(".").pop() ?? ""] ?? "application/octet-stream";
const safeName = (name: string) => name.replace(/[^\w.-]+/g, "_").slice(0, 100);

/** A `cv_sources` row as the app reads it. The metadata is validated on read, like a report payload, so a damaged row fails loudly. */
function toSource(r: any, reportId: string | null): CvSource {
  const document = r.meta && typeof r.meta === "object" && Object.keys(r.meta).length ? checkDocument(r.meta, r.text) : null;
  return { id: r.id, parentId: r.parent_id, kind: r.kind, fileName: r.file_name, text: r.text, documentVersion: r.document_version, document, outcome: r.outcome ?? null, storagePath: r.storage_path, hasFile: !!r.storage_path, reportId, createdAt: r.created_at };
}
const toOpp = (r: any): Opportunity => ({ id: r.id, role: r.role, org: r.org, location: r.location, type: r.type, sector: r.sector, sponsorsVisa: r.sponsors_visa, closesOn: r.closes_on, description: r.description, url: r.url, own: !!r.university_id });
const toApp = (r: any): Application => ({ id: r.id, opportunityId: r.opportunity_id, role: r.role, org: r.org, status: r.status, closesOn: r.closes_on, updatedAt: r.updated_at });

function check<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error) throw Object.assign(new Error(res.error.message), { code: res.error.code });
  return res.data;
}
/** Postgres unique_violation: the row we tried to insert already exists under a unique index. */
const isDuplicate = (e: unknown) => (e as { code?: string } | null)?.code === "23505";

/** `admin` is the service-role client used for the writes students can't make themselves; tests pass a fake. */
export function supabaseRepo(sb: SupabaseClient, userId: string, admin: () => SupabaseClient = supabaseAdmin): Repo {
  /** The report that scored a version, if any, read with the student's session. */
  const reportFor = async (sourceId: string): Promise<string | null> => (check(await sb.from("reports").select("id").eq("source_id", sourceId).eq("user_id", userId).maybeSingle()) as { id: string } | null)?.id ?? null;
  return {
    mode: "supabase",
    userId,
    async profile() {
      const data = check(await sb.from("profiles").select("*, universities(name)").eq("id", userId).single());
      return toProfile(data);
    },
    async updateProfile(patch) {
      const map: Record<string, unknown> = {};
      if (patch.fullName !== undefined) map.full_name = patch.fullName;
      if (patch.stage !== undefined) map.stage = patch.stage;
      if (patch.sectors !== undefined) map.sectors = patch.sectors;
      if (patch.visaSponsorship !== undefined) map.visa_sponsorship = patch.visaSponsorship;
      if (patch.deadlineReminders !== undefined) map.deadline_reminders = patch.deadlineReminders;
      if (patch.shareProgress !== undefined) map.share_progress = patch.shareProgress;
      if (patch.onboarded !== undefined) map.onboarded_at = patch.onboarded ? new Date().toISOString() : null;
      if (patch.adviserCanViewCv !== undefined) map.adviser_can_view_cv = patch.adviserCanViewCv;
      // course, year, fee status and faculty are institution-owned and not editable by students.
      if (Object.keys(map).length) check(await sb.from("profiles").update(map).eq("id", userId));
    },
    async listReports({ type, q, offset = 0, limit = 50 }) {
      let query = sb.from("reports").select(LIST_COLUMNS, { count: "exact" }).eq("user_id", userId).order("created_at", { ascending: false });
      if (type) query = query.eq("type", type);
      if (q) query = query.ilike("title", `%${q.replace(/[%_]/g, "")}%`);
      const res = await query.range(offset, offset + limit - 1);
      return { rows: ((check(res) ?? []) as any[]).map(toListRow), total: res.count ?? 0 };
    },
    async getReport<P>(id: string) {
      if (!UUID_RE.test(id)) return null;
      const res = await sb.from("reports").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
      const data = check(res);
      return data ? { row: toRow(data), payload: fromStored(data.type, data.payload) as P } : null;
    },
    async latestReport<P>(type: ReportType) {
      const res = await sb.from("reports").select("*").eq("user_id", userId).eq("type", type).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const data = check(res);
      return data ? { row: toRow(data), payload: fromStored(data.type, data.payload) as P } : null;
    },
    async createReport({ type, title, score, payload, source }) {
      const stored = toStored(type, payload);
      if (source) {
        // The version must be this user's (checked with their own session, under RLS; the database trigger checks again).
        const own = check(await sb.from("cv_sources").select("id").eq("id", source.id).eq("user_id", userId).maybeSingle());
        if (!own) throw new Error("Document not found");
      }
      // Reports (with their scores) are written by the server only; students can't write them directly.
      try {
        const data = check(await admin().from("reports").insert({ user_id: userId, type, title, score, payload: stored, storage_path: source?.storagePath ?? null, source_id: source?.id ?? null }).select("id").single());
        return data!.id as string;
      } catch (e) {
        // One report per version: a retry or a parallel request finds the one already written.
        if (source && isDuplicate(e)) {
          const existing = check(await sb.from("reports").select("id").eq("source_id", source.id).eq("user_id", userId).maybeSingle()) as { id: string } | null;
          if (existing) return existing.id;
        }
        throw e;
      }
    },
    async createSource(input: SourceInput) {
      const text = input.text;
      const documentVersion = sha256(text);
      if (input.document) checkDocument(input.document, text);
      const mine = (q: any) => q.eq("user_id", userId);
      const found = async (q: any) => {
        const row = check(await q.maybeSingle()) as any;
        return row ? toSource(row, await reportFor(row.id)) : null;
      };
      // The same attempt again (a refresh, a double click, a retry after a failed save) gets the version it already made.
      const attempt = { documentVersion, parentId: input.parentId, kind: input.kind };
      const answer = (saved: CvSource) => {
        if (!sameAttempt(saved, attempt)) throw new SourceConflictError();
        return saved;
      };
      if (input.idempotencyKey) {
        const same = await found(mine(sb.from("cv_sources").select("*").eq("idempotency_key", input.idempotencyKey)));
        if (same) return answer(same);
      }
      if (input.parentId) {
        if (!check(await mine(sb.from("cv_sources").select("id").eq("id", input.parentId)).maybeSingle())) throw new Error("Document not found");
        const same = await found(mine(sb.from("cv_sources").select("*").eq("parent_id", input.parentId).eq("document_version", documentVersion)));
        if (same) return same;
      }
      const db = admin();
      let storagePath: string | null = null;
      if (input.file) {
        storagePath = `${userId}/${crypto.randomUUID()}/${safeName(input.file.name)}`;
        check(await db.storage.from(BUCKET).upload(storagePath, input.file.bytes, { contentType: input.file.contentType, upsert: false }));
      }
      const row = { user_id: userId, parent_id: input.parentId, kind: input.kind, file_name: input.fileName, text, document_version: documentVersion, meta: input.document ?? {}, outcome: input.outcome, storage_path: storagePath, idempotency_key: input.idempotencyKey };
      try {
        const data = check(await db.from("cv_sources").insert(row).select("*").single());
        return toSource(data, null);
      } catch (e) {
        if (storagePath) await db.storage.from(BUCKET).remove([storagePath]);
        if (isDuplicate(e)) {
          // Two requests raced past the checks above; the unique indexes let exactly one through. Return that one.
          const byKey = input.idempotencyKey ? await found(mine(sb.from("cv_sources").select("*").eq("idempotency_key", input.idempotencyKey))) : null;
          if (byKey) return answer(byKey);
          const same = input.parentId ? await found(mine(sb.from("cv_sources").select("*").eq("parent_id", input.parentId).eq("document_version", documentVersion))) : null;
          if (same) return same;
        }
        throw e;
      }
    },
    async getSource(id) {
      if (!UUID_RE.test(id)) return null;
      const row = check(await sb.from("cv_sources").select("*").eq("id", id).eq("user_id", userId).maybeSingle());
      return row ? toSource(row, await reportFor(id)) : null;
    },
    async listSources() {
      const rows = check(await sb.from("cv_sources").select("*").eq("user_id", userId).order("created_at", { ascending: false })) ?? [];
      if (!rows.length) return [];
      const reports = check(await sb.from("reports").select("id, source_id").eq("user_id", userId).in("source_id", rows.map((r: any) => r.id))) ?? [];
      const byVersion = new Map<string, string>(reports.map((r: any) => [r.source_id, r.id]));
      return rows.map((r: any) => toSource(r, byVersion.get(r.id) ?? null));
    },
    async sourceFile(id) {
      if (!UUID_RE.test(id)) return null;
      const row = check(await sb.from("cv_sources").select("file_name, storage_path").eq("id", id).eq("user_id", userId).maybeSingle());
      if (!row?.storage_path) return null;
      // Downloaded with the student's own session: the bucket policy only lets them read their own folder.
      const dl = await sb.storage.from(BUCKET).download(row.storage_path);
      if (dl.error || !dl.data) throw new Error(dl.error?.message ?? "File not found");
      return { name: row.file_name, bytes: new Uint8Array(await dl.data.arrayBuffer()), contentType: contentTypeFor(row.file_name) };
    },
    async updateReport(id, patch) {
      if (!UUID_RE.test(id)) throw new Error("Report not found");
      const map: Record<string, unknown> = {};
      if (patch.title !== undefined) map.title = patch.title;
      if (patch.score !== undefined) map.score = patch.score;
      if (patch.payload !== undefined) {
        // The payload is validated against the schema for the report's own type, read with the student's session.
        const row = check(await sb.from("reports").select("type").eq("id", id).eq("user_id", userId).maybeSingle());
        if (!row) throw new Error("Report not found");
        map.payload = toStored(row.type, patch.payload);
      }
      check(await admin().from("reports").update(map).eq("id", id).eq("user_id", userId));
    },
    async opportunities() {
      return (check(await sb.from("opportunities").select("*").order("closes_on")) ?? []).map(toOpp);
    },
    async applications() {
      return (check(await sb.from("applications").select("*").eq("user_id", userId).order("updated_at", { ascending: false })) ?? []).map(toApp);
    },
    async track(opportunityId) {
      // Only real opportunities can be tracked; role, employer and deadline come from our data, not the client.
      const o = check(await sb.from("opportunities").select("*").eq("id", opportunityId).single());
      check(await supabaseAdmin().from("applications").upsert({ user_id: userId, opportunity_id: o.id, role: o.role, org: o.org, closes_on: o.closes_on, status: "saved" }, { onConflict: "user_id,opportunity_id", ignoreDuplicates: true }));
    },
    async untrack(opportunityId) {
      check(await sb.from("applications").delete().eq("user_id", userId).eq("opportunity_id", opportunityId));
    },
    async setApplicationStatus(applicationId: string, status: AppStatus) {
      if (!UUID_RE.test(applicationId)) return;
      check(await sb.from("applications").update({ status, updated_at: new Date().toISOString() }).eq("id", applicationId).eq("user_id", userId));
    },
    async aiUsedToday(kind: AiKind) {
      const res = await sb.from("ai_usage").select("count").eq("user_id", userId).eq("kind", kind).eq("day", new Date().toISOString().slice(0, 10)).maybeSingle();
      return check(res)?.count ?? 0;
    },
    async bumpAi(kind: AiKind) {
      return Number(check(await sb.rpc("bump_ai_usage", { p_kind: kind })));
    },
    async counts() {
      const head = (t: ReportType | null) => {
        let q = sb.from("reports").select("id", { count: "exact", head: true }).eq("user_id", userId);
        if (t) q = q.eq("type", t);
        return q;
      };
      const [cvs, reports, letters, apps] = await Promise.all([head("cv_review"), head(null), head("cover_letter"), sb.from("applications").select("id", { count: "exact", head: true }).eq("user_id", userId)]);
      return { cvs: cvs.count ?? 0, reports: reports.count ?? 0, letters: letters.count ?? 0, applications: apps.count ?? 0 };
    },
    async exportFiles() {
      // Every file the student uploaded: versions hold them now; older reports still point at theirs.
      const [sources, reports] = await Promise.all([sb.from("cv_sources").select("storage_path").eq("user_id", userId).not("storage_path", "is", null), sb.from("reports").select("storage_path").eq("user_id", userId).not("storage_path", "is", null)]);
      const paths = [...new Set([...(check(sources) ?? []), ...(check(reports) ?? [])].map((r: { storage_path: string }) => r.storage_path))];
      const files: { name: string; bytes: Uint8Array }[] = [];
      for (const path of paths) {
        const dl = await sb.storage.from(BUCKET).download(path);
        if (dl.data) files.push({ name: path.split("/").pop()!, bytes: new Uint8Array(await dl.data.arrayBuffer()) });
      }
      return files;
    },
    async deleteAccount() {
      // Files first, and all of them or nothing further: the rows are what tells a retry the account still exists.
      await removeUserFiles(admin(), userId);
      // Cascades to every row: reports, versions (with their text), applications, notes, usage, reminders.
      check(await sb.rpc("delete_my_account"));
      await sweepUserFiles(admin(), userId);
    },
    async adminOverview(period) {
      return check(await sb.rpc("admin_overview", { p_from: period?.from ?? null, p_to: period?.to ?? null })) as AdminOverview;
    },
    async adminStudents(q = {}) {
      return check(await sb.rpc("admin_students", { p_filter: q.filter ?? "all", p_search: q.search ?? "", p_faculty: q.faculty ?? "", p_limit: q.limit ?? 50, p_offset: q.offset ?? 0 })) as StudentPage;
    },
    async adminOutcomesPack(period) {
      return (check(await sb.rpc("admin_outcomes_pack", { p_from: period?.from ?? null, p_to: period?.to ?? null })) as { rows: OutcomeRow[] }).rows;
    },
    async adminUniversity() {
      const data = check(await sb.from("profiles").select("universities(name, domain)").eq("id", userId).single());
      const u = data?.universities as unknown as { name: string; domain: string } | null;
      return { name: u?.name ?? "", domain: u?.domain ?? "" };
    },
    async importStudentRecords(rows) {
      return check(await sb.rpc("admin_import_students", { p_rows: rows })) as ImportResult;
    },
    async adminTeam() {
      return check(await sb.rpc("admin_list_team")) as AdminTeam;
    },
    async setAdminRole(email, admin) {
      return String(check(await sb.rpc("admin_set_role", { p_email: email, p_admin: admin })));
    },
    async adminOpportunities() {
      const rows = (check(await sb.from("opportunities").select("*").order("closes_on")) ?? []).map(toOpp);
      return rows.sort((a, b) => Number(b.own) - Number(a.own));
    },
    async saveOpportunity(o) {
      // RLS only lets admins write their own university's listings; university_id comes from their profile.
      const { data: me } = await sb.from("profiles").select("university_id").eq("id", userId).single();
      const id = o.id ?? `opp-${crypto.randomUUID()}`;
      const row = { id, role: o.role, org: o.org, location: o.location, type: o.type, sector: o.sector, sponsors_visa: o.sponsorsVisa, closes_on: o.closesOn, description: o.description, url: o.url ?? null, university_id: me?.university_id, created_by: userId, updated_at: new Date().toISOString() };
      check(o.id ? await sb.from("opportunities").update(row).eq("id", o.id).select("id").single() : await sb.from("opportunities").insert(row).select("id").single());
      return id;
    },
    async adminStudentDetail(key) {
      if (!UUID_RE.test(key)) return null;
      return (check(await sb.rpc("admin_student_detail", { p_student: key })) as StudentDetail | null) ?? null;
    },
    async adminAddNote(reportId, note) {
      if (!UUID_RE.test(reportId)) throw new Error("report not found");
      check(await sb.rpc("admin_add_note", { p_report: reportId, p_note: note }));
    },
    async adminCvLink(reportId) {
      if (!UUID_RE.test(reportId)) return null;
      // Consent is checked by the database with the adviser's own session; only then is a link signed.
      const path = check(await sb.rpc("admin_cv_path", { p_report: reportId })) as string | null;
      if (!path) return null;
      const { data, error } = await supabaseAdmin().storage.from(BUCKET).createSignedUrl(path, 60, { download: true });
      if (error) throw new Error(error.message);
      return data.signedUrl;
    },
    async myAdviserNotes() {
      const rows = check(await sb.from("adviser_notes").select("id, report_id, author_name, note, created_at").eq("student_id", userId).order("created_at", { ascending: false }).limit(20)) ?? [];
      return rows.map((r: any) => ({ id: r.id, reportId: r.report_id, author: r.author_name, note: r.note, createdAt: r.created_at }));
    },
    async deleteOpportunity(id) {
      check(await sb.from("opportunities").delete().eq("id", id));
    },
  };
}
