/* eslint-disable @typescript-eslint/no-unused-expressions -- assertions are written as cond ? ok() : fail() */
// Validates the Offerpath migration in PGlite with stubbed Supabase auth/storage schemas,
// then checks RLS, column grants and the admin RPCs. Run with: npm run test:db
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";

// Applies every migration in supabase/migrations (in name order), then supabase/seed.sql.
const root = new URL("../", import.meta.url);
const migrations = readdirSync(new URL("migrations/", root)).filter((f) => f.endsWith(".sql")).sort().map((f) => fileURLToPath(new URL(`migrations/${f}`, root)));
const seed = fileURLToPath(new URL("seed.sql", root));
const db = new PGlite();
const ok = (m) => console.log("PASS", m);
const fail = (m) => {
  console.log("FAIL", m);
  process.exitCode = 1;
};

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema storage; create schema extensions;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;
  -- Supabase grants table privileges by default; migrations then revoke what they don't want.
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

try {
  for (const m of migrations) {
    await db.exec(readFileSync(m, "utf8"));
    ok(`migration applies: ${m.split("/").pop()}`);
  }
  await db.exec(readFileSync(seed, "utf8"));
  ok("seed applies");
} catch (e) {
  fail(`migration/seed: ${e.message}`);
  process.exit(1);
}

/** A saved CV payload that says which scoring series it belongs to, and nothing else the database reads. */
const inSeries = (identity) => ({ analysis: { meta: { bullets: 8, scoring: { identity } } } });

// Users: 1 admin + 7 students at Northfield, 1 student elsewhere.
const ids = [];
for (let i = 0; i < 7; i++) {
  const r = await db.query(`insert into auth.users (email) values ($1) returning id`, [`student.${i}@northfield.ac.uk`]);
  ids.push(r.rows[0].id);
}
const admin = (await db.query(`insert into auth.users (email) values ('sam.price@northfield.ac.uk') returning id`)).rows[0].id;
let outsiderBlocked = false;
try {
  await db.query(`insert into auth.users (email) values ('kim@gmail.com') returning id`);
} catch {
  outsiderBlocked = true;
}
outsiderBlocked ? ok("sign-ups from non-partner domains are rejected by the database") : fail("non-partner email could sign up");
const sub = await db.query(`insert into auth.users (email) values ('ana@students.northfield.ac.uk') returning id`);
sub.rows.length === 1 ? ok("partner subdomains can sign up") : fail("partner subdomain blocked");
await db.query(`update public.profiles set share_progress = false where id = $1`, [sub.rows[0].id]); // keep admin counts below exact
await db.exec(`update public.profiles set role = 'admin' where id = '${admin}'`);

const prof = await db.query(`select full_name, university_id is not null as has_uni from public.profiles where id = $1`, [ids[0]]);
prof.rows[0].full_name === "Student 0" && prof.rows[0].has_uni ? ok("signup trigger creates profile with name and university") : fail(`trigger: ${JSON.stringify(prof.rows[0])}`);

for (let i = 0; i < 7; i++) await db.exec(`update public.profiles set share_progress = true where id = '${ids[i]}'`);
// An unconfirmed sign-up (link requested, never clicked) must not be counted.
const unconfirmed = (await db.query(`insert into auth.users (email, email_confirmed_at) values ('ghost@northfield.ac.uk', null) returning id`)).rows[0].id;
await db.query(`update public.profiles set share_progress = true where id = $1`, [unconfirmed]);
for (let i = 0; i < 7; i++) {
  await db.exec(`update public.profiles set faculty = 'Business', fee_status = '${i % 2 ? "international" : "home"}', course = 'Economics' where id = '${ids[i]}'`);
  await db.query(`insert into public.reports (user_id, type, title, score, payload) values ($1, 'cv_review', 'v1.pdf', $2, $4), ($1, 'cv_review', 'v2.pdf', $3, $4)`, [ids[i], 50 + i, 60 + i * 2, inSeries("rules|v1")]);
}
await db.query(`insert into public.applications (user_id, opportunity_id, role, org, status, closes_on) values ($1, 'opp-northbank-analyst', 'Analyst', 'Northbank', 'saved', current_date + 3)`, [ids[0]]);

const as = async (uid, sql, params = []) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec(`reset role;`);
  }
};

// RLS
const mine = await as(ids[0], `select count(*)::int as n from public.reports`);
mine.rows[0].n === 2 ? ok("student sees only own reports") : fail(`student sees ${mine.rows[0].n} reports`);
const others = await as(ids[0], `select count(*)::int as n from public.profiles`);
others.rows[0].n === 1 ? ok("student sees only own profile") : fail(`student sees ${others.rows[0].n} profiles`);
try {
  await as(ids[0], `insert into public.reports (user_id, type, title) values ($1, 'cv_review', 'x')`, [ids[1]]);
  fail("student inserted a report for someone else");
} catch {
  ok("student can't insert reports for others");
}
try {
  await as(ids[0], `update public.profiles set role = 'admin' where id = $1`, [ids[0]]);
  fail("student escalated to admin");
} catch {
  ok("student can't change own role");
}
try {
  await as(ids[0], `update public.profiles set faculty = 'Medicine', fee_status = 'home' where id = $1`, [ids[0]]);
  fail("student changed institution-owned fields");
} catch {
  ok("students can't change faculty, course or fee status");
}
try {
  await db.query(`update public.profiles set faculty = $2 where id = $1`, [ids[0], "Science\r=cmd|' /C calc'!A0"]);
  fail("control characters accepted in faculty");
} catch {
  ok("control characters are rejected in institution fields");
}
try {
  await as(ids[0], `insert into public.applications (user_id, role, org, status) values ($1, 'Fake', 'Fake', 'offer')`, [ids[0]]);
  fail("student inserted a fake application");
} catch {
  ok("students can't insert applications directly");
}
const moved = await as(ids[0], `update public.applications set status = 'applied' where user_id = $1 returning status`, [ids[0]]);
moved.rows[0]?.status === "applied" ? ok("students can move their application status") : fail("status update failed");
try {
  await as(ids[0], `update public.applications set closes_on = current_date + 1 where user_id = $1`, [ids[0]]);
  fail("student changed an application's deadline");
} catch {
  ok("students can only change application status");
}
const upd = await as(ids[0], `update public.profiles set stage = 'final', sectors = '{Consulting}' where id = $1 returning stage`, [ids[0]]);
upd.rows[0]?.stage === "final" ? ok("student can update allowed profile fields") : fail("allowed profile update failed");
const opps = await as(ids[0], `select count(*)::int as n from public.opportunities`);
opps.rows[0].n > 0 ? ok(`opportunities readable (${opps.rows[0].n})`) : fail("opportunities not readable");

try {
  await as(ids[0], `insert into public.reports (user_id, type, title, score) values ($1, 'cv_review', 'mine.pdf', 100)`, [ids[0]]);
  fail("student inserted their own report directly");
} catch {
  ok("students can't insert reports directly (server only)");
}
try {
  await as(ids[0], `update public.reports set score = 100 where user_id = $1`, [ids[0]]);
  fail("student changed their own score");
} catch {
  ok("students can't change their own score");
}
const asService = async (sql, params = []) => {
  await db.exec(`set role service_role;`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec(`reset role;`);
  }
};
const srv = await asService(`update public.reports set score = 61 where user_id = $1 returning score`, [ids[0]]);
srv.rows.length === 2 ? ok("server (service role) can write scores") : fail("service role couldn't write scores");

// Judgment cache
const key = "a".repeat(64);
const core = { result: "measured", verb: "strong", kind: "achievement" };
await asService(`insert into public.judgment_cache (key, judgment, judge) values ($1, $2, 'claude-haiku-5-5')`, ["c".repeat(64), { relevance: "some" }]);
ok("server can store a sector relevance judgment");
try {
  await asService(`insert into public.judgment_cache (key, judgment, judge) values ($1, $2, 'x')`, ["d".repeat(64), { ...core, relevance: "high" }]);
  fail("mixed core and relevance judgment accepted");
} catch {
  ok("a cache entry holds either the core verdict or one sector's relevance, not both");
}
await asService(`insert into public.judgment_cache (key, judgment, judge) values ($1, $2, 'claude-haiku-5-5')`, [key, core]);
ok("server can store a judgment");
await asService(`insert into public.judgment_cache (key, judgment, judge) values ($1, $2, 'claude-haiku-5-5') on conflict (key) do nothing`, [key, { ...core, result: "none" }]);
const kept = (await asService(`select judgment from public.judgment_cache where key = $1`, [key])).rows[0].judgment;
kept.result === "measured" ? ok("first judgment for a key wins (insert-if-absent)") : fail("judgment was overwritten");
try {
  await asService(`update public.judgment_cache set judgment = $2 where key = $1`, [key, { ...core, result: "none" }]);
  fail("judgment was updated");
} catch {
  ok("judgments are immutable");
}
try {
  await asService(`insert into public.judgment_cache (key, judgment, judge) values ($1, $2, 'x')`, ["b".repeat(64), { ...core, result: "excellent" }]);
  fail("invalid judgment accepted");
} catch {
  ok("invalid judgment values are rejected");
}
try {
  await as(ids[0], `select * from public.judgment_cache`);
  fail("student read the judgment cache");
} catch {
  ok("students can't read the judgment cache");
}

const cvScore = await as(ids[1], `select public.bump_ai_usage('cv_score') as n`);
cvScore.rows[0].n === 1 ? ok("cv_score usage is counted") : fail("cv_score usage");
const tailorUse = await as(ids[1], `select public.bump_ai_usage('tailor') as n`);
tailorUse.rows[0].n === 1 ? ok("tailor usage is counted") : fail("tailor usage");
try {
  await as(ids[1], `select public.bump_ai_usage('anything') as n`);
  fail("unknown AI usage kind accepted");
} catch {
  ok("unknown AI usage kinds are rejected");
}

// Rate limits
const hits = [];
for (let i = 0; i < 4; i++) hits.push((await asService(`select public.rate_limit_hit('signin:test@northfield.ac.uk', 900, 3) as ok`)).rows[0].ok);
JSON.stringify(hits) === "[true,true,true,false]" ? ok("rate limit allows 3 then blocks the 4th") : fail(`rate limit: ${JSON.stringify(hits)}`);
try {
  await as(ids[0], `select public.rate_limit_hit('x', 60, 100)`);
  fail("student could call the rate limiter directly");
} catch {
  ok("students can't call or reset the rate limiter");
}

// AI usage
await as(ids[0], `select public.bump_ai_usage('line_rewrite')`);
const used = await as(ids[0], `select public.bump_ai_usage('line_rewrite') as n`);
used.rows[0].n === 2 ? ok("bump_ai_usage counts per day") : fail(`ai usage ${used.rows[0].n}`);

// Admin RPCs
try {
  await as(ids[0], `select public.admin_analytics()`);
  fail("student called admin_analytics");
} catch {
  ok("students can't call admin_analytics");
}
// OP-022: exact figures are only reachable as the owner; these reports are dated today, and the published figures stop at yesterday.
const analyticsUni = (await db.query(`select university_id from public.profiles where id = $1`, [admin])).rows[0].university_id;
const exactRows = async () => (await db.query(`select * from public.analytics_student_rows($1, null, now() + interval '1 day')`, [analyticsUni])).rows;
const exact0 = await exactRows();
exact0.length === 7 && exact0.every((r) => r.fee_status && r.faculty === "Business") ? ok("analytics: exact rows hold the seven sharing, confirmed students, and no one unconfirmed") : fail(`analytics rows: ${JSON.stringify(exact0)}`);
const ov = (await as(admin, `select public.admin_analytics() as o`)).rows[0].o;
ov.sample === false && ov.rules === "analytics-publication-1" && ov.metrics.completed === null ? ok("analytics: what an admin gets is the published form, and today isn't in it") : fail(`admin_analytics: ${JSON.stringify(ov)}`);
const stRes = (await as(admin, `select public.admin_students() as s`)).rows[0].s;
const st = stRes.rows;
st.length === 7 && stRes.total === 7 && stRes.counts.all === 7 ? ok(`admin_students returns ${st.length} rows, e.g. ${JSON.stringify(st[0])}`) : fail(`admin_students: ${JSON.stringify(stRes)}`);
const page2 = (await as(admin, `select public.admin_students('all', '', '', 3, 3) as s`)).rows[0].s;
page2.rows.length === 3 && page2.total === 7 ? ok("student list pages on the server (3 per page, page 2)") : fail(`paging: ${JSON.stringify(page2)}`);
const intl = (await as(admin, `select public.admin_students('international') as s`)).rows[0].s;
intl.rows.every((r) => r.status === "International") && intl.total === intl.counts.international ? ok("student list filters on the server") : fail(`filter: ${JSON.stringify(intl)}`);
const future = (await as(admin, `select public.admin_analytics('year-2100') as o`)).rows[0].o;
future.metrics.versions === null ? ok("dashboard period limits activity to the chosen term") : fail(`period: ${JSON.stringify(future.metrics)}`);

