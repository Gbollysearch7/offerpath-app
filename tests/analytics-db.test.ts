// OP-022: known synthetic events give known totals, and differencing attacks fail, in the real SQL. Every migration runs in
// PGlite with row-level security on and the caller's role set, as PostgREST would. Auth and PostgREST are stubbed.
//
// Exact totals are read by calling the internal functions as the owner, which no signed-in user can do (a test below proves it).
// What a careers admin gets is read through admin_analytics under their own role.
import "./fixtures/provider-stub";
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NORMALISER_VERSION, normaliseText } from "@/lib/analysis/fingerprint";
import type { PublishedAnalytics } from "@/lib/analytics/types";
import { listPeriods } from "@/lib/periods";
import { supabaseRepo } from "@/lib/repo/supabase";
import cases from "./fixtures/analytics-publication-cases.json";

const db = new PGlite();
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
async function asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role;`);
  }
}
const analytics = async (uid: string, period: string) => (await asUser(uid, () => q<{ r: PublishedAnalytics }>(`select public.admin_analytics($1) as r`, [period])))[0].r;

// A closed academic year, so nothing in these tests moves as real time passes.
const NOW = new Date();
const Y = Number(listPeriods(NOW).find((p) => p.key.startsWith("autumn-"))!.key.split("-")[1]) - 1;
const YEAR = `year-${Y}`;
const AUTUMN = `autumn-${Y}`;
const SPRING = `spring-${Y + 1}`;
const SUMMER = `summer-${Y + 1}`;
const inAutumn = `${Y}-10-15T12:00:00Z`;
const inSpring = `${Y + 1}-02-10T12:00:00Z`;
const lastYear = `${Y - 1}-10-15T12:00:00Z`;

const payload = (text: string, extra: Record<string, unknown> = {}, series = "rules|v1", bullets = 8) => ({ text, analysis: { meta: { bullets, scoring: { identity: series } }, lines: [] }, ...extra });
const CV = (i: number) => `Jordan Reed\n• Led ${i} "volunteers" – 2024\n• Raised £${i}00 for charity`;
// Same words as CV(i): another bullet glyph, curly quotes, a different dash, Windows line ends, extra spaces.
const REEXPORT = (i: number) => `  Jordan   Reed\r\n\r\n▪ Led ${i} “volunteers” — 2024\r\n- Raised  £${i}00 for charity  `;

let seq = 0;
async function university(domain: string) {
  return (await q<{ id: string }>(`insert into public.universities (name, domain) values ($1, $1) returning id`, [domain]))[0].id;
}
interface StudentOpts { faculty?: string; year?: string; fee?: string; share?: boolean; confirmed?: boolean; at?: string }
async function student(domain: string, o: StudentOpts = {}) {
  const email = `s${seq++}@${domain}`;
  const id = (await q<{ id: string }>(`insert into auth.users (email, email_confirmed_at) values ($1, ${o.confirmed === false ? "null" : "now()"}) returning id`, [email]))[0].id;
  await q(`update public.profiles set share_progress = $2, faculty = $3, year_of_study = $4, fee_status = $5, created_at = $6 where id = $1`, [id, o.share ?? true, o.faculty ?? "Business", o.year ?? "Year 2", o.fee ?? "home", o.at ?? inAutumn]);
  return { id, email };
}
async function adminOf(domain: string) {
  const id = (await q<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [`admin${seq++}@${domain}`]))[0].id;
  await q(`update public.profiles set role = 'admin' where id = $1`, [id]);
  return id;
}
const review = async (user: string, score: number | null, p: unknown, at = inAutumn, type = "cv_review") => (await q<{ id: string }>(`insert into public.reports (user_id, type, title, score, payload, created_at, updated_at) values ($1, $5, 'cv.pdf', $2, $3, $4, $4) returning id`, [user, score, JSON.stringify(p), at, type]))[0].id;
const job = (user: string, status: string, at = inAutumn) => q(`insert into public.analysis_jobs (user_id, workflow, idempotency_key, status, created_at, updated_at) values ($1, 'cv_score', $2, $3, $4, $4)`, [user, `k${seq++}`, status, at]);
const application = (user: string, status: string, at = inAutumn) => q(`insert into public.applications (user_id, role, org, status, closes_on, created_at) values ($1, 'Analyst', 'Northbank', $2, current_date, $3)`, [user, status, at]);
const referral = (uni: string, user: string, status: string, at = inAutumn) => q(`insert into public.adviser_referrals (university_id, student_id, target_label, reason, status, created_by_name, created_at, updated_at) values ($1, $2, 'Employability team', 'A long enough reason.', $3, 'An adviser', $4, $4)`, [uni, user, status, at]);
const editsWith = (decisions: Record<string, unknown>) => ({ edits: { current: "v2", versions: [{ id: "v1", decisions: { z: { status: "accepted", text: "old", at: inAutumn } } }, { id: "v2", decisions }] } });

const north = { domain: "north.ac.uk", uni: "", admin: "" };
const S: { id: string; email: string }[] = [];
const N: { id: string; email: string }[] = [];
let ghost = "";

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

  north.uni = await university(north.domain);
  north.admin = await adminOf(north.domain);
  // 60 sharing students: Business 30, Engineering 25, Music 4, Theology 1.
  for (let i = 0; i < 60; i++) S.push(await student(north.domain, { faculty: i < 30 ? "Business" : i < 55 ? "Engineering" : i < 59 ? "Music" : "Theology", year: i % 2 ? "Year 2" : "Year 3", fee: i < 40 ? "home" : "international" }));
  // 10 who don't share: their activity is everywhere a sharing student's would be, and must not count.
  for (let i = 0; i < 10; i++) {
    const n = await student(north.domain, { share: false });
    N.push(n);
    await review(n.id, 90, payload(`Not sharing ${i}`));
    await application(n.id, "offer");
    await referral(north.uni, n.id, "accepted");
  }
  // 3 who never confirmed.
  for (let i = 0; i < 3; i++) {
    const u = await student(north.domain, { confirmed: false });
    if (i === 0) ghost = u.id;
    await review(u.id, 90, payload(`Unconfirmed ${i}`));
  }
  // Imported records: S0-54, all of N, and 25 people who never signed up. S55-59 have no record.
  for (const s of [...S.slice(0, 55), ...N]) await q(`insert into public.student_records (university_id, email) values ($1, $2)`, [north.uni, s.email]);
  for (let i = 0; i < 25; i++) await q(`insert into public.student_records (university_id, email) values ($1, $2)`, [north.uni, `never${i}@${north.domain}`]);

  // Completed: S0-39, one review each in autumn.
  for (let i = 0; i < 40; i++) await review(S[i].id, 50 + (i % 20), payload(CV(i)));
  // Duplicates: S0-19 resubmit the same text as a different file in spring.
  for (let i = 0; i < 20; i++) await review(S[i].id, 50 + (i % 20), payload(REEXPORT(i)), inSpring);
  // Repeat use: S20-29 send a different CV in spring. S20-24 improve by 12, S25-29 by 3.
  for (let i = 20; i < 30; i++) await review(S[i].id, 50 + (i % 20) + (i < 25 ? 12 : 3), payload(`${CV(i)}\n• A new line`), inSpring);
  // Incomplete: never a completed review. No bullets S40-45, low confidence S46, no score S47.
  for (let i = 40; i < 46; i++) await review(S[i].id, 10, payload(`Nothing ${i}`, {}, "rules|v1", 0));
  await review(S[46].id, 40, payload("Low confidence", { document: { extraction: { confidence: { band: "low" } } } }));
  await review(S[47].id, null, payload("No score"));
  // Failed analyses: S48-53 only ever failed. S0-5 failed too, and also have the review above.
  for (let i = 48; i < 54; i++) await job(S[i].id, "failed");
  for (let i = 0; i < 6; i++) await job(S[i].id, "failed");
  for (let i = 0; i < 40; i++) await job(S[i].id, "completed");
  // Useful edits, 13 students: 7 saved CV lines, 2 tailored, 1 letter, 2 corrections, 1 LinkedIn.
  for (let i = 30; i < 37; i++) await q(`update public.reports set payload = jsonb_set(payload, '{analysis,lines}', $2) where user_id = $1 and type = 'cv_review'`, [S[i].id, JSON.stringify([{ accepted: "Saved line", acceptedHistory: [{ text: null, check: null, at: inAutumn }] }])]);
  for (const i of [37, 38]) await review(S[i].id, null, editsWith({ a: { status: "accepted", text: "kept", at: inAutumn } }), inAutumn, "tailor");
  await review(S[45].id, null, editsWith({ a: { status: "edited", text: "kept", at: inAutumn } }), inAutumn, "cover_letter");
  for (const i of [41, 42]) {
    const [{ id: parent }] = await q<{ id: string }>(`insert into public.cv_sources (user_id, kind, file_name, text, document_version, created_at) values ($1, 'upload', 'cv', 'x', $2, $3) returning id`, [S[i].id, "a".repeat(64), inAutumn]);
    await q(`insert into public.cv_sources (user_id, parent_id, kind, file_name, text, document_version, created_at) values ($1, $2, 'correction', 'cv', 'y', $3, $4)`, [S[i].id, parent, "b".repeat(64), inAutumn]);
  }
  await review(S[43].id, null, { sections: [{ current: "b", versions: [{ id: "a", n: 1, at: inAutumn }, { id: "b", n: 2, at: inAutumn }] }] }, inAutumn, "linkedin");
  // Things that are not useful edits: a suggestion rejected, one undone (only an older version holds it), a LinkedIn section never changed.
  await review(S[39].id, null, editsWith({ a: { status: "rejected", text: "no", at: inAutumn } }), inAutumn, "tailor");
  await review(S[40].id, null, { edits: { current: "v1", versions: [{ id: "v1", decisions: {} }, { id: "v2", decisions: { a: { status: "accepted", text: "undone", at: inAutumn } } }] } }, inAutumn, "cover_letter");
  await review(S[44].id, null, { sections: [{ current: "a", versions: [{ id: "a", n: 1, at: inAutumn }] }] }, inAutumn, "linkedin");
  // Referrals: S0-6 count, S7 was withdrawn. S0-4 accepted.
  for (const [i, status] of ["accepted", "accepted", "accepted", "in_progress", "closed", "proposed", "declined", "withdrawn"].entries()) await referral(north.uni, S[i].id, status);
  // Tracker: S0-14 saved a role, S15-24 interview, S25-31 offer.
  for (let i = 0; i < 32; i++) await application(S[i].id, i < 15 ? "saved" : i < 25 ? "interview" : "offer");
});

test("known synthetic events give known exact totals", async () => {
  const [from, end] = [`${Y}-09-01T00:00:00Z`, `${Y + 1}-09-01T00:00:00Z`];
  const rows = await q<Record<string, unknown>>(`select * from public.analytics_student_rows($1, $2, $3)`, [north.uni, from, end]);
  const sum = (k: string) => rows.reduce((t, r) => t + Number(r[k]), 0);
  const count = (k: string) => rows.filter((r) => r[k]).length;
  assert.equal(rows.length, 60, "only sharing, confirmed students");
  assert.ok(!rows.some((r) => N.some((n) => n.id === r.user_id) || r.user_id === ghost));
  assert.equal(count("completed"), 40);
  assert.equal(sum("versions"), 50, "40 first CVs and 10 different second ones");
  assert.equal(sum("duplicates"), 20, "resubmissions are counted as duplicates, not reviews");
  assert.equal(sum("incompletes"), 8);
  assert.equal(sum("failed"), 12);
  assert.equal(count("reviewed_by_end"), 40);
  assert.equal(count("repeat_use"), 10);
  assert.equal(count("useful_edit"), 13);
  assert.equal(count("referred"), 7);
  assert.equal(count("referral_accepted"), 5);
  assert.equal(count("tracked"), 32);
  assert.equal(count("interview"), 17);
  assert.equal(count("offer"), 7);
});

test("what a careers admin sees is those totals under the rules, and nothing else", async () => {
  const a = await analytics(north.admin, YEAR);
  assert.equal(a.sample, false, "real data isn't labelled sample");
  assert.equal(a.withheld, false);
  assert.equal(a.invited, 90);
  assert.equal(a.accounts, 70);
  assert.equal(a.sharing, 60);
  assert.deepEqual(a.metrics, { activated: 65, completed: 40, versions: 50, usefulEdits: 15, repeatUse: 10, reviewed: 40, referred: 5, referralsAccepted: null, tracked: 30, interview: 15, offer: 5, students: 60 });
  assert.deepEqual(a.excluded, { duplicates: 20, incomplete: 10, failed: 10, noRecord: 5 });
  const all = a.breakdowns.find((r) => r.dimension === "All students");
  assert.equal(all && !all.hidden ? all.students : -1, 60);
  assert.equal(a.period.through, new Date(`${Y + 1}-09-01T00:00:00Z`).toISOString().replace(".000Z", "+00:00"));
});

test("duplicates and failed analyses don't inflate completion", async () => {
  const domain = "dupes.ac.uk";
  const uni = await university(domain);
  const admin = await adminOf(domain);
  const people = [];
  for (let i = 0; i < 12; i++) people.push(await student(domain));
  const read = async () => (await analytics(admin, YEAR)).metrics!;
  for (let i = 0; i < 6; i++) await review(people[i].id, 60, payload(CV(i)));
  const first = await read();
  assert.equal(first.completed, 5);
  // The same six resubmit four times each, in various formats, and fail four more times.
  for (let i = 0; i < 6; i++) for (let k = 0; k < 4; k++) {
    await review(people[i].id, 60, payload(k % 2 ? REEXPORT(i) : CV(i)));
    await job(people[i].id, "failed");
  }
  const after = await read();
  assert.equal(after.completed, first.completed);
  assert.equal(after.versions, first.versions);
  assert.equal(after.repeatUse, null);
  const exact = await q<{ versions: number; duplicates: number; failed: number }>(`select sum(versions)::int as versions, sum(duplicates)::int as duplicates, sum(failed)::int as failed from public.analytics_student_rows($1, null, now())`, [uni]);
  assert.deepEqual(exact[0], { versions: 6, duplicates: 24, failed: 24 });
  // A failure alone is no review at all.
  for (let i = 6; i < 12; i++) await job(people[i].id, "failed");
  assert.equal((await read()).completed, first.completed);
});

test("a duplicate of a CV reviewed in an earlier period isn't a new review in a later one", async () => {
  const a = await analytics(north.admin, SPRING);
  assert.equal(a.metrics!.completed, 10, "only the ten different CVs, not the twenty resubmissions");
  assert.equal(a.excluded!.duplicates, 20);
});

test("scores are compared only within one version set: a rule change is not an improvement", async () => {
  const domain = "versions.ac.uk";
  await university(domain);
  const admin = await adminOf(domain);
  for (let i = 0; i < 30; i++) {
    const s = await student(domain);
    await review(s.id, 40, payload(`A${i}`, {}, "rules|v1"));
    await review(s.id, 90, payload(`B${i}`, {}, "rules|v2"), inSpring);
  }
  for (let i = 0; i < 6; i++) {
    const s = await student(domain);
    await review(s.id, 95, payload(`C${i}`, {}, "rules|v3"));
  }
  const s = (await analytics(admin, YEAR)).scores!;
  assert.equal(s.versionSet, "rules|v2", "the largest set, the tie between v1 and v2 settled the same way every time");
  assert.equal(s.average, 90, "v1's 40s and v3's 95s are not averaged in");
  assert.equal(s.students, 30);
  assert.equal(s.setAside, 5, "the six students only under v3 are set aside, and said to be");
  assert.equal(s.improved10, null, "nobody has two reviews in the set, so a jump from 40 to 90 across versions is no improvement");
  assert.equal(s.comparable, null);
});

test("improvement needs two different texts in one set: resubmitting can't count", async () => {
  const domain = "improve.ac.uk";
  await university(domain);
  const admin = await adminOf(domain);
  for (let i = 0; i < 40; i++) {
    const s = await student(domain);
    await review(s.id, 50, payload(CV(i)));
    if (i < 10) await review(s.id, 65, payload(`${CV(i)}\n• Different text`), inSpring);
    else if (i < 20) await review(s.id, 65, payload(REEXPORT(i)), inSpring); // scored higher, but the same text
    else if (i < 30) await review(s.id, 52, payload(`${CV(i)}\n• Different text`), inSpring);
  }
  const s = (await analytics(admin, YEAR)).scores!;
  assert.equal(s.comparable, 20, "the 20 with different text, not the 10 who resubmitted");
  assert.equal(s.improved10, 10);
});

test("a filter attack: there is no filter, and no way to call anything that would be one", async () => {
  const fn = (await q<{ args: string; src: string }>(`select pg_get_function_identity_arguments(p.oid) as args, p.prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'admin_analytics'`));
  assert.equal(fn.length, 1, "one signature");
  assert.equal(fn[0].args, "p_period text", "a period and nothing else");
  for (const old of ["admin_overview", "admin_outcomes_pack"]) assert.equal((await q(`select 1 from pg_proc where proname = $1`, [old])).length, 0, `${old} and its open date range are gone`);
  const internals = await q<{ proname: string; auth: boolean; anon: boolean; pub: boolean }>(`select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('anon', p.oid, 'execute') as anon, exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as pub from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'analytics\\_%'`);
  assert.equal(internals.length, 15, "every internal function is checked, including any added later");
  for (const f of internals) assert.deepEqual([f.proname, f.auth, f.anon, f.pub], [f.proname, false, false, false], f.proname);
  await assert.rejects(asUser(north.admin, () => q(`select * from public.analytics_student_rows($1, null, now())`, [north.uni])), /permission denied/, "an admin can't read the exact rows");
  await assert.rejects(asUser(north.admin, () => q(`select * from public.analytics_reviews($1, now())`, [north.uni])), /permission denied/);
});

test("a date attack: only named periods, so a window can't be slid past one student", async () => {
  for (const bad of ["2026-01-01", `${Y}-10-01..${Y}-10-02`, `year-${Y}-x`, "autumn-20", "week-5", "", "ALL", "all' or '1'='1"]) {
    await assert.rejects(analytics(north.admin, bad), /unknown reporting period/, bad);
  }
  await assert.rejects(asUser(north.admin, () => q(`select public.admin_analytics('all', now())`)), /does not exist/, "there is no second argument");
});

test("named periods have the same boundaries as the list the page offers", async () => {
  for (const p of listPeriods(new Date("2026-11-07T00:00:00Z"))) {
    const [r] = await q<{ f: string | null; t: string | null }>(`select to_char(p_from at time zone 'UTC', 'YYYY-MM-DD') as f, to_char(p_to at time zone 'UTC', 'YYYY-MM-DD') as t from public.analytics_period($1)`, [p.key]);
    assert.deepEqual([r.f, r.t], [p.from, p.to], p.key);
  }
});

test("a group attack: a small group is hidden unnamed, and total minus the rest doesn't reveal it", async () => {
  const a = await analytics(north.admin, YEAR);
  const text = JSON.stringify(a);
  assert.doesNotMatch(text, /Theology|Music/, "the small groups aren't named");
  const fac = a.breakdowns.filter((r) => r.dimension === "Faculty");
  assert.deepEqual(fac.map((r) => r.group), ["Business", "Engineering", null]);
  assert.ok(fac[2].hidden);

  // One student alone in a faculty: hiding only them would leave total minus the rest pointing straight at them.
  const domain = "lone.ac.uk";
  await university(domain);
  const admin = await adminOf(domain);
  for (let i = 0; i < 30; i++) await application((await student(domain, { faculty: "Law" })).id, "offer");
  for (let i = 0; i < 20; i++) await application((await student(domain, { faculty: "Music" })).id, "saved");
  const lone = await student(domain, { faculty: "Theology" });
  await application(lone.id, "offer");
  const b = await analytics(admin, YEAR);
  const rows = b.breakdowns.filter((r) => r.dimension === "Faculty");
  assert.deepEqual(rows.map((r) => r.group), ["Law", null], "the next smallest group goes too");
  assert.doesNotMatch(JSON.stringify(b), /Theology|Music/);
  // What the attacker now has: the total, Law, and a remainder holding the lone student and 20 others.
  const all = b.breakdowns.find((r) => r.dimension === "All students")!;
  const law = rows[0];
  assert.ok(!all.hidden && !law.hidden);
  assert.ok(all.students! - law.students! >= 20, "a remainder of about twenty isn't one person");
});

test("an attribute attack: 'everyone in this group' and 'nobody in this group' can't be read", async () => {
  const domain = "attr.ac.uk";
  await university(domain);
  const admin = await adminOf(domain);
  for (let i = 0; i < 8; i++) await application((await student(domain, { faculty: "Law" })).id, "offer");
  for (let i = 0; i < 30; i++) await student(domain, { faculty: "Science" });
  for (let i = 0; i < 5; i++) await application((await student(domain, { faculty: "Art" })).id, "offer");
  const rows = (await analytics(admin, YEAR)).breakdowns;
  const row = (g: string) => rows.find((r) => r.group === g);
  for (const g of ["Law", "Science", "Art"]) {
    const r = row(g);
    assert.ok(r && !r.hidden, g);
    assert.equal(r.offer, null, `${g}: every or no student has an offer, and it can't be read`);
    assert.equal(r.tracked, null, g);
  }
});

