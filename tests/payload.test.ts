// OP-004: versioned report payloads, findings, write-time validation and the legacy adapter.
//
// Two things are asserted throughout: no number a saved report carries changes (the analysis is byte
// for byte what `analyseCv` produced), and a historical record says only what it recorded.
import assert from "node:assert/strict";
import { test } from "node:test";
import { analyseCv, CHECK_ORDER, cvBullets, findCheck } from "@/lib/analysis/cv";
import { cvAssessment, cvBlocks, documentVersion, LEGACY_LIMITS, PASS_SCORE } from "@/lib/analysis/findings";
import { isSupplemental } from "@/lib/analysis/supplemental";
import { AI_JUDGE_MODEL, ruleJudgment } from "@/lib/analysis/judgment";
import { LEXICON_VERSION, SECTOR_KEYWORDS } from "@/lib/analysis/lexicon";
import { PARSER_VERSION } from "@/lib/analysis/parse";
import { RUBRIC_VERSION } from "@/lib/analysis/rubric";
import { demoRepo } from "@/lib/repo/demo";
import { supabaseRepo } from "@/lib/repo/supabase";
import type { Repo } from "@/lib/repo/types";
import { checkEvidence, fromStored, PayloadError, toStored } from "@/lib/report-schema";
import { reviewLetter } from "@/lib/analysis/letter";
import { DEMO_CVS, DEMO_LETTER, SAMPLE_OPPORTUNITIES } from "@/lib/seed-data";
import { buildCvPayload, buildLetterReviewPayload, buildTailorPayload } from "@/lib/services";
import { PAYLOAD_VERSION, type CoverLetterPayload, type CvReviewPayload, type Finding, type TailorPayload } from "@/lib/types";
import { AUDIT_CLEAN_CV, AUDIT_MISSPELLED_CV, AUDIT_SECTOR } from "./fixtures/audit";
import { fakeSupabase, type FakeRow } from "./fixtures/fake-supabase";
import { LEGACY_CV_NO_BULLETS_ALL_TENS, LEGACY_CV_OLD_WORDING, LEGACY_TAILOR, legacyLetter, oldLetterPayload, v0 } from "./fixtures/legacy-payloads";

const STAGE = "Final year, graduate roles";
const FINANCE = "Finance and banking";
const northbank = SAMPLE_OPPORTUNITIES[0];
const USER = "00000000-0000-4000-8000-000000000001";

const cv = (text: string, sector: string) => buildCvPayload({ fileName: "cv.pdf", text, sector, stage: STAGE });
const json = (x: unknown) => JSON.stringify(x);
const finding = (p: { assessment: { findings: Finding[] } }, id: string) => p.assessment.findings.find((f) => f.id === id)!;

/** The same contract runs against both repositories. */
function repos(): { name: string; repo: Repo; rows: FakeRow[] }[] {
  const fake = fakeSupabase();
  return [
    { name: "demo", repo: demoRepo(`student-${crypto.randomUUID()}`, "student"), rows: [] },
    { name: "supabase", repo: supabaseRepo(fake.client, USER, () => fake.client), rows: fake.rows },
  ];
}

// The twelve CV/sector cases the batch 01 review compared against its independent baseline.
const CASES = [
  ...[AUDIT_CLEAN_CV, AUDIT_MISSPELLED_CV].flatMap((text) => [AUDIT_SECTOR, FINANCE].map((sector) => ({ text, sector }))),
  ...DEMO_CVS.flatMap((c) => [FINANCE, "Technology"].map((sector) => ({ text: c.text, sector }))),
];

/* ---------- numbers must not move ---------- */

