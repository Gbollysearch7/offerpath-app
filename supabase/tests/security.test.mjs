// OP-026: tenant isolation and account deletion, checked in real Postgres (PGlite) with every migration applied.
// Auth and storage are stubs: auth.uid() reads a setting, storage.objects is a plain table with the real policies.
// So this proves the SQL (policies, grants, functions, foreign keys). It proves nothing about Supabase's own auth
// server, PostgREST or storage service. Run with: npm run test:db
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";

const root = new URL("../", import.meta.url);
const migrations = readdirSync(new URL("migrations/", root)).filter((f) => f.endsWith(".sql")).sort().map((f) => fileURLToPath(new URL(`migrations/${f}`, root)));
const db = new PGlite();
let passed = 0;
const ok = (m) => {
  passed++;
  console.log("PASS", m);
};
const fail = (m) => {
  console.log("FAIL", m);
  process.exitCode = 1;
};
const check = (cond, m, detail) => (cond ? ok(m) : fail(detail === undefined ? m : `${m}: ${JSON.stringify(detail)}`));

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema storage; create schema extensions;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;
  -- As Supabase does: table and function privileges by default; migrations then revoke what they don't want.
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
for (const m of migrations) await db.exec(readFileSync(m, "utf8"));
ok(`all ${migrations.length} migrations apply`);

const as = async (uid, sql, params = []) => {
  await db.exec(`set request.jwt.claim.sub = '${uid}'; set role authenticated`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec(`reset role; reset request.jwt.claim.sub`);
  }
};
const asAnon = async (sql, params = []) => {
  await db.exec(`set role anon`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec(`reset role`);
  }
};
const asService = async (sql, params = []) => {
  await db.exec(`set role service_role`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec(`reset role`);
  }
};
const denied = async (run, m) => {
  try {
    await run();
    fail(`${m} (it was allowed)`);
  } catch {
    ok(m);
  }
};
const value = async (run) => {
  const r = await run();
  return Object.values(r.rows[0] ?? {})[0];
};

await db.exec(`insert into public.universities (name, domain) values ('Northfield', 'northfield.ac.uk'), ('Southvale', 'southvale.ac.uk')`);
const northUni = await value(() => db.query(`select id from public.universities where domain = 'northfield.ac.uk'`));
const newUser = async (email, role = "student", extra = {}) => {
  const id = await value(() => db.query(`insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ($1, $2, $3) returning id`, [email, extra.user ?? {}, extra.app ?? {}]));
  await db.query(`update public.profiles set role = $2, share_progress = true where id = $1`, [id, role]);
  return id;
};
const northAdmin = await newUser("adviser@northfield.ac.uk", "admin");
const southAdmin = await newUser("adviser@southvale.ac.uk", "admin");
const north = await newUser("north.student@northfield.ac.uk");
const north2 = await newUser("north.other@northfield.ac.uk");
const south = await newUser("south.student@southvale.ac.uk");
for (let i = 0; i < 6; i++) await newUser(`north.${i}@northfield.ac.uk`);

