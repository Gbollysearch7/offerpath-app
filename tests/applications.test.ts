// OP-019: linking the documents for a role, whether a download holds the latest changes, and what to do next. Every contract
// test runs on both repositories (the Supabase one over the in-memory fake; row-level security itself is in supabase/tests).
// All names and figures are made up. No provider is called: the key is removed below and generated drafts are simulated.
import assert from "node:assert/strict";
import { test } from "node:test";
import { STAGES } from "@/lib/analysis/lexicon";
import { actionChips, dismissedNow, IMPORTANCE, MAX_ACTIONS, nextActions, priorityOf, REMIND_LATER_DAYS } from "@/lib/applications/next-actions";
import { dismissActionFlow, keepVersionFlow, linkFlow, loadWorkspace, reopenActionFlow, trackRoleFlow, unlinkFlow } from "@/lib/applications/flow";
import { ARTEFACT_KIND_FOR, LinkConflictError, LinkRefusedError, type ActionChoice, type ArtefactDownload, type WorkspaceReport } from "@/lib/applications/types";
import { buildWorkspace, downloadSentence, downloadState, MEANINGFUL_SCORE_CHANGE, summarise } from "@/lib/applications/workspace";
import { pasteFlow } from "@/lib/cv-flow";
import { createLinkedinFlow, saveSectionFlow } from "@/lib/linkedin-flow";
import { demoRepo } from "@/lib/repo/demo";
import { supabaseRepo } from "@/lib/repo/supabase";
import type { Repo } from "@/lib/repo/types";
import { buildCvPayload, buildLetterReviewPayload, buildTailorPayload } from "@/lib/services";
import { decideFlow, tailorFlow, undoFlow, type TailorProvider } from "@/lib/tailor-flow";
import type { Application, CoverLetterPayload, CvReviewPayload, ReportRow, TailorPayload } from "@/lib/types";
import { fakeSupabase } from "./fixtures/fake-supabase";
import { LINES, REWRITE_CV } from "./fixtures/rewrite-cases";

delete process.env.ANTHROPIC_API_KEY;

const TODAY = "2026-11-07";
const ADVERT = ["Junior Analyst", "", "Essential requirements:", "- Experience with Tableau", "- Experience with Excel", "", "Desirable:", "- Knowledge of Quillon"].join("\n");
const CANARY = "Served 60 customers";
const says = (draft: unknown): TailorProvider => async () => draft;

function repos() {
  const fake = fakeSupabase();
  const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
  const supabase = (id: string) => {
    const r = supabaseRepo(fake.client, id, () => fake.client);
    // The usage counter is a database function the fake doesn't model; supabase/tests covers it.
    r.bumpAi = (async () => 1) as Repo["bumpAi"];
    return r as Repo;
  };
  const fakeApp = (userId: string) => async (role: string, org: string, status: Application["status"] = "saved") => {
    const row = { id: crypto.randomUUID(), user_id: userId, opportunity_id: `opp-${crypto.randomUUID()}`, source_report_id: null, role, org, closes_on: null, status, updated_at: new Date().toISOString() };
    fake.applications.push(row);
    return row.id;
  };
  const [da, db] = [`student-${crypto.randomUUID()}`, `student-${crypto.randomUUID()}`];
  // A demo student starts with sample applications. These tests start from none.
  const demoApp = (id: string) => async (role: string, org: string, status: Application["status"] = "saved") => {
    const r = demoRepo(id, "student");
    for (const x of await r.applications()) if (x.closesOn !== "2099-12-31" && x.opportunityId) await r.untrack(x.opportunityId);
    const opp = await r.saveOpportunity({ role, org, location: "Leeds", type: "Internship", sector: "Technology", sponsorsVisa: false, closesOn: "2099-12-31", description: "x", url: null });
    await r.track(opp);
    const made = (await r.applications()).find((x) => x.opportunityId === opp)!;
    if (status !== "saved") await r.setApplicationStatus(made.id, status);
    return made.id;
  };
  return [
    { name: "demo", repo: demoRepo(da, "student") as Repo, other: demoRepo(db, "student") as Repo, again: () => demoRepo(da, "student") as Repo, app: demoApp(da), otherApp: demoApp(db) },
    { name: "supabase", repo: supabase(a), other: supabase(b), again: () => supabase(a), app: fakeApp(a), otherApp: fakeApp(b) },
  ];
}

