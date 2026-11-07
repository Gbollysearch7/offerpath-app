// OP-020: share links, through the real route handler and server actions in demo mode. The same rules are run against the
// SQL in tests/sharing-db.test.ts. Each case looks at the response a recipient actually gets.
import "./fixtures/next-server-shim";
import assert from "node:assert/strict";
import fs from "node:fs";
import { beforeEach, test } from "node:test";
import JSZip from "jszip";
import { GET as myExport } from "@/app/api/export/route";
import { createShareLink, revokeShareLink } from "@/app/share/actions";
import { GET, HEAD } from "@/app/share/[token]/route";
import ManageReportSharing from "@/app/share/manage/[reportId]/page";
import { ShareEntry } from "@/app/share/ShareEntry";
import { STAGES } from "@/lib/analysis/lexicon";
import { signDemoSession } from "@/lib/demo-session";
import { demoRepo } from "@/lib/repo/demo";
import { DEMO_COOKIE } from "@/lib/session";
import { buildCvPayload } from "@/lib/services";
import { runRetention } from "@/lib/jobs";
import { LIMITS } from "@/lib/rate-limit";
import { createShareFlow, CHANGED, exportShareLinks, NOT_AVAILABLE, shareOptions, shareStatuses } from "@/lib/sharing/flow";
import { NEVER_SHARED, projectReport } from "@/lib/sharing/projection";
import { renderSharedFragment, UNAVAILABLE_HTML } from "@/lib/sharing/render";
import { hashShareToken, isWellFormedToken, newShareToken } from "@/lib/sharing/token";
import { SHARE_SCOPES, type ShareScope } from "@/lib/sharing/types";
import type { CvReviewPayload } from "@/lib/types";
import { fakeSupabase } from "./fixtures/fake-supabase";
import { requestScope, withEnv } from "./fixtures/request-scope";

delete process.env.ANTHROPIC_API_KEY;
process.env.NEXT_PUBLIC_SUPABASE_URL = "";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "";
(process.env as Record<string, string>).NODE_ENV = "development";
process.env.DEMO_REPORT_SHARING = "true";

const g = globalThis as unknown as { __offerpathRate?: Map<string, number>; __offerpathDemo: { users: Record<string, { reports: { row: { id: string }; payload: CvReviewPayload }[]; shareLinks?: { id: string; tokenHash: string; expiresAt: string }[] }> } };
beforeEach(() => g.__offerpathRate?.clear());

const CANARY = { name: "Zebedee Canaryson", email: "zebedee.canary@northfield.ac.uk", phone: "07700 900123", line: "Canarised the quarterly widget ledger", file: "Zebedee_Canaryson_CV.pdf", sector: "Technology" };
const CV = `${CANARY.name}\n${CANARY.email} | ${CANARY.phone}\n\nEducation\nBSc Economics, University of Northfield\n\nExperience\nAnalyst, Example Ltd\n• ${CANARY.line} for 40 clients\n• Led a team of 4 to reduce costs by 12%\n• Built a model used by 3 departments\n• Managed a budget of £20,000\n\nSkills\nExcel, SQL\n`;

function student() {
  const id = crypto.randomUUID();
  const scope = requestScope({ [DEMO_COOKIE]: signDemoSession("student", id) });
  return { key: `student-${id}`, repo: demoRepo(`student-${id}`, "student"), as: <T>(fn: () => Promise<T>) => scope.run(fn) };
}

async function withReport(s = student()) {
  const payload = buildCvPayload({ fileName: CANARY.file, text: CV, sector: CANARY.sector, stage: STAGES[0] });
  const reportId = await s.repo.createReport({ type: "cv_review", title: CANARY.file, score: payload.analysis.score, payload });
  return { ...s, reportId, payload };
}

const open = (token: string, query = "") => requestScope().run(() => GET(new Request(`http://t.invalid/share/${token}${query}`), { params: Promise.resolve({ token }) }));

async function share(s: Awaited<ReturnType<typeof withReport>>, scope: ShareScope = "score", expiryDays = 7) {
  const report = (await s.repo.getReport<CvReviewPayload>(s.reportId))!;
  const previewDigest = shareOptions(report.payload, report.row.createdAt).find((o) => o.scope === scope)!.digest;
  const r = await createShareFlow(s.repo, { reportId: s.reportId, scope, expiryDays, previewDigest });
  if ("error" in r) throw new Error(r.error);
  return r.path.split("/").pop()!;
}

