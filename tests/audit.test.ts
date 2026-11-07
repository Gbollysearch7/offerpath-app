// OP-001 and OP-002: the reproduced audit failures, and the scoped wording that replaced the
// descriptions which overstated what the engine checks.
//
// Two things are deliberately NOT asserted here:
//   - that the four audit misspellings are caught (the proofreader does, reported apart from these
//     checks; see tests/proofreading.test.ts),
//   - that the Kubernetes/Terraform advert is read correctly (tests/job-requirements.test.ts covers that).
// The second lives in `scripts/diagnose-audit.ts` as unmet gates, so no test in this repository can be
// read as a statement that the current behaviour is correct.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHECK_CONTENT, CHECK_SCOPE } from "@/lib/analysis/check-content";
import { analyseCv, AREA_ORDER, CHECK_META, CHECK_ORDER, findCheck } from "@/lib/analysis/cv";
import { matchRequirements } from "@/lib/analysis/job-match";
import { extractRequirements } from "@/lib/analysis/job-requirements";
import { LIKELY_MISSPELLING, localProvider, UNRECOGNISED_WORD } from "@/lib/analysis/proofreading/local";
import { runProofreading } from "@/lib/analysis/proofreading/run";
import { AREA_WEIGHTS, RUBRIC_VERSION } from "@/lib/analysis/rubric";
import { DEMO_CVS } from "@/lib/seed-data";
import type { CheckKey, CheckResult, ProofreadingCategory, ProofreadingFinding } from "@/lib/types";
import { evaluateGates, exitCode, report, reportedSpellingWords, runAuditDiagnostic, type MatchingObservations, type SpellingObservations } from "../scripts/diagnose-audit";
import { AUDIT_ADVERT, AUDIT_CLEAN_CV, AUDIT_CORRECT_WORDS, AUDIT_CV_EVIDENCE, AUDIT_MISSPELLED_CV, AUDIT_MISSPELLED_WORDS, AUDIT_SECTOR, misspell } from "./fixtures/audit";

/** A message that would tell a student their spelling or grammar is fine. None of ours may match it. */
const CLAIMS_CORRECT = /spelling throughout|no spelling (mistakes|errors)|correctly spelled|spelled correctly|no issues\b|no grammar issues|clean grammar/i;

const textOf = (c: CheckResult) => `${c.name} ${c.summary} ${c.detail} ${c.stat.label} ${(c.extras ?? []).join(" ")}`;

/* ---------- fixtures ---------- */

test("the audit fixtures differ from the clean CV only by the four misspellings", () => {
  assert.equal(misspell(AUDIT_CLEAN_CV), AUDIT_MISSPELLED_CV, "the variant is derived from the clean CV, not hand-copied");
  assert.notEqual(AUDIT_CLEAN_CV, AUDIT_MISSPELLED_CV);
  for (const w of AUDIT_MISSPELLED_WORDS) {
    assert.ok(AUDIT_MISSPELLED_CV.includes(w), `${w} is in the misspelled CV`);
    assert.ok(!AUDIT_CLEAN_CV.includes(w), `${w} is not in the clean CV`);
  }
  for (const w of AUDIT_CORRECT_WORDS) assert.ok(AUDIT_CLEAN_CV.includes(w), `${w} is in the clean CV`);
  const words = (s: string) => s.split(/\s+/).length;
  assert.equal(words(AUDIT_CLEAN_CV), words(AUDIT_MISSPELLED_CV), "same number of words, so length checks can't be the thing that moved");
});

/* ---------- numbers must not move ---------- */

