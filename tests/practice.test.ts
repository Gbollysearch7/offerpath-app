import assert from "node:assert/strict";
import { test } from "node:test";
import { SECTOR_KEYWORDS } from "@/lib/analysis/lexicon";
import { APTITUDE_SETS, INTERVIEW_SECTORS, interviewQuestions, ROADMAPS, starFeedback } from "@/lib/practice";

test("practice sectors are real sectors", () => {
  for (const s of [...INTERVIEW_SECTORS, ...Object.keys(ROADMAPS)]) assert.ok(s in SECTOR_KEYWORDS, s);
});

test("question ids are unique and unknown sectors fall back to general", () => {
  for (const s of [...INTERVIEW_SECTORS, ""]) {
    const ids = interviewQuestions(s).map((q) => q.id);
    assert.equal(new Set(ids).size, ids.length);
  }
  assert.equal(interviewQuestions("Nope").length, interviewQuestions("").length);
});

test("every aptitude answer points at a real option", () => {
  for (const set of Object.values(APTITUDE_SETS))
    for (const q of set.questions) {
      assert.ok(q.answer >= 0 && q.answer < q.options.length, q.id);
      assert.equal(new Set(q.options).size, q.options.length, q.id);
    }
});

test("roadmaps cover every stage in order", () => {
  for (const [s, m] of Object.entries(ROADMAPS)) assert.deepEqual(m.steps.map((x) => x.stage), ["first", "penultimate", "final", "graduate"], s);
});

test("STAR feedback rewards a structured answer and is deterministic", () => {
  const weak = "We did a project and it went well.";
  const strong =
    "During my second year I was treasurer of the Finance Society, and our membership had fallen by 30% because events clashed with exams. " +
    "I analysed attendance from the previous two years and I suggested moving our main events to the first four weeks of each term. " +
    "I organised a mentoring scheme with 12 alumni and I wrote to three City firms to sponsor it. " +
    "I planned the budget so that each event cost under £200, and I asked first-year reps to promote it in lectures. " +
    "As a result membership grew from 120 to 310 in one year and we secured £2,500 in new sponsorship. " +
    "I learned that small changes to timing can matter more than spending more money, and I now check data before proposing a change.";
  const a = starFeedback(weak, "competency");
  const b = starFeedback(strong, "competency");
  assert.ok(b.score > a.score);
  assert.ok(b.score >= 9, JSON.stringify(b.points));
  assert.deepEqual(starFeedback(strong, "competency"), b);
});
