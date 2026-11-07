// OP-022: the publication rules, the wording, and differencing worked through by arithmetic. The SQL is in analytics-db.test.ts;
// the routes are in analytics-actions.test.ts.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { analyticsCsvRows } from "@/lib/analytics/csv";
import { dateRangeLabel, publishedFigures, scoreFigures, STATEMENTS } from "@/lib/analytics/definitions";
import { hiddenGroups, percentOf, publishAverage, publishCount, publishEvents, publishPart, roundCount } from "@/lib/analytics/rules";
import { sampleAnalytics } from "@/lib/analytics/sample";
import { listPeriods } from "@/lib/periods";
import cases from "./fixtures/analytics-publication-cases.json";

const NOW = new Date("2026-11-07T10:00:00Z");
const all = listPeriods(NOW).find((p) => p.key === "all")!;

test("the rules give the expected answers", () => {
  for (const [n, want] of cases.count as [number, number | null][]) assert.equal(publishCount(n), want, `count ${n}`);
  for (const [n, of, want] of cases.part as [number, number, number | null][]) assert.equal(publishPart(n, of), want, `part ${n}/${of}`);
  for (const [e, s, want] of cases.events as [number, number, number | null][]) assert.equal(publishEvents(e, s), want, `events ${e}/${s}`);
  for (const [a, n, want] of cases.average as [number | null, number, number | null][]) assert.equal(publishAverage(a, n), want, `average ${a}/${n}`);
  for (const c of cases.hidden) assert.deepEqual(hiddenGroups(c.sizes as Record<string, number>), c.hidden, JSON.stringify(c.sizes));
});

test("a group-size attack: total minus the visible groups never isolates fewer than five students", () => {
  for (let a = 0; a <= 30; a++) for (let b = 0; b <= 12; b++) for (let c = 0; c <= 8; c++) for (let d = 0; d <= 8; d++) {
    const sizes = Object.fromEntries(Object.entries({ a, b, c, d }).filter(([, n]) => n > 0));
    const hidden = hiddenGroups(sizes);
    const remainder = hidden.reduce((t, g) => t + sizes[g], 0);
    assert.ok(remainder === 0 || remainder >= 5 || hidden.length === Object.keys(sizes).length, `sizes ${JSON.stringify(sizes)} leave ${remainder}`);
    for (const g of Object.keys(sizes)) if (sizes[g] < 5) assert.ok(hidden.includes(g), "and every small group is hidden");
  }
});

test("a subtraction attack: a count derived from two published figures can't be pinned to one number", () => {
  for (let total = 5; total <= 300; total++) for (const group of [5, 8, 12, 13, 22, 23, 37, 100]) {
    if (group >= total) continue;
    const shownTotal = publishCount(total)!;
    const shownGroup = publishCount(group)!;
    const [lo, hi] = [shownTotal - 2 - (shownGroup + 2), shownTotal + 2 - (shownGroup - 2)];
    assert.ok(hi - lo >= 8, "each rounded figure hides five possible values");
    assert.ok(lo <= total - group && total - group <= hi, "and the truth is somewhere in the range");
  }
});

test("adding one student moves a published count by 0 or 5, never by the 1 that would give them away", () => {
  for (let n = 5; n < 400; n++) {
    const change = publishCount(n + 1)! - publishCount(n)!;
    assert.ok(change === 0 || change === 5, `${n}`);
  }
  // Four in every five arrivals change nothing at all. The fifth changes a figure by five, which says a boundary was crossed, not by whom.
  let same = 0;
  for (let n = 5; n < 405; n++) if (publishCount(n + 1) === publishCount(n)) same++;
  assert.equal(same, 320);
});

