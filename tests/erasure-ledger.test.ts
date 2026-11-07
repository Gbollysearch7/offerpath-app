// FD-21: a restore mustn't bring back students who asked to be erased. A real PGlite data directory is snapshotted and
// reloaded to stand in for a backup and restore; the migrations, the delete trigger and every cascade are the real SQL.
// Auth and PostgREST are stubbed by a small client below, and the bucket is a Map, as storage isn't in a database backup.
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeEntries, mergeIntoLedger, parseLedgerFile, readLedger, reapplyErasures, serialiseLedger, type LedgerEntry } from "@/lib/erasure-ledger";

const BOOT = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema storage; create schema extensions;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb, email_confirmed_at timestamptz default now(), created_at timestamptz default now(), last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant execute on function auth.uid() to anon, authenticated;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security; grant select, insert, delete on storage.objects to authenticated;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
  grant execute on function storage.foldername(text) to authenticated;
`;

let snapshotOfMigrations: Blob;
before(async () => {
  const db = new PGlite();
  await db.exec(BOOT);
  for (const f of fs.readdirSync("supabase/migrations").filter((x) => x.endsWith(".sql")).sort()) await db.exec(fs.readFileSync(path.join("supabase/migrations", f), "utf8"));
  await db.exec(fs.readFileSync("supabase/seed.sql", "utf8"));
  snapshotOfMigrations = await db.dumpDataDir("none");
  await db.close();
});
// Closed here too, so a failing test can't keep the process open.
const opened: PGlite[] = [];
const open = (dump: Blob) => {
  const db = new PGlite({ loadDataDir: dump });
  opened.push(db);
  return db;
};
const freshDb = () => open(snapshotOfMigrations);
after(async () => {
  for (const db of opened) if (!db.closed) await db.close();
});

type Bucket = Map<string, Uint8Array>;

/** The calls the ledger code makes through supabase-js, against PGlite as the service role. Nothing else is modelled, so anything else fails loudly. */
function clientFor(db: PGlite, bucket: Bucket): SupabaseClient {
  const asService = async <T>(fn: () => Promise<T>): Promise<T> => {
    await db.exec("set role service_role");
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
    }
  };
  const fail = (e: unknown) => ({ data: null, error: { message: (e as Error).message } });
  const client = {
    from(table: string) {
      if (table === "erasure_ledger") {
        return {
          select: () => ({
            order: () => ({
              range: async (a: number, b: number) => {
                try {
                  const r = await asService(() => db.query<{ account_id: string; erased_at: Date }>(`select account_id, erased_at from public.erasure_ledger order by account_id limit ${b - a + 1} offset ${a}`));
                  return { data: r.rows.map((x) => ({ account_id: x.account_id, erased_at: x.erased_at.toISOString() })), error: null };
                } catch (e) {
                  return fail(e);
                }
              },
            }),
          }),
          upsert: async (rows: { account_id: string; erased_at: string }[], opts: { onConflict: string; ignoreDuplicates: boolean }) => {
            assert.equal(opts.ignoreDuplicates, true, "a date already on record is never overwritten");
            try {
              await asService(async () => {
                for (const r of rows) await db.query(`insert into public.erasure_ledger (account_id, erased_at) values ($1, $2) on conflict (account_id) do nothing`, [r.account_id, r.erased_at]);
              });
              return { data: null, error: null };
            } catch (e) {
              return fail(e);
            }
          },
        };
      }
      assert.ok(table === "cv_sources" || table === "reports", `not modelled: ${table}`);
      return {
        select: () => ({
          eq: (_: string, id: string) => ({
            not: async () => {
              const r = await asService(() => db.query<{ storage_path: string }>(`select storage_path from public.${table} where user_id = $1 and storage_path is not null`, [id]));
              return { data: r.rows, error: null };
            },
          }),
        }),
      };
    },
    auth: {
      admin: {
        async getUserById(id: string) {
          const r = await db.query(`select id from auth.users where id = $1`, [id]);
          return r.rows.length ? { data: { user: r.rows[0] }, error: null } : { data: { user: null }, error: { message: "User not found", status: 404 } };
        },
        async deleteUser(id: string) {
          await db.query(`delete from auth.users where id = $1`, [id]);
          return { data: {}, error: null };
        },
      },
    },
    storage: {
      from: () => ({
        async list(prefix: string, opts: { limit: number; offset: number }) {
          const here = [...bucket.keys()].filter((p) => p.startsWith(`${prefix}/`)).map((p) => p.slice(prefix.length + 1));
          return { data: here.filter((p) => !p.includes("/")).sort().map((name) => ({ name, id: `id-${name}` })).slice(opts.offset, opts.offset + opts.limit), error: null };
        },
        async remove(paths: string[]) {
          for (const p of paths) bucket.delete(p);
          return { data: paths, error: null };
        },
      }),
    },
  };
  return client as unknown as SupabaseClient;
}

async function student(db: PGlite, bucket: Bucket, name: string) {
  const email = `${name}.${crypto.randomUUID().slice(0, 6)}@northfield.ac.uk`;
  const id = (await db.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [email])).rows[0].id;
  await db.query(`insert into public.reports (user_id, type, title, score, payload, storage_path) values ($1, 'cv_review', 'cv.pdf', 60, '{}', $2)`, [id, `${id}/cv.pdf`]);
  bucket.set(`${id}/cv.pdf`, new Uint8Array([1, 2, 3]));
  return { id, email };
}
const count = async (db: PGlite, sql: string, args: unknown[] = []) => Number((await db.query<{ n: number }>(`select count(*)::int as n from ${sql}`, args)).rows[0].n);
const presence = async (db: PGlite, id: string) => ({ user: await count(db, "auth.users where id = $1", [id]), profile: await count(db, "public.profiles where id = $1", [id]), reports: await count(db, "public.reports where user_id = $1", [id]) });
const GONE = { user: 0, profile: 0, reports: 0 };
const HERE = { user: 1, profile: 1, reports: 1 };

test("every way of deleting an account records its opaque id, and nothing else", async () => {
  const db = await freshDb();
  const bucket: Bucket = new Map();
  const a = await student(db, bucket, "self.service");
  const b = await student(db, bucket, "retention.job");
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${a.id}', false);`);
  await db.query(`select public.delete_my_account()`);
  await db.exec(`reset role;`);
  await clientFor(db, bucket).auth.admin.deleteUser(b.id);
  const rows = (await db.query<Record<string, string>>(`select * from public.erasure_ledger`)).rows;
  assert.deepEqual(rows.map((r) => r.account_id).sort(), [a.id, b.id].sort());
  for (const r of rows) assert.deepEqual(Object.keys(r).sort(), ["account_id", "erased_at"]);
  assert.ok(!JSON.stringify(rows).includes("@"), "no email");
  await db.close();
});