test("a neighbour attack: one student's offer doesn't show as a difference of one", async () => {
  const domain = "neighbour.ac.uk";
  await university(domain);
  const admin = await adminOf(domain);
  const people = [];
  for (let i = 0; i < 40; i++) people.push(await student(domain));
  for (let i = 0; i < 10; i++) await application(people[i].id, "offer");
  const target = people[20];
  const before = JSON.stringify(await analytics(admin, YEAR));
  await application(target.id, "offer");
  assert.equal(JSON.stringify(await analytics(admin, YEAR)), before, "10 and 11 publish identically: with or without them, byte for byte");
  // Two more arrivals cross the rounding boundary. The figure jumps by five, so the true change can't be read off it.
  await application(people[21].id, "offer");
  await application(people[22].id, "offer");
  const m = (await analytics(admin, YEAR)).metrics!;
  assert.equal(m.offer, 15);
});

test("a term attack: year minus term is withheld while it would isolate a handful of students", async () => {
  const domain = "terms.ac.uk";
  await university(domain);
  const admin = await adminOf(domain);
  const people = [];
  for (let i = 0; i < 40; i++) people.push(await student(domain));
  for (let i = 0; i < 40; i++) await review(people[i].id, 60, payload(CV(i)));
  // Before anything happens in spring, the terms are safe to show: the rest of the year is empty.
  assert.equal((await analytics(admin, AUTUMN)).withheld, false);
  // Now two students, only two, do something in spring.
  for (const i of [0, 1]) await application(people[i].id, "offer", inSpring);
  for (const key of [AUTUMN, SPRING, SUMMER]) {
    const t = await analytics(admin, key);
    assert.equal(t.withheld, true, key);
    assert.equal(t.metrics, null, key);
    assert.deepEqual(t.breakdowns, [], key);
    assert.equal(t.scores, null, key);
  }
  const year = await analytics(admin, YEAR);
  assert.equal(year.withheld, false, "the year can still be shown");
  assert.ok(year.metrics!.completed === null || year.metrics!.completed > 0);
  // Three more, and spring holds five people: the terms come back.
  for (const i of [2, 3, 4]) await application(people[i].id, "offer", inSpring);
  assert.equal((await analytics(admin, SPRING)).withheld, false);
  assert.equal((await analytics(admin, AUTUMN)).withheld, false);
});

