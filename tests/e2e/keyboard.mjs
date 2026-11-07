// Keyboard-only task runner for the student journeys (OP-027). Needs a running server in demo mode with no keys:
//   DEMO_MODE=true DEMO_REPORT_SHARING=true PORT=3100 npm start      then      npm run test:keyboard
// Every action here is a real key press in a real browser: no clicks, no element.focus(), no form filling. A file chooser is
// opened by pressing Enter on the visible control, as a student would. Reads the focused element's name from Chrome's own
// accessibility tree, and logs what reaches a live region. Set E2E_OUT to write the results as JSON.
//
// What this proves: a scripted keyboard can complete these tasks, focus lands somewhere named, and text reaches a live region.
// What it does not prove: that a screen reader announces it well, or that a person finds it usable. See docs/ACCESSIBILITY_REGISTER.md.
//
// The tailoring suggestion controls only exist once a provider has written suggestions, which needs a key. Set E2E_TAILOR_STUB=1
// only if your server has a simulated provider (see the register); otherwise those steps are reported as SKIP, never as passes.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3100").replace(/\/+$/, "");
const AXE = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const STUB = process.env.E2E_TAILOR_STUB === "1";
const JOB = "Graduate Data Analyst. Essential: SQL, Python and stakeholder communication. You will analyse customer data, build dashboards in Tableau and present findings to senior managers. Desirable: financial modelling and experience of A/B testing. Applicants must be on track for a 2:1 degree. Northbank is a UK retail bank.";
const LETTER = "Dear Hiring Manager,\n\nI am applying for the Graduate Data Analyst role at Northbank. During my placement at Example Ltd I built a churn model in Python that cut losses by 12%, and presented the results to senior managers.\n\nI am keen to join because of your work on customer analytics.\n\nYours faithfully,\nJordan Reed";

const results = [];
let journey = "";
const record = (step, status, detail = "") => {
  results.push({ journey, step, status, detail: String(detail).slice(0, 300) });
  console.log(`${status === "PASS" ? "  ok  " : status === "SKIP" ? "  skip" : "  FAIL"} ${journey} / ${step}${detail ? ` : ${String(detail).slice(0, 200)}` : ""}`);
};
const check = (step, ok, detail = "") => record(step, ok ? "PASS" : "FAIL", detail);
const skip = (step, why) => record(step, "SKIP", why);

// ---- browser helpers -------------------------------------------------------------------------------------------------------

/** Installed before any page script: keeps every text change that lands in a live region, however it got there. */
const INIT = () => {
  window.__live = [];
  const SEL = '[aria-live]:not([aria-live="off"]),[role=status],[role=alert],[role=log]';
  const start = () =>
    new MutationObserver((ms) => {
      for (const m of ms) {
        const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        let host = el?.closest?.(SEL);
        if (!host) for (const a of m.addedNodes) if (a.nodeType === 1) host ??= a.matches(SEL) ? a : a.querySelector(SEL);
        if (!host) continue;
        const t = (host.textContent || "").trim().slice(0, 200);
        if (t && window.__live.at(-1) !== t) window.__live.push(t);
      }
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start);
};

const sessions = new WeakMap();
async function cdp(page) {
  if (!sessions.has(page)) {
    const c = await page.context().newCDPSession(page);
    await c.send("Accessibility.enable");
    sessions.set(page, c);
  }
  return sessions.get(page);
}

/** The focused element as assistive technology sees it. `body` means focus has been lost. */
async function focused(page) {
  const c = await cdp(page);
  const { result } = await c.send("Runtime.evaluate", { expression: "document.activeElement" });
  let name = "";
  let role = "";
  try {
    const { nodes } = await c.send("Accessibility.getPartialAXTree", { objectId: result.objectId, fetchRelatives: false });
    const n = nodes.find((x) => x.backendDOMNodeId) ?? nodes.at(-1);
    name = n.name?.value ?? "";
    role = n.role?.value ?? "";
  } catch {}
  const dom = await page.evaluate(() => {
    const e = document.activeElement;
    if (!e || e === document.body) return { body: true };
    const own = (e.textContent || "").trim().slice(0, 120);
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return { tag: e.tagName.toLowerCase(), own, ring: (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 1) || cs.boxShadow !== "none", onscreen: r.width > 0 && r.right > 0 && r.left < innerWidth, disabled: !!e.disabled };
  });
  return { name, role, ...dom };
}

const press = (page, key) => page.keyboard.press(key);

/** Press Tab until the focused element's accessible name matches. Throws, with everything it passed, if it never does. */
async function tabTo(page, re, { max = 120, back = false } = {}) {
  const seen = [];
  for (let i = 0; i < max; i++) {
    await press(page, back ? "Shift+Tab" : "Tab");
    const f = await focused(page);
    if (f.tag === "nextjs-portal") continue; // the dev overlay, absent from a production build
    seen.push(f.name || f.tag || "body");
    if (re.test(f.name)) return { presses: i + 1, ...f };
  }
  throw new Error(`${re} not reached: ${seen.join(" | ").slice(0, 400)}`);
}

/** Choose a <select> option the way a closed select takes it on every platform: by typing the start of its text. */
async function typeOption(page, { value, text: wanted, other } = {}) {
  const text = await page.evaluate(
    ({ value, wanted, other }) =>
      [...document.activeElement.options].find((o) => (value ? new RegExp(value).test(o.value) : wanted ? new RegExp(wanted).test(o.text) : other ? !o.selected : false))?.text ?? "",
    { value, wanted, other },
  );
  if (!text) throw new Error("no such option");
  await page.keyboard.type(text.split(/\s/)[0]); // a space would open the list
  await page.waitForTimeout(700); // let the browser's type-ahead buffer lapse
  return text;
}

const live = (page) => page.evaluate(() => { const l = window.__live || []; window.__live = []; return l; });
const settle = async (page, ms = 400) => { await page.waitForTimeout(ms); await page.waitForLoadState("networkidle").catch(() => {}); };
const go = async (page, p) => { await page.goto(BASE + p, { waitUntil: "networkidle", timeout: 180000 }); await page.waitForTimeout(250); await live(page); };
/** Keep focus where it is, and start the next Tab from the top of the page. */
const top = (page) => page.evaluate(() => document.activeElement?.blur?.());
const has = (page, re) => page.evaluate((s) => new RegExp(s, "i").test(document.body.innerText), re.source);

async function focusNotLost(page, step, want) {
  // A control disabled while its action runs gets focus back when the action lands, so give it the time the app allows.
  let f = await focused(page);
  for (let i = 0; i < 45 && f.body; i++) {
    await page.waitForTimeout(200);
    f = await focused(page);
  }
  if (f.body) return check(step, false, "focus fell to <body>");
  if (!f.ring) return check(step, false, `focus on "${f.name}" has no visible indicator`);
  // A heading or status line that takes focus is read out by its text.
  const said = f.name || f.own || "";
  if (want && !want.test(said)) return check(step, false, `focus on ${f.role} "${said.slice(0, 70)}", wanted ${want}`);
  check(step, true, `${f.role} "${said.slice(0, 60)}"`);
}

async function announced(page, step, re) {
  let l = await live(page);
  for (let i = 0; i < 40 && !l.some((t) => re.test(t)); i++) {
    await page.waitForTimeout(200);
    l = [...l, ...(await live(page))];
  }
  check(step, l.some((t) => re.test(t)), l.length ? `live: ${l.join(" / ").slice(0, 200)}` : "nothing reached a live region");
}

const attempt = async (step, fn) => {
  try {
    return await fn();
  } catch (e) {
    check(step, false, String(e.message).split("\n")[0]);
  }
};

const browser = await chromium.launch({ channel: process.env.E2E_CHROME_PATH ? undefined : "chrome", executablePath: process.env.E2E_CHROME_PATH, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
await ctx.addInitScript(INIT);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
const ids = {};

// ---- sign-in ----------------------------------------------------------------------------------------------------------------
journey = "sign-in";
await go(page, "/sign-in");
await attempt("email error is announced and tied to its field", async () => {
  await tabTo(page, /University email/);
  await page.keyboard.type("not-an-email");
  await tabTo(page, /Email me a sign-in link/);
  await press(page, "Enter");
  await settle(page, 900);
  await announced(page, "email error is announced", /./);
  const a = await page.evaluate(() => { const e = document.querySelector('input[name=email]'); return { invalid: e?.getAttribute("aria-invalid"), desc: e?.getAttribute("aria-describedby"), descText: e?.getAttribute("aria-describedby") ? document.getElementById(e.getAttribute("aria-describedby"))?.textContent : null }; });
  check("email error is tied to the field (aria-invalid and aria-describedby)", a.invalid === "true" && !!a.descText, JSON.stringify(a));
  await focusNotLost(page, "focus survives the failed submit");
});
await attempt("student sign-in by keyboard", async () => {
  await go(page, "/sign-in");
  const t = await tabTo(page, /Enter as a student/);
  check("sign-in button reachable", true, `${t.presses} Tab`);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 120000 }), press(page, "Enter")]);
  check("sign-in completes", true, new URL(page.url()).pathname);
});

