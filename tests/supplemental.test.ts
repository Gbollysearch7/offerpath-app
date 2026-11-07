import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { analyseCv } from "@/lib/analysis/cv";
import { extractDocument } from "@/lib/analysis/extract";
import { cvAssessment, cvBlocks, documentVersion } from "@/lib/analysis/findings";
import { normaliseText } from "@/lib/analysis/fingerprint";
import { SUPPLEMENTAL_CHECK_LABELS, SUPPLEMENTAL_STATUS_DISPLAY } from "@/lib/analysis/labels";
import { RUBRIC_VERSION } from "@/lib/analysis/rubric";
import { isSupplemental, runCheck, SUPPLEMENTAL_KEYS, supplementalFindings, supplementalRows, type SupplementalKey } from "@/lib/analysis/supplemental";
import { readCv } from "@/lib/analysis/supplemental-context";
import { comparePoints, readDates, relation } from "@/lib/analysis/supplemental-dates";
import { checkEvidence, fromStored, toStored } from "@/lib/report-schema";
import { DEMO_CVS } from "@/lib/seed-data";
import { buildCvPayload } from "@/lib/services";
import type { CvReviewPayload, Finding } from "@/lib/types";
import { AUDIT_CLEAN_CV, AUDIT_MISSPELLED_CV, AUDIT_SECTOR } from "./fixtures/audit";
import { LEGACY_CV_NO_BULLETS_ALL_TENS, LEGACY_CV_OLD_WORDING } from "./fixtures/legacy-payloads";

// OP-009. All CVs here are invented for these tests.

const check = (text: string, id: SupplementalKey): Finding => supplementalFindings(text, documentVersion(text)).find((f) => f.id === id)!;
const order = (text: string) => check(text, "supplemental.date_order");
const pronouns = (text: string) => check(text, "supplemental.pronouns");

const B = "• Coordinated weekly reporting across three teams and shared the results.";
const cvWith = (experience: string[], education: string[] = ["University of Northfield | BSc Economics | 2023 - 2026"]) =>
  ["Sam Sample", "sam@example.com", "EDUCATION", ...education, "EXPERIENCE", ...experience, "SKILLS", "Excel"].join("\n");
const role = (title: string, dates: string) => [`${title} | ${dates}`, B];

/* ---------- supplemental means supplemental ---------- */

test("the supplemental checks don't touch the analysis, the core findings or the fingerprint", () => {
  for (const text of [AUDIT_CLEAN_CV, AUDIT_MISSPELLED_CV, ...DEMO_CVS.map((c) => c.text)]) {
    const a = analyseCv(text, AUDIT_SECTOR);
    const before = JSON.stringify(a);
    const assessment = cvAssessment(a, text);
    assert.equal(JSON.stringify(a), before, "the analysis isn't mutated");
    const p = buildCvPayload({ fileName: "cv.pdf", text, sector: AUDIT_SECTOR, stage: "Final year, graduate roles" });
    assert.equal(JSON.stringify(p.analysis), JSON.stringify(analyseCv(text, AUDIT_SECTOR)), "the payload carries the engine's analysis unchanged");
    assert.equal(p.analysis.meta.rubric, RUBRIC_VERSION);
    const core = assessment.findings.filter((f) => !isSupplemental(f));
    assert.deepEqual(core, cvAssessment(a, text, "legacy").findings.map((f, i) => ({ ...f, confidence: core[i].confidence, method: core[i].method, evidence: core[i].evidence })), "core findings are what they would be without these checks");
    assert.deepEqual(assessment.findings.filter(isSupplemental).map((f) => f.id), [...SUPPLEMENTAL_KEYS], "every check is present, after the core findings");
  }
});

test("nothing on the scoring path imports the supplemental checks", () => {
  const dir = "src/lib/analysis";
  const scoring = ["cv.ts", "rubric.ts", "fingerprint.ts", "judgment.ts", "parse.ts", "lexicon.ts", "check-content.ts", "document.ts", "job.ts", "tailor.ts", "letter.ts"];
  for (const file of scoring) assert.doesNotMatch(readFileSync(`${dir}/${file}`, "utf8"), /from "[^"]*supplemental/, `${file} doesn't import them`);
  const importers = [...readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.startsWith("supplemental")), "../services.ts", "../scoring.ts", "../cv-flow.ts"].filter((f) => {
    try {
      return /^import \{[^}]*\} from "[^"]*supplemental/m.test(readFileSync(`${dir}/${f}`, "utf8"));
    } catch {
      return false;
    }
  });
  assert.deepEqual(importers, ["findings.ts"], "findings.ts is the only way in (labels.ts takes one type, see below)");
  assert.match(readFileSync(`${dir}/labels.ts`, "utf8"), /import type \{ SupplementalKey \}/);
});