// Consent: a student who stops sharing disappears from admin views.
await as(ids[6], `update public.profiles set share_progress = false where id = $1`, [ids[6]]);
const st2 = (await as(admin, `select public.admin_students() as s`)).rows[0].s.rows;
st2.length === 6 ? ok("non-consenting students are excluded") : fail(`consent: ${st2.length}`);
// k-anonymity: with only 4 sharing, averages are hidden.
for (const i of [4, 5]) await as(ids[i], `update public.profiles set share_progress = false where id = $1`, [ids[i]]);
const ov2 = (await as(admin, `select public.admin_analytics() as o`)).rows[0].o;
ov2.scores.average === null && ov2.scores.students === null && ov2.breakdowns.every((r) => r.hidden || r.students === null) ? ok("groups under five are hidden") : fail(`k-anon: ${JSON.stringify(ov2)}`);

// ---------- OP-022: analytics publication rules ----------
const opFn = async (name) => (await db.query(`select p.oid, p.proname, p.prosecdef, p.provolatile, pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [name])).rows;
(await opFn("admin_overview")).length === 0 && (await opFn("admin_outcomes_pack")).length === 0 ? ok("op022: the two reports that took any date range are gone") : fail("op022: admin_overview or admin_outcomes_pack remains");
const aa = await opFn("admin_analytics");
aa.length === 1 && aa[0].args === "p_period text" && aa[0].prosecdef && aa[0].provolatile === "s" ? ok("op022: one function, one argument, a named period, and it can't write") : fail(`op022: ${JSON.stringify(aa)}`);
const opInternal = (await db.query(`select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as a, has_function_privilege('anon', p.oid, 'execute') as b from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'analytics\\_%'`)).rows;
opInternal.length === 15 && opInternal.every((f) => !f.a && !f.b) ? ok("op022: no signed-in or signed-out user can call any of the 15 internal functions") : fail(`op022: ${JSON.stringify(opInternal)}`);
for (const bad of ["2026-01-01", "week-3", "", "year-20"]) {
  try {
    await as(admin, `select public.admin_analytics($1)`, [bad]);
    fail(`op022: period '${bad}' accepted`);
  } catch (e) {
    /unknown reporting period/.test(e.message) ? ok(`op022: period '${bad}' refused`) : fail(`op022: ${e.message}`);
  }
}
const opRound = (await db.query(`select public.analytics_count(4) as a, public.analytics_count(5) as b, public.analytics_count(23) as c, public.analytics_part(36, 40) as d, public.analytics_part(35, 40) as e, public.analytics_average(66.4, 24) as f, public.analytics_average(66.4, 25) as g`)).rows[0];
opRound.a === null && opRound.b === 5 && opRound.c === 25 && opRound.d === null && opRound.e === 35 && opRound.f === null && opRound.g === 66 ? ok("op022: rounding and hiding") : fail(`op022: ${JSON.stringify(opRound)}`);
const opHidden = (await db.query(`select public.analytics_hidden_groups('{"A":30,"B":20,"C":1}') as h`)).rows[0].h;
JSON.stringify(opHidden) === '["C","B"]' ? ok("op022: hiding one small group hides the next smallest too") : fail(`op022: ${JSON.stringify(opHidden)}`);

// ---------- Institution data, admin team, opportunities ----------
await db.exec(`insert into public.universities (name, domain) values ('Southvale University', 'southvale.ac.uk')`);
const southAdmin = (await db.query(`insert into auth.users (email) values ('jo.admin@southvale.ac.uk') returning id`)).rows[0].id;
await db.query(`update public.profiles set role = 'admin' where id = $1`, [southAdmin]);

// T05 import: existing student updated, future student pre-registered, wrong domain skipped, junk cleaned.
const rows = [
  { email: "Student.2@Northfield.ac.uk", student_number: "2100002", course: "Law", year_of_study: "Year 2", faculty: "Social sciences", fee_status: "Overseas" },
  { email: "future.student@northfield.ac.uk", student_number: "2100099", course: "History\r=cmd", year_of_study: "Year 1", faculty: "Arts and humanities", fee_status: "home" },
  { email: "someone@southvale.ac.uk", course: "X" },
  { email: "not-an-email" },
];
const imp = (await as(admin, `select public.admin_import_students($1::jsonb) as r`, [JSON.stringify(rows)])).rows[0].r;
imp.saved === 2 && imp.appliedToAccounts === 1 && imp.skipped.length === 2 ? ok(`import: ${JSON.stringify(imp)}`) : fail(`import: ${JSON.stringify(imp)}`);
const s2 = (await db.query(`select course, fee_status, student_number from public.profiles where id = $1`, [ids[2]])).rows[0];
s2.course === "Law" && s2.fee_status === "international" && s2.student_number === "2100002" ? ok("import updates existing student and normalises fee status") : fail(`import apply: ${JSON.stringify(s2)}`);
const fut = (await db.query(`insert into auth.users (email) values ('future.student@northfield.ac.uk') returning id`)).rows[0].id;
const fp = (await db.query(`select course, faculty, student_number from public.profiles where id = $1`, [fut])).rows[0];
fp.student_number === "2100099" && !/[\r\n]/.test(fp.course) ? ok("imported record is applied at sign-up, control characters removed") : fail(`signup apply: ${JSON.stringify(fp)}`);
try {
  await as(ids[0], `select public.admin_import_students('[]'::jsonb)`);
  fail("student ran an import");
} catch {
  ok("students can't import records");
}
const crossImp = (await as(southAdmin, `select public.admin_import_students($1::jsonb) as r`, [JSON.stringify([{ email: "student.0@northfield.ac.uk", course: "Hacked" }])])).rows[0].r;
const s0course = (await db.query(`select course from public.profiles where id = $1`, [ids[0]])).rows[0].course;
crossImp.saved === 0 && s0course !== "Hacked" ? ok("another university's admin can't import into Northfield") : fail(`cross import: ${JSON.stringify(crossImp)} ${s0course}`);

// T25 SSO attributes on sign-up (no imported record), sanitised.
const sso = (await db.query(`insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ('sso.user@northfield.ac.uk', $1, '{"provider":"sso:test"}') returning id`, [{ full_name: "Sam SSO", faculty: "Engineering\u0007", course: "Mechanical Engineering", fee_status: "International", student_number: "2209999" }])).rows[0].id;
const sp = (await db.query(`select full_name, faculty, fee_status, student_number from public.profiles where id = $1`, [sso])).rows[0];
sp.full_name === "Sam SSO" && sp.faculty === "Engineering" && sp.fee_status === "international" ? ok("SSO attributes fill the profile at sign-up") : fail(`sso: ${JSON.stringify(sp)}`);

// T06 admin team.
const inv = (await as(admin, `select public.admin_set_role('new.adviser@northfield.ac.uk', true) as r`)).rows[0].r;
inv === "invited" ? ok("inviting someone not yet signed up creates a pending admin") : fail(`invite: ${inv}`);
const adv = (await db.query(`insert into auth.users (email) values ('new.adviser@northfield.ac.uk') returning id`)).rows[0].id;
(await db.query(`select role from public.profiles where id = $1`, [adv])).rows[0].role === "admin" ? ok("invited adviser becomes admin on sign-up") : fail("invited adviser not admin");
const team = (await as(admin, `select public.admin_list_team() as t`)).rows[0].t;
team.admins.length === 2 && team.pending.length === 0 ? ok("team list shows both admins") : fail(`team: ${JSON.stringify(team)}`);
(await as(admin, `select public.admin_set_role('new.adviser@northfield.ac.uk', false) as r`)).rows[0].r === "removed" ? ok("admin can remove another admin") : fail("remove admin");
try {
  await as(admin, `select public.admin_set_role('sam.price@northfield.ac.uk', false)`);
  fail("removed the last admin");
} catch {
  ok("the last careers admin can't be removed");
}
try {
  await as(admin, `select public.admin_set_role('jo.admin@southvale.ac.uk', false)`);
  fail("changed another university's admin");
} catch {
  ok("admins can't change roles at another university");
}
try {
  await as(ids[0], `select public.admin_set_role('student.0@northfield.ac.uk', true)`);
  fail("student made themselves admin");
} catch {
  ok("students can't grant admin");
}

// T07 opportunities.
const northUni = (await db.query(`select id from public.universities where domain = 'northfield.ac.uk'`)).rows[0].id;
const southUni = (await db.query(`select id from public.universities where domain = 'southvale.ac.uk'`)).rows[0].id;
await as(admin, `insert into public.opportunities (id, role, org, location, type, sector, closes_on, university_id) values ('opp-north-1', 'Careers Fair Internship', 'Local Ltd', 'Leeds', 'Internship', 'Consulting', current_date + 20, $1)`, [northUni]);
ok("admin can add an opportunity for their university");
for (const [label, sql, params] of [
  ["for another university", `insert into public.opportunities (id, role, org, location, type, sector, closes_on, university_id) values ('opp-x', 'R', 'O', 'L', 'Internship', 'Law', current_date, $1)`, [southUni]],
  ["as a shared (global) listing", `insert into public.opportunities (id, role, org, location, type, sector, closes_on) values ('opp-y', 'R', 'O', 'L', 'Internship', 'Law', current_date)`, []],
]) {
  try {
    await as(admin, sql, params);
    fail(`admin added an opportunity ${label}`);
  } catch {
    ok(`admins can't add opportunities ${label}`);
  }
}
const editedGlobal = await as(admin, `update public.opportunities set role = 'Hacked' where id = 'opp-northbank-analyst' returning id`);
editedGlobal.rows.length === 0 ? ok("admins can't edit shared opportunities") : fail("admin edited a shared opportunity");
try {
  await as(ids[0], `insert into public.opportunities (id, role, org, location, type, sector, closes_on, university_id) values ('opp-z', 'R', 'O', 'L', 'Internship', 'Law', current_date, $1)`, [northUni]);
  fail("student added an opportunity");
} catch {
  ok("students can't add opportunities");
}
const northSees = (await as(ids[0], `select count(*)::int as n from public.opportunities where id = 'opp-north-1'`)).rows[0].n;
const southStudent = (await db.query(`insert into auth.users (email) values ('kai@southvale.ac.uk') returning id`)).rows[0].id;
const southSees = (await as(southStudent, `select count(*)::int as n from public.opportunities where id = 'opp-north-1'`)).rows[0].n;
const southShared = (await as(southStudent, `select count(*)::int as n from public.opportunities where university_id is null`)).rows[0].n;
northSees === 1 && southSees === 0 && southShared > 0 ? ok("students see shared listings plus only their own university's") : fail(`visibility: north ${northSees} south ${southSees} shared ${southShared}`);