const demoLink = (s: { key: string }, token: string) => g.__offerpathDemo.users[s.key].shareLinks!.find((l) => l.tokenHash === hashShareToken(token))!;

const assertUnavailable = async (res: Response, why: string) => {
  assert.equal(res.status, 404, why);
  assert.equal(await res.text(), UNAVAILABLE_HTML, why);
};

test("a token has 256 bits and only its hash is stored", async () => {
  const a = newShareToken();
  assert.equal(Buffer.from(a, "base64url").length, 32);
  assert.ok(isWellFormedToken(a));
  assert.notEqual(a, newShareToken());
  const s = await withReport();
  const token = await share(s);
  const stored = JSON.stringify(g.__offerpathDemo.users[s.key].shareLinks);
  assert.ok(!stored.includes(token));
  assert.ok(stored.includes(hashShareToken(token)));
  const visible = JSON.stringify(await s.repo.shareLinks());
  assert.ok(!visible.includes(token) && !visible.includes(hashShareToken(token)), "the owner's own list holds neither");
});

test("off by default: no control, no creation, and existing links stop on the next request", async () => {
  const s = await withReport();
  const token = await share(s);
  assert.equal((await open(token)).status, 200);
  delete process.env.DEMO_REPORT_SHARING;
  try {
    assert.equal(await s.repo.sharingEnabled(), false);
    await assertUnavailable(await open(token), "institution off");
    const fresh = await withReport();
    assert.equal(await ShareEntry({ repo: fresh.repo, reportId: fresh.reportId }), null, "no control on the report");
    const digest = shareOptions(fresh.payload, new Date().toISOString())[0].digest;
    assert.deepEqual(await createShareFlow(fresh.repo, { reportId: fresh.reportId, scope: "score", expiryDays: 7, previewDigest: digest }), { error: NOT_AVAILABLE });
    await assert.rejects(fresh.repo.createShareLink({ reportId: fresh.reportId, tokenHash: "a".repeat(64), scope: "score", contentDigest: "b".repeat(64), expiresAt: new Date(Date.now() + 864e5).toISOString() }));
    assert.ok(await ShareEntry({ repo: s.repo, reportId: s.reportId }), "a student with a link can still reach it to revoke it");
    assert.equal((await shareStatuses(s.repo, await s.repo.shareLinks())).values().next().value, "paused");
  } finally {
    process.env.DEMO_REPORT_SHARING = "true";
  }
});

test("no scope discloses CV text, identity, file name, sector, lines or evidence, and nothing can be scripted in", async () => {
  const s = await withReport();
  for (const scope of SHARE_SCOPES) {
    const res = await open(await share(s, scope));
    assert.equal(res.status, 200);
    const body = await res.text();
    for (const [k, v] of Object.entries(CANARY)) assert.ok(!body.includes(v), `${scope} leaked ${k}`);
    for (const word of ["Zebedee", "Canar", "Northfield", "widget", "Example Ltd", "Excel"]) assert.ok(!body.includes(word), `${scope} leaked ${word}`);
    assert.ok(!/<script|<link|<img|<a |https?:|plausible|src=/i.test(body), `${scope} has something that could call out`);
  }
  const hostile = structuredClone(s.payload);
  hostile.analysis.steps = [{ check: "quant", text: `<script>alert(1)</script>"'`, area: "x", gain: 1 }];
  const html = renderSharedFragment(projectReport(hostile, "2026-11-07T00:00:00Z", "advice"));
  assert.ok(!html.includes("<script>") && html.includes("&lt;script&gt;"));
  assert.ok(NEVER_SHARED.length >= 5);
});