async function cv(repo: Repo, text = REWRITE_CV, score?: number) {
  const payload = buildCvPayload({ fileName: "cv.pdf", text, sector: "Technology", stage: "Final year" });
  return repo.createReport({ type: "cv_review", title: "cv.pdf", score: score ?? payload.analysis.score, payload });
}
async function tailor(repo: Repo, cvId: string, jobTitle = "Junior Analyst", employer = "Northbank") {
  const c = (await repo.getReport<CvReviewPayload>(cvId))!.payload;
  const payload = buildTailorPayload({ cvReportId: cvId, cvFileName: "cv.pdf", cvText: c.text, jobTitle, employer, jobUrl: null, jobText: ADVERT, deadline: null });
  return repo.createReport({ type: "tailor", title: `${jobTitle} · ${employer}`, score: payload.matchNow, payload });
}
async function letter(repo: Repo, cvId: string, tailorId: string | null, jobTitle = "Junior Analyst", employer = "Northbank") {
  const c = (await repo.getReport<CvReviewPayload>(cvId))!.payload;
  const made = buildLetterReviewPayload({ letterText: `Dear Hiring Manager,\n\nI want to join ${employer} as a ${jobTitle} because rotating through its teams would teach me how a lender works.\n\nYours faithfully,\nAlex Example`, jobTitle, employer, jobText: ADVERT, tailorReportId: tailorId, cvReportId: cvId, cvFileName: "cv.pdf", cvPayload: c });
  return repo.createReport({ type: "cover_letter", title: `${employer} cover letter`, score: made.score, payload: made.payload });
}
/** Two versions past the start: the first suggestion kept, ready to download. */
async function tailorWithEdit(repo: Repo, cvId: string) {
  const id = await tailor(repo, cvId);
  const c = (await repo.getReport<CvReviewPayload>(cvId))!.payload;
  const at = (t: string) => c.analysis.lines.findIndex((l) => l.text === t);
  await tailorFlow(repo, id, says({ summary: "", skills: [], notEvidenced: [], bullets: [{ id: at(LINES.questions), after: "Answered customer questions about delivery times and recorded recurring issues clearly.", keywords: [] }, { id: at(LINES.starters), after: "Trained 3 new starters on the till system and checked their first shifts.", keywords: [] }] }));
  await keep(repo, id, 0);
  return id;
}
async function keep(repo: Repo, id: string, n: number) {
  const p = (await repo.getReport<TailorPayload>(id))!.payload;
  const s = p.edits!.suggestions[n];
  const out = await decideFlow(repo, id, { suggestionId: s.id, text: null, confirmed: s.check.issues.filter((i) => i.severity === "confirm").map((i) => i.key) });
  assert.ok(!out.error, out.error);
}
const load = (repo: Repo) => loadWorkspace(repo, { today: TODAY });
const groupOf = async (repo: Repo, appId: string) => (await load(repo)).workspace.applications.find((g) => g.application.id === appId)!;
const hashOf = (repo: Repo, id: string) => repo.getReport<TailorPayload>(id).then((r) => r!.payload.edits!.versions.find((v) => v.id === r!.payload.edits!.current)!.documentVersion);

/* ---------- Connecting documents to a role ---------- */

test("both repositories: an application shows the exact CV, tailored CV and letter, and a report shows its role", async () => {
  for (const { name, repo, app } of repos()) {
    const cvId = await cv(repo);
    const t = await tailorWithEdit(repo, cvId);
    const l = await letter(repo, cvId, t);
    const appId = await app("Junior Analyst", "Northbank");
    assert.deepEqual(await linkFlow(repo, { applicationId: appId, reportId: t, ifCurrent: null }), { applicationId: appId }, name);
    const g = await groupOf(repo, appId);
    assert.equal(g.slots.tailor?.artefact.reportId, t, name);
    assert.equal(g.slots.tailor?.how, "linked", name);
    assert.equal(g.slots.letter?.artefact.reportId, l, `${name}: the letter was made from that tailored CV`);
    assert.equal(g.slots.letter?.how, "derived", name);
    assert.equal(g.slots.cv?.artefact.reportId, cvId, `${name}: the CV it was made from`);
    assert.equal(g.slots.tailor?.versionLabel, `Version ${g.slots.tailor?.artefact.current?.n}, the latest`, name);
    const { workspace } = await load(repo);
    assert.deepEqual(workspace.belongsTo[t], ["Junior Analyst · Northbank"], name);
    assert.deepEqual(workspace.belongsTo[l], ["Junior Analyst · Northbank"], name);
  }
});

test("both repositories: a link the student made outranks what a document names, and a CV can sit on several roles", async () => {
  for (const { name, repo, app } of repos()) {
    const c1 = await cv(repo);
    const c2 = await cv(repo, `${REWRITE_CV}\nGit`);
    const t = await tailor(repo, c1);
    const a1 = await app("Junior Analyst", "Northbank");
    const a2 = await app("Graduate Analyst", "Calder");
    await linkFlow(repo, { applicationId: a1, reportId: t, ifCurrent: null });
    await linkFlow(repo, { applicationId: a1, reportId: c2, ifCurrent: null });
    await linkFlow(repo, { applicationId: a2, reportId: c2, ifCurrent: null });
    assert.equal((await groupOf(repo, a1)).slots.cv?.artefact.reportId, c2, name);
    assert.equal((await groupOf(repo, a2)).slots.cv?.artefact.reportId, c2, name);
    assert.equal((await load(repo)).workspace.belongsTo[c2].length, 2, name);
  }
});

test("both repositories: unrelated applications stay separate", async () => {
  for (const { name, repo, app } of repos()) {
    const c = await cv(repo);
    const sameTitle = await tailor(repo, c, "Junior Analyst", "Calder");
    const sameOrg = await tailor(repo, c, "Risk Graduate", "Northbank");
    const unknownA = await tailor(repo, c, "Assistant", "the employer");
    const unknownB = await tailor(repo, c, "Assistant", "the employer");
    const northbank = await app("Junior Analyst", "Northbank");
    const { workspace } = await load(repo);
    const g = workspace.applications.find((x) => x.application.id === northbank)!;
    assert.equal(g.slots.tailor, null, `${name}: nothing joins an application by itself`);
    const of = (id: string) => workspace.roles.find((r) => r.documents.some((d) => d.reportId === id))!;
    assert.equal(new Set([sameTitle, sameOrg, unknownA, unknownB].map((id) => of(id).key)).size, 4, name);
    for (const id of [sameTitle, sameOrg, unknownA, unknownB]) assert.equal(of(id).suggestion, null, `${name}: half of a match isn't a match`);
  }
});

test("both repositories: the same role and employer is suggested, and is linked only when the student says so", async () => {
  for (const { name, repo, app } of repos()) {
    const c = await cv(repo);
    const t = await tailor(repo, c, "junior  analyst", "NORTHBANK");
    const a = await app("Junior Analyst", "Northbank");
    const before = await load(repo);
    const role = before.workspace.roles.find((r) => r.documents.some((d) => d.reportId === t))!;
    assert.equal(role.suggestion?.id, a, name);
    assert.equal(before.workspace.applications.find((g) => g.application.id === a)!.slots.tailor, null, name);
    assert.ok(before.actions.some((x) => x.key.startsWith("link:")) || before.candidates.some((x) => x.key.startsWith("link:")), name);
    await linkFlow(repo, { applicationId: a, reportId: t, ifCurrent: null });
    assert.equal((await load(repo)).workspace.roles.filter((r) => r.documents.some((d) => d.reportId === t)).length, 0, `${name}: it moved rather than appearing twice`);
  }
});

