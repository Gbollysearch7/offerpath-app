// OP-025: the real server actions, in a request context, on demo-mode sessions, with a simulated provider. Covers the
// workflows outside the CV path: letters, tailoring, line rewrites, and a session that has already expired.
import "./fixtures/next-server-shim";
import { apiError, message, notJson, outage, provider, type Reply } from "./fixtures/provider-stub";
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { rewriteLine, uploadCv } from "@/app/actions/cv";
import { createLetterDraft, createLetterReview, improveLetter } from "@/app/actions/letters";
import { createTailor, createTailoredVersion } from "@/app/actions/tailor";
import { signDemoSession } from "@/lib/demo-session";
import { JOB_POLICY } from "@/lib/analysis/job-state";
import { resetProviderState } from "@/lib/provider";
import { demoRepo, type DemoJob } from "@/lib/repo/demo";
import { AI_LIMITS, type Repo } from "@/lib/repo/types";
import { DEMO_COOKIE } from "@/lib/session";
import type { CoverLetterPayload, CvReviewPayload, TailorPayload } from "@/lib/types";
import { requestScope } from "./fixtures/request-scope";

const g = globalThis as unknown as { __offerpathDemo: { users: Record<string, { ai: Record<string, number> }>; jobs?: DemoJob[] } };
const day = () => new Date().toISOString().slice(0, 10);

const AD = "We are looking for a graduate analyst to join our team in Leeds. You will need strong Excel skills and experience with financial modelling, stakeholder management and written reports. Desirable: SQL. The role involves building dashboards and presenting to clients.";

/** A signed-in student: runs an action as them, and reads their data directly. */
async function signIn() {
  const id = crypto.randomUUID();
  const repo = demoRepo(`student-${id}`, "student");
  await repo.profile();
  const scope = requestScope({ [DEMO_COOKIE]: signDemoSession("student", id) });
  return { repo, as: <T>(fn: () => Promise<T>) => scope.run(fn) };
}
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const letterForm = (extra: Record<string, string> = {}) => form({ tailorReportId: "new", jobTitle: "Graduate Analyst", employer: "Northbank", jobText: AD, ...extra });
const CLIENT_KEY = "11111111-2222-4333-8444-555555555555";
const letters = async (repo: Repo) => (await repo.listReports({ type: "cover_letter" })).total;
const usedOf = (repo: Repo, kind: "letter" | "tailor" | "line_rewrite") => repo.aiUsedToday(kind);
const jobs = (repo: Repo) => (g.__offerpathDemo.jobs ?? []).filter((j) => j.userId === repo.userId);

const goodLetter: Reply = ({ model }) => message(model, JSON.stringify({ paragraphs: [{ text: "Dear Hiring Manager,", sources: ["UK CONVENTION"] }, { text: "I am applying for the Graduate Analyst role at Northbank, drawing on my CV.", sources: ["CV · EXPERIENCE"] }, { text: "Yours faithfully,\nJordan Reed", sources: ["UK CONVENTION"] }] }));
const goodTailor = (summary: string): Reply => ({ model }) => message(model, JSON.stringify({ summary, bullets: [], skills: [], notEvidenced: [] }));

beforeEach(() => {
  resetProviderState();
  provider.calls = 0;
  provider.seen = [];
  provider.reply = outage;
  if (g.__offerpathDemo) g.__offerpathDemo.jobs = [];
});

test("session expired before the action: told to sign in, nothing called, nothing charged, nothing saved", async () => {
  const scope = requestScope();
  const f = new FormData();
  f.set("file", new File([new Uint8Array([1, 2, 3])], "cv.pdf"));
  for (const r of [
    await scope.run(() => uploadCv(f)),
    await scope.run(() => createLetterDraft(letterForm())),
    await scope.run(() => improveLetter("anything")),
    await scope.run(() => createTailor(form({ text: AD }))),
    await scope.run(() => createTailoredVersion("anything")),
    await scope.run(() => rewriteLine("anything", 0, 0)),
  ]) {
    assert.match(r.error!, /session has expired/i);
  }
  assert.equal(provider.calls, 0);
});