test("simulated restore: the backup brings an erased student back and its ledger doesn't know, and the export re-applies it", async () => {
  const db = await freshDb();
  const bucket: Bucket = new Map();
  const before = await student(db, bucket, "erased.before.backup");
  const after = await student(db, bucket, "erased.after.backup");
  const kept = await student(db, bucket, "kept");
  await clientFor(db, bucket).auth.admin.deleteUser(before.id);
  bucket.delete(`${before.id}/cv.pdf`);
  const beforeRow = (await readLedger(clientFor(db, bucket))).find((e) => e.id === before.id)!;

  // The backup: the database, and a separate copy of the bucket, taken together.
  const dump = await db.dumpDataDir("none");
  const bucketCopy: Bucket = new Map(bucket);

  // After the backup, this student asks to be erased.
  await clientFor(db, bucket).auth.admin.deleteUser(after.id);
  bucket.delete(`${after.id}/cv.pdf`);
  assert.deepEqual(await presence(db, after.id), GONE);

  // The operator's off-site export, taken before the loss.
  const exported = serialiseLedger(await readLedger(clientFor(db, bucket)));
  await db.close();

  const restored = open(dump);
  const client = clientFor(restored, bucketCopy);

  // The defect, shown on the restored copy: they're back, with their file, and the restored ledger has no record of them.
  assert.deepEqual(await presence(restored, after.id), HERE, "the backup brings the erased student back");
  assert.ok(bucketCopy.has(`${after.id}/cv.pdf`));
  assert.ok(!(await readLedger(client)).some((e) => e.id === after.id), "a database restore takes the ledger back too: this is why the export must live elsewhere");
  assert.deepEqual(await presence(restored, before.id), GONE, "erased before the backup: already absent");

  const entries = mergeEntries(await readLedger(client), parseLedgerFile(exported));

  // A dry run changes nothing and says what it would do.
  const dry = await reapplyErasures(client, entries, { apply: false });
  assert.deepEqual(dry.wouldErase, [after.id]);
  assert.deepEqual(await presence(restored, after.id), HERE, "dry run");
  assert.ok(bucketCopy.has(`${after.id}/cv.pdf`), "dry run");

  const done = await reapplyErasures(client, entries, { apply: true });
  assert.deepEqual(done.erased, [after.id]);
  assert.deepEqual(done.failed, []);
  assert.deepEqual(await presence(restored, after.id), GONE, "erased again, every row by cascade");
  assert.ok(![...bucketCopy.keys()].some((k) => k.startsWith(`${after.id}/`)), "and the restored file");
  assert.deepEqual(await presence(restored, kept.id), HERE, "nobody else is touched");
  assert.ok(bucketCopy.has(`${kept.id}/cv.pdf`));

  // Running it again finds nothing new, and the ledger is whole with the original dates.
  const again = await reapplyErasures(client, entries, { apply: true });
  assert.deepEqual(again.erased, []);
  assert.deepEqual(again.failed, []);
  const ledger = await readLedger(client);
  assert.deepEqual(ledger.map((e) => e.id).sort(), [before.id, after.id].sort());
  assert.equal(ledger.find((e) => e.id === before.id)!.erasedAt, beforeRow.erasedAt, "the date of the first erasure stands");
  assert.equal(ledger.find((e) => e.id === after.id)!.erasedAt, parseLedgerFile(exported).find((e) => e.id === after.id)!.erasedAt, "the export's date, not the day of the restore");
  await restored.close();
});