test("supplemental findings never carry a severity above info and claim no calibrated confidence", () => {
  const text = cvWith([...role("Analyst", "2019 - 2020"), "• I led my team of three to deliver the plan.", ...role("Manager", "2021 - 2022")]);
  for (const f of supplementalFindings(text, documentVersion(text))) {
    assert.equal(f.severity, "info", f.id);
    assert.equal(f.confidence, null, f.id);
    assert.equal(f.method, "rules", f.id);
    assert.equal(f.check, f.id);
  }
});

/* ---------- reading dates ---------- */

test("dates: the forms CVs use", () => {
  const p = (line: string) => {
    const d = readDates(line);
    return d && { start: d.start, end: d.end, problem: d.problem, single: d.single };
  };
  assert.deepEqual(p("Analyst | Jun 2024 - Present"), { start: { year: 2024, month: 6 }, end: "present", problem: null, single: false });
  assert.deepEqual(p("Analyst | 2024 - present"), { start: { year: 2024, month: null }, end: "present", problem: null, single: false });
  assert.deepEqual(p("Analyst, 2022 - 2023"), { start: { year: 2022, month: null }, end: { year: 2023, month: null }, problem: null, single: false });
  assert.deepEqual(p("September 2021 to June 2022"), { start: { year: 2021, month: 9 }, end: { year: 2022, month: 6 }, problem: null, single: false });
  assert.deepEqual(p("03/2018 - 09/2018"), { start: { year: 2018, month: 3 }, end: { year: 2018, month: 9 }, problem: null, single: false });
  assert.deepEqual(p("A levels, 2023"), { start: { year: 2023, month: null }, end: { year: 2023, month: null }, problem: null, single: true }, "a single year is a point");
  assert.deepEqual(p("Summer Intern | June - Aug 2023"), { start: { year: 2023, month: 6 }, end: { year: 2023, month: 8 }, problem: null, single: false }, "a year written once");
  assert.deepEqual(p("Placement | Nov - Feb 2023"), { start: { year: 2022, month: 11 }, end: { year: 2023, month: 2 }, problem: null, single: false }, "over a new year");
  assert.deepEqual(p("Tutor | 2021-23"), { start: { year: 2021, month: null }, end: { year: 2023, month: null }, problem: null, single: false });
  assert.equal(p("Head of Marketing"), null);
});

test("dates: incomplete ones are named, and a word that starts like a month isn't one", () => {
  assert.equal(readDates("Analyst | Jan 2022 -")?.problem, "no_end");
  assert.equal(readDates("Analyst | Jan 2022 - | London")?.problem, "no_end");
  assert.equal(readDates("Intern | June - August")?.problem, "no_year");
  assert.equal(readDates("Intern | Jun '21 - Aug '22")?.problem, "no_year");
  assert.equal(readDates("Analyst | 2024 - 2021")?.problem, "backwards");
  assert.deepEqual(readDates("Head of Marketing 2021 - 2023")?.start, { year: 2021, month: null }, "not March");
  assert.deepEqual(readDates("Mayor 2021")?.start, { year: 2021, month: null }, "not May");
  assert.deepEqual(readDates("March 2021 - May 2023")?.start, { year: 2021, month: 3 });
});

test("dates: comparison only answers what the dates can answer", () => {
  assert.equal(comparePoints({ year: 2021, month: null }, { year: 2021, month: 3 }), null, "year-only against a month in that year is unknown");
  assert.equal(comparePoints({ year: 2021, month: null }, { year: 2021, month: null }), 0);
  assert.equal(comparePoints({ year: 2020, month: null }, { year: 2021, month: 3 }), -1);
  const r = (a: number, b: number) => ({ start: { year: a, month: null }, end: { year: b, month: null } });
  assert.equal(relation(r(2022, 2024), r(2019, 2021)), "fine", "older below newer");
  assert.equal(relation(r(2019, 2021), r(2022, 2024)), "out_of_order");
  assert.equal(relation(r(2018, 2021), r(2021, 2024)), "out_of_order", "sharing only the year they meet in is not an overlap");
  assert.equal(relation(r(2019, 2023), r(2021, 2024)), "overlap", "a partial overlap is allowed, even listed this way round");
  assert.equal(relation(r(2018, 2024), r(2021, 2022)), "overlap", "a role inside its employer");
  assert.equal(relation({ start: r(2021, 2021).start, end: "present" }, { start: r(2022, 2022).start, end: "present" }), "overlap", "two current roles");
  assert.equal(relation(r(2019, 2022), { start: { year: 2022, month: 3 }, end: { year: 2022, month: 6 } }), "unknown");
});

