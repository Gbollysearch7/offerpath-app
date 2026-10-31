// Live test against a real Supabase project (staging, never production with students on it).
// Creates a test university and three test users, drives the app in Chrome, checks the database directly,
// then deletes everything it created. Needs the app running against that project:
//   npm run dev -- -p 3100      then      npm run test:live
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(path.join(process.cwd(), "package.json"));
const { createClient } = require("@supabase/supabase-js");
const { createServerClient } = require("@supabase/ssr");
const { chromium } = require("playwright-core");

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3100").replace(/\/+$/, "");
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const CV = process.argv[2] || path.join(process.cwd(), "tests/fixtures/cv.pdf");
const DOMAIN = "levelup-live-suite.ac.uk"; // its own domain, so a manual test account can never collide with it

const results = [];
const ok = (m) => { results.push(["PASS", m]); console.log("PASS", m); };
const fail = (m) => { results.push(["FAIL", m]); console.log("FAIL", m); };
const check = (cond, m, detail = "") => (cond ? ok(m) : fail(`${m}${detail ? ` (${detail})` : ""}`));

// A real session, exactly what clicking the email link produces, as browser cookies.
async function sessionCookies(email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const jar = new Map();
  const sb = createServerClient(URL_, ANON, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach((c) => jar.set(c.name, c.value)) } });
  const { data: s, error: e2 } = await sb.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "magiclink" });
  if (e2) throw e2;
  return { cookies: [...jar].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })), token: s.session.access_token };
}
const asUser = (token) => createClient(URL_, ANON, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });

let uniId;
const users = {};
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  // Setup
  const { data: uni, error: ue } = await admin.from("universities").insert({ name: "LevelUp QA University", domain: DOMAIN }).select().single();
  if (ue) throw ue;
  uniId = uni.id;

  // 1. Only partner domains can create accounts (database trigger).
  const { error: outsider } = await admin.auth.admin.createUser({ email: `qa-outsider-${Date.now()}@gmail.com`, email_confirm: true });
  check(!!outsider, "an email from a non-partner domain can't create an account");

  for (const k of ["s1", "s2", "adm"]) {
    const { data, error } = await admin.auth.admin.createUser({ email: `qa-${k}@${DOMAIN}`, email_confirm: true });
    if (error) throw error;
    users[k] = data.user;
  }
  const { data: p1 } = await admin.from("profiles").select("university_id, role").eq("id", users.s1.id).single();
  check(p1?.university_id === uniId && p1?.role === "student", "new accounts get a profile linked to their university");
  await admin.from("profiles").update({ role: "admin" }).eq("id", users.adm.id);

  // 2. Sign-in page refuses non-partner emails (server check before any email is sent).
  {
    const page = await browser.newPage();
    await page.goto(`${BASE}/sign-in`, { waitUntil: "networkidle" });
    await page.getByLabel(/email/i).first().fill("someone@gmail.com");
    await page.getByRole("button", { name: /email me a link|send|continue/i }).first().click();
    await page.waitForTimeout(2500);
    check(/partner universities/i.test(await page.textContent("body")), "sign-in page refuses a non-partner email");
    await page.close();
  }

  // 3. Student 1: onboarding, upload, score, re-upload gives the same score.
  const s1 = await sessionCookies(users.s1.email);
  const ctx = await browser.newContext();
  await ctx.addCookies(s1.cookies);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${BASE}/onboarding`, { waitUntil: "networkidle" });
  check(new URL(page.url()).pathname === "/onboarding", "signed-in new student lands on onboarding", page.url());
  await page.getByRole("button", { name: "Continue" }).click();
  // No sector is chosen for the student: Continue asks for one first.
  await page.getByRole("button", { name: "Continue" }).click();
  check(await page.getByText("Pick at least one sector.").isVisible(), "onboarding doesn't pick sectors for the student");
  await page.getByRole("button", { name: "Technology" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Upload my CV/ }).click();
  await page.waitForURL((u) => u.pathname !== "/onboarding", { timeout: 15000 }).catch(() => {});
  const { data: p1b } = await admin.from("profiles").select("onboarded_at, sectors").eq("id", users.s1.id).single();
  check(!!p1b?.onboarded_at && p1b.sectors.length > 0, "onboarding answers are saved to the database", JSON.stringify(p1b));

  async function upload(sector) {
    await page.goto(`${BASE}/upload`, { waitUntil: "networkidle" });
    await page.setInputFiles("#cv-file", CV);
    if (sector) await page.locator("select").first().selectOption(sector);
    await page.getByRole("button", { name: "Score my CV" }).click();
    await page.waitForURL(/\/reviews\/[0-9a-f-]{36}/, { timeout: 90000 });
    return page.url().split("/reviews/")[1].split(/[?#]/)[0];
  }
  const r1 = await upload();
  const r2 = await upload("Consulting"); // another sector: only sector fit may change, never the score
  const { data: reps } = await admin.from("reports").select("id, score, storage_path, user_id").in("id", [r1, r2]);
  const a = reps.find((r) => r.id === r1), b = reps.find((r) => r.id === r2);
  check(reps.length === 2 && a.user_id === users.s1.id, "both uploads are saved as reports for the student");
  check(a.score != null && a.score === b.score, "re-uploading the same CV, even for another sector, gives the same score", `${a?.score} vs ${b?.score}`);
  const body = await page.textContent("body");
  check(body.includes(String(b.score)), "the score is shown on the review page");
  const { data: files } = await admin.storage.from("cvs").list(users.s1.id, { limit: 100 });
  check(!!a.storage_path && (files?.length ?? 0) > 0, "the CV file is stored in the private bucket", `${a.storage_path}, ${files?.length} items`);

  // Data stays after reload / new visit.
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  check((await page.textContent("body")).includes(String(b.score)), "dashboard shows the saved score on a fresh page load");

  // Main student pages load without errors on the live database.
  for (const p of ["/dashboard", `/reviews/${r2}`, "/upload", "/practice", "/practice/interview", "/practice/aptitude", "/practice/roadmap", "/privacy", "/help"]) {
    const res = await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
    check(res.status() < 400, `student page ${p} loads`, `HTTP ${res.status()}`);
  }
  // Discover the other nav links and visit them too.
  const nav = await page.evaluate(() => [...new Set([...document.querySelectorAll("header a[href^='/']")].map((a) => a.getAttribute("href")))]);
  for (const p of nav.filter((h) => !/^\/(api|auth)/.test(h))) {
    const res = await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
    check(res.status() < 400, `student nav page ${p} loads`, `HTTP ${res.status()}`);
  }
  check(errors.filter((e) => !/Download the React DevTools|\[Fast Refresh\]|HMR/.test(e)).length === 0, "no console errors on student pages", errors.slice(0, 3).join(" / ").slice(0, 300));

  // 4. Student 2 can't see or change student 1's data (row-level security, using the public API directly).
  const s2 = await sessionCookies(users.s2.email);
  const c2 = asUser(s2.token);
  const { data: theirReports } = await c2.from("reports").select("id").eq("user_id", users.s1.id);
  check((theirReports ?? []).length === 0, "another student can't read someone else's reports");
  const { data: dl, error: dle } = await c2.storage.from("cvs").download(a.storage_path);
  check(!dl && !!dle, "another student can't download someone else's CV file");
  const { data: theirProfile } = await c2.from("profiles").select("email").eq("id", users.s1.id);
  check((theirProfile ?? []).length === 0, "another student can't read someone else's profile");
  const { error: roleErr } = await c2.from("profiles").update({ role: "admin" }).eq("id", users.s2.id);
  const { data: p2 } = await admin.from("profiles").select("role").eq("id", users.s2.id).single();
  check(!!roleErr && p2.role === "student", "a student can't make themselves an admin");
  const { error: scoreErr } = await asUser(s1.token).from("reports").update({ score: 100 }).eq("id", r1);
  const { data: r1after } = await admin.from("reports").select("score").eq("id", r1).single();
  check(r1after.score === a.score, "a student can't overwrite their own score through the API", scoreErr?.message ?? "no error");
  const { error: adminRpc } = await c2.rpc("admin_overview");
  check(!!adminRpc, "a student can't call admin reporting functions");
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: anonUnis } = await anon.from("universities").select("id");
  check((anonUnis ?? []).length === 0, "signed-out visitors can't read the universities list");
  const { error: anonRpc } = await anon.rpc("my_university");
  check(!!anonRpc, "signed-out visitors can't call helper functions");

  // Student 2 opens student 1's review URL in the app: must not see it.
  const ctx2 = await browser.newContext();
  await ctx2.addCookies(s2.cookies);
  const page2 = await ctx2.newPage();
  const res2 = await page2.goto(`${BASE}/reviews/${r1}`, { waitUntil: "networkidle" });
  const t2 = await page2.textContent("body");
  check(res2.status() === 404 || /not found|couldn.t find/i.test(t2), "opening another student's review link shows not found", `HTTP ${res2.status()}`);

  // 5. Admin dashboard on live data.
  const ad = await sessionCookies(users.adm.email);
  const ctx3 = await browser.newContext();
  await ctx3.addCookies(ad.cookies);
  const page3 = await ctx3.newPage();
  const aerr = [];
  page3.on("pageerror", (e) => aerr.push(String(e)));
  for (const p of ["/admin", "/admin/students", "/admin/import", "/admin/team", "/admin/opportunities", "/admin/settings"]) {
    const res = await page3.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
    check(res.status() < 400 && new URL(page3.url()).pathname === p, `admin page ${p} loads`, `HTTP ${res.status()} at ${page3.url()}`);
  }
  await page3.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  check((await page3.textContent("body")).includes("LevelUp QA University"), "admin dashboard shows their university's name");
  check(aerr.length === 0, "no page errors on admin pages", aerr.join(" / ").slice(0, 300));
  // A student can't open admin pages.
  await page2.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  check(new URL(page2.url()).pathname !== "/admin", "a student is sent away from /admin", page2.url());

  // 6. Pilot request form saves to the database.
  {
    const pg = await browser.newPage();
    await pg.goto(`${BASE}/#pilot`, { waitUntil: "networkidle" });
    const stamp = `qa-pilot-${Date.now()}@${DOMAIN}`;
    await pg.locator("form input[name=name]").fill("QA Tester");
    await pg.locator("form input[name=university]").fill("LevelUp QA University");
    await pg.locator("form input[name=role]").fill("Head of Careers");
    await pg.locator("form input[name=email]").fill(stamp);
    await pg.locator("form:has(input[name=website]) button[type=submit]").click();
    await pg.waitForTimeout(3000);
    const { data: pr } = await admin.from("pilot_requests").select("id").eq("email", stamp);
    check((pr ?? []).length === 1, "pilot request form saves to the database");
    await admin.from("pilot_requests").delete().eq("email", stamp);
    await pg.close();
  }

  // 7. Deleting an account removes the profile, reports and CV files.
  await page.goto(`${BASE}/privacy`, { waitUntil: "networkidle" });
  await page.locator("summary", { hasText: "Delete my account" }).click();
  await page.fill("input[name=confirm]", "delete");
  await page.getByRole("button", { name: "Delete everything" }).click();
  await page.waitForURL(/error=confirm/, { timeout: 15000 });
  const { data: still } = await admin.from("profiles").select("id").eq("id", users.s1.id);
  check((still ?? []).length === 1, "deleting needs DELETE typed exactly (lowercase is refused)");
  await page.fill("input[name=confirm]", "DELETE");
  await page.getByRole("button", { name: "Delete everything" }).click();
  await page.waitForURL(/sign-in\?deleted=1/, { timeout: 30000 });
  ok("after deleting, the student is signed out and sent to sign-in");
  const { data: gone } = await admin.from("profiles").select("id").eq("id", users.s1.id);
  const { data: goneR } = await admin.from("reports").select("id").eq("user_id", users.s1.id);
  const { data: goneF } = await admin.storage.from("cvs").list(users.s1.id, { limit: 100 });
  check((gone ?? []).length === 0 && (goneR ?? []).length === 0, "deleting an account removes the profile and reports");
  check((goneF ?? []).length === 0, "deleting an account removes the stored CV files", `${goneF?.length} left`);
} catch (e) {
  fail(`script error: ${e.stack ?? e}`);
} finally {
  await browser.close();
  // Clean up everything this test created.
  for (const u of Object.values(users)) {
    const { data: f } = await admin.storage.from("cvs").list(u.id, { limit: 100 });
    for (const dir of f ?? []) {
      const { data: inner } = await admin.storage.from("cvs").list(`${u.id}/${dir.name}`, { limit: 100 });
      const paths = inner?.length ? inner.map((x) => `${u.id}/${dir.name}/${x.name}`) : [`${u.id}/${dir.name}`];
      await admin.storage.from("cvs").remove(paths);
    }
    await admin.auth.admin.deleteUser(u.id).catch(() => {});
  }
  if (uniId) await admin.from("universities").delete().eq("id", uniId);
  const failed = results.filter((r) => r[0] === "FAIL");
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `\nFAILED:\n  ${failed.map((f) => f[1]).join("\n  ")}` : ""}`);
  process.exit(failed.length ? 1 : 0);
}
