// OP-019: interruption and recovery through the real server actions and route handlers, in demo mode with two sessions:
// refreshing, retrying a download, a session that has expired, and a second tab. No provider is called.
import "./fixtures/next-server-shim";
import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { NextRequest } from "next/server";
import { dismissAction, keepVersion, linkArtefact, reopenAction, stopTracking, trackRole, unlinkArtefact } from "@/app/actions/applications";
import { createTailor, trackOpportunity } from "@/app/actions/tailor";
import { GET as exportRoute } from "@/app/api/export/route";
import { GET as letterRoute } from "@/app/api/letters/[id]/route";
import { GET as tailorRoute } from "@/app/api/tailor/[id]/route";
import { GET as templateRoute } from "@/app/api/templates/[slug]/route";
import { GET as linkedinRoute } from "@/app/linkedin/[id]/download/route";
import { GET as sourceFileRoute } from "@/app/reviews/[id]/source/file/route";
import { STAGES } from "@/lib/analysis/lexicon";
import { loadWorkspace, noteDownload } from "@/lib/applications/flow";
import { downloadHref, reportHref } from "@/lib/applications/workspace";
import { uploadFlow } from "@/lib/cv-flow";
import { signDemoSession } from "@/lib/demo-session";
import { createLinkedinFlow } from "@/lib/linkedin-flow";
import { hit, LIMITS } from "@/lib/rate-limit";
import { demoRepo } from "@/lib/repo/demo";
import type { Repo } from "@/lib/repo/types";
import { DEMO_COOKIE } from "@/lib/session";
import { buildCvPayload, buildTailorPayload } from "@/lib/services";
import { decideFlow, retainPlaceholdersFlow, tailorFlow, type TailorProvider } from "@/lib/tailor-flow";
import type { CvReviewPayload, TailorPayload } from "@/lib/types";
import fs from "node:fs";
import path from "node:path";
import { LINES, REWRITE_CV } from "./fixtures/rewrite-cases";
import { requestScope, withEnv } from "./fixtures/request-scope";

delete process.env.ANTHROPIC_API_KEY;

