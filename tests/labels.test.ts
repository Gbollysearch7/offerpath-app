// OP-003: labels are presentation. Score thresholds stay in the rubric; the words shown for a band, an
// area, a check or a finding status live in labels.ts and are looked up at render time. Renaming one
// therefore moves no score, no fingerprint and no judgment-cache key, and a report saved under older
// wording renders with the same words as a new one while its stored numbers and wording stay as saved.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHECK_CONTENT, CHECK_SCOPE, EXAMPLES_NOTE } from "@/lib/analysis/check-content";
import { analyseCv, AREA_META, AREA_ORDER, band, CHECK_META, CHECK_ORDER, checkContext, findCheck } from "@/lib/analysis/cv";
import { cvAssessment, PASS_SCORE } from "@/lib/analysis/findings";
import { coreKey, relevanceKey } from "@/lib/analysis/judgment";
import { AREA_LABELS, BAND_LABELS, bandLabel, bandLegend, bandRangeText, CHECK_LABELS, FINDING_STATUS_DISPLAY, nextBandLabel, type BandLabels } from "@/lib/analysis/labels";
import { reviewLetter } from "@/lib/analysis/letter";
import { AREA_WEIGHTS, BAND_THRESHOLDS, bandKey, RUBRIC_VERSION } from "@/lib/analysis/rubric";
import { EXAMPLE_LINES } from "@/lib/content";
import { CV_THEMES } from "@/lib/cv-themes";
import { fromStored } from "@/lib/report-schema";
import { DEMO_CVS } from "@/lib/seed-data";
import { buildCvPayload } from "@/lib/services";
import type { CvReviewPayload, FindingStatus } from "@/lib/types";
import { AUDIT_CLEAN_CV, AUDIT_MISSPELLED_CV, AUDIT_SECTOR } from "./fixtures/audit";
import { LEGACY_CV_NO_BULLETS_ALL_TENS, LEGACY_CV_OLD_WORDING } from "./fixtures/legacy-payloads";

const FINANCE = "Finance and banking";
const json = (x: unknown) => JSON.stringify(x);

// The twelve CV/sector cases the batch 01 review and OP-004 compared against their baselines.
const CASES = [
  ...[AUDIT_CLEAN_CV, AUDIT_MISSPELLED_CV].flatMap((text) => [AUDIT_SECTOR, FINANCE].map((sector) => ({ text, sector }))),
  ...DEMO_CVS.flatMap((c) => [FINANCE, "Technology"].map((sector) => ({ text: c.text, sector }))),
];

/* ---------- thresholds stay in the rubric, words stay out of it ---------- */

test("band thresholds are the rubric's and did not move", () => {
  assert.deepEqual(BAND_THRESHOLDS.map((b) => b.min), [90, 75, 50, 0]);
  assert.deepEqual(BAND_THRESHOLDS.map((b) => b.key), ["top", "high", "mid", "low"]);
  assert.equal(bandKey(0), "low");
  assert.equal(bandKey(49), "low");
  assert.equal(bandKey(50), "mid");
  assert.equal(bandKey(74), "mid");
  assert.equal(bandKey(75), "high");
  assert.equal(bandKey(89), "high");
  assert.equal(bandKey(90), "top");
  assert.equal(bandKey(100), "top");
  // The rubric file carries no words for the bands at all.
  for (const b of BAND_THRESHOLDS) assert.deepEqual(Object.keys(b).sort(), ["key", "min"]);
});

test("band labels describe the assessed document, not an outcome, and fit a coloured strip", () => {
  const labels = Object.values(BAND_LABELS);
  assert.equal(new Set(labels).size, 4, "four distinct labels");
  for (const l of labels) {
    assert.doesNotMatch(l, /interview|ready|hire|hiring|offer|job|employ|pass|guarantee/i, `${l} promises nothing about an employer's decision`);
    assert.ok(l.length <= 16, `${l} is short enough for a strip`);
    assert.doesNotMatch(l, /ize\b|izing\b/, `${l} is UK English`);
  }
  assert.equal(bandLabel(49), "Needs work");
  assert.equal(bandLabel(50), "Getting there");
  assert.equal(bandLabel(89), "Strong");
  assert.equal(bandLabel(90), "Very strong");
  assert.equal(band(90), "Very strong", "cv.ts's band() is the same lookup");
  assert.equal(nextBandLabel(10), "Getting there");
  assert.equal(nextBandLabel(60), "Strong");
  assert.equal(nextBandLabel(80), "Very strong");
  assert.equal(nextBandLabel(95), null, "nothing above the top band");
  // Legends give every colour-coded band a text label and a range, lowest first.
  const legend = bandLegend();
  assert.deepEqual(legend.map((b) => [b.min, b.max]), [[0, 49], [50, 74], [75, 89], [90, 100]]);
  assert.deepEqual(legend.map((b) => b.label), ["Needs work", "Getting there", "Strong", "Very strong"]);
  assert.deepEqual(legend.map(bandRangeText), ["0 to 49", "50 to 74", "75 to 89", "90 and above"]);
});

