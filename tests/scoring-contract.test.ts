// OP-010: what a score means is versioned, simultaneous first analyses publish one answer, the same content scores
// the same for everyone under a version, unassessed work never reads as a result, and a rule change never reads as
// a student improving. tests/scoring-provider.test.ts covers provider failure through the real judge path.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { JUDGE_SYSTEM } from "@/lib/ai";
import { comparableHistory, presentedScore, scoreContext, scoreCoverage, WITHHOLD_BELOW } from "@/lib/analysis/coverage";
import { analyseCv, cvBullets, findCheck } from "@/lib/analysis/cv";
import { bulletKey, NORMALISER_VERSION, normaliseText, sha256 } from "@/lib/analysis/fingerprint";
import { AI_JUDGE_CONFIG, AI_JUDGE_MODEL, coreKey, JUDGE_PROMPT_VERSION, relevanceKey, type BulletJudgment } from "@/lib/analysis/judgment";
import * as lexicon from "@/lib/analysis/lexicon";
import { parseCv, PARSER_VERSION } from "@/lib/analysis/parse";
import { AREA_WEIGHTS, BAND_THRESHOLDS, LINE_PENALTIES, RUBRIC_VERSION, TARGETS } from "@/lib/analysis/rubric";
import { comparableScores, FIRST_RECORDED, scoreSeries, scoringIdentity, seriesFields } from "@/lib/analysis/scoring-contract";
import { demoRepo } from "@/lib/repo/demo";
import { supabaseRepo } from "@/lib/repo/supabase";
import { fromStored, toStored } from "@/lib/report-schema";
import { memoryStore, scoreCvWith, type JudgeFn, type JudgmentStore, type StoredJudgment } from "@/lib/scoring-core";
import { DEMO_CVS } from "@/lib/seed-data";
import { buildCvPayload, withInstitutionalGuidance } from "@/lib/services";
import type { CvReviewPayload } from "@/lib/types";
import { AUDIT_CLEAN_CV, AUDIT_MISSPELLED_CV } from "./fixtures/audit";
import { fakeSupabase } from "./fixtures/fake-supabase";

delete process.env.ANTHROPIC_API_KEY;

const SECTOR = "Finance and banking";
const cv = DEMO_CVS[3].text;
const BEST: BulletJudgment = { result: "measured", verb: "strong", kind: "achievement", relevance: "high" };
const WORST: BulletJudgment = { result: "none", verb: "ok", kind: "achievement", relevance: "none" };
const judgeWith = (j: BulletJudgment, votes = 3): JudgeFn => async (bullets) => new Map(bullets.map((b) => [b.id, Array.from({ length: votes }, () => j)]));
const ai = (store: JudgmentStore, judge: JudgeFn, extra = {}) => ({ method: "ai" as const, store, judge, judgeName: "test", ...extra });
/** Everything in an analysis that makes up the common score, leaving out sector fit (which carries no weight). */
const common = (a: ReturnType<typeof analyseCv>) => ({
  score: a.score,
  areas: a.areas.filter((x) => x.key !== "sector").map((x) => [x.key, x.score, x.checks.map((c) => [c.key, c.score, c.affected])]),
  lines: a.lines.map((l) => l.score),
  core: a.meta.judgments!.map(({ result, verb, kind }) => ({ result, verb, kind })),
  fingerprint: a.meta.scoring!.coreFingerprint,
});

/* ---------- the version contract ---------- */

const hashOf = (x: unknown) => sha256(JSON.stringify(x, (_, v) => (v instanceof RegExp ? String(v) : v instanceof Set ? [...v] : typeof v === "function" ? String(v) : v)));
const NUMERIC_CVS = [AUDIT_CLEAN_CV, AUDIT_MISSPELLED_CV, ...DEMO_CVS.map((c) => c.text)];

/**
 * What each current version covers. Changing what's covered without bumping the version fails here. If you bumped on
 * purpose, add the new version's hash and leave the old one: this table is the record of what each version meant.
 */