test("an average attack: a student's score can't be recovered from averages taken with and without them", () => {
  for (let n = 25; n <= 600; n += 7) for (const mean of [20, 50, 66, 90]) {
    for (const score of [0, 100]) {
      const withThem = (mean * n + score) / (n + 1);
      const a = publishAverage(mean, n)!;
      const b = publishAverage(withThem, n + 1)!;
      const [nA, nB] = [publishCount(n)!, publishCount(n + 1)!];
      // What an attacker can bound: each average is within 0.5 and each count within 2.
      const most = (b + 0.5) * (nB + 2) - (a - 0.5) * Math.max(nA - 2, 25);
      const least = (b - 0.5) * Math.max(nB - 2, 26) - (a + 0.5) * (nA + 2);
      assert.ok(most - least >= 100, `n ${n} mean ${mean}: the range is ${most - least} points wide, and scores only span 100`);
    }
  }
});

test("an average on fewer than 25 students is never shown, in any file or row", () => {
  const a = sampleAnalytics("Fictional", all, NOW);
  assert.equal(publishAverage(70, 24), null);
  for (const r of a.breakdowns) if (!r.hidden && r.average !== null) assert.ok((r.students ?? 0) >= 25);
});

test("a percentage is worked out from published figures only, so it can't be turned back into an exact count", () => {
  assert.equal(percentOf(20, 40), 50);
  assert.equal(percentOf(null, 40), null);
  assert.equal(percentOf(5, 20), null, "too few to be a rate");
  const src = fs.readFileSync("supabase/migrations/20261108090000_institutional_analytics.sql", "utf8");
  assert.doesNotMatch(src.split("create function public.admin_analytics")[1], /percent/i, "and the database sends none");
});

test("every measure the blueprint names is there, and shows its definition, date range, exclusions and denominator", () => {
  const a = sampleAnalytics("Fictional", all, NOW);
  const figures = publishedFigures(a);
  const names = figures.map((f) => f.name);
  for (const n of ["Invitations", "Activation", "Completed reviews", "Useful edits", "Repeat use", "Adviser referrals"]) assert.ok(names.includes(n), n);
  for (const f of [...figures, ...scoreFigures(a)]) {
    assert.ok(f.definition.length > 20, `${f.key} definition`);
    assert.ok(f.dateRange.length > 5, `${f.key} dates`);
    assert.ok(f.exclusions.length > 5, `${f.key} exclusions`);
    assert.ok(f.denominatorLabel.length > 3, `${f.key} denominator`);
  }
  const completed = figures.find((f) => f.key === "completed")!;
  assert.match(completed.exclusions, /Resubmissions/);
  assert.match(completed.exclusions, /Failed analyses/);
});

test("the wording never treats a score or a self-report as employment, and says who is left out", () => {
  const a = sampleAnalytics("Fictional", all, NOW);
  assert.match(STATEMENTS.employment, /improved score is not evidence of employment/);
  assert.match(STATEMENTS.population, /may not represent all your students/);
  const words = JSON.stringify([STATEMENTS, publishedFigures(a), scoreFigures(a)]);
  for (const claim of [/employment (rate|success|outcome rate)/i, /employability (rate|score)/i, /got (a )?job/i, /success rate/i, /students? (were|was) hired/i, /placed in/i]) {
    // "Offerpath doesn't know who got a job" is the one sentence allowed to use those words, because it denies them.
    assert.doesNotMatch(words.replace("doesn't know who got a job", ""), claim, String(claim));
  }
  for (const f of [...publishedFigures(a), ...scoreFigures(a)].filter((x) => ["offer", "interview", "improved10"].includes(x.key))) assert.match(f.definition, /Not an employment outcome|not evidence of employment/, f.key);
  const page = fs.readFileSync("src/app/admin/page.tsx", "utf8");
  assert.match(page, /STATEMENTS\.population/);
  assert.match(page, /STATEMENTS\.employment/);
});

