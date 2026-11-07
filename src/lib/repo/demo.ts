import "server-only";
import { sampleAnalytics } from "@/lib/analytics/sample";
import { listPeriods } from "@/lib/periods";
import { ADMIN_SAMPLE, DEMO_CVS, DEMO_LETTER, DEMO_UNIVERSITY, SAMPLE_OPPORTUNITIES } from "@/lib/seed-data";
import { ARTEFACT_KIND_FOR, LinkConflictError, LinkRefusedError, type ActionChoice, type ApplicationLink, type ArtefactDownload, type WorkspaceReport } from "@/lib/applications/types";
import { scoreContext } from "@/lib/analysis/coverage";
import { choiceFor, type ProofreadingChoice } from "@/lib/analysis/proofreading/choices";
import { sha256 } from "@/lib/analysis/fingerprint";
import { JOB_POLICY, type AnalysisJob, type ClaimResult } from "@/lib/analysis/job-state";
import { seriesFields } from "@/lib/analysis/scoring-contract";
import { checkDocument, checkReportRow, fromStored, toStored } from "@/lib/report-schema";
import { buildCvPayload, buildLetterReviewPayload, buildTailorPayload } from "@/lib/services";
import { checkPracticeInput } from "@/lib/practice-schema";
import { PracticeRefusedError, type PracticeAnswer } from "@/lib/practice-types";
import type { ShareBackend, ShareLinkRecord } from "@/lib/sharing/types";
import { AREA_LABELS } from "@/lib/analysis/labels";
import type { Application, AppStatus, CvReviewPayload, CvSource, Opportunity, Profile, ReportRow, ReportType, Role } from "@/lib/types";
import { demoCaseworkFor, demoInstitutionMethods, demoRecordNote, demoRecordView, demoStaffCanSee, type DemoContext } from "./demo-institution";
import { ReportConflictError, sameAttempt, SourceConflictError, type AdminStudent, type AdviserNote, type AiKind, type ImportResult, type Repo, type SourceInput, type StoredReport } from "./types";

// In-memory store for demo mode (no Supabase configured). Lives for the life of the server process.

interface DemoReport {
  row: ReportRow;
  payload: unknown;
}

/** A CV version. Immutable once pushed; the file's bytes stay with it (there is no storage in demo mode). */
interface DemoSource {
  source: Omit<CvSource, "reportId" | "hasFile">;
  file?: { name: string; bytes: Uint8Array; contentType: string };
  idempotencyKey: string | null;
}

interface DemoUser {
  profile: Profile;
  reports: DemoReport[];
  sources: DemoSource[];
  applications: Application[];
  ai: Record<string, number>; // `${day}:${kind}` -> count
  aiFailed?: Record<string, number>; // `${day}:${kind}` -> failed attempts that reached the provider
  /** Proofreading choices, oldest first. Append-only, like the table. */
  choices?: ProofreadingChoice[];
  /** OP-019. The same rules as 20261107220000_application_links.sql. */
  links?: ApplicationLink[];
  downloads?: (ArtefactDownload & { id: string })[];
  actionChoices?: ActionChoice[];
  /** Application id to the report a role came from. */
  applicationSources?: Record<string, string>;
  /** OP-023. Held on the user, so they go with the account as the database's cascade does. The same rules as 20261108110000_practice_answers.sql. */
  practice?: PracticeAnswer[];
  /** OP-020. Held on the user, so they go with the account as the database's cascade does. */
  shareLinks?: (ShareLinkRecord & { tokenHash: string })[];
}

/** The same rules as the claim, charge and finish functions in 20261107180000_analysis_jobs.sql. tests/recovery-db.test.ts runs one contract against both. */
export interface DemoJob extends AnalysisJob {
  userId: string;
  key: string;
  leaseExpiresAt: number | null;
  chargedKey: { kind: AiKind; day: string } | null;
  updatedAt: number;
  finishedMs: number | null;
}

interface DemoDb {
  users: Record<string, DemoUser>;
  aiTotal: Record<string, number>; // `${day}:${kind}` across all demo visitors
  opps: Opportunity[]; // shared sample listings plus ones the demo admin adds
  studentRecords: Record<string, { student_number?: string; course?: string; year_of_study?: string; faculty?: string; fee_status?: string }>;
  pendingAdmins: { email: string; invitedAt: string }[];
  extraAdmins: { email: string; name: string }[];
  notes: AdviserNote[];
  jobs?: DemoJob[];
}

// Demo identities are free to create, so per-visitor limits alone can't bound AI spend.
// These caps apply to the whole demo server per day.
const DEMO_DAILY_AI_TOTAL: Record<AiKind, number> = { cv_score: 100, line_rewrite: 300, letter: 50, tailor: 50, linkedin: 50, practice: 50 };

const g = globalThis as unknown as { __offerpathDemo?: DemoDb };
const uid = () => crypto.randomUUID();
const today = () => new Date().toISOString().slice(0, 10);

