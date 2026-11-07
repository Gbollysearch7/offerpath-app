import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublishedAnalytics } from "@/lib/analytics/types";
import { ARTEFACT_KIND_FOR, LinkConflictError, LinkRefusedError, type ActionChoice, type ApplicationLink, type ArtefactDownload, type WorkspaceReport } from "@/lib/applications/types";
import { scoreContext } from "@/lib/analysis/coverage";
import { choiceFor, ChoiceNotFoundError, type ProofreadingChoice } from "@/lib/analysis/proofreading/choices";
import { sha256 } from "@/lib/analysis/fingerprint";
import { JOB_POLICY, type AnalysisJob } from "@/lib/analysis/job-state";
import { checkDocument, checkReportRow, fromStored, toStored } from "@/lib/report-schema";
import type { CvReviewPayload, Application, AppStatus, CvSource, Opportunity, Profile, ReportRow, ReportType } from "@/lib/types";
import { removeUserFiles, sweepUserFiles } from "@/lib/account-deletion";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { featureFlags } from "@/lib/env";
import { checkPracticeInput } from "@/lib/practice-schema";
import { PracticeRefusedError, type PracticeAnswer } from "@/lib/practice-types";
import { supabaseInstitutionMethods } from "./supabase-institution";
import { ReportConflictError, sameAttempt, SourceConflictError, type AiKind, type AdminTeam, type ImportResult, type Repo, type SourceInput, type StudentDetail, type StudentPage } from "./types";

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
const toChoice = (r: any): ProofreadingChoice => ({ id: r.id, reportId: r.report_id, documentVersion: r.document_version, kind: r.kind, findingId: r.finding_id, quote: r.quote, language: r.language, actor: r.actor, createdAt: r.created_at });
const toOpp = (r: any): Opportunity => ({ id: r.id, role: r.role, org: r.org, location: r.location, type: r.type, sector: r.sector, sponsorsVisa: r.sponsors_visa, closesOn: r.closes_on, description: r.description, url: r.url, own: !!r.university_id });
const toApp = (r: any): Application => ({ id: r.id, opportunityId: r.opportunity_id, role: r.role, org: r.org, status: r.status, closesOn: r.closes_on, updatedAt: r.updated_at });

const toLink = (r: any): ApplicationLink => ({ id: r.id, applicationId: r.application_id, reportId: r.report_id, kind: r.kind, documentVersion: r.document_version, createdAt: r.created_at, updatedAt: r.updated_at ?? r.created_at });
const toDownload = (r: any): ArtefactDownload => ({ reportId: r.report_id, documentVersion: r.document_version, format: r.format, firstAt: r.first_at, lastAt: r.last_at });
const toActionChoice = (r: any): ActionChoice => ({ id: r.id, actionKey: r.action_key, kind: r.kind, reason: r.reason, createdAt: r.created_at });
const toPractice = (r: any): PracticeAnswer => ({ id: r.id, attemptKey: r.attempt_key, applicationId: r.application_id, mode: r.mode, roleLabel: r.role_label, documentReportId: r.document_report_id, documentVersion: r.document_version, documentLabel: r.document_label, advertReportId: r.advert_report_id, advertVersion: r.advert_version, objective: r.objective, question: r.question, answer: r.answer, feedback: r.feedback, createdAt: r.created_at });

function check<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error) throw Object.assign(new Error(res.error.message), { code: res.error.code });
  return res.data;
}
/** Postgres unique_violation: the row we tried to insert already exists under a unique index. */
const isDuplicate = (e: unknown) => (e as { code?: string } | null)?.code === "23505";

const toJob = (r: any): AnalysisJob => ({ id: r.id, workflow: r.workflow, status: r.status, attempts: r.attempts, failures: r.failures, consecutiveFailures: r.consecutive_failures, resultId: r.result_id, result: r.result, errorCode: r.error_code, charged: r.charged, finishedAt: r.finished_at, createdAt: r.created_at });

