// OP-026: a deleted account loses its documents, generated reports and original files, including every cv_sources
// version, by both routes: the student's own deletion and the retention job. Runs the real repository, flows and job
// over the in-memory fake, which models foreign-key cascades and storage's folder listing. What the real Postgres
// foreign keys do is checked separately in supabase/tests/security.test.mjs; real Supabase Storage is not tested at all.
import "./fixtures/next-server-shim";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { STAGES } from "@/lib/analysis/lexicon";
import { correctFlow, pasteFlow, uploadFlow } from "@/lib/cv-flow";
import { contentBlocks } from "@/lib/analysis/content";
import { runRetention } from "@/lib/jobs";
import { hit } from "@/lib/rate-limit";
import { demoRepo } from "@/lib/repo/demo";
import { supabaseRepo } from "@/lib/repo/supabase";
import { fakeSupabase } from "./fixtures/fake-supabase";
import { withEnv } from "./fixtures/request-scope";

delete process.env.ANTHROPIC_API_KEY;

const SECTOR = "Technology";
const STAGE = STAGES[0];
const fixture = (name: string) => new Uint8Array(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/extraction", name)));
const key = () => crypto.randomUUID().replace(/-/g, "");
const TYPED = Array.from({ length: 12 }, (_, i) => `• Led project ${i} for a student society, raising £${i + 1},000 from local sponsors and training 12 volunteers`).join("\n");
const CONFIGURED = { NEXT_PUBLIC_SUPABASE_URL: "https://op026-no-such-project.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" };

/** A student with one of everything: a held upload with its file, a correction, a scan kept with typed text, scored reports. */
async function populatedAccount(fake: ReturnType<typeof fakeSupabase>, userId: string) {
  const repo = supabaseRepo(fake.client, userId, () => fake.client);
  const held = await uploadFlow(repo, { bytes: fixture("lost-bullets.pdf"), fileName: "lost-bullets.pdf", sector: SECTOR, stage: STAGE, key: key() });
  assert.equal(held.kind, "review");
  if (held.kind !== "review") throw new Error("unreachable");
  const blocks = contentBlocks((await repo.getSource(held.review.sourceId))!.text);
  const corrected = await correctFlow(repo, { sourceId: held.review.sourceId, blocks: [{ id: blocks[0].id, text: `${blocks[0].text} edited` }], sector: SECTOR, stage: STAGE, key: key() });
  assert.ok("id" in corrected);
  const pasted = await pasteFlow(repo, { text: TYPED, original: { bytes: fixture("scan.pdf"), fileName: "scan.pdf" }, sector: SECTOR, stage: STAGE, key: key() });
  assert.ok("id" in pasted);
  const scored = await uploadFlow(repo, { bytes: fixture("single-column.pdf"), fileName: "single-column.pdf", sector: SECTOR, stage: STAGE, key: key() });
  assert.notEqual(scored.kind, "error");
  return repo;
}
const owned = (fake: ReturnType<typeof fakeSupabase>, userId: string) => ({
  sources: fake.sources.filter((s) => s.user_id === userId).length,
  corrections: fake.sources.filter((s) => s.user_id === userId && s.kind === "correction").length,
  pastes: fake.sources.filter((s) => s.user_id === userId && s.kind === "paste").length,
  uploads: fake.sources.filter((s) => s.user_id === userId && s.kind === "upload").length,
  reports: fake.rows.filter((r) => r.user_id === userId).length,
  files: [...fake.objects.keys()].filter((p) => p.startsWith(`${userId}/`)).length,
});
const NOTHING = { sources: 0, corrections: 0, pastes: 0, uploads: 0, reports: 0, files: 0 };

test("self-service deletion removes every version, its text, every report and every original file, and nobody else's", async () => {
  const fake = fakeSupabase();
  const [me, other] = [crypto.randomUUID(), crypto.randomUUID()];
  const repo = await populatedAccount(fake, me);
  await populatedAccount(fake, other);
  const before = owned(fake, me);
  assert.ok(before.uploads >= 3 && before.corrections === 1 && before.pastes === 1 && before.reports >= 2 && before.files >= 3, JSON.stringify(before));
  const otherBefore = owned(fake, other);

  fake.session.userId = me;
  await repo.deleteAccount();

  assert.deepEqual(owned(fake, me), NOTHING);
  assert.deepEqual(owned(fake, other), otherBefore, "the other student's data is untouched");
  assert.ok(!JSON.stringify([...fake.sources, ...fake.rows]).includes(me), "no row mentions the deleted account");
});

test("the retention job removes the same things, for the accounts it is told to and no others", async () => {
  const fake = fakeSupabase();
  const [idle, warned, active] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  for (const id of [idle, warned, active]) await populatedAccount(fake, id);
  const activeBefore = owned(fake, active);
  const warnedBefore = owned(fake, warned);
  fake.session.retentionCandidates = [
    { user_id: idle, email: "idle@northfield.ac.uk", full_name: "Idle", action: "delete" },
    { user_id: warned, email: "warned@northfield.ac.uk", full_name: "Warned", action: "warn" },
  ];
  const sent: string[] = [];
  const result = await withEnv(CONFIGURED, () =>
    runRetention(
      async (e) => {
        sent.push(e.to);
        return { sent: true };
      },
      () => fake.client,
    ),
  );
  assert.deepEqual(result, { warned: 1, deleted: 1, failed: 0 });
  assert.deepEqual(sent, ["warned@northfield.ac.uk"]);
  assert.deepEqual(owned(fake, idle), NOTHING);
  assert.deepEqual(owned(fake, warned), warnedBefore, "a warning deletes nothing");
  assert.deepEqual(owned(fake, active), activeBefore);
});

test("one account that can't be deleted doesn't stop the others, is reported, and keeps its rows for the retry", async () => {
  const fake = fakeSupabase();
  const [stuck, next] = [crypto.randomUUID(), crypto.randomUUID()];
  await populatedAccount(fake, stuck);
  await populatedAccount(fake, next);
  fake.session.retentionCandidates = [
    { user_id: stuck, email: "a@northfield.ac.uk", full_name: "A", action: "delete" },
    { user_id: next, email: "b@northfield.ac.uk", full_name: "B", action: "delete" },
  ];
  // Only the first account's files refuse to go.
  const from = fake.client.storage.from.bind(fake.client.storage);
  (fake.client.storage as unknown as { from: unknown }).from = (b: string) => ({
    ...from(b),
    remove: async (paths: string[]) => (paths.some((p) => p.startsWith(stuck)) ? { data: null, error: { message: "storage down" } } : from(b).remove(paths)),
  });
  const errors: string[] = [];
  const saved = console.error;
  console.error = (l: string) => void errors.push(l);
  try {
    const result = await withEnv(CONFIGURED, () => runRetention(async () => ({ sent: true }), () => fake.client));
    assert.deepEqual(result, { warned: 0, deleted: 1, failed: 1 });
  } finally {
    console.error = saved;
  }
  assert.ok(owned(fake, stuck).sources > 0, "still there, so the next run can retry");
  assert.deepEqual(owned(fake, next), NOTHING);
  assert.ok(errors.some((l) => /retention-delete-failed/.test(l)), "an alert was raised");
});

test("storage failure stops self-service deletion before any row goes: nothing is orphaned", async () => {
  for (const [fault, set] of [
    ["removal errors", (f: ReturnType<typeof fakeSupabase>) => (f.faults.removeError = "storage down")],
    ["listing errors", (f: ReturnType<typeof fakeSupabase>) => (f.faults.listError = "storage down")],
    ["removal claims success but removes nothing", (f: ReturnType<typeof fakeSupabase>) => (f.faults.removeIsNoop = true)],
  ] as const) {
    const fake = fakeSupabase();
    const me = crypto.randomUUID();
    const repo = await populatedAccount(fake, me);
    const before = owned(fake, me);
    set(fake);
    fake.session.userId = me;
    await assert.rejects(repo.deleteAccount(), /storage down|delete your files/, fault);
    assert.deepEqual(owned(fake, me), before, `${fault}: the account is intact and can try again`);
  }
});

test("a folder too big for one page of the storage listing is fully removed", async () => {
  const fake = fakeSupabase();
  const me = crypto.randomUUID();
  for (let i = 0; i < 250; i++) await fake.client.storage.from("cvs").upload(`${me}/${String(i).padStart(3, "0")}/cv.pdf`, new Uint8Array(1), { contentType: "application/pdf", upsert: false });
  for (let i = 0; i < 130; i++) await fake.client.storage.from("cvs").upload(`${me}/flat-${i}.pdf`, new Uint8Array(1), { contentType: "application/pdf", upsert: false });
  fake.session.userId = me;
  await supabaseRepo(fake.client, me, () => fake.client).deleteAccount();
  assert.equal(fake.objects.size, 0);
});

test("a file with no row pointing at it (an abandoned upload) goes too; a row can't point deletion at someone else's file", async () => {
  const fake = fakeSupabase();
  const [me, victim] = [crypto.randomUUID(), crypto.randomUUID()];
  const bucket = fake.client.storage.from("cvs");
  await bucket.upload(`${me}/orphan/cv.pdf`, new Uint8Array(1), { contentType: "application/pdf", upsert: false });
  await bucket.upload(`${victim}/keep/cv.pdf`, new Uint8Array(1), { contentType: "application/pdf", upsert: false });
  fake.rows.push({ id: crypto.randomUUID(), user_id: me, type: "cv_review", title: "x", score: 1, payload: {}, storage_path: `${victim}/keep/cv.pdf`, created_at: new Date().toISOString() });
  fake.session.userId = me;
  await supabaseRepo(fake.client, me, () => fake.client).deleteAccount();
  assert.deepEqual([...fake.objects.keys()], [`${victim}/keep/cv.pdf`]);
});

test("an upload that lands during deletion is swept up after the rows go", async () => {
  const fake = fakeSupabase();
  const me = crypto.randomUUID();
  const repo = supabaseRepo(fake.client, me, () => fake.client);
  fake.session.userId = me;
  const rpc = fake.client.rpc.bind(fake.client);
  (fake.client as unknown as { rpc: unknown }).rpc = async (name: string) => {
    await fake.client.storage.from("cvs").upload(`${me}/late/cv.pdf`, new Uint8Array(1), { contentType: "application/pdf", upsert: false });
    return rpc(name as never);
  };
  await repo.deleteAccount();
  assert.equal(fake.objects.size, 0);
});

test("demo mode: deletion removes versions and files too", async () => {
  const id = `student-${crypto.randomUUID()}`;
  const repo = demoRepo(id, "student");
  await uploadFlow(repo, { bytes: fixture("single-column.pdf"), fileName: "single-column.pdf", sector: SECTOR, stage: STAGE, key: key() });
  assert.ok((await repo.listSources()).length > 0);
  await repo.deleteAccount();
  const fresh = demoRepo(id, "student");
  assert.equal((await fresh.listSources()).length, 0);
  assert.equal((await fresh.exportFiles()).length, 0);
});

test("the rate limiter stores no email or IP address, and the retention job purges old windows", async () => {
  const keys: string[] = [];
  // In memory (no database): the same key derivation is what would go to the rate_limit_hit function.
  await hit("signInPerEmail", "Jane.Doe@Northfield.ac.uk");
  await hit("signInPerIp", "203.0.113.9");
  keys.push(...(globalThis as unknown as { __offerpathRate: Map<string, number> }).__offerpathRate.keys());
  assert.equal(keys.length, 2);
  assert.ok(keys.every((k) => !/jane|northfield|203\.0/i.test(k)), keys.join());
  await hit("signInPerEmail", "jane.doe@northfield.ac.uk");
  assert.equal((globalThis as unknown as { __offerpathRate: Map<string, number> }).__offerpathRate.size, 2, "still counts the same person together, whatever the case");

  const fake = fakeSupabase();
  fake.rateLimits.push({ key: "old", window_start: new Date(Date.now() - 3 * 86_400_000).toISOString(), count: 1 }, { key: "new", window_start: new Date().toISOString(), count: 1 });
  await withEnv(CONFIGURED, () => runRetention(async () => ({ sent: true }), () => fake.client));
  assert.deepEqual(fake.rateLimits.map((r) => r.key), ["new"]);
});