const sha = (n) => String(n).padStart(64, "0");
const upload = await value(() => asService(`insert into public.cv_sources (user_id, kind, file_name, text, document_version, storage_path) values ($1, 'upload', 'cv.pdf', 'SECRET-CV-TEXT', $2, $3) returning id`, [north, sha(1), `${north}/a/cv.pdf`]));
const correction = await value(() => asService(`insert into public.cv_sources (user_id, parent_id, kind, file_name, text, document_version) values ($1, $2, 'correction', 'cv.pdf (corrected)', 'SECRET-CV-TEXT fixed', $3) returning id`, [north, upload, sha(2)]));
const secondCorrection = await value(() => asService(`insert into public.cv_sources (user_id, parent_id, kind, file_name, text, document_version) values ($1, $2, 'correction', 'cv.pdf (corrected)', 'SECRET-CV-TEXT fixed again', $3) returning id`, [north, correction, sha(3)]));
const scan = await value(() => asService(`insert into public.cv_sources (user_id, kind, file_name, text, document_version, storage_path, outcome) values ($1, 'upload', 'scan.pdf', '', $2, $3, '{"kind":"unsupported","code":"image_only","message":"x"}') returning id`, [north, sha(4), `${north}/b/scan.pdf`]));
await asService(`insert into public.cv_sources (user_id, parent_id, kind, file_name, text, document_version) values ($1, $2, 'paste', 'scan.pdf (typed)', 'SECRET-CV-TEXT typed', $3)`, [north, scan, sha(5)]);
const report = await value(() => asService(`insert into public.reports (user_id, type, title, score, payload, storage_path, source_id) values ($1, 'cv_review', 'cv.pdf', 70, '{"text":"SECRET-CV-TEXT"}', $2, $3) returning id`, [north, `${north}/a/cv.pdf`, secondCorrection]));
await asService(`insert into public.reports (user_id, type, title, score, payload) values ($1, 'cover_letter', 'letter', 60, '{}'), ($1, 'tailor', 'tailor', 50, '{}')`, [north]);
const southReport = await value(() => asService(`insert into public.reports (user_id, type, title, score, payload) values ($1, 'cv_review', 'south', 40, '{}') returning id`, [south]));
await db.exec(`insert into storage.objects (bucket_id, name) values ('cvs', '${north}/a/cv.pdf'), ('cvs', '${north}/b/scan.pdf'), ('cvs', '${south}/c/cv.pdf')`);
await db.query(`update public.profiles set adviser_can_view_cv = true where id = $1`, [north]);

// ---------- cross-user ----------
for (const [what, sql] of [
  ["report", `select count(*)::int from public.reports where id = '${report}'`],
  ["version", `select count(*)::int from public.cv_sources where id = '${upload}'`],
  ["version text", `select count(*)::int from public.cv_sources where text like 'SECRET%'`],
  ["profile", `select count(*)::int from public.profiles where id = '${north}'`],
  ["original file", `select count(*)::int from storage.objects where name like '${north}/%'`],
]) {
  check((await value(() => as(north2, sql))) === 0, `another student at the same university can't read the ${what}`);
  check((await value(() => as(south, sql))) === 0, `a student at another university can't read the ${what}`);
}
check((await value(() => as(north, `select count(*)::int from public.cv_sources`))) === 5, "the control: the owner sees all their versions");
check((await value(() => as(north, `select count(*)::int from storage.objects where name like '${north}/%'`))) === 2, "the control: the owner sees their files");
for (const t of ["reports", "cv_sources", "profiles", "applications", "ai_usage"]) {
  // The table grant is Supabase's default; with no policy for anon, row-level security returns nothing.
  check((await value(() => asAnon(`select count(*)::int from public.${t}`))) === 0, `a signed-out visitor sees no rows in ${t}`);
}
check((await value(() => asAnon(`select count(*)::int from storage.objects`)).catch(() => 0)) === 0, "or in storage");
for (const [what, sql] of [
  ["read a note", `select count(*) from public.adviser_notes`],
  ["read student records", `select count(*) from public.student_records`],
  ["read rate limits", `select count(*) from public.rate_limits`],
  ["delete an account", `select public.delete_my_account()`],
  ["use an admin function", `select public.admin_analytics()`],
]) await denied(() => asAnon(sql), `a signed-out visitor can't ${what}`);