// ---------- Reminders and retention (T04) ----------
const remUser = (await db.query(`insert into auth.users (email) values ('reminder.me@northfield.ac.uk') returning id`)).rows[0].id;
await db.query(`update public.profiles set deadline_reminders = true where id = $1`, [remUser]);
await asService(`insert into public.applications (user_id, opportunity_id, role, org, status, closes_on) values ($1, 'opp-calder-risk', 'Risk Intern', 'Calder', 'saved', current_date + 5), ($1, 'opp-ashby-consulting', 'Consultant', 'Ashby', 'applied', current_date + 3), ($1, 'opp-mercer-accountant', 'Accountant', 'Mercer', 'saved', current_date + 20)`, [remUser]);
const due = (await asService(`select * from public.due_deadline_reminders() where user_id = $1`, [remUser])).rows;
due.length === 1 && due[0].role === "Risk Intern" ? ok("reminders: only saved roles closing within 7 days") : fail(`due: ${JSON.stringify(due)}`);
(await asService(`select public.mark_reminders_sent($1::uuid[]) as n`, [[due[0].application_id]])).rows[0].n === 1 ? ok("reminder marked as sent") : fail("mark sent");
(await asService(`select count(*)::int as n from public.due_deadline_reminders() where user_id = $1`, [remUser])).rows[0].n === 0 ? ok("each reminder is sent only once") : fail("reminder repeated");
await db.query(`update public.profiles set deadline_reminders = false where id = $1`, [remUser]);
try {
  await as(ids[0], `select * from public.due_deadline_reminders()`);
  fail("student listed other students' reminders");
} catch {
  ok("students can't call the reminder job functions");
}
const idle = (await db.query(`insert into auth.users (email) values ('idle.student@northfield.ac.uk') returning id`)).rows[0].id;
await db.query(`update public.profiles set last_active_at = now() - interval '24 months 1 day' where id = $1`, [idle]);
let cand = (await asService(`select * from public.retention_candidates(24) where user_id = $1`, [idle])).rows;
cand[0]?.action === "warn" ? ok("inactive account is warned before deletion") : fail(`retention warn: ${JSON.stringify(cand)}`);
await db.query(`update public.profiles set retention_warned_at = now() - interval '31 days' where id = $1`, [idle]);
cand = (await asService(`select * from public.retention_candidates(24) where user_id = $1`, [idle])).rows;
cand[0]?.action === "delete" ? ok("deleted only after the 30-day warning period") : fail(`retention delete: ${JSON.stringify(cand)}`);
(await asService(`select count(*)::int as n from public.retention_candidates(24) where user_id = $1`, [admin])).rows[0].n === 0 ? ok("admins are never auto-deleted") : fail("admin in retention list");

// ---------- Adviser features (T20) ----------
const s1 = ids[1];
const rep1 = (await db.query(`select id from public.reports where user_id = $1 limit 1`, [s1])).rows[0].id;
await db.query(`update public.reports set storage_path = $2 where id = $1`, [rep1, `${s1}/x/cv.pdf`]);
const det = (await as(admin, `select public.admin_student_detail($1) as d`, [s1])).rows[0].d;
det && det.reports.length === 2 && det.cvSharing === false && det.reports.every((r) => r.hasFile === false) ? ok("adviser sees a sharing student's scores but no CV without consent") : fail(`detail: ${JSON.stringify(det)?.slice(0, 200)}`);
(await as(admin, `select public.admin_cv_path($1) as p`, [rep1])).rows[0].p === null ? ok("no CV path without the student's consent") : fail("cv path leaked without consent");
await as(s1, `update public.profiles set adviser_can_view_cv = true where id = $1`, [s1]);
(await as(admin, `select public.admin_cv_path($1) as p`, [rep1])).rows[0].p === `${s1}/x/cv.pdf` ? ok("after the student opts in, the adviser can get the CV") : fail("cv path after consent");
(await as(southAdmin, `select public.admin_cv_path($1) as p`, [rep1])).rows[0].p === null ? ok("another university's adviser still can't") : fail("cross-university cv access");
(await as(southAdmin, `select public.admin_student_detail($1) as d`, [s1])).rows[0].d === null ? ok("another university's adviser can't see the student") : fail("cross-university detail");
await as(admin, `select public.admin_add_note($1, 'Great progress on impact. Add numbers to your society role.')`, [rep1]);
const myNotes = (await as(s1, `select note, author_name from public.adviser_notes`)).rows;
myNotes.length === 1 && myNotes[0].author_name === "Sam Price" ? ok("student sees the adviser's note") : fail(`notes: ${JSON.stringify(myNotes)}`);
(await as(ids[0], `select count(*)::int as n from public.adviser_notes`)).rows[0].n === 0 ? ok("other students can't see it") : fail("note leaked to another student");
try {
  await as(ids[0], `insert into public.adviser_notes (report_id, student_id, author_name, university_id, note) values ($1, $2, 'me', $3, 'fake')`, [rep1, s1, northUni]);
  fail("student wrote an adviser note");
} catch {
  ok("students can't write adviser notes");
}
const keyed = (await as(admin, `select public.admin_students() as s`)).rows[0].s.rows;
keyed.every((r) => /^[0-9a-f-]{36}$/.test(r.key)) ? ok("student list rows carry a key for the detail page") : fail("missing keys");

// ---------- CV source versions (OP-006) ----------
const sha = (t) => "0".repeat(63) + t; // a 64-hex stand-in for sha256(text)
const owner = ids[1];
const other = ids[2];
const up = (await asService(`insert into public.cv_sources (user_id, kind, file_name, text, document_version, idempotency_key, storage_path) values ($1, 'upload', 'cv.pdf', 'Alex Example', $2, 'attempt-0001-aaaa', $3) returning id`, [owner, sha("1"), `${owner}/x/cv.pdf`])).rows[0].id;
ok("server can save an uploaded version");
try {
  await asService(`insert into public.cv_sources (user_id, kind, file_name, text, document_version, idempotency_key) values ($1, 'upload', 'again.pdf', 'Alex Example', $2, 'attempt-0001-aaaa')`, [owner, sha("2")]);
  fail("the same idempotency key saved a second version");
} catch (e) {
  /duplicate key/.test(e.message) ? ok("the same attempt key from the same user is a unique violation, not a second version") : fail(`idempotency: ${e.message}`);
}
await asService(`insert into public.cv_sources (user_id, kind, file_name, text, document_version, idempotency_key) values ($1, 'upload', 'cv.pdf', 'Alex Example', $2, 'attempt-0001-aaaa')`, [other, sha("1")]);
ok("another user may use the same key: keys are scoped per user");
const corr = (await asService(`insert into public.cv_sources (user_id, parent_id, kind, file_name, text, document_version) values ($1, $2, 'correction', 'cv.pdf (corrected)', 'Alex Example fixed', $3) returning id`, [owner, up, sha("3")])).rows[0].id;
ok("server can save a correction that descends from the user's upload");
try {
  await asService(`insert into public.cv_sources (user_id, parent_id, kind, file_name, text, document_version) values ($1, $2, 'correction', 'x', 'Alex Example fixed again', $3)`, [owner, up, sha("3")]);
  fail("the same corrected text from the same parent saved twice");
} catch (e) {
  /duplicate key/.test(e.message) ? ok("the same corrected text from the same parent is one version") : fail(`content dedup: ${e.message}`);
}
try {
  await asService(`insert into public.cv_sources (user_id, parent_id, kind, file_name, text, document_version) values ($1, $2, 'correction', 'x', 'stolen', $3)`, [other, up, sha("4")]);
  fail("a correction descended from another user's version");
} catch (e) {
  /own user/.test(e.message) ? ok("the database refuses a correction whose parent belongs to someone else, even from the server") : fail(`parent owner: ${e.message}`);
}
try {
  await asService(`insert into public.cv_sources (user_id, kind, file_name, text, document_version) values ($1, 'correction', 'x', 'orphan', $2)`, [owner, sha("5")]);
  fail("a correction without a parent was accepted");
} catch {
  ok("a correction must name the version it was made from");
}
try {
  await asService(`update public.cv_sources set text = 'rewritten' where id = $1`, [up]);
  fail("a version was rewritten");
} catch (e) {
  /immutable/.test(e.message) ? ok("versions are immutable: the original upload can't be overwritten, even by the server") : fail(`immutable: ${e.message}`);
}
const rep = (await asService(`insert into public.reports (user_id, type, title, score, source_id) values ($1, 'cv_review', 'cv.pdf (corrected)', 70, $2) returning id`, [owner, corr])).rows[0].id;
ok("server can save a report that scores a version");
try {
  await asService(`insert into public.reports (user_id, type, title, score, source_id) values ($1, 'cv_review', 'again', 71, $2)`, [owner, corr]);
  fail("a version was scored twice");
} catch (e) {
  /duplicate key/.test(e.message) ? ok("a version is scored at most once: a second report for it is a unique violation") : fail(`one report per version: ${e.message}`);
}
try {
  await asService(`insert into public.reports (user_id, type, title, score, source_id) values ($1, 'cv_review', 'theirs', 99, $2)`, [other, up]);
  fail("a report scored another user's version");
} catch (e) {
  /own user/.test(e.message) ? ok("the database refuses a report that scores someone else's version, even from the server") : fail(`report owner: ${e.message}`);
}
(await as(owner, `select count(*)::int as n from public.cv_sources`)).rows[0].n === 2 ? ok("student sees only their own versions") : fail("version visibility");
(await as(other, `select count(*)::int as n from public.cv_sources where id in ($1, $2)`, [up, corr])).rows[0].n === 0 ? ok("another student can't read them by id") : fail("version leaked");
(await as(owner, `select source_id from public.reports where id = $1`, [rep])).rows[0].source_id === corr ? ok("the student can see which version their report scored") : fail("report source link");
// The original file behind a version lives at its storage_path under the owner's folder; the bucket policy decides who reads it.
await db.query(`insert into storage.objects (bucket_id, name) values ('cvs', $1)`, [`${owner}/x/cv.pdf`]);
const fileRows = async (who) => (await as(who, `select count(*)::int as n from storage.objects where bucket_id = 'cvs' and name = $1`, [`${owner}/x/cv.pdf`])).rows[0].n;
(await fileRows(owner)) === 1 ? ok("the owner can read the original file behind their upload version") : fail("owner can't read their original file");
(await fileRows(other)) === 0 ? ok("another student can't read that file, whatever path they ask for") : fail("original file leaked to another student");
for (const [what, sql] of [
  ["insert", `insert into public.cv_sources (user_id, kind, file_name, text, document_version) values ($1, 'upload', 'x', 'y', '${sha("9")}')`],
  ["update", `update public.cv_sources set text = 'x' where id = '${up}'`],
  ["delete", `delete from public.cv_sources where id = '${up}'`],
]) {
  try {
    await as(owner, sql, what === "insert" ? [owner] : []);
    fail(`student could ${what} a version directly`);
  } catch {
    ok(`students can't ${what} versions directly (server only)`);
  }
}
const repSrc = (await db.query(`select count(*)::int as n from pg_policies where tablename = 'cv_sources' and cmd <> 'SELECT'`)).rows[0].n;
repSrc === 0 ? ok("cv_sources has no write policy for signed-in users") : fail(`cv_sources write policies: ${repSrc}`);