function baseProfile(id: string, role: Role): Profile {
  if (role === "adviser") return { id, fullName: "Priya Shah", email: "priya.shah@northfield.ac.uk", role, universityId: DEMO_UNIVERSITY.id, universityName: DEMO_UNIVERSITY.name, stage: null, sectors: [], visaSponsorship: false, deadlineReminders: false, shareProgress: false, adviserCanViewCv: false, onboarded: true, course: null, yearOfStudy: null, feeStatus: null, faculty: null, studentNumber: null };
  return role === "admin"
    ? { id, fullName: "Sam Price", email: "sam.price@northfield.ac.uk", role, universityId: DEMO_UNIVERSITY.id, universityName: DEMO_UNIVERSITY.name, stage: null, sectors: [], visaSponsorship: false, deadlineReminders: false, shareProgress: false, adviserCanViewCv: false, onboarded: true, course: null, yearOfStudy: null, feeStatus: null, faculty: null, studentNumber: null }
    : { id, fullName: "Jordan Reed", email: "jordan.reed@northfield.ac.uk", role, universityId: DEMO_UNIVERSITY.id, universityName: DEMO_UNIVERSITY.name, stage: null, sectors: [], visaSponsorship: false, deadlineReminders: true, shareProgress: true, adviserCanViewCv: false, onboarded: false, course: "Economics", yearOfStudy: "Year 3", feeStatus: "home", faculty: "Social sciences", studentNumber: "2104821" };
}

/** The shape reports had before findings were recorded (v0): no payloadVersion, no assessment. */
const legacyShape = ({ fileName, sector, stage, text, storagePath, analysis }: CvReviewPayload) => {
  const meta = { ...analysis.meta };
  delete meta.scoring; // Recorded since OP-010, so a report in this shape never has it.
  return { fileName, sector, stage, text, storagePath, analysis: { ...analysis, meta } };
};

function seedStudent(id: string): DemoUser {
  const reports: DemoReport[] = [];
  let latestCvId = "";
  let latestCv: CvReviewPayload | null = null;
  for (const cv of DEMO_CVS) {
    const payload = buildCvPayload({ fileName: cv.fileName, text: cv.text, sector: "Finance and banking", stage: "Final year, graduate roles" });
    const rid = uid();
    // The oldest upload is kept in the v0 shape, so demo mode always has one historical report to read through the adapter.
    reports.push({ row: { id: rid, type: "cv_review", title: cv.fileName, score: payload.analysis.score, createdAt: cv.date }, payload: cv === DEMO_CVS[0] ? legacyShape(payload) : payload });
    latestCvId = rid;
    latestCv = payload;
  }
  const northbank = SAMPLE_OPPORTUNITIES[0];
  const tailor = buildTailorPayload({ cvReportId: latestCvId, cvFileName: latestCv!.fileName, cvText: latestCv!.text, jobTitle: northbank.role, employer: northbank.org, jobUrl: null, jobText: northbank.description, deadline: northbank.closesOn });
  const tailorId = uid();
  reports.push({ row: { id: tailorId, type: "tailor", title: `${northbank.role} · ${northbank.org}`, score: tailor.matchNow, createdAt: "2026-10-24T13:10:00Z" }, payload: tailor });
  const letter = buildLetterReviewPayload({ letterText: DEMO_LETTER, jobTitle: northbank.role, employer: northbank.org, jobText: northbank.description, tailorReportId: tailorId, cvReportId: latestCvId, cvFileName: latestCv!.fileName, cvText: latestCv!.text });
  reports.push({ row: { id: uid(), type: "cover_letter", title: `${northbank.org} cover letter`, score: letter.score, createdAt: "2026-10-24T16:45:00Z" }, payload: letter.payload });

  const app = (oppId: string, status: AppStatus, updatedAt: string): Application => {
    const o = SAMPLE_OPPORTUNITIES.find((x) => x.id === oppId)!;
    return { id: uid(), opportunityId: o.id, role: o.role, org: o.org, status, closesOn: o.closesOn, updatedAt };
  };
  return {
    profile: baseProfile(id, "student"),
    reports,
    sources: [],
    applications: [
      app("opp-harlow-spring", "saved", "2026-10-20T10:00:00Z"),
      app("opp-northbank-analyst", "applied", "2026-10-24T10:00:00Z"),
      app("opp-mercer-accountant", "applied", "2026-10-20T10:00:00Z"),
      app("opp-calder-risk", "tests", "2026-10-23T10:00:00Z"),
      app("opp-ashby-consulting", "interview", "2026-10-22T10:00:00Z"),
    ],
    ai: {},
  };
}

function db(): DemoDb {
  return (g.__offerpathDemo ??= { users: {}, aiTotal: {}, opps: SAMPLE_OPPORTUNITIES.map((o) => ({ ...o, own: false })), studentRecords: {}, pendingAdmins: [], extraAdmins: [], notes: [] });
}