test("renaming a band moves no score, fingerprint, rubric version or judgment-cache key", () => {
  // Captured before the OP-003 edits (tests/audit.test.ts holds the full numeric table).
  assert.equal(RUBRIC_VERSION, "rubric-2026-10-30.1");
  const frozen: [string, string, string][] = [
    [AUDIT_CLEAN_CV, AUDIT_SECTOR, "71f0fa1c7c4de776e10f31c706b92867891a88f1c5f6628748c554991fec4f1e"],
    [AUDIT_MISSPELLED_CV, AUDIT_SECTOR, "ce3aa9f9d350a916e0e57029e693ef626ff86ec31945afdac29d3b97889e1998"],
    [DEMO_CVS[0].text, FINANCE, "874c2d48bf9a568369704dcc3e70f6fb50dd1cf4925182425ca319076237a33f"],
  ];
  for (const [text, sector, fp] of frozen) assert.equal(analyseCv(text, sector).meta.fingerprint, fp);
  const bullet = "Organised 12 events for 400+ students, including a careers panel with 3 City firms.";
  assert.equal(coreKey(bullet), "a18144573c1592a7823c846fd418035096876a7387497b473a5856ca719147cc", "core judgment cache key, captured before the relabel");
  assert.equal(relevanceKey(bullet, FINANCE), "3afc007893be5d8d225fc4367282c871b0693bdca06d7dbcb2e7a9f3f2085797", "relevance cache key, captured before the relabel");

  // A different label table changes only the words: the analysis has no label input and stores no label.
  const ALT: BandLabels = { top: "Excellent", high: "Good", mid: "Fair", low: "Poor" };
  for (const { text, sector } of CASES) {
    const a = analyseCv(text, sector);
    assert.notEqual(bandLabel(a.score, ALT), bandLabel(a.score));
    assert.equal(bandKey(a.score), bandKey(a.score), "same band either way");
    // Band words are never written into the analysis (so a legacy record and a new one derive them the same way).
    // "Strong" is left out of this list because it is also an ordinary word in line feedback ("Strong opening verb").
    const stored = json(a);
    for (const l of ["Very strong", "Getting there", "Needs work", "Interview-ready"]) {
      assert.ok(!stored.includes(l), `${sector}: "${l}" is not saved in the analysis`);
    }
    assert.ok(!("band" in a), "no band field is stored");
  }
});

/* ---------- area and check names come from one table; saved wording is left alone ---------- */

test("area and check names come from the label table and name only what is measured", () => {
  for (const k of AREA_ORDER) assert.equal(AREA_META[k].name, AREA_LABELS[k]);
  for (const k of CHECK_ORDER) assert.equal(CHECK_META[k].name, CHECK_LABELS[k]);
  for (const l of Object.values(AREA_LABELS)) assert.doesNotMatch(l, /\bATS\b|grammar|proofread/i, `${l} does not claim a check the engine lacks`);
  assert.equal(AREA_LABELS.structure, "Structure and readability");
  assert.equal(AREA_LABELS.spelling, "UK spelling and consistency");
  assert.equal(checkContext("spell"), "UK spelling and consistency · UK/US spelling variants");
  assert.equal(checkContext("ats"), "Structure and readability · Text readability");
  // The rename kept every key, area assignment and weight.
  assert.equal(CHECK_META.ats.area, "structure");
  assert.equal(CHECK_META.spell.area, "spelling");
  assert.equal(CHECK_META.grammar.area, "spelling");
  assert.equal(Object.values(AREA_WEIGHTS).reduce<number>((s, w) => s + w, 0).toFixed(3), "1.000");
});