test("without an export, an erasure made after the backup can't be found: the gap the procedure states plainly", async () => {
  const db = await freshDb();
  const bucket: Bucket = new Map();
  const after = await student(db, bucket, "after");
  const dump = await db.dumpDataDir("none");
  await clientFor(db, bucket).auth.admin.deleteUser(after.id);
  await db.close();
  const restored = open(dump);
  const client = clientFor(restored, bucket);
  const out = await reapplyErasures(client, await readLedger(client), { apply: true });
  assert.deepEqual(out.erased, []);
  assert.deepEqual(await presence(restored, after.id), HERE);
  await restored.close();
});

test("a student erased and signed up again keeps the new account: the ledger holds the account, not the person", async () => {
  const db = await freshDb();
  const bucket: Bucket = new Map();
  const old = await student(db, bucket, "returning");
  const client = clientFor(db, bucket);
  await client.auth.admin.deleteUser(old.id);
  const entries = await readLedger(client);
  const fresh = (await db.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [old.email])).rows[0].id;
  const out = await reapplyErasures(client, entries, { apply: true });
  assert.deepEqual(out.erased, []);
  assert.equal(await count(db, "auth.users where id = $1", [fresh]), 1);
  await db.close();
});

test("files left in a restored bucket for an account already absent are removed too", async () => {
  const db = await freshDb();
  const bucket: Bucket = new Map();
  const s = await student(db, bucket, "orphan");
  const client = clientFor(db, bucket);
  await client.auth.admin.deleteUser(s.id);
  assert.ok(bucket.has(`${s.id}/cv.pdf`), "the bucket copy still has it");
  const entries = await readLedger(client);
  const dry = await reapplyErasures(client, entries, { apply: false });
  assert.deepEqual(dry.wouldRemoveFilesOnly, [s.id]);
  const out = await reapplyErasures(client, entries, { apply: true });
  assert.deepEqual(out.filesRemoved, [s.id]);
  assert.ok(!bucket.has(`${s.id}/cv.pdf`));
  await db.close();
});

test("one account that can't be erased is reported, doesn't stop the rest, keeps its rows, and a retry finishes it", async () => {
  const db = await freshDb();
  const bucket: Bucket = new Map();
  const a = await student(db, bucket, "a");
  const b = await student(db, bucket, "b");
  const client = clientFor(db, bucket);
  const dump = await db.dumpDataDir("none");
  await client.auth.admin.deleteUser(a.id);
  await client.auth.admin.deleteUser(b.id);
  const entries = await readLedger(client);
  await db.close();
  const restored = open(dump);
  const copy = new Map(bucket);
  // Only a's file fails to go.
  const c = clientFor(restored, copy);
  const realFrom = c.storage.from.bind(c.storage);
  (c.storage as { from: unknown }).from = (x: string) => {
    const s = realFrom(x);
    return { ...s, remove: async (paths: string[]) => (paths.some((p) => p.startsWith(a.id)) ? { data: null, error: { message: "storage down" } } : s.remove(paths)) };
  };
  const out = await reapplyErasures(c, entries, { apply: true });
  assert.deepEqual(out.failed, [a.id]);
  assert.deepEqual(out.erased, [b.id]);
  assert.deepEqual(await presence(restored, a.id), HERE, "the account stays so it can be retried");
  const retry = await reapplyErasures(clientFor(restored, copy), entries, { apply: true });
  assert.deepEqual(retry.erased, [a.id]);
  assert.deepEqual(retry.failed, []);
  await restored.close();
});