// ---------- proofreading choices (OP-008) ----------
const choiceDoc = "a".repeat(64);
const choicePayload = { proofreading: { documentVersion: choiceDoc } };
const choiceReport = (await asService(`insert into public.reports (user_id, type, title, payload) values ($1, 'cv_review', 'CV', $2) returning id`, [owner, choicePayload])).rows[0].id;
const otherReport = (await asService(`insert into public.reports (user_id, type, title, payload) values ($1, 'cv_review', 'CV', $2) returning id`, [other, choicePayload])).rows[0].id;
const addChoice = (who, report, doc = choiceDoc) => asService(`insert into public.proofreading_choices (user_id, report_id, document_version, kind, finding_id, quote) values ($1, $2, $3, 'dismiss', 'spelling:unrecognised-word:alfentanil', 'alfentanil') returning id`, [who, report, doc]);
const choiceId = (await addChoice(owner, choiceReport)).rows[0].id;
ok("the server can record a student's dismissal");
await asService(`insert into public.proofreading_choices (user_id, report_id, document_version, kind, language) values ($1, $2, $3, 'language', 'en-US')`, [owner, choiceReport, choiceDoc]);
ok("the server can record a language choice");
for (const [what, run] of [
  ["on another student's report", () => addChoice(owner, otherReport)],
  ["for a document the report isn't about", () => addChoice(owner, choiceReport, "b".repeat(64))],
  ["with a language no check supports", () => asService(`insert into public.proofreading_choices (user_id, report_id, document_version, kind, language) values ($1, $2, $3, 'language', 'fr')`, [owner, choiceReport, choiceDoc])],
  ["that dismisses nothing", () => asService(`insert into public.proofreading_choices (user_id, report_id, document_version, kind) values ($1, $2, $3, 'dismiss')`, [owner, choiceReport, choiceDoc])],
  ["made by anyone but a student", () => asService(`insert into public.proofreading_choices (user_id, report_id, document_version, kind, language, actor) values ($1, $2, $3, 'language', 'en-GB', 'adviser')`, [owner, choiceReport, choiceDoc])],
]) {
  try {
    await run();
    fail(`a choice ${what} was accepted`);
  } catch {
    ok(`the database refuses a choice ${what}`);
  }
}
try {
  await asService(`update public.proofreading_choices set finding_id = 'x' where id = $1`, [choiceId]);
  fail("the server could rewrite a choice");
} catch {
  ok("choices are append-only, even for the service role");
}
(await as(owner, `select count(*)::int as n from public.proofreading_choices`)).rows[0].n === 2 ? ok("a student reads their own choices") : fail("owner can't read their choices");
(await as(other, `select count(*)::int as n from public.proofreading_choices where id = $1`, [choiceId])).rows[0].n === 0 ? ok("another student can't read a choice by id") : fail("choice leaked to another student");
(await as(admin, `select count(*)::int as n from public.proofreading_choices`)).rows[0].n === 0 ? ok("an adviser has no route to a student's choices") : fail("choice leaked to an adviser");
for (const [what, who, sql] of [
  ["insert", owner, `insert into public.proofreading_choices (user_id, report_id, document_version, kind, language) values ('${owner}', '${choiceReport}', '${choiceDoc}', 'language', 'en-GB')`],
  ["forge for someone else", other, `insert into public.proofreading_choices (user_id, report_id, document_version, kind, language) values ('${owner}', '${choiceReport}', '${choiceDoc}', 'language', 'en-GB')`],
  ["update", owner, `update public.proofreading_choices set language = 'en-GB' where id = '${choiceId}'`],
  ["delete", owner, `delete from public.proofreading_choices where id = '${choiceId}'`],
]) {
  try {
    await as(who, sql);
    fail(`student could ${what} a choice directly`);
  } catch {
    ok(`students can't ${what} choices directly (server only)`);
  }
}
(await db.query(`select count(*)::int as n from pg_policies where tablename = 'proofreading_choices' and cmd <> 'SELECT'`)).rows[0].n === 0 ? ok("proofreading_choices has no write policy for signed-in users") : fail("proofreading_choices write policy");
(await db.query(`select relrowsecurity as on from pg_class where oid = 'public.proofreading_choices'::regclass`)).rows[0].on ? ok("proofreading_choices has row-level security on") : fail("no RLS on proofreading_choices");
const scoreBefore = (await db.query(`select score, payload from public.reports where id = $1`, [choiceReport])).rows[0];
JSON.stringify(scoreBefore.payload) === JSON.stringify(choicePayload) ? ok("recording a choice leaves the report untouched") : fail("a choice changed the report");
await asService(`delete from public.reports where id = $1`, [otherReport]);

// Pilot requests: server-only.
await asService(`insert into public.pilot_requests (name, university, role, email) values ('Ana', 'Uni', 'Head of Careers', 'ana@uni.ac.uk')`);
ok("server can save a pilot request");
for (const [who, run] of [["students", (q) => as(ids[1], q)], ["anonymous visitors", async (q) => { await db.exec("set role anon"); try { return await db.query(q); } finally { await db.exec("reset role"); } }]]) {
  try {
    await run(`select count(*) from public.pilot_requests`);
    fail(`${who} can read pilot requests`);
  } catch {
    ok(`${who} can't read pilot requests`);
  }
}

// Storage policy
await db.exec(`insert into storage.buckets values ('x','x',false,1,null) on conflict do nothing`);
for (const owner of [ids[1], ids[0]]) {
  try {
    await as(ids[0], `insert into storage.objects (bucket_id, name) values ('cvs', $1)`, [`${owner}/a/cv.pdf`]);
    fail("student uploaded a file directly");
  } catch {
    ok(`storage: students can't upload directly (${owner === ids[0] ? "own" : "another"} folder)`);
  }
}