// Students can't write around the server, including to their own rows.
await denied(() => as(north, `update public.reports set score = 100 where id = '${report}'`), "a student can't change their own score");
await denied(() => as(north, `delete from public.reports where id = '${report}'`), "a student can't delete a report directly");
await denied(() => as(north, `update public.cv_sources set text = 'x' where id = '${upload}'`), "a student can't rewrite a version");
await denied(() => as(north, `delete from public.cv_sources where id = '${upload}'`), "a student can't delete a version directly");
await denied(() => as(north, `insert into storage.objects (bucket_id, name) values ('cvs', '${north2}/x/cv.pdf')`), "a student can't plant a file in another student's folder");
await denied(() => as(north, `insert into storage.objects (bucket_id, name) values ('cvs', '${north}/x/cv.pdf')`), "or in their own: only the server stores files");
const deletedOwn = await as(north, `delete from storage.objects where name = '${north}/a/cv.pdf' returning id`);
check(deletedOwn.rows.length === 0, "a student can't remove their own original file directly: it stays immutable until the account goes");
const deletedOther = await as(south, `delete from storage.objects where name = '${north}/a/cv.pdf' returning id`);
check(deletedOther.rows.length === 0, "nor anyone else's");
check((await value(() => db.query(`select count(*)::int from storage.objects where name = '${north}/a/cv.pdf'`))) === 1, "the file is still there");

// ---------- cross-institution, every admin function ----------
check((await value(() => as(northAdmin, `select public.admin_cv_path($1)`, [report]))) === `${north}/a/cv.pdf`, "the control: the student's own adviser gets the CV path after opt-in");
check((await value(() => as(southAdmin, `select public.admin_cv_path($1)`, [report]))) === null, "another university's adviser gets no CV path");
check((await value(() => as(southAdmin, `select public.admin_student_detail($1)`, [north]))) === null, "another university's adviser gets no student detail");
check((await value(() => as(northAdmin, `select public.admin_student_detail($1)`, [south]))) === null, "in either direction");
await denied(() => as(southAdmin, `select public.admin_add_note($1, 'hello from another university')`, [report]), "another university's adviser can't add a note to the report");
await denied(() => as(northAdmin, `select public.admin_add_note($1, 'hello from another university')`, [southReport]), "in either direction");
const southList = (await value(() => as(southAdmin, `select public.admin_students()`))).rows;
check(southList.every((r) => r.key !== north && r.key !== north2), "another university's student list doesn't include them", southList);
const southOverview = await value(() => as(southAdmin, `select public.admin_analytics()`));
check(!JSON.stringify(southOverview).includes("Northfield"), "another university's overview says nothing about them", southOverview);
const northList = (await value(() => as(northAdmin, `select public.admin_students()`))).rows;
check(northList.length > 0 && northList.every((r) => r.key !== south), "and an adviser's own list holds only their university's students");
check((await value(() => as(southAdmin, `select count(*)::int from public.reports where user_id = '${north}'`))) === 0, "an adviser can't read another university's reports directly");
check((await value(() => as(northAdmin, `select count(*)::int from public.reports where user_id = '${north}'`))) === 0, "or their own students' reports: only through the consent-checking functions");
check((await value(() => as(northAdmin, `select count(*)::int from public.cv_sources`))) === 0, "advisers have no direct route to version text at all");
check((await value(() => as(northAdmin, `select count(*)::int from storage.objects where name like '${north}/%'`))) === 0, "or to files");
for (const [what, sql, params] of [
  ["overview", `select public.admin_analytics()`, []],
  ["student list", `select public.admin_students()`, []],
  ["student detail", `select public.admin_student_detail($1)`, [north2]],
  ["CV path", `select public.admin_cv_path($1)`, [report]],
  ["adding a note", `select public.admin_add_note($1, 'x')`, [report]],
  ["import", `select public.admin_import_students('[]')`, []],
  ["team list", `select public.admin_list_team()`, []],
  ["role change", `select public.admin_set_role('north.other@northfield.ac.uk', true)`, []],
]) await denied(() => as(north2, sql, params), `a student can't use the admin ${what}`);
await as(northAdmin, `select public.admin_add_note($1, 'Good progress on your impact section')`, [report]);
check((await value(() => as(north2, `select count(*)::int from public.adviser_notes`))) === 0, "another student can't read the note");
check((await value(() => as(southAdmin, `select count(*)::int from public.adviser_notes`))) === 0, "another university's adviser can't read the note");