// Recorded from the engine on 5 November 2026, before the OP-002 wording change. OP-002 edits names,
// summaries, details and static guidance only. If a number below moves, something changed that was
// meant to stay fixed, and a saved report would no longer agree with a fresh one.
const FROZEN: { name: string; text: string; sector: string; score: number; areas: number[]; checks: number[]; words: number; pages: number; bullets: number; fingerprint: string }[] = [
  {
    name: "audit clean CV",
    text: AUDIT_CLEAN_CV,
    sector: AUDIT_SECTOR,
    score: 83,
    areas: [100, 100, 77, 20, 100, 43],
    checks: [10, 10, 10, 10, 10, 10, 10, 10, 3, 10, 2, 10, 10, 1, 9, 3],
    words: 43,
    pages: 1,
    bullets: 2,
    fingerprint: "71f0fa1c7c4de776e10f31c706b92867891a88f1c5f6628748c554991fec4f1e",
  },
  {
    name: "audit misspelled CV",
    text: AUDIT_MISSPELLED_CV,
    sector: AUDIT_SECTOR,
    score: 83,
    areas: [100, 100, 77, 20, 100, 43],
    checks: [10, 10, 10, 10, 10, 10, 10, 10, 3, 10, 2, 10, 10, 1, 9, 3],
    words: 43,
    pages: 1,
    bullets: 2,
    fingerprint: "ce3aa9f9d350a916e0e57029e693ef626ff86ec31945afdac29d3b97889e1998",
  },
  {
    name: "demo CV v3",
    text: DEMO_CVS[0].text,
    sector: "Finance and banking",
    score: 61,
    areas: [38, 70, 73, 20, 90, 60],
    checks: [1, 0, 8, 6, 10, 3, 8, 5, 10, 7, 2, 8, 10, 8, 0, 10],
    words: 230,
    pages: 1,
    bullets: 17,
    fingerprint: "874c2d48bf9a568369704dcc3e70f6fb50dd1cf4925182425ca319076237a33f",
  },
  {
    name: "demo CV v6",
    text: DEMO_CVS[3].text,
    sector: "Finance and banking",
    score: 87,
    areas: [83, 93, 100, 20, 100, 73],
    checks: [8, 5, 10, 10, 10, 10, 8, 10, 10, 10, 2, 10, 10, 8, 4, 10],
    words: 253,
    pages: 1,
    bullets: 17,
    fingerprint: "3a056f201412c5deed0e26d9cbb7c41e682994d55528006040e6be6a2fec970d",
  },
];

test("OP-002 wording changes move no score, page count or fingerprint", () => {
  for (const f of FROZEN) {
    const a = analyseCv(f.text, f.sector);
    assert.equal(a.score, f.score, `${f.name} total score`);
    assert.deepEqual(a.areas.map((ar) => ar.score), f.areas, `${f.name} area scores in ${AREA_ORDER.join("/")} order`);
    assert.deepEqual(CHECK_ORDER.map((k) => findCheck(a, k)!.score), f.checks, `${f.name} check scores in ${CHECK_ORDER.join("/")} order`);
    assert.equal(a.meta.words, f.words, `${f.name} words`);
    assert.equal(a.meta.pages, f.pages, `${f.name} estimated pages`);
    assert.equal(a.meta.bullets, f.bullets, `${f.name} bullets`);
    assert.equal(a.meta.rubric, RUBRIC_VERSION, `${f.name} rubric version`);
    assert.equal(a.meta.fingerprint, f.fingerprint, `${f.name} cache fingerprint`);
  }
});

test("check keys, areas and weights are untouched by the rename", () => {
  assert.deepEqual(CHECK_ORDER, ["quant", "verbs", "accomp", "repeat", "filler", "buzz", "passive", "sections", "ats", "contact", "sector", "spell", "grammar", "length", "bulletlen", "bullets"]);
  assert.deepEqual(AREA_ORDER, ["impact", "clarity", "structure", "sector", "spelling", "length"]);
  assert.equal(RUBRIC_VERSION, "rubric-2026-10-30.1", "OP-002 must not bump the rubric: no judgment changed");
  assert.equal(AREA_WEIGHTS.spelling, 0.115);
  assert.equal(CHECK_META.spell.area, "spelling");
  assert.equal(CHECK_META.grammar.area, "spelling");
  assert.equal(CHECK_META.ats.area, "structure");
  // Every check still has static guidance and a page to show it on.
  for (const k of CHECK_ORDER) assert.ok(CHECK_CONTENT[k]?.tagline, `${k} has guidance`);
});

/* ---------- scoped coverage messages ---------- */