test("both repositories: each document keeps its own history when it is linked, kept or unlinked", async () => {
  for (const { name, repo, app } of repos()) {
    const c = await cv(repo);
    const t = await tailorWithEdit(repo, c);
    const [cvBefore, tBefore] = [await repo.getReport(c), await repo.getReport(t)];
    const a = await app("Junior Analyst", "Northbank");
    await linkFlow(repo, { applicationId: a, reportId: t, ifCurrent: null });
    const hash = await hashOf(repo, t);
    await keepVersionFlow(repo, { applicationId: a, reportId: t, kind: "tailor", seen: hash, ifCurrent: t });
    await repo.recordDownload({ reportId: t, documentVersion: hash, format: "docx" });
    await unlinkFlow(repo, { applicationId: a, kind: "tailor", ifCurrent: t });
    assert.deepEqual(await repo.getReport(c), cvBefore, `${name}: no score, payload or title moved`);
    assert.deepEqual(await repo.getReport(t), tBefore, name);
  }
});

test("both repositories: stopping tracking takes the links and leaves every report", async () => {
  for (const { name, repo, app, again } of repos()) {
    const c = await cv(repo);
    const t = await tailor(repo, c);
    const a = await app("Junior Analyst", "Northbank");
    const b = await app("Graduate Analyst", "Calder");
    await linkFlow(repo, { applicationId: a, reportId: t, ifCurrent: null });
    await linkFlow(repo, { applicationId: b, reportId: c, ifCurrent: null });
    await repo.removeApplication(a);
    const fresh = again();
    assert.equal((await fresh.applicationLinks()).filter((l) => l.applicationId === a).length, 0, name);
    assert.equal((await fresh.applicationLinks()).filter((l) => l.applicationId === b).length, 1, `${name}: another application is untouched`);
    assert.ok(await fresh.getReport(t), `${name}: the tailored CV stays`);
    const { workspace } = await load(fresh);
    assert.ok(workspace.roles.some((r) => r.documents.some((d) => d.reportId === t)), `${name}: and is listed as not on an application`);
    await repo.removeApplication(a);
  }
});

test("a removed report leaves its slot empty and a document naming it says so", async () => {
  const fake = fakeSupabase();
  const user = crypto.randomUUID();
  const repo = supabaseRepo(fake.client, user, () => fake.client);
  const c = await cv(repo);
  const t = await tailor(repo, c);
  const app = { id: crypto.randomUUID(), user_id: user, opportunity_id: null, source_report_id: null, role: "Junior Analyst", org: "Northbank", closes_on: null, status: "saved", updated_at: new Date().toISOString() };
  fake.applications.push(app);
  await linkFlow(repo, { applicationId: app.id, reportId: c, ifCurrent: null });
  await linkFlow(repo, { applicationId: app.id, reportId: t, ifCurrent: null });
  await fake.client.from("reports").delete().eq("id", c);
  assert.equal((await repo.applicationLinks()).length, 1, "the foreign key took the CV's link and only that");
  const g = await groupOf(repo, app.id);
  assert.equal(g.slots.cv, null);
  assert.match(g.slots.tailor!.artefact.stale!, /no longer here/);
  await fake.client.from("reports").delete().eq("id", t);
  const after = await groupOf(repo, app.id);
  assert.equal(after.slots.tailor, null);
  assert.ok((await repo.applications()).length === 1, "the application stays");
});

test("both repositories: tracking a role from a report is repeatable and reuses a role already tracked", async () => {
  for (const { name, repo, app } of repos()) {
    const c = await cv(repo);
    const t = await tailor(repo, c, "Data Intern", "Harlow");
    const first = await trackRoleFlow(repo, t);
    const second = await trackRoleFlow(repo, t);
    assert.ok(first.applicationId, name);
    assert.equal(second.applicationId, first.applicationId, `${name}: a double click finds the same application`);
    assert.equal((await repo.applications()).filter((x) => x.role === "Data Intern").length, 1, name);
    assert.equal((await groupOf(repo, first.applicationId!)).slots.tailor?.artefact.reportId, t, name);
    const existing = await app("Risk Graduate", "Calder");
    const t2 = await tailor(repo, c, "Risk Graduate", "Calder");
    assert.equal((await trackRoleFlow(repo, t2)).applicationId, existing, name);
    const t3 = await tailor(repo, c, "Risk Graduate", "Calder");
    await trackRoleFlow(repo, t3);
    assert.equal((await groupOf(repo, existing)).slots.tailor?.artefact.reportId, t2, `${name}: what is already on it stays`);
    assert.equal((await trackRoleFlow(repo, c)).error !== undefined, true, `${name}: a CV names no role`);
  }
});

/* ---------- What belongs to nobody: LinkedIn, and refused links ---------- */

