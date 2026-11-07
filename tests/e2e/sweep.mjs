// Route sweep for the accessibility register (OP-027). Run tests/e2e/keyboard.mjs first with E2E_OUT and E2E_STATE set, against
// the same running demo server, then with the same variables as E2E_RUN and E2E_STATE:
//   E2E_RUN=run.json E2E_STATE=state.json E2E_SWEEP_OUT=sweep.json node tests/e2e/sweep.mjs
// At 1280px, 200% zoom (640x450), 390px and 400% zoom (320x256), each page gets axe, a full Tab walk (not at 320), overflow,
// target-size and text-spacing measurements; 1280px also gets best-practice rules and a Shift+Tab walk. It records; it never fails.
// Prints one line a route, and writes everything to E2E_SWEEP_OUT.

import fs from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const AXE = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const BASE = (process.env.E2E_BASE_URL || "http://localhost:3100").replace(/\/+$/, "");
const launch = () => chromium.launch({ channel: process.env.E2E_CHROME_PATH ? undefined : "chrome", executablePath: process.env.E2E_CHROME_PATH, headless: true });
const log = (...a) => console.log(...a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))));

async function cdp(page) { if (!page.__cdp) { page.__cdp = await page.context().newCDPSession(page); await page.__cdp.send("Accessibility.enable"); } return page.__cdp; }

const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(2); };

async function focusInfo(page) {
  const c = await cdp(page);
  const { result } = await c.send("Runtime.evaluate", { expression: "document.activeElement" });
  let name = "", role = "";
  try { const { nodes } = await c.send("Accessibility.getPartialAXTree", { objectId: result.objectId, fetchRelatives: false }); const n = nodes[nodes.length - 1] ; const m = nodes.find((x) => x.backendDOMNodeId) ?? n; name = m.name?.value ?? ""; role = m.role?.value ?? ""; } catch {}
  const dom = await page.evaluate(() => {
    const e = document.activeElement;
    if (!e || e === document.body) return { body: true };
    const cs = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
    const parseColor = (s) => { const p = parse(s); return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
    let bgEl = e.parentElement, bg = [255, 255, 255];
    while (bgEl) { const c = parseColor(getComputedStyle(bgEl).backgroundColor); if (c.a > 0.9) { bg = c.rgb; break; } bgEl = bgEl.parentElement; }
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const at = document.elementFromPoint(cx, cy);
    const inView = r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    const covered = inView && at && !(e === at || e.contains(at) || at.contains(e));
    return {
      tag: e.tagName.toLowerCase(), id: e.id || "", tabindex: e.getAttribute("tabindex"), text: (e.textContent || e.value || "").trim().slice(0, 40),
      outline: cs.outlineStyle, oWidth: parseFloat(cs.outlineWidth), oColor: parseColor(cs.outlineColor).rgb, shadow: cs.boxShadow, bg,
      x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height), inView, covered: covered ? (at.tagName + "." + String(at.className).slice(0, 30)) : false,
      offscreen: r.right < 0 || r.left > innerWidth,
    };
  });
  return { name, role, ...dom };
}