test("a year attack: all time minus a year is withheld while another year holds a handful", async () => {
  const domain = "years.ac.uk";
  await university(domain);
  const admin = await adminOf(domain);
  for (let i = 0; i < 40; i++) await student(domain);
  assert.equal((await analytics(admin, YEAR)).withheld, false);
  for (let i = 0; i < 3; i++) await student(domain, { at: lastYear });
  assert.equal((await analytics(admin, YEAR)).withheld, true, "all time minus this year would be those three");
  assert.equal((await analytics(admin, AUTUMN)).withheld, true, "and so is any term inside it");
  assert.equal((await analytics(admin, "all")).withheld, false, "all time has nothing to be subtracted from");
});

test("a timing attack: a student's action today can't be watched moving a figure", async () => {
  const domain = "today.ac.uk";
  await university(domain);
  const admin = await adminOf(domain);
  const people = [];
  for (let i = 0; i < 30; i++) people.push(await student(domain));
  for (let i = 0; i < 12; i++) await application(people[i].id, "offer");
  const before = JSON.stringify(await analytics(admin, "all"));
  const today = new Date().toISOString();
  for (let i = 12; i < 25; i++) {
    await application(people[i].id, "offer", today);
    await review(people[i].id, 80, payload(CV(i)), today);
  }
  assert.equal(JSON.stringify(await analytics(admin, "all")), before, "thirteen students acting today change nothing until tomorrow");
});