test("letter draft, provider down: a rule-based draft, partial, the use back, and the student told why", async () => {
  const { repo, as } = await signIn();
  const before = await letters(repo);
  const r = await as(() => createLetterDraft(letterForm()));
  assert.ok(r.id, JSON.stringify(r));
  assert.equal(r.notice, "ai_unavailable");
  assert.equal(await letters(repo), before + 1);
  assert.equal(await usedOf(repo, "letter"), 0);
  assert.equal(jobs(repo)[0].status, "partial");
  assert.equal(jobs(repo)[0].resultId, r.id);
});

test("letter draft, invalid output: treated the same", async () => {
  provider.reply = notJson;
  const { repo, as } = await signIn();
  const r = await as(() => createLetterDraft(letterForm()));
  assert.equal(r.notice, "ai_unavailable");
  assert.equal(await usedOf(repo, "letter"), 0);
});

test("letter draft at the limit: rule-based, said plainly, provider not called, count not climbing", async () => {
  provider.reply = goodLetter;
  const { repo, as } = await signIn();
  g.__offerpathDemo.users[repo.userId].ai[`${day()}:letter`] = AI_LIMITS.letter;
  const r = await as(() => createLetterDraft(letterForm()));
  assert.ok(r.id);
  assert.equal(r.notice, "quota");
  assert.equal(provider.calls, 0);
  assert.equal(await usedOf(repo, "letter"), AI_LIMITS.letter);
});

test("letter draft, repeat clicks with one attempt key: one letter, one use, one call, the same id", async () => {
  provider.reply = goodLetter;
  const { repo, as } = await signIn();
  const before = await letters(repo);
  const key = { key: CLIENT_KEY };
  const [a, b, c] = await Promise.all([as(() => createLetterDraft(letterForm(key))), as(() => createLetterDraft(letterForm(key))), as(() => createLetterDraft(letterForm(key)))]);
  assert.ok(a.id);
  assert.equal(b.id, a.id);
  assert.equal(c.id, a.id);
  assert.equal(await letters(repo), before + 1);
  assert.equal(provider.calls, 1);
  assert.equal(await usedOf(repo, "letter"), 1);
  // And after it has landed, for ever.
  jobs(repo)[0].finishedMs = 1;
  assert.equal((await as(() => createLetterDraft(letterForm(key)))).id, a.id);
  assert.equal(provider.calls, 1);
});

test("letter draft from an old tab with no key: a quick repeat is a repeat; a deliberate one later is a new letter", async () => {
  provider.reply = goodLetter;
  const { repo, as } = await signIn();
  const before = await letters(repo);
  const a = await as(() => createLetterDraft(letterForm()));
  const b = await as(() => createLetterDraft(letterForm()));
  assert.equal(b.id, a.id);
  assert.equal(await letters(repo), before + 1);
  jobs(repo)[0].finishedMs = Date.now() - (JOB_POLICY.repeatWindowSeconds + 1) * 1000;
  const c = await as(() => createLetterDraft(letterForm()));
  assert.notEqual(c.id, a.id);
  assert.equal(await usedOf(repo, "letter"), 2);
});

test("the same attempt key with different content isn't answered with the other letter", async () => {
  provider.reply = goodLetter;
  const { as } = await signIn();
  const a = await as(() => createLetterDraft(letterForm({ key: CLIENT_KEY })));
  const b = await as(() => createLetterDraft(letterForm({ key: CLIENT_KEY, employer: "Harlow" })));
  assert.notEqual(a.id, b.id);
});

test("letter review, repeat clicks: one report", async () => {
  const { repo, as } = await signIn();
  const before = await letters(repo);
  const letterText = "Dear Hiring Manager,\n\n" + "I am writing to apply for this role because my experience fits what you describe. ".repeat(8);
  const fields = { letterText, key: CLIENT_KEY };
  const [a, b] = await Promise.all([as(() => createLetterReview(letterForm(fields))), as(() => createLetterReview(letterForm(fields)))]);
  assert.ok(a.id, JSON.stringify(a));
  assert.equal(a.id, b.id);
  assert.equal(await letters(repo), before + 1);
});