function user(id: string, role: Role): DemoUser {
  const d = db();
  return (d.users[id] ??= role !== "student" ? { profile: baseProfile(id, role), reports: [], sources: [], applications: [], ai: {} } : seedStudent(id));
}

/** Gives one use back, and optionally counts the failure that caused it. */
function releaseUse(id: string, role: Role, use: { kind: AiKind; day: string }, failed: boolean) {
  const usr = user(id, role);
  const k = `${use.day}:${use.kind}`;
  usr.ai[k] = Math.max((usr.ai[k] ?? 0) - 1, 0);
  db().aiTotal[k] = Math.max((db().aiTotal[k] ?? 0) - 1, 0);
  if (failed) (usr.aiFailed ??= {})[k] = (usr.aiFailed[k] ?? 0) + 1;
}

export function resetDemoUser(id: string) {
  delete db().users[id];
}

/** Off by default, as for a university. Demo mode has no institution table, so this one variable stands in for the setting. */
const demoSharingOn = () => process.env.DEMO_REPORT_SHARING === "true";

/** The same rules as share_link_lookup and share_link_record_access. It never seeds a user, so a deleted account stays gone. */
export const demoShareBackend: ShareBackend = {
  async lookup(tokenHash) {
    if (!demoSharingOn()) return null;
    for (const usr of Object.values(db().users)) {
      const link = usr.shareLinks?.find((l) => l.tokenHash === tokenHash);
      if (!link) continue;
      const report = usr.reports.find((r) => r.row.id === link.reportId);
      if (!report || link.revokedAt || new Date(link.expiresAt).getTime() <= Date.now() || usr.profile.role !== "student") return null;
      return { linkId: link.id, scope: link.scope, digest: link.contentDigest, type: report.row.type, createdAt: report.row.createdAt, payload: structuredClone(report.payload) };
    }
    return null;
  },
  async recordAccess(linkId) {
    if (!demoSharingOn()) return false;
    for (const usr of Object.values(db().users)) {
      const link = usr.shareLinks?.find((l) => l.id === linkId);
      if (!link) continue;
      if (link.revokedAt || new Date(link.expiresAt).getTime() <= Date.now()) return false;
      link.accesses.unshift(new Date().toISOString());
      return true;
    }
    return false;
  },
};