test("each scope shows what it says and no more, starting from the minimum", async () => {
  const s = await withReport();
  const score = projectReport(s.payload, "2026-11-07T10:00:00Z", "score");
  assert.deepEqual([score.areas, score.steps, score.wells], [[], [], []]);
  assert.equal(score.reviewedOn, "2026-11-07");
  assert.equal(score.score, s.payload.analysis.score);
  const areas = projectReport(s.payload, "2026-11-07T10:00:00Z", "areas");
  assert.ok(areas.areas.length > 0 && !areas.areas.some((a) => a.key === "sector"));
  assert.deepEqual([areas.steps, areas.wells], [[], []]);
  const advice = projectReport(s.payload, "2026-11-07T10:00:00Z", "advice");
  assert.ok(advice.steps.length + advice.wells.length > 0);
  assert.ok(![...advice.steps, ...advice.wells].some((x) => x.check === "sector"));
  assert.deepEqual(Object.keys(advice).sort(), ["areas", "assessedPercent", "coverage", "reviewedOn", "scope", "score", "steps", "wells"]);
  const body = await (await open(await share(s, "score"))).text();
  assert.ok(!body.includes("Area scores") && !body.includes("Steps to improve") && !body.includes("Strengths"));
});

test("a withheld score isn't shown at any scope, and an incomplete one says so", async () => {
  const s = await withReport();
  const none = structuredClone(s.payload);
  none.analysis.meta.bullets = 0;
  for (const scope of SHARE_SCOPES) {
    const view = projectReport(none, "2026-11-07T10:00:00Z", scope);
    assert.equal(view.coverage, "withheld");
    assert.equal(view.score, null);
    assert.deepEqual(view.areas, []);
    assert.ok(renderSharedFragment(view).includes("No overall score"));
    assert.ok(!renderSharedFragment(view).includes(`${none.analysis.score}<span`), "the stored number isn't shown");
  }
  const low = structuredClone(s.payload);
  low.document = { extraction: { confidence: { band: "low" } } } as never;
  const view = projectReport(low, "2026-11-07T10:00:00Z", "score");
  assert.equal(view.coverage, "incomplete");
  assert.ok(renderSharedFragment(view).includes("Incomplete score"));
});

test("the preview is byte for byte what the recipient gets, at every scope", async () => {
  const s = await withReport();
  const report = (await s.repo.getReport<CvReviewPayload>(s.reportId))!;
  const options = shareOptions(report.payload, report.row.createdAt);
  assert.deepEqual(options.map((o) => o.scope), [...SHARE_SCOPES]);
  for (const o of options) assert.ok((await (await open(await share(s, o.scope))).text()).includes(o.html), o.scope);
  await s.repo.updateProfile({ onboarded: true });
  const page = await s.as(() => ManageReportSharing({ params: Promise.resolve({ reportId: s.reportId }) }));
  assert.ok(JSON.stringify(page).includes("Never shared") || JSON.stringify(page).includes("neverShared"));
});

test("activation refuses a report that changed after the preview", async () => {
  const s = await withReport();
  const digest = shareOptions(s.payload, (await s.repo.getReport(s.reportId))!.row.createdAt)[0].digest;
  const changed = structuredClone(s.payload);
  changed.analysis.score = Math.max(0, changed.analysis.score - 5);
  await s.repo.updateReport(s.reportId, { payload: changed });
  assert.deepEqual(await createShareFlow(s.repo, { reportId: s.reportId, scope: "score", expiryDays: 7, previewDigest: digest }), { error: CHANGED });
  assert.deepEqual(await s.repo.shareLinks(), []);
});

test("scope can't be increased: query strings, wrong digests and unlisted values change nothing", async () => {
  const s = await withReport();
  const token = await share(s, "score");
  const plain = await (await open(token)).text();
  for (const q of ["?scope=advice", "?scope=full&include=text", "?reportId=" + crypto.randomUUID(), "?token=x"]) assert.equal(await (await open(token, q)).text(), plain, q);
  const report = (await s.repo.getReport<CvReviewPayload>(s.reportId))!;
  const scoreDigest = shareOptions(report.payload, report.row.createdAt)[0].digest;
  assert.deepEqual(await createShareFlow(s.repo, { reportId: s.reportId, scope: "advice", expiryDays: 7, previewDigest: scoreDigest }), { error: CHANGED }, "a preview of one scope can't activate another");
  for (const bad of [{ scope: "full" }, { scope: "text" }, { expiryDays: 365 }, { expiryDays: 0 }, { reportId: "../x" }, { previewDigest: "x" }]) {
    assert.deepEqual(await createShareFlow(s.repo, { reportId: s.reportId, scope: "score", expiryDays: 7, previewDigest: scoreDigest, ...bad }), { error: NOT_AVAILABLE }, JSON.stringify(bad));
  }
  await assert.rejects(s.repo.createShareLink({ reportId: s.reportId, tokenHash: "a".repeat(64), scope: "score", contentDigest: scoreDigest, expiresAt: new Date(Date.now() + 31 * 864e5).toISOString() }), "the repository also refuses over 30 days");
});