/* ---------- ordering ---------- */

test("order: most recent first passes, in every form of date", () => {
  for (const exp of [
    [...role("Manager", "Jun 2024 - Present"), ...role("Analyst", "Mar 2022 - May 2024"), ...role("Intern", "Jun 2021 - Aug 2021")],
    [...role("Manager", "2024 - Present"), ...role("Analyst", "2022 - 2024"), ...role("Intern", "2020 - 2021")],
    [...role("Manager", "06/2024 - 09/2025"), ...role("Analyst", "03/2022 - 05/2024")],
    [...role("Manager", "2024"), ...role("Analyst", "2022")],
  ]) {
    const f = order(cvWith(exp));
    assert.equal(f.status, "passed", f.explanation);
    assert.match(f.explanation, /most recent first/);
    assert.deepEqual(f.evidence, []);
  }
});

test("order: an older entry listed first is explained with both entries, and the text is left alone", () => {
  const text = cvWith([...role("Manager", "2024 - Present"), ...role("Intern", "2018 - 2019"), ...role("Analyst", "2021 - 2023")]);
  const f = order(text);
  assert.equal(f.status, "needs_attention");
  assert.match(f.explanation, /"Intern \| 2018 - 2019" is listed above "Analyst \| 2021 - 2023"/);
  assert.match(f.explanation, /In EXPERIENCE/);
  assert.deepEqual(f.evidence.map((e) => e.quote), ["Intern | 2018 - 2019", "Analyst | 2021 - 2023"]);
  assert.match(f.action!, /haven't changed the order/);
  const oldest = order(cvWith([...role("Intern", "2018 - 2019"), ...role("Analyst", "2020 - 2021"), ...role("Manager", "2022 - 2023")]));
  assert.match(oldest.explanation, /EXPERIENCE runs oldest first/);
});

test("order: studying while working is never an error, because sections are compared separately", () => {
  const f = order(cvWith([...role("Barista", "Sep 2023 - Present"), ...role("Tutor", "Oct 2022 - Jun 2023")], ["University of Northfield | BSc | Sep 2022 - Jun 2025", "Ashfield College | A levels | 2020 - 2022"]));
  assert.equal(f.status, "passed", f.explanation);
  // Education first with older dates than the job below it: still nothing, because they are different sections.
  const study = order(["Sam Sample", "EDUCATION", "Ashfield College | 2015 - 2017", "EXPERIENCE", ...role("Manager", "2022 - Present"), ...role("Analyst", "2019 - 2021")].join("\n"));
  assert.equal(study.status, "passed", study.explanation);
});

test("order: overlapping jobs are allowed in either order", () => {
  for (const exp of [
    [...role("Tutor", "2021 - 2023"), ...role("Barista", "2022 - 2024")],
    [...role("Barista", "2022 - 2024"), ...role("Tutor", "2021 - 2023")],
    [...role("Barista", "Sep 2022 - Present"), ...role("Tutor", "Jan 2023 - Present")],
  ]) {
    const f = order(cvWith(exp));
    assert.equal(f.status, "passed", f.explanation);
    assert.match(f.explanation, /overlaps?, which is fine/);
  }
});

test("order: nested roles under an employer work", () => {
  const nested = cvWith(["Northbank | 2018 - 2024", ...role("Senior Analyst", "2021 - 2024"), ...role("Analyst", "2018 - 2021"), "Calder | 2016 - 2018", ...role("Trainee", "2016 - 2018")]);
  assert.equal(order(nested).status, "passed", order(nested).explanation);
  const undatedParent = cvWith(["Northbank", ...role("Senior Analyst", "2021 - 2024"), ...role("Analyst", "2018 - 2021")]);
  assert.equal(order(undatedParent).status, "passed", "an employer line with no bullets of its own isn't an undated role");
  const swapped = order(cvWith(["Northbank | 2018 - 2024", ...role("Analyst", "2018 - 2021"), ...role("Senior Analyst", "2021 - 2024")]));
  assert.equal(swapped.status, "needs_attention");
  assert.match(swapped.explanation, /"Analyst \| 2018 - 2021" is listed above "Senior Analyst \| 2021 - 2024"/);
  const past = order(cvWith([...role("Volunteer", "2020 - 2021"), ...role("Long job", "2010 - 2024"), ...role("Contract", "2022 - 2023")]));
  assert.equal(past.status, "needs_attention", "found past a long-running entry between them");
  assert.match(past.explanation, /"Volunteer \| 2020 - 2021" is listed above "Contract \| 2022 - 2023"/);
});

test("order: dates on their own line, beside the title, are read as that entry's dates", () => {
  const text = cvWith(["Manager, Northbank", "2022 - 2024", B, "Analyst, Calder", "2019 - 2021", B]);
  assert.equal(order(text).status, "passed", order(text).explanation);
  const first = cvWith(["2022 - 2024", "Manager, Northbank", B, "2019 - 2021", "Analyst, Calder", B]);
  assert.equal(order(first).status, "passed", order(first).explanation);
});

test("order: incomplete dates give uncertain, never needs attention and never passed", () => {
  const cases: [string, string[], RegExp][] = [
    ["no end", [...role("Manager", "Jan 2022 -"), ...role("Analyst", "2019 - 2021")], /has a start date and no end date/],
    ["no year", [...role("Manager", "June - August"), ...role("Analyst", "2019 - 2021")], /has no full year/],
    ["no date", ["Manager, Northbank", B, ...role("Analyst", "2019 - 2021")], /has no date we could read/],
    ["backwards", [...role("Manager", "2024 - 2021"), ...role("Analyst", "2019 - 2020")], /ends before it starts/],
    ["mixed precision", [...role("Manager", "2019 - 2022"), ...role("Analyst", "Mar 2022 - Jun 2022")], /can't be put in order/],
    ["nothing dated", ["Manager, Northbank", B, "Analyst, Calder", B], /has no date we could read/],
  ];
  const noEducationDates = order(cvWith(role("Manager", "2022 - 2024"), ["Ashfield College"]));
  assert.equal(noEducationDates.status, "uncertain");
  assert.match(noEducationDates.explanation, /no dates in EDUCATION/);
  for (const [name, exp, words] of cases) {
    const f = order(cvWith(exp));
    assert.equal(f.status, "uncertain", `${name}: ${f.explanation}`);
    assert.match(f.explanation, words, name);
    assert.match(f.explanation, /isn't an error/, name);
    assert.ok(f.action, name);
    assert.ok(f.evidence.length >= 1, `${name}: shows the entry`);
  }
});

test("order: a real ordering issue is still reported when another date is incomplete", () => {
  const f = order(cvWith([...role("Analyst", "2018 - 2019"), ...role("Manager", "2021 - 2023"), ...role("Tutor", "Jan 2017 -")]));
  assert.equal(f.status, "needs_attention");
  assert.match(f.explanation, /Also, "Tutor \| Jan 2017 -" has a start date and no end date/);
});

test("order: each occurrence of a heading is its own list, and sections that aren't timelines don't count", () => {
  const twoLists = ["Sam Sample", "RELEVANT EXPERIENCE", ...role("Analyst", "2021 - 2022"), "WORK HISTORY", ...role("Manager", "2023 - 2024"), ...role("Barista", "2019 - 2020")].join("\n");
  assert.equal(order(twoLists).status, "passed", "the 2021 role in one list isn't compared with the 2023 role in the other");
  const awards = ["Sam Sample", "EXPERIENCE", ...role("Manager", "2023 - 2024"), ...role("Analyst", "2020 - 2021"), "AWARDS", "Prize, 2019", "Medal, 2022"].join("\n");
  assert.equal(order(awards).status, "passed", order(awards).explanation);
  const undatedProjects = ["Sam Sample", "PROJECTS", "Budget tracker", B, "Weather app", B].join("\n");
  assert.notEqual(order(undatedProjects).status, "needs_attention");
  assert.notEqual(order(undatedProjects).status, "uncertain", "a project without dates is ordinary");
});

test("order: nothing to compare is not assessed, not passed", () => {
  assert.equal(order("Sam Sample\nA line of text with no sections at all.").status, "not_applicable");
  assert.equal(order(cvWith(role("Manager", "2022 - 2024"))).status, "not_applicable", "one dated entry per section");
  assert.equal(order("").status, "not_applicable");
});

/* ---------- pronouns ---------- */

test("pronouns: a first-person bullet gets guidance, without calling it an error", () => {
  const f = pronouns(cvWith(["Society Treasurer | 2022 - 2023", "• I reconciled the accounts and I presented them to my committee every month."]));
  assert.equal(f.status, "needs_attention");
  assert.match(f.explanation, /"I", "my"/);
  assert.match(f.explanation, /isn't a grammar mistake/);
  assert.match(f.action!, /on purpose/);
  assert.deepEqual(f.evidence.map((e) => e.quote), ["• I reconciled the accounts and I presented them to my committee every month."]);
});

test("pronouns: a personal statement is not a blanket error", () => {
  const text = ["Sam Sample", "PERSONAL STATEMENT", "I am a final-year student and my interest in markets began at school.", "EXPERIENCE", ...role("Analyst", "2022 - 2023")].join("\n");
  const f = pronouns(text);
  assert.equal(f.status, "passed", f.explanation);
  assert.match(f.explanation, /left 2 in your personal statement or at the top of your CV alone/);
  assert.deepEqual(f.evidence, []);
});

test("pronouns: a quotation is not a blanket error, in any quotation mark and across a wrapped line", () => {
  for (const line of [
    '• Received feedback from a client: "I would hire them again".',
    "• Received feedback from a client: “I would hire them again”.",
    "• Received feedback from a client: 'I would hire them again'.",
    "• Received feedback from a client: ‘I would hire them again’.",
  ]) {
    const f = pronouns(cvWith(["Analyst | 2022 - 2023", line]));
    assert.equal(f.status, "passed", `${line}: ${f.explanation}`);
    assert.match(f.explanation, /1 inside a quotation/);
  }
  const wrapped = pronouns(cvWith(["Analyst | 2022 - 2023", '• Named in the client survey: "working with them made', 'my job easier and I would recommend them".']));
  assert.equal(wrapped.status, "passed", wrapped.explanation);
  const after = pronouns(cvWith(["Analyst | 2022 - 2023", '• Rated "excellent" by my manager.']));
  assert.equal(after.status, "needs_attention", "outside the quotation marks still counts");
});

test("pronouns: names, numerals, abbreviations and other sections are left alone", () => {
  const clean = [
    "• Built a dashboard for the US and ME markets using MySQL and Google I/O talks.",
    "• Delivered Phase I and Level I of the rollout, i.e. the first two stages.",
    "• Applied data mine techniques to customer records for the review.",
    "• Assessed (i) cost and (ii) risk for each of the proposals.",
    "• Volunteered at Our Lady's Hospice and We Are Social events every month.",
  ];
  const f = pronouns(["Sam Sample", "EDUCATION", "Our Lady's Catholic High School | 2015 - 2020", "EXPERIENCE", "We Are Social | Analyst | 2022 - 2023", ...clean, "INTERESTS", "I enjoy running and my local choir.", "REFERENCES", "My manager can give a reference."].join("\n"));
  assert.equal(f.status, "passed", f.explanation);
  assert.deepEqual(f.evidence, []);
  assert.doesNotMatch(f.explanation, /left/, "those sections aren't even counted as hits");
});

test("pronouns: only 'we' is uncertain, because crediting a team can be right", () => {
  const f = pronouns(cvWith(["Analyst | 2022 - 2023", "• Worked with two colleagues and we delivered the review early."]));
  assert.equal(f.status, "uncertain");
  assert.match(f.explanation, /crediting a team/);
  assert.match(f.action!, /Don't claim sole credit/);
});

test("pronouns: without sections or roles to read, they are not assessed", () => {
  assert.equal(pronouns("I am a student and I want a job in finance.").status, "not_applicable");
  assert.equal(pronouns("Sam Sample\nSKILLS\nExcel").status, "not_applicable");
});

/* ---------- consistency ---------- */

const CONS = {
  dates: "supplemental.consistency_dates",
  punct: "supplemental.consistency_punctuation",
  bullets: "supplemental.consistency_bullets",
  headings: "supplemental.consistency_headings",
} as const;

test("consistency: dates written different ways are shown, from the original characters", () => {
  const months = check(cvWith([...role("Manager", "June 2023 - Present"), ...role("Analyst", "Jan 2021 - Mar 2022"), ...role("Intern", "July 2019 - August 2019")]), CONS.dates);
  assert.equal(months.status, "needs_attention");
  assert.match(months.explanation, /Months are written in full on 2 lines and shortened on 1 line/);
  assert.deepEqual(months.evidence.map((e) => e.quote), ["Analyst | Jan 2021 - Mar 2022"], "the odd one out");
  const dashes = check(cvWith([...role("Manager", "2023 – 2024"), ...role("Analyst", "2021 – 2022"), ...role("Intern", "2019 - 2020")], ["University of Northfield | 2016 – 2019"]), CONS.dates);
  assert.equal(dashes.status, "needs_attention", "the scorer's text has only hyphens, so this needs the raw line");
  assert.match(dashes.explanation, /a spaced en dash and a spaced hyphen/);
  assert.deepEqual(dashes.evidence.map((e) => e.quote), ["Intern | 2019 - 2020"]);
  const words = check(cvWith([...role("Manager", "2023 - Present"), ...role("Analyst", "2021 - current")]), CONS.dates);
  assert.match(words.explanation, /"Present" and "current"/);
  const mixed = check(cvWith([...role("Manager", "Jan 2023 - Mar 2024"), ...role("Analyst", "2021 - 2022")]), CONS.dates);
  assert.match(mixed.explanation, /In EXPERIENCE, 1 entry gives months and 1 gives only years/);
});

test("consistency: years in education beside months at work is fine, and one style passes", () => {
  const ok = check(cvWith([...role("Manager", "Jan 2023 - Mar 2024"), ...role("Analyst", "Feb 2021 - Dec 2022")], ["University of Northfield | 2019 - 2022"]), CONS.dates);
  assert.equal(ok.status, "passed", ok.explanation);
  assert.equal(check("Sam Sample\nEXPERIENCE\nAnalyst | 2022 - 2023\n" + B, CONS.dates).status, "not_applicable");
});

test("consistency: bullet endings", () => {
  const bullets = ["• Reconciled the accounts every single month.", "• Presented results to the committee each term.", "• Organised a careers panel for final-year students"];
  const f = check(cvWith(["Analyst | 2022 - 2023", ...bullets]), CONS.punct);
  assert.equal(f.status, "needs_attention");
  assert.match(f.explanation, /2 bullets end with a full stop and 1 doesn't/);
  assert.deepEqual(f.evidence.map((e) => e.quote), [bullets[2]]);
  assert.equal(check(cvWith(["Analyst | 2022 - 2023", ...bullets.map((b) => b.replace(/\.$/, "") + ".")]), CONS.punct).status, "passed");
  assert.equal(check(cvWith(["Analyst | 2022 - 2023", bullets[0]]), CONS.punct).status, "not_applicable", "too few bullets isn't a pass");
  const doubled = check(cvWith(["Analyst | 2022 - 2023", bullets[0], bullets[1], "• Organised a careers panel for students.."]), CONS.punct);
  assert.match(doubled.explanation, /doubled punctuation/);
});

test("consistency: bullet symbols come from the original text, and a lost symbol isn't a difference", () => {
  const two = check(cvWith(["Analyst | 2022 - 2023", "• Reconciled the accounts every single month.", "• Presented results to the committee each term.", "- Organised a careers panel for final-year students."]), CONS.bullets);
  assert.equal(two.status, "needs_attention", "normalisation turns both into •, so this needs the raw line");
  assert.match(two.explanation, /"•" \(2\) and "-" \(1\)/);
  assert.match(two.explanation, /can change when it is read/);
  const lost = check(cvWith(["Analyst | 2022 - 2023", "• Reconciled the accounts every single month.", "• Presented results to the committee each term.", "Organised a careers panel for final-year students."]), CONS.bullets);
  assert.equal(lost.status, "passed", lost.explanation);
  const lower = check(cvWith(["Analyst | 2022 - 2023", "• Reconciled the accounts every single month.", "• Presented results to the committee each term.", "• organised a careers panel for final-year students."]), CONS.bullets);
  assert.match(lower.explanation, /1 bullet starts with a lowercase letter/);
  const name = check(cvWith(["Analyst | 2022 - 2023", "• Reconciled the accounts every single month.", "• Presented results to the committee each term.", "• iPhone testing across three teams and two products."]), CONS.bullets);
  assert.equal(name.status, "passed", "a name spelt that way isn't a lowercase start");
});

test("consistency: headings", () => {
  const f = check("Sam Sample\nEDUCATION\nBSc\nWork experience\nAnalyst\nKey Skills\nExcel", CONS.headings);
  assert.equal(f.status, "needs_attention");
  assert.match(f.explanation, /capitals.*Sentence case.*Title Case/);
  const colon = check("Sam Sample\nEDUCATION:\nBSc\nSKILLS\nExcel\nINTERESTS\nRunning", CONS.headings);
  assert.match(colon.explanation, /1 heading ends with a colon and 2 don't/);
  assert.deepEqual(colon.evidence.map((e) => e.quote), ["EDUCATION:"]);
  assert.equal(check("Sam Sample\nEDUCATION\nBSc\nWORK EXPERIENCE\nAnalyst", CONS.headings).status, "passed");
  assert.equal(check("Sam Sample\nEducation\nBSc\nSkills\nExcel\nKey Skills\nWord", CONS.headings).status, "passed", "one-word headings fit Title Case and Sentence case alike");
  assert.equal(check("Sam Sample\nEDUCATION\nBSc", CONS.headings).status, "not_applicable");
});

/* ---------- what text can't show ---------- */

test("fonts and alignment are always not assessed, and nothing else claims to have checked them", () => {
  const corpus = [AUDIT_CLEAN_CV, ...DEMO_CVS.map((c) => c.text), cvWith(role("Analyst", "2022 - 2023")), "", "One line."];
  for (const text of corpus) {
    const all = supplementalFindings(text, documentVersion(text));
    const visual = all.find((f) => f.id === "supplemental.consistency_visual")!;
    assert.equal(visual.status, "not_applicable");
    assert.equal(SUPPLEMENTAL_STATUS_DISPLAY[visual.status], "Not assessed");
    assert.match(visual.explanation, /didn't assess fonts, font sizes, alignment/);
    for (const f of all.filter((x) => x !== visual)) {
      assert.doesNotMatch(`${f.explanation} ${f.action ?? ""}`, /\b(fonts?|typeface|alignment|aligned|margins?|colou?r)\b/i, `${f.id} says nothing about fonts or alignment`);
    }
  }
});

/* ---------- reports without these checks ---------- */

test("a legacy report never gains these checks, and reads as not assessed rather than passed", () => {
  for (const legacy of [LEGACY_CV_OLD_WORDING, LEGACY_CV_NO_BULLETS_ALL_TENS]) {
    const read = fromStored("cv_review", legacy) as CvReviewPayload;
    assert.equal(read.assessment.origin, "legacy");
    assert.equal(read.assessment.findings.filter(isSupplemental).length, 0);
    const rows = supplementalRows(read.assessment);
    assert.equal(rows.length, SUPPLEMENTAL_KEYS.length);
    for (const r of rows) {
      assert.equal(r.recorded, false, r.key);
      assert.equal(r.status, "not_applicable", r.key);
      assert.equal(r.statusLabel, "Not assessed", r.key);
      assert.match(r.explanation, /^Not assessed: this report was saved before/);
      assert.deepEqual(r.quotes, []);
      assert.ok(SUPPLEMENTAL_CHECK_LABELS[r.key]);
    }
  }
});

test("a report saved with engine findings but before these checks also reads as not assessed", () => {
  const p = buildCvPayload({ fileName: "cv.pdf", text: DEMO_CVS[3].text, sector: AUDIT_SECTOR, stage: "Final year, graduate roles" });
  const before = { ...p, assessment: { ...p.assessment, findings: p.assessment.findings.filter((f) => !isSupplemental(f)) } };
  const read = fromStored("cv_review", toStored("cv_review", before)) as CvReviewPayload;
  assert.equal(read.assessment.origin, "engine");
  for (const r of supplementalRows(read.assessment)) {
    assert.equal(r.statusLabel, "Not assessed");
    assert.notEqual(r.status, "passed");
  }
  const one = { findings: [{ ...p.assessment.findings.find(isSupplemental)!, id: "supplemental.pronouns", status: "passed" as const }] };
  const rows = supplementalRows(one);
  assert.equal(rows.find((r) => r.key === "supplemental.pronouns")!.statusLabel, "No issue found", "the words say only that these rules raised nothing");
  assert.equal(rows.filter((r) => r.statusLabel === "Not assessed").length, SUPPLEMENTAL_KEYS.length - 1, "one recorded check doesn't vouch for the rest");
});

test("a check that fails is unavailable: it doesn't pass and doesn't stop the report", () => {
  const f = runCheck("supplemental.pronouns", () => {
    throw new Error("boom");
  });
  assert.equal(f.status, "unavailable");
  assert.equal(SUPPLEMENTAL_STATUS_DISPLAY[f.status], "Not available");
  assert.match(f.explanation, /wasn't assessed/);
});

/* ---------- evidence and storage ---------- */

const MESSY = [
  "Sam Sample\r\n\r\nsam@example.com\r\n",
  "EDUCATION:\r\nUniversity of Northfield – BSc – 2023 – 2026\r\n",
  "Work experience\r\n",
  "Analyst | Jan 2019 – Mar 2020\r\n●  I built the first report\r\n- we shipped it..\r\n",
  "Manager | 2021 – Present\r\n•\tLed “my favourite” review​ project.\r\n",
].join("");

test("every supplemental quote resolves in the saved text, and the saved report round-trips", () => {
  for (const text of [AUDIT_CLEAN_CV, AUDIT_MISSPELLED_CV, MESSY, cvWith([...role("Intern", "2018 - 2019"), ...role("Analyst", "2021 - 2023")]), ...DEMO_CVS.map((c) => c.text)]) {
    const p = buildCvPayload({ fileName: "cv.pdf", text, sector: AUDIT_SECTOR, stage: "Final year, graduate roles" });
    assert.deepEqual(checkEvidence(p.assessment.findings, { [p.assessment.documentVersion]: cvBlocks(text, p.analysis.lines) }), []);
    const doc = normaliseText(text);
    for (const f of p.assessment.findings.filter(isSupplemental)) {
      for (const e of f.evidence) {
        assert.equal(e.block, "doc", f.id);
        assert.equal(doc.slice(e.range!.start, e.range!.end), e.quote, f.id);
      }
    }
    const stored = toStored("cv_review", p);
    assert.deepEqual(fromStored("cv_review", JSON.parse(JSON.stringify(stored))), p, "survives the database's JSON");
  }
});

test("messy extracted text: raw lines line up, and the checks still see what the scorer doesn't", () => {
  const cv = readCv(MESSY, documentVersion(MESSY));
  assert.ok(cv.rawLines, "CRLF, non-breaking spaces and zero-width characters don't break the line match");
  assert.equal(cv.rawLines!.length, cv.lines.length);
  const f = supplementalFindings(MESSY, documentVersion(MESSY));
  const by = (id: string) => f.find((x) => x.id === id)!;
  assert.equal(by("supplemental.date_order").status, "needs_attention");
  assert.equal(by("supplemental.pronouns").status, "needs_attention");
  assert.equal(by("supplemental.consistency_bullets").status, "needs_attention");
  assert.equal(by("supplemental.consistency_headings").status, "needs_attention");
});

test("real extraction output: fixtures from OP-005 line up, resolve, and a repeated page header isn't an undated role", async () => {
  const dir = "tests/fixtures/extraction";
  const files = readdirSync(dir).filter((f) => /\.(pdf|docx)$/.test(f) && !f.startsWith("scan"));
  assert.ok(files.length >= 10);
  for (const file of files) {
    const doc = await extractDocument(new Uint8Array(readFileSync(`${dir}/${file}`)), file);
    const version = documentVersion(doc.text);
    assert.ok(readCv(doc.text, version).rawLines, `${file}: raw lines match the scorer's lines`);
    const all = supplementalFindings(doc.text, version);
    assert.deepEqual(checkEvidence(all, { [version]: { doc: normaliseText(doc.text) } }), [], file);
    assert.equal(all.filter((f) => f.status === "unavailable").length, 0, file);
    if (file === "repeated-header.pdf") assert.equal(all.find((f) => f.id === "supplemental.date_order")!.status, "passed", "the header line doesn't make the order uncertain");
    if (file === "letter-spaced-headings.pdf") assert.doesNotMatch(all.find((f) => f.id === "supplemental.pronouns")!.explanation, /left/, "letters in a spaced-out name aren't pronouns");
  }
});

test("the same text gives the same findings, read after read", () => {
  const text = DEMO_CVS[3].text;
  assert.deepEqual(supplementalFindings(text, documentVersion(text)), supplementalFindings(text, documentVersion(text)));
});

test("a hostile CV can't make the checks slow", () => {
  const roles = Array.from({ length: 5000 }, (_, i) => `Role ${i} | ${2000 + (i % 25)} - ${2001 + (i % 25)}`).join("\n");
  const longLine = `${"I ".repeat(50000)}\n${'"'.repeat(50000)}\n${"Jan 2020 - ".repeat(5000)}`;
  const text = `Sam Sample\nEXPERIENCE\n${roles}\n${longLine}`;
  const started = Date.now();
  const all = supplementalFindings(text, documentVersion(text));
  assert.equal(all.length, SUPPLEMENTAL_KEYS.length);
  assert.ok(Date.now() - started < 15000, `took ${Date.now() - started}ms`);
  for (const f of all) assert.ok(f.evidence.length <= 8, `${f.id}: evidence is capped`);
});
