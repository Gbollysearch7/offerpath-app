// End-to-end smoke and accessibility test. Needs a running server in demo mode:
//   DEMO_MODE=true PORT=3100 npm start      then      npm run test:e2e
// Signs in as the demo student and the demo admin, follows every internal link, and on each page checks:
// the page loads, no console errors or CSP violations, no serious or critical axe (WCAG 2.2 AA) issues,
// and no horizontal scrolling at 375px.

import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const AXE = require("fs").readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = (process.env.E2E_BASE_URL || "http://localhost:3100").replace(/\/+$/, "");
const MAX_PAGES = 120;

// Links we don't crawl: downloads, API routes and anything that changes state on GET.
const SKIP = [/^\/api\//, /^\/admin\/export/, /\/cv\/[^/]+$/, /\/source\/file$/, /^\/auth\//];
// One visit per route shape (ids collapsed), so 40 checks pages don't mean 40 visits.
const shape = (path) => path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id").replace(/\/checks\/[^/]+$/, "/checks/:check").replace(/\/students\/\d+$/, "/students/:key");

const failures = [];
const notes = [];
const fail = (page, msg) => failures.push(`${page}: ${msg}`);

async function launch() {
  const channel = process.env.E2E_CHROME_PATH ? undefined : "chrome";
  return chromium.launch({ channel, executablePath: process.env.E2E_CHROME_PATH, headless: true });
}

async function audit(page, path, consoleErrors) {
  const res = await page.goto(BASE + path, { waitUntil: "networkidle" });
  const status = res?.status() ?? 0;
  if (status >= 400 && path !== "/this-page-does-not-exist") fail(path, `HTTP ${status}`);
  await page.waitForTimeout(150);
  // Let entrance animations finish so axe measures final colours.
  await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch {} }));
  await page.addScriptTag({ content: AXE });
  // At desktop, at 390px, and at 200% zoom (a 1280px window shows 640 CSS pixels). A table that scrolls only when narrow only fails when narrow.
  for (const [view, width, height] of [["desktop", 1280, 900], ["390px", 390, 844], ["200% zoom", 640, 450]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(80);
    await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch {} }));
    const result = await page.evaluate(async () =>
      axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] }),
    );
    for (const v of result.violations) {
      const where = v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ");
      const line = `axe ${v.impact} ${v.id} at ${view}: ${v.help} (${v.nodes.length}x) at ${where}`;
      if (v.impact === "serious" || v.impact === "critical") fail(path, line);
      else notes.push(`${path}: ${line}`);
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  // The browser logs the 404 itself when a page is meant to be missing.
  if (path === "/this-page-does-not-exist") consoleErrors.length = 0;
  if (consoleErrors.length) fail(path, `console: ${consoleErrors.splice(0).join(" / ").slice(0, 400)}`);
  // The "Skip to content" link needs exactly one main landmark to land on.
  const mains = await page.evaluate(() => ({ all: document.querySelectorAll("main").length, target: !!document.querySelector("main#main") }));
  if (mains.all !== 1 || !mains.target) fail(path, `expected one <main id="main">, found ${mains.all}${mains.target ? "" : " (none with id main)"}`);

  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(100);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) fail(path, `scrolls sideways by ${overflow}px at 375px`);
  await page.setViewportSize({ width: 1280, height: 900 });

  const links = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")));
  return links;
}

async function crawl(browser, label, start, signIn) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  await signIn(page);
  const seen = new Set();
  const queue = [...start];
  let visited = 0;
  while (queue.length && visited < MAX_PAGES) {
    const path = queue.shift();
    const key = shape(path);
    if (seen.has(key)) continue;
    seen.add(key);
    visited++;
    const links = await audit(page, path, consoleErrors);
    for (const href of links) {
      if (!href || href.startsWith("#") || href.startsWith("mailto:")) continue;
      const url = new URL(href, BASE + path);
      if (url.origin !== BASE) continue;
      const p = url.pathname + url.search;
      if (SKIP.some((r) => r.test(url.pathname))) continue;
      if (/format=|download/.test(url.search)) continue;
      if (!seen.has(shape(p))) queue.push(p);
    }
  }
  console.log(`${label}: checked ${visited} pages`);
  await context.close();
}

// Onboarding's steps share one address, and a crawl can't reach them once it is finished, so each is checked on the way through.
async function axeHere(page, label) {
  await page.waitForTimeout(150);
  await page.addScriptTag({ content: AXE });
  const result = await page.evaluate(async () =>
    axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] }),
  );
  for (const v of result.violations) if (v.impact === "serious" || v.impact === "critical") fail(label, `axe ${v.impact} ${v.id}: ${v.help}`);
}

async function demoSignIn(page, admin) {
  await page.goto(`${BASE}/sign-in${admin ? "?admin=1" : ""}`, { waitUntil: "networkidle" });
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/sign-in")), page.getByRole("button", { name: /university sign-in|sign in/i }).first().click()]);
  if (admin) return;
  // New demo students start at onboarding (reached via a second redirect after sign-in).
  await page.goto(`${BASE}/onboarding`, { waitUntil: "networkidle" });
  if (new URL(page.url()).pathname === "/onboarding") {
    await axeHere(page, "/onboarding step 1");
    await page.getByRole("button", { name: "Continue" }).click();
    await axeHere(page, "/onboarding step 2");
    await page.getByRole("button", { name: "Finance and banking" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await axeHere(page, "/onboarding step 3");
    await Promise.all([page.waitForURL((u) => u.pathname !== "/onboarding"), page.getByRole("button", { name: /Upload my CV/ }).click()]);
  }
}

const browser = await launch();
try {
  await crawl(browser, "public", ["/", "/sign-in", "/legal/privacy", "/legal/terms", "/legal/accessibility", "/legal/cookies", "/legal/sub-processors"], async () => {});
  await crawl(browser, "student", ["/dashboard", "/reviews/latest", "/upload", "/tailor", "/letters", "/linkedin", "/opportunities", "/templates", "/practice", "/practice/aptitude", "/practice/interview", "/practice/roadmap", "/share/manage", "/privacy", "/help", "/onboarding", "/this-page-does-not-exist"], (p) => demoSignIn(p, false));
  await crawl(browser, "admin", ["/admin", "/admin/students", "/admin/import", "/admin/team", "/admin/opportunities", "/admin/settings"], (p) => demoSignIn(p, true));
} finally {
  await browser.close();
}

if (notes.length) console.log(`\nMinor (not failing):\n  ${notes.join("\n  ")}`);
if (failures.length) {
  console.error(`\nFAIL (${failures.length}):\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("\nPASS: every page loads, has no console errors, no serious accessibility issues and no sideways scrolling.");
