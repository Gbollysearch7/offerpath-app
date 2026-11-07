// The judge's answer is enums per bullet. Any other field a model adds is dropped by the real parser, so it can't reach a student.
import { provider, message } from "./fixtures/provider-stub";
import assert from "node:assert/strict";
import { test } from "node:test";
import { aiJudgeBullets } from "@/lib/ai";

test("the judge: words a model adds to its answer don't survive the parser", async () => {
  provider.reply = ({ model, bullets }) => message(model, JSON.stringify({ judgments: (bullets ?? []).map((b) => ({ id: b.id, result: "measured", verb: "strong", kind: "achievement", relevance: "high", why: "You worked at Google" })) }));
  const out = await aiJudgeBullets([{ id: 0, text: "Served 60 customers a day" }], "Technology", 1);
  assert.deepEqual(Object.keys(out.get(0)![0]).sort(), ["id", "kind", "relevance", "result", "verb"]);
  assert.ok(!JSON.stringify([...out.values()]).includes("Google"));
});
