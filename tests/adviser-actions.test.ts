// OP-021: the action and route boundaries. The real server actions, pages' guards and route handlers, with signed demo
// sessions for a student, an adviser and a careers admin, and a second university made by moving a session's profile.
// The SQL itself is in tests/adviser-db.test.ts.
import "./fixtures/next-server-shim";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import JSZip from "jszip";
import { NextRequest } from "next/server";
import { addAdviserNote, importStudents, saveOpportunity, setAdmin } from "@/app/actions/admin";
import { answerReferral, createReferral, deleteInstitutionContact, deleteProgrammeGroup, recordDisagreement, saveInstitutionContact, saveInstitutionResource, saveInstitutionSettings, saveProgrammeGroup, setAdviser, setAdviserGroups, stopReportSharing, updateReferral, withdrawDisagreement } from "@/app/actions/adviser";
import { GET as adminCv } from "@/app/admin/students/[key]/cv/[reportId]/route";
import { GET as adminExport } from "@/app/admin/export/route";
import { GET as myExport } from "@/app/api/export/route";
import { GET as letterFile } from "@/app/api/letters/[id]/route";
import { GET as tailorFile } from "@/app/api/tailor/[id]/route";
import { GET as sourceFileRoute } from "@/app/reviews/[id]/source/file/route";
import { STAGES } from "@/lib/analysis/lexicon";
import { uploadFlow } from "@/lib/cv-flow";
import { signDemoSession } from "@/lib/demo-session";
import { demoRepo } from "@/lib/repo/demo";
import { ADMIN_SAMPLE, DEMO_UNIVERSITY } from "@/lib/seed-data";
import { DEMO_COOKIE, requireAdmin, requireStaff, requireStudent } from "@/lib/session";
import type { Role } from "@/lib/types";
import { redirectOf, requestScope, withEnv } from "./fixtures/request-scope";

delete process.env.ANTHROPIC_API_KEY;

