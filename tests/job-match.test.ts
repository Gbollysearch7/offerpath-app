// OP-013: evidence for each requirement, and evidence coverage in place of the starting score.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { CREDIT, JOB_SCORING_VERSION, LEGACY_MATCH_NOTE, matchRequirements, MIN_ASSESSED, remeasure, WEIGHTS } from "@/lib/analysis/job-match";
import { matchScores, jobKeywords } from "@/lib/analysis/job";
import { extractRequirements } from "@/lib/analysis/job-requirements";
import { fromStored, PayloadError, toStored } from "@/lib/report-schema";
import { DEMO_CVS, SAMPLE_OPPORTUNITIES } from "@/lib/seed-data";
import { buildTailorPayload } from "@/lib/services";
import type { TailorPayload } from "@/lib/types";
import { AUDIT_ADVERT, AUDIT_CV_EVIDENCE } from "./fixtures/audit";
import { LEGACY_TAILOR } from "./fixtures/legacy-payloads";

const match = (jobText: string, cvText: string) => matchRequirements({ jobText, cvText, extraction: extractRequirements(jobText) });
const level = (jobText: string, cvText: string, label: string) => match(jobText, cvText).requirements.find((r) => r.label === label)!.evidence.level;
const payload = (jobText: string, cvText: string) => buildTailorPayload({ cvReportId: "c", cvFileName: "cv.pdf", cvText, jobTitle: "Role", employer: "Org", jobUrl: null, jobText, deadline: null });

const FULL = "Must have Quillon and Ondine. Requirements:\n- Merrowdb\n- Pellucid\nDesirable: Tallowdesk and Fennimore.";

test("an Excel-only CV can't conceal the audit's two essential gaps", () => {
  const m = match(AUDIT_ADVERT, AUDIT_CV_EVIDENCE);
  assert.deepEqual(m.essentialGaps, ["Kubernetes", "Terraform"]);
  assert.equal(m.requirements.find((r) => r.label === "Excel")!.evidence.level, "weak");
  assert.equal(m.coverage.score, Math.round((100 * (WEIGHTS.desirable * CREDIT.weak)) / (2 * WEIGHTS.essential + WEIGHTS.desirable)));
});

test("a CV full of the desirable requirement still shows the gap, whatever the number", () => {
  const advert = "Must have Quillon. Desirable: Ondine, Tallowdesk, Fennimore, Merrowdb, Pellucid, Ashgrove, Brontide.";
  const cv = "EXPERIENCE\n• Built reports with Ondine, Tallowdesk, Fennimore, Merrowdb, Pellucid, Ashgrove and Brontide for 200 clients.";
  const m = match(advert, cv);
  assert.ok(m.coverage.score! > 50);
  assert.deepEqual(m.essentialGaps, ["Quillon"]);
});

test("the starting score is gone", () => {
  assert.equal(match(AUDIT_ADVERT, "No relevant experience is described in this document.").coverage.score, 0);
  assert.equal(match(FULL, "Nothing relevant here at all.").coverage.score, 0);
  // Exact arithmetic for a mixed result: nothing is added before the evidence.
  const cv = "EXPERIENCE\n• Built a reporting tool with Quillon for 12 teams.\nSKILLS\nOndine";
  // essential weights 3 x 4, desirable 1 x 2; Quillon explicit 3, Ondine weak 0.75.
  assert.equal(match(FULL, cv).coverage.score, Math.round((100 * 3.75) / 14));
  assert.equal(match(FULL, cv).coverage.earned, 3.75);
  assert.equal(match(FULL, cv).coverage.possible, 14);
  assert.equal(JOB_SCORING_VERSION, "job-match-2026-11-06.1");
});

test("the old scale is still what it was, for reports saved on it", () => {
  assert.equal(matchScores(jobKeywords(AUDIT_ADVERT, "Nothing here.")).now, 30);
});

test("evidence levels distinguish doing from naming", () => {
  const advert = "Must have Quillon. Must have Ondine.";
  const did = "EXPERIENCE\n• Migrated three services to Quillon, cutting release time by 40%.";
  const listed = "SKILLS\nQuillon, Excel, SQL";
  const denied = "EXPERIENCE\n• I have no experience of Quillon yet, but I am learning quickly at work.";
  assert.equal(level(advert, did, "Quillon"), "explicit");
  assert.equal(level(advert, listed, "Quillon"), "weak");
  assert.equal(level(advert, denied, "Quillon"), "none");
  assert.equal(level(advert, "SKILLS\nExcel", "Quillon"), "none");
  const m = match(advert, did).requirements.find((r) => r.label === "Quillon")!.evidence;
  assert.equal(m.refs.length, 1);
  assert.equal(did.slice(m.refs[0].range!.start, m.refs[0].range!.end), m.refs[0].quote, "the quote is at the offset it claims");
});