test("findings sit beside the analysis: no score, fingerprint or rubric version moves", () => {
  for (const { text, sector } of CASES) {
    const p = cv(text, sector);
    assert.equal(json(p.analysis), json(analyseCv(text, sector)), `${sector}: analysis is exactly what analyseCv produced`);
    assert.equal(p.analysis.meta.rubric, RUBRIC_VERSION);
    assert.equal(json(toStored("cv_review", p)), json(p), "validation returns the payload unchanged");
    assert.equal(json((fromStored("cv_review", toStored("cv_review", p)) as CvReviewPayload).analysis), json(p.analysis), "a read of what was written is byte-identical");
  }
  // Recorded on 5 November 2026 before any OP-002 or OP-004 change (tests/audit.test.ts holds the full table).
  assert.equal(cv(AUDIT_CLEAN_CV, AUDIT_SECTOR).analysis.meta.fingerprint, "71f0fa1c7c4de776e10f31c706b92867891a88f1c5f6628748c554991fec4f1e");
  assert.equal(cv(AUDIT_MISSPELLED_CV, AUDIT_SECTOR).analysis.meta.fingerprint, "ce3aa9f9d350a916e0e57029e693ef626ff86ec31945afdac29d3b97889e1998");
  assert.equal(cv(AUDIT_MISSPELLED_CV, AUDIT_SECTOR).analysis.score, 83);
  const tailor = buildTailorPayload({ cvReportId: "x", cvFileName: "cv.pdf", cvText: DEMO_CVS[3].text, jobTitle: northbank.role, employer: northbank.org, jobUrl: null, jobText: northbank.description, deadline: null });
  // Job scoring has a new version (OP-013): evidence coverage, nothing estimated until a revised CV is measured.
  // The 35 and 66 this used to pin are the numbers old reports keep: tests/job-match.test.ts holds them.
  assert.deepEqual([tailor.matchNow, tailor.matchTailored], [29, null], "tailor coverage is the engine's own");
  // Letter number from the same pre-change baseline capture. New letters have a new version (OP-017), and this is the method old reports keep: tests/letter-review.test.ts pins the new one.
  assert.equal(reviewLetter(DEMO_LETTER, northbank.description, northbank.org, DEMO_CVS[3].text).score, 67, "the old letter method is unchanged");
});

test("both repositories write and read the same current payload", async () => {
  for (const { name, repo } of repos()) {
    for (const { text, sector } of CASES.slice(0, 6)) {
      const p = cv(text, sector);
      const id = await repo.createReport({ type: "cv_review", title: "cv.pdf", score: p.analysis.score, payload: p });
      const got = (await repo.getReport<CvReviewPayload>(id))!;
      assert.equal(got.row.type, "cv_review", name);
      assert.equal(got.payload.payloadVersion, PAYLOAD_VERSION, name);
      assert.equal(got.payload.assessment.origin, "engine", name);
      assert.equal(json(got.payload.analysis), json(analyseCv(text, sector)), `${name}: stored analysis byte-identical`);
      assert.deepEqual(got.payload, p, `${name}: the whole payload round-trips`);
    }
    const t = buildTailorPayload({ cvReportId: USER, cvFileName: "cv.pdf", cvText: DEMO_CVS[3].text, jobTitle: northbank.role, employer: northbank.org, jobUrl: null, jobText: northbank.description, deadline: northbank.closesOn });
    const tid = await repo.createReport({ type: "tailor", title: "t", score: t.matchNow, payload: t });
    assert.deepEqual((await repo.getReport<TailorPayload>(tid))!.payload, t, name);
    const l = buildLetterReviewPayload({ letterText: DEMO_LETTER, jobTitle: northbank.role, employer: northbank.org, jobText: northbank.description, tailorReportId: null, cvReportId: null, cvFileName: null, cvText: DEMO_CVS[3].text });
    const lid = await repo.createReport({ type: "cover_letter", title: "l", score: l.score, payload: l.payload });
    assert.deepEqual((await repo.getReport<CoverLetterPayload>(lid))!.payload, l.payload, name);
    assert.equal((await repo.latestReport<CoverLetterPayload>("cover_letter"))!.row.id, lid, name);
  }
});

/* ---------- the schema ---------- */

