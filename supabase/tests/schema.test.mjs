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
  await as(ids[0], `select public.admin_overview()`);
  fail("student called admin_overview");
} catch {
  ok("students can't call admin_overview");
}
const ov = (await as(admin, `select public.admin_overview() as o`)).rows[0].o;
ov.kpis.activeStudents === 7 && ov.kpis.avgScore !== null && ov.bands && ov.faculties.length === 1 && ov.homeIntl.length === 0
  ? ok(`admin_overview: ${JSON.stringify(ov.kpis)}`)
  : fail(`admin_overview: ${JSON.stringify(ov)}`);
const stRes = (await as(admin, `select public.admin_students() as s`)).rows[0].s;
const st = stRes.rows;
st.length === 7 && stRes.total === 7 && stRes.counts.all === 7 ? ok(`admin_students returns ${st.length} rows, e.g. ${JSON.stringify(st[0])}`) : fail(`admin_students: ${JSON.stringify(stRes)}`);
const page2 = (await as(admin, `select public.admin_students('all', '', '', 3, 3) as s`)).rows[0].s;
page2.rows.length === 3 && page2.total === 7 ? ok("student list pages on the server (3 per page, page 2)") : fail(`paging: ${JSON.stringify(page2)}`);
const intl = (await as(admin, `select public.admin_students('international') as s`)).rows[0].s;
intl.rows.every((r) => r.status === "International") && intl.total === intl.counts.international ? ok("student list filters on the server") : fail(`filter: ${JSON.stringify(intl)}`);
const future = (await as(admin, `select public.admin_overview(now() + interval '1 year', now() + interval '2 years') as o`)).rows[0].o;
future.kpis.cvsReviewed === 0 ? ok("dashboard period filter limits activity to the chosen term") : fail(`period: ${JSON.stringify(future.kpis)}`);
const pack = (await as(admin, `select public.admin_outcomes_pack() as p`)).rows[0].p;
const all = pack.rows.find((r) => r.dimension === "All students");
const smallGroup = pack.rows.find((r) => r.dimension === "Fee status" && r.group === "International");
all?.students === 7 && all.uploadedCv === 7 && smallGroup?.suppressed === true ? ok("outcomes pack: funnel for all, small groups suppressed") : fail(`pack: ${JSON.stringify(pack.rows.slice(0, 4))}`);

// Consent: a student who stops sharing disappears from admin views.
await as(ids[6], `update public.profiles set share_progress = false where id = $1`, [ids[6]]);
const st2 = (await as(admin, `select public.admin_students() as s`)).rows[0].s.rows;
st2.length === 6 ? ok("non-consenting students are excluded") : fail(`consent: ${st2.length}`);
// k-anonymity: with only 4 sharing, averages are hidden.
for (const i of [4, 5]) await as(ids[i], `update public.profiles set share_progress = false where id = $1`, [ids[i]]);
const ov2 = (await as(admin, `select public.admin_overview() as o`)).rows[0].o;
ov2.kpis.avgScore === null && ov2.bands === null && ov2.faculties.length === 0 ? ok("groups under five are hidden") : fail(`k-anon: ${JSON.stringify(ov2)}`);

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
const sso = (await db.query(`insert into auth.users (email, raw_user_meta_data) values ('sso.user@northfield.ac.uk', $1) returning id`, [{ full_name: "Sam SSO", faculty: "Engineering\u0007", course: "Mechanical Engineering", fee_status: "International", student_number: "2209999" }])).rows[0].id;
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
const seriesPack = (await as(seriesAdminId, `select public.admin_outcomes_pack() as p`)).rows[0].p.rows.find((r) => r.dimension === "All students");
seriesPack.improved10 === 1 ? ok("series: 'improved by 10+' counts only the student who improved within one series") : fail(`improved10: ${JSON.stringify(seriesPack)}`);
const savedScores = (await db.query(`select array_agg(score order by created_at) as s from public.reports where user_id = $1`, [ruleChange])).rows[0].s;
JSON.stringify(savedScores) === "[40,45,90]" ? ok("series: stored scores are untouched") : fail(`scores: ${savedScores}`);

// Simultaneous first publications: both attempts race, one verdict stands, and both read the same one back.
const raceKey = "e".repeat(64);
const verdict = (result) => ({ result, verb: "ok", kind: "achievement" });
await Promise.all(["measured", "none", "partial"].map((r) => asService(`insert into public.judgment_cache (key, judgment, judge) values ($1, $2, 'claude-haiku-5-5') on conflict (key) do nothing`, [raceKey, verdict(r)])));
const raced = (await asService(`select judgment from public.judgment_cache where key = $1`, [raceKey])).rows;
raced.length === 1 ? ok("simultaneous first publications of one key leave exactly one verdict") : fail(`raced rows: ${raced.length}`);

// Signed-out visitors can't call any security definer function.
const anonDefiners = await db.query(`
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')`);
anonDefiners.rows.length === 0 ? ok("anonymous visitors can't call any security definer function") : fail(`anon can call: ${anonDefiners.rows.map((r) => r.proname).join(", ")}`);