const DEMO = { NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", DEMO_MODE: undefined, VERCEL_ENV: undefined, NODE_ENV: "development" };
const params = <T>(p: T) => ({ params: Promise.resolve(p) });
const req = (url = "/x") => new Request(`http://t.invalid${url}`);
const nextReq = (url = "/x") => new NextRequest(`http://t.invalid${url}`);

const store = globalThis as unknown as { __offerpathDemo: { users: Record<string, { profile: { universityId: string | null; email: string; shareProgress: boolean } }> } };

function session(role: Role, opts: { university?: string; email?: string } = {}) {
  const id = crypto.randomUUID();
  const repoId = `${role}-${id}`;
  const repo = demoRepo(repoId, role);
  const scope = requestScope({ [DEMO_COOKIE]: signDemoSession(role, id) });
  const ready = (async () => {
    await repo.profile();
    if (opts.university) store.__offerpathDemo.users[repoId].profile.universityId = opts.university;
    if (opts.email) store.__offerpathDemo.users[repoId].profile.email = opts.email;
  })();
  return { repo, repoId, ready, as: async <T>(fn: () => Promise<T>) => (await ready, scope.run(fn)) };
}

const VALID_GROUP = { name: "Sciences group", faculties: ["Sciences"], courses: [] };
const ADMIN_ACTIONS: [string, () => Promise<{ error?: string }>][] = [
  ["saveInstitutionSettings", () => saveInstitutionSettings({ brandName: "Mine", brandColour: null, welcome: null, adviserScope: "all" })],
  ["stopReportSharing", () => stopReportSharing()],
  ["saveInstitutionContact", () => saveInstitutionContact({ label: "Mine", purpose: "", email: "a@b.ac.uk", phone: null, url: null, hours: null })],
  ["deleteInstitutionContact", () => deleteInstitutionContact(crypto.randomUUID())],
  ["saveInstitutionResource", () => saveInstitutionResource({ title: "Mine", url: "https://x.example", description: "", groupId: null, active: true })],
  ["saveProgrammeGroup", () => saveProgrammeGroup(VALID_GROUP)],
  ["deleteProgrammeGroup", () => deleteProgrammeGroup(crypto.randomUUID())],
  ["setAdviser", () => setAdviser("x@northfield.ac.uk", true)],
  ["setAdviserGroups", () => setAdviserGroups(crypto.randomUUID(), [])],
];

test("actions: students and advisers are refused every configuration action, however they call them", async () => {
  await withEnv(DEMO, async () => {
    for (const role of ["student", "adviser"] as const) {
      const s = session(role);
      for (const [name, call] of ADMIN_ACTIONS) assert.equal((await s.as(call)).error, "Only careers admins can do this.", `${role}: ${name}`);
      assert.match((await s.as(() => importStudents("email\na@b.ac.uk"))).error ?? "", /careers admins/);
      assert.match((await s.as(() => setAdmin("a@b.ac.uk", true))).error ?? "", /careers admins/);
      assert.ok((await s.as(() => saveOpportunity({} as never))).error);
    }
    const anon = requestScope();
    for (const [name, call] of ADMIN_ACTIONS) assert.match((await anon.run(call)).error ?? "", /session has expired/, `signed out: ${name}`);
    const a = session("admin");
    assert.equal((await a.as(() => saveProgrammeGroup(VALID_GROUP))).error, undefined, "the control: a careers admin can");
  });
});

test("actions: a student can't do an adviser's work, and an adviser can, for students they can see", async () => {
  await withEnv(DEMO, async () => {
    const key = "2104821"; // Social sciences: in the sample adviser's group.
    const reportId = `sample-${key}`;
    const student = session("student");
    assert.equal((await student.as(() => addAdviserNote(reportId, key, "A long enough note."))).error, "Only careers staff can do this.");
    assert.equal((await student.as(() => recordDisagreement(key, { reportId, targetKind: "score", targetKey: "", rationale: "A long enough reason." }))).error, "Only careers staff can do this.");
    assert.equal((await student.as(() => createReferral({ studentKey: key, reportId, contactId: null, target: "Elsewhere", reason: "A long enough reason.", ownerId: null }))).error, "Only careers staff can do this.");

    const adviser = session("adviser");
    assert.equal((await adviser.as(() => addAdviserNote(reportId, key, "A long enough note."))).error, undefined);
    const d = await adviser.as(() => recordDisagreement(key, { reportId, targetKind: "score", targetKey: "", rationale: "A long enough reason." }));
    assert.ok("id" in d && d.id);
    assert.equal((await adviser.as(() => withdrawDisagreement(key, d.id as string, "A long enough reason."))).error, undefined);
    const r = await adviser.as(() => createReferral({ studentKey: key, reportId, contactId: null, target: "Mentoring", reason: "A long enough reason.", ownerId: null }));
    assert.ok("id" in r && r.id);

    // A student outside the group gets the same "no access" as an id that doesn't exist.
    const visible = (await adviser.repo.adminStudents({ limit: 500 })).rows.map((x) => x.id);
    assert.ok(visible.includes(key));
    const outside = ADMIN_SAMPLE.students.find((x) => !["Social sciences", "Business"].includes(x.faculty))!.id;
    assert.ok(!visible.includes(outside));
    assert.equal(await adviser.repo.adminStudentDetail(outside), null);
    assert.ok(await session("admin").repo.adminStudentDetail(outside), "the control: a careers admin can see them");
    for (const id of [outside, "9999999"]) {
      assert.equal((await adviser.as(() => recordDisagreement(id, { reportId: `sample-${id}`, targetKind: "score", targetKey: "", rationale: "A long enough reason." }))).error, "You don't have access to that student or record.");
      assert.equal((await adviser.as(() => createReferral({ studentKey: id, reportId: null, contactId: null, target: "Elsewhere", reason: "A long enough reason.", ownerId: null }))).error, "You don't have access to that student or record.");
      assert.ok((await adviser.as(() => addAdviserNote(`sample-${id}`, id, "A long enough note."))).error);
    }

    // The student answers; only they can.
    assert.equal((await adviser.as(() => answerReferral(r.id as string, true))).error, "That referral isn't waiting for an answer.");
    assert.equal((await student.as(() => answerReferral(r.id as string, true))).error, undefined);
    assert.equal((await student.as(() => updateReferral(key, { id: r.id as string, status: "closed", ownerId: null, note: null }))).error, "Only careers staff can do this.");
    assert.equal((await adviser.as(() => updateReferral(key, { id: r.id as string, status: "in_progress", ownerId: null, note: null }))).error, undefined);

    // Revocation: the student stops sharing, and the very next call is refused.
    await student.repo.updateProfile({ shareProgress: false });
    assert.equal(await adviser.repo.adminStudentDetail(key), null);
    assert.equal((await adviser.as(() => recordDisagreement(key, { reportId, targetKind: "score", targetKey: "", rationale: "A long enough reason." }))).error, "You don't have access to that student or record.");
    assert.equal((await adviser.as(() => updateReferral(key, { id: r.id as string, status: "closed", ownerId: null, note: null }))).error, "You don't have access to that student or record.");
    assert.ok(!(await adviser.repo.adminStudents({ limit: 500 })).rows.some((x) => x.id === key));
    await student.repo.updateProfile({ shareProgress: true });
  });
});

test("pages: each guard sends each role to the right place", async () => {
  await withEnv(DEMO, async () => {
    const [student, adviser, admin] = [session("student"), session("adviser"), session("admin")];
    assert.equal(await student.as(() => redirectOf(() => requireAdmin())), "/dashboard");
    assert.equal(await student.as(() => redirectOf(() => requireStaff())), "/dashboard");
    assert.equal(await adviser.as(() => redirectOf(() => requireAdmin())), "/admin/students", "an adviser can't reach an admin page");
    assert.equal(await adviser.as(() => redirectOf(() => requireStudent())), "/admin/students");
    assert.equal(await admin.as(() => redirectOf(() => requireStudent())), "/admin");
    assert.equal((await adviser.as(() => requireStaff())).profile.role, "adviser");
    assert.equal((await admin.as(() => requireStaff())).profile.role, "admin");
  });
});

test("exports: careers admins only, logged before the file exists, and with the same population as the screen", async () => {
  await withEnv(DEMO, async () => {
    const [student, adviser, admin] = [session("student"), session("adviser"), session("admin")];
    for (const url of ["/admin/export", "/admin/export?pack=tef", "/admin/export?pack=access"]) {
      assert.equal((await student.as(() => adminExport(nextReq(url)))).status, 403, url);
      assert.equal((await adviser.as(() => adminExport(nextReq(url)))).status, 403, url);
      assert.equal((await requestScope().run(() => adminExport(nextReq(url)))).status, 401, url);
    }
    // OP-022: a search can't narrow a file at all now, and the file names nobody unless the named list is asked for.
    assert.equal((await admin.as(() => adminExport(nextReq("/admin/export?q=2104821&filter=all")))).status, 400);
    const res = await admin.as(() => adminExport(nextReq("/admin/export?pack=students")));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    const entries = await admin.repo.adminAccessLog();
    const entry = entries.find((e) => e.action === "export_students");
    assert.ok(entry, "the export is on the trail");
    assert.doesNotMatch(JSON.stringify(entry), /2104821/, "a student number isn't kept");

    const pack = await admin.as(() => adminExport(nextReq("/admin/export?pack=tef&period=all")));
    assert.equal(pack.status, 200);
    assert.ok((await admin.repo.adminAccessLog()).some((e) => e.action === "export_outcomes"));

    // A student who stops sharing is gone from the next export.
    const key = "2104821";
    const body = async () => (await admin.as(() => adminExport(nextReq("/admin/export?pack=students")))).text();
    assert.match(await body(), new RegExp(key));
    const s = session("student");
    await s.repo.profile();
    await s.repo.updateProfile({ shareProgress: false });
    assert.doesNotMatch(await body(), new RegExp(key));
    await s.repo.updateProfile({ shareProgress: true });

    const log = await admin.as(() => adminExport(nextReq("/admin/export?pack=access")));
    assert.equal(log.status, 200);
    assert.match(await log.text(), /Exported the student list/);
  });
});

test("exports: if the trail can't be written there is no file", async () => {
  await withEnv(DEMO, async () => {
    const admin = session("admin");
    await admin.ready;
    await admin.repo.adminAccessLog();
    // Breaks the demo log's write, which is the only thing adminRecordExport does.
    const inst = (globalThis as unknown as { __offerpathDemoInstitutions: Record<string, { log: unknown }> }).__offerpathDemoInstitutions[DEMO_UNIVERSITY.id];
    const saved = inst.log;
    inst.log = null;
    try {
      for (const url of ["/admin/export", "/admin/export?pack=students", "/admin/export?pack=tef"]) {
        const res = await admin.as(() => adminExport(nextReq(url)));
        assert.equal(res.status, 503, url);
        assert.doesNotMatch(await res.text(), /2104821|Student ID|Breakdown/, "no file");
      }
    } finally {
      inst.log = saved;
    }
  });
});

test("the adviser CV route: off by default, and even when on, nothing without consent", async () => {
  await withEnv(DEMO, async () => {
    assert.notEqual(process.env.ADVISER_CV_ACCESS, "true", "the flag stays off in this codebase's test environment");
    const [student, adviser, admin] = [session("student"), session("adviser"), session("admin")];
    const id = crypto.randomUUID();
    for (const s of [student, adviser, admin]) assert.equal((await s.as(() => adminCv(req(), params({ key: "k", reportId: id })))).status, 404, "doesn't exist while off");
    await withEnv({ ADVISER_CV_ACCESS: "true" }, async () => {
      assert.equal((await student.as(() => adminCv(req(), params({ key: "k", reportId: id })))).status, 403);
      assert.equal((await adviser.as(() => adminCv(req(), params({ key: "k", reportId: id })))).status, 404);
      assert.equal((await admin.as(() => adminCv(req(), params({ key: "k", reportId: id })))).status, 404);
    });
  });
});

test("two universities: a student can't retrieve another university's document by changing an id, nor staff from one reach the other", async () => {
  await withEnv(DEMO, async () => {
    const north = session("student");
    const south = session("student", { university: "22222222-2222-2222-2222-222222222222" });
    await south.ready;
    const bytes = new Uint8Array(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/extraction/single-column.pdf")));
    const up = await uploadFlow(north.repo, { bytes, fileName: "single-column.pdf", sector: "Technology", stage: STAGES[0], key: crypto.randomUUID().replace(/-/g, "") });
    if (up.kind !== "scored") throw new Error("expected a scored upload");

    assert.equal((await north.as(() => sourceFileRoute(req(), params({ id: up.id })))).status, 200, "the control");
    assert.equal(await south.repo.getReport(up.id), null);
    assert.equal((await south.as(() => sourceFileRoute(req(), params({ id: up.id })))).status, 404);
    assert.equal((await south.as(() => letterFile(nextReq(), params({ id: up.id })))).status, 404);
    assert.equal((await south.as(() => tailorFile(nextReq(), params({ id: up.id })))).status, 404);
    const zip = await JSZip.loadAsync(await (await south.as(() => myExport())).arrayBuffer());
    assert.equal(Object.keys(zip.files).some((n) => n.includes(up.id.slice(0, 8))), false);

    // Staff at the second university reach no sample student, and their configuration is their own.
    const southAdmin = session("admin", { university: "22222222-2222-2222-2222-222222222222", email: "jo@southvale.ac.uk" });
    const northAdmin = session("admin");
    await southAdmin.ready;
    assert.equal(await southAdmin.repo.adminStudentDetail("2104821"), null);
    assert.equal((await southAdmin.repo.adminStudents({ limit: 500 })).total, 0);
    assert.equal((await southAdmin.as(() => recordDisagreement("2104821", { reportId: "sample-2104821", targetKind: "score", targetKey: "", rationale: "A long enough reason." }))).error, "You don't have access to that student or record.");
    const contact = await northAdmin.as(() => saveInstitutionContact({ label: "North service", purpose: "", email: "n@northfield.ac.uk", phone: null, url: null, hours: null }));
    assert.ok("id" in contact && contact.id);
    assert.equal((await southAdmin.as(() => deleteInstitutionContact(contact.id as string))).error, "You don't have access to that student or record.");
    assert.ok(!(await south.repo.myInstitution())!.contacts.some((c) => c.id === contact.id));
    assert.ok((await north.repo.myInstitution())!.contacts.some((c) => c.id === contact.id));
    assert.equal((await southAdmin.as(() => setAdviser("x@northfield.ac.uk", true))).error, "That email address is not at your university");
    const southCsv = await (await southAdmin.as(() => adminExport(nextReq("/admin/export?pack=students")))).text();
    assert.doesNotMatch(southCsv, /2104821/, "and their export holds none of the other university's students");
    assert.ok(!(await northAdmin.repo.adminAccessLog()).some((e) => e.actor === "x"), "the control: logs are separate");
  });
});

test("the student's own export carries their casework, and nobody else's", async () => {
  await withEnv(DEMO, async () => {
    const student = session("student");
    const other = session("student", { university: "22222222-2222-2222-2222-222222222222" });
    await other.ready;
    const adviser = session("adviser");
    await student.repo.profile();
    await adviser.as(() => recordDisagreement("2104821", { reportId: "sample-2104821", targetKind: "score", targetKey: "", rationale: "Exported rationale here." }));
    const read = async (s: typeof student) => {
      const zip = await JSZip.loadAsync(await (await s.as(() => myExport())).arrayBuffer());
      return zip.file("adviser-casework.json")!.async("string");
    };
    assert.match(await read(student), /Exported rationale here/);
    assert.doesNotMatch(await read(other), /Exported rationale here/);
  });
});

test("guards: every new route and action file keeps to the shape, and the CV flag isn't flipped anywhere", () => {
  assert.match(fs.readFileSync(".env.example", "utf8"), /ADVISER_CV_ACCESS=(false)?\s*$/m);
  assert.match(fs.readFileSync("src/lib/env.ts", "utf8"), /adviserCvAccess: \(\) => set\("ADVISER_CV_ACCESS"\) && process\.env\.ADVISER_CV_ACCESS === "true"/);
  const route = fs.readFileSync("src/app/admin/students/[key]/cv/[reportId]/route.ts", "utf8");
  assert.ok(route.indexOf("featureFlags.adviserCvAccess()") < route.indexOf("getRepo()"), "the flag is checked first");
  assert.doesNotMatch(fs.readFileSync("src/lib/repo/supabase-institution.ts", "utf8"), /supabaseAdmin/, "adviser code never uses the service role");
});