async function tabWalk(page, { max = 150, reverse = true } = {}) {
  await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement?.blur?.(); });
  const stops = [], issues = [];
  let wrapped = false, prevKey = null, same = 0, first = null;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const f = await focusInfo(page);
    if (f.body) { wrapped = true; break; }
    if (f.tag === "nextjs-portal") { first ??= null; continue; }
    const key = `${f.tag}|${f.id}|${f.name}|${f.x}|${f.y}`;
    if (first && key === first) { wrapped = true; break; }
    first ??= key;
    if (key === prevKey) { same++; if (same >= 3) { issues.push(`TRAP at ${f.tag} "${f.name}"`); break; } } else same = 0;
    prevKey = key;
    stops.push(f);
    const label = `${f.role || f.tag} "${(f.name || f.text).slice(0, 40)}"`;
    if (!f.name) issues.push(`NO NAME ${f.tag}#${f.id} ${f.text}`);
    const hasShadow = f.shadow && f.shadow !== "none";
    if (!(f.outline !== "none" && f.oWidth >= 1) && !hasShadow) issues.push(`NO FOCUS RING ${label}`);
    else if (!hasShadow) { const r = ratio(f.oColor, f.bg); if (r < 3) issues.push(`LOW FOCUS CONTRAST ${r}:1 ${label}`); }
    if (f.covered) issues.push(`OBSCURED by ${f.covered}: ${label}`);
    if (!f.inView) issues.push(`NOT IN VIEW ${label}`);
    if (f.w === 0 || f.h === 0 || f.offscreen) issues.push(`INVISIBLE TARGET (${f.w}x${f.h}, x=${f.x}) ${label}`);
    if (Number(f.tabindex) > 0) issues.push(`POSITIVE TABINDEX ${label}`);
  }
  // reverse: from the last stop, Shift+Tab must retrace the same stops in the opposite order.
  if (reverse && stops.length > 1) {
    await page.reload({ waitUntil: "networkidle" });
    for (let i = 0; i < stops.length; i++) await page.keyboard.press("Tab");
    const back = [];
    for (let i = 0; i < stops.length - 1; i++) { await page.keyboard.press("Shift+Tab"); back.push((await focusInfo(page)).name); }
    const want = stops.slice(0, -1).reverse().map((x) => x.name);
    const bad = back.findIndex((n, i) => n !== want[i]);
    if (bad >= 0) issues.push(`REVERSE differs at ${bad}: "${back[bad]}" vs "${want[bad]}"`);
  }
  // order: same-row or downward; flag big upward jumps
  for (let i = 1; i < stops.length; i++) if (stops[i].y < stops[i - 1].y - 200) issues.push(`ORDER jumps up ${stops[i - 1].y}->${stops[i].y}: "${stops[i - 1].name}" -> "${stops[i].name}"`);
  return { stops: stops.length, wrapped, issues: [...new Set(issues)], names: stops.map((s) => s.name) };
}

async function runAxe(page, tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]) {
  await page.waitForTimeout(150);
  await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch {} }));
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async (tags) => {
    const r = await axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations", "incomplete"] });
    const m = (v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, at: v.nodes.slice(0, 3).map((x) => x.target.join(" ")) , msg: v.nodes[0]?.any?.[0]?.message || v.nodes[0]?.all?.[0]?.message || v.nodes[0]?.none?.[0]?.message || "" });
    return { violations: r.violations.map(m), incomplete: r.incomplete.map(m) };
  }, tags);
}


const run = JSON.parse(fs.readFileSync(process.env.E2E_RUN, "utf8")); // the file keyboard.mjs wrote through E2E_OUT
const ids = { ...run.ids, checks: (run.ids.checks ?? []).slice(0, 3) };
const OUT = process.env.E2E_SWEEP_OUT || "a11y-sweep.json";
const pub = ["/sign-in", "/sign-in?admin=1", "/legal/privacy", "/legal/terms", "/legal/accessibility", "/legal/cookies", "/legal/sub-processors", "/privacy-notice", "/nonexistent-route"];
const r = ids.review;
const stu = ["/dashboard", "/onboarding", "/upload", "/upload?source=" + (ids.source || "x"), `/reviews/${r}`, `/reviews/${r}/breakdown`, `/reviews/${r}/source`, `/reviews/${r}/source?correct=1`, `/reviews/${r}/lines`, `/reviews/${r}/examples`, `/reviews/${r}/verbs`,
  ...(ids.checks || []).map((c) => `/reviews/${r}/checks/${c}`),
  "/tailor", `/tailor/${ids.tailor}`, "/letters", ids.letter && `/letters/${ids.letter}`, ids.letterDraft && `/letters/${ids.letterDraft}`, "/linkedin", ids.linkedin && `/linkedin/${ids.linkedin}`, "/opportunities", "/templates", ids.template && `/templates/${ids.template}`, "/practice", "/practice/aptitude", "/practice/interview", "/practice/roadmap", "/privacy", "/help", "/share/manage", `/share/manage/${r}`].filter(Boolean);