test("consent: a student who stops sharing leaves every figure, including past periods", async () => {
  const domain = "consent.ac.uk";
  const uni = await university(domain);
  const admin = await adminOf(domain);
  const people = [];
  for (let i = 0; i < 30; i++) people.push(await student(domain));
  for (let i = 0; i < 20; i++) await review(people[i].id, 60, payload(CV(i)));
  const exact = async () => (await q<{ n: number }>(`select count(*) filter (where completed)::int as n from public.analytics_student_rows($1, null, now())`, [uni]))[0].n;
  assert.equal(await exact(), 20);
  await q(`update public.profiles set share_progress = false where id = any($1)`, [people.slice(0, 10).map((p) => p.id)]);
  assert.equal(await exact(), 10);
  const a = await analytics(admin, YEAR);
  assert.equal(a.metrics!.completed, 10);
  assert.equal(a.sharing, 20);
  assert.equal(a.accounts, 30, "still counted as an account, which is a number and nothing else");
});

test("consent: the score of a student who doesn't share reaches no average, band or version set", async () => {
  const domain = "consent-scores.ac.uk";
  const uni = await university(domain);
  const admin = await adminOf(domain);
  for (let i = 0; i < 30; i++) await review((await student(domain)).id, 60, payload(CV(i)), inAutumn);
  // More of them than sharing students, all in another version set, all scoring far higher.
  const quiet: string[] = [];
  for (let i = 0; i < 40; i++) {
    const s = await student(domain, { share: false });
    quiet.push(s.id);
    await review(s.id, 100, payload(`Quiet ${i}`, {}, "rules|v9"));
  }
  const s = (await analytics(admin, YEAR)).scores!;
  assert.equal(s.versionSet, "rules|v1", "their version set isn't chosen");
  assert.equal(s.average, 60);
  assert.equal(s.setAside, null, "and they aren't counted as set aside");
  assert.equal(s.bands.top, null);
  const rows = await q<{ user_id: string }>(`select user_id from public.analytics_version_rows($1, null, now())`, [uni]);
  assert.ok(!rows.some((r) => quiet.includes(r.user_id)));
});