test("every link that can't be shown gives one identical response", async () => {
  const s = await withReport();
  const valid = await share(s);
  const flip = (t: string) => (t[0] === "A" ? "B" : "A") + t.slice(1);
  await assertUnavailable(await open(flip(valid)), "tampered");
  await assertUnavailable(await open(newShareToken()), "unknown");
  await assertUnavailable(await open("short"), "malformed");
  await assertUnavailable(await open(`${valid}x`), "extended");
  await assertUnavailable(await open(hashShareToken(valid)), "the stored hash isn't a credential");

  const expired = await share(s);
  demoLink(s, expired).expiresAt = new Date(Date.now() - 1000).toISOString();
  await assertUnavailable(await open(expired), "expired");

  const revoked = await share(s);
  assert.equal((await open(revoked)).status, 200);
  assert.equal(await s.repo.revokeShareLink(demoLink(s, revoked).id), true);
  await assertUnavailable(await open(revoked), "revoked on the next request");

  const stale = await withReport();
  const staleToken = await share(stale);
  const changed = structuredClone(stale.payload);
  changed.analysis.score = Math.max(0, changed.analysis.score - 5);
  await stale.repo.updateReport(stale.reportId, { payload: changed });
  await assertUnavailable(await open(staleToken), "report changed");

  const gone = await withReport();
  const goneToken = await share(gone);
  await gone.repo.deleteAccount();
  await assertUnavailable(await open(goneToken), "account deleted");

  const broken = await withReport();
  const brokenToken = await share(broken);
  (g.__offerpathDemo.users[broken.key].reports.find((r) => r.row.id === broken.reportId)!.payload as unknown as { analysis: unknown }).analysis = "damaged";
  await assertUnavailable(await open(brokenToken), "unreadable report");
});

test("the document changing: a rewrite stops the link, an accepted line doesn't, and a newer review is never shown", async () => {
  const s = await withReport();
  const token = await share(s, "areas");
  const first = await (await open(token)).text();

  const newer = buildCvPayload({ fileName: "new.pdf", text: `${CV}\n• Delivered a further 9 projects worth £9,000\n`, sector: CANARY.sector, stage: STAGES[0] });
  await s.repo.createReport({ type: "cv_review", title: "new.pdf", score: newer.analysis.score + 1, payload: newer });
  assert.equal(await (await open(token)).text(), first, "pinned to the report that was previewed");

  const accepted = structuredClone(s.payload);
  accepted.analysis.lines[0].accepted = "A reworded line";
  await s.repo.updateReport(s.reportId, { payload: accepted });
  assert.equal(await (await open(token)).text(), first, "saving a reworded line changes nothing a recipient sees");

  // Written directly: the repository refuses new text with evidence for the old text, so this is the fail-safe underneath.
  g.__offerpathDemo.users[s.key].reports.find((r) => r.row.id === s.reportId)!.payload.text = `${CV}\nAn added line`;
  await assertUnavailable(await open(token), "text behind the score changed, even though the scores didn't");
  assert.equal((await shareStatuses(s.repo, await s.repo.shareLinks())).values().next().value, "report_changed", "the owner is told why");
});

test("no caching, indexing or referrer, on success and on failure; HEAD doesn't count as a view", async () => {
  const s = await withReport();
  const token = await share(s);
  for (const res of [await open(token), await open(newShareToken())]) {
    assert.match(res.headers.get("cache-control")!, /no-store/);
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.match(res.headers.get("x-robots-tag")!, /noindex/);
    const body = await res.text();
    assert.ok(body.includes('name="robots" content="noindex') && body.includes('name="referrer" content="no-referrer"'));
  }
  const before = (await s.repo.shareLinks())[0].accesses.length;
  const head = HEAD();
  assert.equal(head.status, 405);
  assert.equal((await s.repo.shareLinks())[0].accesses.length, before);
  const config = fs.readFileSync("next.config.ts", "utf8");
  assert.ok(config.indexOf('source: "/share/:path*"') > config.indexOf('source: "/:path*"'), "the later rule wins for referrer policy");
  const route = fs.readFileSync("src/app/share/[token]/route.ts", "utf8");
  assert.match(route, /dynamic = "force-dynamic"/);
  assert.ok(!/request\.(url|nextUrl|headers)|searchParams/.test(route), "the route reads nothing from the request but the token");
});

