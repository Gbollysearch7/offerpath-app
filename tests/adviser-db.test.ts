// OP-021: the database and repository boundaries, with two universities. The real SQL from every migration runs in
// PGlite with row-level security on and the caller's role set, as PostgREST would. Auth and PostgREST are stubbed: see
// the report for what that leaves unproven. Repository tests go through supabaseRepo and the flows, with a client that
// runs each call under that user's own role.
import "./fixtures/provider-stub";
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createReferralFlow, recordDisagreementFlow, respondToReferralFlow, saveContactFlow, saveGroupFlow, saveResourceFlow, saveSettingsFlow, setAdviserFlow, setAdviserGroupsFlow, stopSharingFlow, updateReferralFlow, withdrawDisagreementFlow } from "@/lib/institution/flow";
import { PERMISSIONS } from "@/lib/institution/permissions";
import { supabaseRepo } from "@/lib/repo/supabase";
import type { Repo } from "@/lib/repo/types";

const db = new PGlite();
const noAdmin = (() => {
  throw new Error("the service role is not used by adviser code");
}) as unknown as () => SupabaseClient;

const reportPayload = { fileName: "cv.pdf", sector: "Technology", stage: "x", text: "SECRET-CV-TEXT", analysis: { score: 62, areas: [{ key: "impact", name: "Impact", score: 55, what: "x", checks: [{ key: "numbers", area: "impact", name: "Numbers", score: 4, summary: "SECRET-SUMMARY quotes the CV", detail: "SECRET-DETAIL", stat: { value: "1", label: "x" }, affected: [], extras: ["SECRET-EXTRA"] }] }], lines: [{ text: "SECRET-LINE" }], steps: [], wells: [], meta: { scoring: { identity: "series-1" } } } };

const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
async function asRole<T>(role: string, uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role;`);
  }
}
const as = <T = Record<string, unknown>>(uid: string, sql: string, params: unknown[] = []) => asRole("authenticated", uid, () => q<T>(sql, params));
const rpc = async <T = unknown>(uid: string, name: string, args: Record<string, unknown> = {}) => {
  const keys = Object.keys(args);
  const r = await as<{ r: T }>(uid, `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, keys.map((k) => args[k]));
  return r[0].r;
};

function client(uid: string): SupabaseClient {
  return {
    async rpc(name: string, args: Record<string, unknown> = {}) {
      try {
        return { data: JSON.parse(JSON.stringify((await rpc(uid, name, args)) ?? null)), error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message, code: (e as { code?: string }).code } };
      }
    },
    from(table: string) {
      if (table !== "profiles") throw new Error(`unexpected table ${table}`);
      const b = {
        select: () => b,
        eq: () => b,
        async single() {
          const rows = await as(uid, `select p.*, json_build_object('name', u.name) as universities from public.profiles p left join public.universities u on u.id = p.university_id where p.id = $1`, [uid]);
          return { data: JSON.parse(JSON.stringify(rows[0])), error: null };
        },
      };
      return b;
    },
  } as unknown as SupabaseClient;
}
const repoFor = (uid: string): Repo => supabaseRepo(client(uid), uid, noAdmin);

interface World {
  northUni: string;
  southUni: string;
  admin: string;
  southAdmin: string;
  adviser: string;
  otherAdviser: string;
  southAdviser: string;
  econ: string;
  chem: string;
  south: string;
  econReport: string;
  econLinkedIn: string;
  chemReport: string;
  southReport: string;
  group: string;
  southGroup: string;
}
const w = {} as World;

const newUser = async (email: string, role: string, extra: Record<string, unknown> = {}) => {
  const id = (await q<{ id: string }>(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [email, JSON.stringify({ full_name: extra.name ?? email.split("@")[0] })]))[0].id;
  await q(`update public.profiles set role = $2, share_progress = $3, faculty = $4, course = $5, student_number = $6 where id = $1`, [id, role, role === "student" ? (extra.share ?? true) : false, extra.faculty ?? null, extra.course ?? null, extra.number ?? null]);
  return id;
};
const newReport = async (user: string, type = "cv_review", storage: string | null = `${user}/a/cv.pdf`) => (await q<{ id: string }>(`insert into public.reports (user_id, type, title, score, payload, storage_path) values ($1, $2, 'cv.pdf', $5, $3, $4) returning id`, [user, type, JSON.stringify(reportPayload), storage, type === "linkedin" ? null : 62]))[0].id;
const logCount = async (where: string, params: unknown[] = []) => (await q<{ n: number }>(`select count(*)::int as n from public.staff_access_log where ${where}`, params))[0].n;
const reportRow = async (id: string) => JSON.stringify((await q(`select row_to_json(r) as j from public.reports r where id = $1`, [id]))[0]);

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
  await db.exec(`insert into public.universities (name, domain) values ('Northfield', 'northfield.ac.uk'), ('Southvale', 'southvale.ac.uk')`);
  w.northUni = (await q<{ id: string }>(`select id from public.universities where domain = 'northfield.ac.uk'`))[0].id;
  w.southUni = (await q<{ id: string }>(`select id from public.universities where domain = 'southvale.ac.uk'`))[0].id;
  w.admin = await newUser("sam@northfield.ac.uk", "admin", { name: "Sam Admin" });
  w.southAdmin = await newUser("jo@southvale.ac.uk", "admin", { name: "Jo South" });
  w.adviser = await newUser("priya@northfield.ac.uk", "adviser", { name: "Priya Adviser" });
  w.otherAdviser = await newUser("omar@northfield.ac.uk", "adviser", { name: "Omar Adviser" });
  w.southAdviser = await newUser("rae@southvale.ac.uk", "adviser", { name: "Rae South" });
  w.econ = await newUser("econ@northfield.ac.uk", "student", { name: "Econ Student", faculty: "Social sciences", course: "Economics", number: "N1" });
  w.chem = await newUser("chem@northfield.ac.uk", "student", { name: "Chem Student", faculty: "Sciences", course: "Chemistry", number: "N2" });
  w.south = await newUser("s@southvale.ac.uk", "student", { name: "South Student", faculty: "Social sciences", course: "Economics", number: "S1" });
  w.econReport = await newReport(w.econ);
  w.econLinkedIn = await newReport(w.econ, "linkedin", null);
  w.chemReport = await newReport(w.chem);
  w.southReport = await newReport(w.south);
  w.group = (await rpc<string>(w.admin, "admin_save_group", { p_id: null, p_name: "Social sciences", p_faculties: ["social sciences"], p_courses: [] }))!;
  w.southGroup = (await rpc<string>(w.southAdmin, "admin_save_group", { p_id: null, p_name: "Everything", p_faculties: ["Social sciences"], p_courses: [] }))!;
  await rpc(w.admin, "admin_set_adviser_groups", { p_adviser: w.adviser, p_groups: [w.group] });
});

