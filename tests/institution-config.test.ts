// OP-021: institution configuration can't reach the common score, and what the UI offers matches what each role can do.
import "./fixtures/next-server-shim";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { STAGES } from "@/lib/analysis/lexicon";
import { uploadFlow } from "@/lib/cv-flow";
import { guidanceFromView } from "@/lib/institution/guidance";
import { can, navFor, NAV_ITEMS, PERMISSIONS } from "@/lib/institution/permissions";
import { ContactSchema, contrastOnWhite, GroupSchema, ReferralSchema, ResourceSchema, SettingsSchema } from "@/lib/institution/schema";
import { saveSettingsFlow } from "@/lib/institution/flow";
import { demoRepo } from "@/lib/repo/demo";
import type { CvReviewPayload } from "@/lib/types";
import { withEnv } from "./fixtures/request-scope";

delete process.env.ANTHROPIC_API_KEY;
const DEMO = { NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", DEMO_MODE: undefined, VERCEL_ENV: undefined, NODE_ENV: "development" };
const store = globalThis as unknown as { __offerpathDemo: { users: Record<string, { profile: { universityId: string | null } }> } };
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

test("the same CV gets the same score and fingerprint at two universities with opposite configuration", async () => {
  await withEnv(DEMO, async () => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/extraction/single-column.pdf")));
    const UNI2 = "22222222-2222-2222-2222-222222222222";
    const [northAdmin, southAdmin] = [demoRepo(`admin-${crypto.randomUUID()}`, "admin"), demoRepo(`admin-${crypto.randomUUID()}`, "admin")];
    await southAdmin.profile();
    store.__offerpathDemo.users[southAdmin.userId].profile.universityId = UNI2;
    await northAdmin.saveInstitutionSettings({ brandName: "North", brandColour: "#36604E", welcome: "Welcome", adviserScope: "all" });
    await northAdmin.saveProgrammeGroup({ name: "All", faculties: ["Social sciences"], courses: [] });
    await northAdmin.saveInstitutionResource({ title: "Guide", url: "https://n.example/g", description: "x", groupId: null, active: true });

    const north = demoRepo(`student-${crypto.randomUUID()}`, "student");
    const south = demoRepo(`student-${crypto.randomUUID()}`, "student");
    await south.profile();
    store.__offerpathDemo.users[south.userId].profile.universityId = UNI2;
    const seen = [];
    for (const repo of [north, south]) {
      const up = await uploadFlow(repo, { bytes, fileName: "single-column.pdf", sector: "Technology", stage: STAGES[0], key: crypto.randomUUID().replace(/-/g, "") });
      if (up.kind !== "scored") throw new Error("expected a scored upload");
      seen.push((await repo.getReport<CvReviewPayload>(up.id))!.payload);
    }
    assert.equal(seen[0].analysis.score, seen[1].analysis.score);
    assert.equal(seen[0].analysis.meta.scoring!.coreFingerprint, seen[1].analysis.meta.scoring!.coreFingerprint);
    assert.deepEqual(seen[0].analysis.areas.map((a) => a.score), seen[1].analysis.areas.map((a) => a.score));
    assert.equal(seen[0].institutionalGuidance, undefined, "nothing is written onto the report");
  });
});

test("changing configuration, viewing guidance and recording casework leave a stored report byte-identical", async () => {
  await withEnv(DEMO, async () => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/extraction/single-column.pdf")));
    const student = demoRepo(`student-${crypto.randomUUID()}`, "student");
    const admin = demoRepo(`admin-${crypto.randomUUID()}`, "admin");
    const up = await uploadFlow(student, { bytes, fileName: "single-column.pdf", sector: "Technology", stage: STAGES[0], key: crypto.randomUUID().replace(/-/g, "") });
    if (up.kind !== "scored") throw new Error("expected a scored upload");
    const before = JSON.stringify(await student.getReport(up.id));
    await admin.saveInstitutionSettings({ brandName: "North", brandColour: null, welcome: null, adviserScope: "all" });
    await admin.saveInstitutionResource({ title: "Guide", url: "https://n.example/g", description: "x", groupId: null, active: true });
    assert.ok(guidanceFromView(await student.myInstitution()));
    await student.myCasework();
    await admin.adminRecordDisagreement({ reportId: "sample-2104821", targetKind: "score", targetKey: "", rationale: "A long enough reason." });
    assert.equal(JSON.stringify(await student.getReport(up.id)), before);
  });
});

test("nothing that scores can see institution or adviser code, and nothing here imports a scorer", () => {
  const scoring = [...walk("src/lib/analysis"), "src/lib/scoring.ts", "src/lib/scoring-core.ts", "src/lib/services.ts", "src/lib/cv-flow.ts"];
  for (const f of scoring) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /@\/lib\/institution|institution_|institutionConfig|myInstitution|staff_access/, f);
  for (const f of [...walk("src/lib/institution"), "src/lib/repo/supabase-institution.ts"]) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /@\/lib\/(analysis\/(cv|job|judgment|rubric)|scoring)/, f);
});

