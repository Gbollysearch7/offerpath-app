// OP-020: one contract, two implementations: the demo repository, and the Supabase repository calling the real SQL from
// the migration in PGlite, with row-level security on and the student's role set, as PostgREST would for that session.
// Auth and PostgREST themselves are stubbed: see the report for what that leaves unproven.
import "./fixtures/provider-stub";
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { STAGES } from "@/lib/analysis/lexicon";
import { demoRepo, demoShareBackend } from "@/lib/repo/demo";
import { supabaseRepo } from "@/lib/repo/supabase";
import type { Repo } from "@/lib/repo/types";
import { buildCvPayload } from "@/lib/services";
import { createShareFlow, shareOptions } from "@/lib/sharing/flow";
import { resolveShare, supabaseShareBackend } from "@/lib/sharing/resolve";
import { hashShareToken } from "@/lib/sharing/token";
import type { ShareBackend } from "@/lib/sharing/types";
import type { CvReviewPayload } from "@/lib/types";

const db = new PGlite();
const CV = "Alex Example\nalex@northfield.ac.uk\n\nExperience\nAnalyst, Example Ltd\n• Led a team of 4 to reduce costs by 12%\n• Built a model used by 3 departments\n\nEducation\nBSc Economics\n\nSkills\nSQL\n";

before(async () => {
  await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema storage; create schema extensions;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb, email_confirmed_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant execute on function auth.uid() to anon, authenticated;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security; grant select, insert, delete on storage.objects to authenticated;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
  grant execute on function storage.foldername(text) to authenticated;
`);
  for (const f of fs.readdirSync("supabase/migrations").filter((x) => x.endsWith(".sql")).sort()) await db.exec(fs.readFileSync(path.join("supabase/migrations", f), "utf8"));
  await db.exec(fs.readFileSync("supabase/seed.sql", "utf8"));
  await db.exec(`update public.universities set report_sharing_enabled = true`);
});

async function asRole<T>(role: string, uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role;`);
  }
}