test("two universities: figures hold nothing from the other, and only a careers admin gets any", async () => {
  const domain = "other.ac.uk";
  await university(domain);
  const admin = await adminOf(domain);
  const adviser = (await q<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [`adviser@${domain}`]))[0].id;
  await q(`update public.profiles set role = 'adviser' where id = $1`, [adviser]);
  const a = await analytics(admin, YEAR);
  assert.equal(a.metrics!.students, null, "none of Northfield's sixty");
  assert.equal(a.invited, null);
  assert.equal(a.universityName, domain);
  assert.doesNotMatch(JSON.stringify(a), /north/);
  await assert.rejects(analytics(adviser, YEAR), /admins only/, "an adviser gets no dashboard");
  await assert.rejects(analytics(S[0].id, YEAR), /admins only/, "nor does a student");
  await db.exec(`set role anon`);
  await assert.rejects(q(`select public.admin_analytics('all')`), /permission denied/);
  await db.exec(`reset role`);
});

test("nothing a careers admin receives could name a student", async () => {
  const text = JSON.stringify(await analytics(north.admin, YEAR));
  for (const s of [...S, ...N]) {
    assert.ok(!text.includes(s.id), "no id");
    assert.ok(!text.includes(s.email), "no email");
  }
  assert.doesNotMatch(text, /Jordan Reed|volunteers/, "no CV text");
});