/* ---------- database boundary ---------- */

const NEW_TABLES = ["institution_settings", "programme_groups", "institution_resources", "institution_contacts", "adviser_group_assignments", "staff_access_log", "adviser_disagreements", "adviser_referrals", "adviser_referral_events"];

test("database: no signed-in or signed-out role can touch the new tables directly, whatever their role", async () => {
  for (const t of NEW_TABLES) {
    for (const uid of [w.econ, w.adviser, w.admin]) {
      await assert.rejects(as(uid, `select * from public.${t}`), /permission denied/, `${t} readable`);
      await assert.rejects(as(uid, `delete from public.${t}`), /permission denied/, `${t} deletable`);
      await assert.rejects(as(uid, `update public.${t} set university_id = university_id`).catch((e) => { throw e; }), /permission denied|does not exist/, `${t} updatable`);
    }
    await assert.rejects(asRole("anon", null, () => q(`select * from public.${t}`)), /permission denied/);
  }
});

test("database: a student cannot call any staff function, and an adviser cannot call any admin-only one", async () => {
  const staffCalls: [string, Record<string, unknown>][] = [
    ["admin_student_detail", { p_student: w.econ }],
    ["admin_cv_path", { p_report: w.econReport }],
    ["admin_add_note", { p_report: w.econReport, p_note: "hello there" }],
    ["admin_record_disagreement", { p_report: w.econReport, p_target_kind: "score", p_target_key: "", p_rationale: "A long enough reason." }],
    ["admin_create_referral", { p_student: w.econ, p_report: null, p_contact: null, p_target: "Somewhere", p_reason: "A long enough reason.", p_owner: null }],
    ["admin_casework", {}],
    ["admin_students", {}],
  ];
  for (const [fn, args] of staffCalls) await assert.rejects(rpc(w.econ, fn, args), /careers staff only/, fn);
  const adminCalls: [string, Record<string, unknown>][] = [
    ["admin_analytics", { p_period: "all" }],
    ["admin_import_students", { p_rows: "[]" }],
    ["admin_list_team", {}],
    ["admin_set_role", { p_email: "x@northfield.ac.uk", p_admin: true }],
    ["admin_list_advisers", {}],
    ["admin_set_adviser", { p_email: "x@northfield.ac.uk", p_adviser: true }],
    ["admin_set_adviser_groups", { p_adviser: w.adviser, p_groups: [] }],
    ["admin_institution_config", {}],
    ["admin_save_institution_settings", { p_brand_name: "X y", p_brand_colour: null, p_welcome: null, p_adviser_scope: "all" }],
    ["admin_stop_report_sharing", {}],
    ["admin_save_contact", { p_id: null, p_label: "Xy", p_purpose: "", p_email: "a@b.c", p_phone: null, p_url: null, p_hours: null }],
    ["admin_save_resource", { p_id: null, p_title: "Xy", p_url: "https://x.y", p_description: "", p_group: null, p_active: true }],
    ["admin_save_group", { p_id: null, p_name: "Xy", p_faculties: [], p_courses: [] }],
    ["admin_record_export", { p_kind: "export_students", p_rows: 1 }],
    ["admin_access_log", {}],
  ];
  for (const [fn, args] of adminCalls) {
    await assert.rejects(rpc(w.adviser, fn, args), /admins only/, `adviser: ${fn}`);
    await assert.rejects(rpc(w.econ, fn, args), /admins only/, `student: ${fn}`);
  }
  for (const f of [["log_staff_access", `'${w.adviser}'::uuid, '${w.northUni}'::uuid, null, null, null, 'open_cv', 'granted'`], ["staff_can_see", `'${w.adviser}'::uuid, '${w.econ}'::uuid`]] as const) {
    await assert.rejects(as(w.adviser, `select public.${f[0]}(${f[1]})`), /permission denied/, `${f[0]} is internal`);
  }
});