test("related evidence is contextual: not a gap, not a match", () => {
  const m = match("Must have Terraform. Must have Quillon.", "EXPERIENCE\n• Provisioned 40 environments with Pulumi across three cloud accounts.");
  const t = m.requirements.find((r) => r.label === "Terraform")!;
  assert.equal(t.evidence.level, "contextual");
  assert.match(t.evidence.note, /doesn't name Terraform/);
  assert.deepEqual(m.essentialThin, ["Terraform"]);
  assert.deepEqual(m.essentialGaps, ["Quillon"]);
  assert.equal(level("Must have leadership. Must have Quillon.", "EXPERIENCE\n• Led a team of six volunteers across two campus events.", "Leadership"), "contextual");
});

test("alternatives count once, whichever or however many are met", () => {
  const advert = "Must have Terraform or Pulumi. Must have Quillon.";
  const one = match(advert, "EXPERIENCE\n• Provisioned servers using Pulumi for twelve client teams.");
  const both = match(advert, "EXPERIENCE\n• Provisioned servers using Pulumi for twelve client teams.\n• Provisioned servers using Terraform for twelve client teams.");
  assert.equal(one.coverage.score, both.coverage.score);
  assert.equal(one.coverage.possible, 2 * WEIGHTS.essential, "denominator counts the choice once");
  assert.equal(one.requirements.find((r) => r.terms.includes("Pulumi"))!.evidence.matchedTerm, "Pulumi");
  assert.deepEqual(one.essentialGaps, ["Quillon"]);
});

test("repetition and synonyms don't inflate coverage", () => {
  const advert = "Must have PostgreSQL. Must have Quillon.";
  const once = match(advert, "EXPERIENCE\n• Tuned PostgreSQL queries for a reporting product used by 400 staff.");
  const many = match(advert, `EXPERIENCE\n${"• Tuned PostgreSQL queries for a reporting product used by 400 staff.\n".repeat(20)}• Postgres, postgres, PostgreSQL in another project with many services.\nSKILLS\nPostgres, PostgreSQL`);
  assert.equal(many.coverage.score, once.coverage.score);
  assert.equal(many.coverage.earned, once.coverage.earned);
  // Advert side: saying it twenty times, or two ways, doesn't change the denominator.
  const longAd = `Must have PostgreSQL. Must have Postgres. ${"PostgreSQL is required. ".repeat(20)}Must have Quillon.`;
  assert.equal(match(longAd, "Nothing.").coverage.possible, 2 * WEIGHTS.essential);
  // Keyword stuffing in a skills list stays a weak mention.
  assert.equal(level(advert, `SKILLS\n${"Quillon, ".repeat(20)}Quillon`, "Quillon"), "weak");
});

test("vague adverts get an explanation, not a percentage", () => {
  for (const advert of [
    "Join a friendly team doing interesting work with great people across the business in a fast-paced environment.",
    "We are looking for an enthusiastic graduate with a positive attitude who is motivated and keen to learn new things every day.",
    "You will use Quillon and Ondine on interesting projects with friendly people in our growing team, every day of the week.",
    "Must have Quillon. The rest of this advert says nothing else that a reader could check against a CV at all.",
  ]) {
    const p = payload(advert, "EXPERIENCE\n• Built things with Quillon and Ondine for many clients at work.");
    assert.equal(p.matchNow, null, advert);
    assert.equal(p.jobMatch!.coverage.status, "insufficient");
    assert.match(p.jobMatch!.coverage.explanation, /doesn't state enough/);
    assert.ok(MIN_ASSESSED > p.jobMatch!.coverage.assessed.essential + p.jobMatch!.coverage.assessed.desirable);
    toStored("tailor", p);
  }
  // A single essential gap is still shown, with no number around it.
  assert.deepEqual(match("Must have Quillon. Nothing else here.", "Nothing.").essentialGaps, ["Quillon"]);
});

test("uncertain items stay out of the denominator and are reported", () => {
  const advert = "Requirements:\n- Quillon\n- Ondine\nSkills:\n- Merrowdb\n- Tallowdesk\nWhat you will do\nYou will use Pellucid.";
  const m = match(advert, "EXPERIENCE\n• Built tools with Merrowdb and Tallowdesk and Pellucid for several clients.");
  assert.equal(m.coverage.score, 0, "evidence for things the advert doesn't require doesn't lift the number");
  assert.deepEqual(m.coverage.assessed, { essential: 2, desirable: 0 });
  assert.deepEqual(m.coverage.notCounted, { contextual: 1, uncertain: 2, toConfirm: 0 });
  assert.equal(m.coverage.status, "limited");
});

test("conditions a CV can't settle are for the student to check and don't move the number", () => {
  const advert = "Requirements:\n- Quillon\n- Ondine\n- Right to work in the UK\n- 2+ years of experience";
  const m = match(advert, "Nothing.");
  assert.deepEqual(m.toConfirm.length, 2);
  assert.ok(!m.essentialGaps.some((g) => /Right to work|years/.test(g)), "absence from a CV isn't a gap in eligibility");
  assert.equal(m.coverage.possible, 2 * WEIGHTS.essential);
});

test("degrees are checked from what the CV says", () => {
  const advert = "Requirements:\n- A 2:1 degree in Computer Science\n- Quillon";
  const label = "2:1 degree in Computer Science";
  assert.equal(level(advert, "EDUCATION\nBSc Computer Science, Example University, 2:1", label), "explicit");
  assert.equal(level(advert, "EDUCATION\nBA History, Example University, 2:1", label), "contextual");
  assert.equal(level(advert, "Nothing.", label), "none");
  assert.equal(level("Requirements:\n- A 2:1 degree in any subject\n- Quillon", "EDUCATION\nBA History, First", "2:1 degree in any subject"), "explicit", "a first satisfies a 2:1");
});

test("a tailored CV is measured against the same requirements", () => {
  const before = match(FULL, "Nothing.");
  const after = remeasure(before, FULL, "EXPERIENCE\n• Rebuilt the reporting tool in Quillon for 12 teams.");
  assert.equal(before.coverage.score, 0);
  assert.equal(after.coverage.score, Math.round((100 * 3) / 14));
  assert.deepEqual(after.requirements.map((r) => r.label), before.requirements.map((r) => r.label));
  assert.notEqual(after.cvVersion, before.cvVersion);
});

/* ---------- The payload ---------- */

test("a new report records the version, the coverage and findings, and nothing estimated", () => {
  const p = payload(AUDIT_ADVERT, AUDIT_CV_EVIDENCE);
  assert.equal(p.jobMatch!.version, JOB_SCORING_VERSION);
  assert.equal(p.matchNow, p.jobMatch!.coverage.score);
  assert.equal(p.matchTailored, null, "nothing has been revised yet");
  assert.equal(p.assessment!.versions.rubric, JOB_SCORING_VERSION);
  const gap = p.assessment!.findings.find((f) => f.check === "Kubernetes")!;
  assert.equal(gap.status, "needs_attention");
  assert.equal(gap.severity, "high");
  assert.equal(gap.evidence[0].quote, "Must have Kubernetes and Terraform.");
  assert.deepEqual(toStored("tailor", p), p);
  assert.deepEqual(fromStored("tailor", JSON.parse(JSON.stringify(p))), p);
  assert.equal(p.keywords.find((k) => k.w === "Excel")!.n, 2);
  assert.equal(p.keywords.find((k) => k.w === "Kubernetes")!.must, true);
  const marked = p.jd.flatMap((b) => b.segs ?? []).filter((s) => s.kind !== "plain").map((s) => s.t);
  assert.ok(marked.includes("Kubernetes") && marked.includes("Terraform") && marked.includes("Excel"));
});

test("a negated term is not marked in the advert", () => {
  const p = payload("No Zorblax experience required. Must have Quillon. Must have Ondine for the work we do here.", "Nothing.");
  assert.ok(!p.jd.flatMap((b) => b.segs ?? []).some((s) => s.kind !== "plain" && s.t === "Zorblax"));
});

test("the write gate holds a job match to the report around it", () => {
  const p = payload(AUDIT_ADVERT, AUDIT_CV_EVIDENCE);
  const reject = (bad: TailorPayload, why: RegExp) => assert.throws(() => toStored("tailor", bad), (e: Error) => e instanceof PayloadError && why.test(e.message));
  reject({ ...p, jobText: `${p.jobText} Extra.` }, /different advert/);
  reject({ ...p, matchNow: 90 }, /does not equal/);
  const q = structuredClone(p);
  q.jobMatch!.requirements[0].source.quote = "Must have everything.";
  reject(q, /quote does not match/);
  const r = structuredClone(p);
  r.jobMatch!.requirements.find((x) => x.label === "Excel")!.evidence.refs[0].documentVersion = "other";
  reject(r, /not a quotation from this CV version/);
  const s = structuredClone(p);
  s.jobMatch!.requirements[0].evidence.refs = [{ documentVersion: s.jobMatch!.cvVersion, block: "doc", range: null, quote: "made up" }];
  reject(s, /marked as having none/);
  reject({ ...p, jobMatch: undefined }, /assessment saved without/);
});

test("demo advert reads sensibly end to end", () => {
  const northbank = SAMPLE_OPPORTUNITIES[0];
  const p = payload(northbank.description, DEMO_CVS[3].text);
  assert.ok(p.jobMatch!.requirements.some((r) => r.kind === "qualification" && r.category === "essential"));
  assert.equal(p.jobMatch!.requirements.find((r) => r.terms.includes("Power BI"))!.category, "desirable");
  assert.equal(p.jobMatch!.requirements.find((r) => r.terms.includes("Power BI"))!.orEquivalent, true);
  toStored("tailor", p);
});

/* ---------- Old reports ---------- */

test("old reports keep their saved scores, with no job match invented", () => {
  const saved = structuredClone(LEGACY_TAILOR);
  const read = fromStored("tailor", saved) as TailorPayload;
  assert.equal(read.matchNow, LEGACY_TAILOR.matchNow);
  assert.equal(read.matchTailored, LEGACY_TAILOR.matchTailored);
  assert.deepEqual(read.keywords, LEGACY_TAILOR.keywords);
  assert.equal(read.jobMatch, undefined);
  assert.equal(read.assessment, undefined);
  assert.deepEqual([LEGACY_TAILOR.matchNow, LEGACY_TAILOR.matchTailored], [35, 66], "the numbers such reports were saved with");
  // A v1 report written just before this version: valid as it stands, and still has no job match.
  const v1 = fromStored("tailor", { payloadVersion: 1, ...saved }) as TailorPayload;
  assert.equal(v1.matchNow, 35);
  assert.deepEqual(toStored("tailor", v1), v1);
});

function render(stored: unknown): string {
  const env = { ...process.env, ANTHROPIC_API_KEY: "", NODE_OPTIONS: "" };
  const out = spawnSync("npx", ["tsx", "--tsconfig", "tsconfig.json", "tests/fixtures/render-tailor.tsx"], { input: JSON.stringify(stored), env, encoding: "utf8", timeout: 90_000 });
  assert.equal(out.status, 0, out.stderr);
  return out.stdout.replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
}

test("an old report renders its saved numbers with the limited-evidence note", () => {
  const html = render(LEGACY_TAILOR);
  assert.ok(html.includes(LEGACY_MATCH_NOTE), "note shown");
  assert.match(html, /aria-label="Match now 35"/);
  assert.match(html, /aria-label="Estimated match after tailoring 66"/);
  assert.ok(!html.includes("EVIDENCE COVERAGE"));
});

test("a new report renders the gaps, the label and the denominator", () => {
  const html = render(payload(AUDIT_ADVERT, AUDIT_CV_EVIDENCE));
  assert.ok(html.includes("EVIDENCE COVERAGE"));
  assert.match(html, /not a prediction of being hired/);
  assert.match(html, /2 essential requirements with no evidence/);
  assert.match(html, /<li[^>]*>Kubernetes<\/li>/);
  assert.match(html, /<li[^>]*>Terraform<\/li>/);
  assert.match(html, /3 requirements counted: 2 essential \(weight 3\) and 1 desirable \(weight 1\)/);
  assert.match(html, /Must have Kubernetes and Terraform\./, "the advert is quoted");
  assert.ok(!html.includes(LEGACY_MATCH_NOTE));
  assert.ok(!/Match now|TAILORED/.test(html), "no estimate rings");
});

test("a vague advert renders the explanation and no number", () => {
  const html = render(payload("Join a friendly team doing interesting work with great people across the business in a fast-paced environment.", "Nothing."));
  assert.match(html, /NOT SCORED/);
  assert.match(html, /doesn't state enough/);
  assert.ok(!/Evidence coverage \d/.test(html));
});