test("both repositories: a LinkedIn review is listed as a profile, can't be put on a role, and its download is tracked", async () => {
  for (const { name, repo, app } of repos()) {
    const made = await createLinkedinFlow(repo, { sections: { headline: "Economics student seeking analyst roles", about: "I study economics and build reports for the society.", experience: "", education: "", skills: "", other: "" }, source: { method: "paste", files: [], skippedFiles: 0, linksIgnored: [] }, aim: null, cvReportId: null } as never);
    const id = made.id!;
    assert.ok(id, JSON.stringify(made));
    const a = await app("Junior Analyst", "Northbank");
    assert.equal(ARTEFACT_KIND_FOR.linkedin, undefined);
    await assert.rejects(repo.setApplicationLink({ applicationId: a, reportId: id, documentVersion: null, ifCurrent: null }), LinkRefusedError, name);
    let w = (await load(repo)).workspace;
    assert.deepEqual(w.profile.map((p) => p.reportId), [id], name);
    assert.ok(!w.roles.some((r) => r.documents.some((d) => d.reportId === id)), `${name}: not grouped as a role`);
    assert.deepEqual(w.belongsTo[id], ["Your profile, not one role"], name);
    const first = w.profile[0];
    assert.equal(downloadState(first, await repo.artefactDownloads()).state, "never", name);
    await repo.recordDownload({ reportId: id, documentVersion: first.latest!, format: "txt" });
    assert.equal(downloadState(first, await repo.artefactDownloads()).state, "current", name);
    assert.deepEqual(await saveSectionFlow(repo, id, "headline", "Economics student seeking data analyst roles in banking", []), {}, name);
    w = (await load(repo)).workspace;
    assert.equal(downloadState(w.profile[0], await repo.artefactDownloads()).state, "behind", `${name}: the file no longer matches`);
  }
});

test("both repositories: another student's application or report can't be linked, tracked or recorded", async () => {
  for (const { name, repo, other, app, otherApp } of repos()) {
    const mine = await cv(repo);
    const myApp = await app("Junior Analyst", "Northbank");
    const theirs = await cv(other);
    const theirApp = await otherApp("Junior Analyst", "Northbank");
    await assert.rejects(repo.setApplicationLink({ applicationId: myApp, reportId: theirs, documentVersion: null, ifCurrent: null }), LinkRefusedError, name);
    await assert.rejects(repo.setApplicationLink({ applicationId: theirApp, reportId: mine, documentVersion: null, ifCurrent: null }), LinkRefusedError, name);
    assert.deepEqual(await linkFlow(repo, { applicationId: theirApp, reportId: mine, ifCurrent: null }), { error: "We couldn't find that. Reload the page and try again." }, name);
    await assert.rejects(repo.trackRole({ reportId: theirs, role: "x", org: "y", closesOn: null }), LinkRefusedError, name);
    await assert.rejects(repo.recordDownload({ reportId: theirs, documentVersion: "a".repeat(64), format: "pdf" }), name);
    await repo.removeApplication(theirApp);
    await repo.setApplicationStatus(theirApp, "offer");
    assert.equal((await other.applications()).find((a) => a.id === theirApp)?.status, "saved", `${name}: their application is unchanged and still there`);
    assert.deepEqual(await other.artefactDownloads(), [], name);
    assert.deepEqual(await repo.workspaceReports({ ids: [theirs] }), [], `${name}: their report can't be read by id`);
  }
});

/* ---------- Which version a download holds ---------- */