export function demoRepo(userId: string, role: Role): Repo {
  const u = () => user(userId, role);
  const staffOnly = () => {
    if (u().profile.role !== "admin" && u().profile.role !== "adviser") throw new Error("careers staff only");
  };
  const adminsOnly = () => {
    if (u().profile.role !== "admin") throw new Error("admins only");
  };
  // Institution rules live in demo-institution.ts. Withdrawing consent as the sample student hides them from staff at once.
  const institutionCtx: DemoContext = {
    profile: () => ({ ...u().profile }),
    sampleUniversityId: DEMO_UNIVERSITY.id,
    sharing: (key) => !Object.values(db().users).some((x) => x.profile.role === "student" && x.profile.studentNumber === key && !x.profile.shareProgress),
    people: (uni) => Object.values(db().users).map((x) => x.profile).filter((p) => p.universityId === uni),
    setRole: (id, next) => {
      if (db().users[id]) db().users[id].profile.role = next;
    },
    setReportSharing: () => {
      process.env.DEMO_REPORT_SHARING = "";
    },
    reportSharing: () => demoSharingOn(),
  };
  const sorted = (type?: ReportType) => u().reports.filter((r) => !type || r.row.type === type).sort((a, b) => b.row.createdAt.localeCompare(a.row.createdAt));
  const toSource = (d: DemoSource): CvSource => ({ ...structuredClone(d.source), hasFile: !!d.file, reportId: u().reports.find((r) => r.row.sourceId === d.source.id)?.row.id ?? null });

  return {
    ...demoInstitutionMethods(institutionCtx),
    mode: "demo",
    userId,
    async profile() {
      return { ...u().profile };
    },
    async updateProfile(patch) {
      Object.assign(u().profile, patch);
    },
    async listReports({ type, q, offset = 0, limit = 50 }) {
      let rows = sorted(type).map((r) => (r.row.type === "cv_review" ? { ...r.row, scoring: scoreContext(seriesFields(r.payload)) } : r.row));
      if (q) rows = rows.filter((r) => `${r.title} ${r.score ?? ""}`.toLowerCase().includes(q.toLowerCase()));
      return { rows: rows.slice(offset, offset + limit), total: rows.length };
    },
    async getReport<P>(id: string) {
      const r = u().reports.find((x) => x.row.id === id);
      return r ? ({ row: { ...r.row }, payload: fromStored(r.row.type, structuredClone(r.payload)) as P } satisfies StoredReport<P>) : null;
    },
    async latestReport<P>(type: ReportType) {
      const r = sorted(type)[0];
      return r ? { row: { ...r.row }, payload: fromStored(r.row.type, structuredClone(r.payload)) as P } : null;
    },
    async createReport({ type, title, score, payload, source }) {
      checkReportRow(type, { score, source });
      const stored = toStored(type, payload);
      if (source) {
        // The version has to be this user's, and is scored at most once: a repeat returns the report that exists.
        if (!u().sources.some((s) => s.source.id === source.id)) throw new Error("Document not found");
        const existing = u().reports.find((r) => r.row.sourceId === source.id);
        if (existing) return existing.row.id;
      }
      const id = uid();
      u().reports.push({ row: { id, type, title, score, createdAt: new Date().toISOString(), sourceId: source?.id ?? null }, payload: stored });
      return id;
    },
    async createSource(input: SourceInput) {
      const text = input.text;
      const documentVersion = sha256(text);
      const document = input.document ? checkDocument(input.document, text) : null;
      const mine = u().sources;
      const byKey = input.idempotencyKey ? mine.find((s) => s.idempotencyKey === input.idempotencyKey) : undefined;
      if (byKey) {
        if (!sameAttempt(byKey.source, { documentVersion, parentId: input.parentId, kind: input.kind })) throw new SourceConflictError();
        return toSource(byKey);
      }
      if (input.parentId) {
        if (!mine.some((s) => s.source.id === input.parentId)) throw new Error("Document not found");
        const same = mine.find((s) => s.source.parentId === input.parentId && s.source.documentVersion === documentVersion);
        if (same) return toSource(same);
      }
      const row: DemoSource = {
        source: { id: uid(), parentId: input.parentId, kind: input.kind, fileName: input.fileName, text, documentVersion, document, outcome: input.outcome, storagePath: null, createdAt: new Date().toISOString() },
        file: input.file ? { name: input.file.name, bytes: new Uint8Array(input.file.bytes), contentType: input.file.contentType } : undefined,
        idempotencyKey: input.idempotencyKey,
      };
      mine.push(row);
      return toSource(row);
    },
    async getSource(id) {
      const s = u().sources.find((x) => x.source.id === id);
      return s ? toSource(s) : null;
    },
    async listSources() {
      return u()
        .sources.map(toSource)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async sourceFile(id) {
      const s = u().sources.find((x) => x.source.id === id);
      return s?.file ? { name: s.file.name, bytes: new Uint8Array(s.file.bytes), contentType: s.file.contentType } : null;
    },
    async updateReport(id, patch, options) {
      const r = u().reports.find((x) => x.row.id === id);
      if (!r) throw new Error("Report not found");
      if (options && ((r.payload as { editRevision?: number }).editRevision ?? null) !== options.ifRevision) throw new ReportConflictError();
      if (patch.score != null) checkReportRow(r.row.type, { score: patch.score });
      if (patch.payload !== undefined) r.payload = toStored(r.row.type, patch.payload);
      if (patch.title !== undefined) r.row.title = patch.title;
      if (patch.score !== undefined) r.row.score = patch.score;
    },
    async proofreadingChoices(documentVersion) {
      return structuredClone((u().choices ?? []).filter((c) => documentVersion === undefined || c.documentVersion === documentVersion));
    },
    async recordProofreadingChoice(input) {
      const report = u().reports.find((x) => x.row.id === input.reportId && x.row.type === "cv_review");
      const choice: ProofreadingChoice = { id: uid(), actor: "student", createdAt: new Date().toISOString(), ...choiceFor(report ? (fromStored("cv_review", structuredClone(report.payload)) as CvReviewPayload) : null, input) };
      (u().choices ??= []).push(choice);
      return structuredClone(choice);
    },
    async proofreadingLanguagePreference() {
      return (u().choices ?? []).findLast((c) => c.kind === "language")?.language ?? null;
    },
    async opportunities() {
      return [...db().opps].sort((a, b) => a.closesOn.localeCompare(b.closesOn));
    },
    async applications() {
      return [...u().applications];
    },
    async track(opportunityId) {
      if (u().applications.some((a) => a.opportunityId === opportunityId)) return;
      const o = db().opps.find((x) => x.id === opportunityId);
      if (!o) throw new Error("Opportunity not found");
      u().applications.push({ id: uid(), opportunityId, role: o.role, org: o.org, status: "saved", closesOn: o.closesOn, updatedAt: new Date().toISOString() });
    },
    async untrack(opportunityId) {
      const gone = new Set(u().applications.filter((a) => a.opportunityId === opportunityId).map((a) => a.id));
      u().applications = u().applications.filter((a) => !gone.has(a.id));
      u().links = (u().links ?? []).filter((l) => !gone.has(l.applicationId));
      for (const a of u().practice ?? []) if (a.applicationId && gone.has(a.applicationId)) a.applicationId = null;
    },
    async setApplicationStatus(applicationId, status) {
      const a = u().applications.find((x) => x.id === applicationId);
      if (a) {
        a.status = status;
        a.updatedAt = new Date().toISOString();
      }
    },
    async workspaceReports({ limit, ids = [] }) {
      const newest = limit ? sorted().slice(0, limit) : [];
      const extra = u().reports.filter((r) => ids.includes(r.row.id) && !newest.includes(r));
      return [...newest, ...extra].map((r): WorkspaceReport => {
        try {
          return { row: { ...r.row }, payload: fromStored(r.row.type, structuredClone(r.payload)) };
        } catch {
          return { row: { ...r.row }, payload: null };
        }
      });
    },
    async applicationLinks() {
      return structuredClone(u().links ?? []);
    },
    async setApplicationLink({ applicationId, reportId, documentVersion, ifCurrent }) {
      const report = u().reports.find((r) => r.row.id === reportId);
      const kind = report ? ARTEFACT_KIND_FOR[report.row.type] : undefined;
      if (!kind || !u().applications.some((a) => a.id === applicationId)) throw new LinkRefusedError();
      const links = (u().links ??= []);
      const existing = links.find((l) => l.applicationId === applicationId && l.kind === kind);
      // The same request again (a double click, a retry after a lost reply) has nothing to change.
      if (existing && existing.reportId === reportId && existing.documentVersion === documentVersion) return structuredClone(existing);
      if (ifCurrent !== undefined && (existing?.reportId ?? null) !== ifCurrent) throw new LinkConflictError();
      const now = new Date().toISOString();
      if (existing) {
        Object.assign(existing, { reportId, documentVersion, updatedAt: now });
        return structuredClone(existing);
      }
      const link: ApplicationLink = { id: uid(), applicationId, reportId, kind, documentVersion, createdAt: now, updatedAt: now };
      links.push(link);
      return structuredClone(link);
    },
    async removeApplicationLink({ applicationId, kind, ifCurrent }) {
      const existing = u().links?.find((l) => l.applicationId === applicationId && l.kind === kind);
      if (!existing) return;
      if (existing.reportId !== ifCurrent) throw new LinkConflictError();
      u().links = u().links!.filter((l) => l !== existing);
    },
    async trackRole({ reportId, role: jobRole, org, closesOn }) {
      if (!u().reports.some((r) => r.row.id === reportId)) throw new LinkRefusedError();
      const sources = (u().applicationSources ??= {});
      const same = u().applications.find((a) => sources[a.id] === reportId);
      if (same) return { ...same };
      const app: Application = { id: uid(), opportunityId: null, role: jobRole, org, status: "saved", closesOn, updatedAt: new Date().toISOString() };
      u().applications.push(app);
      sources[app.id] = reportId;
      return { ...app };
    },
    async removeApplication(applicationId) {
      u().applications = u().applications.filter((a) => a.id !== applicationId);
      u().links = (u().links ?? []).filter((l) => l.applicationId !== applicationId);
      for (const a of u().practice ?? []) if (a.applicationId === applicationId) a.applicationId = null;
    },
    async recordDownload({ reportId, documentVersion, format }) {
      if (!u().reports.some((r) => r.row.id === reportId)) throw new Error("Report not found");
      const list = (u().downloads ??= []);
      const now = new Date().toISOString();
      const same = list.find((d) => d.reportId === reportId && d.documentVersion === documentVersion);
      if (same) Object.assign(same, { format, lastAt: now });
      else list.push({ id: uid(), reportId, documentVersion, format, firstAt: now, lastAt: now });
    },
    async artefactDownloads() {
      return (u().downloads ?? []).map(({ reportId, documentVersion, format, firstAt, lastAt }) => ({ reportId, documentVersion, format, firstAt, lastAt }));
    },
    async actionChoices() {
      return structuredClone(u().actionChoices ?? []);
    },
    async recordActionChoice({ actionKey, kind, reason }) {
      const choice: ActionChoice = { id: uid(), actionKey, kind, reason, createdAt: new Date().toISOString() };
      (u().actionChoices ??= []).push(choice);
      return structuredClone(choice);
    },
    async practiceAnswers(opts = {}) {
      const newestFirst = [...(u().practice ?? [])].reverse();
      return structuredClone(newestFirst.filter((a) => (!opts.attemptKey || a.attemptKey === opts.attemptKey) && (!opts.applicationId || a.applicationId === opts.applicationId)));
    },
    async savePracticeAnswer(raw) {
      const input = checkPracticeInput(raw);
      const list = (u().practice ??= []);
      const same = list.find((a) => a.attemptKey === input.attemptKey);
      if (same) return structuredClone(same);
      const isMine = (id: string | null, types: ReportType[]) => id === null || u().reports.some((r) => r.row.id === id && types.includes(r.row.type));
      if (input.applicationId && !u().applications.some((a) => a.id === input.applicationId)) throw new PracticeRefusedError("not this student's application");
      if (!isMine(input.documentReportId, ["cv_review", "tailor"]) || !isMine(input.advertReportId, ["tailor"])) throw new PracticeRefusedError("not this student's report");
      const saved: PracticeAnswer = { ...structuredClone(input), id: uid(), createdAt: new Date().toISOString() };
      list.push(saved);
      return structuredClone(saved);
    },
    async deletePracticeAnswer(id) {
      const list = u().practice ?? [];
      const kept = list.filter((a) => a.id !== id);
      u().practice = kept;
      return kept.length !== list.length;
    },
    async aiUsedToday(kind: AiKind) {
      return u().ai[`${today()}:${kind}`] ?? 0;
    },
    async bumpAi(kind: AiKind) {
      const k = `${today()}:${kind}`;
      u().ai[k] = (u().ai[k] ?? 0) + 1;
      const total = (db().aiTotal[k] = (db().aiTotal[k] ?? 0) + 1);
      return total > DEMO_DAILY_AI_TOTAL[kind] ? Number.MAX_SAFE_INTEGER : u().ai[k];
    },
    async claimJob({ workflow, key, freshSeconds }): Promise<ClaimResult> {
      const jobs = (db().jobs ??= []);
      const now = Date.now();
      const publicJob = (j: DemoJob): AnalysisJob => ({ id: j.id, workflow: j.workflow, status: j.status, attempts: j.attempts, failures: j.failures, consecutiveFailures: j.consecutiveFailures, resultId: j.resultId, result: j.result, errorCode: j.errorCode, charged: !!j.chargedKey, finishedAt: j.finishedAt, createdAt: j.createdAt });
      for (const j of jobs) {
        if (j.userId !== userId) continue;
        if (j.status === "processing" && j.leaseExpiresAt! < now) {
          if (j.chargedKey) releaseUse(userId, role, j.chargedKey, true);
          Object.assign(j, { status: "failed", errorCode: "abandoned", failures: j.failures + 1, consecutiveFailures: j.consecutiveFailures + 1, chargedKey: null, charged: false, leaseExpiresAt: null, finishedAt: new Date().toISOString(), finishedMs: now, updatedAt: now });
        } else if (j.status === "queued" && j.updatedAt < now - JOB_POLICY.queuedExpirySeconds * 1000) {
          Object.assign(j, { status: "failed", errorCode: "abandoned", finishedAt: new Date().toISOString(), finishedMs: now, updatedAt: now });
        }
      }
      let j = jobs.find((x) => x.userId === userId && x.workflow === workflow && x.key === key);
      if (j && (j.status === "completed" || j.status === "partial")) {
        if (freshSeconds === null || j.finishedMs! >= now - freshSeconds * 1000) return { outcome: "replay", job: publicJob(j) };
        j.key = `${key}#${j.id}`;
        j = undefined;
      } else if (j?.status === "processing") {
        return { outcome: "in_progress", job: publicJob(j) };
      } else if (j?.status === "failed" && j.consecutiveFailures >= JOB_POLICY.maxConsecutiveFailures && j.finishedMs! > now - JOB_POLICY.cooldownSeconds * 1000) {
        return { outcome: "cooling_down", job: publicJob(j), retryAfterSeconds: Math.ceil((j.finishedMs! + JOB_POLICY.cooldownSeconds * 1000 - now) / 1000) };
      }
      if (!j) {
        j = { id: uid(), userId, key, workflow, status: "queued", attempts: 0, failures: 0, consecutiveFailures: 0, resultId: null, result: null, errorCode: null, charged: false, finishedAt: null, createdAt: new Date().toISOString(), leaseExpiresAt: null, chargedKey: null, updatedAt: now, finishedMs: null };
        jobs.push(j);
      }
      if (jobs.filter((x) => x.userId === userId && x.status === "processing").length >= JOB_POLICY.maxActivePerUser) return { outcome: "busy", scope: "user", job: publicJob(j) };
      if (jobs.filter((x) => x.status === "processing" && x.leaseExpiresAt! >= now).length >= JOB_POLICY.maxActiveGlobal) return { outcome: "busy", scope: "global", job: publicJob(j) };
      Object.assign(j, { status: "processing", attempts: j.attempts + 1, leaseExpiresAt: now + JOB_POLICY.leaseSeconds * 1000, errorCode: null, finishedAt: null, finishedMs: null, updatedAt: now });
      // Finished jobs have no further use here, and this store lasts as long as the process.
      if (jobs.length > 5_000) db().jobs = jobs.filter((x) => x.status === "processing" || x.status === "queued" || x.updatedAt > now - 3_600_000);
      return { outcome: "claimed", job: publicJob(j) };
    },
    async chargeJob(job, kind, limit, failedLimit) {
      const j = db().jobs?.find((x) => x.id === job.id && x.userId === userId);
      if (!j || j.status !== "processing" || j.attempts !== job.attempt) throw new Error("job not running");
      if (j.chargedKey) return { allowed: true, used: u().ai[`${j.chargedKey.day}:${j.chargedKey.kind}`] ?? 0 };
      const day = today();
      if ((u().aiFailed?.[`${day}:${kind}`] ?? 0) >= failedLimit) return { allowed: false, reason: "failed_cap", used: 0 };
      // Through bumpAi, so the demo server's own daily total applies as well.
      const used = await this.bumpAi(kind);
      if (used > limit) {
        releaseUse(userId, role, { kind, day }, false);
        return { allowed: false, reason: "limit", used: limit };
      }
      j.chargedKey = { kind, day };
      j.charged = true;
      j.updatedAt = Date.now();
      return { allowed: true, used };
    },
    async finishJob(job, f) {
      const j = db().jobs?.find((x) => x.id === job.id && x.userId === userId);
      if (!j || j.status !== "processing" || j.attempts !== job.attempt) return false;
      if (f.release && j.chargedKey) {
        releaseUse(userId, role, j.chargedKey, f.usage.calls > 0);
        j.chargedKey = null;
        j.charged = false;
      }
      const now = Date.now();
      Object.assign(j, { status: f.status, resultId: f.resultId ?? null, result: f.result ?? null, errorCode: f.errorCode ?? null, leaseExpiresAt: null, failures: j.failures + (f.countFailure ? 1 : 0), consecutiveFailures: f.status === "failed" ? j.consecutiveFailures + (f.countFailure ? 1 : 0) : 0, finishedAt: new Date(now).toISOString(), finishedMs: now, updatedAt: now });
      return true;
    },
    async getJob(id) {
      const j = db().jobs?.find((x) => x.id === id && x.userId === userId);
      return j ? { id: j.id, workflow: j.workflow, status: j.status, attempts: j.attempts, failures: j.failures, consecutiveFailures: j.consecutiveFailures, resultId: j.resultId, result: j.result, errorCode: j.errorCode, charged: !!j.chargedKey, finishedAt: j.finishedAt, createdAt: j.createdAt } : null;
    },
    async sharingEnabled() {
      return demoSharingOn() && u().profile.role === "student";
    },
    async createShareLink({ reportId, tokenHash, scope, contentDigest, expiresAt }) {
      if (!(await this.sharingEnabled())) throw new Error("sharing is not available");
      const report = u().reports.find((r) => r.row.id === reportId);
      if (!report || report.row.type !== "cv_review") throw new Error("report not found");
      const now = Date.now();
      const until = new Date(expiresAt).getTime();
      if (!(until > now && until <= now + 30 * 864e5)) throw new Error("expiry out of range");
      const id = uid();
      (u().shareLinks ??= []).push({ id, reportId, tokenHash, scope, contentDigest, createdAt: new Date(now).toISOString(), expiresAt, revokedAt: null, accesses: [] });
      return id;
    },
    async shareLinks() {
      return [...(u().shareLinks ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((l) => structuredClone({ id: l.id, reportId: l.reportId, scope: l.scope, contentDigest: l.contentDigest, createdAt: l.createdAt, expiresAt: l.expiresAt, revokedAt: l.revokedAt, accesses: l.accesses }));
    },
    async revokeShareLink(id) {
      const link = u().shareLinks?.find((l) => l.id === id);
      if (!link) return false;
      link.revokedAt ??= new Date().toISOString();
      return true;
    },
    async counts() {
      const r = u().reports;
      return { cvs: r.filter((x) => x.row.type === "cv_review").length, reports: r.length, letters: r.filter((x) => x.row.type === "cover_letter").length, linkedin: r.filter((x) => x.row.type === "linkedin").length, applications: u().applications.length };
    },
    async exportFiles() {
      return u()
        .sources.filter((s) => s.file)
        .map((s) => ({ name: s.file!.name, bytes: s.file!.bytes }));
    },
    async deleteAccount() {
      resetDemoUser(userId);
    },
    async adminAnalytics(periodKey) {
      adminsOnly();
      const period = listPeriods().find((p) => p.key === periodKey);
      if (!period) throw new Error("unknown reporting period");
      return sampleAnalytics(DEMO_UNIVERSITY.name, period);
    },
    async adminStudents(q = {}) {
      staffOnly();
      const all: AdminStudent[] = ADMIN_SAMPLE.students.filter((s) => demoStaffCanSee(institutionCtx, u().profile, s.id));
      const search = (q.search ?? "").toLowerCase();
      const base = all.filter((s) => (!q.faculty || s.faculty === q.faculty) && (!search || `${s.id} ${s.course}`.toLowerCase().includes(search)));
      const pass = (s: AdminStudent) => (q.filter === "needs" ? !!s.flag : q.filter === "home" ? s.status === "Home" : q.filter === "international" ? s.status === "International" : true);
      const filtered = base.filter(pass);
      const offset = q.offset ?? 0;
      return {
        total: filtered.length,
        counts: { all: base.length, needs: base.filter((s) => !!s.flag).length, home: base.filter((s) => s.status === "Home").length, international: base.filter((s) => s.status === "International").length },
        faculties: [...new Set(all.map((s) => s.faculty))].sort(),
        rows: filtered.slice(offset, offset + (q.limit ?? 50)).map((s) => ({ ...s, key: s.id })),
      };
    },
    async adminUniversity() {
      staffOnly();
      return { name: DEMO_UNIVERSITY.name, domain: DEMO_UNIVERSITY.domain };
    },
    async importStudentRecords(rows): Promise<ImportResult> {
      const skipped: ImportResult["skipped"] = [];
      let saved = 0;
      rows.forEach((r, i) => {
        const email = (r.email ?? "").trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+$/.test(email)) return skipped.push({ row: i + 1, reason: "missing or invalid email" });
        const domain = email.split("@")[1];
        if (domain !== DEMO_UNIVERSITY.domain && !domain.endsWith(`.${DEMO_UNIVERSITY.domain}`)) return skipped.push({ row: i + 1, reason: "email is not at your university" });
        db().studentRecords[email] = { student_number: r.student_number, course: r.course, year_of_study: r.year_of_study, faculty: r.faculty, fee_status: r.fee_status };
        saved++;
      });
      return { saved, appliedToAccounts: 0, skipped };
    },
    async adminTeam() {
      return { admins: [{ email: u().profile.email, name: u().profile.fullName, you: true }, ...db().extraAdmins.map((a) => ({ ...a, you: false }))], pending: [...db().pendingAdmins] };
    },
    async setAdminRole(email, admin) {
      const e = email.trim().toLowerCase();
      const domain = e.split("@")[1] ?? "";
      if (domain !== DEMO_UNIVERSITY.domain && !domain.endsWith(`.${DEMO_UNIVERSITY.domain}`)) throw new Error("That email address is not at your university");
      if (admin) {
        if (!db().pendingAdmins.some((p) => p.email === e) && e !== u().profile.email) db().pendingAdmins.push({ email: e, invitedAt: new Date().toISOString() });
        return "invited";
      }
      if (e === u().profile.email && db().extraAdmins.length === 0) throw new Error("Your university needs at least one careers admin");
      db().pendingAdmins = db().pendingAdmins.filter((p) => p.email !== e);
      db().extraAdmins = db().extraAdmins.filter((p) => p.email !== e);
      return "removed";
    },
    async adminOpportunities() {
      return [...db().opps].sort((a, b) => Number(b.own) - Number(a.own) || a.closesOn.localeCompare(b.closesOn));
    },
    async saveOpportunity(o) {
      const existing = o.id ? db().opps.find((x) => x.id === o.id) : undefined;
      if (existing && !existing.own) throw new Error("Shared listings can't be edited");
      const id = existing?.id ?? `opp-${crypto.randomUUID()}`;
      const next = { ...o, id, own: true };
      db().opps = existing ? db().opps.map((x) => (x.id === id ? next : x)) : [...db().opps, next];
      return id;
    },
    async adminStudentDetail(key) {
      staffOnly();
      const s = ADMIN_SAMPLE.students.find((x) => x.id === key);
      const visible = demoStaffCanSee(institutionCtx, u().profile, key);
      demoRecordView(institutionCtx, u().profile, key, visible);
      if (!s || !visible) return null;
      // Sample students have a score but no stored reports or files in demo mode.
      const reportId = `sample-${s.id}`;
      return {
        key: s.id, studentNumber: s.id, name: "Sample student", course: s.course, year: s.year, faculty: s.faculty, feeStatus: s.status.toLowerCase(),
        stage: null, sectors: [], cvSharing: false, lastActive: new Date().toISOString(),
        reports: s.score === null ? [] : [{ id: reportId, title: "Latest CV", score: s.score, createdAt: new Date().toISOString(), areas: (Object.keys(AREA_LABELS) as (keyof typeof AREA_LABELS)[]).map((k) => ({ key: k, name: AREA_LABELS[k], score: s.score! })), hasFile: false }],
        notes: db().notes.filter((n) => n.reportId === reportId),
        ...demoCaseworkFor(institutionCtx, u().profile, key),
      };
    },
    async adminAddNote(reportId, note) {
      staffOnly();
      const key = reportId.replace(/^sample-/, "");
      const visible = reportId.startsWith("sample-") && demoStaffCanSee(institutionCtx, u().profile, key);
      if (!visible) throw new Error("report not found");
      demoRecordNote(institutionCtx, u().profile, key);
      db().notes.unshift({ id: crypto.randomUUID(), reportId, author: u().profile.fullName, note, createdAt: new Date().toISOString() });
    },
    async adminCvLink() {
      return null;
    },
    async myAdviserNotes() {
      // The demo student is also sample student 2104821, so that a note left as the demo adviser reaches them.
      const mine = new Set([...u().reports.map((r) => r.row.id), ...(u().profile.studentNumber ? [`sample-${u().profile.studentNumber}`] : [])]);
      return db().notes.filter((n) => mine.has(n.reportId));
    },
    async deleteOpportunity(id) {
      const existing = db().opps.find((x) => x.id === id);
      if (!existing?.own) throw new Error("Shared listings can't be removed");
      db().opps = db().opps.filter((x) => x.id !== id);
    },
  };
}