/** `admin` is the service-role client used for the writes students can't make themselves; tests pass a fake. */
export function supabaseRepo(sb: SupabaseClient, userId: string, admin: () => SupabaseClient = supabaseAdmin): Repo {
  /** The report that scored a version, if any, read with the student's session. */
  const reportFor = async (sourceId: string): Promise<string | null> => (check(await sb.from("reports").select("id").eq("source_id", sourceId).eq("user_id", userId).maybeSingle()) as { id: string } | null)?.id ?? null;
  return {
    ...supabaseInstitutionMethods(sb),
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
      checkReportRow(type, { score, source });
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
    async updateReport(id, patch, options) {
      if (!UUID_RE.test(id)) throw new Error("Report not found");
      const map: Record<string, unknown> = {};
      if (patch.score != null) {
        const row = check(await sb.from("reports").select("type").eq("id", id).eq("user_id", userId).maybeSingle());
        if (row) checkReportRow(row.type, { score: patch.score });
      }
      if (patch.title !== undefined) map.title = patch.title;
      if (patch.score !== undefined) map.score = patch.score;
      if (patch.payload !== undefined) {
        // The payload is validated against the schema for the report's own type, read with the student's session.
        const row = check(await sb.from("reports").select("type").eq("id", id).eq("user_id", userId).maybeSingle());
        if (!row) throw new Error("Report not found");
        map.payload = toStored(row.type, patch.payload);
      }
      if (options) {
        // One UPDATE with the revision in its WHERE clause, so two writers can't both pass.
        const base = admin().from("reports").update(map).eq("id", id).eq("user_id", userId);
        const guarded = options.ifRevision === null ? base.is("payload->>editRevision", null) : base.eq("payload->>editRevision", String(options.ifRevision));
        const rows = check(await guarded.select("id"));
        if (!rows?.length) throw new ReportConflictError();
        return;
      }
      check(await admin().from("reports").update(map).eq("id", id).eq("user_id", userId));
    },
    async proofreadingChoices(documentVersion) {
      let q = sb.from("proofreading_choices").select("*").eq("user_id", userId);
      if (documentVersion !== undefined) q = q.eq("document_version", documentVersion);
      return (check(await q.order("created_at", { ascending: true })) ?? []).map(toChoice);
    },
    async recordProofreadingChoice(input) {
      // Read with the student's session and filtered to them; the write needs the service role, so it is scoped by what this read found.
      const report = await this.getReport<CvReviewPayload>(input.reportId);
      if (!report || report.row.type !== "cv_review") throw new ChoiceNotFoundError();
      const c = choiceFor(report.payload, input);
      const row = check(await admin().from("proofreading_choices").insert({ user_id: userId, report_id: c.reportId, document_version: c.documentVersion, kind: c.kind, finding_id: c.findingId, quote: c.quote, language: c.language, actor: "student" }).select("*").single());
      return toChoice(row);
    },
    async proofreadingLanguagePreference() {
      const row = check(await sb.from("proofreading_choices").select("language").eq("user_id", userId).eq("kind", "language").order("created_at", { ascending: false }).limit(1).maybeSingle()) as { language: ProofreadingChoice["language"] } | null;
      return row?.language ?? null;
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
    async workspaceReports({ limit, ids = [] }) {
      const newest = limit ? ((check(await sb.from("reports").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit)) ?? []) as any[]) : [];
      const have = new Set(newest.map((r) => r.id));
      const missing = [...new Set(ids)].filter((id) => UUID_RE.test(id) && !have.has(id));
      const extra = missing.length ? ((check(await sb.from("reports").select("*").eq("user_id", userId).in("id", missing)) ?? []) as any[]) : [];
      return [...newest, ...extra].map((r): WorkspaceReport => {
        try {
          return { row: toRow(r), payload: fromStored(r.type, r.payload) };
        } catch {
          return { row: toRow(r), payload: null };
        }
      });
    },
    async applicationLinks() {
      return ((check(await sb.from("application_links").select("*").eq("user_id", userId)) ?? []) as any[]).map(toLink);
    },
    async setApplicationLink({ applicationId, reportId, documentVersion, ifCurrent }) {
      if (!UUID_RE.test(applicationId) || !UUID_RE.test(reportId)) throw new LinkRefusedError();
      // Both read with the student's session and filtered to them; the write needs the service role, so it is scoped by what these found. A trigger checks again.
      const app = check(await sb.from("applications").select("id").eq("id", applicationId).eq("user_id", userId).maybeSingle());
      const report = check(await sb.from("reports").select("id, type").eq("id", reportId).eq("user_id", userId).maybeSingle()) as { type: ReportType } | null;
      const kind = report ? ARTEFACT_KIND_FOR[report.type] : undefined;
      if (!app || !kind) throw new LinkRefusedError();
      const read = async () => check(await sb.from("application_links").select("*").eq("application_id", applicationId).eq("kind", kind).eq("user_id", userId).maybeSingle()) as any;
      const existing = await read();
      // The same request again (a double click, a retry after a lost reply) has nothing to change.
      if (existing && existing.report_id === reportId && existing.document_version === documentVersion) return toLink(existing);
      if (ifCurrent !== undefined && (existing?.report_id ?? null) !== ifCurrent) throw new LinkConflictError();
      if (existing) {
        // The old report in the WHERE clause, so two writers can't both pass.
        const rows = check(await admin().from("application_links").update({ report_id: reportId, document_version: documentVersion, updated_at: new Date().toISOString() }).eq("id", existing.id).eq("user_id", userId).eq("report_id", existing.report_id).select("id"));
        if (!rows?.length) throw new LinkConflictError();
        return toLink(await read());
      }
      try {
        return toLink(check(await admin().from("application_links").insert({ user_id: userId, application_id: applicationId, report_id: reportId, kind, document_version: documentVersion }).select("*").single()));
      } catch (e) {
        if (isDuplicate(e)) throw new LinkConflictError();
        throw e;
      }
    },
    async removeApplicationLink({ applicationId, kind, ifCurrent }) {
      if (!UUID_RE.test(applicationId)) return;
      const existing = check(await sb.from("application_links").select("report_id").eq("application_id", applicationId).eq("kind", kind).eq("user_id", userId).maybeSingle()) as { report_id: string } | null;
      if (!existing) return;
      if (existing.report_id !== ifCurrent) throw new LinkConflictError();
      check(await admin().from("application_links").delete().eq("application_id", applicationId).eq("kind", kind).eq("user_id", userId).eq("report_id", ifCurrent));
    },
    async trackRole({ reportId, role, org, closesOn }) {
      if (!UUID_RE.test(reportId)) throw new LinkRefusedError();
      if (!check(await sb.from("reports").select("id").eq("id", reportId).eq("user_id", userId).maybeSingle())) throw new LinkRefusedError();
      const read = async () => check(await sb.from("applications").select("*").eq("user_id", userId).eq("source_report_id", reportId).maybeSingle());
      const same = await read();
      if (same) return toApp(same);
      try {
        return toApp(check(await admin().from("applications").insert({ user_id: userId, opportunity_id: null, source_report_id: reportId, role, org, closes_on: closesOn, status: "saved" }).select("*").single()));
      } catch (e) {
        const raced = isDuplicate(e) ? await read() : null;
        if (raced) return toApp(raced);
        throw e;
      }
    },
    async removeApplication(applicationId) {
      if (!UUID_RE.test(applicationId)) return;
      check(await sb.from("applications").delete().eq("id", applicationId).eq("user_id", userId));
    },
    async recordDownload({ reportId, documentVersion, format }) {
      const mine = () => admin().from("artefact_downloads").update({ format, last_at: new Date().toISOString() }).eq("user_id", userId).eq("report_id", reportId).eq("document_version", documentVersion).select("id");
      if (check(await mine())?.length) return;
      try {
        check(await admin().from("artefact_downloads").insert({ user_id: userId, report_id: reportId, document_version: documentVersion, format }).select("id").single());
      } catch (e) {
        if (!isDuplicate(e)) throw e;
        check(await mine());
      }
    },
    async artefactDownloads() {
      return ((check(await sb.from("artefact_downloads").select("*").eq("user_id", userId)) ?? []) as any[]).map(toDownload);
    },
    async actionChoices() {
      return ((check(await sb.from("action_choices").select("*").eq("user_id", userId).order("created_at", { ascending: true })) ?? []) as any[]).map(toActionChoice);
    },
    async recordActionChoice({ actionKey, kind, reason }) {
      return toActionChoice(check(await admin().from("action_choices").insert({ user_id: userId, action_key: actionKey, kind, reason }).select("*").single()));
    },
    async practiceAnswers(opts = {}) {
      let q = sb.from("practice_answers").select("*").eq("user_id", userId);
      if (opts.attemptKey) q = q.eq("attempt_key", opts.attemptKey);
      if (opts.applicationId) q = q.eq("application_id", opts.applicationId);
      return ((check(await q.order("created_at", { ascending: false }).limit(500)) ?? []) as any[]).map(toPractice);
    },
    async savePracticeAnswer(raw) {
      const input = checkPracticeInput(raw);
      const ids = [input.applicationId, input.documentReportId, input.advertReportId].filter((x): x is string => !!x);
      if (ids.some((id) => !UUID_RE.test(id))) throw new PracticeRefusedError("not a real id");
      // Read with the student's session and filtered to them; the write needs the service role, so it is scoped by what these found. A trigger checks again.
      const mine = async (table: string, id: string | null) => !id || !!check(await sb.from(table).select("id").eq("id", id).eq("user_id", userId).maybeSingle());
      if (!(await mine("applications", input.applicationId))) throw new PracticeRefusedError("not this student's application");
      if (!(await mine("reports", input.documentReportId)) || !(await mine("reports", input.advertReportId))) throw new PracticeRefusedError("not this student's report");
      const row = {
        user_id: userId, attempt_key: input.attemptKey, application_id: input.applicationId, mode: input.mode, role_label: input.roleLabel,
        document_report_id: input.documentReportId, document_version: input.documentVersion, document_label: input.documentLabel,
        advert_report_id: input.advertReportId, advert_version: input.advertVersion, objective: input.objective,
        question_id: input.question.id, question: input.question, answer: input.answer, feedback: input.feedback, feedback_version: input.feedback.version, method: input.feedback.method,
      };
      try {
        return toPractice(check(await admin().from("practice_answers").insert(row).select("*").single()));
      } catch (e) {
        if (!isDuplicate(e)) throw e;
        return toPractice(check(await sb.from("practice_answers").select("*").eq("user_id", userId).eq("attempt_key", input.attemptKey).single()));
      }
    },
    async deletePracticeAnswer(id) {
      if (!UUID_RE.test(id)) return false;
      const existing = check(await sb.from("practice_answers").select("id").eq("id", id).eq("user_id", userId).maybeSingle());
      if (!existing) return false;
      check(await admin().from("practice_answers").delete().eq("id", id).eq("user_id", userId));
      return true;
    },
    async aiUsedToday(kind: AiKind) {
      const res = await sb.from("ai_usage").select("count").eq("user_id", userId).eq("kind", kind).eq("day", new Date().toISOString().slice(0, 10)).maybeSingle();
      return check(res)?.count ?? 0;
    },
    async bumpAi(kind: AiKind) {
      return Number(check(await sb.rpc("bump_ai_usage", { p_kind: kind })));
    },
    // Job state is written with the service role, so a job can still end after the student's session has expired.
    async claimJob({ workflow, key, freshSeconds }) {
      const out = check(await admin().rpc("claim_analysis_job", { p_user_id: userId, p_workflow: workflow, p_key: key, p_fresh_seconds: freshSeconds, p_lease_seconds: JOB_POLICY.leaseSeconds, p_max_user: JOB_POLICY.maxActivePerUser, p_max_global: JOB_POLICY.maxActiveGlobal, p_max_consecutive_failures: JOB_POLICY.maxConsecutiveFailures, p_cooldown_seconds: JOB_POLICY.cooldownSeconds })) as any;
      return { outcome: out.outcome, job: toJob(out.job), scope: out.scope, retryAfterSeconds: out.retry_after };
    },
    async chargeJob(job, kind, limit, failedLimit) {
      return check(await admin().rpc("charge_analysis_job", { p_user_id: userId, p_job_id: job.id, p_attempt: job.attempt, p_kind: kind, p_limit: limit, p_failed_limit: failedLimit })) as any;
    },
    async finishJob(job, f) {
      const { usage: u } = f;
      return (check(await admin().rpc("finish_analysis_job", { p_user_id: userId, p_job_id: job.id, p_attempt: job.attempt, p_status: f.status, p_result_id: f.resultId ?? null, p_result: f.result ?? null, p_error_code: f.errorCode ?? null, p_release: f.release, p_count_failure: f.countFailure, p_usage: { calls: u.calls, retries: u.retries, input: u.input, output: u.output, cost_micros: u.costMicros, cost_complete: u.costComplete, latency_ms: u.latencyMs } })) as unknown) === true;
    },
    async getJob(id) {
      const r = check(await admin().rpc("get_analysis_job", { p_user_id: userId, p_job_id: id }));
      return r ? toJob(r) : null;
    },
    async sharingEnabled() {
      // Fails closed: until the migration is applied, or if this can't be read, sharing is off rather than the page broken.
      try {
        const { data, error } = await sb.rpc("report_sharing_enabled");
        return !error && data === true;
      } catch {
        return false;
      }
    },
    async createShareLink({ reportId, tokenHash, scope, contentDigest, expiresAt }) {
      return check(await sb.rpc("create_share_link", { p_report: reportId, p_token_hash: tokenHash, p_scope: scope, p_digest: contentDigest, p_expires_at: expiresAt })) as string;
    },
    async shareLinks() {
      const links = await sb.from("share_links").select("id, report_id, scope, content_digest, created_at, expires_at, revoked_at").eq("user_id", userId).order("created_at", { ascending: false });
      // Before the migration there are no links to report, and "Download my data" must still work. Any other failure is real.
      if (links.error && ["42P01", "PGRST205"].includes(links.error.code ?? "")) return [];
      const rows = (check(links) ?? []) as any[];
      if (!rows.length) return [];
      const log = (check(await sb.from("share_link_access").select("link_id, accessed_at").eq("user_id", userId).order("accessed_at", { ascending: false })) ?? []) as any[];
      return rows.map((r) => ({ id: r.id, reportId: r.report_id, scope: r.scope, contentDigest: r.content_digest, createdAt: r.created_at, expiresAt: r.expires_at, revokedAt: r.revoked_at, accesses: log.filter((a) => a.link_id === r.id).map((a) => a.accessed_at) }));
    },
    async revokeShareLink(id) {
      return check(await sb.rpc("revoke_share_link", { p_link: id })) === true;
    },
    async counts() {
      const head = (t: ReportType | null) => {
        let q = sb.from("reports").select("id", { count: "exact", head: true }).eq("user_id", userId);
        if (t) q = q.eq("type", t);
        return q;
      };
      const [cvs, reports, letters, linkedin, apps] = await Promise.all([head("cv_review"), head(null), head("cover_letter"), head("linkedin"), sb.from("applications").select("id", { count: "exact", head: true }).eq("user_id", userId)]);
      return { cvs: cvs.count ?? 0, reports: reports.count ?? 0, letters: letters.count ?? 0, linkedin: linkedin.count ?? 0, applications: apps.count ?? 0 };
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
    async adminAnalytics(periodKey) {
      return check(await sb.rpc("admin_analytics", { p_period: periodKey })) as PublishedAnalytics;
    },
    async adminStudents(q = {}) {
      return check(await sb.rpc("admin_students", { p_filter: q.filter ?? "all", p_search: q.search ?? "", p_faculty: q.faculty ?? "", p_limit: q.limit ?? 50, p_offset: q.offset ?? 0 })) as StudentPage;
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
      // The route checks the flag too. The call to the database records an access, so it isn't made while this is off.
      if (!featureFlags.adviserCvAccess() || !UUID_RE.test(reportId)) return null;
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