test("the dashboard names no student and lists no one: it reads only published figures", () => {
  const page = fs.readFileSync("src/app/admin/page.tsx", "utf8");
  assert.doesNotMatch(page, /adminStudents|adminStudentDetail|student_number|studentNumber/);
  assert.match(page, /repo\.adminAnalytics\(period\.key\)/);
  assert.equal([...page.matchAll(/repo\.\w+\(/g)].length, 1, "and asks for nothing else");
});

test("sample figures are labelled, on the data, the page and the file", () => {
  const a = sampleAnalytics("Fictional", all, NOW);
  assert.equal(a.sample, true);
  assert.match(fs.readFileSync("src/app/admin/page.tsx", "utf8"), /a\.sample && [\s\S]{0,200}SAMPLE DATA\./);
  const rows = analyticsCsvRows(a, { title: "T", periodLabel: "All time", generated: "2026-11-07" });
  assert.match(String(rows[0][0]), /^SAMPLE DATA\./);
  const real = analyticsCsvRows({ ...a, sample: false }, { title: "T", periodLabel: "All time", generated: "2026-11-07" });
  assert.doesNotMatch(JSON.stringify(real), /SAMPLE DATA/, "and real figures aren't");
});

test("sample figures obey the rules they are there to show: small groups hidden, unnamed, and rounded", () => {
  for (const p of listPeriods(NOW)) {
    const a = sampleAnalytics("Fictional", p, NOW);
    const json = JSON.stringify(a);
    assert.doesNotMatch(json, /Theology/, p.key);
    assert.ok(a.breakdowns.some((r) => r.hidden), p.key);
    for (const r of a.breakdowns) if (!r.hidden) for (const k of ["students", "completed", "usefulEdits", "repeatUse", "referred", "tracked", "interview", "offer"] as const) if (r[k] !== null) assert.equal(r[k]! % 5, 0, `${p.key} ${r.group} ${k}`);
  }
});

test("a file holds what the screen holds: hidden stays hidden, and nothing is added", () => {
  const a = sampleAnalytics("Fictional", all, NOW);
  const rows = analyticsCsvRows(a, { title: "T", periodLabel: "All time", generated: "2026-11-07" });
  const text = JSON.stringify(rows);
  for (const f of publishedFigures(a)) {
    const row = rows.find((r) => r[0] === f.name)!;
    assert.equal(row[1], f.value ?? "Hidden", f.name);
    assert.equal(row[5], f.definition, `${f.name} definition`);
    assert.equal(row[6], f.dateRange, `${f.name} dates`);
    assert.equal(row[7], f.exclusions, `${f.name} exclusions`);
  }
  assert.match(text, /Other groups, combined and not named/);
  assert.doesNotMatch(text, /Theology/);
  assert.match(text, /improved score is not evidence of employment/);
  assert.match(text, /may not represent all your students/);
});

test("a withheld period shows only what doesn't depend on it", () => {
  const a = { ...sampleAnalytics("Fictional", all, NOW), withheld: true, metrics: null, excluded: null, scores: null, breakdowns: [], needs: null };
  const rows = analyticsCsvRows(a, { title: "T", periodLabel: "x", generated: "x" });
  assert.equal(rows.find((r) => r[0] === "Completed reviews")![1], "Hidden");
  assert.equal(rows.find((r) => r[0] === "Average latest score")![1], "Hidden");
  assert.ok(rows.some((r) => r[0] === "Withheld"));
});

test("the date range says what it really covers: today is never in it", () => {
  const period = { key: "year-2025", from: "2025-09-01T00:00:00Z", to: "2026-09-01T00:00:00Z", through: "2026-09-01T00:00:00Z" };
  assert.match(dateRangeLabel(period), /1 September 2025 to 31 August 2026/);
  assert.match(dateRangeLabel({ key: "all", from: null, to: null, through: "2026-11-07T00:00:00Z" }), /The first record to 6 November 2026/);
  assert.match(dateRangeLabel({ key: "summer-2027", from: "2027-04-16T00:00:00Z", to: "2027-09-01T00:00:00Z", through: "2026-11-07T00:00:00Z" }), /hasn't started/);
});

test("no analytics module is imported by a scorer, so these figures can't reach a score", () => {
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : e.name.endsWith(".ts") ? [`${d}/${e.name}`] : []));
  for (const f of walk("src/lib/analysis")) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /lib\/analytics/, f);
  assert.equal(roundCount(7), 5);
});