test("improve a letter, provider down: an error, no new report, the letter untouched, the use back", async () => {
  const { repo, as } = await signIn();
  const original = (await repo.latestReport<CoverLetterPayload>("cover_letter"))!;
  const before = await letters(repo);
  const r = await as(() => improveLetter(original.row.id));
  assert.match(r.error!, /Your letter hasn't changed/);
  assert.equal(r.id, undefined);
  assert.equal(await letters(repo), before);
  assert.deepEqual((await repo.getReport<CoverLetterPayload>(original.row.id))!.payload, original.payload);
  assert.equal(await usedOf(repo, "letter"), 0);
  assert.equal(jobs(repo)[0].status, "failed");

  provider.reply = goodLetter;
  resetProviderState();
  const retry = await as(() => improveLetter(original.row.id));
  assert.ok(retry.id);
  assert.equal(await usedOf(repo, "letter"), 1);
  assert.equal(jobs(repo).length, 1, "the same job, retried");
  const repeat = await as(() => improveLetter(original.row.id));
  assert.equal(repeat.id, retry.id, "a click straight after finds the first");
  assert.equal(await usedOf(repo, "letter"), 1);
});

test("improve a letter at the limit: said plainly, nothing called", async () => {
  const { repo, as } = await signIn();
  g.__offerpathDemo.users[repo.userId].ai[`${day()}:letter`] = AI_LIMITS.letter;
  const original = (await repo.latestReport<CoverLetterPayload>("cover_letter"))!;
  const r = await as(() => improveLetter(original.row.id));
  assert.match(r.error!, /used all your letter rewrites/);
  assert.equal(provider.calls, 0);
});

test("tailor: start with the provider down is partial, on the rules' reading; a repeat click is one report", async () => {
  const { repo, as } = await signIn();
  const before = (await repo.listReports({ type: "tailor" })).total;
  // An advert the rules leave undecided, so the provider is asked.
  const vague = "Join our friendly team in Leeds this autumn. You might work on spreadsheets, reporting and client meetings, with plenty of variety every week and support from colleagues throughout.";
  const [a, b] = await Promise.all([as(() => createTailor(form({ text: vague, title: "Analyst", employer: "Northbank" }))), as(() => createTailor(form({ text: vague, title: "Analyst", employer: "Northbank" })))]);
  assert.ok(a.id, JSON.stringify(a));
  assert.equal(b.id, a.id);
  assert.equal((await repo.listReports({ type: "tailor" })).total, before + 1);
  assert.ok(provider.calls >= 1, "the provider was asked");
  assert.equal(await usedOf(repo, "tailor"), 0, "and the use given back");
  assert.equal(jobs(repo)[0].status, "partial");
  assert.equal((await repo.getReport<TailorPayload>(a.id!))!.row.id, a.id, "the report is there, on the rules' reading");
});

test("tailored CV: a good AI version survives an outage and a spent limit, and the error says so", async () => {
  const { repo, as } = await signIn();
  const { id } = await as(() => createTailor(form({ text: AD, title: "Graduate Analyst", employer: "Northbank" })));
  assert.ok(id);
  const cv = await repo.latestReport<CvReviewPayload>("cv_review");
  const summary = cv!.payload.text.split("\n").find((l) => l.trim().length > 40)!.trim();
  provider.reply = goodTailor(summary);
  resetProviderState();
  const made = await as(() => createTailoredVersion(id!));
  assert.deepEqual(made, { ai: true }, "the simulated draft passed the real checks");
  const good = (await repo.getReport<TailorPayload>(id!))!.payload;
  // OP-014: suggestions wait for the student, so there is no tailored document yet; what is protected is the suggestions and decisions.
  assert.ok(good.edits && good.aiTailored);
  const usedAfterGood = await usedOf(repo, "tailor");
  // The repeat window has to pass, or the next click is a repeat of this one.
  jobs(repo).forEach((j) => (j.finishedMs = 1));

  for (const reply of [outage, notJson, () => apiError(400)]) {
    provider.reply = reply;
    resetProviderState();
    const r = await as(() => createTailoredVersion(id!));
    assert.match(r.error!, /Your tailored CV is still here/);
    assert.deepEqual((await repo.getReport<TailorPayload>(id!))!.payload, good, "nothing was overwritten");
    assert.equal(await usedOf(repo, "tailor"), usedAfterGood, "and nothing spent");
    jobs(repo).forEach((j) => (j.finishedMs = 1));
  }

  provider.reply = goodTailor(summary);
  g.__offerpathDemo.users[repo.userId].ai[`${day()}:tailor`] = AI_LIMITS.tailor;
  const calls = provider.calls;
  const r = await as(() => createTailoredVersion(id!));
  assert.match(r.error!, /You've tailored 10 times today. Your tailored CV is still here/);
  assert.equal(provider.calls, calls);
  assert.deepEqual((await repo.getReport<TailorPayload>(id!))!.payload, good);
});

test("tailored CV with nothing to protect: the rules' prompts, partial, the use back; a repeat click calls once", async () => {
  const { repo, as } = await signIn();
  const { id } = await as(() => createTailor(form({ text: AD, title: "Graduate Analyst", employer: "Northbank" })));
  provider.calls = 0;
  jobs(repo).forEach((j) => (j.finishedMs = 1));
  const before = await usedOf(repo, "tailor");
  provider.reply = () => apiError(400);
  const [a, b] = await Promise.all([as(() => createTailoredVersion(id!)), as(() => createTailoredVersion(id!))]);
  for (const r of [a, b]) {
    assert.equal(r.ai, false, JSON.stringify(r));
    assert.equal(r.error, undefined);
  }
  assert.equal(provider.calls, 1);
  assert.equal(await usedOf(repo, "tailor"), before);
  assert.equal(jobs(repo).find((j) => j.workflow === "tailor_version")!.status, "partial");
});

test("line rewrite: a good AI suggestion survives a failed retry, the use comes back, and the student is told", async () => {
  const { repo, as } = await signIn();
  const report = (await repo.latestReport<CvReviewPayload>("cv_review"))!;
  const n = report.payload.analysis.lines.findIndex((l) => l.text.length > 30);
  const text = report.payload.analysis.lines[n].text;
  provider.reply = ({ model }) => message(model, JSON.stringify({ rewrite: text }));
  const first = await as(() => rewriteLine(report.row.id, n, 0));
  assert.equal(first.ai, true, JSON.stringify(first));
  assert.equal(await usedOf(repo, "line_rewrite"), 1);

  provider.reply = outage;
  resetProviderState();
  const second = await as(() => rewriteLine(report.row.id, n, 1));
  assert.equal(second.error, undefined);
  assert.equal(second.rewrite, first.rewrite, "the last good one");
  assert.equal(second.ai, true);
  assert.match(second.note!, /last one is still here/);
  assert.equal(second.left, AI_LIMITS.line_rewrite - 1, "the failed try cost nothing");
  assert.equal(await usedOf(repo, "line_rewrite"), 1);
  const saved = (await repo.getReport<CvReviewPayload>(report.row.id))!.payload.analysis.lines[n];
  assert.equal(saved.rewrite, first.rewrite);
  assert.equal(saved.aiRewrite, true);
});

test("line rewrite, repeat of one click: answered from what was saved, with no second call or use", async () => {
  const { repo, as } = await signIn();
  const report = (await repo.latestReport<CvReviewPayload>("cv_review"))!;
  const n = report.payload.analysis.lines.findIndex((l) => l.text.length > 30);
  const text = report.payload.analysis.lines[n].text;
  provider.reply = ({ model }) => message(model, JSON.stringify({ rewrite: text }));
  const [a, b] = await Promise.all([as(() => rewriteLine(report.row.id, n, 3)), as(() => rewriteLine(report.row.id, n, 3))]);
  assert.equal(a.rewrite, b.rewrite);
  assert.equal(provider.calls, 1);
  assert.equal(await usedOf(repo, "line_rewrite"), 1);
});

test("line rewrite of a line that isn't there: a plain message, and no use taken", async () => {
  const { repo, as } = await signIn();
  const report = (await repo.latestReport<CvReviewPayload>("cv_review"))!;
  const r = await as(() => rewriteLine(report.row.id, 9999, 0));
  assert.match(r.error!, /couldn't find that line/);
  assert.equal(await usedOf(repo, "line_rewrite"), 0);
});