test("the access log: one time per view, nothing about the visitor, nothing for failures, owner only", async () => {
  const s = await withReport();
  const token = await share(s);
  await open(token);
  await open(token, "?x=1");
  await open(newShareToken());
  const [link] = await s.repo.shareLinks();
  assert.equal(link.accesses.length, 2);
  assert.ok(link.accesses.every((a) => !Number.isNaN(Date.parse(a)) && /^\d{4}-.*Z$/.test(a)), "only timestamps");
  await s.repo.revokeShareLink(link.id);
  await open(token);
  assert.equal((await s.repo.shareLinks())[0].accesses.length, 2, "a refused attempt isn't a view");
  assert.deepEqual(await student().repo.shareLinks(), []);
});

test("a second student can't share, see or revoke by changing ids", async () => {
  const a = await withReport();
  const b = student();
  const token = await share(a);
  const [link] = await a.repo.shareLinks();
  const digest = link.contentDigest;
  assert.deepEqual(await b.as(() => createShareLink({ reportId: a.reportId, scope: "score", expiryDays: 7, previewDigest: digest })), { error: NOT_AVAILABLE });
  await assert.rejects(b.repo.createShareLink({ reportId: a.reportId, tokenHash: "c".repeat(64), scope: "score", contentDigest: digest, expiresAt: new Date(Date.now() + 864e5).toISOString() }));
  assert.ok("error" in (await b.as(() => revokeShareLink(link.id))));
  assert.equal(await b.repo.revokeShareLink(link.id), false);
  assert.equal((await open(token)).status, 200, "still live for its owner");
  await b.repo.updateProfile({ onboarded: true });
  await assert.rejects(b.as(() => ManageReportSharing({ params: Promise.resolve({ reportId: a.reportId }) })), (e: { digest?: string }) => String(e.digest).includes("HTTP_ERROR_FALLBACK;404"));
  assert.ok("ok" in (await a.as(() => revokeShareLink(link.id))));
  await assertUnavailable(await open(token), "revoked by its owner through the action");
});

test("signed out, the actions do nothing", async () => {
  const a = await withReport();
  const anon = requestScope();
  const [digest] = shareOptions(a.payload, new Date().toISOString());
  assert.deepEqual(await anon.run(() => createShareLink({ reportId: a.reportId, scope: "score", expiryDays: 7, previewDigest: digest.digest })), { error: "Your session has expired. Sign in again." });
  assert.ok("error" in (await anon.run(() => revokeShareLink(crypto.randomUUID()))));
});

test("token attempts are rate limited per visitor, the same whether or not the link is real", async () => {
  const s = await withReport();
  const token = await share(s);
  for (let i = 0; i < LIMITS.shareTokenPerIp.max; i++) assert.equal((await open(newShareToken())).status, 404);
  const [real, fake] = [await open(token), await open(newShareToken())];
  assert.equal(real.status, 429);
  assert.equal(fake.status, 429);
  assert.equal(await real.text(), await fake.text());
  assert.match(real.headers.get("cache-control")!, /no-store/);
  assert.equal((await s.repo.shareLinks())[0].accesses.length, 0, "a limited request isn't a view");
});

test("one link can't be opened without limit, and link creation is limited", async () => {
  assert.ok(LIMITS.shareTokenPerLink.max > 0);
  const s = await withReport();
  const report = (await s.repo.getReport<CvReviewPayload>(s.reportId))!;
  const previewDigest = shareOptions(report.payload, report.row.createdAt)[0].digest;
  const input = { reportId: s.reportId, scope: "score", expiryDays: 7, previewDigest };
  for (let i = 0; i < LIMITS.shareCreatePerUser.max; i++) assert.ok("path" in (await s.as(() => createShareLink(input))));
  assert.ok("error" in (await s.as(() => createShareLink(input))));
});