// Delete account cascades.
await as(ids[3], `select public.delete_my_account()`);
const gone = await db.query(`select (select count(*)::int from public.profiles where id = $1) as p, (select count(*)::int from public.reports where user_id = $1) as r`, [ids[3]]);
gone.rows[0].p === 0 && gone.rows[0].r === 0 ? ok("delete_my_account removes profile and reports") : fail(`delete: ${JSON.stringify(gone.rows[0])}`);
await as(owner, `select public.delete_my_account()`);
(await db.query(`select count(*)::int as n from public.cv_sources where user_id = $1`, [owner])).rows[0].n === 0 ? ok("delete_my_account removes every CV version too") : fail("versions survived account deletion");
(await db.query(`select count(*)::int as n from public.proofreading_choices where user_id = $1`, [owner])).rows[0].n === 0 ? ok("delete_my_account removes proofreading choices and language preference too") : fail("choices survived account deletion");
await as(ids[0], `select public.delete_my_account()`);
const cacheCols = (await db.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'judgment_cache'`)).rows.map((r) => r.column_name).sort();
JSON.stringify(cacheCols) === JSON.stringify(["created_at", "judge", "judgment", "key"]) ? ok("the shared judgment cache holds no student or CV text") : fail(`judgment_cache columns: ${cacheCols}`);

/* ---------- scoring series (OP-010) ---------- */

// The SQL rule gives the answers the TypeScript rule is tested against (tests/scoring-contract.test.ts).
const { cases: seriesCases } = JSON.parse(readFileSync(fileURLToPath(new URL("../../tests/fixtures/score-series-cases.json", import.meta.url)), "utf8"));
const seriesWrong = [];
for (const c of seriesCases) {
  const got = (await db.query(`select public.report_score_series($1::jsonb) as s`, [c.payload])).rows[0].s;
  if (got !== c.series) seriesWrong.push(`${c.name}: ${got}`);
}
seriesWrong.length === 0 && seriesCases.length >= 9 ? ok(`report_score_series agrees on all ${seriesCases.length} shared cases`) : fail(`report_score_series: ${seriesWrong.join("; ")}`);

try {
  await as(ids[1], `select public.report_score_series('{}'::jsonb)`);
  fail("student called report_score_series");
} catch {
  ok("report_score_series is only reachable through the admin functions");
}

// Fresh students so nothing above leaks in; one report each per day, oldest first. All at one fresh institution.
const seriesUni = (await db.query(`insert into public.universities (name, domain) values ('Series University', 'series.ac.uk') returning id`)).rows[0].id;
const seriesAdminId = (await db.query(`insert into auth.users (email, email_confirmed_at, raw_app_meta_data) values ('admin@series.ac.uk', now(), '{}') returning id`)).rows[0].id;
await db.query(`update public.profiles set role = 'admin', university_id = $2 where id = $1`, [seriesAdminId, seriesUni]);
const seriesStudent = async (reports) => {
  const id = (await db.query(`insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id`, [`s${crypto.randomUUID()}@series.ac.uk`])).rows[0].id;
  await db.query(`update public.profiles set university_id = $2, role = 'student', share_progress = true, faculty = 'Science', last_active_at = now() where id = $1`, [id, seriesUni]);
  for (const [i, [score, payload]] of reports.entries()) {
    await db.query(`insert into public.reports (user_id, type, title, score, payload, created_at) values ($1, 'cv_review', 'cv.pdf', $2, $3, now() - make_interval(days => $4))`, [id, score, payload, reports.length - i]);
  }
  return id;
};
const V1 = inSeries("rules|v1");
const V2 = inSeries("rules|v2");
const sameSeries = await seriesStudent([[40, V1], [55, V1], [70, V1]]);
const ruleChange = await seriesStudent([[40, V1], [45, V1], [90, V2]]);
const twoAfter = await seriesStudent([[30, V1], [60, V2], [61, V2]]);
const unknownOld = await seriesStudent([[20, {}], [80, V1]]);
const onlyOne = await seriesStudent([[66, V1]]);
const stalled = await seriesStudent([[70, V1], [71, V2], [71, V2], [71, V2]]);
const noBullets = await seriesStudent([[50, V1], [10, { analysis: { meta: { bullets: 0, scoring: { identity: "rules|v1" } } } }]]);
const facts = (await db.query(`select * from public.admin_student_facts($1)`, [seriesUni])).rows;
const fact = (id) => facts.find((f) => f.user_id === id || f.id === id);
const expectFact = (name, id, first, latest, comparable) => {
  const f = fact(id);
  f && f.first_score === first && f.latest_score === latest && f.comparable_cvs === comparable ? ok(`series: ${name}`) : fail(`series: ${name}: ${JSON.stringify(f)}`);
};
expectFact("one series: first and latest compare as they always did", sameSeries, 40, 70, 3);
expectFact("a rule change: the jump from 45 to 90 isn't an improvement of 50", ruleChange, null, 90, 1);
expectFact("two reports after a rule change compare with each other only", twoAfter, 60, 61, 2);
expectFact("an old report that doesn't say how it was scored isn't compared", unknownOld, null, 80, 1);
expectFact("a student's only report is first and latest, as before", onlyOne, 66, 66, 1);
expectFact("a no-bullet report is in no series, so nothing is compared with it", noBullets, null, 10, 0);
const flagOf = async (id) => (await db.query(`select public.student_flag(f) as flag from public.admin_student_facts($1) f where f.user_id = $2`, [seriesUni, id])).rows[0].flag;
(await flagOf(stalled)) === "Not improving" ? ok("series: three comparable scores that didn't move still flag 'Not improving'") : fail(`stalled flag: ${await flagOf(stalled)}`);
(await flagOf(ruleChange)) === "" ? ok("series: a rule change doesn't flag 'Not improving'") : fail(`rule-change flag: ${await flagOf(ruleChange)}`);
const seriesRows = (await as(seriesAdminId, `select public.admin_students() as s`)).rows[0].s.rows;
const changeOf = (id) => seriesRows.find((r) => r.key === id)?.change;
changeOf(ruleChange) === null && changeOf(sameSeries) === 30 && changeOf(onlyOne) === 0 ? ok("series: the student list shows no change across series, and the same change as before within one") : fail(`admin_students change: ${JSON.stringify(seriesRows.map((r) => r.change))}`);
const savedScores = (await db.query(`select array_agg(score order by created_at) as s from public.reports where user_id = $1`, [ruleChange])).rows[0].s;
JSON.stringify(savedScores) === "[40,45,90]" ? ok("series: stored scores are untouched") : fail(`scores: ${savedScores}`);

// Simultaneous first publications: both attempts race, one verdict stands, and both read the same one back.
const raceKey = "e".repeat(64);
const verdict = (result) => ({ result, verb: "ok", kind: "achievement" });
await Promise.all(["measured", "none", "partial"].map((r) => asService(`insert into public.judgment_cache (key, judgment, judge) values ($1, $2, 'claude-haiku-5-5') on conflict (key) do nothing`, [raceKey, verdict(r)])));
const raced = (await asService(`select judgment from public.judgment_cache where key = $1`, [raceKey])).rows;
raced.length === 1 ? ok("simultaneous first publications of one key leave exactly one verdict") : fail(`raced rows: ${raced.length}`);

/* OP-025: analysis jobs. tests/recovery-db.test.ts runs the behaviour against both repositories; these are the database's own guarantees. */
{
  const jobUser = ids[2];
  const claimArgs = (key) => [jobUser, "cv_score", key, null, 90, 3, 40, 3, 300];
  const claimSql = `select public.claim_analysis_job($1, $2, $3, $4, $5, $6, $7, $8, $9) as r`;
  const denied = async (fn) => {
    try {
      await fn();
      return false;
    } catch {
      return true;
    }
  };
  for (const role of ["anon", "authenticated"]) {
    const run = async (sql, params) => {
      await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${jobUser}', false);`);
      try {
        return await db.query(sql, params);
      } finally {
        await db.exec(`reset role;`);
      }
    };
    (await denied(() => run(claimSql, claimArgs("not-allowed")))) ? ok(`jobs: ${role} can't claim a job`) : fail(`jobs: ${role} claimed a job`);
    (await denied(() => run(`select * from public.analysis_jobs`))) ? ok(`jobs: ${role} can't read job rows`) : fail(`jobs: ${role} read job rows`);
    (await denied(() => run(`select public.finish_analysis_job($1, $2, 1, 'failed', null, null, null, true, false, '{}')`, [jobUser, jobUser]))) ? ok(`jobs: ${role} can't end a job, or give back quota through one`) : fail(`jobs: ${role} ended a job`);
    (await denied(() => run(`select public.charge_analysis_job($1, $2, 1, 'cv_score', 1, 1)`, [jobUser, jobUser]))) ? ok(`jobs: ${role} can't charge through a job`) : fail(`jobs: ${role} charged`);
    (await denied(() => run(`select * from public.analysis_metrics(now())`))) ? ok(`jobs: ${role} can't read the metrics`) : fail(`jobs: ${role} read the metrics`);
    (await denied(() => run(`select public.sweep_analysis_jobs()`))) ? ok(`jobs: ${role} can't sweep`) : fail(`jobs: ${role} swept`);
  }
  const claimed = (await asService(claimSql, claimArgs("schema-a"))).rows[0].r;
  claimed.outcome === "claimed" && claimed.job.status === "processing" ? ok("jobs: the service role claims a job, into processing") : fail(`jobs: claim ${JSON.stringify(claimed)}`);
  const repeat = (await asService(claimSql, claimArgs("schema-a"))).rows[0].r;
  repeat.outcome === "in_progress" && repeat.job.id === claimed.job.id ? ok("jobs: a second claim finds the first") : fail(`jobs: repeat ${JSON.stringify(repeat)}`);
  const charged = (await asService(`select public.charge_analysis_job($1, $2, 1, 'tailor', 5, 5) as r`, [jobUser, claimed.job.id])).rows[0].r;
  const chargedAgain = (await asService(`select public.charge_analysis_job($1, $2, 1, 'tailor', 5, 5) as r`, [jobUser, claimed.job.id])).rows[0].r;
  charged.used === chargedAgain.used && charged.allowed ? ok("jobs: charging twice takes one use") : fail(`jobs: charge ${JSON.stringify([charged, chargedAgain])}`);
  const otherStudent = await denied(() => asService(`select public.charge_analysis_job($1, $2, 1, 'tailor', 5, 5) as r`, [ids[3], claimed.job.id]));
  otherStudent ? ok("jobs: a job can't be charged under another student") : fail("jobs: charged under another student");
  const usageOf = async () => (await db.query(`select count, failed from public.ai_usage where user_id = $1 and kind = 'tailor' and day = current_date`, [jobUser])).rows[0];
  const before = await usageOf();
  // RLS gives students no update policy, so the statement runs and changes nothing.
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${jobUser}', false);`);
    await db.query(`update public.ai_usage set count = 0, failed = 0`).catch(() => null);
    await db.exec(`reset role;`);
  }
  const untouched = await usageOf();
  untouched.count === before.count && untouched.failed === before.failed ? ok("jobs: a student can't reset their own usage or failure count") : fail(`jobs: usage changed ${JSON.stringify(untouched)}`);
  const finish = `select public.finish_analysis_job($1, $2, 1, 'failed', null, null, 'provider', true, true, '{"calls":3,"latency_ms":10}') as r`;
  const first = (await asService(finish, [jobUser, claimed.job.id])).rows[0].r;
  const second = (await asService(finish, [jobUser, claimed.job.id])).rows[0].r;
  const after = await usageOf();
  first === true && second === false && after.count === before.count - 1 && after.failed === before.failed + 1 ? ok("jobs: failing gives the use back once, however often it's reported, and counts the failure") : fail(`jobs: refund ${JSON.stringify([first, second, before, after])}`);
  const raw = (await db.query(`select id from public.analysis_jobs where id = $1`, [claimed.job.id])).rows[0].id;
  const refused = async (name, sql) => ((await denied(() => db.query(sql, [raw]))) ? ok(`jobs: ${name}`) : fail(`jobs: stored ${name}`));
  await refused("an error code can't hold text", `update public.analysis_jobs set error_code = 'Led a team of 5 at Barclays' where id = $1`);
  await refused("a result can hold only the one flag", `update public.analysis_jobs set result = '{"text":"Led a team"}' where id = $1`);
  await refused("a key can't hold text", `update public.analysis_jobs set idempotency_key = 'Led a team of 5' where id = $1`);
  await refused("a job has only the five states", `update public.analysis_jobs set status = 'done' where id = $1`);
  const cols = (await db.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'analysis_jobs'`)).rows.map((r) => r.column_name);
  !cols.some((c) => /text|content|payload|prompt|file|email|name/.test(c)) ? ok("jobs: no column could hold a document") : fail(`jobs: columns ${cols}`);
  const gone = (await db.query(`insert into auth.users (email) values ('jobs.gone@northfield.ac.uk') returning id`)).rows[0].id;
  await asService(`select public.claim_analysis_job($1, 'cv_score', 'bye', null, 90, 3, 40, 3, 300)`, [gone]);
  await db.query(`delete from auth.users where id = $1`, [gone]);
  (await db.query(`select count(*)::int as n from public.analysis_jobs where user_id = $1`, [gone])).rows[0].n === 0 ? ok("jobs: deleting an account deletes its jobs") : fail("jobs: rows survived account deletion");
  (await db.query(`select column_default from information_schema.columns where table_schema = 'public' and table_name = 'ai_usage' and column_name = 'failed'`)).rows[0].column_default === "0" ? ok("jobs: existing usage rows start with no failures") : fail("jobs: ai_usage.failed default");
}

// OP-018: LinkedIn reviews are rows in reports, under the same rules, and can't carry what would mix them with CV scores.
{
  const liUser = async (email) => (await db.query(`insert into auth.users (email) values ($1) returning id`, [email])).rows[0].id;
  const liOwner = await liUser("li.owner@northfield.ac.uk");
  const liOther = await liUser("li.other@northfield.ac.uk");
  const denied = async (fn) => {
    try {
      await fn();
      return false;
    } catch {
      return true;
    }
  };
  const liPayload = `{"payloadVersion":1,"sections":[{"key":"headline","versions":[{"text":"CANARY PROFILE TEXT"}]}]}`;
  const insertLi = (extra = "", values = "") => asService(`insert into public.reports (user_id, type, title, payload${extra}) values ($1, 'linkedin', 'Profile review', $2${values}) returning id`, [liOwner, liPayload]);
  const liId = (await insertLi()).rows[0].id;
  ok("linkedin: the new report type can be saved");
  const score = await denied(() => asService(`update public.reports set score = 80 where id = $1`, [liId]));
  score ? ok("linkedin: a review can't hold a score") : fail("linkedin: a review held a score");
  (await denied(() => insertLi(", score", ", 75"))) ? ok("linkedin: a review can't be created with a score") : fail("linkedin: created with a score");
  (await denied(() => insertLi(", storage_path", ", 'x/y.zip'"))) ? ok("linkedin: a review can't point at a stored file") : fail("linkedin: stored a file path");
  (await denied(() => asService(`insert into public.reports (user_id, type, title, payload) values ($1, 'linkedin_profile', 't', '{}')`, [liOwner]))) ? ok("linkedin: other report types are still refused") : fail("linkedin: unknown report type accepted");
  (await as(liOwner, `select count(*)::int as n from public.reports where id = $1`, [liId])).rows[0].n === 1 ? ok("linkedin: the student reads their own review") : fail("linkedin: owner can't read");
  (await as(liOther, `select count(*)::int as n from public.reports where id = $1`, [liId])).rows[0].n === 0 ? ok("linkedin: another student can't read it by id") : fail("linkedin: leaked to another student");
  (await as(admin, `select count(*)::int as n from public.reports where id = $1`, [liId])).rows[0].n === 0 ? ok("linkedin: an adviser at the same university can't read it") : fail("linkedin: leaked to an adviser");
  for (const [name, who, sql] of [
    ["insert", liOwner, `insert into public.reports (user_id, type, title, payload) values ('${liOwner}', 'linkedin', 't', '{}')`],
    ["forge for someone else", liOther, `insert into public.reports (user_id, type, title, payload) values ('${liOwner}', 'linkedin', 't', '{}')`],
    ["update", liOwner, `update public.reports set title = 'x' where id = '${liId}'`],
    ["delete", liOwner, `delete from public.reports where id = '${liId}'`],
  ]) {
    const before = (await db.query(`select count(*)::int as n, max(title) as t from public.reports where id = $1`, [liId])).rows[0];
    const blocked = await denied(() => as(who, sql));
    const after = (await db.query(`select count(*)::int as n, max(title) as t from public.reports where id = $1`, [liId])).rows[0];
    blocked && before.n === after.n && before.t === after.t ? ok(`linkedin: a student can't ${name} a review directly`) : fail(`linkedin: student could ${name}`);
  }
  const detail = JSON.stringify((await db.query(`select pg_get_functiondef('public.admin_student_detail'::regproc) as d`)).rows[0].d);
  detail.includes("type = 'cv_review'") ? ok("linkedin: an adviser's student page lists CV reviews only") : fail("linkedin: adviser student page isn't limited to CV reviews");
  const claim = (key) => asService(`select public.claim_analysis_job($1, 'linkedin_create', $2, null, 90, 3, 40, 3, 300) as r`, [liOwner, key]);
  const firstClaim = (await claim("li-attempt-1")).rows[0].r;
  firstClaim.outcome === "claimed" ? ok("linkedin: the create workflow can be claimed") : fail(`linkedin: claim ${JSON.stringify(firstClaim)}`);
  await asService(`select public.finish_analysis_job($1, $2, 1, 'completed', $3, null, null, false, false, '{}')`, [liOwner, firstClaim.job.id, liId]);
  const repeat = (await claim("li-attempt-1")).rows[0].r;
  repeat.outcome === "replay" && repeat.job.result_id === liId ? ok("linkedin: a repeat of the same attempt finds the first report") : fail(`linkedin: repeat ${JSON.stringify(repeat)}`);
  const suggestJob = (await asService(`select public.claim_analysis_job($1, 'linkedin_suggest', 'li-suggest-1', null, 90, 3, 40, 3, 300) as r`, [liOwner])).rows[0].r;
  const charged = (await asService(`select public.charge_analysis_job($1, $2, 1, 'linkedin', 10, 10) as r`, [liOwner, suggestJob.job.id])).rows[0].r;
  charged.allowed === true ? ok("linkedin: AI suggestions have their own daily count") : fail(`linkedin: charge ${JSON.stringify(charged)}`);
  const goneUser = (await db.query(`insert into auth.users (email) values ('li.gone@northfield.ac.uk') returning id`)).rows[0].id;
  await asService(`insert into public.reports (user_id, type, title, payload) values ($1, 'linkedin', 'Profile review', '{"secret":"CANARY"}')`, [goneUser]);
  await db.query(`delete from auth.users where id = $1`, [goneUser]);
  (await db.query(`select count(*)::int as n from public.reports where payload::text like '%CANARY"}%'`)).rows[0].n === 0 ? ok("linkedin: deleting an account deletes its reviews") : fail("linkedin: review survived account deletion");
  (await db.query(`delete from public.reports where id = $1`, [liId]));
}