const VIEW = { desktop: [1280, 900, 1], zoom200: [640, 450, 2], mobile: [390, 844, 3], zoom400: [320, 256, 4] };
const b = await launch();
const results = {};
async function fresh() {
  // Onboarding, on a brand-new student, at every step.
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + "/sign-in", { waitUntil: "networkidle", timeout: 120000 });
  await page.getByRole("button", { name: "Enter as a student" }).press("Enter");
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
  await page.goto(BASE + "/onboarding", { waitUntil: "networkidle" });
  for (const step of [1, 2, 3]) {
    const row = { views: {} , status: 200, title: await page.title(), console: [] };
    for (const [v, [w, h]] of Object.entries(VIEW)) {
      await page.setViewportSize({ width: w, height: h });
      const a = await runAxe(page);
      const m = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, clipped: [], h1: document.querySelectorAll("h1").length, skip: false, under24: [], under44: 0, targets: 0, minFont: null }));
      const walk = v === "zoom400" ? null : await tabWalk(page, { reverse: false });
      res(row, v, a, m, walk);
    }
    results[`/onboarding#step${step}`] = row;
    log(`/onboarding#step${step}`, JSON.stringify(Object.entries(row.views).map(([v, x]) => [v, x.violations.length, x.overflow])));
    await page.setViewportSize({ width: 1280, height: 900 });
    if (step === 1) { await page.getByRole("button", { name: "Continue" }).press("Enter"); await page.waitForTimeout(200); }
    if (step === 2) { await page.getByRole("button", { name: "Finance and banking" }).press("Enter"); await page.getByRole("button", { name: "Continue" }).press("Enter"); await page.waitForTimeout(200); }
  }
  await ctx.close();
}
function res(row, v, a, m, walk) { row.views[v] = { violations: a.violations, incomplete: a.incomplete.map((i) => `${i.id}x${i.n}`), bp: null, walk, ...m }; }
async function audit(ctx, routes) {
  const page = await ctx.newPage();
  const errs = []; page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 160))); page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  for (const route of routes) {
    const res = { views: {} };
    for (const [v, [w, h]] of Object.entries(VIEW)) {
      await page.setViewportSize({ width: w, height: h });
      const resp = await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 120000 });
      res.status = resp?.status(); res.title = await page.title(); res.finalUrl = page.url().replace(BASE, "");
      const a = await runAxe(page);
      const bp = v === "desktop" ? await runAxe(page, ["best-practice"]) : null;
      const walk = v === "zoom400" ? null : await tabWalk(page, { reverse: v === "desktop" });
      await page.addStyleTag({ content: "*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important} p{margin-bottom:2em!important}" }).catch(() => {});
      await page.waitForTimeout(40);
      const spaced = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await page.reload({ waitUntil: "networkidle" });
      const m = await page.evaluate(() => {
        const de = document.documentElement;
        const clipped = [...document.querySelectorAll("main *, header *, footer *")].filter((e) => { const cs = getComputedStyle(e); if (!e.textContent.trim() || e.children.length > 0) return false; const r = e.getBoundingClientRect(); return (cs.overflowX === "hidden" && e.scrollWidth > e.clientWidth + 1) || r.right > innerWidth + 1; }).slice(0, 5).map((e) => e.tagName + ":" + e.textContent.trim().slice(0, 30) + "@" + Math.round(e.getBoundingClientRect().right));
        const small = [...document.querySelectorAll("a[href],button,input:not([type=hidden]),select,textarea,summary")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.left > -100; }).map((e) => { const r = e.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width), inText: !!e.closest("p,li,dd,td"), t: (e.textContent || e.name || e.type || "").trim().slice(0, 24) }; });
        const heads = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter((h) => h.getClientRects().length).map((h) => +h.tagName[1]);
        const fs = [...document.querySelectorAll("main *")].filter((e) => e.children.length === 0 && e.textContent.trim() && e.getClientRects().length).map((e) => parseFloat(getComputedStyle(e).fontSize));
        return { overflow: de.scrollWidth - de.clientWidth, clipped, h1: heads.filter((x) => x === 1).length, skip: heads.some((x, i) => i && x - heads[i - 1] > 1), under44: small.filter((s) => !s.inText && (s.h < 44 )).length, under24: small.filter((s) => s.h < 24 || s.w < 24).map((s) => s.t + `(${s.w}x${s.h})`).slice(0, 5), targets: small.length, minFont: fs.length ? Math.min(...fs) : null };
      });
      res.views[v] = { spaced, violations: a.violations, incomplete: a.incomplete.map((i) => `${i.id}x${i.n}`), bp: bp?.violations, walk, ...m };
    }
    res.console = errs.splice(0);
    results[route] = res;
    log(route, res.status, JSON.stringify(res.title), Object.entries(res.views).map(([v, x]) => `${v}: axe=${x.violations.map((q) => q.impact[0] + ":" + q.id + "x" + q.n).join(",") || 0} ovf=${x.overflow} stops=${x.walk?.stops ?? "-"} issues=${x.walk?.issues.length ?? "-"}`).join(" | "));
    fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  }
  await page.close();
}
await fresh();
const ctxPub = await b.newContext(); await audit(ctxPub, pub); await ctxPub.close();
const ctx = await b.newContext({ storageState: process.env.E2E_STATE }); await audit(ctx, stu); await ctx.close();
await b.close();
