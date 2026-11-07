import { AREA_LABELS } from "@/lib/analysis/labels";
import { ADMIN_SAMPLE } from "@/lib/seed-data";
import type { AccessAction, AccessLogEntry, AdviserScope, CaseworkQueue, Disagreement, InstitutionContact, InstitutionRepo, InstitutionResource, MyCasework, ProgrammeGroup, Referral, StaffOption } from "@/lib/institution/types";
import type { Profile, Role } from "@/lib/types";

// The same rules as the SQL in 20261107230000_institution_adviser_work.sql, over fictional in-memory data, so demo mode
// and the tests can exercise them without a database. tests/adviser-db.test.ts runs one contract against both.

interface Institution {
  brandName: string | null;
  brandColour: string | null;
  welcome: string | null;
  updatedAt: string | null;
  adviserScope: AdviserScope;
  contacts: InstitutionContact[];
  resources: InstitutionResource[];
  groups: ProgrammeGroup[];
  /** adviser email -> group ids. An email because a demo session's id changes between visits. */
  assignments: Record<string, string[]>;
  pendingAdvisers: { email: string; invitedAt: string }[];
  reportSharingStopped: boolean;
  log: (AccessLogEntry & { studentKey: string | null; target: string | null })[];
  disagreements: (Disagreement & { studentKey: string })[];
  referrals: (Referral & { studentKey: string })[];
}

const g = globalThis as unknown as { __offerpathDemoInstitutions?: Record<string, Institution> };

export const DEMO_ADVISER_EMAIL = "priya.shah@northfield.ac.uk";

function institution(uni: string, sample: boolean): Institution {
  const all = (g.__offerpathDemoInstitutions ??= {});
  if (all[uni]) return all[uni];
  const group: ProgrammeGroup = { id: crypto.randomUUID(), name: "Social sciences and business", faculties: ["Social sciences", "Business"], courses: [] };
  all[uni] = {
    brandName: null,
    brandColour: null,
    welcome: null,
    updatedAt: null,
    adviserScope: "assigned",
    contacts: [],
    resources: [],
    // So that the sample adviser has somebody to see. A real university starts with no groups.
    groups: sample ? [group] : [],
    assignments: sample ? { [DEMO_ADVISER_EMAIL]: [group.id] } : {},
    pendingAdvisers: [],
    reportSharingStopped: false,
    log: [],
    disagreements: [],
    referrals: [],
  };
  return all[uni];
}

const inGroup = (faculty: string | null, course: string | null, group: ProgrammeGroup) => {
  const norm = (v: string | null) => (v ?? "").trim().toLowerCase();
  return group.faculties.some((f) => f.trim() && norm(f) === norm(faculty)) || group.courses.some((c) => c.trim() && norm(c) === norm(course));
};

export interface DemoContext {
  profile(): Profile;
  sampleUniversityId: string;
  /** False once the demo student with this number has stopped sharing. */
  sharing(studentKey: string): boolean;
  /** Everyone signed in at this university, as the demo knows them. */
  people(universityId: string): Profile[];
  setRole(id: string, role: Role): void;
  setReportSharing(on: boolean): void;
  reportSharing(): boolean;
}

export function demoStaffCanSee(ctx: DemoContext, actor: Profile, studentKey: string): boolean {
  if (actor.universityId !== ctx.sampleUniversityId) return false;
  const student = ADMIN_SAMPLE.students.find((s) => s.id === studentKey);
  if (!student || !ctx.sharing(studentKey)) return false;
  if (actor.role === "admin") return true;
  if (actor.role !== "adviser") return false;
  const inst = institution(actor.universityId, true);
  if (inst.adviserScope === "all") return true;
  const mine = inst.assignments[actor.email] ?? [];
  return inst.groups.some((gr) => mine.includes(gr.id) && inGroup(student.faculty, student.course, gr));
}