test("a CV full of misspellings is never told its spelling or grammar is correct", () => {
  const a = analyseCv(AUDIT_MISSPELLED_CV, AUDIT_SECTOR);
  const spell = findCheck(a, "spell")!;
  const grammar = findCheck(a, "grammar")!;
  // The scores are still 10/10. That defect is OP-007; the wording must not present it as proof.
  assert.equal(spell.score, 10);
  assert.equal(grammar.score, 10);
  assert.doesNotMatch(textOf(spell), CLAIMS_CORRECT, "the spelling check must not claim correct spelling");
  assert.doesNotMatch(textOf(grammar), CLAIMS_CORRECT, "the consistency check must not claim correct grammar");
  assert.match(spell.name, /variant/i, "the check is named for what it compares");
  assert.match(spell.detail, /short list of common US spellings/i, "it says what it compared against");
  assert.match(spell.detail, /other spelling mistakes aren't detected/i, "it says what it missed");
  for (const t of ["repeated words", "lowercase", "mixed bullet endings"]) assert.ok(grammar.detail.includes(t), `the consistency check names "${t}"`);
  assert.match(grammar.detail, /Grammar, tense and sentence structure aren't assessed/i);
});

test("strengths credited for spelling and consistency state the narrow finding", () => {
  // A CV where spelling and consistency are the only checks scoring 9 or more, so both reach "what
  // you did well". Neither may be phrased as clean spelling or clean grammar.
  const cv = ["Alex Example", "alex@example.com", "EXPERIENCE", "Assistant | Example Ltd | 2024 - Present", "• Responsible for very basic weekly tasks.", "• Responsible for a really hard-working team.", "• Responsible for reports which were produced weekly.", "EDUCATION", "BSc Computing"].join("\n");
  const a = analyseCv(cv, AUDIT_SECTOR);
  const wells = Object.fromEntries(a.wells.map((w) => [w.check, w.text]));
  assert.deepEqual(Object.keys(wells).sort(), ["grammar", "spell"], JSON.stringify(a.wells));
  assert.equal(wells.spell, "No US spelling variants found");
  assert.equal(wells.grammar, "Consistent bullet style");
  for (const w of a.wells) assert.doesNotMatch(w.text, CLAIMS_CORRECT, w.text);
});

test("a US spelling is reported as a regional preference, with the exceptions named", () => {
  const a = analyseCv(AUDIT_CLEAN_CV.replace("Managed", "Organized and managed"), AUDIT_SECTOR);
  const spell = findCheck(a, "spell")!;
  assert.equal(spell.score, 8, "two points per variant, unchanged");
  assert.match(spell.summary, /1 US spelling variant: "organized"/);
  assert.deepEqual(spell.extras, ["organized → organised"]);
  assert.match(spell.detail, /regional preference rather than a mistake/i);
  assert.match(spell.detail, /official name or a quotation/i);
  assert.ok(spell.affected.length > 0, "the line carrying the variant is identified");
});

test("the consistency check still explains the issues it does find", () => {
  const a = analyseCv(["Alex Example", "alex@example.com", "EXPERIENCE", "Analyst | Example Ltd | 2025 - Present", "• Managed the the weekly reporting pack for twelve colleagues.", "• built a tracker in Excel that cut reporting time by 20%", "• Presented findings to twelve colleagues each month.", "EDUCATION", "BSc Computing"].join("\n"), AUDIT_SECTOR);
  const grammar = findCheck(a, "grammar")!;
  assert.ok(grammar.score < 10, "issues lower the score");
  assert.match(grammar.summary, /consistency issue/);
  assert.match(grammar.detail, /Repeated word: "the the"/);
  assert.match(grammar.detail, /lowercase letter/);
  assert.doesNotMatch(textOf(grammar), CLAIMS_CORRECT);
  assert.ok(grammar.affected.length > 0, "the lowercase bullet is identified");
});

test("page counts are labelled estimates in the summary, the stat and the detail", () => {
  const a = analyseCv(DEMO_CVS[3].text, "Finance and banking");
  const len = findCheck(a, "length")!;
  assert.equal(len.stat.value, String(a.meta.pages), "the number itself is unchanged");
  assert.match(len.summary, /^About 1 page \(estimated\)$/);
  assert.match(len.stat.label, /estimated page/);
  assert.match(len.detail, /estimate from your word count, not a measured page count/i);
  assert.match(CHECK_SCOPE.length!, /isn't measured from your file/i);
});

test("the readability check reports what it read and never guarantees an employer's system", () => {
  const good = findCheck(analyseCv(DEMO_CVS[3].text, "Finance and banking"), "ats")!;
  assert.equal(good.score, 10, "the heuristic is unchanged");
  assert.equal(good.name, "Text readability");
  assert.match(good.detail, /We read 253 words and recognised \d+ section headings/);
  assert.match(good.detail, /can't test how any individual employer's system will read your file/i);
  const thin = findCheck(analyseCv(AUDIT_CLEAN_CV, AUDIT_SECTOR), "ats")!;
  assert.equal(thin.score, 3);
  assert.match(thin.detail, /can't test how any individual employer's system will read your file/i);
  for (const c of [good, thin, { detail: CHECK_CONTENT.ats.insight } as CheckResult, { detail: CHECK_CONTENT.ats.more } as CheckResult]) {
    assert.doesNotMatch(c.detail, /(screening software|applicant tracking system)s? can read/i, c.detail);
    assert.doesNotMatch(c.detail, /ATS-safe/i, c.detail);
  }
});

test("a high readability heuristic does not claim it found headings when there are none", () => {
  const a = analyseCv(Array(160).fill("portfolio").join(" "), AUDIT_SECTOR);
  assert.deepEqual(a.meta.sections, []);
  const check = findCheck(a, "ats")!;
  assert.equal(check.score, 8, "the existing numerical heuristic remains unchanged");
  assert.doesNotMatch(check.summary, /headings.*(read|recognised|found)/i);
  assert.match(check.detail, /recognised 0 section headings/);
});

test("with no bullet points, line checks say nothing was assessed rather than passing", () => {
  const a = analyseCv("Alex Example\nalex@example.com\nEXPERIENCE\nAnalyst at Example Ltd\nEDUCATION\nBSc Computing\nSKILLS\nExcel", AUDIT_SECTOR);
  for (const k of ["accomp", "repeat", "filler", "buzz", "passive", "grammar", "bulletlen"] as CheckKey[]) {
    const c = findCheck(a, k)!;
    assert.equal(c.score, 0, `${k} is not credited`);
    assert.equal(c.summary, "No bullet points found");
    assert.match(c.detail, /scored 0 rather than passing: nothing was assessed/, k);
    assert.doesNotMatch(textOf(c), CLAIMS_CORRECT, k);
  }
});

/* ---------- legacy saved reports ---------- */

test("coverage notes come from the check key, so a report saved under the old wording still gets them", () => {
  // Exactly what a report saved before November 2026 holds: the old name and the old claim. We don't
  // rewrite a student's saved history, so the note next to it has to carry the current limits.
  const legacy: CheckResult = { key: "spell", area: "spelling", name: "Spelling", score: 10, summary: "UK spelling throughout", detail: "No US spellings found.", stat: { value: "0", label: "US spellings" }, affected: [], extras: [] };
  assert.match(textOf(legacy), CLAIMS_CORRECT, "the legacy payload really does claim correct spelling");
  const note = CHECK_SCOPE[legacy.key]!;
  assert.ok(note, "the note exists for a legacy payload with no new fields");
  assert.match(note, /doesn't mean your CV is spelled correctly/i, "and it contradicts the stored claim");
  // Keyed on the check alone: nothing in the saved payload is consulted.
  const legacyGrammar: CheckResult = { ...legacy, key: "grammar", name: "Grammar", summary: "No issues", detail: "No grammar issues found." };
  assert.equal(CHECK_SCOPE[legacyGrammar.key], CHECK_SCOPE.grammar);
  for (const k of ["spell", "grammar", "ats", "length"] as CheckKey[]) assert.ok(CHECK_SCOPE[k], `${k} has a coverage note`);
  for (const [k, v] of Object.entries(CHECK_SCOPE)) {
    assert.ok(k in CHECK_META, `${k} is a real check`);
    // A coverage note that names no limit would be filler.
    assert.match(v!, /\b(aren't|can't|isn't|doesn't|not )/i, `${k} names what it cannot do`);
  }
});

/* ---------- the diagnostic itself (OP-001) ---------- */

test("the diagnostic faithfully reports actual engine observations without prescribing the defects", async () => {
  const d = await runAuditDiagnostic();
  assert.equal(d.rubric, RUBRIC_VERSION);
  assert.equal(d.method, "rules", "no model call, so running it costs nothing and needs no provider");
  const ids = d.gates.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, "gate ids are unique");
  for (const g of d.gates) {
    assert.ok(g.desired && g.observed, g.id);
    if (!g.met) assert.match(g.followUp, /OP-\d{3}/, `${g.id} names the task that will fix it`);
  }
  const gate = (id: string) => d.gates.find((g) => g.id === id)!;

  const clean = analyseCv(AUDIT_CLEAN_CV, AUDIT_SECTOR);
  const misspelled = analyseCv(AUDIT_MISSPELLED_CV, AUDIT_SECTOR);
  assert.equal(d.spelling.cleanCvScore, clean.score);
  assert.equal(d.spelling.misspelledCvScore, misspelled.score);
  assert.deepEqual(d.spelling.wordsSurfaced, reportedSpellingWords(await runProofreading(AUDIT_MISSPELLED_CV, { provider: localProvider, language: "en-GB", timeoutMs: 30000 })));
  assert.deepEqual(d.spelling.wordsMissed, AUDIT_MISSPELLED_WORDS.filter((w) => !d.spelling.wordsSurfaced.includes(w)));
  const match = matchRequirements({ jobText: AUDIT_ADVERT, cvText: AUDIT_CV_EVIDENCE, extraction: extractRequirements(AUDIT_ADVERT) });
  assert.deepEqual(d.matching.requirements, match.requirements.map((r) => ({ term: r.label, occurrencesInAdvert: r.occurrences, classifiedEssential: r.category === "essential", foundInCv: r.evidence.level === "explicit" || r.evidence.level === "weak" })));
  assert.equal(d.matching.matchScore.now, match.coverage.score);
  assert.deepEqual(d.matching.essentialGapsShown, match.essentialGaps);
  assert.equal(d.matching.advert, AUDIT_ADVERT);

  // Fixed by OP-002, measured from the real check output rather than asserted here.
  assert.equal(gate("proofreading.spelling-message-states-its-coverage").met, true);
  assert.equal(gate("proofreading.consistency-message-states-its-coverage").met, true);

  // Desired product behaviour is gated by --check, not inverted into an expectation that a defect
  // must continue to exist. Numerical compatibility is separately scoped to OP-002 above.
  assert.equal(gate("proofreading.detects-audit-misspellings").met, d.spelling.wordsMissed.length === 0 && d.spelling.proofreadingStatus.misspelled === "complete");
  assert.equal(gate("proofreading.clean-source-not-flagged").met, d.spelling.cleanWordsFlagged.length === 0 && d.spelling.proofreadingStatus.clean === "complete");
});

test("echoing a misspelling in an explanation, a suggestion or a regional preference is not a spelling finding", async () => {
  const p = await runProofreading(AUDIT_CLEAN_CV, { provider: localProvider, language: "en-GB", timeoutMs: 30000 });
  const doc = p.documentVersion;
  const f = (category: ProofreadingCategory, quote: string, range: { start: number; end: number } | null, explanation = "", rule = LIKELY_MISSPELLING): ProofreadingFinding => ({ id: `${category}:${quote}`, check: `proofreading.${category}`, category, rule, status: "needs_attention", severity: "info", confidence: null, method: "rules", explanation, action: null, suggestions: [...AUDIT_MISSPELLED_WORDS], evidence: [{ documentVersion: doc, block: "doc", range, quote }] });
  const echoed = { ...p, findings: [f("spelling", "reporting", { start: 0, end: 9 }, `Source text: ${AUDIT_MISSPELLED_WORDS.join(" ")}`), f("regional", "custmer", { start: 0, end: 7 }), f("spelling", "finanical", null), f("spelling", "relatonships", { start: 0, end: 12 }, "", UNRECOGNISED_WORD)] };
  assert.deepEqual(reportedSpellingWords(echoed), [], "copied words are not proof of detection");
  const real = { ...p, findings: [f("spelling", "custmer", { start: 0, end: 7 }), f("spelling", "Finanical", { start: 9, end: 18 })] };
  assert.deepEqual(reportedSpellingWords(real), ["custmer", "finanical"], "only spelling findings with evidence count");
});

test("observation mode succeeds, check mode fails while any gate is unmet", () => {
  const unmet = [{ id: "fixture", desired: "detect an error", observed: "not detected", met: false, followUp: "OP-007" }];
  assert.equal(exitCode(unmet, "observe"), 0, "collecting data is not a failure");
  assert.equal(exitCode(unmet, "check"), 1, "gating on unmet behaviour is");
  const met = unmet.map((g) => ({ ...g, met: true }));
  assert.equal(exitCode(met, "check"), 0);
  assert.equal(exitCode([], "check"), 0);
  assert.equal(exitCode([{ id: "x", desired: "d", observed: "o", met: false, followUp: "OP-999" }], "check"), 1);
});

test("the diagnostic's report names each unmet gate and whose job it is", async () => {
  const d = await runAuditDiagnostic();
  d.gates = [{ id: "fixture.unmet", desired: "detect an error", observed: "not detected", met: false, followUp: "OP-007" }];
  const observe = report(d, "observe");
  const check = report(d, "check");
  for (const g of d.gates.filter((x) => !x.met)) {
    assert.ok(observe.includes(`[UNMET] ${g.id}`), g.id);
    assert.ok(observe.includes(g.followUp), `${g.id} follow-up`);
  }
  assert.match(observe, /This is the current state of the product, not a script error/);
  assert.match(observe, /Exiting 0 because observation mode only collects data/);
  assert.match(check, /Exiting 1 because --check treats unmet gates as a failure/);
  assert.ok(observe.includes(`Misspellings missed: ${d.spelling.wordsMissed.join(", ") || "none"}`));
  assert.ok(observe.includes(`Never extracted: ${d.matching.essentialTermsNotExtracted.join(", ") || "none"}`));
});

test("the gates are measured, so a repaired engine would pass them without editing the diagnostic", () => {
  // What OP-007, OP-012 and OP-013 are supposed to produce. Nothing here is the current behaviour:
  // it proves the gates respond to observations instead of being hardcoded to fail.
  const spelling: SpellingObservations = {
    cleanScore: 10,
    misspelledScore: 2,
    cleanCvScore: 83,
    misspelledCvScore: 83, // Proofreading can be useful before calibrated integration into the core score.
    spellCheck: { name: "Spelling", score: 2, summary: "4 spelling mistakes", detail: "custmer, relatonships, finanical and recomendations are misspelled. A US variant is a separate, regional matter and is not counted as a mistake.", stat: "4 spelling mistakes", extras: [...AUDIT_MISSPELLED_WORDS] },
    consistencyCheck: { name: "Writing consistency", score: 10, summary: "Consistent bullet style", detail: "We check repeated words, lowercase bullet starts and mixed bullet endings.", stat: "0 consistency issues" },
    wordsSurfaced: [...AUDIT_MISSPELLED_WORDS],
    wordsMissed: [],
    proofreadingStatus: { clean: "complete", misspelled: "complete" },
    cleanWordsFlagged: [],
    wells: [],
  };
  const matching: MatchingObservations = {
    advert: AUDIT_ADVERT,
    cvEvidence: "Excel",
    requirements: [
      { term: "Kubernetes", occurrencesInAdvert: 1, classifiedEssential: true, foundInCv: false },
      { term: "Terraform", occurrencesInAdvert: 1, classifiedEssential: true, foundInCv: false },
      { term: "Excel", occurrencesInAdvert: 2, classifiedEssential: false, foundInCv: true },
    ],
    essentialTermsNotExtracted: [],
    excelClassification: "desirable",
    matchScore: { now: 20, withAdded: 20, tailored: 20 },
    essentialGapsShown: ["Kubernetes", "Terraform"],
    scoreWithNoEvidence: 0,
  };
  const gates = evaluateGates(spelling, matching);
  assert.deepEqual(gates.filter((g) => !g.met).map((g) => g.id), [], report({ rubric: RUBRIC_VERSION, method: "rules", spelling, matching, gates }, "check"));
  assert.equal(exitCode(gates, "check"), 0);

  // And one observation at a time still fails its own gate: Excel promoted by repetition.
  const promoted = evaluateGates(spelling, { ...matching, excelClassification: "essential" });
  assert.deepEqual(promoted.filter((g) => !g.met).map((g) => g.id), ["matching.repeated-desirable-stays-desirable"]);
  const stillSilent = evaluateGates({ ...spelling, wordsSurfaced: [], wordsMissed: [...AUDIT_MISSPELLED_WORDS] }, matching);
  assert.deepEqual(stillSilent.filter((g) => !g.met).map((g) => g.id), ["proofreading.detects-audit-misspellings"]);
  // A proofreader that didn't run can't meet a gate, even with nothing missed or flagged.
  const down = evaluateGates({ ...spelling, proofreadingStatus: { clean: "unavailable", misspelled: "unavailable" } }, matching);
  assert.deepEqual(down.filter((g) => !g.met).map((g) => g.id), ["proofreading.detects-audit-misspellings", "proofreading.clean-source-not-flagged"]);
  const noisy = evaluateGates({ ...spelling, cleanWordsFlagged: ["colleagues"] }, matching);
  assert.deepEqual(noisy.filter((g) => !g.met).map((g) => g.id), ["proofreading.clean-source-not-flagged"]);
});