// ---- onboarding -------------------------------------------------------------------------------------------------------------
journey = "onboarding";
await attempt("onboarding", async () => {
  await go(page, "/onboarding");
  if (new URL(page.url()).pathname !== "/onboarding") return skip("onboarding", "already done");
  const opt = await tabTo(page, /Penultimate year/);
  await press(page, "Space");
  await settle(page, 100);
  check("stage choice is a named toggle, set with Space", (await page.evaluate(() => document.activeElement.getAttribute("aria-pressed"))) === "true", opt.name);
  await tabTo(page, /^Continue$/);
  await press(page, "Enter");
  await settle(page, 300);
  const heading = await page.locator("h1").innerText();
  check("Continue moves to step 2", /sectors/i.test(heading), heading);
  await focusNotLost(page, "focus lands on the new step's heading", /sectors/i);
  await tabTo(page, /^Back$/, { back: false }).catch(async () => { await top(page); await tabTo(page, /^Back$/); });
  await press(page, "Enter");
  await settle(page, 300);
  await focusNotLost(page, "Back to step 1 does not lose focus (Back itself disappears there)", /where are you/i);
  await tabTo(page, /^Continue$/);
  await press(page, "Enter");
  await settle(page, 300);
  await top(page);
  await tabTo(page, /^Continue$/);
  await press(page, "Enter");
  await settle(page, 200);
  await announced(page, "no sector chosen: error announced", /at least one/i);
  await top(page);
  await tabTo(page, /Finance and banking/);
  await press(page, "Space");
  await settle(page, 100);
  await tabTo(page, /Consulting|Technology/);
  await tabTo(page, /^Continue$/);
  await press(page, "Enter");
  await settle(page, 300);
  await tabTo(page, /Deadline reminders/);
  const before = await page.evaluate(() => document.activeElement.getAttribute("aria-checked"));
  await press(page, "Space");
  await settle(page, 100);
  const after = await page.evaluate(() => document.activeElement.getAttribute("aria-checked"));
  check("preference switch toggles with Space and keeps focus", before !== after, `${before} -> ${after}`);
  await press(page, "Space");
  await tabTo(page, /Upload my CV/);
  await Promise.all([page.waitForURL(/\/upload/, { timeout: 60000 }), press(page, "Enter")]);
  check("onboarding completes", true);
});