test("reading the figures changes no score and no report", async () => {
  const snapshot = async () => JSON.stringify(await q(`select id, score, payload, updated_at from public.reports order by id`));
  const before = await snapshot();
  await analytics(north.admin, YEAR);
  await analytics(north.admin, "all");
  assert.equal(await snapshot(), before);
  const [f] = await q<{ provolatile: string }>(`select provolatile from pg_proc where proname = 'admin_analytics'`);
  assert.equal(f.provolatile, "s", "the function is declared unable to write");
});

test("the SQL rules give the same answers as the TypeScript ones", async () => {
  const one = async <T>(sql: string, params: unknown[]) => (await q<{ r: T }>(`select ${sql} as r`, params))[0].r;
  for (const [n, want] of cases.count as [number, number | null][]) assert.equal(await one(`public.analytics_count($1::bigint)`, [n]), want, `count ${n}`);
  for (const [n, of, want] of cases.part as [number, number, number | null][]) assert.equal(await one(`public.analytics_part($1::bigint, $2::bigint)`, [n, of]), want, `part ${n}/${of}`);
  for (const [e, s, want] of cases.events as [number, number, number | null][]) assert.equal(await one(`public.analytics_events($1::bigint, $2::bigint)`, [e, s]), want, `events ${e}/${s}`);
  for (const [a, n, want] of cases.average as [number | null, number, number | null][]) assert.equal(await one(`public.analytics_average($1::numeric, $2::bigint)`, [a, n]), want, `average ${a}/${n}`);
  for (const c of cases.hidden) assert.deepEqual(await one(`public.analytics_hidden_groups($1::jsonb)`, [JSON.stringify(c.sizes)]), c.hidden, JSON.stringify(c.sizes));
});