test("both repositories: a download says whether it has the latest kept changes, through undo and retries", async () => {
  for (const { name, repo, app } of repos()) {
    const c = await cv(repo);
    const t = await tailorWithEdit(repo, c);
    const a = await app("Junior Analyst", "Northbank");
    await linkFlow(repo, { applicationId: a, reportId: t, ifCurrent: null });
    const state = async () => (await groupOf(repo, a)).slots.tailor!.download;
    assert.equal((await state()).state, "never", name);
    const v1 = await hashOf(repo, t);
    await repo.recordDownload({ reportId: t, documentVersion: v1, format: "docx" });
    await repo.recordDownload({ reportId: t, documentVersion: v1, format: "docx" });
    assert.equal((await repo.artefactDownloads()).length, 1, `${name}: a retried download isn't a second record`);
    assert.equal((await state()).state, "current", name);
    await keep(repo, t, 1);
    const behind = await state();
    assert.equal(behind.state, "behind", name);
    assert.match(downloadSentence(behind), /doesn't have this version/, name);
    if (behind.state === "behind") assert.match(behind.versionLabel!, /^version \d+$/, name);
    assert.ok((await load(repo)).candidates.some((x) => x.key.startsWith(`download:${t}:`) && x.title.includes("latest")), `${name}: and it's recommended`);
    await undoFlow(repo, t);
    assert.equal((await state()).state, "current", `${name}: undoing back to what was downloaded`);
  }
});

test("both repositories: a document with blanks says what it's waiting for, and has nothing to download until then", async () => {
  for (const { name, repo, app } of repos()) {
    const c = await cv(repo);
    const t = await tailor(repo, c);
    const a = await app("Junior Analyst", "Northbank");
    await linkFlow(repo, { applicationId: a, reportId: t, ifCurrent: null });
    assert.equal((await groupOf(repo, a)).slots.tailor!.download.state, "nothing", name);
    const p = (await repo.getReport<CvReviewPayload>(c))!.payload;
    await tailorFlow(repo, t, says({ summary: "", skills: [], notEvidenced: [], bullets: [{ id: p.analysis.lines.findIndex((l) => l.text === LINES.questions), after: "Answered customer questions about delivery times, improving results by [X%].", keywords: [] }] }));
    await keep(repo, t, 0);
    const d = (await groupOf(repo, a)).slots.tailor!.download;
    assert.equal(d.state, "blocked", name);
    assert.match(downloadSentence(d), /blank/, name);
  }
});

test("both repositories: keeping a version pins it, a newer one doesn't replace it, and the student can move on", async () => {
  for (const { name, repo, app } of repos()) {
    const c = await cv(repo);
    const t = await tailorWithEdit(repo, c);
    const a = await app("Junior Analyst", "Northbank");
    await linkFlow(repo, { applicationId: a, reportId: t, ifCurrent: null });
    const kept = await hashOf(repo, t);
    assert.deepEqual(await keepVersionFlow(repo, { applicationId: a, reportId: t, kind: "tailor", seen: kept, ifCurrent: t }), { applicationId: a }, name);
    await keep(repo, t, 1);
    const g = (await groupOf(repo, a)).slots.tailor!;
    assert.equal(g.kept?.isLatest, false, name);
    assert.match(g.versionLabel!, /^Version \d+ kept$/, name);
    assert.ok(g.downloadVersionId, `${name}: a download from here asks for that version`);
    assert.equal(g.artefact.versions.find((v) => v.id === g.downloadVersionId)?.documentVersion, kept, name);
    assert.equal(g.download.state, "never", `${name}: judged against the kept version`);
    assert.ok((await load(repo)).candidates.some((x) => x.key.startsWith(`newer:${a}:tailor:`)), name);
    assert.deepEqual(await keepVersionFlow(repo, { applicationId: a, reportId: t, kind: "tailor", seen: null, ifCurrent: t }), { applicationId: a }, name);
    const after = (await groupOf(repo, a)).slots.tailor!;
    assert.equal(after.kept, null, name);
    assert.equal(after.downloadVersionId, null, name);
  }
});

test("an older file doesn't undo a newer one, and sentences say only what's known", () => {
  const row: ReportRow = { id: "r", type: "tailor", title: "t", score: null, createdAt: "2026-11-01T00:00:00Z" };
  const a = { ...summarise({ row, payload: null }, () => null), readable: true, latest: "b".repeat(64), versions: [{ id: "v1", n: 1, documentVersion: "a".repeat(64) }, { id: "v2", n: 2, documentVersion: "b".repeat(64) }] };
  const d = (hash: string, lastAt: string): ArtefactDownload => ({ reportId: "r", documentVersion: hash, format: "docx", firstAt: lastAt, lastAt });
  assert.equal(downloadState(a, [d("b".repeat(64), "2026-11-02T00:00:00Z"), d("a".repeat(64), "2026-11-03T00:00:00Z")]).state, "current");
  const behind = downloadState(a, [d("a".repeat(64), "2026-11-03T09:00:00Z")]);
  assert.equal(downloadSentence(behind), "Your last download (3 Nov, version 1) doesn't have this version.");
  assert.equal(downloadSentence(downloadState(a, [d("b".repeat(64), "2026-11-03T09:00:00Z")])), "Your download from 3 Nov has this version.");
  assert.equal(downloadState(a, []).state, "never");
  assert.equal(downloadState(summarise({ row, payload: null }, () => null), []).state, "nothing");
});

/* ---------- Progress that means something ---------- */

const cvRow = (text: string, score: number, createdAt: string): WorkspaceReport => {
  const payload = buildCvPayload({ fileName: "cv.pdf", text, sector: "Technology", stage: "Final year" });
  return { row: { id: crypto.randomUUID(), type: "cv_review", title: "cv.pdf", score, createdAt }, payload };
};
const build = (reports: WorkspaceReport[], over: Partial<Parameters<typeof buildWorkspace>[0]> = {}) => buildWorkspace({ applications: [], links: [], reports, sources: [], downloads: [], ...over });

test("repeat uploads count for nothing: not as versions, not as improvements", () => {
  const b = `${REWRITE_CV}\nGit`;
  const c = `${REWRITE_CV}\nGit Docker`;
  const noisy = REWRITE_CV.replace(/•/g, "-").replace(/\n/g, "  \n");
  const w = build([cvRow(REWRITE_CV, 60, "2026-10-01T00:00:00Z"), cvRow(REWRITE_CV, 60, "2026-10-02T00:00:00Z"), cvRow(noisy, 60, "2026-10-03T00:00:00Z"), cvRow(b, 70, "2026-10-04T00:00:00Z"), cvRow(REWRITE_CV, 60, "2026-10-05T00:00:00Z"), cvRow(b, 70, "2026-10-06T00:00:00Z"), cvRow(c, 71, "2026-10-07T00:00:00Z")]);
  assert.equal(w.progress.reviewedVersions, 3, "three different texts, including a re-export that differs only in formatting");
  assert.equal(w.progress.repeatUploads, 4);
  assert.equal(w.progress.improvements, 1, "A to B counts once, going back and forth adds nothing, and B to C is below the threshold");
  assert.equal(MEANINGFUL_SCORE_CHANGE, 5);
});

test("completed edits count what stands, and an undone edit stops counting", async () => {
  for (const { name, repo } of repos()) {
    const c = await cv(repo);
    const t = await tailorWithEdit(repo, c);
    const edits = async () => (await load(repo)).workspace.all.find((a) => a.reportId === t)!.keptEdits;
    assert.equal(await edits(), 1, name);
    await keep(repo, t, 1);
    assert.equal(await edits(), 2, name);
    await undoFlow(repo, t);
    assert.equal(await edits(), 1, name);
  }
});

test("a correction counts once however often it's made, and uploads, reviews, tailoring and letters are told apart", async () => {
  for (const { name, repo } of repos()) {
    const before = (await load(repo)).workspace.progress;
    const r = await pasteFlow(repo, { text: REWRITE_CV, original: null, sector: "Technology", stage: STAGES[0], key: crypto.randomUUID() });
    assert.ok("id" in r, name);
    const c = (r as { id: string }).id;
    const t = await tailor(repo, c);
    await letter(repo, c, t);
    const p = (await load(repo)).workspace.progress;
    assert.equal(p.uploads - before.uploads, 0, `${name}: typed text isn't an upload`);
    assert.equal(p.reviewedVersions - before.reviewedVersions, 1, name);
    assert.equal(p.tailored - before.tailored, 1, name);
    assert.equal(p.letters - before.letters, 1, name);
    assert.equal(p.corrections, 0, name);
  }
  const source = (id: string, documentVersion: string) => ({ id, parentId: "root", kind: "correction" as const, fileName: "cv.pdf", documentVersion, reportId: null, createdAt: "2026-10-01T00:00:00Z", readable: true });
  const w = build([], { sources: [source("a", "1".repeat(64)), source("b", "1".repeat(64)), source("c", "2".repeat(64))] });
  assert.equal(w.progress.corrections, 2);
  assert.equal(w.progress.completedEdits, 2);
});

test("a record that can't be read stays listed and stops nothing", () => {
  const good = cvRow(REWRITE_CV, 60, "2026-10-01T00:00:00Z");
  const bad: WorkspaceReport = { row: { id: "bad", type: "tailor", title: "Damaged", score: null, createdAt: "2026-10-02T00:00:00Z" }, payload: null };
  const odd: WorkspaceReport = { row: { id: "odd", type: "cover_letter", title: "Odd", score: null, createdAt: "2026-10-03T00:00:00Z" }, payload: { nonsense: true } };
  const w = build([good, bad, odd]);
  assert.equal(w.all.length, 3);
  assert.equal(w.all.find((a) => a.reportId === "bad")?.readable, false);
  assert.equal(w.all.find((a) => a.reportId === "odd")?.readable, false);
  assert.equal(w.progress.reviewedVersions, 1);
  assert.ok(w.roles.some((r) => r.documents.some((d) => d.reportId === "bad")));
  assert.doesNotThrow(() => nextActions(w, { today: TODAY, choices: [] }));
});

test("no document text is in what the dashboard holds", async () => {
  for (const { name, repo, app } of repos()) {
    const c = await cv(repo);
    assert.ok(REWRITE_CV.includes(CANARY), "the canary is in the CV");
    const t = await tailorWithEdit(repo, c);
    const a = await app("Junior Analyst", "Northbank");
    await linkFlow(repo, { applicationId: a, reportId: t, ifCurrent: null });
    const loaded = await load(repo);
    const held = JSON.stringify(loaded);
    assert.ok(!held.includes(CANARY), name);
    assert.ok(!held.includes("Essential requirements"), `${name}: nor the advert`);
    for (const x of loaded.candidates) assert.match(x.key, /^[a-z-]+(:[A-Za-z0-9_.-]+)*$/, `${name}: the key the table's check allows`);
    for (const x of loaded.candidates) assert.ok(x.key.length <= 240, name);
  }
});

/* ---------- What to do next ---------- */

test("priority rises with importance and confidence and falls with effort", () => {
  for (const k of ["low", "medium", "high"] as const) {
    const up = k === "low" ? "medium" : k === "medium" ? "high" : "critical";
    assert.ok(priorityOf(up, 1, 2) > priorityOf(k, 1, 2), k);
  }
  assert.ok(priorityOf("high", 1, 1) > priorityOf("high", 0.6, 1));
  assert.ok(priorityOf("high", 1, 1) > priorityOf("high", 1, 2));
  assert.ok(priorityOf("high", 1, 2) > priorityOf("high", 1, 3));
  assert.deepEqual(Object.keys(IMPORTANCE), ["critical", "high", "medium", "low"]);
  assert.deepEqual(actionChips({ importance: "critical", confidence: 1, effort: 1 }), ["Urgent", "We're sure", "Quick"]);
  assert.deepEqual(actionChips({ importance: "medium", confidence: 0.6, effort: 3 }), ["Useful", "Worth checking", "Takes time"]);
});

/** A CV the rules dislike, so the review has real findings. */
const WEAK_CV = ["Alex Example", "alex@example.com", "EDUCATION", "BSc Economics, Example University, 2022 - 2025", "EXPERIENCE", "Assistant, Example Ltd, 2024", "• Helped with things", "• Responsible for tasks", "• Did various duties", "• Helped the team", "SKILLS", "Excel"].join("\n");

const appRow = (over: Partial<Application> = {}): Application => ({ id: crypto.randomUUID(), opportunityId: null, role: "Junior Analyst", org: "Northbank", status: "saved", closesOn: null, updatedAt: "2026-10-01T00:00:00Z", ...over });

test("the list is short, explains itself, and puts a near deadline above polishing", () => {
  const apps = [appRow({ closesOn: "2026-11-09", role: "Urgent Role" }), appRow({ closesOn: "2026-11-13", role: "Soon Role" }), appRow({ closesOn: "2026-12-30", role: "Later Role" }), appRow({ closesOn: "2026-11-01", role: "Passed Role" })];
  const out = nextActions(build([cvRow(WEAK_CV, 40, "2026-10-01T00:00:00Z")], { applications: apps }), { today: TODAY, choices: [] });
  assert.ok(out.actions.length <= MAX_ACTIONS);
  assert.ok(out.candidates.length > out.actions.length || out.actions.length > 0);
  assert.match(out.actions[0].title, /Urgent Role/);
  assert.equal(out.actions[0].importance, "critical");
  assert.ok(!out.candidates.some((a) => a.title.includes("Later Role")), "a deadline far off isn't a recommendation");
  assert.ok(!out.candidates.some((a) => a.title.includes("Passed Role")), "nor one that has gone");
  for (const a of out.candidates) {
    assert.ok(a.title.length <= 80, a.title);
    assert.ok(a.why.length >= 10 && a.why.length <= 170, a.why);
    assert.ok(a.href.startsWith("/") || a.href.startsWith("#"), a.href);
  }
  const order = out.actions.map((a) => a.priority);
  assert.deepEqual(order, [...order].sort((x, y) => y - x));
  assert.ok(out.actions.filter((a) => a.key.startsWith("finding:")).length <= 2);
});

test("nothing recommended talks about points, and a sound CV isn't sent back for more", () => {
  const strong = buildCvPayload({ fileName: "cv.pdf", text: WEAK_CV, sector: "Technology", stage: "Final year" });
  const row = (score: number): WorkspaceReport => ({ row: { id: crypto.randomUUID(), type: "cv_review", title: "cv.pdf", score, createdAt: "2026-10-01T00:00:00Z" }, payload: strong });
  const weak = nextActions(build([row(40)]), { today: TODAY, choices: [] });
  assert.ok(weak.candidates.some((a) => a.key.startsWith("finding:")), "the same CV at a low number has findings to act on");
  for (const a of weak.candidates) {
    assert.ok(!/\bscores?\b|(?<!bullet )\bpoints?\b|\+\d|percent|higher number/i.test(`${a.title} ${a.why} ${a.cta}`), `${a.title} / ${a.why}`);
  }
  assert.ok(nextActions(build([row(74)]), { today: TODAY, choices: [] }).candidates.some((a) => a.key.startsWith("finding:")), "just under the Strong band it still helps");
  for (const score of [75, 85, 95]) {
    const sound = nextActions(build([row(score)]), { today: TODAY, choices: [] });
    assert.ok(!sound.candidates.some((a) => a.key.startsWith("finding:")), `no polishing at ${score}`);
  }
  const low = weak.candidates.filter((a) => a.key.startsWith("finding:"));
  for (const a of low) assert.notEqual(a.importance, "low");
});

test("uploading the same CV again adds nothing to the list", async () => {
  for (const { name, repo } of repos()) {
    await cv(repo, WEAK_CV);
    const once = (await load(repo)).candidates.filter((a) => a.key.startsWith("finding:") || a.key.startsWith("proofread:")).map((a) => a.title);
    await cv(repo, WEAK_CV);
    const twice = (await load(repo)).candidates.filter((a) => a.key.startsWith("finding:") || a.key.startsWith("proofread:")).map((a) => a.title);
    assert.deepEqual(twice, once, name);
    assert.ok(!(await load(repo)).candidates.some((a) => /upload .*again/i.test(a.title)), name);
  }
});

test("both repositories: a dismissal needs a reason, survives a refresh, is repeatable and can be taken back", async () => {
  for (const { name, repo, again, other } of repos()) {
    await cv(repo, WEAK_CV);
    const target = (await load(repo)).actions[0];
    assert.deepEqual(await dismissActionFlow(repo, target.key, ""), { error: "Choose a reason." }, name);
    assert.deepEqual(await dismissActionFlow(repo, target.key, "because"), { error: "Choose a reason." }, name);
    assert.deepEqual(await repo.actionChoices(), [], `${name}: nothing saved`);
    assert.deepEqual(await dismissActionFlow(repo, target.key, "not_relevant"), {}, name);
    const fresh = await load(again());
    assert.ok(!fresh.actions.some((a) => a.key === target.key), `${name}: gone after a refresh`);
    assert.deepEqual(fresh.dismissed.map((d) => [d.key, d.reason]), [[target.key, "not_relevant"]], name);
    assert.deepEqual(await dismissActionFlow(again(), target.key, "done"), {}, `${name}: a second tab`);
    assert.equal((await repo.actionChoices()).length, 1, `${name}: adds nothing to the history`);
    assert.deepEqual(await reopenActionFlow(repo, target.key), {}, name);
    assert.deepEqual(await reopenActionFlow(repo, target.key), {}, name);
    assert.deepEqual((await repo.actionChoices()).map((c) => c.kind), ["dismiss", "reopen"], name);
    assert.ok((await load(repo)).actions.some((a) => a.key === target.key), `${name}: back on the list`);
    assert.match((await dismissActionFlow(repo, "finding:made-up:verbs", "done")).error!, /has gone/, `${name}: only what we'd recommend can be stored`);
    assert.match((await dismissActionFlow(other, target.key, "done")).error!, /has gone/, `${name}: another student has no such recommendation`);
    assert.deepEqual(await other.actionChoices(), [], name);
  }
});

test("'not now' comes back after a week; a recommendation tied to a version asks again when the version changes", async () => {
  const at = (date: string, reason: ActionChoice["reason"] = "later"): ActionChoice => ({ id: crypto.randomUUID(), actionKey: "k", kind: "dismiss", reason, createdAt: `${date}T12:00:00Z` });
  assert.equal(REMIND_LATER_DAYS, 7);
  assert.ok(dismissedNow([at("2026-11-01")], "2026-11-07").has("k"));
  assert.ok(!dismissedNow([at("2026-10-31")], "2026-11-07").has("k"));
  assert.ok(dismissedNow([at("2026-10-01", "done")], "2026-11-07").has("k"), "the other reasons stay");
  for (const { name, repo, app } of repos()) {
    const c = await cv(repo);
    const t = await tailorWithEdit(repo, c);
    const a = await app("Junior Analyst", "Northbank");
    await linkFlow(repo, { applicationId: a, reportId: t, ifCurrent: null });
    const before = (await load(repo)).candidates.find((x) => x.key.startsWith(`download:${t}:`))!;
    assert.ok(before, name);
    assert.deepEqual(await dismissActionFlow(repo, before.key, "done"), {}, name);
    await keep(repo, t, 1);
    const after = (await load(repo)).candidates.find((x) => x.key.startsWith(`download:${t}:`))!;
    assert.notEqual(after.key, before.key, name);
    assert.ok(!(await load(repo)).dismissed.some((d) => d.key === after.key), `${name}: new changes ask again`);
  }
});

test("an application already sent isn't nagged about its download", async () => {
  for (const { name, repo, app } of repos()) {
    const c = await cv(repo);
    const t = await tailorWithEdit(repo, c);
    const a = await app("Junior Analyst", "Northbank", "applied");
    await linkFlow(repo, { applicationId: a, reportId: t, ifCurrent: null });
    assert.ok(!(await load(repo)).candidates.some((x) => x.key.startsWith(`download:${t}:`) || x.key.startsWith(`gaps:${t}:`) || x.key.startsWith(`pending:${t}:`)), name);
  }
});

test("a held upload waiting for its check is on the list, with no way to lose it", () => {
  const source = { id: "held", parentId: null, kind: "upload" as const, fileName: "scan.pdf", documentVersion: "1".repeat(64), reportId: null, createdAt: "2026-10-01T00:00:00Z", readable: true };
  const out = nextActions(build([], { sources: [source] }), { today: TODAY, choices: [] });
  assert.equal(out.actions[0].key, "held:held");
  assert.equal(out.actions[0].href, "/upload?source=held");
  const child = { ...source, id: "fixed", parentId: "held", kind: "correction" as const };
  assert.ok(!nextActions(build([], { sources: [source, child] }), { today: TODAY, choices: [] }).candidates.some((a) => a.key === "held:held"), "once corrected it isn't waiting");
  assert.equal(nextActions(build([]), { today: TODAY, choices: [] }).actions[0].key, "first-cv");
});

/* ---------- Conflicts in the repository ---------- */

test("both repositories: a stale tab can't replace or remove what another tab linked, and a retry is harmless", async () => {
  for (const { name, repo, app } of repos()) {
    const c = await cv(repo);
    const x = await tailor(repo, c);
    const y = await tailor(repo, c);
    const a = await app("Junior Analyst", "Northbank");
    await repo.setApplicationLink({ applicationId: a, reportId: x, documentVersion: null, ifCurrent: null });
    await repo.setApplicationLink({ applicationId: a, reportId: x, documentVersion: null, ifCurrent: null });
    assert.equal((await repo.applicationLinks()).length, 1, `${name}: the same request again`);
    await assert.rejects(repo.setApplicationLink({ applicationId: a, reportId: y, documentVersion: null, ifCurrent: null }), LinkConflictError, name);
    assert.match((await linkFlow(repo, { applicationId: a, reportId: y, ifCurrent: null })).error!, /another tab, so nothing was replaced/, name);
    assert.equal((await repo.applicationLinks())[0].reportId, x, `${name}: still the first`);
    await assert.rejects(repo.removeApplicationLink({ applicationId: a, kind: "tailor", ifCurrent: y }), LinkConflictError, name);
    assert.equal((await repo.applicationLinks()).length, 1, name);
    await repo.setApplicationLink({ applicationId: a, reportId: y, documentVersion: null, ifCurrent: x });
    assert.equal((await repo.applicationLinks())[0].reportId, y, `${name}: an up-to-date tab can replace it`);
    await repo.removeApplicationLink({ applicationId: a, kind: "tailor", ifCurrent: y });
    await repo.removeApplicationLink({ applicationId: a, kind: "tailor", ifCurrent: y });
    assert.deepEqual(await repo.applicationLinks(), [], `${name}: already gone is fine`);
  }
});

test("both repositories: keeping a version refuses one that moved on in another tab", async () => {
  for (const { name, repo, app } of repos()) {
    const c = await cv(repo);
    const t = await tailorWithEdit(repo, c);
    const a = await app("Junior Analyst", "Northbank");
    await linkFlow(repo, { applicationId: a, reportId: t, ifCurrent: null });
    const seen = await hashOf(repo, t);
    await keep(repo, t, 1);
    assert.match((await keepVersionFlow(repo, { applicationId: a, reportId: t, kind: "tailor", seen, ifCurrent: t })).error!, /another tab/, name);
    assert.equal((await repo.applicationLinks())[0].documentVersion, null, `${name}: nothing kept`);
    assert.match((await keepVersionFlow(repo, { applicationId: a, reportId: t, kind: "cv", seen: null, ifCurrent: t })).error!, /couldn't find/, `${name}: wrong slot`);
  }
});

test("reading a letter's stale state and version from what it saved", async () => {
  const { repo } = repos()[0];
  const c = await cv(repo);
  const l = await letter(repo, c, null);
  const s = (await load(repo)).workspace.all.find((a) => a.reportId === l)!;
  const p = (await repo.getReport<CoverLetterPayload>(l))!.payload;
  assert.equal(s.current?.n, p.edits?.versions.find((v) => v.id === p.edits!.current)?.n);
  assert.equal(s.stale, null);
  assert.ok(s.latest);
  const older = await repo.createReport({ type: "cover_letter", title: "Recorded as uploaded", score: null, payload: buildLetterReviewPayload({ letterText: "Dear Hiring Manager,\n\nI want to join Northbank because rotating through its teams would teach me how a lender works.\n\nYours faithfully,\nAlex Example", jobTitle: "Junior Analyst", employer: "Northbank", jobText: ADVERT, tailorReportId: null, cvReportId: c, cvFileName: "cv.pdf", cvText: REWRITE_CV }).payload });
  assert.equal((await load(repo)).workspace.all.find((a) => a.reportId === older)!.stale, null, "a letter that recorded the CV as uploaded isn't called out of date");
  // Lines saved in the CV review afterwards mean the letter was checked against something else.
  const cvNow = (await repo.getReport<CvReviewPayload>(c))!;
  const lines = cvNow.payload.analysis.lines.map((x, i) => (i === 0 ? { ...x, accepted: `${x.text} Checked weekly.` } : x));
  await repo.updateReport(c, { payload: { ...cvNow.payload, analysis: { ...cvNow.payload.analysis, lines } } });
  assert.match((await load(repo)).workspace.all.find((a) => a.reportId === l)!.stale!, /changed since/);
});