// ---------- revocation affects the next request ----------
await as(north, `update public.profiles set adviser_can_view_cv = false where id = $1`, [north]);
check((await value(() => as(northAdmin, `select public.admin_cv_path($1)`, [report]))) === null, "after the student opts out, the adviser gets no CV path");
await as(north, `update public.profiles set share_progress = false where id = $1`, [north]);
check((await value(() => as(northAdmin, `select public.admin_student_detail($1)`, [north]))) === null, "after sharing is switched off, no detail");
await denied(() => as(northAdmin, `select public.admin_add_note($1, 'x')`, [report]), "and no new notes");
await as(north, `update public.profiles set share_progress = true, adviser_can_view_cv = true where id = $1`, [north]);
const exAdviser = await newUser("ex.adviser@northfield.ac.uk", "admin");
check((await value(() => as(exAdviser, `select public.admin_cv_path($1)`, [report]))) === `${north}/a/cv.pdf`, "the control: a current adviser can");
await db.query(`update public.profiles set role = 'student' where id = $1`, [exAdviser]);
await denied(() => as(exAdviser, `select public.admin_cv_path($1)`, [report]), "an adviser who loses the role loses access at once");

// ---------- sign-up: institution fields ----------
const spoofed = { full_name: "Real Name", student_number: "2100001", fee_status: "international", faculty: "Medicine", course: "Medicine", year_of_study: "5" };
const self = await newUser("spoofer@northfield.ac.uk", "student", { user: spoofed });
const sp = (await db.query(`select full_name, student_number, fee_status, faculty, course, year_of_study from public.profiles where id = $1`, [self])).rows[0];
check(sp.full_name === "Real Name" && [sp.student_number, sp.fee_status, sp.faculty, sp.course, sp.year_of_study].every((v) => v === null), "fields a client sends to the sign-up API don't become institution data", sp);
const viaSso = await newUser("via.sso@northfield.ac.uk", "student", { user: spoofed, app: { provider: "sso:0f3c9a2e" } });
const sso = (await db.query(`select student_number, fee_status from public.profiles where id = $1`, [viaSso])).rows[0];
check(sso.student_number === "2100001" && sso.fee_status === "international", "the same fields from a single sign-on provider do", sso);
const viaClaims = await newUser("via.claims@northfield.ac.uk", "student", { app: { custom_claims: { student_number: "2100002" } } });
check((await value(() => db.query(`select student_number from public.profiles where id = $1`, [viaClaims]))) === "2100002", "server-set claims still count");
await db.query(`insert into public.student_records (university_id, email, student_number, fee_status) values ($1, 'imported@northfield.ac.uk', '2100003', 'home')`, [northUni]);
const imported = await newUser("imported@northfield.ac.uk", "student", { user: spoofed, app: { provider: "sso:0f3c9a2e" } });
check((await value(() => db.query(`select student_number from public.profiles where id = $1`, [imported]))) === "2100003", "the careers team's imported record beats everything");
await denied(() => db.query(`insert into auth.users (email, raw_user_meta_data) values ('x@gmail.com', '{"role":"admin"}')`), "no metadata gets someone in from outside a partner university");
const fresh = await value(() => db.query(`insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ('fresh@northfield.ac.uk', '{"role":"admin"}', '{"provider":"sso:x","custom_claims":{"role":"admin"}}') returning id`));
check((await value(() => db.query(`select role from public.profiles where id = $1`, [fresh]))) === "student", "no metadata, from any source, grants admin");