test("what counts as the same CV is the same in SQL as on the student's dashboard", async () => {
  assert.equal(NORMALISER_VERSION, "normaliser-2026-11-06.1", "analytics_normalise_text copies this version: change both");
  const vectors = [
    "", "   ", "\n\n", "plain", "Jordan Reed\r\nLeeds\rUK", "a b c​d e f　g", "zero‌width‍‎‏﻿join",
    "‘q’‚q‛′", "“q”„q‟″", "a‐b‑c‒d–e—f―g−h",
    "• one\n● two\n▪ three\n‣ four\n◦ five\n∙ six\n· seven\n* eight\n– nine\n— ten\n› eleven\n» twelve",
    "▸ a\n► b\n▶ c\n➢ d\n➤ e\n→ f\n✓ g\n✔ h\n■ i\n□ j\n◆ k\n◇ l\n♦ m\n○ n\n❖ o\n p\n q\n r\n s\n t\n u\n- v",
    "•no space\n- \n  -   spaced", "   leading\ttabs\t\tand   spaces   ", "line\f with form\vfeed", "ﬁligature ① Ａwide ½", "é café",
    "x • after separator y", " ogham space ", "Led 5 teams — 40% £2,000 (2024–25)", "a\n\n\n\nb\n \n\t\nc", "'single' \"double\" `tick`", "emoji 🎓 and 中文 and العربية",
    `${CV(1)}\n`, REEXPORT(1),
  ];
  for (const v of vectors) {
    const [{ r }] = await q<{ r: string }>(`select public.analytics_normalise_text($1) as r`, [v]);
    assert.equal(r, normaliseText(v), JSON.stringify(v));
  }
  const [{ a, b, c }] = await q<{ a: string; b: string; c: string | null }>(`select public.analytics_doc_key($1) as a, public.analytics_doc_key($2) as b, public.analytics_doc_key('   ') as c`, [CV(3), REEXPORT(3)]);
  assert.equal(a, b, "a re-export is a duplicate");
  assert.equal(c, null, "blank text has no key");
});

test("the repository returns what the database publishes", async () => {
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      assert.equal(name, "admin_analytics");
      return { data: await analytics(north.admin, args.p_period as string), error: null };
    },
  } as unknown as SupabaseClient;
  const repo = supabaseRepo(client, north.admin, (() => {
    throw new Error("the service role isn't used for analytics");
  }) as unknown as () => SupabaseClient);
  assert.deepEqual(await repo.adminAnalytics(YEAR), await analytics(north.admin, YEAR));
});
