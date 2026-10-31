import "server-only";
import { ADMIN_SAMPLE, DEMO_CVS, DEMO_LETTER, DEMO_UNIVERSITY, SAMPLE_OPPORTUNITIES } from "@/lib/seed-data";
import { buildCvPayload, buildLetterReviewPayload, buildTailorPayload } from "@/lib/services";
import type { Application, AppStatus, CvReviewPayload, Opportunity, Profile, ReportRow, ReportType } from "@/lib/types";
import type { AdminOverview, AdminStudent, AdviserNote, AiKind, ImportResult, OutcomeRow, Repo, StoredReport } from "./types";

// In-memory store for demo mode (no Supabase configured). Lives for the life of the server process.

interface DemoReport {
  row: ReportRow;
  payload: unknown;
  file?: { name: string; bytes: Uint8Array };
}

interface DemoUser {
  profile: Profile;
  reports: DemoReport[];
  applications: Application[];
  ai: Record<string, number>; // `${day}:${kind}` -> count
}

interface DemoDb {
  users: Record<string, DemoUser>;
  aiTotal: Record<string, number>; // `${day}:${kind}` across all demo visitors
  opps: Opportunity[]; // shared sample listings plus ones the demo admin adds
  studentRecords: Record<string, { student_number?: string; course?: string; year_of_study?: string; faculty?: string; fee_status?: string }>;
  pendingAdmins: { email: string; invitedAt: string }[];
  extraAdmins: { email: string; name: string }[];
  notes: AdviserNote[];
}

// Demo identities are free to create, so per-visitor limits alone can't bound AI spend.
// These caps apply to the whole demo server per day.
const DEMO_DAILY_AI_TOTAL: Record<AiKind, number> = { cv_score: 100, line_rewrite: 300, letter: 50, tailor: 50 };

const g = globalThis as unknown as { __offerpathDemo?: DemoDb };
const uid = () => crypto.randomUUID();
const today = () => new Date().toISOString().slice(0, 10);

function baseProfile(id: string, role: "student" | "admin"): Profile {
  return role === "admin"
    ? { id, fullName: "Sam Price", email: "sam.price@northfield.ac.uk", role, universityId: DEMO_UNIVERSITY.id, universityName: DEMO_UNIVERSITY.name, stage: null, sectors: [], visaSponsorship: false, deadlineReminders: false, shareProgress: false, adviserCanViewCv: false, onboarded: true, course: null, yearOfStudy: null, feeStatus: null, faculty: null, studentNumber: null }
    : { id, fullName: "Jordan Reed", email: "jordan.reed@northfield.ac.uk", role, universityId: DEMO_UNIVERSITY.id, universityName: DEMO_UNIVERSITY.name, stage: null, sectors: [], visaSponsorship: false, deadlineReminders: true, shareProgress: true, adviserCanViewCv: false, onboarded: false, course: "Economics", yearOfStudy: "Year 3", feeStatus: "home", faculty: "Social sciences", studentNumber: "2104821" };
}