test("a legacy report keeps its saved names and scores while the views show today's labels for the same score", () => {
  const legacy = fromStored("cv_review", LEGACY_CV_OLD_WORDING) as CvReviewPayload;
  const current = buildCvPayload({ fileName: "cv.pdf", text: AUDIT_MISSPELLED_CV, sector: AUDIT_SECTOR, stage: "Final year, graduate roles" });
  assert.equal(legacy.assessment.origin, "legacy");
  assert.equal(json(legacy.analysis), json(LEGACY_CV_OLD_WORDING.analysis), "reading a v0 record rewrites nothing");
  assert.equal(findCheck(legacy.analysis, "spell")!.name, "Spelling", "the saved check name is kept as evidence of what the student was told");
  assert.equal(findCheck(legacy.analysis, "grammar")!.summary, "No issues", "the saved wording is kept too");
  // What a view shows comes from the key and the score, so both reports render identically here.
  assert.equal(legacy.analysis.score, current.analysis.score);
  assert.equal(bandLabel(legacy.analysis.score), bandLabel(current.analysis.score));
  assert.equal(bandLabel(legacy.analysis.score), "Strong");
  assert.equal(CHECK_LABELS[findCheck(legacy.analysis, "spell")!.key], "UK/US spelling variants");
  assert.equal(AREA_LABELS[legacy.analysis.areas[4].key], "UK spelling and consistency");
  for (const s of legacy.analysis.steps) assert.equal(checkContext(s.check).split(" · ")[1], CHECK_LABELS[s.check]);

  // An older no-bullet record with 10/10 on unassessed checks keeps its total and reads as not assessed.
  const old = fromStored("cv_review", LEGACY_CV_NO_BULLETS_ALL_TENS) as CvReviewPayload;
  assert.equal(old.analysis.score, LEGACY_CV_NO_BULLETS_ALL_TENS.analysis.score);
  assert.equal(bandLabel(old.analysis.score), bandLabel(LEGACY_CV_NO_BULLETS_ALL_TENS.analysis.score));
  const grammar = old.assessment.findings.find((f) => f.id === "grammar")!;
  assert.equal(grammar.status, "not_applicable");
  assert.equal(FINDING_STATUS_DISPLAY[grammar.status], "Not assessed");
});

/* ---------- the status pill says what the pass line means ---------- */

