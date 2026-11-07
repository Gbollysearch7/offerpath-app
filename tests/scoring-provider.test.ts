// OP-010: provider failure, through the real judge path (scoreCv -> aiJudgeBullets -> Anthropic SDK) and the real
// upload flow. Only `fetch` is replaced, so the provider is simulated and no request leaves this process.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test, beforeEach } from "node:test";
import { AI_JUDGE_MODEL } from "@/lib/analysis/judgment";
import { scoreFlow, uploadFlow } from "@/lib/cv-flow";
import { demoRepo } from "@/lib/repo/demo";
import type { CvReviewPayload } from "@/lib/types";

process.env.ANTHROPIC_API_KEY = "test-key-never-sent";
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "ALERT_WEBHOOK_URL"]) delete process.env[k];

type Reply = (bullets: { id: number; text: string }[], call: number) => Response;
let reply: Reply;
let calls = 0;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const message = (text: string, stop_reason = "end_turn") => json({ id: "msg_test", type: "message", role: "assistant", model: AI_JUDGE_MODEL, content: [{ type: "text", text }], stop_reason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
const allBest: Reply = (bullets) => message(JSON.stringify({ judgments: bullets.map((b) => ({ id: b.id, result: "measured", verb: "strong", kind: "achievement", relevance: "high" })) }));
const down: Reply = () => json({ type: "error", error: { type: "invalid_request_error", message: "simulated outage" } }, 400);

globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  assert.match(String(url), /anthropic/, "only the provider is simulated; nothing else should be fetched");
  const body = JSON.parse(String(init!.body)) as { messages: { content: string }[]; model: string };
  assert.equal(body.model, AI_JUDGE_MODEL, "the model called is the one in the cache key");
  const bullets = JSON.parse(body.messages[0].content.match(/<bullets>\n([\s\S]*)\n<\/bullets>/)![1]) as { id: number; text: string }[];
  return reply(bullets, calls++);
}) as typeof fetch;

const g = globalThis as unknown as { __offerpathJudgments?: Map<string, unknown> };
const bytes = new Uint8Array(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/extraction/single-column.pdf")));
const input = () => ({ bytes, fileName: "single-column.pdf", sector: "Technology", stage: "Final year, graduate roles", key: `t-${crypto.randomUUID()}` });
const student = () => demoRepo(`student-${crypto.randomUUID()}`, "student");
const cvCount = async (repo: ReturnType<typeof student>) => (await repo.listReports({ type: "cv_review" })).total;
const cached = () => g.__offerpathJudgments?.size ?? 0;

beforeEach(() => {
  g.__offerpathJudgments?.clear();
  calls = 0;
});

async function assertNoScore(name: string, failing: Reply) {
  reply = failing;
  const repo = student();
  const before = await cvCount(repo);
  const r = await uploadFlow(repo, input());
  assert.equal(r.kind, "error", `${name}: no score of any kind`);
  assert.match((r as { error: string }).error, /couldn't score your CV/, name);
  assert.equal(await cvCount(repo), before, `${name}: no report saved`);
  assert.equal(cached(), 0, `${name}: nothing published to the shared cache`);
  assert.ok(calls > 0, `${name}: the judge really was called`);
}

test("a full outage gives no score and no report: never full marks, never a rule-engine stand-in", () => assertNoScore("outage", down));
test("output that isn't valid JSON gives no score", () => assertNoScore("malformed", () => message("not json")));
test("output that breaks the schema gives no score", () => assertNoScore("schema", (b) => message(JSON.stringify({ judgments: b.map((x) => ({ id: x.id, result: "excellent", verb: "strong", kind: "achievement", relevance: "high" })) }))));
test("a refusal gives no score", () => assertNoScore("refusal", () => message("", "refusal")));
test("truncated output gives no score", () => assertNoScore("truncated", (b) => message(JSON.stringify({ judgments: b }).slice(0, 20), "max_tokens")));
test("a judge that skips a bullet gives no score", () => assertNoScore("skipped", (b) => allBest(b.slice(1), 0)));
test("one vote of three surviving gives no score: below the quorum nothing becomes permanent", () => assertNoScore("one vote", (b, call) => (call === 0 ? allBest(b, call) : down(b, call))));

test("two votes of three is a quorum: the report is saved, judged by the model", async () => {
  reply = (b, call) => (call === 0 ? down(b, call) : allBest(b, call));
  const repo = student();
  const r = await uploadFlow(repo, input());
  assert.equal(r.kind, "scored");
  const saved = await repo.getReport<CvReviewPayload>((r as { id: string }).id);
  assert.equal(saved!.payload.analysis.meta.method, "ai");
  assert.equal(saved!.payload.analysis.meta.scoring!.model, AI_JUDGE_MODEL);
  assert.ok(cached() > 0);
});

test("retry after an outage: the same version is scored once, by the judge, and repeating adds nothing", async () => {
  reply = down;
  const repo = student();
  const before = await cvCount(repo);
  const attempt = input();
  assert.equal((await uploadFlow(repo, attempt)).kind, "error");
  const sources = await repo.listSources();
  assert.equal(sources.length, 1, "the read file is kept, so the retry needs no new upload");
  assert.equal(sources[0].reportId, null);

  reply = allBest;
  const first = await scoreFlow(repo, sources[0].id, attempt.sector, attempt.stage);
  assert.ok("id" in first, JSON.stringify(first));
  assert.equal(await cvCount(repo), before + 1);
  const judged = calls;
  const again = await scoreFlow(repo, sources[0].id, attempt.sector, attempt.stage);
  assert.deepEqual(again, first, "a repeat returns the same report");
  assert.equal(calls, judged, "and calls nothing");
  const same = await uploadFlow(repo, attempt);
  assert.equal(same.kind, "scored", "resending the original attempt finds the same report");
  assert.equal(await cvCount(repo), before + 1);
  assert.equal((await repo.getReport<CvReviewPayload>((first as { id: string }).id))!.payload.analysis.meta.method, "ai");
});