const FROZEN = {
  rubric: { "rubric-2026-10-30.1": "f34340ce04ba7882a042a6b0be3b8f17902c209bbb95372737bdebb24ea05503" } as Record<string, string>,
  lexicon: { "lexicon-2026-11-05.1": "4688a58b5b769d3ed00f04380be840f772c5e3626cfdaca73a0399b1cd6ebdd3", "lexicon-2026-11-07.1": "5c9b5d6e7beb624db644c39a9ae6977c5023aae3b64fb29174aef0aeb97008ac" } as Record<string, string>,
  normaliser: { "normaliser-2026-11-06.1": "1d5f0d9eb94d68a761d2e9ba05d174e723017a24ccfe4af3ea8526d934907d9e" } as Record<string, string>,
  // Unchanged by the 2026-11-07 bump because these CVs contain nothing it fixed. tests/extract.test.ts covers what it did change.
  parser: { "parser-2026-11-05.1": "a1c6a1c08360d31b0234d15c29e4cdc363294c46493b70fafe85b4fa9ea01472", "parser-2026-11-07.1": "a1c6a1c08360d31b0234d15c29e4cdc363294c46493b70fafe85b4fa9ea01472" } as Record<string, string>,
  judge: { "judge-prompt-2026-11-06.1": { hash: "8abb33e4c2a516dba361a69bc144b7e5f4f12b336ee09069da5aedf16700f008", rubric: "rubric-2026-10-30.1" } } as Record<string, { hash: string; rubric: string }>,
  scores: {
    "rubric-2026-10-30.1|parser-2026-11-05.1|lexicon-2026-11-05.1|normaliser-2026-11-06.1": "6e4485923b0aaebc8664d95ebff93640af14ec85729b57878b8b038abc1dbaad",
    "rubric-2026-10-30.1|parser-2026-11-07.1|lexicon-2026-11-07.1|normaliser-2026-11-06.1": "6e4485923b0aaebc8664d95ebff93640af14ec85729b57878b8b038abc1dbaad",
  } as Record<string, string>,
};
const NORMALISER_VECTORS = ["  •  Led a team\r\nof 5 — “well”  ", "– Cut costs by 10%", "Résumé ﬁle​", "HELPED   With  Things.", "a\n\n\nb", "› Grew sales £1,000 + 20%"];

test("each version still means what it meant: a change without a bump fails here", () => {
  const help = (what: string, file: string) => `${what} changed without a version bump. Bump it in ${file} (a new scoring series starts) and add the new hash here, or undo the change.`;
  assert.equal(hashOf({ AREA_WEIGHTS, LINE_PENALTIES, TARGETS, BAND_THRESHOLDS }), FROZEN.rubric[RUBRIC_VERSION], help("A rubric value", "rubric.ts"));
  assert.equal(hashOf(lexicon), FROZEN.lexicon[lexicon.LEXICON_VERSION], help("A word list", "lexicon.ts"));
  assert.equal(hashOf(NORMALISER_VECTORS.map((v) => [normaliseText(v), bulletKey(v)])), FROZEN.normaliser[NORMALISER_VERSION], help("Normalisation", "fingerprint.ts"));
  const cut = NUMERIC_CVS.map((t) => { const p = parseCv(normaliseText(t)); return { sections: p.sections, words: p.words, bullets: p.bullets.map((b) => [b.section, b.role, b.text]) }; });
  assert.equal(hashOf(cut), FROZEN.parser[PARSER_VERSION], help("Parsing", "parse.ts"));
  const judge = FROZEN.judge[JUDGE_PROMPT_VERSION];
  assert.equal(hashOf({ JUDGE_SYSTEM, AI_JUDGE_CONFIG }), judge?.hash, help("The judge prompt or configuration", "judgment.ts"));
  assert.equal(RUBRIC_VERSION, judge.rubric, "A new judge prompt needs a new RUBRIC_VERSION: the cache key holds only the rubric and the model, so otherwise it would read the old prompt's verdicts.");
});

test("the numbers on the fixtures are the ones this contract froze", () => {
  const key = [RUBRIC_VERSION, PARSER_VERSION, lexicon.LEXICON_VERSION, NORMALISER_VERSION].join("|");
  const numbers = NUMERIC_CVS.map((t) => { const a = analyseCv(t, SECTOR); return { score: a.score, areas: a.areas.map((x) => [x.key, x.score, x.checks.map((c) => [c.key, c.score, c.affected])]), lines: a.lines.map((l) => l.score) }; });
  assert.equal(hashOf(numbers), FROZEN.scores[key], "A score moved under an unchanged version.");
});

