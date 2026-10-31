import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Application, AppStatus, Opportunity, Profile, ReportRow, ReportType } from "@/lib/types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AdminOverview, AiKind, AdminTeam, ImportResult, OutcomeRow, Repo, StudentDetail, StudentPage } from "./types";

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

const toRow = (r: any): ReportRow => ({ id: r.id, type: r.type, title: r.title, score: r.score, createdAt: r.created_at });
const toOpp = (r: any): Opportunity => ({ id: r.id, role: r.role, org: r.org, location: r.location, type: r.type, sector: r.sector, sponsorsVisa: r.sponsors_visa, closesOn: r.closes_on, description: r.description, url: r.url, own: !!r.university_id });
const toApp = (r: any): Application => ({ id: r.id, opportunityId: r.opportunity_id, role: r.role, org: r.org, status: r.status, closesOn: r.closes_on, updatedAt: r.updated_at });

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export function supabaseRepo(sb: SupabaseClient, userId: string): Repo {
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
      let query = sb.from("reports").select("id, type, title, score, created_at", { count: "exact" }).eq("user_id", userId).order("created_at", { ascending: false });
      if (type) query = query.eq("type", type);
      if (q) query = query.ilike("title", `%${q.replace(/[%_]/g, "")}%`);
      const res = await query.range(offset, offset + limit - 1);
      return { rows: (check(res) ?? []).map(toRow), total: res.count ?? 0 };
    },
    async getReport<P>(id: string) {
      if (!UUID_RE.test(id)) return null;
      const res = await sb.from("reports").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
      const data = check(res);
      return data ? { row: toRow(data), payload: data.payload as P } : null;
    },
    async latestReport<P>(type: ReportType) {
      const res = await sb.from("reports").select("*").eq("user_id", userId).eq("type", type).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const data = check(res);
      return data ? { row: toRow(data), payload: data.payload as P } : null;
    },
    async createReport({ type, title, score, payload, file }) {
      // Files and reports (with their scores) are written by the server only; students can't write them directly.
      const admin = supabaseAdmin();
      let storagePath: string | null = null;
      if (file) {
        storagePath = `${userId}/${crypto.randomUUID()}/${file.name.replace(/[^\w.-]+/g, "_").slice(0, 100)}`;
        check(await admin.storage.from(BUCKET).upload(storagePath, file.bytes, { contentType: file.contentType, upsert: false }));
      }
      const withPath = storagePath && payload && typeof payload === "object" ? { ...(payload as object), storagePath } : payload;
      try {
        const data = check(await admin.from("reports").insert({ user_id: userId, type, title, score, payload: withPath, storage_path: storagePath }).select("id").single());
        return data!.id as string;
      } catch (e) {
        if (storagePath) await admin.storage.from(BUCKET).remove([storagePath]);
        throw e;
      }
    },
    async updateReport(id, patch) {
      const map: Record<string, unknown> = {};
      if (patch.title !== undefined) map.title = patch.title;
      if (patch.score !== undefined) map.score = patch.score;
      if (patch.payload !== undefined) map.payload = patch.payload;
      check(await supabaseAdmin().from("reports").update(map).eq("id", id).eq("user_id", userId));
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
      const rows = check(await sb.from("reports").select("storage_path").eq("user_id", userId).not("storage_path", "is", null));
      const files: { name: string; bytes: Uint8Array }[] = [];
      for (const r of rows as { storage_path: string }[]) {
        const dl = await sb.storage.from(BUCKET).download(r.storage_path);
        if (dl.data) files.push({ name: r.storage_path.split("/").pop()!, bytes: new Uint8Array(await dl.data.arrayBuffer()) });
      }
      return files;
    },
    async deleteAccount() {
      // Erase every file under the student's folder (not just ones a report points to), and stop if any removal fails.
      const admin = supabaseAdmin();
      const paths: string[] = [];
      const walk = async (prefix: string): Promise<void> => {
        for (let offset = 0; ; offset += 100) {
          const { data, error } = await admin.storage.from(BUCKET).list(prefix, { limit: 100, offset });
          if (error) throw new Error(error.message);
          for (const item of data ?? []) {
            const path = `${prefix}/${item.name}`;
            if (item.id) paths.push(path);
            else await walk(path);
          }
          if (!data || data.length < 100) break;
        }
      };
      await walk(userId);
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await admin.storage.from(BUCKET).remove(paths.slice(i, i + 100));
        if (error) throw new Error(`Couldn't delete your files: ${error.message}`);
      }
      check(await sb.rpc("delete_my_account"));
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