test("a ledger that can't be written stops before anything is deleted", async () => {
  const db = await freshDb();
  const bucket: Bucket = new Map();
  const s = await student(db, bucket, "s");
  const client = clientFor(db, bucket);
  const broken = { ...client, from: (t: string) => (t === "erasure_ledger" ? { upsert: async () => ({ data: null, error: { message: "denied" } }) } : client.from(t)) } as unknown as SupabaseClient;
  await assert.rejects(reapplyErasures(broken, [{ id: s.id, erasedAt: "2026-11-01T00:00:00.000Z" }], { apply: true }), /ledger/i);
  assert.deepEqual(await presence(db, s.id), HERE);
  await db.close();
});

test("merging into the ledger is idempotent and never moves a date", async () => {
  const db = await freshDb();
  const client = clientFor(db, new Map());
  const id = crypto.randomUUID();
  await mergeIntoLedger(client, [{ id, erasedAt: "2026-01-01T00:00:00.000Z" }]);
  await mergeIntoLedger(client, [{ id, erasedAt: "2026-06-01T00:00:00.000Z" }]);
  assert.deepEqual(await readLedger(client), [{ id, erasedAt: "2026-01-01T00:00:00.000Z" }]);
  await db.close();
});

test("the export is ids and dates only: the reader refuses anything else, without repeating it", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const entries: LedgerEntry[] = [{ id, erasedAt: "2026-11-01T00:00:00.000Z" }];
  assert.deepEqual(parseLedgerFile(serialiseLedger(entries)), entries);
  assert.deepEqual(mergeEntries(entries, [{ id, erasedAt: "2026-10-01T00:00:00.000Z" }]), [{ id, erasedAt: "2026-10-01T00:00:00.000Z" }], "the earliest date");
  for (const bad of [`{"id":"${id}","erasedAt":"2026-11-01T00:00:00.000Z","email":"jane.secret@northfield.ac.uk"}`, `{"id":"jane.secret@northfield.ac.uk","erasedAt":"2026-11-01T00:00:00.000Z"}`, `{"id":"${id}","erasedAt":"soon"}`, `jane.secret@northfield.ac.uk`]) {
    assert.throws(() => parseLedgerFile(bad), (e: Error) => /line 1/.test(e.message) && !e.message.includes("jane.secret"), bad);
  }
});

/* ---------- the script's own guards: none of these reach a network ---------- */

const runScript = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/erasures.ts", ...args], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } as unknown as NodeJS.ProcessEnv });

test("the script refuses without its own explicit target, and never reads the app's variables", () => {
  const appVars = { NEXT_PUBLIC_SUPABASE_URL: "https://live.invalid", SUPABASE_SERVICE_ROLE_KEY: "fake" };
  const r = runScript(["reapply", "--target-ref", "live", "--ledger", "x.jsonl"], appVars);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /ERASURE_SUPABASE_URL/);
});

test("the script refuses a target that doesn't match the ref it was given", () => {
  const r = runScript(["reapply", "--target-ref", "restored", "--ledger", "x.jsonl"], { ERASURE_SUPABASE_URL: "https://production.supabase.invalid", ERASURE_SERVICE_ROLE_KEY: "fake" });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /doesn't match/);
});

test("the script won't re-apply without an export, unless told there is none", () => {
  const r = runScript(["reapply", "--target-ref", "restored"], { ERASURE_SUPABASE_URL: "https://restored.supabase.invalid", ERASURE_SERVICE_ROLE_KEY: "fake" });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /--ledger/);
});

test("the script refuses an unreadable export before connecting", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erasure-"));
  const file = path.join(dir, "ledger.jsonl");
  fs.writeFileSync(file, `{"id":"jane.secret@northfield.ac.uk","erasedAt":"x"}\n`);
  const r = runScript(["reapply", "--target-ref", "restored", "--ledger", file], { ERASURE_SUPABASE_URL: "https://restored.supabase.invalid", ERASURE_SERVICE_ROLE_KEY: "fake" });
  fs.rmSync(dir, { recursive: true });
  assert.equal(r.status, 2, r.stderr);
  assert.ok(!r.stderr.includes("jane.secret"));
});