test("cache keys are the ones already in the shared cache, so no existing verdict is orphaned", () => {
  const t = "Led a team of 5 to cut costs by 10%";
  assert.equal(coreKey(t), sha256([RUBRIC_VERSION, AI_JUDGE_MODEL, "core", bulletKey(t)].join("\u0000")));
  assert.equal(relevanceKey(t, "Technology"), sha256([RUBRIC_VERSION, AI_JUDGE_MODEL, "relevance", "technology", bulletKey(t)].join("\u0000")));
  assert.equal(coreKey(t, "rubric-next") === coreKey(t), false, "a rubric bump changes every key");
});

test("every report records the versions it was scored under, and they round-trip through both repositories", async () => {
  const rules = analyseCv(cv, SECTOR);
  assert.deepEqual(
    { ...rules.meta.scoring, coreFingerprint: "" },
    { method: "rules", rubric: RUBRIC_VERSION, parser: PARSER_VERSION, lexicon: lexicon.LEXICON_VERSION, normaliser: NORMALISER_VERSION, judgePrompt: null, model: null, identity: `rules|${RUBRIC_VERSION}|${PARSER_VERSION}|${lexicon.LEXICON_VERSION}|${NORMALISER_VERSION}|-|-`, coreFingerprint: "" },
  );
  const judged = await scoreCvWith(cv, SECTOR, ai(memoryStore(), judgeWith(BEST)));
  assert.equal(judged.analysis.meta.scoring!.model, AI_JUDGE_MODEL);
  assert.equal(judged.analysis.meta.scoring!.judgePrompt, JUDGE_PROMPT_VERSION);
  assert.notEqual(judged.analysis.meta.scoring!.identity, rules.meta.scoring!.identity, "AI and rule scores are different series");

  assert.deepEqual(FIRST_RECORDED, { normaliser: NORMALISER_VERSION, judgePrompt: JUDGE_PROMPT_VERSION }, "OP-010 named these without changing them; once either is bumped, delete this line and keep FIRST_RECORDED as it is");

  const fake = fakeSupabase();
  const uid = crypto.randomUUID();
  for (const repo of [demoRepo(`student-${crypto.randomUUID()}`, "student"), supabaseRepo(fake.client, uid, () => fake.client)]) {
    const payload = buildCvPayload({ fileName: "cv.pdf", text: cv, sector: SECTOR, stage: "Final year, graduate roles", analysis: judged.analysis });
    const id = await repo.createReport({ type: "cv_review", title: "cv.pdf", score: payload.analysis.score, payload });
    assert.deepEqual((await repo.getReport<CvReviewPayload>(id))!.payload.analysis.meta.scoring, judged.analysis.meta.scoring);
    const row = (await repo.listReports({ type: "cv_review" })).rows.find((r) => r.id === id)!;
    assert.deepEqual(row.scoring, { series: judged.analysis.meta.scoring!.identity, coverage: "complete" });
  }
});

test("the normaliser's contract: idempotent, and formatting noise never reaches the score", () => {
  for (const v of NORMALISER_VECTORS) assert.equal(normaliseText(normaliseText(v)), normaliseText(v), v);
  const noisy = cv.replace(/\n/g, "\r\n").replace(/•/g, "●").replace(/-/g, "–");
  assert.equal(normaliseText(noisy), normaliseText(cv));
  assert.equal(analyseCv(noisy, SECTOR).score, analyseCv(cv, SECTOR).score);
  assert.equal(analyseCv(noisy, SECTOR).meta.scoring!.coreFingerprint, analyseCv(cv, SECTOR).meta.scoring!.coreFingerprint);
});

/* ---------- simultaneous first analyses ---------- */

/** A store where every attempt reads "nothing stored" before any attempt is allowed to write: the worst interleaving. */
function racingStore(attempts: number) {
  const map = new Map<string, StoredJudgment>();
  const inner = memoryStore(map);
  let arrived = 0;
  let open!: () => void;
  const allRead = new Promise<void>((r) => (open = r));
  let n = 0;
  const store: JudgmentStore = {
    async get(keys) {
      const me = n++;
      const seen = await inner.get(keys);
      if (me < attempts) {
        if (++arrived === attempts) open();
        await allRead;
      }
      return seen;
    },
    putIfAbsent: (e) => inner.putIfAbsent(e),
  };
  return { store, map };
}