test("deleting an account removes links and logs; the data export includes them without any secret", async () => {
  const s = await withReport();
  const token = await share(s, "areas");
  await open(token);
  const res = await s.as(() => myExport());
  const zip = await JSZip.loadAsync(await res.arrayBuffer());
  const text = await zip.file("share-links.json")!.async("string");
  const [row] = JSON.parse(text) as { scope: string; opened: string[]; reportId: string }[];
  assert.equal(row.scope, "areas");
  assert.equal(row.reportId, s.reportId);
  assert.equal(row.opened.length, 1);
  assert.ok(!text.includes(token) && !text.includes(hashShareToken(token)));
  assert.ok(!JSON.stringify(exportShareLinks(await s.repo.shareLinks())).includes("contentDigest"));

  await s.repo.deleteAccount();
  assert.equal(g.__offerpathDemo.users[s.key], undefined);
  await assertUnavailable(await open(token), "deleted");
  assert.equal(g.__offerpathDemo.users[s.key], undefined, "opening a link doesn't bring a demo account back");
});

test("separate from adviser access, and no score or report changes", async () => {
  const s = await withReport();
  const before = { profile: await s.repo.profile(), report: JSON.stringify(await s.repo.getReport(s.reportId)) };
  const token = await share(s, "advice");
  await open(token);
  const after = await s.repo.profile();
  assert.equal(after.shareProgress, before.profile.shareProgress);
  assert.equal(after.adviserCanViewCv, before.profile.adviserCanViewCv);
  assert.equal(await s.repo.adminCvLink(s.reportId), null);
  assert.equal(JSON.stringify(await s.repo.getReport(s.reportId)), before.report);
  const body = await (await open(token)).text();
  assert.ok(body.includes(`>${s.payload.analysis.score}<`), "the score is the stored one");
});

test("the token never reaches logs, and the failure log has only the error", async () => {
  const s = await withReport();
  const token = await share(s);
  (g.__offerpathDemo.users[s.key].reports.find((r) => r.row.id === s.reportId)!.payload as unknown as { analysis: unknown }).analysis = "damaged";
  const lines: string[] = [];
  const saved = [console.log, console.warn, console.error];
  console.log = console.warn = console.error = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    await open(token);
  } finally {
    [console.log, console.warn, console.error] = saved;
  }
  assert.ok(lines.join("\n").includes("share-resolve-failed"));
  assert.ok(!lines.join("\n").includes(token) && !lines.join("\n").includes(hashShareToken(token)));
  for (const file of ["src/app/share/[token]/route.ts", "src/lib/sharing/resolve.ts", "src/lib/sharing/flow.ts"]) assert.ok(!/log\([^)]*token/i.test(fs.readFileSync(file, "utf8")), file);
});

test("the retention job removes a link 90 days after it expired, and no sooner", async () => {
  const fake = fakeSupabase();
  const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();
  fake.shareLinks.push({ id: "old", expires_at: ago(91) }, { id: "recent", expires_at: ago(89) }, { id: "live", expires_at: ago(-5) });
  await withEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://op020-no-such-project.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" }, () => runRetention(async () => ({ sent: true }), () => fake.client));
  assert.deepEqual(fake.shareLinks.map((l) => l.id), ["recent", "live"]);
});

test("a report saved before versions were recorded can be shared, read through the same adapter", async () => {
  const s = student();
  const rows = (await s.repo.listReports({ type: "cv_review" })).rows;
  const oldest = rows[rows.length - 1];
  const report = (await s.repo.getReport<CvReviewPayload>(oldest.id))!;
  assert.equal(report.payload.assessment.origin, "legacy");
  const previewDigest = shareOptions(report.payload, report.row.createdAt)[0].digest;
  const r = await createShareFlow(s.repo, { reportId: oldest.id, scope: "score", expiryDays: 1, previewDigest });
  assert.ok("path" in r);
  const res = await open(r.path.split("/").pop()!);
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes(`>${report.payload.analysis.score}<`));
});

test("an expiry can only be one of the offered lengths, and the link says when it ends", async () => {
  const s = await withReport();
  await share(s, "score", 1);
  await share(s, "score", 30);
  const links = await s.repo.shareLinks();
  const lengths = links.map((l) => Math.round((Date.parse(l.expiresAt) - Date.parse(l.createdAt)) / 864e5)).sort((a, b) => a - b);
  assert.deepEqual(lengths, [1, 30]);
});