test("every CV check becomes a finding whose evidence resolves in the saved text", () => {
  // Two US variants, so the spelling check is below the pass line and has words to point at.
  const text = AUDIT_CLEAN_CV.replace("Managed customer", "Organized customer").replace("Developed financial", "Analyzed financial");
  const p = cv(text, AUDIT_SECTOR);
  const { assessment: a } = p;
  assert.deepEqual(a.findings.filter((f) => !isSupplemental(f)).map((f) => f.id).sort(), [...CHECK_ORDER].sort(), "one finding per check, keyed by the check");
  assert.equal(a.documentVersion, documentVersion(text));
  assert.deepEqual(a.versions, { parser: PARSER_VERSION, rubric: RUBRIC_VERSION, model: null, dictionary: LEXICON_VERSION });
  assert.equal(a.origin, "engine");
  assert.deepEqual(a.limits, []);
  assert.deepEqual(checkEvidence(a.findings, { [a.documentVersion]: cvBlocks(text, p.analysis.lines) }), []);
  for (const f of a.findings.filter((x) => !isSupplemental(x))) {
    const c = findCheck(p.analysis, f.check as never)!;
    assert.equal(f.explanation, c.detail, `${f.id} explains with the check's own words`);
    assert.equal(f.status, c.score >= PASS_SCORE ? "passed" : "needs_attention", f.id);
    assert.equal(f.method, "rules");
    assert.equal(f.confidence, 1);
    if (f.status === "passed") assert.equal(f.action, null, `${f.id}: nothing to do`);
    else assert.ok(f.action, `${f.id}: has a next step`);
  }
  const spell = finding(p, "spell");
  assert.equal(findCheck(p.analysis, "spell")!.score, 6);
  assert.equal(spell.status, "needs_attention");
  assert.equal(spell.severity, "medium");
  assert.equal(spell.action, "Switch US spellings to UK spelling");
  assert.deepEqual(spell.evidence.map((e) => e.quote), ["Organized", "Analyzed"], "the words themselves, found in the lines");
  for (const e of spell.evidence) {
    assert.match(e.block, /^line:\d+$/);
    assert.ok(e.range && e.range.end > e.range.start);
    assert.equal(p.analysis.lines[Number(e.block.slice(5))].text.slice(e.range!.start, e.range!.end), e.quote, "offsets are valid in this document version");
  }
  const quant = finding(p, "quant");
  assert.deepEqual(quant.evidence.map((e) => e.block), findCheck(p.analysis, "quant")!.affected.map((i) => `line:${i}`));
  for (const e of quant.evidence) assert.equal(e.range, null, "line-level evidence records the block, not an offset");
});