// ---------- the catalogue: things a new table or function could get wrong ----------
const rows = async (sql) => (await db.query(sql)).rows;
const noRls = await rows(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
check(noRls.length === 0, "every public table has row-level security on", noRls);
const dangerous = await rows(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')`);
check(dangerous.length === 0, "signed-in and signed-out roles hold no TRUNCATE, TRIGGER or REFERENCES, which row-level security doesn't govern", dangerous);
const noPath = await rows(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')`);
check(noPath.length === 0, "every security definer function pins its search path", noPath);
const callable = await rows(`select p.proname, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute')`);
const general = new Set(["bump_ai_usage", "delete_my_account", "my_admin_university", "my_university", "create_share_link", "revoke_share_link", "report_sharing_enabled", "staff_university", "my_institution", "my_casework", "my_casework_unseen", "mark_casework_seen", "respond_to_referral"]); // The share functions take their owner from auth.uid(): schema.test.mjs, "sharing:". So do my_* and respond_to_referral (tests/adviser-db.test.ts); staff_university is the staff gate.
const unexpected = callable.filter((f) => !general.has(f.proname) && !f.proname.startsWith("admin_"));
check(unexpected.length === 0, "signed-in users can call only the known functions and the admin_* set", unexpected.map((f) => f.proname));
// OP-021: advisers share a named set of admin_* functions. Each of these starts from staff_university(), which raises for students and narrows by staff_can_see(); everything else stays careers-admin only.
const staffFunctions = new Set(["admin_students", "admin_student_detail", "admin_cv_path", "admin_add_note", "admin_record_disagreement", "admin_withdraw_disagreement", "admin_create_referral", "admin_update_referral", "admin_casework"]);
const ungated = callable.filter((f) => f.proname.startsWith("admin_") && f.proname !== "admin_university" && !(staffFunctions.has(f.proname) ? /staff_university\(\)/ : /admin_university\(\)/).test(f.prosrc));
check(ungated.length === 0, "every admin_* function a signed-in user can call starts from admin_university() or, for the named adviser set, staff_university(); both raise for students", ungated.map((f) => f.proname));
const paramUni = await rows(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and pg_get_function_identity_arguments(p.oid) like '%p_uni%' and has_function_privilege('authenticated', p.oid, 'execute')`);
check(paramUni.length === 0, "no function a signed-in user can call takes a university id as an argument", paramUni);
const ownerCols = await rows(`
  select c.table_name, c.column_name, (
    select con.confdeltype from pg_constraint con
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any (con.conkey)
    where con.contype = 'f' and con.conrelid = format('public.%I', c.table_name)::regclass and a.attname = c.column_name and con.confrelid = 'public.profiles'::regclass limit 1
  ) as rule
  from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.column_name in ('user_id', 'student_id')`);
// OP-021: the one exception. The access trail outlives the account, with student_id nulled, so nothing ties it to them (schema.test.mjs, "trail:").
const notCascading = ownerCols.filter((c) => c.rule !== "c" && !(c.table_name === "staff_access_log" && c.column_name === "student_id" && c.rule === "n"));
check(ownerCols.length >= 6 && notCascading.length === 0, `all ${ownerCols.length} user-owned columns cascade from the profile, so deletion can't miss a table or be blocked by one`, notCascading);
const blockers = await rows(`select conrelid::regclass::text as t, conname from pg_constraint where contype = 'f' and confrelid in ('public.profiles'::regclass, 'auth.users'::regclass) and confdeltype not in ('c', 'n')`);
check(blockers.length === 0, "no foreign key can block deleting an account", blockers);

// ---------- account deletion ----------
await db.query(`insert into public.applications (user_id, opportunity_id, role, org, status, closes_on) values ($1, null, 'Analyst', 'Northbank', 'saved', current_date + 3)`, [north]);
const app = await value(() => db.query(`select id from public.applications where user_id = $1`, [north]));
await asService(`select public.mark_reminders_sent($1::uuid[])`, [[app]]);
await as(north, `select public.bump_ai_usage('line_rewrite')`);
const tablesWithOwner = ownerCols.map((c) => [c.table_name, c.column_name]);
const holding = async (uid) => {
  const out = {};
  for (const [t, col] of tablesWithOwner) out[`${t}.${col}`] = await value(() => db.query(`select count(*)::int from public.${t} where ${col} = $1`, [uid]));
  return out;
};
const choiceReport = await value(() => asService(`insert into public.reports (user_id, type, title, payload) values ($1, 'cv_review', 'CV', $2) returning id`, [north, { proofreading: { documentVersion: sha(1) } }]));
await asService(`insert into public.proofreading_choices (user_id, report_id, document_version, kind, finding_id, quote) values ($1, $2, $3, 'dismiss', 'spelling:unrecognised-word:x', 'x')`, [north, choiceReport, sha(1)]);
const before = await holding(north);
for (const t of ["cv_sources", "reports", "applications", "ai_usage", "adviser_notes", "reminder_log", "proofreading_choices"]) {
  const k = Object.keys(before).find((x) => x.startsWith(`${t}.`));
  check(before[k] > 0, `the student really has rows in ${t} before deletion`, before);
}
check(before["cv_sources.user_id"] === 5, "including all five versions: upload, two corrections, a scan and typed text", before);
const southBefore = await holding(south);
const north2Before = await holding(north2);

await denied(() => as(north2, `delete from auth.users where id = '${north}'`), "a student can't delete another account");
await as(north, `select public.delete_my_account()`);

const after = await holding(north);
check(Object.values(after).every((n) => n === 0), "delete_my_account leaves no row in any user-owned table", after);
check((await value(() => db.query(`select count(*)::int from public.profiles where id = $1`, [north]))) === 0, "the profile is gone");
check((await value(() => db.query(`select count(*)::int from auth.users where id = $1`, [north]))) === 0, "the auth user is gone");
check((await value(() => db.query(`select count(*)::int from public.cv_sources where text like 'SECRET%'`))) === 0, "no version's text survives");
check((await value(() => db.query(`select count(*)::int from public.reports where payload::text like '%SECRET%'`))) === 0, "no report's text survives");
check(JSON.stringify(await holding(south)) === JSON.stringify(southBefore) && JSON.stringify(await holding(north2)) === JSON.stringify(north2Before), "nobody else's rows changed");
const files = await value(() => db.query(`select count(*)::int from storage.objects where name like '${north}/%'`));
check(files === 2, "files have no cascade: the database leaves them, which is why the app removes them first (tests/security-deletion.test.ts)", files);

// The retention job's route: deleting the auth user as the service role cascades the same way.
const idle = await newUser("idle@northfield.ac.uk");
await asService(`insert into public.cv_sources (user_id, kind, file_name, text, document_version) values ($1, 'upload', 'cv.pdf', 'SECRET-IDLE', $2)`, [idle, sha(9)]);
await db.query(`delete from auth.users where id = $1`, [idle]);
check((await value(() => db.query(`select count(*)::int from public.cv_sources where text = 'SECRET-IDLE'`))) === 0, "deleting the auth user directly (retention job) cascades to versions");

// What is deliberately not deleted with an account, so the documentation can say so. See docs/OPERATIONS.md.
await db.query(`insert into public.student_records (university_id, email, student_number) values ($1, 'kept@northfield.ac.uk', '2100004')`, [northUni]);
const kept = await newUser("kept@northfield.ac.uk");
await as(kept, `select public.delete_my_account()`);
check((await value(() => db.query(`select count(*)::int from public.student_records where email = 'kept@northfield.ac.uk'`))) === 1, "documented: the university's imported record outlives the account (its data, not the student's)");
await as(northAdmin, `select public.delete_my_account()`);
const orphaned = (await db.query(`select author_id, author_name from public.adviser_notes`)).rows;
check(orphaned.every((n) => n.author_id === null), "documented: a deleted adviser's notes on students who still exist stay, without the account link", orphaned);
const cacheCols = (await rows(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'judgment_cache'`)).map((r) => r.column_name).sort();
check(JSON.stringify(cacheCols) === JSON.stringify(["created_at", "judge", "judgment", "key"]), "documented: the shared judgment cache outlives accounts, and holds no text or user id", cacheCols);

console.log(`\n${passed} passed${process.exitCode ? ", with failures above" : ""}`);