export function demoInstitutionMethods(ctx: DemoContext): InstitutionRepo {
  const me = () => ctx.profile();
  const uni = () => me().universityId ?? "none";
  const inst = () => institution(uni(), uni() === ctx.sampleUniversityId);
  const admins = () => {
    if (me().role !== "admin") throw new Error("admins only");
  };
  const staff = () => {
    if (me().role !== "admin" && me().role !== "adviser") throw new Error("careers staff only");
  };
  const see = (key: string) => demoStaffCanSee(ctx, me(), key);
  const log = (action: AccessAction, outcome: "granted" | "denied", studentKey: string | null, detail: Record<string, unknown> = {}, target: string | null = null) => {
    const s = studentKey && ADMIN_SAMPLE.students.find((x) => x.id === studentKey);
    inst().log.unshift({ at: new Date().toISOString(), actor: me().fullName, actorRole: me().role, action, outcome, student: s ? (ctx.sharing(s.id) ? s.id : "Not sharing") : null, studentGone: false, detail, studentKey: s ? s.id : null, target });
  };
  const sampleReport = (reportId: string) => (reportId.startsWith("sample-") ? reportId.slice("sample-".length) : "");
  const canAdminOrOwner = (r: { ownerId?: string | null }) => me().role === "admin" || r.ownerId === me().id;
  const owner = (id: string | null): StaffOption | null => (id ? (ctx.people(uni()).find((p) => p.id === id && p.role !== "student") ? { id, name: ctx.people(uni()).find((p) => p.id === id)!.fullName, role: ctx.people(uni()).find((p) => p.id === id)!.role } : null) : null);

  return {
    async institutionConfig() {
      admins();
      const i = inst();
      return { universityName: me().universityName ?? "", brandName: i.brandName, brandColour: i.brandColour, welcome: i.welcome, adviserScope: i.adviserScope, reportSharing: ctx.reportSharing() && !i.reportSharingStopped, contacts: structuredClone(i.contacts), resources: structuredClone(i.resources), groups: structuredClone(i.groups) };
    },
    async saveInstitutionSettings(input) {
      admins();
      Object.assign(inst(), input, { updatedAt: new Date().toISOString() });
      log("change_configuration", "granted", null, { what: "settings", adviserScope: input.adviserScope });
    },
    async stopReportSharing() {
      admins();
      inst().reportSharingStopped = true;
      ctx.setReportSharing(false);
      log("change_configuration", "granted", null, { what: "report_sharing", enabled: false });
    },
    async saveInstitutionContact(input) {
      admins();
      const id = input.id ?? crypto.randomUUID();
      if (input.id && !inst().contacts.some((c) => c.id === input.id)) throw new Error("not found");
      const row = { ...input, id };
      inst().contacts = input.id ? inst().contacts.map((c) => (c.id === id ? row : c)) : [...inst().contacts, row];
      log("change_configuration", "granted", null, { what: "contact" });
      return id;
    },
    async deleteInstitutionContact(id) {
      admins();
      if (!inst().contacts.some((c) => c.id === id)) throw new Error("not found");
      inst().contacts = inst().contacts.filter((c) => c.id !== id);
      log("change_configuration", "granted", null, { what: "contact", removed: true });
    },
    async saveInstitutionResource(input) {
      admins();
      if (input.groupId && !inst().groups.some((gr) => gr.id === input.groupId)) throw new Error("not found");
      if (input.id && !inst().resources.some((r) => r.id === input.id)) throw new Error("not found");
      const id = input.id ?? crypto.randomUUID();
      const row = { ...input, id };
      inst().resources = input.id ? inst().resources.map((r) => (r.id === id ? row : r)) : [...inst().resources, row];
      log("change_configuration", "granted", null, { what: "resource" });
      return id;
    },
    async deleteInstitutionResource(id) {
      admins();
      if (!inst().resources.some((r) => r.id === id)) throw new Error("not found");
      inst().resources = inst().resources.filter((r) => r.id !== id);
      log("change_configuration", "granted", null, { what: "resource", removed: true });
    },
    async saveProgrammeGroup(input) {
      admins();
      if (input.id && !inst().groups.some((gr) => gr.id === input.id)) throw new Error("not found");
      if (inst().groups.some((gr) => gr.name === input.name && gr.id !== input.id)) throw new Error("duplicate key");
      const id = input.id ?? crypto.randomUUID();
      const row = { ...input, id };
      inst().groups = input.id ? inst().groups.map((gr) => (gr.id === id ? row : gr)) : [...inst().groups, row];
      log("change_configuration", "granted", null, { what: "programme_group" });
      return id;
    },
    async deleteProgrammeGroup(id) {
      admins();
      if (inst().resources.some((r) => r.groupId === id)) throw new Error("group has resources");
      if (!inst().groups.some((gr) => gr.id === id)) throw new Error("not found");
      inst().groups = inst().groups.filter((gr) => gr.id !== id);
      for (const k of Object.keys(inst().assignments)) inst().assignments[k] = inst().assignments[k].filter((x) => x !== id);
      log("change_configuration", "granted", null, { what: "programme_group", removed: true });
    },
    async adviserTeam() {
      admins();
      const i = inst();
      return {
        advisers: ctx.people(uni()).filter((p) => p.role === "adviser").map((p) => ({ id: p.id, email: p.email, name: p.fullName, groupIds: i.assignments[p.email] ?? [] })),
        pending: structuredClone(i.pendingAdvisers),
      };
    },
    async setAdviser(email, adviser) {
      admins();
      const domain = (me().email.split("@")[1] ?? "").toLowerCase();
      const at = email.split("@")[1] ?? "";
      if (at !== domain && !at.endsWith(`.${domain}`)) throw new Error("That email address is not at your university");
      const person = ctx.people(uni()).find((p) => p.email.toLowerCase() === email);
      if (person?.role === "admin") throw new Error("That person is already a careers admin");
      let status: string;
      if (adviser) {
        if (person) {
          ctx.setRole(person.id, "adviser");
          status = "granted";
        } else {
          if (!inst().pendingAdvisers.some((p) => p.email === email)) inst().pendingAdvisers.push({ email, invitedAt: new Date().toISOString() });
          status = "invited";
        }
      } else {
        inst().pendingAdvisers = inst().pendingAdvisers.filter((p) => p.email !== email);
        if (person?.role === "adviser") ctx.setRole(person.id, "student");
        delete inst().assignments[email];
        status = "removed";
      }
      log("change_role", "granted", null, { role: "adviser", status });
      return status;
    },
    async setAdviserGroups(adviserId, groupIds) {
      admins();
      const person = ctx.people(uni()).find((p) => p.id === adviserId && p.role === "adviser");
      if (!person || !groupIds.every((id) => inst().groups.some((gr) => gr.id === id))) throw new Error("not found");
      inst().assignments[person.email] = [...new Set(groupIds)];
      log("change_role", "granted", null, { groups: groupIds.length });
    },
    async myInstitution() {
      const p = me();
      if (!p.universityId) return null;
      const i = inst();
      return {
        universityId: p.universityId,
        universityName: p.universityName ?? "",
        brandName: i.brandName,
        brandColour: i.brandColour,
        welcome: i.welcome,
        updatedAt: i.updatedAt,
        contacts: structuredClone(i.contacts),
        resources: i.resources.filter((r) => r.active && (!r.groupId || i.groups.some((gr) => gr.id === r.groupId && inGroup(p.faculty, p.course, gr)))).map(({ id, title, url, description }) => ({ id, title, url, description })),
      };
    },
    async adminRecordDisagreement(input) {
      staff();
      const key = sampleReport(input.reportId);
      if (!see(key)) {
        log("record_disagreement", "denied", key || null, {}, input.reportId);
        return null;
      }
      const s = ADMIN_SAMPLE.students.find((x) => x.id === key)!;
      if (input.targetKind === "area" && !(input.targetKey in AREA_LABELS)) throw new Error("unknown part of the report");
      if (input.targetKind === "check") throw new Error("unknown part of the report");
      const id = crypto.randomUUID();
      const judgment = { score: s.score, name: input.targetKind === "area" ? AREA_LABELS[input.targetKey as keyof typeof AREA_LABELS] : undefined, reportScore: s.score, reportDate: new Date().toISOString() };
      inst().disagreements.unshift({ id, studentKey: key, reportId: input.reportId, author: me().fullName, authorRole: me().role, kind: "disagreement", withdrawsId: null, targetKind: input.targetKind, targetKey: input.targetKind === "score" ? "" : input.targetKey, judgment, rationale: input.rationale, createdAt: new Date().toISOString() });
      log("record_disagreement", "granted", key, { kind: input.targetKind, key: input.targetKey });
      return id;
    },
    async adminWithdrawDisagreement(id, reason) {
      staff();
      const row = inst().disagreements.find((d) => d.id === id && d.kind === "disagreement");
      const authored = row && (me().role === "admin" || row.author === me().fullName);
      if (!row || !authored || !see(row.studentKey)) {
        log("withdraw_disagreement", "denied", row?.studentKey ?? null, {}, id);
        return null;
      }
      if (inst().disagreements.some((d) => d.withdrawsId === id)) throw new Error("already withdrawn");
      const newId = crypto.randomUUID();
      inst().disagreements.unshift({ ...structuredClone(row), id: newId, author: me().fullName, authorRole: me().role, kind: "withdrawal", withdrawsId: id, rationale: reason, createdAt: new Date().toISOString() });
      log("withdraw_disagreement", "granted", row.studentKey);
      return newId;
    },
    async adminCreateReferral(input) {
      staff();
      if (!see(input.studentKey)) {
        log("create_referral", "denied", input.studentKey, {}, input.studentKey);
        return null;
      }
      let target = input.target.trim();
      if (input.contactId) {
        const c = inst().contacts.find((x) => x.id === input.contactId);
        if (!c) throw new Error("contact not found");
        target = c.label;
      }
      const ownerId = input.ownerId ?? me().id;
      const ownerRow = ownerId === me().id ? { id: me().id, name: me().fullName, role: me().role as string } : owner(ownerId);
      if (!ownerRow) throw new Error("that person can't take this on");
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      inst().referrals.unshift({ id, studentKey: input.studentKey, reportId: input.reportId, target, reason: input.reason, status: "proposed", ownerId: ownerRow.id, owner: ownerRow.name, createdBy: me().fullName, createdAt: now, updatedAt: now, events: [{ actor: me().fullName, actorKind: "staff", from: null, to: "proposed", fromOwner: null, toOwner: ownerRow.name, note: null, at: now }] });
      log("create_referral", "granted", input.studentKey);
      return id;
    },
    async adminUpdateReferral(input) {
      staff();
      const r = inst().referrals.find((x) => x.id === input.id);
      if (!r || !see(r.studentKey) || !canAdminOrOwner(r)) {
        log("update_referral", "denied", r?.studentKey ?? null, {}, input.id);
        return false;
      }
      const status = input.status ?? r.status;
      const allowed = status === r.status || (r.status === "proposed" && status === "withdrawn") || (r.status === "accepted" && (status === "in_progress" || status === "closed")) || (r.status === "in_progress" && status === "closed");
      if (!allowed) throw new Error("that step isn't possible from here");
      let ownerRow = { id: r.ownerId ?? null, name: r.owner };
      if (input.ownerId && input.ownerId !== r.ownerId) {
        const next = owner(input.ownerId);
        if (!next || !demoStaffCanSee(ctx, ctx.people(uni()).find((p) => p.id === next.id)!, r.studentKey)) throw new Error("that person can't take this on");
        ownerRow = { id: next.id, name: next.name };
      }
      if (status === r.status && ownerRow.id === (r.ownerId ?? null) && !input.note) return true;
      const now = new Date().toISOString();
      r.events.push({ actor: me().fullName, actorKind: "staff", from: r.status, to: status, fromOwner: r.owner, toOwner: ownerRow.name, note: input.note, at: now });
      r.status = status;
      r.ownerId = ownerRow.id;
      r.owner = ownerRow.name;
      r.updatedAt = now;
      log("update_referral", "granted", r.studentKey, { status });
      return true;
    },
    async adminCasework(): Promise<CaseworkQueue> {
      staff();
      const open = inst().referrals.filter((r) => ["proposed", "accepted", "in_progress"].includes(r.status) && (me().role === "admin" || r.ownerId === me().id));
      return {
        hidden: open.filter((r) => !see(r.studentKey)).length,
        referrals: open.filter((r) => see(r.studentKey)).map((r) => ({ id: r.id, studentKey: r.studentKey, studentNumber: r.studentKey, target: r.target, reason: r.reason, status: r.status, owner: r.owner, ownerGone: !r.ownerId, mine: r.ownerId === me().id, createdAt: r.createdAt, updatedAt: r.updatedAt })),
      };
    },
    async adminAccessLog(page = {}) {
      admins();
      const offset = page.offset ?? 0;
      return inst().log.slice(offset, offset + (page.limit ?? 100)).map((e) => ({ at: e.at, actor: e.actor, actorRole: e.actorRole, action: e.action, outcome: e.outcome, studentGone: e.studentGone, detail: e.detail, student: e.studentKey ? (ctx.sharing(e.studentKey) ? e.studentKey : "Not sharing") : null }));
    },
    async adminRecordExport(kind, rows, detail = {}) {
      admins();
      // Search text isn't kept: it can be a student number.
      const kept = Object.fromEntries(Object.entries(detail).filter(([k]) => k !== "q" && k !== "search"));
      log(kind, "granted", null, { rows, ...kept });
    },
    async myCasework(): Promise<MyCasework> {
      const key = me().studentNumber ?? "";
      const i = inst();
      return {
        seenAt: seen.get(me().id) ?? null,
        disagreements: i.disagreements.filter((d) => d.studentKey === key).map(strip),
        referrals: i.referrals.filter((r) => r.studentKey === key).map(strip),
        access: i.log.filter((l) => l.studentKey === key && l.outcome === "granted").map((l) => ({ at: l.at, actor: l.actor, actorRole: l.actorRole, action: l.action })),
      };
    },
    async myCaseworkUnseen() {
      const key = me().studentNumber ?? "";
      const since = seen.get(me().id) ?? "";
      const i = inst();
      return i.disagreements.filter((d) => d.studentKey === key && d.createdAt > since).length + i.referrals.filter((r) => r.studentKey === key && r.updatedAt > since).length;
    },
    async markCaseworkSeen() {
      seen.set(me().id, new Date().toISOString());
    },
    async respondToReferral(id, accept) {
      const key = me().studentNumber ?? "";
      const r = inst().referrals.find((x) => x.id === id && x.studentKey === key);
      if (!r || r.status !== "proposed" || me().role !== "student") return false;
      const now = new Date().toISOString();
      const to = accept ? "accepted" : "declined";
      r.events.push({ actor: me().fullName, actorKind: "student", from: "proposed", to, fromOwner: r.owner, toOwner: r.owner, note: null, at: now });
      r.status = to;
      r.updatedAt = now;
      return true;
    },
  };
}