test("unassessed is not passed: with no bullets the line checks are not applicable, however they scored", () => {
  const p = cv("Alex Example\nalex@example.com\nEXPERIENCE\nAnalyst at Example Ltd\nEDUCATION\nBSc Computing\nSKILLS\nExcel", AUDIT_SECTOR);
  assert.equal(p.analysis.meta.bullets, 0);
  for (const id of ["quant", "verbs", "accomp", "repeat", "filler", "buzz", "passive", "grammar", "bulletlen"]) {
    const f = finding(p, id);
    assert.equal(f.status, "not_applicable", id);
    assert.match(f.action!, /Add bullet points/, id);
    assert.deepEqual(f.evidence, []);
  }
  assert.equal(finding(p, "bullets").status, "needs_attention", "no bullets is itself the finding");
  assert.equal(finding(p, "bullets").severity, "high");
  // A passed status is about the narrow check, and the explanation says so: 10/10 on spelling variants is not
  // evidence of correct spelling (OP-007).
  const bad = finding(cv(AUDIT_MISSPELLED_CV, AUDIT_SECTOR), "spell");
  assert.equal(bad.status, "passed");
  assert.match(bad.explanation, /other spelling mistakes aren't detected/i);
  assert.equal(finding(cv(AUDIT_MISSPELLED_CV, AUDIT_SECTOR), "sector").severity, "info", "sector fit never moves the score, so it is never severe");
});

test("judge-based checks in AI mode are marked as the model's, with no invented confidence", () => {
  const text = DEMO_CVS[3].text;
  const judgments = cvBullets(text).map((b) => ruleJudgment(b.text, SECTOR_KEYWORDS[FINANCE]));
  const a = analyseCv(text, FINANCE, { judgments, method: "ai" });
  const assessment = cvAssessment(a, text);
  assert.equal(assessment.versions.model, AI_JUDGE_MODEL);
  for (const f of assessment.findings.filter((x) => !isSupplemental(x))) {
    const judged = ["quant", "verbs", "accomp", "sector"].includes(f.id);
    assert.equal(f.method, judged ? "ai" : "rules", f.id);
    assert.equal(f.confidence, judged ? null : 1, f.id);
  }
  assert.deepEqual(checkEvidence(assessment.findings, { [assessment.documentVersion]: cvBlocks(text, a.lines) }), []);
});

test("on a report from before versioned letter scoring, the keyword check is not applicable without a job ad and uncertain when the ad yields nothing", () => {
  const none = oldLetterPayload(DEMO_LETTER, "").payload;
  const kw = none.assessment.findings.find((f) => f.check === "Keywords from the job ad")!;
  assert.equal(none.checks.find((c) => c.t === "Keywords from the job ad")!.ok, true, "the saved boolean still says ok (score unchanged)");
  assert.equal(kw.status, "not_applicable", "but the finding says it was never assessed");
  assert.equal(oldLetterPayload(DEMO_LETTER, "We would like someone pleasant.").payload.assessment.findings.find((f) => f.check === "Keywords from the job ad")!.status, "uncertain");
  const withAd = oldLetterPayload(DEMO_LETTER, northbank.description).payload;
  for (const f of withAd.assessment.findings) {
    const c = withAd.checks.find((x) => x.t === f.check)!;
    assert.equal(f.status, c.ok ? "passed" : "needs_attention", f.check);
  }
  assert.equal(withAd.assessment.documentVersion, documentVersion(DEMO_LETTER));
  assert.equal(new Set(withAd.assessment.findings.map((f) => f.id)).size, withAd.checks.length, "ids are unique");
});

/* ---------- invalid output cannot persist ---------- */

test("invalid payloads are refused by both repositories and nothing is saved", async () => {
  const good = cv(DEMO_CVS[3].text, FINANCE);
  const bad: [string, unknown][] = [
    ["score out of range", { ...good, analysis: { ...good.analysis, score: 101 } }],
    ["check score out of range", { ...good, analysis: { ...good.analysis, areas: good.analysis.areas.map((ar) => ({ ...ar, checks: ar.checks.map((c) => ({ ...c, score: 11 })) })) } }],
    ["missing findings", { ...good, assessment: undefined }],
    ["unknown field", { ...good, scoreOverride: 100 }],
    ["unknown status", { ...good, assessment: { ...good.assessment, findings: good.assessment.findings.map((f) => ({ ...f, status: "fine" })) } }],
    ["confidence above 1", { ...good, assessment: { ...good.assessment, findings: good.assessment.findings.map((f) => ({ ...f, confidence: 1.5 })) } }],
    ["future version", { ...good, payloadVersion: 2 }],
    ["not an object", "payload"],
    ["null", null],
  ];
  const tailor = buildTailorPayload({ cvReportId: USER, cvFileName: "cv.pdf", cvText: DEMO_CVS[3].text, jobTitle: "x", employer: "y", jobUrl: null, jobText: northbank.description, deadline: null });
  const letter = buildLetterReviewPayload({ letterText: DEMO_LETTER, jobTitle: "x", employer: "y", jobText: northbank.description, tailorReportId: null, cvReportId: null, cvFileName: null, cvText: "" }).payload;
  for (const { name, repo } of repos()) {
    for (const [why, payload] of bad) {
      await assert.rejects(repo.createReport({ type: "cv_review", title: "cv.pdf", score: 50, payload }), PayloadError, `${name}: ${why}`);
    }
    await assert.rejects(repo.createReport({ type: "tailor", title: "t", score: 50, payload: { ...tailor, matchNow: 150 } }), PayloadError, `${name}: tailor match out of range`);
    await assert.rejects(repo.createReport({ type: "cover_letter", title: "l", score: 50, payload: { ...letter, checks: [{ ok: "yes", t: "x", d: "y" }] } }), PayloadError, `${name}: letter check not boolean`);
    await assert.rejects(repo.createReport({ type: "cover_letter", title: "l", score: 50, payload: good }), PayloadError, `${name}: a CV payload is not a letter`);
    const before = (await repo.listReports({})).total;
    const id = await repo.createReport({ type: "cv_review", title: "cv.pdf", score: good.analysis.score, payload: good });
    assert.equal((await repo.listReports({})).total, before + 1, `${name}: only the valid payload was saved`);
    await assert.rejects(repo.updateReport(id, { payload: { ...good, analysis: { ...good.analysis, score: -1 } } }), PayloadError, `${name}: update is gated too`);
    assert.deepEqual((await repo.getReport<CvReviewPayload>(id))!.payload, good, `${name}: the stored report is untouched after a refused update`);
    await assert.rejects(repo.updateReport(id, { payload: letter }), PayloadError, `${name}: a report keeps its type`);
  }
});

test("evidence that does not resolve in the text is rejected", async () => {
  const text = AUDIT_CLEAN_CV.replace("Managed customer", "Organized customer");
  const p = cv(text, AUDIT_SECTOR);
  const docs = { [p.assessment.documentVersion]: cvBlocks(text, p.analysis.lines) };
  const spell = finding(p, "spell");
  const ref = spell.evidence[0];
  assert.ok(ref.range, "the fixture has a ranged reference to tamper with");
  const withRef = (e: Partial<typeof ref>): Finding[] => p.assessment.findings.map((f) => (f.id === "spell" ? { ...f, evidence: [{ ...ref, ...e }] } : f));
  assert.match(checkEvidence(withRef({ range: { start: ref.range!.start, end: 9999 } }), docs)[0], /outside line:/);
  assert.match(checkEvidence(withRef({ range: { start: ref.range!.start + 1, end: ref.range!.end + 1 } }), docs)[0], /quote does not match/);
  assert.match(checkEvidence(withRef({ range: { start: 5, end: 5 } }), docs)[0], /outside/);
  assert.match(checkEvidence(withRef({ block: "line:99" }), docs)[0], /unknown block/);
  assert.match(checkEvidence(withRef({ documentVersion: "deadbeef" }), docs)[0], /unknown document version/);
  assert.match(checkEvidence(withRef({ range: null, quote: "not the line" }), docs)[0], /quote does not match/);
  assert.match(checkEvidence([...p.assessment.findings, { ...spell }], docs)[0], /duplicate finding id/);
  assert.deepEqual(checkEvidence(p.assessment.findings, docs), [], "the untampered evidence is fine");
  // And the persistence gate uses the same check, so a model-supplied offset never reaches the database.
  const tampered = { ...p, assessment: { ...p.assessment, findings: withRef({ range: { start: 0, end: 9999 } }) } };
  const wrongDoc = { ...p, assessment: { ...p.assessment, documentVersion: documentVersion("some other text") } };
  for (const { name, repo } of repos()) {
    await assert.rejects(repo.createReport({ type: "cv_review", title: "cv.pdf", score: 50, payload: tampered }), /evidence is invalid.*outside/, name);
    await assert.rejects(repo.createReport({ type: "cv_review", title: "cv.pdf", score: 50, payload: wrongDoc }), /different document version/, name);
  }
});

/* ---------- legacy records ---------- */

test("a report saved before findings existed keeps its scores and words; what it never recorded stays unknown", () => {
  const stored = structuredClone(LEGACY_CV_OLD_WORDING);
  const out = fromStored("cv_review", stored) as CvReviewPayload;
  assert.equal(out.payloadVersion, PAYLOAD_VERSION);
  assert.equal(json(out.analysis), json(LEGACY_CV_OLD_WORDING.analysis), "not a number or a word of the saved analysis changes");
  assert.equal(findCheck(out.analysis, "spell")!.name, "Spelling", "historical wording is kept, not rewritten");
  const a = out.assessment;
  assert.equal(a.origin, "legacy");
  assert.deepEqual(a.limits, LEGACY_LIMITS);
  assert.match(a.limits.join(" "), /not recorded/);
  assert.deepEqual(a.versions, { parser: null, rubric: RUBRIC_VERSION, model: null, dictionary: null }, "rubric was in meta; the rest was never saved");
  assert.equal(a.documentVersion, documentVersion(LEGACY_CV_OLD_WORDING.text));
  assert.equal(a.findings.length, 16);
  for (const f of a.findings) {
    assert.equal(f.confidence, null, `${f.id}: no confidence is manufactured`);
    assert.equal(f.method, "rules", `${f.id}: the saved method was rules`);
    for (const e of f.evidence) assert.equal(e.range, null, `${f.id}: no offsets are manufactured`);
  }
  const spell = finding(out, "spell");
  assert.equal(spell.status, "passed", "read from the saved 10/10");
  assert.equal(spell.explanation, "No US spellings found.", "the explanation is what the report said at the time");
  assert.deepEqual(checkEvidence(a.findings, { [a.documentVersion]: cvBlocks(out.text, out.analysis.lines) }), [], "block-level evidence still resolves");
  assert.equal(json(toStored("cv_review", out)), json(out), "the adapted record is valid under the current contract as it stands");
});

test("a legacy no-bullet report that scored 10/10 with nothing to assess reads as not applicable, totals untouched", () => {
  const out = fromStored("cv_review", structuredClone(LEGACY_CV_NO_BULLETS_ALL_TENS)) as CvReviewPayload;
  assert.equal(json(out.analysis), json(LEGACY_CV_NO_BULLETS_ALL_TENS.analysis), "the saved totals are historical and are not recomputed");
  for (const id of ["accomp", "repeat", "filler", "buzz", "passive", "grammar", "bulletlen"]) {
    assert.equal(findCheck(out.analysis, id as never)!.score, 10, `${id} still shows its saved 10`);
    assert.equal(finding(out, id).status, "not_applicable", `${id} is not read as a pass`);
  }
  for (const f of out.assessment.findings) assert.equal(f.method, null, `${f.id}: the record never said how it was judged`);
  assert.equal(out.assessment.versions.model, null);
});

test("legacy letters and tailor reports adapt with the same rules", () => {
  const noAd = fromStored("cover_letter", structuredClone(legacyLetter(""))) as CoverLetterPayload;
  assert.equal(noAd.assessment.origin, "legacy");
  assert.equal(noAd.assessment.findings.find((f) => f.check === "Keywords from the job ad")!.status, "not_applicable");
  assert.ok(noAd.assessment.limits.some((l) => /not recorded/.test(l)));
  for (const f of noAd.assessment.findings) assert.equal(f.confidence, null);
  const vagueAd = fromStored("cover_letter", structuredClone(legacyLetter("We would like someone pleasant."))) as CoverLetterPayload;
  assert.equal(vagueAd.assessment.findings.find((f) => f.check === "Keywords from the job ad")!.status, "uncertain");
  const tailor = fromStored("tailor", structuredClone(LEGACY_TAILOR)) as TailorPayload;
  assert.deepEqual(tailor, { payloadVersion: PAYLOAD_VERSION, ...LEGACY_TAILOR }, "tailor reports gain the version and nothing else: a report made before versioned job scoring has no findings to show");
});

test("unknown versions and unreadable records fail loudly instead of rendering a guess", () => {
  assert.throws(() => fromStored("cv_review", { ...cv(AUDIT_CLEAN_CV, AUDIT_SECTOR), payloadVersion: 2 }), (e: unknown) => e instanceof PayloadError && /version 2/.test((e as Error).message));
  assert.throws(() => fromStored("cv_review", { fileName: "x.pdf", text: "hello" }), (e: unknown) => e instanceof PayloadError && /could not be read/.test((e as Error).message));
  assert.throws(() => fromStored("cv_review", { ...cv(AUDIT_CLEAN_CV, AUDIT_SECTOR), analysis: { ...analyseCv(AUDIT_CLEAN_CV, AUDIT_SECTOR), score: "high" } }), PayloadError);
  assert.throws(() => fromStored("tailor", 42), PayloadError);
  // A stray key on a v0 record is dropped rather than failing a student's report page.
  const out = fromStored("tailor", { ...LEGACY_TAILOR, legacyFlag: true }) as TailorPayload & { legacyFlag?: boolean };
  assert.equal(out.legacyFlag, undefined);
});

test("both repositories read a stored legacy row through the adapter, and it stays marked legacy after an edit", async () => {
  // Demo: the seed keeps the oldest upload in the v0 shape.
  const demo = demoRepo(`student-${crypto.randomUUID()}`, "student");
  const rows = (await demo.listReports({ type: "cv_review" })).rows;
  const oldest = rows[rows.length - 1];
  assert.equal(oldest.title, DEMO_CVS[0].fileName);
  const legacy = (await demo.getReport<CvReviewPayload>(oldest.id))!.payload;
  assert.equal(legacy.assessment.origin, "legacy");
  const engine = analyseCv(DEMO_CVS[0].text, FINANCE);
  delete engine.meta.scoring; // A report in the v0 shape predates the scoring record, and the seed strips it.
  assert.equal(json(legacy.analysis), json(engine), "the seeded scores are the engine's, untouched by the adapter");
  const newest = (await demo.latestReport<CvReviewPayload>("cv_review"))!.payload;
  assert.equal(newest.assessment.origin, "engine");

  // Supabase: a v0 row already in the table.
  const fake = fakeSupabase([{ id: "22222222-2222-4222-8222-222222222222", user_id: USER, type: "cv_review", title: "old_cv.pdf", score: 83, payload: structuredClone(LEGACY_CV_OLD_WORDING), storage_path: null, created_at: "2026-10-01T10:00:00.000Z" }]);
  const sb = supabaseRepo(fake.client, USER, () => fake.client);
  const read = (await sb.getReport<CvReviewPayload>("22222222-2222-4222-8222-222222222222"))!;
  assert.equal(read.payload.assessment.origin, "legacy");
  assert.equal(json(read.payload.analysis), json(LEGACY_CV_OLD_WORDING.analysis));
  assert.equal(fake.rows[0].payload && (fake.rows[0].payload as { payloadVersion?: number }).payloadVersion, undefined, "reading does not rewrite the stored row");
  assert.equal(await sb.getReport("33333333-3333-4333-8333-333333333333"), null, "someone else's or a missing id is not found");
  assert.equal(await supabaseRepo(fake.client, "00000000-0000-4000-8000-000000000002", () => fake.client).getReport("22222222-2222-4222-8222-222222222222"), null, "another user cannot read it");

  // What `rewriteLine` does: read, change one line's suggestion, write back.
  for (const [name, repo, id] of [["demo", demo, oldest.id], ["supabase", sb, "22222222-2222-4222-8222-222222222222"]] as const) {
    const r = (await repo.getReport<CvReviewPayload>(id))!;
    r.payload.analysis.lines[0] = { ...r.payload.analysis.lines[0], rewrite: "A new suggestion.", aiRewrite: false };
    await repo.updateReport(id, { payload: r.payload });
    const again = (await repo.getReport<CvReviewPayload>(id))!.payload;
    assert.equal(again.payloadVersion, PAYLOAD_VERSION, name);
    assert.equal(again.assessment.origin, "legacy", `${name}: an upgraded legacy record never masquerades as recorded evidence`);
    assert.deepEqual(again.assessment.limits, LEGACY_LIMITS, name);
    assert.equal(again.analysis.lines[0].rewrite, "A new suggestion.", name);
    assert.equal(again.analysis.score, r.payload.analysis.score, name);
  }
  assert.equal((fake.rows[0].payload as { payloadVersion?: number }).payloadVersion, PAYLOAD_VERSION, "only the student's edit wrote the row in the current shape");
});

test("v0 helper really strips what v0 lacked, so the legacy fixtures are what they claim", () => {
  const p = cv(AUDIT_CLEAN_CV, AUDIT_SECTOR);
  const stripped = v0(p) as Partial<CvReviewPayload>;
  assert.equal("payloadVersion" in stripped, false);
  assert.equal("assessment" in stripped, false);
  assert.equal(json(stripped.analysis), json(p.analysis));
  assert.equal("payloadVersion" in LEGACY_CV_OLD_WORDING, false);
  assert.equal("assessment" in LEGACY_TAILOR, false);
});

/* ---------- document metadata (OP-005) rides with the payload ---------- */

test("document metadata is saved with the CV payload, reads back from both repositories, and is absent when nothing recorded it", async () => {
  const { extractDocument } = await import("@/lib/analysis/extract");
  const { documentMeta } = await import("@/lib/analysis/document");
  const fs = await import("node:fs");
  const bytes = new Uint8Array(fs.readFileSync("tests/fixtures/extraction/single-column.pdf"));
  const doc = await extractDocument(bytes, "single-column.pdf");
  const document = documentMeta(doc, bytes);
  const p = buildCvPayload({ fileName: "single-column.pdf", text: doc.text, sector: AUDIT_SECTOR, stage: STAGE, document });
  assert.equal(p.document?.documentVersion, p.assessment.documentVersion, "the document and the assessment describe the same text");
  assert.equal(json(p.analysis), json(analyseCv(doc.text, AUDIT_SECTOR)), "the metadata changes no number");
  assert.equal(p.document?.extraction.pages.estimated, p.analysis.meta.pages);
  assert.equal(p.document?.extraction.pages.provenance, "measured");
  assert.equal(p.payloadVersion, PAYLOAD_VERSION, "an optional field needs no new payload version");
  for (const { name, repo } of repos()) {
    const id = await repo.createReport({ type: "cv_review", title: "cv", score: p.analysis.score, payload: p });
    const got = (await repo.getReport<CvReviewPayload>(id))!;
    assert.deepEqual(got.payload.document, document, `${name}: the metadata round-trips`);
    assert.deepEqual(got.payload, p, name);
  }
  // Built from text alone (demo seeds, older reports): no document field at all, and that reads as "not recorded".
  const bare = cv(AUDIT_CLEAN_CV, AUDIT_SECTOR);
  assert.equal("document" in bare, false);
  assert.equal("document" in (fromStored("cv_review", toStored("cv_review", bare)) as CvReviewPayload), false);
  assert.equal("document" in (fromStored("cv_review", LEGACY_CV_OLD_WORDING) as CvReviewPayload), false, "a v0 record has none either");
});

test("document metadata that disagrees with the saved text, or breaks the schema, is refused and nothing is saved", async () => {
  const { extractDocument } = await import("@/lib/analysis/extract");
  const { documentMeta } = await import("@/lib/analysis/document");
  const fs = await import("node:fs");
  const bytes = new Uint8Array(fs.readFileSync("tests/fixtures/extraction/repeated-header.pdf"));
  const doc = await extractDocument(bytes, "repeated-header.pdf");
  const good = buildCvPayload({ fileName: "cv.pdf", text: doc.text, sector: AUDIT_SECTOR, stage: STAGE, document: documentMeta(doc, bytes) });
  assert.equal(json(toStored("cv_review", good)), json(good));
  const tamper = (edit: (d: NonNullable<CvReviewPayload["document"]>) => void) => {
    const copy = structuredClone(good);
    edit(copy.document!);
    return copy;
  };
  const bad: [string, CvReviewPayload, RegExp][] = [
    ["another text's version", tamper((d) => (d.documentVersion = documentVersion("other"))), /different text/],
    ["offset beyond the text", tamper((d) => (d.extraction.pages.starts = [0, good.text.length + 1])), /outside the text/],
    ["offsets out of order", tamper((d) => (d.extraction.pages.starts = [5, 0])), /outside the text or out of order/],
    ["fewer offsets than pages", tamper((d) => (d.extraction.pages.starts = [0])), /1 page offsets for 2 pages/],
    ["estimated provenance with a measured count", tamper((d) => (d.extraction.pages.provenance = "estimated")), /provenance/],
    ["text-less page beyond the count", tamper((d) => (d.extraction.pages.withoutText = [3])), /beyond the page count/],
    ["confidence above 1", tamper((d) => (d.extraction.confidence.score = 1.5)), /confidence/],
    ["unknown warning code", tamper((d) => (d.extraction.warnings[0].code = "ocr_failed" as never)), /code/],
    // "correction" and "paste" became real kinds in OP-006 (tests/sources.test.ts covers their rules); "ocr" is not one.
    ["unknown source kind", tamper((d) => ((d.source as { kind: string }).kind = "ocr")), /kind/],
    ["stray field", tamper((d) => ((d as unknown as Record<string, unknown>).ocr = true)), /ocr|Unrecognized/i],
  ];
  for (const [why, payload, re] of bad) {
    assert.throws(() => toStored("cv_review", payload), (e: unknown) => e instanceof PayloadError && re.test(e.message), why);
  }
  for (const { name, repo } of repos()) {
    // The demo repository seeds sample reports, so "nothing saved" is a before-and-after count.
    const before = (await repo.listReports({ type: "cv_review" })).total;
    await assert.rejects(repo.createReport({ type: "cv_review", title: "cv", score: 1, payload: bad[0][1] }), PayloadError, name);
    assert.equal((await repo.listReports({ type: "cv_review" })).total, before, `${name}: nothing saved`);
  }
});