// ---- upload -----------------------------------------------------------------------------------------------------------------
journey = "upload";
async function chooseFile(pageRef, label, file) {
  // The browser can still be closing the last automated chooser (a person can't get here that fast), so one retry.
  let [fc] = await Promise.all([pageRef.waitForEvent("filechooser", { timeout: 4000 }).catch(() => null), press(pageRef, "Enter")]);
  if (!fc) [fc] = await Promise.all([pageRef.waitForEvent("filechooser", { timeout: 6000 }), press(pageRef, "Enter")]);
  await fc.setFiles(file);
  await settle(pageRef, 300);
  return label;
}
await attempt("upload", async () => {
  await go(page, "/upload");
  const seen = [];
  for (let i = 0; i < 40; i++) {
    await press(page, "Tab");
    const f = await focused(page);
    seen.push(f);
    if (/Target sector/.test(f.name)) break;
  }
  const invisible = seen.filter((f) => !f.onscreen && !f.body && f.tag !== "nextjs-portal" && !/Skip/.test(f.name));
  check("no invisible tab stop before the form", invisible.length === 0, invisible.map((x) => x.name).join(", "));
  await top(page);
  await tabTo(page, /Choose a file/);
  await chooseFile(page, "txt", path.join(FIX, "..", "e2e", "keyboard.mjs"));
  await announced(page, "a refused file type is announced", /PDF or Word/i);
  await focusNotLost(page, "focus stays on the file control after a refused file");
  await chooseFile(page, "pdf", path.join(FIX, "cv.pdf"));
  await announced(page, "the chosen file is announced", /cv\.pdf/i);
  await focusNotLost(page, "focus stays on the file control", /different file/i);
  await tabTo(page, /Target sector/);
  await tabTo(page, /Score my CV/);
  await press(page, "Enter");
  await settle(page, 500);
  await announced(page, "progress is announced", /reading your cv/i);
  await focusNotLost(page, "focus moves to the progress heading while scoring", /reading your cv/i);
  await page.waitForURL(/\/reviews\/[0-9a-f-]{20,}/, { timeout: 90000 });
  await settle(page);
  ids.review = page.url().match(/reviews\/([^/?#]+)/)[1];
  check("upload completes with the keyboard only", true, new URL(page.url()).pathname);
});
await attempt("reading shown first", async () => {
  await go(page, "/upload");
  await tabTo(page, /Choose a file/);
  await chooseFile(page, "two-column", path.join(FIX, "extraction", "two-column.pdf"));
  await tabTo(page, /Score my CV/);
  await press(page, "Enter");
  await page.waitForSelector("[data-reading]", { timeout: 60000 });
  await settle(page);
  await focusNotLost(page, "reading summary: focus moves to its heading", /check how we read/i);
  await tabTo(page, /See my results/);
  await Promise.all([page.waitForURL(/\/reviews\//, { timeout: 60000 }), press(page, "Enter")]);
  check("reading summary continues to the report", true);
});
await attempt("unreadable file", async () => {
  await go(page, "/upload");
  await tabTo(page, /Choose a file/);
  await chooseFile(page, "scan", path.join(FIX, "extraction", "scan.pdf"));
  await tabTo(page, /Score my CV/);
  await press(page, "Enter");
  await page.waitForSelector("[data-outcome]", { timeout: 60000 });
  await settle(page);
  await announced(page, "unreadable file: outcome announced", /not scored/i);
  await focusNotLost(page, "unreadable file: focus moves to the outcome");
  await tabTo(page, /Type or paste my CV text instead/);
  await press(page, "Enter");
  await settle(page, 300);
  await focusNotLost(page, "paste panel: focus moves into it", /paste/i);
  await tabTo(page, /^Back$/);
  await press(page, "Enter");
  await settle(page, 300);
  await focusNotLost(page, "paste panel Back: focus returns to the outcome");
});

// ---- review before scoring --------------------------------------------------------------------------------------------------
journey = "review before scoring";
await attempt("review", async () => {
  await go(page, "/upload");
  await tabTo(page, /Choose a file/);
  await chooseFile(page, "lost-bullets", path.join(FIX, "extraction", "lost-bullets.pdf"));
  await tabTo(page, /Score my CV/);
  await press(page, "Enter");
  await page.waitForSelector("[data-correction]", { timeout: 60000 });
  await settle(page);
  ids.source = new URL(page.url()).searchParams.get("source");
  await focusNotLost(page, "focus moves to the review heading", /check how we read/i);
  check("review page has one h1", (await page.locator("h1").count()) === 1);
  const unnamed = await page.evaluate(() => [...document.querySelectorAll("[data-correction] input,[data-correction] textarea")].filter((e) => !(e.labels?.length || e.getAttribute("aria-label"))).length);
  check("every correction field has a label", unnamed === 0, `${unnamed} unlabelled`);
  const field = await tabTo(page, /bullet point|line|heading/i);
  check("correction field names say what the line is", field.name.length > 3, field.name.slice(0, 70));
  await page.keyboard.press("End");
  await page.keyboard.type(" edited");
  await settle(page, 200);
  await announced(page, "the changed-line count is announced", /1 line changed/i);
  const pa = await tabTo(page, /Score my corrections/);
  await press(page, "Enter");
  await page.waitForURL(/\/reviews\/[0-9a-f-]{20,}/, { timeout: 90000 });
  await settle(page);
  ids.corrected = page.url().match(/reviews\/([^/?#]+)/)[1];
  check("corrected text is scored, by keyboard", true, `${pa.presses} Tab`);
});

// ---- source document --------------------------------------------------------------------------------------------------------
journey = "source document";
await attempt("source", async () => {
  await go(page, `/reviews/${ids.corrected}/source`);
  await tabTo(page, /Show the text that was scored/);
  await press(page, "Enter");
  await settle(page, 100);
  check("the scored text opens by keyboard", await page.evaluate(() => document.activeElement.closest("details")?.open === true));
  const correct = await (async () => { await top(page); return tabTo(page, /Correct this text/); })();
  check("correct-this-text is reachable", !!correct);
  await press(page, "Enter");
  await page.waitForURL(/correct=1/, { timeout: 60000 });
  await settle(page);
  const c = await tabTo(page, /Cancel/, { max: 200 });
  check("correction editor can be left by keyboard (no trap)", !!c, `${c.presses} Tab`);
  const dl = await tabTo(page, /^Download /);
  check("original file download is reachable", !!dl, dl.name);
});

// ---- report overview --------------------------------------------------------------------------------------------------------
journey = "report overview";
await attempt("overview", async () => {
  await go(page, `/reviews/${ids.review}`);
  const rings = await page.evaluate(() => [...document.querySelectorAll('main svg[role=img]')].map((s) => s.getAttribute("aria-label")));
  check("score graphics have text alternatives", rings.length > 0 && rings.every(Boolean), rings.slice(0, 4).join(" | "));
  await tabTo(page, /Show me around/);
  await press(page, "Enter");
  await settle(page, 300);
  const t1 = await focused(page);
  check("tour: focus moves into the dialog", await page.evaluate(() => !!document.activeElement.closest("[role=dialog]")), `${t1.role} "${t1.name}"`);
  await press(page, "Escape");
  await settle(page, 200);
  check("tour: Escape closes it", (await page.locator("[role=dialog]").count()) === 0);
  await focusNotLost(page, "tour: Escape returns focus to the button", /Show me around/);
  await top(page);
  await tabTo(page, /Show me around/);
  await press(page, "Enter");
  await settle(page, 200);
  await page.evaluate(() => {});
  for (let i = 0; i < 3; i++) {
    const n = await page.evaluate(() => document.activeElement.textContent);
    if (!/Next|Done/.test(n)) await tabTo(page, /^(Next|Done)$/);
    await press(page, "Enter");
    await settle(page, 200);
    if (i === 0) await announced(page, "tour: each stop is announced", /score history/i);
  }
  check("tour: Done closes it", (await page.locator("[role=dialog]").count()) === 0);
  await focusNotLost(page, "tour: Done returns focus to the button", /Show me around/);
  const toneOnly = await page.evaluate(() => {
    const m = document.querySelector("main");
    return { band: /\b(strong|good|average|needs work|developing|solid|excellent|weak)\b/i.test(m.innerText), num: /\d+\s*(\/|of)?\s*100|\b\d{1,3}\b/.test(m.innerText) };
  });
  check("score has a number in text, not only a colour", toneOnly.num, JSON.stringify(toneOnly));
  const bare = await page.evaluate(() => [...document.querySelectorAll('[class*="bg-[#D6F0DE]"],[class*="bg-[#FBEFC9]"],[class*="bg-[#FDE4E1]"]')].filter((e) => !e.textContent.trim()).length);
  check("every score-coloured badge carries text", bare === 0, `${bare} empty`);
  const area = await tabTo(page, /Score breakdown|breakdown/i);
  check("score breakdown link reachable", !!area, area.name);
});

// ---- check pages ------------------------------------------------------------------------------------------------------------
journey = "check pages";
await attempt("checks", async () => {
  const links = await (async () => { await go(page, `/reviews/${ids.review}`); return page.evaluate(() => [...new Set([...document.querySelectorAll('a[href*="/checks/"]')].map((a) => a.getAttribute("href")))]); })();
  ids.checks = links.map((l) => l.split("/checks/")[1]);
  check("check pages are listed in the navigation", links.length > 0, `${links.length} checks`);
  const names = await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Results and feedback"] a[href*="/checks/"]')].map((a) => a.textContent.trim()));
  check("each check link gives its score as text", names.every((n) => /\d/.test(n)), names.slice(0, 3).join(" | "));
  await go(page, links[0]);
  check("a check page opens", (await page.locator("h1").count()) === 1, await page.locator("h1").innerText());
  const spell = links.find((l) => /spell|proof/.test(l));
  if (!spell) return skip("proofreading controls", "no proofreading check on this report");
  await go(page, spell);
  const radio = await tabTo(page, /British|American|English/);
  await press(page, "ArrowDown");
  await settle(page, 100);
  check("language choice moves with arrow keys", await page.evaluate(() => document.activeElement.type === "radio" && document.activeElement.checked), radio.name);
  await tabTo(page, /Check again/);
  await press(page, "Enter");
  await settle(page, 900);
  await focusNotLost(page, "check again: focus moves to the status line");
});

// ---- line editor ------------------------------------------------------------------------------------------------------------
journey = "line editor";
await attempt("lines", async () => {
  // The uploaded fixture is strong, so nothing needs rewriting. The seeded weaker CV has lines to act on.
  await go(page, "/dashboard");
  const reports = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href^="/reviews/"]')].map((a) => a.getAttribute("href").match(/\/reviews\/[^/]+/)[0]))]);
  let weak = null;
  for (const r of reports) {
    await go(page, `${r}/lines`);
    if (await has(page, /LINE \d+ OF \d+/)) {
      await tabTo(page, /^Next$/);
      for (let i = 0; i < 10 && !(await has(page, /Use this rewrite/)); i++) { await press(page, "Enter"); await settle(page, 120); }
      if (await has(page, /Use this rewrite/)) { weak = r; break; }
    }
  }
  if (!weak) return skip("line editing", "no report with a line to rewrite");
  ids.weak = weak.split("/").pop();
  await live(page);
  await go(page, `${weak}/lines`);
  await tabTo(page, /^Next$/);
  await press(page, "Enter");
  await settle(page, 200);
  await announced(page, "moving to the next line is announced", /line 2 of/i);
  await focusNotLost(page, "Next keeps focus", /^Next$/);
  for (let i = 0; i < 10 && !(await has(page, /Use this rewrite/)); i++) { await press(page, "Enter"); await settle(page, 120); }
  await top(page);
  await tabTo(page, /^Edit$/);
  await press(page, "Enter");
  await settle(page, 200);
  await focusNotLost(page, "Edit moves focus into the box", /your wording/i);
  await page.keyboard.press("Tab");
  await tabTo(page, /^Cancel$/);
  await press(page, "Enter");
  await settle(page, 200);
  await focusNotLost(page, "Cancel returns focus to Edit", /^Edit$/);
  await top(page);
  await live(page);
  await tickAll(page);
  await top(page);
  const use = await tabTo(page, /Use this rewrite/);
  await press(page, "Enter");
  await settle(page, 800);
  await announced(page, "saving a rewrite is announced", /saved/i);
  await focusNotLost(page, "Use this rewrite keeps focus somewhere named");
  check("the saved line is shown", await has(page, /your saved version/i), use.name);
  await top(page);
  await tabTo(page, /Keep my original/);
  await press(page, "Enter");
  await settle(page, 800);
  await announced(page, "going back to the original is announced", /own wording/i);
  await focusNotLost(page, "Keep my original does not lose focus (the button goes away)");
  await top(page);
  await tabTo(page, /^Undo$/);
  await press(page, "Enter");
  await settle(page, 800);
  await focusNotLost(page, "Undo does not lose focus");
  await top(page);
  await tabTo(page, /^Try another$/);
  await press(page, "Enter");
  await settle(page, 800);
  await focusNotLost(page, "Try another keeps focus");
});

// ---- tailor -----------------------------------------------------------------------------------------------------------------
journey = "tailor";
await attempt("tailor", async () => {
  await go(page, "/tailor");
  // The strong fixture, whose lines the suggestions can act on, rather than the corrected file uploaded last.
  await tabTo(page, /^CV$/);
  await typeOption(page, { text: "^cv\\.pdf" });
  await tabTo(page, /Job ad text/);
  await page.keyboard.insertText(JOB);
  await tabTo(page, /Job title/);
  await page.keyboard.insertText("Graduate Data Analyst");
  await tabTo(page, /Employer/);
  await page.keyboard.insertText("Northbank");
  await tabTo(page, /Tailor my CV/);
  await press(page, "Enter");
  await settle(page, 300);
  await announced(page, "reading the job ad is announced", /reading the job ad/i);
  await page.waitForURL(/\/tailor\/[0-9a-f-]{20,}/, { timeout: 90000 });
  await settle(page, 2500);
  ids.tailor = page.url().match(/tailor\/([^/?#]+)/)[1];
  check("tailoring starts by keyboard", true);
  await go(page, `/tailor/${ids.tailor}`);
  const tabs = await page.evaluate(() => [...document.querySelectorAll('[role=tablist]')].map((t) => t.getAttribute("aria-label")));
  if (tabs.includes("View")) {
    await tabTo(page, /^(Job ad|Tailored CV, side by side)$/);
    const before = await focused(page);
    await press(page, "ArrowRight");
    await settle(page, 150);
    const after = await focused(page);
    check("View tabs: arrow keys move between tabs", before.name !== after.name && after.role === "tab", `${before.name} -> ${after.name}`);
    const stops = await tabStops(page, /^(Job ad|Tailored CV, side by side)$/);
    check("View tabs: one Tab stop for the group", stops === 1, `${stops} stops`);
  } else skip("View tabs", "no tablist on this report");
  await go(page, `/tailor/${ids.tailor}`);
  await tabTo(page, /Not relevant to me for/);
  await press(page, "Enter");
  await settle(page, 900);
  await focusNotLost(page, "Not relevant to me: focus stays on the row's control", /Take back for/);
  await top(page);
  await tabTo(page, /Write a line yourself/);
  await press(page, "Enter");
  await settle(page, 100);
  await tabTo(page, /Where it goes/);
  await typeOption(page, { value: "^new:" });
  await tabTo(page, /Your line/);
  await page.keyboard.insertText("Presented churn findings to senior managers at Example Ltd.");
  await settle(page, 100);
  await tabTo(page, /Save my line/);
  await press(page, "Enter");
  await settle(page, 1200);
  if (await page.locator('details[open] fieldset input[type=checkbox]').count()) {
    await announced(page, "what needs confirming is announced", /confirm/i);
    await focusNotLost(page, "asking to confirm leaves focus in the form", /your line|save my line/i);
    await tickAll(page);
    await top(page);
    await tabTo(page, /Save my line/);
    await press(page, "Enter");
    await settle(page, 1200);
  }
  await announced(page, "saving your own line is announced", /your line is saved/i);
  await focusNotLost(page, "Save my line keeps focus");
  await top(page);
  const undo = await tabTo(page, /Undo, back to/);
  await press(page, "Enter");
  await settle(page, 1200);
  await announced(page, "undo is announced", /undo|back|version|nothing/i);
  await focusNotLost(page, "Undo keeps focus (the button becomes disabled)");
  check("undo reachable", !!undo, undo.name);
  await top(page);
  await tabTo(page, /Version history/);
  await press(page, "Enter");
  await settle(page, 100);
  check("version history opens by keyboard", await page.evaluate(() => document.activeElement.closest("details")?.open === true));

  await go(page, `/tailor/${ids.tailor}`);
  await tabTo(page, /Tailor (again|my CV)/);
  await press(page, "Enter");
  await settle(page, 2500);
  await focusNotLost(page, "Tailor again keeps focus");
  await go(page, `/tailor/${ids.tailor}`);
  if (!(await has(page, /Accept\s+suggestion/))) return skip("suggestion controls", STUB ? "stub gave no suggestions" : "no provider, so no suggestions; set E2E_TAILOR_STUB=1 with a simulated provider");
  await top(page);
  const ed = await tabTo(page, /^Edit suggestion for/);
  await press(page, "Enter");
  await settle(page, 200);
  await focusNotLost(page, "suggestion Edit moves focus into the box", /your wording/i);
  await tabTo(page, /^Cancel$/);
  await press(page, "Enter");
  await settle(page, 200);
  await focusNotLost(page, "suggestion Cancel returns focus to Edit", /^Edit suggestion/);
  await top(page);
  await tabTo(page, /^Accept suggestion for/);
  await press(page, "Enter");
  await settle(page, 1500);
  await announced(page, "accepting a suggestion is announced", /accepted|version|measured/i);
  await focusNotLost(page, "Accept does not lose focus (the button goes away)");
  await top(page);
  await tabTo(page, /^Reject suggestion for/);
  await press(page, "Enter");
  await settle(page, 1500);
  await announced(page, "rejecting a suggestion is announced", /reject/i);
  await focusNotLost(page, "Reject does not lose focus (the button goes away)");
  await top(page);
  await tabTo(page, /^Decide again/);
  await press(page, "Enter");
  await settle(page, 1500);
  await focusNotLost(page, "Decide again does not lose focus");
  check("suggestion controls all work by keyboard", true, ed.name);
  await tickAll(page);
  await top(page);
  await tabTo(page, /^Accept suggestion for/);
  await press(page, "Enter");
  await settle(page, 1500);
  await top(page);
  const brackets = await has(page, /Keep the brackets/);
  if (brackets) { await tabTo(page, /Keep the brackets/); await press(page, "Enter"); await settle(page, 1200); await focusNotLost(page, "Keep the brackets does not lose focus"); await top(page); }
  if (await has(page, /Download Word/)) {
    await tabTo(page, /^Template$/);
    await typeOption(page, { other: true });
    await tabTo(page, /Download Word/);
    const [d] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), press(page, "Enter")]);
    check("tailored CV downloads by keyboard", /\.docx$/.test(d.suggestedFilename()), d.suggestedFilename());
    await d.saveAs(path.join(process.env.E2E_DOWNLOADS || "/tmp", "tailored.docx")).catch(() => {});
    await tabTo(page, /Download PDF/);
    const [p] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), press(page, "Enter")]);
    await p.saveAs(path.join(process.env.E2E_DOWNLOADS || "/tmp", "tailored.pdf")).catch(() => {});
    check("tailored PDF downloads by keyboard", /\.pdf$/.test(p.suggestedFilename()), p.suggestedFilename());
  } else skip("tailored download", "no revised version on this report");
});

/** Tick every "is this accurate?" box with Tab and Space. */
async function tickAll(pageRef) {
  await top(pageRef);
  for (let i = 0; i < 150; i++) {
    await press(pageRef, "Tab");
    const s = await pageRef.evaluate(() => { const e = document.activeElement; return e === document.body ? "end" : e.type === "checkbox" && !e.checked ? "box" : ""; });
    if (s === "end") break;
    if (s === "box") await press(pageRef, "Space");
  }
}

/** How many Tab stops match, walking the whole page once. */
async function tabStops(pageRef, re) {
  await pageRef.reload({ waitUntil: "networkidle" });
  let n = 0;
  for (let i = 0; i < 200; i++) {
    await press(pageRef, "Tab");
    const f = await focused(pageRef);
    if (f.body) break;
    if (re.test(f.name)) n++;
  }
  return n;
}

// ---- letters ----------------------------------------------------------------------------------------------------------------
journey = "letters";
await attempt("letter review", async () => {
  await go(page, "/letters");
  const role = await page.evaluate(() => document.querySelector('[aria-label="What do you want to do?"]')?.getAttribute("role"));
  const mode = await tabTo(page, /Review my letter/);
  await press(page, "Space");
  await settle(page, 200);
  if (role === "radiogroup") check("mode control behaves as its role says", false, "role=radiogroup, but arrow keys do nothing and each option is a Tab stop");
  else check("mode control behaves as its role says", (await page.evaluate(() => document.activeElement.getAttribute("aria-pressed"))) === "true", `${role} ${mode.name}`);
  const before = await (async () => { const seen = []; await top(page); for (let i = 0; i < 40; i++) { await press(page, "Tab"); const f = await focused(page); seen.push(f); if (/Or paste your letter/.test(f.name)) break; } return seen; })();
  const invis = before.filter((f) => !f.onscreen && !f.body && f.tag !== "nextjs-portal" && !/Skip/.test(f.name));
  check("no invisible tab stop in the letter form", invis.length === 0, invis.map((x) => x.name).join(", "));
  await page.keyboard.insertText(LETTER);
  await top(page);
  await tabTo(page, /^Job/);
  await typeOption(page, { value: "^new$" });
  await settle(page, 100);
  await tabTo(page, /Job title/);
  await page.keyboard.insertText("Graduate Data Analyst");
  await tabTo(page, /Employer/);
  await page.keyboard.insertText("Northbank");
  await tabTo(page, /Job ad text/);
  await page.keyboard.insertText(JOB);
  await tabTo(page, /Review my letter/);
  // that matched the mode control if Tab order wrapped; carry on to the submit button
  let f = await focused(page);
  for (let i = 0; i < 40 && !(f.name === "Review my letter" && (await page.evaluate(() => document.activeElement.type === "submit"))); i++) { await press(page, "Tab"); f = await focused(page); }
  await press(page, "Enter");
  await page.waitForURL(/\/letters\/[0-9a-f-]{20,}/, { timeout: 90000 });
  await settle(page, 800);
  ids.letter = page.url().match(/letters\/([^/?#]+)/)[1];
  check("a letter can be reviewed by keyboard", true);
  const lt = await page.evaluate(() => [...document.querySelectorAll('[role=tablist]')].length);
  if (lt) {
    await top(page);
    await tabTo(page, /^(Cover letter|Job ad)$/);
    const a = await focused(page);
    await press(page, "ArrowRight");
    await settle(page, 150);
    const b = await focused(page);
    check("letter View tabs: arrow keys", a.name !== b.name && b.role === "tab", `${a.name} -> ${b.name}`);
  }
  await go(page, `/letters/${ids.letter}`);
  await go(page, `/letters/${ids.letter}`);
  if (await has(page, /Reject/)) {
    await tabTo(page, /^Reject suggestion for/);
    await press(page, "Enter");
    await settle(page, 1200);
    await focusNotLost(page, "letter Reject does not lose focus");
    await announced(page, "letter Reject is announced", /reject/i);
  } else skip("letter suggestions", "no suggestions on this letter");
  await go(page, `/letters/${ids.letter}`);
  if (await has(page, /let me download this version/i) && !(await has(page, /Download Word/))) {
    await tabTo(page, /let me download this version/i);
    await press(page, "Enter");
    await settle(page, 1200);
    await announced(page, "keeping the gaps is announced", /gaps/i);
    await focusNotLost(page, "keeping the gaps does not lose focus");
    await top(page);
  }
  if (await has(page, /Download Word/)) {
    await tabTo(page, /Download Word/);
    const [d] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), press(page, "Enter")]);
    await d.saveAs(path.join(process.env.E2E_DOWNLOADS || "/tmp", "letter.docx")).catch(() => {});
    check("letter Word download by keyboard", /\.docx$/.test(d.suggestedFilename()), d.suggestedFilename());
    await tabTo(page, /Download PDF/);
    const [p] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), press(page, "Enter")]);
    await p.saveAs(path.join(process.env.E2E_DOWNLOADS || "/tmp", "letter.pdf")).catch(() => {});
    check("letter PDF download by keyboard", /\.pdf$/.test(p.suggestedFilename()), p.suggestedFilename());
  } else skip("letter download", "held back until gaps are filled");
});
await attempt("letter draft", async () => {
  await go(page, "/letters");
  await tabTo(page, /Write one for me/);
  await press(page, "Space");
  await settle(page, 200);
  await tabTo(page, /Write my draft/);
  await press(page, "Enter");
  await page.waitForURL(/\/letters\/[0-9a-f-]{20,}/, { timeout: 90000 });
  await settle(page, 800);
  ids.letterDraft = page.url().match(/letters\/([^/?#]+)/)[1];
  check("a draft can be written by keyboard", true);
  if (await has(page, /Edit\s+paragraph/)) {
    await tabTo(page, /Edit paragraph 1/);
    await press(page, "Enter");
    await settle(page, 200);
    await focusNotLost(page, "Edit paragraph moves focus into the box", /paragraph 1/i);
    await tabTo(page, /^Cancel$/);
    await press(page, "Enter");
    await settle(page, 200);
    await focusNotLost(page, "paragraph Cancel returns focus", /Edit paragraph 1/);
    await top(page);
    await tabTo(page, /Edit paragraph 1/);
    await press(page, "Enter");
    await settle(page, 200);
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" I would welcome the chance to discuss this.");
    await tabTo(page, /Save paragraph/);
    await press(page, "Enter");
    await settle(page, 1500);
    if (await has(page, /Is this accurate/)) {
      await tickAll(page);
      await top(page);
      await tabTo(page, /Save paragraph/);
      await press(page, "Enter");
      await settle(page, 1500);
    }
    await announced(page, "saving a paragraph is announced", /paragraph saved/i);
    await focusNotLost(page, "Save paragraph returns focus to Edit", /Edit paragraph 1/);
  } else skip("paragraph editing", "no editable paragraphs");
});

// ---- LinkedIn ---------------------------------------------------------------------------------------------------------------
journey = "linkedin";
await attempt("linkedin", async () => {
  await go(page, "/linkedin");
  const m = await tabTo(page, /Upload export/);
  await press(page, "Space");
  await settle(page, 150);
  check("method toggle works with Space", (await page.evaluate(() => document.activeElement.getAttribute("aria-pressed"))) === "true", m.name);
  await tabTo(page, /Your LinkedIn export/);
  await top(page);
  await tabTo(page, /Paste sections/);
  await press(page, "Space");
  await settle(page, 150);
  await tabTo(page, /Headline/);
  await page.keyboard.insertText("Student");
  await tabTo(page, /About/);
  await page.keyboard.insertText("I am a hardworking and passionate team player who is looking for opportunities. I built a churn model at Example Ltd that cut losses by 12%.");
  await tabTo(page, /Experience/);
  await page.keyboard.insertText("Data Analyst, Example Ltd, Jun 2024 - Present\nBuilt a churn model in Python that cut losses by 12%.\nPresented findings to senior managers.");
  await tabTo(page, /Skills/);
  await page.keyboard.insertText("SQL, Python, Tableau");
  await tabTo(page, /Review my profile/);
  await press(page, "Enter");
  await page.waitForURL(/\/linkedin\/[0-9a-f-]{20,}/, { timeout: 90000 });
  await settle(page, 800);
  ids.linkedin = page.url().match(/linkedin\/([^/?#]+)/)[1];
  check("a profile can be reviewed by keyboard", true);
  check("LinkedIn report has one h1", (await page.locator("h1").count()) === 1, await page.locator("h1").innerText());
  if (await has(page, /Skip\s+suggestion/)) {
    await tabTo(page, /^Skip suggestion for/);
    await press(page, "Enter");
    await settle(page, 1200);
    await focusNotLost(page, "LinkedIn Skip does not lose focus");
    await announced(page, "LinkedIn Skip is announced", /suggestion updated/i);
  } else skip("LinkedIn suggestions", "none on this profile");
  await go(page, `/linkedin/${ids.linkedin}`);
  if (await has(page, /Edit/)) {
    await tabTo(page, /^Edit/);
    await press(page, "Enter");
    await settle(page, 200);
    await focusNotLost(page, "LinkedIn Edit moves focus into the box", /wording|text|line|edit|headline|about|your/i);
    await tabTo(page, /^Cancel/);
    await press(page, "Enter");
    await settle(page, 200);
    await focusNotLost(page, "LinkedIn Cancel returns focus", /^Edit/);
  } else skip("LinkedIn edit", "no Edit control");
  await go(page, `/linkedin/${ids.linkedin}`);
  if (await has(page, /Download/)) {
    const dl = await tabTo(page, /Download/);
    const [d] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), press(page, "Enter")]);
    await d.saveAs(path.join(process.env.E2E_DOWNLOADS || "/tmp", d.suggestedFilename())).catch(() => {});
    check("LinkedIn download by keyboard", true, `${dl.name} -> ${d.suggestedFilename()}`);
  } else skip("LinkedIn download", "no download offered");
});

// ---- opportunities ----------------------------------------------------------------------------------------------------------
journey = "opportunities";
await attempt("opportunities", async () => {
  await go(page, "/opportunities");
  const first = await tabTo(page, /^Browse$/);
  await press(page, "ArrowRight");
  await settle(page, 200);
  const f = await focused(page);
  check("Browse / My applications: arrow keys move between tabs", f.role === "tab" && /My applications/.test(f.name), `${first.name} -> ${f.name}`);
  const panel = await page.locator("[role=tabpanel]").count();
  check("the tabs control a tab panel", panel === 1, `${panel} tabpanels`);
  await go(page, "/opportunities");
  await tabTo(page, /Closing in 30 days/);
  await press(page, "Space");
  await settle(page, 200);
  await announced(page, "filter result count is announced", /opportunit/i);
  await focusNotLost(page, "the filter switch keeps focus", /Closing in 30 days/);
  await top(page);
  await tabTo(page, /^Internship|^Placement|^Graduate|^Spring/);
  await press(page, "Space");
  await settle(page, 200);
  await focusNotLost(page, "the type filter keeps focus");
  await press(page, "Space");
  await top(page);
  await tabTo(page, /^All$/);
  await press(page, "Space");
  await settle(page, 200);
  await top(page);
  const t = await tabTo(page, /^Track /);
  check("each Track button says which role", /Track .+/.test(t.name), t.name);
  await press(page, "Enter");
  await settle(page, 1000);
  await announced(page, "tracking is announced", /track/i);
  await focusNotLost(page, "Track keeps focus", /^Tracking /);
  await press(page, "Enter");
  await settle(page, 200);
  const keep = await has(page, /Stop tracking this role/);
  check("pressing Tracking asks before stopping", keep);
  await focusNotLost(page, "the stop-tracking question takes focus", /stop tracking|keep it/i);
  await tabTo(page, /Keep it/);
  await press(page, "Enter");
  await settle(page, 200);
  await focusNotLost(page, "Keep it returns focus to Tracking", /^Tracking /);

  await go(page, "/opportunities");
  await tabTo(page, /^Browse$/);
  await press(page, "ArrowRight");
  await settle(page, 200);
  const mv = await tabTo(page, /Move .*to|Move to/);
  check("each Move control says which role", /Move .+ to/.test(mv.name), mv.name);
  await typeOption(page, { other: true });
  await settle(page, 1200);
  await focusNotLost(page, "moving an application keeps focus on its control", /Move/);
  await announced(page, "moving an application is announced", /moved|applied|interview|offer|saved/i);
});

// ---- dashboard --------------------------------------------------------------------------------------------------------------
journey = "dashboard";
await attempt("dashboard", async () => {
  await go(page, "/dashboard");
  const skipLink = await tabTo(page, /Skip to content/, { max: 3 });
  const shown = await page.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); return r.left >= 0 && r.width > 0; });
  check("the skip link is first and shows on focus", shown, `${skipLink.presses} Tab`);
  await press(page, "Enter");
  await settle(page, 150);
  await press(page, "Tab");
  const afterSkip = await page.evaluate(() => !!document.activeElement.closest("main"));
  check("the skip link jumps past the navigation", afterSkip);
  await go(page, "/dashboard");
  check("dashboard has one h1", (await page.locator("h1").count()) === 1, await page.locator("h1").innerText());
  const acc = await tabTo(page, /Account menu for/);
  await press(page, "Enter");
  await settle(page, 100);
  check("account menu opens by keyboard", await page.evaluate(() => document.activeElement.closest("details")?.open === true), acc.name);
  await press(page, "Escape");
  await settle(page, 100);
  check("Escape closes the account menu", await page.evaluate(() => !document.querySelector("header details")?.open));
  await focusNotLost(page, "Escape leaves focus on the account button", /Account menu/);
  await press(page, "Enter");
  await settle(page, 100);
  for (let i = 0; i < 4; i++) await press(page, "Tab");
  check("the account menu closes when focus leaves it", await page.evaluate(() => !document.querySelector("header details")?.open));
  await top(page);
  if (await has(page, /Share with my adviser|Shared with my adviser/)) {
    await tabTo(page, /Share(d)? with my adviser/);
    await press(page, "Enter");
    await settle(page, 900);
    await focusNotLost(page, "share with adviser keeps focus", /Share/);
    await announced(page, "share with adviser is announced", /./);
  } else skip("share with adviser", "not shown");
  await top(page);
  if (await has(page, /Stop tracking/)) {
    const st = await tabTo(page, /^Stop tracking/);
    await press(page, "Enter");
    await settle(page, 200);
    await focusNotLost(page, "Stop tracking question takes focus", /keep it|stop tracking/i);
    await tabTo(page, /Keep it/);
    await press(page, "Enter");
    await settle(page, 200);
    await focusNotLost(page, "Keep it returns focus", /Stop tracking/);
    check("stop tracking is named", /Stop tracking .+/.test(st.name), st.name);
  } else skip("stop tracking", "no tracked role");
  await top(page);
  if (await has(page, /Download PDF|Download Word|Download/)) {
    const before = await page.evaluate(() => [...document.querySelectorAll("main button")].filter((b) => /download|word|pdf/i.test(b.textContent)).length);
    if (before) {
      await tabTo(page, /(Download|Word|PDF).*:/i);
      const [d] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), press(page, "Enter")]);
      await settle(page, 800);
      check("application pack download by keyboard", true, d.suggestedFilename());
      await focusNotLost(page, "the download button keeps focus");
    }
  }
});