test("configuration schemas refuse anything that isn't configuration", () => {
  const settings = { brandName: "North", brandColour: "#36604E", welcome: "Hi", adviserScope: "assigned" as const };
  assert.ok(SettingsSchema.safeParse(settings).success);
  for (const extra of [{ weights: { impact: 2 } }, { score: 90 }, { threshold: 10 }, { rubric: "x" }, { sectorBonus: 1 }]) assert.equal(SettingsSchema.safeParse({ ...settings, ...extra }).success, false, JSON.stringify(extra));
  assert.equal(SettingsSchema.safeParse({ ...settings, adviserScope: "everyone" }).success, false);
  assert.equal(SettingsSchema.safeParse({ ...settings, brandColour: "red" }).success, false);
  assert.equal(SettingsSchema.safeParse({ ...settings, brandColour: "#FFEE00" }).success, false, "unreadable on white");
  assert.equal(SettingsSchema.safeParse({ ...settings, brandColour: "" }).success, true, "no colour is fine");
  assert.ok(contrastOnWhite("#000000") > 20);
  assert.ok(contrastOnWhite("#FFFFFF") < 1.01);

  const res = { title: "Guide", url: "https://x.example/y", description: "", groupId: null, active: true };
  assert.ok(ResourceSchema.safeParse(res).success);
  for (const url of ["http://x.example", "javascript:alert(1)", "data:text/html,x", "https://", "https://a b"]) assert.equal(ResourceSchema.safeParse({ ...res, url }).success, false, url);
  assert.equal(ResourceSchema.safeParse({ ...res, score: 1 }).success, false);

  const con = { label: "Team", purpose: "", email: "a@b.ac.uk", phone: null, url: null, hours: null };
  assert.ok(ContactSchema.safeParse(con).success);
  assert.equal(ContactSchema.safeParse({ ...con, email: null }).success, false, "a contact needs a way to reach it");
  assert.equal(ContactSchema.safeParse({ ...con, url: "javascript:alert(1)" }).success, false);

  assert.equal(GroupSchema.safeParse({ name: "Empty", faculties: [], courses: [] }).success, false);
  assert.equal(ReferralSchema.safeParse({ studentKey: "a'; drop table x", reportId: null, contactId: null, target: "x y", reason: "A long enough reason.", ownerId: null }).success, false);
});

test("a settings request with a smuggled scoring field is refused at the action boundary", async () => {
  await withEnv(DEMO, async () => {
    const admin = demoRepo(`admin-${crypto.randomUUID()}`, "admin");
    const before = (await admin.institutionConfig()).brandName;
    const r = await saveSettingsFlow(admin, { brandName: "Smuggled", brandColour: null, welcome: null, adviserScope: "all", weights: { impact: 3 } } as never);
    assert.ok(r.error);
    assert.equal((await admin.institutionConfig()).brandName, before);
    assert.notEqual(before, "Smuggled");
  });
});

test("the admin navigation shows each role only what it can use", () => {
  const ids = (role: "admin" | "adviser") => navFor(role).map((i) => i.id);
  assert.deepEqual(ids("adviser"), ["students", "casework"]);
  assert.deepEqual(ids("admin"), NAV_ITEMS.map((i) => i.id));
  assert.deepEqual(navFor("student"), []);
  for (const key of ["dashboard", "export", "access_log", "config", "team", "import", "score_change"]) assert.equal(can("adviser", key), false, key);
  for (const role of ["student", "adviser", "admin"] as const) assert.equal(can(role, "score_change"), false, "nobody changes a score");
  for (const key of ["cv_text", "letters"]) {
    assert.equal(can("adviser", key), false);
    assert.equal(can("admin", key), false);
  }
  assert.ok(PERMISSIONS.find((p) => p.key === "cv_file")!.adviser === "cv");
});

test("admin pages an adviser can't use refuse them at the page, not just the menu", () => {
  const onlyAdmin = ["src/app/admin/page.tsx", "src/app/admin/institution/page.tsx", "src/app/admin/access-log/page.tsx", "src/app/admin/team/page.tsx", "src/app/admin/import/page.tsx", "src/app/admin/opportunities/page.tsx", "src/app/admin/settings/page.tsx"];
  for (const f of onlyAdmin) assert.match(fs.readFileSync(f, "utf8"), /requireAdmin\(\)/, f);
});

test("guidance is built when read, labelled as the institution's, and carries no number", () => {
  const view = { universityId: "u", universityName: "Northfield", brandName: null, brandColour: null, welcome: null, updatedAt: null, contacts: [], resources: [{ id: "1", title: "Guide", url: "https://x.example", description: "Read me" }] };
  const g = guidanceFromView(view)!;
  assert.equal(g.kind, "institutional_guidance");
  assert.equal(g.label, "Northfield");
  assert.deepEqual(g.notes, [{ title: "Guide", text: "Read me" }]);
  assert.equal(guidanceFromView({ ...view, resources: [] }), null);
  assert.equal(guidanceFromView(null), null);
  assert.doesNotMatch(JSON.stringify(g), /score/i);
});