// OP-020: share links. The token is the only credential, so what matters is who can read a hash, try a token, or change a row.
{
  const denied = async (fn) => {
    try {
      await fn();
      return false;
    } catch {
      return true;
    }
  };
  const asAnon = async (sql, params = []) => {
    await db.exec(`set role anon; select set_config('request.jwt.claim.sub', '', false);`);
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec(`reset role;`);
    }
  };
  const col = (await db.query(`select column_default, is_nullable from information_schema.columns where table_name = 'universities' and column_name = 'report_sharing_enabled'`)).rows[0];
  col?.column_default === "false" && col.is_nullable === "NO" ? ok("sharing: the institution setting defaults to off") : fail(`sharing: default ${JSON.stringify(col)}`);
  const anyOn = (await db.query(`select count(*)::int as n from public.universities where report_sharing_enabled`)).rows[0].n;
  anyOn === 0 ? ok("sharing: no university is on after migration and seed") : fail(`sharing: ${anyOn} universities on`);
  const rls = (await db.query(`select relname, relrowsecurity from pg_class where relname in ('share_links', 'share_link_access')`)).rows;
  rls.length === 2 && rls.every((r) => r.relrowsecurity) ? ok("sharing: row-level security is on for both tables") : fail("sharing: RLS missing");

  const owner = (await db.query(`insert into auth.users (email) values ('share.owner@northfield.ac.uk') returning id`)).rows[0].id;
  const second = (await db.query(`insert into auth.users (email) values ('share.second@northfield.ac.uk') returning id`)).rows[0].id;
  const elsewhere = (await db.query(`insert into public.universities (name, domain) values ('Share Other', 'share-other.ac.uk') returning id`)).rows[0].id;
  const foreign = (await db.query(`insert into auth.users (email) values ('share.foreign@share-other.ac.uk') returning id`)).rows[0].id;
  const report = (await db.query(`insert into public.reports (user_id, type, title, payload) values ($1, 'cv_review', 'Mine', '{"text":"CANARY CV TEXT"}') returning id`, [owner])).rows[0].id;
  const letter = (await db.query(`insert into public.reports (user_id, type, title, payload) values ($1, 'cover_letter', 'L', '{}') returning id`, [owner])).rows[0].id;
  const H = (c) => c.repeat(64);
  const later = new Date(Date.now() + 864e5).toISOString();
  const create = (uid, rep, hash, scope = "score", until = later) => as(uid, `select public.create_share_link($1, $2, $3, $4, $5) as id`, [rep, hash, scope, H("0"), until]);

  (await denied(() => create(owner, report, H("a")))) ? ok("sharing: refused while the university has it off, in the database itself") : fail("sharing: created while off");
  await db.query(`update public.universities set report_sharing_enabled = true where domain = 'northfield.ac.uk'`);
  await db.query(`update public.universities set report_sharing_enabled = true where id = $1`, [elsewhere]);

  const link = (await create(owner, report, H("a"))).rows[0].id;
  link ? ok("sharing: an owner can create a link on their own CV review") : fail("sharing: create");
  for (const [name, fn] of [
    ["another student's report", () => create(second, report, H("b"))],
    ["another university's student", () => create(foreign, report, H("b"))],
    ["a report type that isn't a CV review", () => create(owner, letter, H("b"))],
    ["an unknown scope", () => create(owner, report, H("b"), "full_text")],
    ["a token that isn't a hash", () => create(owner, report, "plain-token")],
    ["more than 30 days", () => create(owner, report, H("b"), "score", new Date(Date.now() + 31 * 864e5).toISOString())],
    ["an expiry in the past", () => create(owner, report, H("b"), "score", new Date(Date.now() - 1000).toISOString())],
    ["a reused hash", () => create(owner, report, H("a"))],
    ["signed out", () => asAnon(`select public.create_share_link($1, $2, 'score', $3, $4)`, [report, H("b"), H("0"), later])],
  ]) (await denied(fn)) ? ok(`sharing: refuses ${name}`) : fail(`sharing: allowed ${name}`);

  (await denied(() => as(owner, `select token_hash from public.share_links`))) ? ok("sharing: not even the owner can read a token hash") : fail("sharing: hash readable");
  (await as(owner, `select id from public.share_links`)).rows.length === 1 ? ok("sharing: an owner sees their link") : fail("sharing: owner can't see link");
  for (const [name, uid] of [["a second student", second], ["another university's student", foreign], ["a careers admin", admin]]) (await as(uid, `select id from public.share_links`)).rows.length === 0 ? ok(`sharing: ${name} sees no link`) : fail(`sharing: ${name} saw a link`);
  (await denied(() => asAnon(`select id from public.share_links`))) ? ok("sharing: signed-out visitors can't read links") : fail("sharing: anon read links");
  for (const [name, sql] of [
    ["insert", `insert into public.share_links (user_id, report_id, token_hash, scope, content_digest, expires_at) values ('${owner}', '${report}', '${H("c")}', 'advice', '${H("0")}', '${later}')`],
    ["widen", `update public.share_links set scope = 'advice'`],
    ["extend", `update public.share_links set expires_at = now() + interval '29 days'`],
    ["un-revoke", `update public.share_links set revoked_at = null`],
    ["delete", `delete from public.share_links`],
    ["forge a log entry", `insert into public.share_link_access (link_id, user_id) values ('${link}', '${owner}')`],
    ["erase the log", `delete from public.share_link_access`],
  ]) (await denied(() => as(owner, sql))) ? ok(`sharing: an owner can't ${name} directly`) : fail(`sharing: owner could ${name}`);
  (await denied(() => as(owner, `update public.universities set report_sharing_enabled = false`))) || (await db.query(`select count(*)::int as n from public.universities where report_sharing_enabled`)).rows[0].n === 2 ? ok("sharing: a student can't change the institution setting") : fail("sharing: student changed the setting");

  for (const [name, run] of [["a student", (sql, p) => as(owner, sql, p)], ["a careers admin", (sql, p) => as(admin, sql, p)], ["a signed-out visitor", asAnon]]) {
    (await denied(() => run(`select public.share_link_lookup($1)`, [H("a")]))) ? ok(`sharing: ${name} can't try tokens against the database`) : fail(`sharing: ${name} can look up tokens`);
    (await denied(() => run(`select public.share_link_record_access($1)`, [link]))) ? ok(`sharing: ${name} can't write to the access log`) : fail(`sharing: ${name} can log`);
  }
  const look = (hash) => asService(`select public.share_link_lookup($1) as r`, [hash]).then((r) => r.rows[0].r);
  (await look(H("a")))?.scope === "score" ? ok("sharing: the server finds a live link by its hash") : fail("sharing: lookup");
  (await look(H("9"))) === null ? ok("sharing: an unknown hash finds nothing") : fail("sharing: unknown hash");
  (await asService(`select public.share_link_record_access($1) as r`, [link])).rows[0].r === true ? ok("sharing: a view of a live link is logged") : fail("sharing: log");
  const logCols = (await db.query(`select column_name from information_schema.columns where table_name = 'share_link_access' order by 1`)).rows.map((r) => r.column_name).join();
  logCols === "accessed_at,id,link_id,user_id" ? ok("sharing: the log has no IP address, browser or location column") : fail(`sharing: log columns ${logCols}`);
  (await as(owner, `select id from public.share_link_access`)).rows.length === 1 && (await as(second, `select id from public.share_link_access`)).rows.length === 0 && (await as(admin, `select id from public.share_link_access`)).rows.length === 0 ? ok("sharing: only the owner reads the access log") : fail("sharing: log visible to another");

  (await as(second, `select public.revoke_share_link($1) as r`, [link])).rows[0].r === false && (await look(H("a"))) !== null ? ok("sharing: another student can't revoke a link") : fail("sharing: foreign revoke");
  (await as(owner, `select public.revoke_share_link($1) as r`, [link])).rows[0].r === true && (await look(H("a"))) === null ? ok("sharing: revocation applies to the next lookup") : fail("sharing: revoke");
  (await asService(`select public.share_link_record_access($1) as r`, [link])).rows[0].r === false ? ok("sharing: a revoked link can't be logged") : fail("sharing: logged a revoked link");

  // Adviser access is a different mechanism: the migration's functions don't touch it, and the adviser's reads don't touch these.
  const defs = (await db.query(`select string_agg(pg_get_functiondef(p.oid), ' ') as d from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('create_share_link', 'revoke_share_link', 'share_link_lookup', 'share_link_record_access', 'report_sharing_enabled')`)).rows[0].d;
  !/share_progress|adviser_can_view_cv/.test(defs) ? ok("sharing: its functions don't read adviser consent") : fail("sharing: functions read adviser consent");
  const adminFns = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'admin%' and pg_get_functiondef(p.oid) like '%share_link%'`)).rows;
  adminFns.length === 0 ? ok("sharing: no admin function reads share links") : fail(`sharing: ${adminFns.map((r) => r.proname)}`);
  const consent = (await db.query(`select share_progress, adviser_can_view_cv from public.profiles where id = $1`, [owner])).rows[0];
  consent.adviser_can_view_cv === false ? ok("sharing: creating a link grants an adviser nothing") : fail("sharing: consent changed");

  const anotherLink = (await create(owner, report, H("d"))).rows[0].id;
  await asService(`select public.share_link_record_access($1)`, [anotherLink]);
  await db.query(`delete from auth.users where id = $1`, [owner]);
  const left = (await db.query(`select (select count(*)::int from public.share_links where id = $1) + (select count(*)::int from public.share_link_access where link_id = $1) as n`, [anotherLink])).rows[0].n;
  left === 0 ? ok("sharing: deleting an account deletes its links and their log") : fail(`sharing: ${left} rows survived deletion`);

  const reportOwner = (await db.query(`insert into auth.users (email) values ('share.report@northfield.ac.uk') returning id`)).rows[0].id;
  const r2 = (await db.query(`insert into public.reports (user_id, type, title, payload) values ($1, 'cv_review', 'R', '{}') returning id`, [reportOwner])).rows[0].id;
  await create(reportOwner, r2, H("e"));
  await db.query(`delete from public.reports where id = $1`, [r2]);
  (await db.query(`select count(*)::int as n from public.share_links where user_id = $1`, [reportOwner])).rows[0].n === 0 ? ok("sharing: deleting a report deletes its links") : fail("sharing: link outlived report");

  await db.query(`update public.universities set report_sharing_enabled = false`);
}

// OP-019: application links, downloads and dismissed recommendations.
{
  const appUser = async (email) => (await db.query(`insert into auth.users (email) values ($1) returning id`, [email])).rows[0].id;
  const [ana, ben] = [await appUser("ana.links@northfield.ac.uk"), await appUser("ben.links@northfield.ac.uk")];
  const addReport = async (who, type) => (await asService(`insert into public.reports (user_id, type, title, payload) values ($1, $2, 'r', '{}') returning id`, [who, type])).rows[0].id;
  const addApp = async (who, role) => (await asService(`insert into public.applications (user_id, role, org) values ($1, $2, 'Northbank') returning id`, [who, role])).rows[0].id;
  const refused = async (fn) => {
    try {
      await fn();
      return false;
    } catch {
      return true;
    }
  };
  const [cvA, tailorA, tailorA2, letterA, liA, cvB] = [await addReport(ana, "cv_review"), await addReport(ana, "tailor"), await addReport(ana, "tailor"), await addReport(ana, "cover_letter"), await addReport(ana, "linkedin"), await addReport(ben, "cv_review")];
  const [appA, appA2, appB] = [await addApp(ana, "Analyst"), await addApp(ana, "Intern"), await addApp(ben, "Analyst")];
  const link = (who, app, report, kind, version = null) => asService(`insert into public.application_links (user_id, application_id, report_id, kind, document_version) values ($1, $2, $3, $4, $5) returning id`, [who, app, report, kind, version]);
  const hash = "a".repeat(64);

  const linkId = (await link(ana, appA, tailorA, "tailor", hash)).rows[0].id;
  await link(ana, appA, cvA, "cv");
  await link(ana, appA2, cvA, "cv");
  ok("links: the same CV can sit on two applications");
  (await refused(() => link(ana, appA, tailorA2, "tailor"))) ? ok("links: one document of each kind on an application") : fail("links: two tailored CVs in one slot");
  (await refused(() => link(ana, appB, cvA, "cv"))) ? ok("links: not on another student's application") : fail("links: crossed onto another student's application");
  (await refused(() => link(ana, appA2, cvB, "cv"))) ? ok("links: not to another student's report") : fail("links: linked another student's report");
  (await refused(() => link(ana, appA2, letterA, "tailor"))) ? ok("links: the report must be the kind the slot says") : fail("links: a letter in the tailored CV slot");
  (await refused(() => link(ana, appA2, liA, "letter"))) ? ok("links: a LinkedIn review has no slot") : fail("links: LinkedIn on an application");
  (await refused(() => asService(`insert into public.application_links (user_id, application_id, report_id, kind) values ($1, $2, $3, 'practice')`, [ana, appA2, tailorA]))) ? ok("links: unknown kinds refused") : fail("links: unknown kind accepted");
  (await refused(() => link(ana, appA2, tailorA, "tailor", "not-a-hash"))) ? ok("links: a kept version must be a hash, so no text can go there") : fail("links: free text in document_version");
  (await refused(() => asService(`update public.application_links set report_id = $1 where id = $2`, [cvB, linkId]))) ? ok("links: an update can't move a link to another student's report") : fail("links: update crossed students");

  (await as(ana, `select count(*)::int as n from public.application_links`)).rows[0].n === 3 ? ok("links: a student reads their own") : fail("links: owner can't read");
  (await as(ben, `select count(*)::int as n from public.application_links where id = $1`, [linkId])).rows[0].n === 0 ? ok("links: another student can't read one by id") : fail("links: leaked to another student");
  (await as(admin, `select count(*)::int as n from public.application_links where id = $1`, [linkId])).rows[0].n === 0 ? ok("links: an adviser has no route to them") : fail("links: leaked to an adviser");
  for (const [what, who, sql] of [
    ["insert", ana, `insert into public.application_links (user_id, application_id, report_id, kind) values ('${ana}', '${appA2}', '${tailorA}', 'tailor')`],
    ["update", ana, `update public.application_links set document_version = null where id = '${linkId}'`],
    ["delete", ana, `delete from public.application_links where id = '${linkId}'`],
    ["insert a download", ana, `insert into public.artefact_downloads (user_id, report_id, document_version, format) values ('${ana}', '${tailorA}', '${hash}', 'pdf')`],
    ["insert a dismissal", ana, `insert into public.action_choices (user_id, action_key, kind, reason) values ('${ana}', 'k', 'dismiss', 'done')`],
    ["track without the server", ana, `insert into public.applications (user_id, role, org) values ('${ana}', 'x', 'y')`],
    ["point an application at a report", ana, `update public.applications set source_report_id = '${tailorA}' where id = '${appA}'`],
  ]) {
    (await refused(() => as(who, sql))) ? ok(`links: a signed-in student can't ${what} directly`) : fail(`links: student could ${what}`);
  }
  (await refused(() => asService(`update public.applications set source_report_id = $1 where id = $2`, [cvB, appA]))) ? ok("applications: can't come from another student's report") : fail("applications: another student's report accepted");
  await asService(`update public.applications set source_report_id = $1 where id = $2`, [tailorA, appA]);
  (await refused(() => asService(`insert into public.applications (user_id, role, org, source_report_id) values ($1, 'Analyst', 'Northbank', $2)`, [ana, tailorA]))) ? ok("applications: one application per report it came from") : fail("applications: a double click makes two");
  await asService(`insert into public.applications (user_id, role, org) values ($1, 'Analyst', 'Northbank')`, [ana]);
  ok("applications: rows with no source aren't constrained by the new index");

  const download = (who, report, format = "docx") => asService(`insert into public.artefact_downloads (user_id, report_id, document_version, format) values ($1, $2, $3, $4)`, [who, report, hash, format]);
  await download(ana, tailorA);
  (await refused(() => download(ana, tailorA, "pdf"))) ? ok("downloads: one row per version, so a retry can't add another") : fail("downloads: duplicate version");
  (await refused(() => download(ana, cvB))) ? ok("downloads: not on another student's report") : fail("downloads: crossed students");
  (await refused(() => download(ana, cvA, "exe"))) ? ok("downloads: unknown formats refused") : fail("downloads: unknown format");
  (await as(ben, `select count(*)::int as n from public.artefact_downloads where report_id = $1`, [tailorA])).rows[0].n === 0 ? ok("downloads: private to the student") : fail("downloads: leaked");
  (await as(admin, `select count(*)::int as n from public.artefact_downloads where report_id = $1`, [tailorA])).rows[0].n === 0 ? ok("downloads: an adviser has no route to them") : fail("downloads: leaked to an adviser");

  const choice = (key, kind, reason) => asService(`insert into public.action_choices (user_id, action_key, kind, reason) values ($1, $2, $3, $4) returning id`, [ana, key, kind, reason]);
  const choiceId = (await choice(`download:${tailorA}:${hash}`, "dismiss", "not_relevant")).rows[0].id;
  await choice(`download:${tailorA}:${hash}`, "reopen", null);
  ok("choices: dismissing and bringing back are both recorded");
  (await refused(() => choice("k", "dismiss", null))) ? ok("choices: a dismissal must say why") : fail("choices: dismissal with no reason");
  (await refused(() => choice("k", "reopen", "done"))) ? ok("choices: reopening carries no reason") : fail("choices: reopen with a reason");
  (await refused(() => choice("k", "dismiss", "because"))) ? ok("choices: only the listed reasons") : fail("choices: free-form reason");
  (await refused(() => choice("I did not like the line about my time at Northbank", "dismiss", "done"))) ? ok("choices: no sentence fits in a key") : fail("choices: text in a key");
  (await refused(() => asService(`update public.action_choices set reason = 'done' where id = $1`, [choiceId]))) ? ok("choices: append-only") : fail("choices: rewritten");
  (await as(ben, `select count(*)::int as n from public.action_choices where id = $1`, [choiceId])).rows[0].n === 0 ? ok("choices: private to the student") : fail("choices: leaked");
  (await as(admin, `select count(*)::int as n from public.action_choices where id = $1`, [choiceId])).rows[0].n === 0 ? ok("choices: an adviser has no route to them") : fail("choices: leaked to an adviser");
  for (const t of ["application_links", "artefact_downloads", "action_choices"]) {
    (await db.query(`select relrowsecurity as on from pg_class where oid = $1::regclass`, [`public.${t}`])).rows[0].on ? ok(`${t} has row-level security on`) : fail(`${t} has no RLS`);
    (await db.query(`select count(*)::int as n from pg_policies where tablename = $1 and cmd <> 'SELECT'`, [t])).rows[0].n === 0 ? ok(`${t} has no write policy for signed-in users`) : fail(`${t} has a write policy`);
  }

  // What removing things does.
  await asService(`delete from public.applications where id = $1`, [appA2]);
  (await db.query(`select count(*)::int as n from public.application_links where application_id = $1`, [appA2])).rows[0].n === 0 ? ok("links: stopping tracking removes them") : fail("links: survived their application");
  (await db.query(`select count(*)::int as n from public.reports where id = $1`, [cvA])).rows[0].n === 1 ? ok("links: and the report stays") : fail("links: took the report with them");
  await asService(`delete from public.reports where id = $1`, [tailorA]);
  (await db.query(`select count(*)::int as n from public.application_links where id = $1`, [linkId])).rows[0].n === 0 ? ok("links: removing a report removes its place on the application") : fail("links: pointed at a gone report");
  (await db.query(`select count(*)::int as n from public.artefact_downloads where report_id = $1`, [tailorA])).rows[0].n === 0 ? ok("downloads: go with their report") : fail("downloads: survived their report");
  (await db.query(`select source_report_id as s from public.applications where id = $1`, [appA])).rows[0].s === null ? ok("applications: stay when the report they came from goes") : fail("applications: went with their report");
  await db.query(`delete from auth.users where id = $1`, [ana]);
  for (const t of ["application_links", "artefact_downloads", "action_choices", "applications"]) {
    (await db.query(`select count(*)::int as n from public.${t} where user_id = $1`, [ana])).rows[0].n === 0 ? ok(`deleting an account empties ${t}`) : fail(`${t} survived the account`);
  }
  await db.query(`delete from auth.users where id = $1`, [ben]);
}