test("simultaneous first analyses that judged differently all publish and report one answer", async () => {
  const N = 8;
  const { store, map } = racingStore(N);
  let judged = 0;
  const sectors = ["Finance and banking", "Technology", "Consulting", "Marketing and media"];
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      scoreCvWith(cv, sectors[i % sectors.length], ai(store, async (bullets, s) => {
        judged++;
        return judgeWith(i % 2 ? WORST : BEST)(bullets, s);
      })),
    ),
  );
  assert.equal(judged, N, "every attempt really did judge: all of them read an empty cache");
  for (const r of results) assert.deepEqual(common(r.analysis), common(results[0].analysis), "one canonical answer, whichever attempt won");
  const bulletsN = new Set(cvBullets(cv).map((b) => coreKey(b.text))).size;
  assert.equal([...map.keys()].filter((k) => cvBullets(cv).some((b) => coreKey(b.text) === k)).length, bulletsN, "one stored verdict per bullet");
  // A later attempt with yet another judge reads the same answer and judges nothing.
  const late = await scoreCvWith(cv, sectors[0], ai(store, judgeWith(WORST)));
  assert.equal(late.judgedNow, 0);
  assert.deepEqual(common(late.analysis), common(results[0].analysis));
});

test("one attempt failing mid-race neither blocks the others nor leaves anything of its own behind", async () => {
  const { store, map } = racingStore(3);
  const results = await Promise.allSettled([
    scoreCvWith(cv, SECTOR, ai(store, async () => { throw new Error("provider down"); })),
    scoreCvWith(cv, SECTOR, ai(store, judgeWith(BEST))),
    scoreCvWith(cv, SECTOR, ai(store, judgeWith(BEST))),
  ]);
  assert.equal(results[0].status, "rejected");
  assert.ok(results[1].status === "fulfilled" && results[2].status === "fulfilled");
  assert.deepEqual(common(results[1].value.analysis), common(results[2].value.analysis));
  assert.ok(map.size > 0);
  const retry = await scoreCvWith(cv, SECTOR, ai(store, async () => { throw new Error("must not be called"); }));
  assert.deepEqual(common(retry.analysis), common(results[1].value.analysis), "the retry reads what the others published and needs no provider");
});

/* ---------- retry semantics ---------- */

test("a verdict needs a quorum of votes; below it nothing is published and a later retry judges afresh", async () => {
  const map = new Map<string, StoredJudgment>();
  const store = memoryStore(map);
  const q = { quorum: AI_JUDGE_CONFIG.quorum };
  assert.equal(AI_JUDGE_CONFIG.quorum, 2);
  await assert.rejects(scoreCvWith(cv, SECTOR, ai(store, judgeWith(WORST, 1), q)), /Only 1 valid/);
  assert.equal(map.size, 0, "one surviving vote never becomes the permanent answer");
  // One bullet short of a quorum sinks the whole attempt: a report is never built from part of a CV.
  const partial: JudgeFn = async (bullets) => new Map(bullets.map((b, i) => [b.id, i === 0 ? [BEST] : [BEST, BEST, BEST]]));
  await assert.rejects(scoreCvWith(cv, SECTOR, ai(store, partial, q)));
  assert.equal(map.size, 0, "attempts are all or nothing");
  // Malformed votes don't count towards it.
  const junk: JudgeFn = async (bullets) => new Map(bullets.map((b) => [b.id, [BEST, { result: "excellent" } as unknown as BulletJudgment, { result: "measured", verb: "strong" } as unknown as BulletJudgment]]));
  await assert.rejects(scoreCvWith(cv, SECTOR, ai(store, junk, q)));
  assert.equal(map.size, 0);
  const ok = await scoreCvWith(cv, SECTOR, ai(store, judgeWith(BEST, 2), q));
  assert.equal(ok.analysis.meta.method, "ai");
  assert.ok(map.size > 0);
});