function seedStudent(id: string): DemoUser {
  const reports: DemoReport[] = [];
  let latestCvId = "";
  let latestCv: CvReviewPayload | null = null;
  for (const cv of DEMO_CVS) {
    const payload = buildCvPayload({ fileName: cv.fileName, text: cv.text, sector: "Finance and banking", stage: "Final year, graduate roles" });
    const rid = uid();
    reports.push({ row: { id: rid, type: "cv_review", title: cv.fileName, score: payload.analysis.score, createdAt: cv.date }, payload });
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

function user(id: string, role: "student" | "admin"): DemoUser {
  const d = db();
  return (d.users[id] ??= role === "admin" ? { profile: baseProfile(id, "admin"), reports: [], applications: [], ai: {} } : seedStudent(id));
}

export function resetDemoUser(id: string) {
  delete db().users[id];
}

export function demoRepo(userId: string, role: "student" | "admin"): Repo {
  const u = () => user(userId, role);
  const sorted = (type?: ReportType) => u().reports.filter((r) => !type || r.row.type === type).sort((a, b) => b.row.createdAt.localeCompare(a.row.createdAt));

  return {
    mode: "demo",
    userId,
    async profile() {
      return { ...u().profile };
    },
    async updateProfile(patch) {
      Object.assign(u().profile, patch);
    },
    async listReports({ type, q, offset = 0, limit = 50 }) {
      let rows = sorted(type).map((r) => r.row);
      if (q) rows = rows.filter((r) => `${r.title} ${r.score ?? ""}`.toLowerCase().includes(q.toLowerCase()));
      return { rows: rows.slice(offset, offset + limit), total: rows.length };
    },
    async getReport<P>(id: string) {
      const r = u().reports.find((x) => x.row.id === id);
      return r ? ({ row: { ...r.row }, payload: structuredClone(r.payload) as P } satisfies StoredReport<P>) : null;
    },
    async latestReport<P>(type: ReportType) {
      const r = sorted(type)[0];
      return r ? { row: { ...r.row }, payload: structuredClone(r.payload) as P } : null;
    },
    async createReport({ type, title, score, payload, file }) {
      const id = uid();
      u().reports.push({ row: { id, type, title, score, createdAt: new Date().toISOString() }, payload: structuredClone(payload), file: file ? { name: file.name, bytes: file.bytes } : undefined });
      return id;
    },
    async updateReport(id, patch) {
      const r = u().reports.find((x) => x.row.id === id);
      if (!r) throw new Error("Report not found");
      if (patch.title !== undefined) r.row.title = patch.title;
      if (patch.score !== undefined) r.row.score = patch.score;
      if (patch.payload !== undefined) r.payload = structuredClone(patch.payload);
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
      u().applications = u().applications.filter((a) => a.opportunityId !== opportunityId);
    },
    async setApplicationStatus(applicationId, status) {
      const a = u().applications.find((x) => x.id === applicationId);
      if (a) {
        a.status = status;
        a.updatedAt = new Date().toISOString();
      }
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
    async counts() {
      const r = u().reports;
      return { cvs: r.filter((x) => x.row.type === "cv_review").length, reports: r.length, letters: r.filter((x) => x.row.type === "cover_letter").length, applications: u().applications.length };
    },
    async exportFiles() {
      return u().reports.filter((r) => r.file).map((r) => ({ name: r.file!.name, bytes: r.file!.bytes }));
    },
    async deleteAccount() {
      resetDemoUser(userId);
    },
    async adminOverview(): Promise<AdminOverview> {
      return { universityName: DEMO_UNIVERSITY.name, sample: true, ...ADMIN_SAMPLE };
    },
    async adminStudents(q = {}) {
      const all: AdminStudent[] = ADMIN_SAMPLE.students;
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
    async adminOutcomesPack(): Promise<OutcomeRow[]> {
      const k = ADMIN_SAMPLE.kpis;
      return [
        { dimension: "All students", group: "All", students: k.activeStudents, uploadedCv: 1206, reuploaded: 842, improved10: 611, strongOrBetter: 558, trackedApplications: 903, reachedInterview: 287, receivedOffer: 96, avgScore: k.avgScore, avgImprovement: k.avgImprovement },
        ...ADMIN_SAMPLE.faculties.map((f, i) => ({ dimension: "Faculty", group: f.name, students: [310, 268, 244, 251, 167][i], uploadedCv: [301, 259, 236, 243, 160][i], reuploaded: [214, 180, 168, 171, 109][i], improved10: [160, 128, 121, 132, 70][i], strongOrBetter: [151, 117, 112, 108, 70][i], trackedApplications: [240, 196, 170, 182, 115][i], reachedInterview: [82, 61, 55, 57, 32][i], receivedOffer: [30, 20, 18, 17, 11][i], avgScore: f.avg, avgImprovement: f.improvement })),
        { dimension: "Fee status", group: "Home", students: 870, uploadedCv: 845, reuploaded: 580, improved10: 421, strongOrBetter: 401, trackedApplications: 620, reachedInterview: 205, receivedOffer: 71, avgScore: 72, avgImprovement: 14 },
        { dimension: "Fee status", group: "International", students: 370, uploadedCv: 361, reuploaded: 262, improved10: 190, strongOrBetter: 157, trackedApplications: 283, reachedInterview: 82, receivedOffer: 25, avgScore: 68, avgImprovement: 15 },
        { dimension: "Year of study", group: "Year 4", suppressed: true },
      ];
    },
    async adminUniversity() {
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
      const s = ADMIN_SAMPLE.students.find((x) => x.id === key);
      if (!s) return null;
      // Sample students have a score but no stored reports or files in demo mode.
      const reportId = `sample-${s.id}`;
      return {
        key: s.id, studentNumber: s.id, name: "Sample student", course: s.course, year: s.year, faculty: s.faculty, feeStatus: s.status.toLowerCase(),
        stage: null, sectors: [], cvSharing: false, lastActive: new Date().toISOString(),
        reports: s.score === null ? [] : [{ id: reportId, title: "Latest CV", score: s.score, createdAt: new Date().toISOString(), areas: null, hasFile: false }],
        notes: db().notes.filter((n) => n.reportId === reportId),
      };
    },
    async adminAddNote(reportId, note) {
      db().notes.unshift({ id: crypto.randomUUID(), reportId, author: u().profile.fullName, note, createdAt: new Date().toISOString() });
    },
    async adminCvLink() {
      return null;
    },
    async myAdviserNotes() {
      const mine = new Set(u().reports.map((r) => r.row.id));
      return db().notes.filter((n) => mine.has(n.reportId));
    },
    async deleteOpportunity(id) {
      const existing = db().opps.find((x) => x.id === id);
      if (!existing?.own) throw new Error("Shared listings can't be removed");
      db().opps = db().opps.filter((x) => x.id !== id);
    },
  };
}