// OP-021: institution configuration, the adviser role, casework and the access trail. The behaviour is in
// tests/adviser-db.test.ts, with two universities; this block is the schema's own shape, in the file that applies it.
{
  const tables = ["institution_settings", "programme_groups", "institution_resources", "institution_contacts", "adviser_group_assignments", "staff_access_log", "adviser_disagreements", "adviser_referrals", "adviser_referral_events"];
  for (const t of tables) {
    (await db.query(`select relrowsecurity as on from pg_class where oid = $1::regclass`, [`public.${t}`])).rows[0].on ? ok(`op021: ${t} has row-level security on`) : fail(`op021: ${t} has no RLS`);
    (await db.query(`select count(*)::int as n from pg_policies where tablename = $1`, [t])).rows[0].n === 0 ? ok(`op021: ${t} has no policy: functions only`) : fail(`op021: ${t} has a policy`);
    (await db.query(`select count(*)::int as n from information_schema.role_table_grants where table_schema = 'public' and table_name = $1 and grantee in ('anon', 'authenticated')`, [t])).rows[0].n === 0 ? ok(`op021: ${t} grants nothing to signed-in or signed-out roles`) : fail(`op021: ${t} has grants`);
  }
  const scoreCols = (await db.query(`select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in ('institution_settings', 'programme_groups', 'institution_resources', 'institution_contacts', 'adviser_group_assignments') and column_name ~* '(score|weight|threshold|rubric|band|scoring|sector)'`)).rows;
  scoreCols.length === 0 ? ok("op021: no configuration table has a column a scorer could read") : fail(`op021: scoring-shaped columns: ${JSON.stringify(scoreCols)}`);
  const logCols = (await db.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'staff_access_log' and column_name ~* '(ip|agent|browser|location|text|content)'`)).rows;
  logCols.length === 0 ? ok("op021: the trail has no column for where someone was, or for document content") : fail(`op021: trail columns: ${JSON.stringify(logCols)}`);

  const role = async (email) => (await db.query(`select role from public.profiles where email = $1`, [email])).rows[0]?.role;
  await db.query(`insert into public.universities (name, domain) values ('Op021 North', 'op021n.ac.uk'), ('Op021 South', 'op021s.ac.uk')`);
  const user = async (email) => (await db.query(`insert into auth.users (email) values ($1) returning id`, [email])).rows[0].id;
  const north = await user("admin@op021n.ac.uk");
  await db.query(`update public.profiles set role = 'admin' where id = $1`, [north]);
  const adviser = await user("adviser@op021n.ac.uk");
  const student = await user("student@op021n.ac.uk");
  await db.query(`update public.profiles set share_progress = true, faculty = 'Sciences' where id = $1`, [student]);
  const report = (await db.query(`insert into public.reports (user_id, type, title, score, payload) values ($1, 'cv_review', 'cv', 55, '{}') returning id`, [student])).rows[0].id;
  try {
    await db.query(`update public.profiles set role = 'owner' where id = $1`, [adviser]);
    fail("op021: an unknown role was accepted");
  } catch {
    ok("op021: profiles.role still refuses unknown roles");
  }
  (await as(north, `select public.admin_set_adviser('adviser@op021n.ac.uk', true) as r`)).rows[0].r === "granted" && (await role("adviser@op021n.ac.uk")) === "adviser" ? ok("op021: a careers admin can appoint an adviser") : fail("op021: appoint adviser");
  (await as(north, `select public.admin_set_adviser('later@op021n.ac.uk', true) as r`)).rows[0].r === "invited" ? ok("op021: an invitation waits for sign-up") : fail("op021: invite adviser");
  await user("later@op021n.ac.uk");
  (await role("later@op021n.ac.uk")) === "adviser" ? ok("op021: and becomes an adviser, not an admin") : fail(`op021: invited role is ${await role("later@op021n.ac.uk")}`);
  (await as(north, `select public.admin_student_detail($1) as d`, [student])).rows[0].d ? ok("op021: a careers admin sees a sharing student") : fail("op021: admin detail");
  (await as(adviser, `select public.admin_student_detail($1) as d`, [student])).rows[0].d === null ? ok("op021: an adviser with no groups doesn't") : fail("op021: adviser saw a student outside their groups");
  (await db.query(`select count(*)::int as n from public.staff_access_log where actor_id = $1 and action = 'view_student' and outcome = 'granted'`, [north])).rows[0].n === 1 ? ok("op021: the view is on the trail") : fail("op021: view not logged");
  (await db.query(`select count(*)::int as n from public.staff_access_log where actor_id = $1 and action = 'view_student' and outcome = 'denied'`, [adviser])).rows[0].n === 1 ? ok("op021: and so is the refusal") : fail("op021: refusal not logged");
  const d = (await as(north, `select public.admin_record_disagreement($1, 'score', '', 'The automated score misses the context.') as id`, [report])).rows[0].id;
  try {
    await db.query(`update public.adviser_disagreements set rationale = 'changed' where id = $1`, [d]);
    fail("op021: a disagreement was edited");
  } catch {
    ok("op021: a disagreement can't be edited, even by the table's owner");
  }
  (await db.query(`select score from public.reports where id = $1`, [report])).rows[0].score === 55 ? ok("op021: and the report's score is what it was") : fail("op021: disagreement moved the score");
  await db.query(`delete from auth.users where id = $1`, [student]);
  (await db.query(`select count(*)::int as n from public.adviser_disagreements where id = $1`, [d])).rows[0].n === 0 ? ok("op021: deleting the student removes the disagreement, as their data") : fail("op021: disagreement survived the account");
  const trail = (await db.query(`select count(*)::int as n, count(student_id)::int as tied from public.staff_access_log where actor_id = $1`, [north])).rows[0];
  trail.n >= 2 && trail.tied === 0 ? ok("trail: the entries stay, tied to nobody") : fail(`trail: ${JSON.stringify(trail)}`);
}

// FD-21: the erasure ledger. Behaviour, including a simulated restore, is in tests/erasure-ledger.test.ts.
{
  const cols = (await db.query(`select column_name as c from information_schema.columns where table_schema = 'public' and table_name = 'erasure_ledger' order by 1`)).rows.map((r) => r.c);
  cols.join() === "account_id,erased_at" ? ok("erasure ledger: holds an id and a date, nothing else") : fail(`erasure ledger: columns ${cols}`);
  (await db.query(`select relrowsecurity as on from pg_class where oid = 'public.erasure_ledger'::regclass`)).rows[0].on ? ok("erasure ledger: row-level security is on") : fail("erasure ledger: no RLS");
  (await db.query(`select count(*)::int as n from pg_policies where tablename = 'erasure_ledger'`)).rows[0].n === 0 ? ok("erasure ledger: no policy, so no user reaches it") : fail("erasure ledger: has a policy");
  (await db.query(`select count(*)::int as n from information_schema.role_table_grants where table_schema = 'public' and table_name = 'erasure_ledger' and grantee in ('anon', 'authenticated', 'PUBLIC')`)).rows[0].n === 0 ? ok("erasure ledger: anon and signed-in users hold no privilege on it") : fail("erasure ledger: granted to a user role");
  const service = (await db.query(`select privilege_type as p from information_schema.role_table_grants where table_schema = 'public' and table_name = 'erasure_ledger' and grantee = 'service_role' order by 1`)).rows.map((r) => r.p);
  service.join() === "INSERT,SELECT" ? ok("erasure ledger: the service role can read it and put rows back, and can't change or remove one") : fail(`erasure ledger: service role holds ${service}`);
  (await db.query(`select count(*)::int as n from pg_constraint where conrelid = 'public.erasure_ledger'::regclass and contype = 'f'`)).rows[0].n === 0 ? ok("erasure ledger: no foreign key, so a row outlives its account") : fail("erasure ledger: a foreign key would cascade the record away");
  const uid = (await db.query(`insert into auth.users (email) values ('ledger.check@northfield.ac.uk') returning id`)).rows[0].id;
  try {
    await as(uid, `select * from public.erasure_ledger`);
    fail("erasure ledger: a student can read it");
  } catch {
    ok("erasure ledger: a student can't read it");
  }
  try {
    await as(uid, `select public.record_account_erasure()`);
    fail("erasure ledger: a student can call the trigger function");
  } catch {
    ok("erasure ledger: a student can't call the trigger function");
  }
  await as(uid, `select public.delete_my_account()`);
  (await db.query(`select count(*)::int as n from public.erasure_ledger where account_id = $1`, [uid])).rows[0].n === 1 ? ok("erasure ledger: deleting an account records it") : fail("erasure ledger: no record of the deletion");
  const fn = (await db.query(`select prosecdef as d, proconfig as c from pg_proc where proname = 'record_account_erasure'`)).rows[0];
  fn.d && fn.c?.some((x) => x.startsWith("search_path=")) ? ok("erasure ledger: trigger function is security definer with a fixed search path") : fail("erasure ledger: trigger function isn't locked down");
}

// OP-023: saved interview practice. Private to the student, tied to their own application and documents, and gone with the account.
{
  const mk = async (email) => (await db.query(`insert into auth.users (email) values ($1) returning id`, [email])).rows[0].id;
  const [ana, ben, staff] = [await mk("op023.ana@northfield.ac.uk"), await mk("op023.ben@northfield.ac.uk"), await mk("op023.staff@northfield.ac.uk")];
  await db.query(`update public.profiles set role = 'admin' where id = $1`, [staff]);
  await db.query(`update public.profiles set share_progress = true, adviser_can_view_cv = true where id = $1`, [ana]);
  const report = async (who, type) => (await asService(`insert into public.reports (user_id, type, title, payload) values ($1, $2, 'r', '{}') returning id`, [who, type])).rows[0].id;
  const application = async (who) => (await asService(`insert into public.applications (user_id, role, org) values ($1, 'Analyst', 'Northbank') returning id`, [who])).rows[0].id;
  const [cvA, tailorA, letterA, cvB] = [await report(ana, "cv_review"), await report(ana, "tailor"), await report(ana, "cover_letter"), await report(ben, "cv_review")];
  const [appA, appB] = [await application(ana), await application(ben)];
  const hash = "a".repeat(64);
  let n = 0;
  const save = (who, over = {}) => {
    const r = { application_id: appA, mode: "application", document_report_id: cvA, document_version: hash, advert_report_id: tailorA, advert_version: hash, answer: "I kept stock records for the shop.", ...over };
    return asService(
      `insert into public.practice_answers (user_id, application_id, mode, role_label, document_report_id, document_version, document_label, advert_report_id, advert_version, objective, question_id, question, answer, feedback, feedback_version, method, attempt_key)
       values ($1, $2, $3, 'Analyst · Northbank', $4, $5, 'CV', $6, $7, 'all', 'q1', '{"id":"q1"}', $8, '{"version":"v"}', 'v', 'rules', $9) returning id`,
      [who, r.application_id, r.mode, r.document_report_id, r.document_version, r.advert_report_id, r.advert_version, r.answer, over.attempt_key ?? `attempt-key-number-${++n}`],
    );
  };
  const refused = async (fn) => {
    try {
      await fn();
      return false;
    } catch {
      return true;
    }
  };
  await db.query(`update public.profiles set last_active_at = now() - interval '200 days' where id = $1`, [ana]);
  const first = (await save(ana, { attempt_key: "attempt-key-number-one" })).rows[0].id;
  (await db.query(`select last_active_at > now() - interval '1 day' as fresh from public.profiles where id = $1`, [ana])).rows[0].fresh ? ok("practice: saving an answer counts as activity for retention") : fail("practice: an active student still looks inactive");
  const general = (await save(ana, { application_id: null, mode: "general", document_report_id: null, document_version: null, advert_report_id: null, advert_version: null })).rows[0].id;
  (await refused(() => save(ana, { attempt_key: "attempt-key-number-one" }))) ? ok("practice: the same attempt is one answer") : fail("practice: an attempt saved twice");
  const invalid = [
    ["on another student's application", () => save(ana, { application_id: appB })],
    ["naming another student's CV", () => save(ana, { document_report_id: cvB })],
    ["naming another student's advert", () => save(ana, { advert_report_id: cvB })],
    ["naming a letter as its CV", () => save(ana, { document_report_id: letterA })],
    ["for someone else's account, on this student's application", () => save(ben)],
    ["general practice naming a document", () => save(ana, { application_id: null, mode: "general", advert_report_id: null, advert_version: null })],
    ["application practice naming no version", () => save(ana, { document_version: null })],
    ["with a version that isn't a hash", () => save(ana, { document_version: "nope" })],
    ["too short", () => save(ana, { answer: "short" })],
    ["too long", () => save(ana, { answer: "x".repeat(4001) })],
    ["of an unknown mode", () => save(ana, { mode: "video" })],
  ];
  for (const [name, fn] of invalid) (await refused(fn)) ? ok(`practice: refused ${name}`) : fail(`practice: saved ${name}`);
  (await refused(() => asService(`update public.practice_answers set answer = 'rewritten by the server' where id = $1`, [first]))) ? ok("practice: answers are immutable, even to the server") : fail("practice: an answer was rewritten");
  (await refused(() => asService(`update public.practice_answers set application_id = $1 where id = $2`, [appB, first]))) ? ok("practice: an answer can't be moved to another application") : fail("practice: an answer moved");

  (await as(ana, `select count(*)::int as n from public.practice_answers`)).rows[0].n === 2 ? ok("practice: a student reads their own") : fail("practice: owner can't read");
  (await as(ben, `select count(*)::int as n from public.practice_answers where id = $1`, [first])).rows[0].n === 0 ? ok("practice: another student can't read one by id") : fail("practice: leaked to another student");
  // The student has opted in to everything an adviser can be given, and this is a careers admin at the same university.
  (await as(staff, `select count(*)::int as n from public.practice_answers where id = $1`, [first])).rows[0].n === 0 ? ok("practice: careers staff have no route to an answer, even with the student's sharing on") : fail("practice: leaked to staff");
  for (const [name, who, sql] of [
    ["insert", ana, `insert into public.practice_answers (user_id, mode, objective, question_id, question, answer, feedback, feedback_version, method, attempt_key) values ('${ana}', 'general', 'all', 'q', '{}', 'twenty characters or more', '{}', 'v', 'rules', 'attempt-from-the-student')`],
    ["update", ana, `update public.practice_answers set answer = 'twenty characters or more' where id = '${first}'`],
    ["delete", ana, `delete from public.practice_answers where id = '${first}'`],
    ["truncate", ana, `truncate public.practice_answers`],
  ]) {
    (await refused(() => as(who, sql))) ? ok(`practice: a student can't ${name} directly: the server does it`) : fail(`practice: a student could ${name}`);
  }
  await db.exec(`set role anon;`);
  const anonRead = await refused(() => db.query(`select id from public.practice_answers`));
  await db.exec(`reset role;`);
  anonRead ? ok("practice: signed-out visitors can't read the table") : fail("practice: anon read the table");
  (await db.query(`select relrowsecurity as on from pg_class where oid = 'public.practice_answers'::regclass`)).rows[0].on ? ok("practice: row-level security is on") : fail("practice: no RLS");
  const policies = (await db.query(`select policyname, cmd, roles::text as roles from pg_policies where tablename = 'practice_answers'`)).rows;
  policies.length === 1 && policies[0].cmd === "SELECT" && /authenticated/.test(policies[0].roles) ? ok("practice: the only policy is a student reading their own") : fail(`practice: policies ${JSON.stringify(policies)}`);
  const readers = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosrc ~* 'practice_answers'`)).rows;
  readers.length === 0 ? ok("practice: no database function reads answers, so no staff or reporting function can") : fail(`practice: read by ${readers.map((r) => r.proname)}`);
  const cols = (await db.query(`select column_name as c from information_schema.columns where table_schema = 'public' and table_name = 'practice_answers'`)).rows.map((r) => r.c);
  !cols.some((c) => /audio|video|recording|voice|score|mark|rating|employab/.test(c)) ? ok("practice: text only, and no column holds a mark") : fail(`practice: columns ${cols}`);

  (await as(ana, `select public.bump_ai_usage('practice') as n`)).rows[0].n === 1 ? ok("practice: the model pass has its own usage count") : fail("practice: usage count");
  (await refused(() => as(ana, `select public.bump_ai_usage('voice')`))) ? ok("practice: other usage kinds are still refused") : fail("practice: unknown usage kind accepted");
  await asService(`insert into public.analysis_jobs (user_id, workflow, idempotency_key) values ($1, 'practice_feedback', 'k')`, [ana]);
  ok("practice: the model pass can be tracked as a job");

  await asService(`delete from public.applications where id = $1`, [appA]);
  const kept = (await db.query(`select application_id, role_label, answer from public.practice_answers where id = $1`, [first])).rows[0];
  kept && kept.application_id === null && kept.role_label ? ok("practice: stopping tracking keeps the answer and lets go of the application") : fail(`practice: ${JSON.stringify(kept)}`);
  await asService(`delete from public.reports where id = $1`, [tailorA]);
  (await db.query(`select count(*)::int as n from public.practice_answers where id = $1`, [first])).rows[0].n === 0 ? ok("practice: an answer goes with a document its question quotes") : fail("practice: survived the document it quotes");
  (await db.query(`select count(*)::int as n from public.practice_answers where id = $1`, [general])).rows[0].n === 1 ? ok("practice: general answers don't depend on any document") : fail("practice: a general answer went");
  const benApp = await application(ben);
  await save(ben, { application_id: benApp, document_report_id: cvB, advert_report_id: null, advert_version: null });
  await as(ana, `select public.delete_my_account()`);
  (await db.query(`select count(*)::int as n from public.practice_answers where user_id = $1`, [ana])).rows[0].n === 0 ? ok("practice: deleting an account empties it") : fail("practice: survived the account");
  (await db.query(`select count(*)::int as n from public.erasure_ledger where account_id = $1`, [ana])).rows[0].n === 1 ? ok("practice: and that deletion is on the erasure ledger") : fail("practice: deletion not on the ledger");
  await db.query(`delete from auth.users where id = $1`, [ben]);
  (await db.query(`select count(*)::int as n from public.practice_answers where user_id = $1`, [ben])).rows[0].n === 0 ? ok("practice: the admin or retention route empties it too") : fail("practice: survived auth deletion");
  await db.query(`delete from auth.users where id = $1`, [staff]);
}

// Signed-out visitors can't call any security definer function.
const anonDefiners = await db.query(`
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')`);
anonDefiners.rows.length === 0 ? ok("anonymous visitors can't call any security definer function") : fail(`anon can call: ${anonDefiners.rows.map((r) => r.proname).join(", ")}`);