const seen = new Map<string, string>();

function strip<T extends { studentKey: string }>(row: T): Omit<T, "studentKey"> {
  const copy: Partial<T> = structuredClone(row);
  delete copy.studentKey;
  return copy as Omit<T, "studentKey">;
}

/** The student-page view of a sample student, for careers staff. */
export function demoCaseworkFor(ctx: DemoContext, actor: Profile, key: string) {
  const i = institution(actor.universityId ?? "none", actor.universityId === ctx.sampleUniversityId);
  return {
    disagreements: i.disagreements.filter((d) => d.studentKey === key).map(strip),
    referrals: i.referrals.filter((r) => r.studentKey === key).map(strip),
    staff: ctx.people(actor.universityId ?? "none").filter((p) => p.role !== "student" && demoStaffCanSee(ctx, p, key)).map((p) => ({ id: p.id, name: p.fullName, role: p.role })),
  };
}

export function demoRecordView(ctx: DemoContext, actor: Profile, key: string, granted: boolean) {
  const i = institution(actor.universityId ?? "none", actor.universityId === ctx.sampleUniversityId);
  i.log.unshift({ at: new Date().toISOString(), actor: actor.fullName, actorRole: actor.role, action: "view_student", outcome: granted ? "granted" : "denied", student: granted ? key : null, studentGone: false, detail: {}, studentKey: granted ? key : null, target: granted ? null : key });
}

export function demoRecordNote(ctx: DemoContext, actor: Profile, key: string) {
  const i = institution(actor.universityId ?? "none", actor.universityId === ctx.sampleUniversityId);
  i.log.unshift({ at: new Date().toISOString(), actor: actor.fullName, actorRole: actor.role, action: "add_note", outcome: "granted", student: key, studentGone: false, detail: {}, studentKey: key, target: null });
}