test("database: another university's admin and adviser get nothing by guessing any identifier", async () => {
  const before = await reportRow(w.econReport);
  const contact = (await rpc<string>(w.admin, "admin_save_contact", { p_id: null, p_label: "North careers", p_purpose: "", p_email: "c@northfield.ac.uk", p_phone: null, p_url: null, p_hours: null }))!;
  const resource = (await rpc<string>(w.admin, "admin_save_resource", { p_id: null, p_title: "North guide", p_url: "https://north.example/x", p_description: "", p_group: w.group, p_active: true }))!;
  const referral = (await rpc<string>(w.admin, "admin_create_referral", { p_student: w.econ, p_report: null, p_contact: contact, p_target: null, p_reason: "A long enough reason.", p_owner: null }))!;
  const disagreement = (await rpc<string>(w.admin, "admin_record_disagreement", { p_report: w.econReport, p_target_kind: "score", p_target_key: "", p_rationale: "A long enough reason." }))!;

  await q(`update public.profiles set adviser_can_view_cv = true where id = $1`, [w.econ]);
  for (const stranger of [w.southAdmin, w.southAdviser]) {
    assert.equal(await rpc(stranger, "admin_student_detail", { p_student: w.econ }), null);
    assert.equal(await rpc(stranger, "admin_cv_path", { p_report: w.econReport }), null);
    await assert.rejects(rpc(stranger, "admin_add_note", { p_report: w.econReport, p_note: "hello there" }), /report not found/);
    assert.equal(await rpc(stranger, "admin_record_disagreement", { p_report: w.econReport, p_target_kind: "score", p_target_key: "", p_rationale: "A long enough reason." }), null);
    assert.equal(await rpc(stranger, "admin_withdraw_disagreement", { p_id: disagreement, p_reason: "A long enough reason." }), null);
    assert.equal(await rpc(stranger, "admin_create_referral", { p_student: w.econ, p_report: w.econReport, p_contact: null, p_target: "Elsewhere", p_reason: "A long enough reason.", p_owner: null }), null);
    assert.equal(await rpc(stranger, "admin_update_referral", { p_id: referral, p_status: "withdrawn", p_owner: null, p_note: null }), null);
    const list = await rpc<{ total: number; rows: { key: string }[] }>(stranger, "admin_students");
    assert.ok(!list.rows.some((r) => r.key === w.econ));
    assert.equal((await rpc<{ referrals: unknown[] }>(stranger, "admin_casework")).referrals.length, 0);
  }
  for (const [fn, args] of [
    ["admin_delete_contact", { p_id: contact }],
    ["admin_delete_resource", { p_id: resource }],
    ["admin_delete_group", { p_id: w.group }],
    ["admin_save_contact", { p_id: contact, p_label: "Hijacked", p_purpose: "", p_email: "a@b.c", p_phone: null, p_url: null, p_hours: null }],
    ["admin_save_resource", { p_id: resource, p_title: "Hijacked", p_url: "https://x.y", p_description: "", p_group: null, p_active: true }],
    ["admin_save_resource", { p_id: null, p_title: "Hijacked", p_url: "https://x.y", p_description: "", p_group: w.group, p_active: true }],
    ["admin_save_group", { p_id: w.group, p_name: "Hijacked", p_faculties: [], p_courses: [] }],
    ["admin_set_adviser_groups", { p_adviser: w.adviser, p_groups: [] }],
    ["admin_set_adviser_groups", { p_adviser: w.southAdviser, p_groups: [w.group] }],
  ] as [string, Record<string, unknown>][]) await assert.rejects(rpc(w.southAdmin, fn, args), /not found/, fn);
  await assert.rejects(rpc(w.southAdmin, "admin_create_referral", { p_student: w.south, p_report: null, p_contact: contact, p_target: null, p_reason: "A long enough reason.", p_owner: null }), /contact not found/);
  await assert.rejects(rpc(w.southAdmin, "admin_create_referral", { p_student: w.south, p_report: w.econReport, p_contact: null, p_target: "Elsewhere", p_reason: "A long enough reason.", p_owner: null }), /report not found/);
  await assert.rejects(rpc(w.southAdmin, "admin_create_referral", { p_student: w.south, p_report: null, p_contact: null, p_target: "Elsewhere", p_reason: "A long enough reason.", p_owner: w.admin }), /can't take this on/);
  await assert.rejects(rpc(w.southAdmin, "admin_set_adviser", { p_email: "priya@northfield.ac.uk", p_adviser: false }), /not at your university/);

  const southConfig = await rpc<{ contacts: unknown[]; resources: unknown[]; groups: { id: string }[] }>(w.southAdmin, "admin_institution_config");
  assert.equal(southConfig.contacts.length, 0);
  assert.equal(southConfig.resources.length, 0);
  assert.deepEqual(southConfig.groups.map((g) => g.id), [w.southGroup]);
  assert.equal((await rpc<{ contacts: unknown[] }>(w.south, "my_institution")).contacts.length, 0, "and another university's student sees none of it");

  // What exports read: another university's figures and lists hold nobody from here.
  assert.ok(!JSON.stringify(await rpc(w.southAdmin, "admin_students", { p_limit: 5000 })).includes(w.econ));
  // OP-022: figures are rounded and hidden under five, so with two students these can't be told apart by the number. The
  // exact rows are, and the admin's own function reads only their own university. tests/analytics-db.test.ts holds the rest.
  assert.ok(!JSON.stringify(await rpc(w.southAdmin, "admin_analytics", { p_period: "all" })).includes("Northfield"), "another university's figures say nothing of this one");
  assert.deepEqual((await q<{ user_id: string }>(`select user_id from public.analytics_student_rows($1, null, now())`, [w.southUni])).map((r) => r.user_id), [w.south], "only their own student");
  assert.equal((await q(`select user_id from public.analytics_student_rows($1, null, now())`, [w.northUni])).length, 2, "the control");

  // A refused guess leaves nothing about the other student in the guesser's log.
  const guessed = await q<{ student_id: string | null; target_id: string | null }>(`select student_id, target_id from public.staff_access_log where university_id = $1 and action = 'view_student' and outcome = 'denied'`, [w.southUni]);
  assert.ok(guessed.length >= 2);
  assert.ok(guessed.every((g) => g.student_id === null && g.target_id === w.econ));
  assert.equal(await reportRow(w.econReport), before, "none of this touched the report");
  await q(`update public.profiles set adviser_can_view_cv = false where id = $1`, [w.econ]);
});

test("database: an adviser sees only their groups, an admin all sharers, and the policy widens it only when an admin says so", async () => {
  assert.ok(await rpc(w.adviser, "admin_student_detail", { p_student: w.econ }), "in their group");
  assert.equal(await rpc(w.adviser, "admin_student_detail", { p_student: w.chem }), null, "outside it");
  assert.equal(await rpc(w.otherAdviser, "admin_student_detail", { p_student: w.econ }), null, "an adviser with no groups sees nobody");
  assert.ok(await rpc(w.admin, "admin_student_detail", { p_student: w.chem }), "the careers admin sees everyone who shares");
  const keys = async (uid: string) => (await rpc<{ rows: { key: string }[] }>(uid, "admin_students", { p_limit: 500 })).rows.map((r) => r.key);
  assert.deepEqual(await keys(w.adviser), [w.econ]);
  assert.deepEqual(await keys(w.otherAdviser), []);
  assert.deepEqual((await keys(w.admin)).sort(), [w.econ, w.chem].sort());
  assert.equal(await rpc(w.adviser, "admin_record_disagreement", { p_report: w.chemReport, p_target_kind: "score", p_target_key: "", p_rationale: "A long enough reason." }), null);
  await assert.rejects(rpc(w.adviser, "admin_add_note", { p_report: w.chemReport, p_note: "hello there" }), /report not found/);

  await rpc(w.admin, "admin_save_institution_settings", { p_brand_name: null, p_brand_colour: null, p_welcome: null, p_adviser_scope: "all" });
  assert.ok(await rpc(w.otherAdviser, "admin_student_detail", { p_student: w.chem }), "policy all");
  await rpc(w.admin, "admin_save_institution_settings", { p_brand_name: null, p_brand_colour: null, p_welcome: null, p_adviser_scope: "assigned" });
  assert.equal(await rpc(w.otherAdviser, "admin_student_detail", { p_student: w.chem }), null, "and back, on the next call");
  assert.ok(!(await keys(w.southAdviser)).includes(w.econ));
});

test("database: revocation, of consent, of a group or of the role, applies to the very next access", async () => {
  // Consent to sharing.
  const referral = (await rpc<string>(w.adviser, "admin_create_referral", { p_student: w.econ, p_report: w.econReport, p_contact: null, p_target: "Disability service", p_reason: "A long enough reason.", p_owner: null }))!;
  assert.ok(await rpc(w.adviser, "admin_student_detail", { p_student: w.econ }));
  await as(w.econ, `update public.profiles set share_progress = false where id = $1`, [w.econ]);
  assert.equal(await rpc(w.adviser, "admin_student_detail", { p_student: w.econ }), null);
  assert.equal(await rpc(w.admin, "admin_student_detail", { p_student: w.econ }), null);
  assert.equal(await rpc(w.adviser, "admin_update_referral", { p_id: referral, p_status: "withdrawn", p_owner: null, p_note: null }), null);
  await assert.rejects(rpc(w.adviser, "admin_add_note", { p_report: w.econReport, p_note: "hello there" }), /report not found/);
  const queue = await rpc<{ hidden: number; referrals: unknown[] }>(w.adviser, "admin_casework");
  assert.ok(queue.hidden >= 1);
  assert.equal(queue.referrals.length, 0);
  assert.ok(!(await rpc<{ rows: { key: string }[] }>(w.admin, "admin_students", { p_limit: 500 })).rows.some((r) => r.key === w.econ), "and the list, which is what the export reads");
  const logged = await rpc<{ student: string | null }[]>(w.admin, "admin_access_log", { p_limit: 500 });
  assert.ok(logged.every((e) => e.student !== "N1"), "the log doesn't become a way round withdrawn consent");
  assert.ok(logged.some((e) => e.student === "Not sharing"));
  assert.ok((await rpc<{ referrals: unknown[] }>(w.econ, "my_casework")).referrals.length >= 1, "the student still has their own record");
  await as(w.econ, `update public.profiles set share_progress = true where id = $1`, [w.econ]);
  assert.ok(await rpc(w.adviser, "admin_student_detail", { p_student: w.econ }));

  // CV consent, on top of sharing.
  assert.equal(await rpc(w.adviser, "admin_cv_path", { p_report: w.econReport }), null);
  await as(w.econ, `update public.profiles set adviser_can_view_cv = true where id = $1`, [w.econ]);
  assert.equal(await rpc(w.adviser, "admin_cv_path", { p_report: w.econReport }), `${w.econ}/a/cv.pdf`);
  await as(w.econ, `update public.profiles set adviser_can_view_cv = false where id = $1`, [w.econ]);
  assert.equal(await rpc(w.adviser, "admin_cv_path", { p_report: w.econReport }), null);

  // The group changes under them, or the record changes the student out of it.
  await q(`update public.profiles set faculty = 'Sciences' where id = $1`, [w.econ]);
  assert.equal(await rpc(w.adviser, "admin_student_detail", { p_student: w.econ }), null, "membership follows the imported record");
  await q(`update public.profiles set faculty = 'Social sciences' where id = $1`, [w.econ]);
  await rpc(w.admin, "admin_set_adviser_groups", { p_adviser: w.adviser, p_groups: [] });
  assert.equal(await rpc(w.adviser, "admin_student_detail", { p_student: w.econ }), null);
  await rpc(w.admin, "admin_set_adviser_groups", { p_adviser: w.adviser, p_groups: [w.group] });

  // The role.
  await rpc(w.admin, "admin_set_adviser", { p_email: "priya@northfield.ac.uk", p_adviser: false });
  await assert.rejects(rpc(w.adviser, "admin_student_detail", { p_student: w.econ }), /careers staff only/);
  assert.equal((await q(`select count(*)::int as n from public.adviser_group_assignments where adviser_id = $1`, [w.adviser]) as { n: number }[])[0].n, 0, "their groups go with it");
  await rpc(w.admin, "admin_set_adviser", { p_email: "priya@northfield.ac.uk", p_adviser: true });
  assert.equal(await rpc(w.adviser, "admin_student_detail", { p_student: w.econ }), null, "a re-appointment starts from nothing");
  await rpc(w.admin, "admin_set_adviser_groups", { p_adviser: w.adviser, p_groups: [w.group] });
  await rpc(w.admin, "admin_update_referral", { p_id: referral, p_status: "withdrawn", p_owner: null, p_note: null });
});

test("database: a disagreement is attributed, carries its rationale, and rewrites nothing, not even by the owner of the database", async () => {
  const before = await reportRow(w.econReport);
  const id = (await rpc<string>(w.adviser, "admin_record_disagreement", { p_report: w.econReport, p_target_kind: "check", p_target_key: "numbers", p_rationale: "The numbers are in a table the reader missed." }))!;
  const row = (await q<{ author_id: string; author_name: string; author_role: string; rationale: string; judgment_snapshot: { score: number; name: string; reportScore: number; scoring: string } }>(`select * from public.adviser_disagreements where id = $1`, [id]))[0];
  assert.equal(row.author_id, w.adviser);
  assert.equal(row.author_name, "Priya Adviser");
  assert.equal(row.author_role, "adviser");
  assert.equal(row.judgment_snapshot.score, 4);
  assert.equal(row.judgment_snapshot.name, "Numbers");
  assert.equal(row.judgment_snapshot.reportScore, 62);
  assert.equal(row.judgment_snapshot.scoring, "series-1");
  assert.equal(await reportRow(w.econReport), before, "the report is byte-identical");

  for (const [col, val] of [["rationale", "'changed'"], ["judgment_snapshot", `'{"score": 9}'`], ["author_name", "'someone else'"], ["author_id", `'${w.admin}'`], ["created_at", "now() + interval '1 day'"]] as const) {
    await assert.rejects(q(`update public.adviser_disagreements set ${col} = ${val} where id = '${id}'`), /append-only/, `owner updating ${col}`);
  }
  await assert.rejects(asRole("service_role", null, () => q(`update public.adviser_disagreements set rationale = 'x' where id = '${id}'`)), /permission denied/);

  await assert.rejects(rpc(w.adviser, "admin_record_disagreement", { p_report: w.econReport, p_target_kind: "score", p_target_key: "", p_rationale: "short" }), /rationale required/);
  await assert.rejects(rpc(w.adviser, "admin_record_disagreement", { p_report: w.econReport, p_target_kind: "check", p_target_key: "invented", p_rationale: "A long enough reason." }), /unknown part/);
  await assert.rejects(rpc(w.adviser, "admin_record_disagreement", { p_report: w.econReport, p_target_kind: "weights", p_target_key: "", p_rationale: "A long enough reason." }), /unknown part/);
  assert.equal(await rpc(w.adviser, "admin_record_disagreement", { p_report: w.econLinkedIn, p_target_kind: "score", p_target_key: "", p_rationale: "A long enough reason." }), null, "CV reviews only");

  // If the report changes later, the record of what it said doesn't.
  await q(`update public.reports set score = 90, payload = jsonb_set(payload, '{analysis,score}', '90') where id = $1`, [w.econReport]);
  assert.equal((await q<{ s: { reportScore: number } }>(`select judgment_snapshot as s from public.adviser_disagreements where id = $1`, [id]))[0].s.reportScore, 62);
  await q(`update public.reports set score = 62, payload = $2 where id = $1`, [w.econReport, JSON.stringify(reportPayload)]);
  const restored = await reportRow(w.econReport);

  // A change of mind is another row, and only the author or an admin can make it.
  assert.equal(await rpc(w.otherAdviser, "admin_withdraw_disagreement", { p_id: id, p_reason: "A long enough reason." }), null);
  const withdrawal = (await rpc<string>(w.adviser, "admin_withdraw_disagreement", { p_id: id, p_reason: "On a second read, the reader was right." }))!;
  assert.notEqual(withdrawal, id);
  assert.equal((await q<{ n: number }>(`select count(*)::int as n from public.adviser_disagreements where id = $1 and rationale like 'The numbers%'`, [id]))[0].n, 1, "the original is still there");
  await assert.rejects(rpc(w.admin, "admin_withdraw_disagreement", { p_id: id, p_reason: "A long enough reason." }), /already withdrawn/);
  const mine = await rpc<{ disagreements: { id: string; kind: string; author: string }[] }>(w.econ, "my_casework");
  assert.ok(mine.disagreements.some((d) => d.id === id && d.author === "Priya Adviser"));
  assert.ok(mine.disagreements.some((d) => d.kind === "withdrawal"));
  assert.equal((await rpc<{ disagreements: unknown[] }>(w.chem, "my_casework")).disagreements.length, 0, "another student sees none of it");
  assert.equal(await reportRow(w.econReport), restored, "nor did withdrawing touch the report");
});

test("database: a referral's workflow, who may take each step, and the history behind it", async () => {
  const r = (await rpc<string>(w.adviser, "admin_create_referral", { p_student: w.econ, p_report: w.econReport, p_contact: null, p_target: "Employer mentoring", p_reason: "Would help with sector knowledge.", p_owner: null }))!;
  const row = async () => (await q<{ status: string; owner_id: string; owner_name: string }>(`select * from public.adviser_referrals where id = $1`, [r]))[0];
  assert.equal((await row()).status, "proposed");
  assert.equal((await row()).owner_id, w.adviser, "the proposer owns it by default");

  assert.equal(await rpc(w.otherAdviser, "admin_update_referral", { p_id: r, p_status: "withdrawn", p_owner: null, p_note: null }), null, "not their referral");
  await assert.rejects(rpc(w.adviser, "admin_update_referral", { p_id: r, p_status: "accepted", p_owner: null, p_note: null }), /isn't possible/, "accepting is the student's");
  await assert.rejects(rpc(w.adviser, "admin_update_referral", { p_id: r, p_status: "in_progress", p_owner: null, p_note: null }), /isn't possible/, "and nothing starts until they have");
  await assert.rejects(rpc(w.adviser, "admin_update_referral", { p_id: r, p_status: null, p_owner: w.otherAdviser, p_note: null }), /can't take this on/, "handing to someone who can't see the student");
  assert.equal(await rpc(w.chem, "respond_to_referral", { p_id: r, p_accept: true }), false, "another student");
  assert.equal(await rpc(w.south, "respond_to_referral", { p_id: r, p_accept: true }), false, "another university's student");

  assert.equal(await rpc(w.econ, "respond_to_referral", { p_id: r, p_accept: true }), true);
  assert.equal((await row()).status, "accepted");
  assert.equal(await rpc(w.econ, "respond_to_referral", { p_id: r, p_accept: false }), false, "an answer isn't changed once given");
  assert.equal(await rpc(w.adviser, "admin_update_referral", { p_id: r, p_status: "in_progress", p_owner: null, p_note: "First session booked." }), true);
  assert.equal(await rpc(w.admin, "admin_update_referral", { p_id: r, p_status: null, p_owner: w.admin, p_note: null }), true, "a careers admin can take it over");
  assert.equal((await row()).owner_name, "Sam Admin");
  assert.equal(await rpc(w.adviser, "admin_update_referral", { p_id: r, p_status: "closed", p_owner: null, p_note: null }), null, "and the old owner can't act on it now");
  assert.equal(await rpc(w.admin, "admin_update_referral", { p_id: r, p_status: "closed", p_owner: null, p_note: null }), true);
  await assert.rejects(rpc(w.admin, "admin_update_referral", { p_id: r, p_status: "in_progress", p_owner: null, p_note: null }), /isn't possible/, "closed stays closed");

  const events = await q<{ actor_name: string; actor_kind: string; to_status: string }>(`select * from public.adviser_referral_events where referral_id = $1 order by id`, [r]);
  assert.deepEqual(events.map((e) => [e.actor_name, e.actor_kind, e.to_status]), [
    ["Priya Adviser", "staff", "proposed"],
    ["Econ Student", "student", "accepted"],
    ["Priya Adviser", "staff", "in_progress"],
    ["Sam Admin", "staff", "in_progress"],
    ["Sam Admin", "staff", "closed"],
  ]);
  await assert.rejects(q(`update public.adviser_referral_events set note = 'x' where referral_id = '${r}'`), /append-only/);
});

test("database: the trail records real access durably, can't be rewritten, and says nothing about where anyone was", async () => {
  await q(`update public.profiles set adviser_can_view_cv = true where id = $1`, [w.econ]);
  const before = await logCount(`actor_id = $1 and action = 'open_cv' and outcome = 'granted' and student_id = $2 and report_id = $3`, [w.adviser, w.econ, w.econReport]);
  await rpc(w.adviser, "admin_cv_path", { p_report: w.econReport });
  assert.equal(await logCount(`actor_id = $1 and action = 'open_cv' and outcome = 'granted' and student_id = $2 and report_id = $3`, [w.adviser, w.econ, w.econReport]), before + 1);
  await q(`update public.profiles set adviser_can_view_cv = false where id = $1`, [w.econ]);
  const refused = await logCount(`actor_id = $1 and action = 'open_cv' and outcome = 'denied'`, [w.adviser]);
  await rpc(w.adviser, "admin_cv_path", { p_report: w.econReport });
  assert.equal(await logCount(`actor_id = $1 and action = 'open_cv' and outcome = 'denied'`, [w.adviser]), refused + 1, "a refusal is logged too");

  const views = await logCount(`actor_id = $1 and action = 'view_student' and outcome = 'granted'`, [w.adviser]);
  await rpc(w.adviser, "admin_student_detail", { p_student: w.econ });
  assert.equal(await logCount(`actor_id = $1 and action = 'view_student' and outcome = 'granted'`, [w.adviser]), views + 1);

  const id = (await q<{ id: number }>(`select id from public.staff_access_log where actor_id = $1 limit 1`, [w.adviser]))[0].id;
  for (const [col, val] of [["action", "'add_note'"], ["actor_name", "'x'"], ["outcome", "'denied'"], ["at", "now()"], ["detail", "'{}'::jsonb || '{\"x\":1}'"]] as const) {
    await assert.rejects(q(`update public.staff_access_log set ${col} = ${val} where id = ${id}`), /append-only/, col);
  }
  await assert.rejects(asRole("service_role", null, () => q(`update public.staff_access_log set actor_name = 'x' where id = ${id}`)), /permission denied/);
  const cols = (await q<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'staff_access_log'`)).map((c) => c.column_name);
  for (const c of cols) assert.doesNotMatch(c, /ip|agent|browser|location/i);

  const mine = await rpc<{ access: { actor: string; action: string }[] }>(w.econ, "my_casework");
  assert.ok(mine.access.some((a) => a.action === "open_cv" && a.actor === "Priya Adviser"), "the student can see it");
  assert.equal((await rpc<{ access: unknown[] }>(w.south, "my_casework")).access.length, 0);
  assert.ok((await rpc<unknown[]>(w.admin, "admin_access_log", { p_limit: 500 })).length > 0);
  assert.ok((await rpc<{ actor: string }[]>(w.southAdmin, "admin_access_log", { p_limit: 500 })).every((e) => !/Priya|Sam Admin/.test(e.actor)), "another university's log is theirs alone");

  await rpc(w.admin, "admin_record_export", { p_kind: "export_students", p_rows: 7, p_detail: { q: "N1", search: "N1", filter: "all" } });
  const exp = (await q<{ detail: Record<string, unknown> }>(`select detail from public.staff_access_log where action = 'export_students' order by id desc limit 1`))[0].detail;
  assert.deepEqual(exp, { rows: 7, filter: "all" }, "search text can be a student number, so it isn't kept");

  const victim = await newUser("gone@northfield.ac.uk", "student", { faculty: "Social sciences" });
  const report = await newReport(victim);
  await rpc(w.adviser, "admin_student_detail", { p_student: victim });
  await rpc(w.adviser, "admin_add_note", { p_report: report, p_note: "hello there" });
  await rpc(w.adviser, "admin_record_disagreement", { p_report: report, p_target_kind: "score", p_target_key: "", p_rationale: "A long enough reason." });
  await q(`delete from auth.users where id = $1`, [victim]);
  assert.equal((await q<{ n: number }>(`select count(*)::int as n from public.adviser_disagreements where student_id = $1`, [victim]))[0].n, 0, "deleting an account takes the casework");
  assert.equal(await logCount(`student_id = $1`, [victim]), 0, "and unties the trail from them");
  assert.ok((await rpc<{ studentGone: boolean; actor: string }[]>(w.admin, "admin_access_log", { p_limit: 500 })).some((e) => e.studentGone && e.actor === "Priya Adviser"), "without losing who looked");

  const leaver = await newUser("leaver@northfield.ac.uk", "adviser", { name: "Leaver" });
  await rpc(w.admin, "admin_save_institution_settings", { p_brand_name: null, p_brand_colour: null, p_welcome: null, p_adviser_scope: "all" });
  await rpc(leaver, "admin_student_detail", { p_student: w.chem });
  const d = (await rpc<string>(leaver, "admin_record_disagreement", { p_report: w.chemReport, p_target_kind: "score", p_target_key: "", p_rationale: "A long enough reason." }))!;
  await rpc(w.admin, "admin_save_institution_settings", { p_brand_name: null, p_brand_colour: null, p_welcome: null, p_adviser_scope: "assigned" });
  await q(`delete from auth.users where id = $1`, [leaver]);
  const kept = (await q<{ author_id: string | null; author_name: string }>(`select author_id, author_name from public.adviser_disagreements where id = $1`, [d]))[0];
  assert.deepEqual(kept, { author_id: null, author_name: "Leaver" }, "a member of staff leaving keeps their name on what they wrote");
});

test("database: staff see scores, never document text; notes are refused on anything but a CV review", async () => {
  await rpc(w.admin, "admin_add_note", { p_report: w.econReport, p_note: "On a CV review." });
  const detail = JSON.stringify(await rpc(w.admin, "admin_student_detail", { p_student: w.econ }));
  assert.doesNotMatch(detail, /SECRET/, "no summary, detail, extras, lines or text");
  assert.match(detail, /"numbers"/, "but the check's name and score, so a disagreement can name it");
  assert.doesNotMatch(detail, new RegExp(w.econLinkedIn), "and only CV reviews are listed");
  await assert.rejects(rpc(w.admin, "admin_add_note", { p_report: w.econLinkedIn, p_note: "On a LinkedIn report." }), /report not found/, "OP-018's question");
  assert.equal(await rpc(w.admin, "admin_cv_path", { p_report: w.econLinkedIn }), null);
});

test("database: careers admins can stop report links, and nothing lets them start them", async () => {
  await q(`update public.universities set report_sharing_enabled = true where id = $1`, [w.southUni]);
  await assert.rejects(rpc(w.southAdviser, "admin_stop_report_sharing"), /admins only/);
  await rpc(w.southAdmin, "admin_stop_report_sharing");
  await rpc(w.southAdmin, "admin_stop_report_sharing"); // Twice: it only ever stops, so it can't double as a way to start.
  assert.equal((await q<{ on: boolean }>(`select report_sharing_enabled as on from public.universities where id = $1`, [w.southUni]))[0].on, false);
  assert.equal((await q<{ on: boolean }>(`select report_sharing_enabled as on from public.universities where id = $1`, [w.northUni]))[0].on, false);
  const fns = (await q<{ proname: string; src: string }>(`select proname, prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and prosrc ~ 'report_sharing_enabled\\s*=\\s*true'`)).map((f) => f.proname);
  assert.deepEqual(fns, [], "no function sets it to true");
  // Directly: refused, or row-level security finds no row to change. Either way it stays off.
  await as(w.southAdmin, `update public.universities set report_sharing_enabled = true where id = '${w.southUni}'`).catch(() => null);
  assert.equal((await q<{ on: boolean }>(`select report_sharing_enabled as on from public.universities where id = $1`, [w.southUni]))[0].on, false);
  assert.ok(await logCount(`university_id = $1 and action = 'change_configuration' and detail ->> 'what' = 'report_sharing'`, [w.southUni]));
});

test("database: an invitation becomes the right role, and only that one, on first sign-in", async () => {
  await rpc(w.admin, "admin_set_adviser", { p_email: "new.adviser@northfield.ac.uk", p_adviser: true });
  const team = await rpc<{ pending: { email: string }[] }>(w.admin, "admin_list_team");
  assert.ok(!team.pending.some((p) => p.email === "new.adviser@northfield.ac.uk"), "not listed as an admin invitation");
  const id = (await q<{ id: string }>(`insert into auth.users (email) values ('new.adviser@northfield.ac.uk') returning id`))[0].id;
  assert.equal((await q<{ role: string }>(`select role from public.profiles where id = $1`, [id]))[0].role, "adviser");
  await assert.rejects(rpc(w.admin, "admin_set_adviser", { p_email: "sam@northfield.ac.uk", p_adviser: true }), /already a careers admin/, "can't demote an admin this way");
  await rpc(w.admin, "admin_set_role", { p_email: "new.adviser@northfield.ac.uk", p_admin: false });
  assert.equal((await q<{ role: string }>(`select role from public.profiles where id = $1`, [id]))[0].role, "adviser", "removing admin rights doesn't touch an adviser");
  await assert.rejects(as(id, `update public.profiles set role = 'admin' where id = '${id}'`), /permission denied/, "and nobody changes their own role");
});

/* ---------- repository and action-flow boundary, on the real SQL ---------- */

test("repository: a two-university journey through supabaseRepo and the flows, under each user's own session", async () => {
  const admin = repoFor(w.admin);
  const southAdmin = repoFor(w.southAdmin);
  const adviser = repoFor(w.adviser);
  const student = repoFor(w.econ);
  const stranger = repoFor(w.south);

  assert.deepEqual(await saveSettingsFlow(admin, { brandName: "Northfield Careers", brandColour: "#36604E", welcome: "Welcome.", adviserScope: "assigned" }), {});
  const contact = (await saveContactFlow(admin, { label: "Mentoring team", purpose: "Mentors", email: "m@northfield.ac.uk", phone: null, url: null, hours: null })).id!;
  const group = (await saveGroupFlow(admin, { name: "Sciences", faculties: ["Sciences"], courses: [] })).id!;
  await saveResourceFlow(admin, { title: "Sciences guide", url: "https://north.example/sci", description: "", groupId: group, active: true });
  await saveResourceFlow(admin, { title: "Everyone guide", url: "https://north.example/all", description: "", groupId: null, active: true });

  assert.deepEqual((await student.myInstitution())!.resources.map((r) => r.title).sort(), ["Everyone guide", "North guide"], "a resource for another group is hidden");
  assert.deepEqual((await repoFor(w.chem).myInstitution())!.resources.map((r) => r.title).sort(), ["Everyone guide", "Sciences guide"]);
  assert.equal((await student.myInstitution())!.brandName, "Northfield Careers");
  assert.equal((await stranger.myInstitution())!.brandName, null);

  assert.deepEqual(await saveSettingsFlow(adviser, { brandName: "Mine", brandColour: null, welcome: null, adviserScope: "all" }), { error: "Only careers admins can do this." });
  assert.deepEqual(await stopSharingFlow(student), { error: "Only careers admins can do this." });
  assert.deepEqual(await setAdviserFlow(adviser, "x@northfield.ac.uk", true), { error: "Only careers admins can do this." });
  assert.deepEqual(await setAdviserGroupsFlow(southAdmin, w.adviser, []), { error: "You don't have access to that student or record." });

  const created = await createReferralFlow(adviser, { studentKey: w.econ, reportId: w.econReport, contactId: contact, target: "", reason: "Would help with sector knowledge.", ownerId: null });
  assert.ok(created.id);
  assert.deepEqual(await createReferralFlow(southAdmin, { studentKey: w.econ, reportId: null, contactId: null, target: "Elsewhere", reason: "A long enough reason.", ownerId: null }), { error: "You don't have access to that student or record." });
  assert.deepEqual(await createReferralFlow(student, { studentKey: w.econ, reportId: null, contactId: null, target: "Elsewhere", reason: "A long enough reason.", ownerId: null }), { error: "Only careers staff can do this." });
  assert.ok((await createReferralFlow(adviser, { studentKey: "not-a-uuid", reportId: null, contactId: null, target: "Elsewhere", reason: "A long enough reason.", ownerId: null })).error, "a malformed id doesn't reach the database");

  assert.equal((await student.myCaseworkUnseen()) > 0, true);
  const seenBefore = await student.myCasework();
  const mine = seenBefore.referrals.find((r) => r.id === created.id)!;
  assert.equal(mine.target, "Mentoring team");
  assert.equal(mine.owner, "Priya Adviser");
  await student.markCaseworkSeen();
  assert.equal(await student.myCaseworkUnseen(), 0, "the in-app notice clears when they've looked");
  assert.deepEqual(await respondToReferralFlow(stranger, created.id!, true), { error: "That referral isn't waiting for an answer." });
  assert.deepEqual(await respondToReferralFlow(student, created.id!, true), {});
  assert.ok((await updateReferralFlow(adviser, { id: created.id!, status: "accepted" as never, ownerId: null, note: null })).error);
  assert.deepEqual(await updateReferralFlow(adviser, { id: created.id!, status: "in_progress", ownerId: null, note: null }), {});
  assert.deepEqual(await updateReferralFlow(southAdmin, { id: created.id!, status: "closed", ownerId: null, note: null }), { error: "You don't have access to that student or record." });
  assert.equal((await adviser.adminCasework()).referrals.some((r) => r.id === created.id && r.mine), true);

  const before = await reportRow(w.econReport);
  const d = await recordDisagreementFlow(adviser, { reportId: w.econReport, targetKind: "area", targetKey: "impact", rationale: "The impact is clear to a reader in this sector." });
  assert.ok(d.id);
  assert.ok((await recordDisagreementFlow(adviser, { reportId: w.econReport, targetKind: "area", targetKey: "invented", rationale: "A long enough reason." })).error);
  assert.deepEqual(await recordDisagreementFlow(repoFor(w.southAdviser), { reportId: w.econReport, targetKind: "score", targetKey: "", rationale: "A long enough reason." }), { error: "You don't have access to that student or record." });
  assert.deepEqual(await withdrawDisagreementFlow(repoFor(w.otherAdviser), d.id!, "A long enough reason."), { error: "You don't have access to that student or record." });
  assert.equal(await reportRow(w.econReport), before);

  const detail = (await adviser.adminStudentDetail(w.econ))!;
  assert.ok(detail.disagreements!.some((x) => x.id === d.id));
  assert.ok(detail.referrals!.some((x) => x.id === created.id));
  assert.equal(await adviser.adminStudentDetail(w.chem), null);
  assert.equal(await southAdmin.adminStudentDetail(w.econ), null);
  await assert.rejects(adviser.adminAccessLog(), /admins only/);
  await assert.rejects(adviser.adminRecordExport("export_students", 1), /admins only/);
  await assert.rejects(adviser.institutionConfig(), /admins only/);
});

test("repository: with ADVISER_CV_ACCESS off, a CV link isn't even asked for, and nothing is logged", async () => {
  assert.notEqual(process.env.ADVISER_CV_ACCESS, "true");
  await q(`update public.profiles set adviser_can_view_cv = true where id = $1`, [w.econ]);
  const before = await logCount(`action = 'open_cv'`);
  assert.equal(await repoFor(w.admin).adminCvLink(w.econReport), null);
  assert.equal(await logCount(`action = 'open_cv'`), before);
  await q(`update public.profiles set adviser_can_view_cv = false where id = $1`, [w.econ]);
});

test("the permissions table matches the database: nothing it says an adviser can't do can be done, or the other way round", async () => {
  const probe: Record<string, (uid: string) => Promise<unknown>> = {
    dashboard: (u) => rpc(u, "admin_analytics", { p_period: "all" }),
    export: (u) => rpc(u, "admin_record_export", { p_kind: "export_outcomes", p_rows: 0 }),
    access_log: (u) => rpc(u, "admin_access_log"),
    config: (u) => rpc(u, "admin_institution_config"),
    team: (u) => rpc(u, "admin_list_advisers"),
    import: (u) => rpc(u, "admin_import_students", { p_rows: "[]" }),
    student_list: (u) => rpc(u, "admin_students"),
    scores: (u) => rpc(u, "admin_student_detail", { p_student: w.econ }),
    notes: (u) => rpc(u, "admin_add_note", { p_report: w.econReport, p_note: "A probe note." }),
    disagree: (u) => rpc(u, "admin_record_disagreement", { p_report: w.econReport, p_target_kind: "score", p_target_key: "", p_rationale: "A long enough reason." }),
    refer: (u) => rpc(u, "admin_casework"),
  };
  for (const p of PERMISSIONS) {
    const run = probe[p.key];
    if (!run) continue;
    for (const [role, uid] of [["adviser", w.adviser], ["admin", w.admin]] as const) {
      if (p[role] === "no") await assert.rejects(run(uid), /admins only|careers staff only/, `${p.key} for ${role}`);
      else await assert.doesNotReject(run(uid), `${p.key} for ${role}`);
    }
  }
  const covered = Object.keys(probe);
  for (const key of covered) assert.ok(PERMISSIONS.some((p) => p.key === key), key);
});

test("nothing in the migration can write to a report, a score series or the judgment cache", () => {
  const sql = fs.readFileSync("supabase/migrations/20261107230000_institution_adviser_work.sql", "utf8").replace(/--.*$/gm, "");
  assert.doesNotMatch(sql, /(update|insert\s+into|delete\s+from)\s+public\.(reports|judgment_cache|cv_sources)\b/i);
  assert.doesNotMatch(sql, /alter\s+table\s+public\.reports/i);
  for (const t of ["institution_settings", "programme_groups", "institution_resources", "institution_contacts", "adviser_group_assignments"]) {
    const body = sql.slice(sql.indexOf(`create table public.${t} (`));
    const def = body.slice(0, body.indexOf(");\n"));
    assert.doesNotMatch(def, /\b(score|weight|threshold|rubric|band|scoring)\w*\b/i, t);
  }
});