const rpcCall = (name: string, args: Record<string, unknown> = {}) => {
  const keys = Object.keys(args);
  return { sql: `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, params: keys.map((k) => args[k]) };
};
const toError = (e: unknown) => ({ message: (e as Error).message, code: (e as { code?: string }).code });

/** A session client: the parts of PostgREST the repository's sharing methods use, under the student's own role. */
function sessionClient(uid: string): SupabaseClient {
  return {
    async rpc(name: string, args: Record<string, unknown> = {}) {
      const { sql, params } = rpcCall(name, args);
      try {
        return { data: ((await asRole("authenticated", uid, () => db.query(sql, params))).rows[0] as { r: unknown }).r, error: null };
      } catch (e) {
        return { data: null, error: toError(e) };
      }
    },
    from(table: string) {
      let columns = "*";
      const where: [string, unknown][] = [];
      let order = "";
      const builder = {
        select(c: string) {
          columns = c;
          return builder;
        },
        eq(col: string, v: unknown) {
          where.push([col, v]);
          return builder;
        },
        order(col: string, o: { ascending: boolean }) {
          order = ` order by ${col} ${o.ascending ? "asc" : "desc"}`;
          return builder;
        },
        run() {
          const sql = `select ${columns} from public.${table}${where.length ? ` where ${where.map(([c], i) => `${c} = $${i + 1}`).join(" and ")}` : ""}${order}`;
          // PostgREST sends timestamps as strings.
          const plain = (row: unknown) => JSON.parse(JSON.stringify(row));
          return asRole("authenticated", uid, () => db.query(sql, where.map(([, v]) => v))).then((r) => ({ data: r.rows.map(plain), error: null }), (e) => ({ data: null, error: toError(e) }));
        },
        maybeSingle() {
          return builder.run().then((r) => ({ data: r.data?.[0] ?? null, error: r.error }));
        },
        then(ok: (r: unknown) => unknown) {
          return builder.run().then(ok);
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const serviceClient = {
  async rpc(name: string, args: Record<string, unknown>) {
    const { sql, params } = rpcCall(name, args);
    try {
      return { data: ((await asRole("service_role", null, () => db.query(sql, params))).rows[0] as { r: unknown }).r, error: null };
    } catch (e) {
      return { data: null, error: toError(e) };
    }
  },
} as unknown as SupabaseClient;

interface Student {
  repo: Repo;
  reportId: string;
  payload: CvReviewPayload;
  createdAt: string;
}
interface Backend {
  name: string;
  backend: ShareBackend;
  student(): Promise<Student>;
  /** The link's expiry passes. */
  expire(linkId: string, s: Student): Promise<void>;
  remove(s: Student): Promise<void>;
  /** The report's stored score changes under the link. */
  rescore(s: Student): Promise<void>;
  /** Switches the institution setting. */
  institution(on: boolean): Promise<void>;
}

const payload = () => buildCvPayload({ fileName: "alex.pdf", text: CV, sector: "Technology", stage: STAGES[0] });
const demoStore = globalThis as unknown as { __offerpathDemo: { users: Record<string, { shareLinks?: { id: string; expiresAt: string }[] }> } };

const backends: Backend[] = [
  {
    name: "demo",
    backend: demoShareBackend,
    async student() {
      process.env.DEMO_REPORT_SHARING = "true";
      const repo = demoRepo(`student-${crypto.randomUUID()}`, "student");
      const p = payload();
      const reportId = await repo.createReport({ type: "cv_review", title: "alex.pdf", score: p.analysis.score, payload: p });
      return { repo, reportId, payload: p, createdAt: (await repo.getReport(reportId))!.row.createdAt };
    },
    async expire(linkId, s) {
      demoStore.__offerpathDemo.users[s.repo.userId].shareLinks!.find((l) => l.id === linkId)!.expiresAt = new Date(Date.now() - 1000).toISOString();
    },
    async remove(s) {
      await s.repo.deleteAccount();
    },
    async rescore(s) {
      const p = structuredClone(s.payload);
      p.analysis.score = Math.max(0, p.analysis.score - 3);
      await s.repo.updateReport(s.reportId, { payload: p });
    },
    async institution(on) {
      process.env.DEMO_REPORT_SHARING = on ? "true" : "";
    },
  },
  {
    name: "supabase (PGlite)",
    backend: supabaseShareBackend(() => serviceClient),
    async student() {
      const id = (await db.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [`share.${crypto.randomUUID().slice(0, 8)}@northfield.ac.uk`])).rows[0].id;
      const p = payload();
      const row = (await db.query<{ id: string; created_at: Date }>(`insert into public.reports (user_id, type, title, score, payload) values ($1, 'cv_review', 'alex.pdf', $2, $3) returning id, created_at`, [id, p.analysis.score, JSON.stringify(p)])).rows[0];
      return { repo: supabaseRepo(sessionClient(id), id, () => serviceClient), reportId: row.id, payload: p, createdAt: new Date(row.created_at).toISOString() };
    },
    async expire(linkId) {
      await db.query(`update public.share_links set created_at = now() - interval '2 days', expires_at = now() - interval '1 second' where id = $1`, [linkId]);
    },
    async remove(s) {
      await db.query(`delete from auth.users where id = $1`, [s.repo.userId]);
    },
    async rescore(s) {
      await db.query(`update public.reports set payload = jsonb_set(payload, '{analysis,score}', to_jsonb(0)) where id = $1`, [s.reportId]);
    },
    async institution(on) {
      await db.query(`update public.universities set report_sharing_enabled = $1 where domain = 'northfield.ac.uk'`, [on]);
    },
  },
];

async function share(s: Student, scope: "score" | "areas" | "advice" = "score") {
  // A timestamp reads back from the database in its own format; projection uses the day, and the digest is what's compared.
  const report = (await s.repo.getReport<CvReviewPayload>(s.reportId))!;
  const previewDigest = shareOptions(report.payload, report.row.createdAt).find((o) => o.scope === scope)!.digest;
  const r = await createShareFlow(s.repo, { reportId: s.reportId, scope, expiryDays: 7, previewDigest });
  assert.ok("path" in r, JSON.stringify(r));
  return r.path.split("/").pop()!;
}

for (const b of backends) {
  test(`${b.name}: a live link opens, logs a time, and shows the stored score at its own scope`, async () => {
    const s = await b.student();
    assert.equal(await s.repo.sharingEnabled(), true);
    const token = await share(s);
    const view = await resolveShare(token, b.backend);
    assert.equal(view?.score, s.payload.analysis.score);
    assert.deepEqual(view?.areas, []);
    const [link] = await s.repo.shareLinks();
    assert.equal(link.accesses.length, 1);
    assert.deepEqual(Object.keys(link).sort(), ["accesses", "contentDigest", "createdAt", "expiresAt", "id", "reportId", "revokedAt", "scope"]);
  });

  test(`${b.name}: revoked, expired, changed and deleted all resolve to nothing, and no failure is logged as a view`, async () => {
    const s = await b.student();
    const revoked = await share(s);
    const linkR = (await s.repo.shareLinks())[0];
    assert.equal(await s.repo.revokeShareLink(linkR.id), true);
    assert.equal(await s.repo.revokeShareLink(linkR.id), true, "repeating is harmless");
    assert.equal(await resolveShare(revoked, b.backend), null);

    const expired = await share(s);
    const linkE = (await s.repo.shareLinks()).find((l) => l.id !== linkR.id)!;
    await b.expire(linkE.id, s);
    assert.equal(await resolveShare(expired, b.backend), null);
    assert.equal(await b.backend.recordAccess(linkE.id), false, "a late write can't log an expired link");
    for (const l of await s.repo.shareLinks()) assert.equal(l.accesses.length, 0);

    const stale = await b.student();
    const staleToken = await share(stale);
    await b.rescore(stale);
    assert.equal(await resolveShare(staleToken, b.backend), null);
    assert.equal((await stale.repo.shareLinks())[0].accesses.length, 0);

    const gone = await b.student();
    const goneToken = await share(gone);
    await b.remove(gone);
    assert.equal(await resolveShare(goneToken, b.backend), null);
  });

  // Each layer on its own: resolveShare would catch a lookup that let a dead link through at the log step, and the other way round.
  test(`${b.name}: the lookup and the log step each refuse a dead link by themselves`, async () => {
    const s = await b.student();
    const revoked = await share(s);
    const linkR = (await s.repo.shareLinks())[0];
    assert.notEqual(await b.backend.lookup(hashShareToken(revoked)), null);
    await s.repo.revokeShareLink(linkR.id);
    assert.equal(await b.backend.lookup(hashShareToken(revoked)), null, "lookup: revoked");
    assert.equal(await b.backend.recordAccess(linkR.id), false, "log: revoked");

    const expired = await share(s);
    const linkE = (await s.repo.shareLinks()).find((l) => l.id !== linkR.id)!;
    await b.expire(linkE.id, s);
    assert.equal(await b.backend.lookup(hashShareToken(expired)), null, "lookup: expired");
    assert.equal(await b.backend.recordAccess(linkE.id), false, "log: expired");

    const off = await share(s);
    const linkO = (await s.repo.shareLinks()).find((l) => l.id !== linkR.id && l.id !== linkE.id)!;
    await b.institution(false);
    try {
      assert.equal(await b.backend.lookup(hashShareToken(off)), null, "lookup: institution off");
      assert.equal(await b.backend.recordAccess(linkO.id), false, "log: institution off");
    } finally {
      await b.institution(true);
    }
    assert.notEqual(await b.backend.lookup(hashShareToken(off)), null);
    for (const l of await s.repo.shareLinks()) assert.equal(l.accesses.length, 0);
  });

  test(`${b.name}: a second student can't create on, see or revoke another's link`, async () => {
    const [a, other] = [await b.student(), await b.student()];
    const token = await share(a);
    const [link] = await a.repo.shareLinks();
    await assert.rejects(other.repo.createShareLink({ reportId: a.reportId, tokenHash: "d".repeat(64), scope: "score", contentDigest: link.contentDigest, expiresAt: new Date(Date.now() + 864e5).toISOString() }));
    assert.deepEqual(await other.repo.shareLinks(), []);
    assert.equal(await other.repo.revokeShareLink(link.id), false);
    assert.notEqual(await resolveShare(token, b.backend), null);
  });
}

test("supabase: sharing is off by default, for a new university too, and turning it off stops a live link", async () => {
  const uni = (await db.query<{ report_sharing_enabled: boolean }>(`insert into public.universities (name, domain) values ('Southfield', 'southfield.ac.uk') returning report_sharing_enabled`)).rows[0];
  assert.equal(uni.report_sharing_enabled, false);
  const id = (await db.query<{ id: string }>(`insert into auth.users (email) values ('s.student@southfield.ac.uk') returning id`)).rows[0].id;
  const p = payload();
  const reportId = (await db.query<{ id: string }>(`insert into public.reports (user_id, type, title, score, payload) values ($1, 'cv_review', 'x', 1, $2) returning id`, [id, JSON.stringify(p)])).rows[0].id;
  const repo = supabaseRepo(sessionClient(id), id, () => serviceClient);
  assert.equal(await repo.sharingEnabled(), false);
  await assert.rejects(repo.createShareLink({ reportId, tokenHash: "e".repeat(64), scope: "score", contentDigest: "f".repeat(64), expiresAt: new Date(Date.now() + 864e5).toISOString() }));

  const s = await backends[1].student();
  const token = await share(s);
  const backend = backends[1].backend;
  await db.exec(`update public.universities set report_sharing_enabled = false where domain = 'northfield.ac.uk'`);
  try {
    assert.equal(await resolveShare(token, backend), null);
    assert.equal(await s.repo.sharingEnabled(), false);
  } finally {
    await db.exec(`update public.universities set report_sharing_enabled = true where domain = 'northfield.ac.uk'`);
  }
  assert.notEqual(await resolveShare(token, backend), null);
});

test("nothing is shown if the view can't be logged, or if the link died between the lookup and the log", async () => {
  const s = await backends[0].student();
  const token = await share(s);
  const live = (await demoShareBackend.lookup(hashShareToken(token)))!;
  assert.ok(live);
  const raced: ShareBackend = { lookup: async () => live, recordAccess: async () => false };
  assert.equal(await resolveShare(token, raced), null, "revoked in between");
  const saved = console.error;
  console.error = () => {};
  try {
    assert.equal(await resolveShare(token, { lookup: async () => live, recordAccess: () => Promise.reject(new Error("log down")) }), null, "log unavailable");
    assert.equal(await resolveShare(token, { lookup: () => Promise.reject(new Error("db down")), recordAccess: async () => true }), null, "database unavailable");
  } finally {
    console.error = saved;
  }
  assert.equal(await resolveShare(token, null), null, "no backend, as in a production server with no database");
});

test("supabase: before the migration, sharing reads as off and the data export still works; other errors surface", async () => {
  const missing = { rpc: async () => ({ data: null, error: { message: "function not found", code: "PGRST202" } }), from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: null, error: { message: "no table", code: "PGRST205" } }) }) }) }) } as unknown as SupabaseClient;
  const repo = supabaseRepo(missing, crypto.randomUUID(), () => missing);
  assert.equal(await repo.sharingEnabled(), false);
  assert.deepEqual(await repo.shareLinks(), []);
  const broken = { from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: null, error: { message: "boom", code: "XX000" } }) }) }) }) } as unknown as SupabaseClient;
  await assert.rejects(supabaseRepo(broken, crypto.randomUUID(), () => broken).shareLinks(), /boom/);
});
