// OP-026: one student can't reach another's documents by changing an identifier, at the repository, the server action
// and the route. Repository tests run over the fake, whose reads honour the filters the code sends (row-level security
// isn't modelled: it is tested in supabase/tests/security.test.mjs). Action and route tests run the real handlers in
// demo mode with two signed sessions. A cross-institution test needs a database and lives with the policies.
import "./fixtures/next-server-shim";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import JSZip from "jszip";
import { NextRequest } from "next/server";
import { deleteOpportunity, importStudents, saveOpportunity, setAdmin } from "@/app/actions/admin";
import { acceptRewrite, correctVersion, rewriteLine, scoreVersion, uploadCv } from "@/app/actions/cv";
import { createTailor, createTailoredVersion, toggleKeyword } from "@/app/actions/tailor";
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
import { supabaseRepo } from "@/lib/repo/supabase";
import { DEMO_COOKIE } from "@/lib/session";
import { fakeSupabase } from "./fixtures/fake-supabase";
import { requestScope, withEnv } from "./fixtures/request-scope";

delete process.env.ANTHROPIC_API_KEY;

const SECTOR = "Technology";
const STAGE = STAGES[0];
const fixture = (name: string) => new Uint8Array(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/extraction", name)));
const key = () => crypto.randomUUID().replace(/-/g, "");
const DEMO = { NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", DEMO_MODE: undefined, VERCEL_ENV: undefined, NODE_ENV: "development" };
const params = <T>(p: T) => ({ params: Promise.resolve(p) });
const req = (url = "/x") => new Request(`http://t.invalid${url}`);
const nextReq = (url = "/x") => new NextRequest(`http://t.invalid${url}`);

/** Everything a signed-in demo student would have, addressed through the server actions and routes. */
function student(role: "student" | "admin" = "student") {
  const id = crypto.randomUUID();
  const scope = requestScope({ [DEMO_COOKIE]: signDemoSession(role, id) });
  return { scope, repo: demoRepo(`${role}-${id}`, role), as: <T>(fn: () => Promise<T>) => scope.run(fn) };
}

test("repository: another student's report, version and file can't be read, changed, descended from or scored", async () => {
  const fake = fakeSupabase();
  const [ua, ub] = [crypto.randomUUID(), crypto.randomUUID()];
  const a = supabaseRepo(fake.client, ua, () => fake.client);
  const b = supabaseRepo(fake.client, ub, () => fake.client);
  const up = await uploadFlow(a, { bytes: fixture("single-column.pdf"), fileName: "single-column.pdf", sector: SECTOR, stage: STAGE, key: key() });
  assert.equal(up.kind, "scored");
  if (up.kind !== "scored") throw new Error("unreachable");
  const before = JSON.stringify(fake.rows);

  assert.equal(await b.getReport(up.id), null);
  assert.equal(await b.getSource(up.sourceId), null);
  assert.equal(await b.sourceFile(up.sourceId), null);
  assert.deepEqual((await b.listReports({})).rows, []);
  assert.deepEqual(await b.listSources(), []);
  assert.deepEqual(await b.exportFiles(), []);
  assert.equal(await b.latestReport("cv_review"), null);
  await assert.rejects(b.updateReport(up.id, { payload: { hacked: true } }), /not found/i);
  await b.updateReport(up.id, { title: "stolen" });
  assert.equal(JSON.stringify(fake.rows), before, "a title change aimed at someone else's report changes nothing");
  const source = (await a.getSource(up.sourceId))!;
  await assert.rejects(b.createSource({ kind: "correction", parentId: up.sourceId, fileName: "x", text: "taken", document: null, outcome: null, idempotencyKey: null }), /not found/i);
  await assert.rejects(b.createReport({ type: "cv_review", title: "t", score: 1, payload: (await a.getReport(up.id))!.payload, source: { id: up.sourceId, storagePath: source.storagePath } }), /not found/i);
  // A malformed id never reaches the database.
  for (const bad of ["../../etc/passwd", "' or 1=1 --", "", "x".repeat(10_000)]) {
    assert.equal(await b.getReport(bad), null);
    assert.equal(await b.getSource(bad), null);
    assert.equal(await b.sourceFile(bad), null);
  }
  // Every service-role use in the repository is scoped to the signed-in user: see the static test below.
});

test("server actions: another student's ids get nowhere", async () => {
  await withEnv(DEMO, async () => {
    const [a, b] = [student(), student()];
    const file = new File([fixture("single-column.pdf") as BlobPart], "single-column.pdf", { type: "application/pdf" });
    const form = new FormData();
    form.set("file", file);
    form.set("sector", SECTOR);
    form.set("stage", STAGE);
    form.set("key", key());
    const up = await a.as(() => uploadCv(form));
    assert.ok(up.id && up.sourceId, JSON.stringify(up));
    const before = JSON.stringify(await a.repo.getReport(up.id!));

    assert.ok((await b.as(() => scoreVersion({ sourceId: up.sourceId!, sector: SECTOR, stage: STAGE }))).error);
    assert.ok((await b.as(() => correctVersion({ sourceId: up.sourceId!, blocks: [], sector: SECTOR, stage: STAGE, key: key() }))).error);
    assert.ok((await b.as(() => rewriteLine(up.id!, 0, 0))).error);
    assert.ok((await b.as(() => acceptRewrite(up.id!, 0, "Stolen rewrite text"))).error);
    assert.ok((await b.as(() => toggleKeyword(up.id!, "excel"))).error);
    assert.ok((await b.as(() => createTailoredVersion(up.id!))).error);
    const tailor = new FormData();
    tailor.set("cvReportId", up.id!);
    tailor.set("text", "We want an analyst who can use Excel and SQL. ".repeat(10));
    assert.ok((await b.as(() => createTailor(tailor))).error, "tailoring from someone else's CV");
    assert.equal(JSON.stringify(await a.repo.getReport(up.id!)), before, "A's report is unchanged");
  });
});

test("routes: another student's file and report downloads are 404; with no session, 401", async () => {
  await withEnv(DEMO, async () => {
    const [a, b] = [student(), student()];
    const up = await uploadFlow(a.repo, { bytes: fixture("single-column.pdf"), fileName: "single-column.pdf", sector: SECTOR, stage: STAGE, key: key() });
    if (up.kind !== "scored") throw new Error("expected a scored upload");
    const own = await a.as(() => sourceFileRoute(req(), params({ id: up.id })));
    assert.equal(own.status, 200, "the control: the owner can download it");
    assert.equal(own.headers.get("cache-control"), "private, no-store");
    assert.match(own.headers.get("content-disposition") ?? "", /^attachment/);

    assert.equal((await b.as(() => sourceFileRoute(req(), params({ id: up.id })))).status, 404);
    assert.equal((await b.as(() => letterFile(nextReq(), params({ id: up.id })))).status, 404);
    assert.equal((await b.as(() => tailorFile(nextReq(), params({ id: up.id })))).status, 404);

    const anon = requestScope();
    assert.equal((await anon.run(() => sourceFileRoute(req(), params({ id: up.id })))).status, 401);
    assert.equal((await anon.run(() => letterFile(nextReq(), params({ id: up.id })))).status, 401);
    assert.equal((await anon.run(() => tailorFile(nextReq(), params({ id: up.id })))).status, 401);
    assert.equal((await anon.run(() => myExport())).status, 401);
  });
});

test("export: mine holds my versions and nobody else's, and isn't cacheable", async () => {
  await withEnv(DEMO, async () => {
    const [a, b] = [student(), student()];
    await uploadFlow(a.repo, { bytes: fixture("single-column.pdf"), fileName: "only-a-has-this.pdf", sector: SECTOR, stage: STAGE, key: key() });
    const open = async (who: ReturnType<typeof student>) => {
      const res = await who.as(() => myExport());
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("cache-control"), "private, no-store");
      return JSZip.loadAsync(await res.arrayBuffer());
    };
    const mine = await open(a);
    const versions = JSON.parse(await mine.file("cv-versions.json")!.async("string")) as { fileName: string; text: string; storagePath?: string }[];
    assert.equal(versions[0].fileName, "only-a-has-this.pdf");
    assert.ok(versions[0].text.length > 100, "the version's text is in the export");
    assert.ok(!("storagePath" in versions[0]), "internal paths aren't");
    assert.ok(mine.file("adviser-notes.json"));
    assert.ok(Object.keys(mine.files).some((n) => n.startsWith("uploads/") && n.endsWith("only-a-has-this.pdf")), Object.keys(mine.files).join());
    const theirs = await open(b);
    assert.ok(!(await theirs.file("cv-versions.json")!.async("string")).includes("only-a-has-this"));
  });
});

test("admin: a student can't use admin actions or exports, however they call them", async () => {
  await withEnv(DEMO, async () => {
    const s = student();
    assert.match((await s.as(() => importStudents("email\na@b.ac.uk"))).error ?? "", /careers admins/);
    assert.match((await s.as(() => setAdmin("a@b.ac.uk", true))).error ?? "", /careers admins/);
    assert.ok((await s.as(() => saveOpportunity({} as never))).error);
    assert.ok((await s.as(() => deleteOpportunity("opp-x"))).error);
    assert.equal((await s.as(() => adminExport(nextReq("/admin/export")))).status, 403);
    assert.equal((await s.as(() => adminExport(nextReq("/admin/export?pack=tef")))).status, 403);
    await withEnv({ ADVISER_CV_ACCESS: "true" }, async () => {
      assert.equal((await s.as(() => adminCv(req(), params({ key: "k", reportId: crypto.randomUUID() })))).status, 403);
    });
    assert.equal((await requestScope().run(() => adminExport(nextReq("/admin/export")))).status, 401);
    const off = await student("admin").as(() => adminCv(req(), params({ key: "k", reportId: crypto.randomUUID() })));
    assert.equal(off.status, 404, "and the adviser CV route doesn't exist until the feature is on");
  });
});

/* ---------- static: the shape every handler must have, so a new one can't quietly skip the check ---------- */

const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const rel = (f: string) => path.relative(process.cwd(), f);
const appFiles = walk(path.join(process.cwd(), "src/app"));

test("every route handler authenticates, apart from a short list that is public on purpose", () => {
  const publicRoutes = new Set(["src/app/api/health/route.ts", "src/app/auth/callback/route.ts"]);
  for (const f of appFiles.filter((f) => /route\.tsx?$/.test(f) && !publicRoutes.has(rel(f)))) {
    assert.match(fs.readFileSync(f, "utf8"), /getRepo\(\)|cronAuthorized\(/, `${rel(f)} has no session or secret check`);
  }
});

test("every admin page requires an admin", () => {
  const pages = appFiles.filter((f) => f.includes(`${path.sep}admin${path.sep}`) && /page\.tsx$/.test(f));
  assert.ok(pages.length >= 3);
  for (const f of pages) assert.match(fs.readFileSync(f, "utf8"), /requireAdmin\(\)/, rel(f));
});

test("every exported server action checks the session, apart from sign-in and the public pilot form", () => {
  const open = new Set(["signInWithUniversity", "signInWithEmail", "testSignIn", "signOut", "resetDemo", "requestPilot", "submitPilotRequest"]);
  const actions = appFiles.filter((f) => f.includes(`${path.sep}actions${path.sep}`));
  for (const f of actions) {
    const source = fs.readFileSync(f, "utf8");
    assert.match(source, /^"use server";/, rel(f));
    const parts = source.split(/^export async function /m).slice(1);
    assert.ok(parts.length > 0, rel(f));
    for (const part of parts) {
      const name = part.slice(0, part.indexOf("("));
      if (open.has(name)) continue;
      const body = part.split(/^}/m)[0];
      assert.match(body, /getRepo\(\)|adminRepo\(\)|requireAdmin\(\)|requireStudent\(/, `${rel(f)}: ${name}`);
    }
  }
});

test("the service-role client: never in browser code, always scoped to the signed-in user in the repository", () => {
  const clientFiles = walk(path.join(process.cwd(), "src")).filter((f) => /\.tsx?$/.test(f) && /^["']use client["']/.test(fs.readFileSync(f, "utf8")));
  assert.ok(clientFiles.length > 0);
  for (const f of clientFiles) {
    const source = fs.readFileSync(f, "utf8");
    assert.doesNotMatch(source, /supabase\/admin|lib\/session|SERVICE_ROLE|ANTHROPIC_API_KEY|CRON_SECRET|DEMO_SECRET/, rel(f));
  }
  assert.match(fs.readFileSync("src/lib/supabase/admin.ts", "utf8"), /^import "server-only";/);
  // In the repository each service-role statement names the user, or a path built from the user's id.
  const repoSource = fs.readFileSync("src/lib/repo/supabase.ts", "utf8");
  assert.match(repoSource, /const row = \{ user_id: userId,/, "the one insert that passes a variable builds it with the user's id");
  assert.match(repoSource, /storagePath = `\$\{userId\}\//, "stored paths start with the user's folder");
  const repo = repoSource.split("\n");
  for (const [i, line] of repo.entries()) {
    if (!/\b(admin\(\)|supabaseAdmin\(\)|db)\s*\.(from|storage)/.test(line)) continue;
    assert.match(line, /user_id: userId|\.eq\("user_id", userId\)|storagePath|createSignedUrl|insert\(row\)/, `src/lib/repo/supabase.ts:${i + 1}: ${line.trim().slice(0, 120)}`);
  }
});

test("AI calls have no tools: a document can't ask the model to do anything but answer", () => {
  const source = fs.readFileSync("src/lib/ai.ts", "utf8");
  assert.doesNotMatch(source, /\btools\s*:|tool_choice|mcp_servers/);
  assert.match(source, /untrusted text/i, "the judge is told bullets are data");
  assert.match(source, /not instructions to you/, "letter and tailor prompts say the same");
});