// ---- share ------------------------------------------------------------------------------------------------------------------
journey = "share";
await attempt("share", async () => {
  await go(page, `/share/manage/${ids.review}`);
  await top(page);
  const radio = await (async () => { for (let i = 0; i < 40; i++) { await press(page, "Tab"); const t = await page.evaluate(() => document.activeElement.type); if (t === "radio") return focused(page); } throw new Error("no radio reached"); })();
  check("share scope radios have names", radio.name.length > 3, radio.name.slice(0, 60));
  await press(page, "ArrowDown");
  await settle(page, 200);
  check("scope moves with arrow keys", await page.evaluate(() => document.activeElement.type === "radio" && document.activeElement.checked));
  await tabTo(page, /Stops working after/);
  await tabTo(page, /I understand/);
  await press(page, "Space");
  await tabTo(page, /Create link/);
  await press(page, "Enter");
  await settle(page, 1500);
  await announced(page, "the new link is announced", /link|copy|created/i);
  await focusNotLost(page, "Create link moves focus to the new link", /your link/i);
  await tabTo(page, /Copy link/);
  await press(page, "Enter");
  await settle(page, 300);
  await announced(page, "Copied is announced", /copied/i);
  await focusNotLost(page, "Copy link keeps focus", /Copy link/);
  const url = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  ids.shareUrl = url;
  await top(page);
  await attempt("share page as a recipient", async () => {
    if (!url) return skip("recipient page", "the clipboard could not be read in this browser");
    const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p2 = await other.newPage();
    const res = await p2.goto(url, { waitUntil: "load" });
    check("the shared page opens with no sign-in", res.status() === 200, `HTTP ${res.status()}`);
    const c = await p2.context().newCDPSession(p2);
    await c.send("Runtime.evaluate", { expression: AXE });
    const { result } = await c.send("Runtime.evaluate", { expression: `axe.run(document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"]}}).then(r=>JSON.stringify(r.violations.map(v=>v.impact+" "+v.id+" x"+v.nodes.length)))`, awaitPromise: true, returnByValue: true });
    const v = JSON.parse(result.value);
    check("shared page: no axe violations at 390px", v.length === 0, v.join(", "));
    const facts = await p2.evaluate(() => ({ lang: document.documentElement.lang, title: document.title, h1: document.querySelectorAll("h1").length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
    check("shared page: language, title, one h1, no sideways scroll", !!facts.lang && !!facts.title && facts.h1 === 1 && facts.overflow <= 1, JSON.stringify(facts));
    await other.close();
  });
  await go(page, "/share/manage");
  const off = await tabTo(page, /Switch off/);
  check("Switch off says which link", /Switch off .+/.test(off.name), off.name);
  await press(page, "Enter");
  await settle(page, 1200);
  await focusNotLost(page, "Switch off does not lose focus (the row changes)");
  await announced(page, "switching a link off is announced", /off|revoked|stopped/i);
});

// ---- privacy and export -----------------------------------------------------------------------------------------------------
journey = "privacy and export";
await attempt("privacy", async () => {
  await go(page, "/privacy");
  const s = await tabTo(page, /Deadline reminders by email/);
  const before = await page.evaluate(() => document.activeElement.getAttribute("aria-checked"));
  await press(page, "Space");
  await settle(page, 700);
  const after = await page.evaluate(() => document.activeElement.getAttribute("aria-checked"));
  await focusNotLost(page, "a saved switch keeps focus after saving", /Deadline reminders/);
  check("the switch changed", before !== after && after !== null, `${before} -> ${after}`);
  await announced(page, "the saved setting is announced", /saved|reminders/i);
  await press(page, "Space");
  await settle(page, 500);
  check("switch reachable", !!s);
  await top(page);
  const dl = await tabTo(page, /Download my data/);
  const [d] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), press(page, "Enter")]);
  await d.saveAs(path.join(process.env.E2E_DOWNLOADS || "/tmp", "export.zip")).catch(() => {});
  check("data export downloads by keyboard", /\.zip$/.test(d.suggestedFilename()), `${dl.name} -> ${d.suggestedFilename()}`);
  await tabTo(page, /Delete my account/);
  await press(page, "Enter");
  await settle(page, 100);
  await tabTo(page, /Type DELETE/);
  await page.keyboard.type("no");
  await tabTo(page, /Delete my account and data/);
  await press(page, "Enter");
  await settle(page, 1500);
  check("a wrong confirmation keeps the account", /\/privacy/.test(page.url()), new URL(page.url()).pathname + new URL(page.url()).search);
  await announced(page, "the wrong confirmation is announced or shown", /Type DELETE/i).catch(() => {});
  const a = await page.evaluate(() => { const e = document.querySelector('input[name=confirm]'); return { invalid: e?.getAttribute("aria-invalid"), desc: e?.getAttribute("aria-describedby"), open: e?.closest("details")?.open }; });
  check("the delete box says it is invalid and why", a.invalid === "true" && !!a.desc && a.open === true, JSON.stringify(a));
});

