// OP-022: the routes and the page, in demo mode, with signed sessions for each role. Export differencing at the route boundary.
import "./fixtures/next-server-shim";
import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { GET as adminExport } from "@/app/admin/export/route";
import { parseCsv } from "@/lib/csv";
import { signDemoSession } from "@/lib/demo-session";
import { publishedFigures } from "@/lib/analytics/definitions";
import { listPeriods } from "@/lib/periods";
import { demoRepo } from "@/lib/repo/demo";
import { DEMO_COOKIE } from "@/lib/session";
import type { Role } from "@/lib/types";
import { requestScope, withEnv } from "./fixtures/request-scope";

const DEMO = { NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", DEMO_MODE: undefined, VERCEL_ENV: undefined, NODE_ENV: "development" };
const nextReq = (url: string) => new NextRequest(`http://t.invalid${url}`);

function session(role: Role) {
  const id = crypto.randomUUID();
  const repo = demoRepo(`${role}-${id}`, role);
  const scope = requestScope({ [DEMO_COOKIE]: signDemoSession(role, id) });
  return { repo, as: async <T>(fn: () => Promise<T>) => (await repo.profile(), scope.run(fn)) };
}
const get = (s: ReturnType<typeof session>, url: string) => s.as(() => adminExport(nextReq(url)));

test("only a careers admin gets the figures, at the route and the repository", async () => {
  await withEnv(DEMO, async () => {
    for (const url of ["/admin/export", "/admin/export?pack=tef", "/admin/export?pack=students"]) {
      assert.equal((await get(session("student"), url)).status, 403, url);
      assert.equal((await get(session("adviser"), url)).status, 403, url);
      assert.equal((await requestScope().run(() => adminExport(nextReq(url)))).status, 401, url);
    }
    await assert.rejects(session("student").repo.adminAnalytics("all"));
    await assert.rejects(session("adviser").repo.adminAnalytics("all"));
  });
});

test("a narrowed export is refused, on every pack, so two files can't be subtracted", async () => {
  await withEnv(DEMO, async () => {
    const admin = session("admin");
    const exportsLogged = async () => (await admin.repo.adminAccessLog()).filter((e) => e.action.startsWith("export_")).length;
    const before = await exportsLogged();
    for (const base of ["/admin/export?", "/admin/export?pack=tef&", "/admin/export?pack=students&"]) {
      for (const narrow of ["q=2104821", "q=21", "faculty=Business", "filter=needs", "filter=home", "filter=international"]) {
        const res = await get(admin, `${base}${narrow}`);
        assert.equal(res.status, 400, `${base}${narrow}`);
        assert.doesNotMatch(await res.text(), /2104821,/, "and no data comes back");
      }
    }
    assert.equal(await exportsLogged(), before, "a refused export writes no file and logs no export");
    assert.equal((await get(admin, "/admin/export?filter=all")).status, 200, "the control: asking for everything is fine");
  });
});

test("a date range can't be chosen: only a listed period, and only by name", async () => {
  await withEnv(DEMO, async () => {
    const admin = session("admin");
    for (const bad of ["2020-01-01", "year-1999", "autumn-2000", "", "all;drop", "../all"]) {
      assert.equal((await get(admin, `/admin/export?period=${encodeURIComponent(bad)}`)).status, 400, bad);
    }
    assert.equal((await get(admin, "/admin/export?from=2026-01-01&to=2026-01-02&period=all")).status, 200, "extra date parameters do nothing");
    const a = await (await get(admin, "/admin/export?from=2026-01-01&to=2026-01-02&period=all")).text();
    const b = await (await get(admin, "/admin/export?period=all")).text();
    assert.equal(a, b, "byte for byte");
    await assert.rejects(admin.repo.adminAnalytics("2020-01-01"), /unknown reporting period/);
  });
});

test("the default export is the aggregate figures, with no student in it, and the named list has to be asked for", async () => {
  await withEnv(DEMO, async () => {
    const admin = session("admin");
    const text = await (await get(admin, "/admin/export")).text();
    assert.doesNotMatch(text, /2104821/);
    assert.match(text, /Completed reviews/);
    const named = await (await get(admin, "/admin/export?pack=students")).text();
    assert.match(named, /2104821/);
    assert.ok((await admin.repo.adminAccessLog()).some((e) => e.action === "export_students"), "and that is on the trail");
    assert.ok((await admin.repo.adminAccessLog()).some((e) => e.action === "export_outcomes"));
  });
});

test("screen and every file show the same numbers, for every period", async () => {
  await withEnv(DEMO, async () => {
    const admin = session("admin");
    for (const p of listPeriods()) {
      const screen = await admin.repo.adminAnalytics(p.key);
      for (const pack of ["", "&pack=tef"]) {
        const res = await get(admin, `/admin/export?period=${p.key}${pack}`);
        assert.equal(res.headers.get("cache-control"), "private, no-store");
        assert.match(res.headers.get("content-disposition") ?? "", /SAMPLE-/, "the sample's file name says so");
        const rows = parseCsv(await res.text());
        assert.match(rows[0][0], /^SAMPLE DATA\./);
        for (const f of publishedFigures(screen)) assert.equal(rows.find((r) => r[0] === f.name)?.[1], f.value === null ? "Hidden" : String(f.value), `${p.key} ${f.name}`);
        for (const r of screen.breakdowns) if (!r.hidden) {
          const row = rows.find((x) => x[0] === r.dimension && x[1] === r.group);
          assert.equal(row?.[2], r.students === null ? "Hidden" : String(r.students), `${p.key} ${r.group}`);
        }
      }
    }
  });
});