const DEMO = { NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", DEMO_MODE: undefined, VERCEL_ENV: undefined, NODE_ENV: "development" };
const ADVERT = ["Junior Analyst", "", "Essential requirements:", "- Experience with Tableau", "- Experience with Excel", "", "Desirable:", "- Knowledge of Quillon"].join("\n");
const TODAY = "2026-11-07";
const says = (draft: unknown): TailorProvider => async () => draft;
const signedOut = requestScope({});

function student() {
  const id = crypto.randomUUID();
  const scope = requestScope({ [DEMO_COOKIE]: signDemoSession("student", id) });
  return { id, repo: demoRepo(`student-${id}`, "student") as Repo, as: <T>(fn: () => Promise<T>) => withEnv(DEMO, () => scope.run(fn)) };
}
const as0 = <T>(fn: () => Promise<T>) => withEnv(DEMO, () => signedOut.run(fn));

async function setup(repo: Repo, opts: { blanks?: boolean } = {}) {
  const cv = buildCvPayload({ fileName: "cv.pdf", text: REWRITE_CV, sector: "Technology", stage: "Final year" });
  const cvId = await repo.createReport({ type: "cv_review", title: "cv.pdf", score: cv.analysis.score, payload: cv });
  const payload = buildTailorPayload({ cvReportId: cvId, cvFileName: "cv.pdf", cvText: REWRITE_CV, jobTitle: "Risk Graduate", employer: "Calder", jobUrl: null, jobText: ADVERT, deadline: null });
  const id = await repo.createReport({ type: "tailor", title: "Risk Graduate · Calder", score: payload.matchNow, payload });
  const at = (t: string) => cv.analysis.lines.findIndex((l) => l.text === t);
  await tailorFlow(repo, id, says({ summary: "", skills: [], notEvidenced: [], bullets: [{ id: at(LINES.questions), after: opts.blanks ? "Answered customer questions about delivery times, improving results by [X%]." : "Answered customer questions about delivery times and recorded recurring issues clearly.", keywords: [] }, ...(opts.blanks ? [] : [{ id: at(LINES.starters), after: "Trained 3 new starters on the till system and checked their first shifts.", keywords: [] }])] }));
  await keepOne(repo, id, 0);
  return { cvId, id };
}
async function keepOne(repo: Repo, id: string, n: number) {
  const s = (await repo.getReport<TailorPayload>(id))!.payload.edits!.suggestions[n];
  const out = await decideFlow(repo, id, { suggestionId: s.id, text: null, confirmed: s.check.issues.filter((i) => i.severity === "confirm").map((i) => i.key) });
  assert.ok(!out.error, out.error);
}
const request = (href: string) => new NextRequest(new URL(href, "http://localhost"));
const getTailor = (id: string, query = "format=docx") => tailorRoute(request(`/api/tailor/${id}?${query}`), { params: Promise.resolve({ id }) });
const load = (repo: Repo) => loadWorkspace(repo, { today: TODAY });
const stateOf = async (repo: Repo, reportId: string) => {
  const w = (await load(repo)).workspace;
  return w.applications.flatMap((g) => Object.values(g.slots)).find((s) => s?.artefact.reportId === reportId)?.download.state;
};

test("the dashboard's download links are real routes that serve the file and record it", async () => {
  const s = student();
  const { cvId, id } = await setup(s.repo);
  const appId = (await s.as(() => trackRole(id))).applicationId!;
  assert.ok(appId);
  const res = await s.as(() => getTailor(id));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Disposition")!, /attachment/);
  assert.equal(await s.as(() => stateOf(s.repo, id)), "current");
  // The CV route, for a named report and not just the latest.
  const href = downloadHref({ reportId: cvId, type: "cv_review" }, "pdf");
  const slug = href.match(/templates\/([^?]+)/)![1];
  const cvRes = await s.as(() => templateRoute(request(href), { params: Promise.resolve({ slug }) }));
  assert.equal(cvRes.status, 200);
  assert.equal(cvRes.headers.get("Content-Type"), "application/pdf");
  assert.ok((await s.repo.artefactDownloads()).some((d) => d.reportId === cvId && d.format === "pdf"));
  assert.match(downloadHref({ reportId: "r", type: "tailor" }, "docx", "v2"), /version=v2/);
  assert.equal(reportHref({ reportId: "r", type: "linkedin" }), "/linkedin/r");
});

test("a retried download is the same record, and a failed one records nothing", async () => {
  const s = student();
  const { id } = await setup(s.repo, { blanks: true });
  await s.as(() => trackRole(id));
  const blocked = await s.as(() => getTailor(id));
  assert.equal(blocked.status, 409);
  assert.match(((await blocked.json()) as { error: string }).error, /blanks/);
  assert.deepEqual(await s.repo.artefactDownloads(), [], "the gate held and nothing says it was sent");
  assert.ok(!(await retainPlaceholdersFlow(s.repo, id)).error);
  assert.equal((await s.as(() => getTailor(id))).status, 200);
  const first = await s.repo.artefactDownloads();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal((await s.as(() => getTailor(id, "format=pdf"))).status, 200);
  const again = await s.repo.artefactDownloads();
  assert.equal(again.length, 1);
  assert.equal(again[0].firstAt, first[0].firstAt);
  assert.ok(again[0].lastAt > first[0].lastAt);
  assert.equal(again[0].format, "pdf");
  const unknown = await s.as(() => getTailor(id, "version=v99"));
  assert.equal(unknown.status, 404);
  assert.equal((await s.repo.artefactDownloads()).length, 1);
});

test("a download still works if recording it fails", async () => {
  const s = student();
  const { id } = await setup(s.repo);
  const failing = { recordDownload: async () => { throw new Error("database down"); } } as unknown as Repo;
  await assert.doesNotReject(noteDownload(failing, { reportId: id, documentVersion: "a".repeat(64), format: "docx" }));
  // And the page then errs towards "download again".
  assert.deepEqual(await s.repo.artefactDownloads(), []);
});

test("every download route records exactly the version it served, and only the owner's", async () => {
  const s = student();
  const { cvId, id } = await setup(s.repo);
  const uploaded = await uploadFlow(s.repo, { bytes: new Uint8Array(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/extraction/single-column.pdf"))), fileName: "single-column.pdf", sector: "Technology", stage: STAGES[0], key: crypto.randomUUID().replace(/-/g, "") });
  const reviewed = "id" in uploaded ? uploaded.id : (uploaded as { review?: { reportId?: string } }).review?.reportId;
  assert.ok(reviewed, JSON.stringify(Object.keys(uploaded)));
  assert.equal((await s.as(() => sourceFileRoute(new Request("http://x"), { params: Promise.resolve({ id: reviewed! }) }))).status, 200);
  const w = (await load(s.repo)).workspace;
  const original = w.all.find((a) => a.reportId === reviewed)!;
  const rec = (await s.repo.artefactDownloads()).find((d) => d.reportId === reviewed)!;
  assert.equal(rec.format, "original");
  assert.ok(original.sameAsLatest.includes(rec.documentVersion), "the original of a CV with no saved lines is the latest");

  const li = (await createLinkedinFlow(s.repo, { sections: { headline: "Economics student seeking analyst roles", about: "I study economics.", experience: "", education: "", skills: "", other: "" }, source: { method: "paste", files: [], skippedFiles: 0, linksIgnored: [] }, aim: null, cvReportId: null } as never)).id!;
  assert.equal((await s.as(() => linkedinRoute(new Request("http://x"), { params: Promise.resolve({ id: li }) }))).status, 200);
  const profile = (await load(s.repo)).workspace.profile[0];
  assert.ok((await s.repo.artefactDownloads()).some((d) => d.reportId === li && d.documentVersion === profile.latest && d.format === "txt"));
  const withBlank = (await createLinkedinFlow(s.repo, { sections: { headline: "Economics student seeking [role]", about: "", experience: "", education: "", skills: "", other: "" }, source: { method: "paste", files: [], skippedFiles: 0, linksIgnored: [] }, aim: null, cvReportId: null } as never)).id!;
  assert.equal((await s.as(() => linkedinRoute(new Request("http://x"), { params: Promise.resolve({ id: withBlank }) }))).status, 409);
  assert.ok(!(await s.repo.artefactDownloads()).some((d) => d.reportId === withBlank));
  assert.equal((await load(s.repo)).workspace.profile.find((p) => p.reportId === withBlank)!.blocked, "Fill in the blanks in 1 section first.");

  const stranger = student();
  const before = (await s.repo.artefactDownloads()).length;
  assert.equal((await stranger.as(() => getTailor(id))).status, 404);
  assert.equal((await stranger.as(() => letterRoute(request(`/api/letters/${id}`), { params: Promise.resolve({ id }) }))).status, 404);
  const slug = downloadHref({ reportId: cvId, type: "cv_review" }, "docx").match(/templates\/([^?]+)/)![1];
  assert.equal((await stranger.as(() => templateRoute(request(downloadHref({ reportId: cvId, type: "cv_review" }, "docx")), { params: Promise.resolve({ slug }) }))).status, 404);
  assert.equal((await s.repo.artefactDownloads()).length, before);
  assert.deepEqual(await stranger.repo.artefactDownloads(), []);
});

test("after a session expires, every action says so, changes nothing, and works once signed back in", async () => {
  const s = student();
  const { id } = await setup(s.repo);
  const appId = (await s.as(() => trackRole(id))).applicationId!;
  const link = (await s.repo.applicationLinks())[0];
  const key = (await load(s.repo)).actions[0].key;
  for (const out of [
    await as0(() => linkArtefact(appId, id, id)),
    await as0(() => unlinkArtefact(appId, "tailor", id)),
    await as0(() => keepVersion(appId, id, "tailor", null, id)),
    await as0(() => trackRole(id)),
    await as0(() => stopTracking(appId)),
    await as0(() => dismissAction(key, "done")),
    await as0(() => reopenAction(key)),
  ]) {
    assert.match(out.error!, /session has expired/);
  }
  assert.equal((await as0(() => getTailor(id))).status, 401);
  assert.deepEqual((await s.repo.applicationLinks())[0], link);
  assert.ok((await s.repo.applications()).some((a) => a.id === appId));
  assert.deepEqual(await s.repo.actionChoices(), []);
  assert.deepEqual(await s.repo.artefactDownloads(), []);
  assert.deepEqual(await s.as(() => dismissAction(key, "done")), {}, "the same action, after signing in");
  assert.equal((await s.repo.actionChoices()).length, 1);
});

test("two tabs: the second is told, and what the first saved stands", async () => {
  const s = student();
  const { cvId, id } = await setup(s.repo);
  const payload = buildTailorPayload({ cvReportId: cvId, cvFileName: "cv.pdf", cvText: REWRITE_CV, jobTitle: "Risk Graduate", employer: "Calder", jobUrl: null, jobText: ADVERT, deadline: null });
  const second = await s.repo.createReport({ type: "tailor", title: "Risk Graduate · Calder", score: payload.matchNow, payload });
  const appId = (await s.as(() => trackRole(id))).applicationId!;
  // Tab B loaded the page when this was empty. Tab A's first link is already there.
  const stale = await s.as(() => linkArtefact(appId, second, null));
  assert.match(stale.error!, /another tab, so nothing was replaced/);
  assert.equal((await s.repo.applicationLinks())[0].reportId, id);
  // Tab A keeps moving the document on. Tab B's download is of what is selected now, and says so in the record.
  const hashBefore = (await load(s.repo)).workspace.all.find((a) => a.reportId === id)!.latest!;
  await keepOne(s.repo, id, 1);
  const hashAfter = (await load(s.repo)).workspace.all.find((a) => a.reportId === id)!.latest!;
  assert.notEqual(hashBefore, hashAfter);
  assert.equal((await s.as(() => getTailor(id))).status, 200);
  assert.equal((await s.repo.artefactDownloads())[0].documentVersion, hashAfter);
  // Keeping the version Tab B was looking at is refused, not silently moved to the newer one.
  const kept = await s.as(() => keepVersion(appId, id, "tailor", hashBefore, id));
  assert.match(kept.error!, /another tab/);
  // A dismissal from both tabs is one choice.
  const key = (await load(s.repo)).actions[0].key;
  assert.deepEqual(await s.as(() => dismissAction(key, "later")), {});
  assert.deepEqual(await s.as(() => dismissAction(key, "done")), {});
  assert.deepEqual((await s.repo.actionChoices()).map((c) => c.reason), ["later"]);
});

test("a refresh reads the same thing: nothing on the dashboard lives only in the page", async () => {
  const s = student();
  const { id } = await setup(s.repo);
  const appId = (await s.as(() => trackRole(id))).applicationId!;
  const hash = (await load(s.repo)).workspace.all.find((a) => a.reportId === id)!.latest!;
  await s.as(() => keepVersion(appId, id, "tailor", hash, id));
  await s.as(() => getTailor(id));
  const [a, b] = [await load(s.repo), await load(demoRepo(`student-${s.id}`, "student"))];
  assert.deepEqual(a, b);
  assert.equal(a.workspace.applications.find((g) => g.application.id === appId)!.slots.tailor!.kept?.documentVersion, hash);
});

test("actions refuse malformed input before touching anything, and refuse other students' records", async () => {
  const s = student();
  const { id } = await setup(s.repo);
  const appId = (await s.as(() => trackRole(id))).applicationId!;
  const stranger = student();
  for (const out of [
    await s.as(() => unlinkArtefact(appId, "linkedin", id)),
    await s.as(() => keepVersion(appId, id, "tailor", "not-a-hash", id)),
    await s.as(() => dismissAction("<script>alert(1)</script>", "done")),
    await s.as(() => reopenAction("KEY WITH SPACES")),
    await s.as(() => linkArtefact("", id, null)),
  ]) {
    assert.match(out.error!, /couldn't find that/);
  }
  assert.match((await stranger.as(() => linkArtefact(appId, id, null))).error!, /couldn't find that/);
  assert.match((await stranger.as(() => trackRole(id))).error!, /couldn't find that/);
  assert.deepEqual(await stranger.as(() => stopTracking(appId)), {}, "says nothing about whether it exists");
  assert.ok((await s.repo.applications()).some((a) => a.id === appId), "and it's still there");
  assert.ok(LIMITS.applicationChoicePerUser.max > 0);
  assert.equal(typeof hit, "function");
});

test("a tailored CV started from a tracked listing goes on that application, once", async () => {
  const s = student();
  const cv = buildCvPayload({ fileName: "cv.pdf", text: REWRITE_CV, sector: "Technology", stage: "Final year" });
  await s.repo.createReport({ type: "cv_review", title: "cv.pdf", score: cv.analysis.score, payload: cv });
  const opp = (await s.repo.opportunities()).find((o) => !s.repo.applications || o.id === "opp-northbank-analyst")!;
  assert.deepEqual(await s.as(() => trackOpportunity(opp.id, true)), {});
  const form = new FormData();
  form.set("opportunityId", opp.id);
  const first = await s.as(() => createTailor(form));
  assert.ok(first.id, JSON.stringify(first));
  const second = await s.as(() => createTailor(form));
  assert.equal(second.id, first.id, "a repeat finds the first");
  const app = (await s.repo.applications()).find((a) => a.opportunityId === opp.id)!;
  const links = (await s.repo.applicationLinks()).filter((l) => l.applicationId === app.id);
  assert.deepEqual(links.map((l) => [l.kind, l.reportId, l.documentVersion]), [["tailor", first.id, null]]);
  // Stopping tracking leaves the report, and tracking again doesn't pretend the link survived.
  assert.deepEqual(await s.as(() => trackOpportunity(opp.id, false)), {});
  assert.ok(await s.repo.getReport(first.id!));
  assert.deepEqual((await s.repo.applicationLinks()).filter((l) => l.reportId === first.id), []);
  assert.deepEqual(await s.as(() => trackOpportunity(opp.id, true)), {});
  const role = (await load(s.repo)).workspace.roles.find((r) => r.documents.some((d) => d.reportId === first.id))!;
  assert.equal(role.suggestion?.opportunityId, opp.id, "it's offered back, for the student to confirm");
});

test("no number moves: scores and saved payloads are the same after everything here", async () => {
  const s = student();
  const { cvId, id } = await setup(s.repo);
  const [cvBefore, tBefore] = [await s.repo.getReport<CvReviewPayload>(cvId), await s.repo.getReport<TailorPayload>(id)];
  const appId = (await s.as(() => trackRole(id))).applicationId!;
  await s.as(() => linkArtefact(appId, cvId, cvId).then(() => linkArtefact(appId, cvId, null)));
  await s.as(() => getTailor(id));
  const key = (await load(s.repo)).actions[0].key;
  await s.as(() => dismissAction(key, "not_relevant"));
  await s.as(() => reopenAction(key));
  await s.as(() => unlinkArtefact(appId, "tailor", id));
  await s.as(() => stopTracking(appId));
  assert.deepEqual(await s.repo.getReport(cvId), cvBefore);
  assert.deepEqual(await s.repo.getReport(id), tBefore);
  assert.ok(typeof cvBefore!.row.score === "number");
});

test("the student's data download includes the links, downloads and dismissals", async () => {
  const s = student();
  const { id } = await setup(s.repo);
  await s.as(() => trackRole(id));
  await s.as(() => getTailor(id));
  const key = (await load(s.repo)).actions[0].key;
  await s.as(() => dismissAction(key, "done"));
  const res = await s.as(() => exportRoute());
  const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
  const out = JSON.parse(await zip.file("application-documents.json")!.async("string"));
  assert.equal(out.links.length, 1);
  assert.equal(out.downloads.length, 1);
  assert.equal(out.recommendationChoices[0].reason, "done");
  assert.ok(Array.isArray(JSON.parse(await zip.file("applications.json")!.async("string"))), "that file keeps its shape");
});

test("deleting an account takes links, downloads and dismissals with it", async () => {
  const s = student();
  const { id } = await setup(s.repo);
  await s.as(() => trackRole(id));
  await s.as(() => getTailor(id));
  await s.repo.deleteAccount();
  const fresh = demoRepo(`student-${s.id}`, "student");
  assert.deepEqual(await fresh.applicationLinks(), []);
  assert.deepEqual(await fresh.artefactDownloads(), []);
  assert.deepEqual(await fresh.actionChoices(), []);
});