test("a store failure publishes nothing and yields no score", async () => {
  const failing: JudgmentStore = { get: async () => new Map(), putIfAbsent: async () => { throw new Error("database down"); } };
  await assert.rejects(scoreCvWith(cv, SECTOR, ai(failing, judgeWith(BEST))));
});

test("no bullets: no judge ran, and the result says so instead of claiming AI", async () => {
  let called = false;
  const text = "Alex Example\nalex@example.com\n\nEDUCATION\nBSc Economics\n\nSKILLS\nExcel";
  const r = await scoreCvWith(text, SECTOR, ai(memoryStore(), async () => { called = true; return new Map(); }));
  assert.equal(called, false);
  assert.equal(r.method, "rules");
  assert.equal(r.analysis.meta.method, "rules");
});

/* ---------- invariance across account, sector and institution ---------- */

test("the scoring path takes no account or institution: the same content scores the same for everyone", async () => {
  // Nothing in the scoring modules can read who is asking.
  for (const f of ["src/lib/scoring.ts", "src/lib/scoring-core.ts", "src/lib/analysis/cv.ts", "src/lib/analysis/judgment.ts", "src/lib/analysis/scoring-contract.ts"]) {
    const source = fs.readFileSync(path.join(process.cwd(), f), "utf8");
    assert.doesNotMatch(source, /from "@\/lib\/(session|repo)|profile|universityId|institution_id/i, `${f} must not see the student`);
  }
  const store = memoryStore();
  const base = await scoreCvWith(cv, SECTOR, ai(store, judgeWith(BEST)));
  for (const sector of ["Technology", "Consulting", "Retail and FMCG", "Charity and NGO"]) {
    const other = await scoreCvWith(cv, sector, ai(store, judgeWith(WORST)));
    assert.deepEqual(common(other.analysis), common(base.analysis), sector);
  }
});

test("through the real flow: two accounts at two institutions with one CV get one score, on both repositories", async () => {
  const { uploadFlow } = await import("@/lib/cv-flow");
  const bytes = new Uint8Array(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/extraction/single-column.pdf")));
  const fake = fakeSupabase();
  const repos = [demoRepo(`student-${crypto.randomUUID()}`, "student"), demoRepo(`student-${crypto.randomUUID()}`, "student"), supabaseRepo(fake.client, crypto.randomUUID(), () => fake.client)];
  await repos[1].updateProfile({ universityId: "another-institution" } as never);
  const seen = [];
  for (const [i, repo] of repos.entries()) {
    const up = await uploadFlow(repo, { bytes, fileName: "single-column.pdf", sector: i ? "Technology" : "Consulting", stage: "Final year, graduate roles", key: `t-${crypto.randomUUID()}` });
    assert.equal(up.kind, "scored");
    const r = await repo.getReport<CvReviewPayload>((up as { id: string }).id);
    seen.push(r!.payload.analysis);
  }
  for (const a of seen) {
    assert.equal(a.score, seen[0].score);
    assert.equal(a.meta.scoring!.coreFingerprint, seen[0].meta.scoring!.coreFingerprint);
  }
});

test("institutional guidance sits beside the common score: it cannot move it and it is not part of the analysis", () => {
  const payload = buildCvPayload({ fileName: "cv.pdf", text: cv, sector: SECTOR, stage: "Final year, graduate roles" });
  const before = JSON.stringify({ analysis: payload.analysis, assessment: payload.assessment });
  const guided = withInstitutionalGuidance(payload, { kind: "institutional_guidance", label: "Northfield Careers", institutionId: "uni-1", version: "2026-27", notes: [{ title: "Placement year", text: "List your placement above part-time work." }] });
  assert.equal(JSON.stringify({ analysis: guided.analysis, assessment: guided.assessment }), before);
  const round = fromStored("cv_review", toStored("cv_review", guided)) as CvReviewPayload;
  assert.equal(round.institutionalGuidance!.label, "Northfield Careers");
  assert.equal(round.analysis.score, payload.analysis.score);
  assert.throws(() => toStored("cv_review", { ...guided, institutionalGuidance: { ...guided.institutionalGuidance, score: 90 } }), "guidance has no score field to carry a second number in");
  assert.throws(() => toStored("cv_review", { ...payload, analysis: { ...payload.analysis, meta: { ...payload.analysis.meta, institution: "uni-1" } } }), "the analysis has nowhere to put an institution");
});

/* ---------- version path and historical comparison ---------- */

test("correcting a cached verdict: a version change judges afresh, keeps the old verdict and report, and is not compared", async () => {
  const map = new Map<string, StoredJudgment>();
  const store = memoryStore(map);
  const wrong = await scoreCvWith(cv, SECTOR, ai(store, judgeWith(WORST)));
  const oldReport = buildCvPayload({ fileName: "cv.pdf", text: cv, sector: SECTOR, stage: "Final year, graduate roles", analysis: wrong.analysis });
  const savedBytes = JSON.stringify(toStored("cv_review", oldReport));
  const oldRows = new Map(map);

  // Same version: a better judge can't overwrite it.
  const again = await scoreCvWith(cv, SECTOR, ai(store, judgeWith(BEST)));
  assert.equal(again.analysis.score, wrong.analysis.score);

  // New version: new keys, fresh verdicts.
  const NEXT = "rubric-next";
  const fixed = await scoreCvWith(cv, SECTOR, ai(store, judgeWith(BEST), { rubric: NEXT }));
  assert.ok(fixed.judgedNow > 0);
  assert.ok(fixed.analysis.score > wrong.analysis.score);
  for (const [k, v] of oldRows) assert.deepEqual(map.get(k), v, "the old verdicts are still there under their old keys");
  assert.ok(map.size > oldRows.size);
  assert.equal(JSON.stringify(fromStored("cv_review", JSON.parse(savedBytes))), savedBytes, "the old report reads back byte for byte");

  // (The rubric constant can't change in a test, so the newer report's record says what a real bump would write.)
  const record = fixed.analysis.meta.scoring!;
  const bumped = { ...record, rubric: NEXT, identity: scoringIdentity({ ...record, rubric: NEXT }) };
  assert.equal(comparableScores(wrong.analysis.meta.scoring!.identity, bumped.identity), false, "the fix can't read as the student improving");
});

test("each component's bump, and a change of method, starts a new series", () => {
  const r = analyseCv(cv, SECTOR).meta.scoring!;
  for (const change of [{ rubric: "x" }, { parser: "x" }, { lexicon: "x" }, { normaliser: "x" }, { judgePrompt: "x" }, { model: "x" }, { method: "ai" as const }]) {
    assert.notEqual(scoringIdentity({ ...r, ...change }), r.identity, JSON.stringify(change));
  }
});

test("saved scores are never recomputed: a report under old rules keeps every number after the rules move on", async () => {
  const payload = buildCvPayload({ fileName: "cv.pdf", text: cv, sector: SECTOR, stage: "Final year, graduate roles" });
  const old: CvReviewPayload = structuredClone(payload);
  old.analysis.score = 12;
  old.analysis.meta.rubric = "rubric-older";
  old.analysis.meta.scoring = { ...old.analysis.meta.scoring!, rubric: "rubric-older", identity: "rules|rubric-older|p|l|n|-|-" };
  const fake = fakeSupabase();
  for (const repo of [demoRepo(`student-${crypto.randomUUID()}`, "student"), supabaseRepo(fake.client, crypto.randomUUID(), () => fake.client)]) {
    const id = await repo.createReport({ type: "cv_review", title: "old.pdf", score: 12, payload: old });
    const got = await repo.getReport<CvReviewPayload>(id);
    assert.equal(got!.row.score, 12);
    assert.equal(JSON.stringify(got!.payload.analysis), JSON.stringify(old.analysis));
    const row = (await repo.listReports({ type: "cv_review" })).rows.find((r) => r.id === id)!;
    assert.equal(row.score, 12);
    assert.equal(row.scoring!.series, "rules|rubric-older|p|l|n|-|-");
  }
});

test("history only compares a score with its own series", () => {
  const row = (id: string, score: number | null, series: string | null, day: number) => ({ id, score, createdAt: `2026-11-0${day}T00:00:00Z`, scoring: { series } });
  const rows = [row("a", 40, "v1", 1), row("b", 80, "v2", 2), row("c", 60, null, 3), row("d", 90, "v2", 4), row("e", null, "v2", 5), row("f", 95, "v2", 6)];
  const d = comparableHistory(rows, "d", "v2");
  assert.deepEqual(d.rows.map((r) => r.id), ["b", "d"], "later reviews and other series are out");
  assert.equal(d.setAside, 2);
  // A report outside any series has nothing to compare with, not even another outside one.
  assert.deepEqual(comparableHistory(rows, "c", null).rows.map((r) => r.id), ["c"]);
  assert.equal(comparableHistory([row("x", 50, "v1", 1)], "x", "v1").setAside, 0, "a first review sets nothing aside");
  assert.equal(comparableScores(null, null), false, "two unknowns are not compatible");
  assert.equal(comparableScores("v1", "v1"), true);
});

test("the demo seed's history: the v0 report is set aside, the rest compare, and the stored scores don't move", async () => {
  const repo = demoRepo(`student-${crypto.randomUUID()}`, "student");
  const rows = (await repo.listReports({ type: "cv_review" })).rows;
  const oldest = rows[rows.length - 1];
  const newest = rows[0];
  assert.equal(oldest.scoring!.series, null, "v0 shape: no parser recorded");
  assert.ok(newest.scoring!.series);
  const h = comparableHistory(rows, newest.id, newest.scoring!.series);
  assert.equal(h.setAside, 1);
  assert.equal(h.rows.length, rows.length - 1);
  assert.equal(oldest.score, analyseCv(DEMO_CVS[0].text, SECTOR).score);
});

test("TypeScript gives the same series as the migration's expected answers", () => {
  const { cases } = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/score-series-cases.json"), "utf8")) as { cases: { name: string; payload: unknown; series: string | null }[] };
  assert.ok(cases.length >= 9);
  for (const c of cases) assert.equal(scoreSeries(seriesFields(c.payload)), c.series, c.name);
});

test("a report saved between OP-004 and OP-010 stays comparable with a new one, because every part matches", () => {
  const now = buildCvPayload({ fileName: "cv.pdf", text: cv, sector: SECTOR, stage: "Final year, graduate roles" });
  const before = structuredClone(now);
  delete before.analysis.meta.scoring;
  assert.equal(scoreSeries(seriesFields(before)), scoreSeries(seriesFields(now)));
});

/* ---------- coverage ---------- */

const NO_BULLETS = "Alex Example\nalex@example.com · 07700 900123\n\nEDUCATION\nBSc Economics, University of Northfield\n\nSKILLS\nExcel, SQL, Python";

test("coverage: a CV with no bullets has too little assessed to give a total, and the total is not rescaled", () => {
  const a = analyseCv(NO_BULLETS, SECTOR);
  const c = scoreCoverage({ bullets: a.meta.bullets, band: null });
  assert.equal(c.status, "withheld");
  assert.ok(c.assessedShare < WITHHOLD_BELOW, `${c.assessedShare}`);
  assert.equal(c.assessedShare, 0.389);
  for (const k of c.notAssessed) assert.equal(findCheck(a, k)!.score, 0, `${k} is scored 0, not credited`);
  assert.ok(a.score < 50, "the stored number stays a low unrescaled one");
  assert.equal(presentedScore({ score: a.score, scoring: scoreContext(seriesFields({ analysis: a })) }), null, "lists don't present it as a score");
  assert.equal(findCheck(a, "repeat")!.score, 0, "repetition can't pass by default");
});

test("coverage: a low-confidence reading is marked incomplete and not compared; anything else is complete", () => {
  assert.equal(scoreCoverage({ bullets: 12, band: "low" }).status, "incomplete");
  assert.equal(scoreCoverage({ bullets: 12, band: "low" }).readingLimited, true);
  assert.equal(scoreCoverage({ bullets: 12, band: "medium" }).status, "complete");
  assert.equal(scoreCoverage({ bullets: 12, band: null }).status, "complete");
  assert.equal(scoreCoverage({ bullets: 12, band: "high" }).assessedShare, 1);
  assert.equal(presentedScore({ score: 44, scoring: { coverage: "incomplete" } }), 44);
  assert.equal(scoreSeries({ ...seriesFields({}), identity: "x", bullets: 12, band: "low" }), null);
});