// ---- narrow: 390px and 200% zoom ---------------------------------------------------------------------------------------------
for (const [label, w, h] of [["390px", 390, 844], ["200% zoom (640x450)", 640, 450]]) {
  journey = `narrow ${label}`;
  await page.setViewportSize({ width: w, height: h });
  await attempt("source and feedback", async () => {
    await go(page, `/reviews/${ids.review}`);
    const sum = await tabTo(page, /Results and feedback/i);
    await press(page, "Enter");
    await settle(page, 100);
    check("feedback navigation opens by keyboard", await page.evaluate(() => document.activeElement.closest("details")?.open === true), sum.name);
    const src = await tabTo(page, /Source document/);
    check("source document is reachable from the feedback navigation", !!src);
    await press(page, "Enter");
    await page.waitForURL(/\/source/, { timeout: 60000 });
    await settle(page);
    const size = await page.evaluate(() => { const pre = document.querySelector("pre"); return { font: pre ? parseFloat(getComputedStyle(pre).fontSize) : null, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
    check("no sideways page scroll on the source page", size.overflow <= 1, JSON.stringify(size));
    await go(page, `/reviews/${ids.review}`);
    const check1 = await page.evaluate(() => document.querySelector('details a[href*="/checks/"]')?.getAttribute("href"));
    await tabTo(page, /Results and feedback/i);
    await press(page, "Enter");
    await settle(page, 100);
    const lk = await tabTo(page, /Score \d+/);
    await press(page, "Enter");
    await page.waitForURL(/\/checks\//, { timeout: 60000 });
    await settle(page);
    check("a check page opens from the feedback navigation", !!check1, lk.name);
    await go(page, `/reviews/${ids.review}/lines`);
    await tabTo(page, /^Next$/);
    const r = await page.evaluate(() => { const b = document.activeElement.getBoundingClientRect(); return { inView: b.top >= 0 && b.bottom <= innerHeight, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
    check("line editor controls stay in view with no sideways scroll", r.inView && r.overflow <= 1, JSON.stringify(r));
  });
  await page.setViewportSize({ width: 1280, height: 900 });
}

journey = "focus safety net";
await attempt("not stolen", async () => {
  // The one place a pointer is used: the net must leave alone someone who clicks away, and must not pull focus from a field.
  await go(page, "/privacy");
  await tabTo(page, /Deadline reminders by email/);
  await page.mouse.click(5, 5);
  await settle(page, 400);
  check("a click on the page itself is left alone", await page.evaluate(() => document.activeElement === document.body));
  await go(page, `/reviews/${ids.review}/verbs`);
  await tabTo(page, /Search verbs/);
  await page.keyboard.type("led");
  await settle(page, 400);
  await focusNotLost(page, "typing in a field that re-renders the page stays in the field", /Search verbs/);
});

journey = "whole run";
check("no uncaught page errors", errors.length === 0, errors.join(" / "));
if (process.env.E2E_STATE) await ctx.storageState({ path: process.env.E2E_STATE });
await browser.close();

const counts = results.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});
console.log(`\nPASS ${counts.PASS ?? 0}, FAIL ${counts.FAIL ?? 0}, SKIP ${counts.SKIP ?? 0}`);
if (process.env.E2E_OUT) fs.writeFileSync(process.env.E2E_OUT, JSON.stringify({ ids, results }, null, 1));
process.exit(counts.FAIL ? 1 : 0);