test("every finding status has a display label, and 8 of 10 with one variant found is shown as a met target, not a clean pass", () => {
  const statuses: FindingStatus[] = ["passed", "needs_attention", "not_applicable", "unavailable", "uncertain"];
  for (const s of statuses) assert.ok(FINDING_STATUS_DISPLAY[s].length > 0, `${s} has a label`);
  assert.doesNotMatch(FINDING_STATUS_DISPLAY.passed, /pass|no issues|correct|clean/i, "the top status does not claim nothing was found");
  assert.equal(FINDING_STATUS_DISPLAY.passed, "Target met");

  // Demo CV v3 has exactly one US variant: spell scores 8, which is the pass line (OP-004's contract, unchanged here).
  const text = DEMO_CVS[0].text;
  const a = analyseCv(text, FINANCE);
  const spell = findCheck(a, "spell")!;
  assert.equal(spell.score, PASS_SCORE);
  assert.equal(spell.extras?.length, 1, "one variant found");
  const finding = cvAssessment(a, text).findings.find((f) => f.id === "spell")!;
  assert.equal(finding.status, "passed", "the status derivation is OP-004's and is not changed by a label");
  assert.equal(FINDING_STATUS_DISPLAY[finding.status], "Target met");
  assert.match(spell.detail, /→/, "the detail still names the variant to swap");
  assert.match(spell.detail, /other spelling mistakes aren't detected/i);
});

/* ---------- guidance examples keep the level of responsibility and mark figures as illustrative ---------- */

test("before/after examples never turn a supporting role into a leading one, and say their figures are made up", () => {
  const SUPPORT = /^(helped|assisted|supported|worked on|contributed|was involved|participated)/i;
  const LEAD = /^(led|managed|headed|directed|ran|owned|chaired|organised|oversaw|supervised|founded)\b/i;
  let supporting = 0;
  for (const [key, c] of Object.entries(CHECK_CONTENT)) {
    for (const e of c.examples) {
      if (!SUPPORT.test(e.b)) continue;
      supporting++;
      assert.doesNotMatch(e.a, LEAD, `${key}: "${e.b}" must not become "${e.a}"`);
    }
  }
  assert.ok(supporting >= 3, "the guard actually covers supporting-role examples");
  assert.match(EXAMPLES_NOTE, /made up/);
  assert.match(EXAMPLES_NOTE, /level of responsibility/);
  assert.match(CHECK_CONTENT.verbs.insight, /supported it, say so/, "the verbs guidance no longer tells students to swap Helped for Led");
  assert.doesNotMatch(CHECK_CONTENT.verbs.insight, /"Led" make it clear/);
});

/* ---------- no copy guarantees ATS compatibility, proofreading or an outcome ---------- */

// Positive "your spelling is correct" claims are guarded by CLAIMS_CORRECT in tests/audit.test.ts; CHECK_SCOPE.spell
// says the opposite ("doesn't mean your CV is spelled correctly"), so that phrase is not matched here.
const CLAIMS = /ATS-safe|ATS-friendly|ATS-compatible|interview-ready|guarantee(?!s? how)|screening software can read|only (uses? )?facts from|never (invent|add|make)|no spelling mistakes|will pass|100%|ready to send/i;

test("student-facing copy constants and engine output carry no ATS, proofreading or outcome guarantees", () => {
  const texts: string[] = [];
  for (const c of Object.values(CHECK_CONTENT)) texts.push(c.tagline, c.icon, c.insight, c.more, ...(c.measure ?? []), ...c.examples.flatMap((e) => [e.b, e.a]));
  texts.push(...Object.values(CHECK_SCOPE), EXAMPLES_NOTE);
  for (const k of AREA_ORDER) texts.push(AREA_META[k].what(FINANCE));
  texts.push(...Object.values(AREA_LABELS), ...Object.values(CHECK_LABELS), ...Object.values(BAND_LABELS), ...Object.values(FINDING_STATUS_DISPLAY));
  texts.push(...CV_THEMES.map((t) => t.best));
  texts.push(...EXAMPLE_LINES.flatMap(([, lines]) => lines.map(([l]) => l)));
  for (const t of texts) assert.doesNotMatch(t, CLAIMS, t);
  // Engine output for the twelve cases: names, summaries, details, steps and strengths.
  for (const { text, sector } of CASES) assert.doesNotMatch(json(analyseCv(text, sector)), CLAIMS, sector);
});

test("a letter that passes every check is told the checks passed, not that it is ready", () => {
  const letter = [
    "Alex Example · alex@example.com · 07700 900123",
    "",
    "Dear Ms Taylor,",
    "",
    `I am drawn to Northbank because of its graduate programme in risk. ${"I built a tracker in Excel that cut reporting time by 20% for a team of six. ".repeat(10)}`,
    "",
    `${"I also led a society budget of £6,000 and presented monthly to the committee. ".repeat(8)}`,
    "",
    "Yours sincerely,",
    "Alex Example",
  ].join("\n");
  const r = reviewLetter(letter, "", "Northbank");
  assert.ok(r.checks.every((c) => c.ok), r.checks.filter((c) => !c.ok).map((c) => c.d).join("; "));
  assert.doesNotMatch(r.summary, CLAIMS);
  assert.match(r.summary, /checks pass/);
  assert.match(r.summary, /check every fact/);
});

/* ---------- derived sentences and headers ---------- */

test("the area-weights sentence and the CSV band column are derived from the rubric and the label table", () => {
  const weights = AREA_ORDER.filter((k) => AREA_META[k].weight > 0)
    .sort((a, b) => AREA_META[b].weight - AREA_META[a].weight)
    .map((k) => `${AREA_META[k].name} ${+(AREA_META[k].weight * 100).toFixed(1)}%`)
    .join(", ");
  assert.equal(weights, "Impact 30%, Length and formatting 23.5%, Clarity 17.5%, Structure and readability 17.5%, UK spelling and consistency 11.5%");
  const high = BAND_THRESHOLDS.find((b) => b.key === "high")!;
  assert.equal(`${BAND_LABELS.high} or better (${high.min}+)`, "Strong or better (75+)", "the TEF pack header is unchanged for downstream readers");
});
