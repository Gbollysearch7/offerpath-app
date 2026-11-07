// The language change in src/lib/proofreading-flow.ts reads a CV report, checks it (which takes time) and writes the whole
// payload back. These tests put a saved line, from another tab, between that read and that write. No provider is involved.
import assert from "node:assert/strict";
import { test } from "node:test";
import { demoRepo } from "@/lib/repo/demo";
import { supabaseRepo } from "@/lib/repo/supabase";
import { type Repo } from "@/lib/repo/types";
import { languageFlow } from "@/lib/proofreading-flow";
import { acceptRewriteFlow } from "@/lib/rewrite-flow";
import { buildCvPayload } from "@/lib/services";
import { proofreadCv } from "@/lib/analysis/proofreading/run";
import { DEMO_CVS } from "@/lib/seed-data";
import type { CvReviewPayload } from "@/lib/types";
import { fakeSupabase } from "./fixtures/fake-supabase";

delete process.env.ANTHROPIC_API_KEY;

function repos(): { name: string; repo: Repo }[] {
  const fake = fakeSupabase();
  const s = supabaseRepo(fake.client, crypto.randomUUID(), () => fake.client);
  return [
    { name: "demo", repo: demoRepo(`student-${crypto.randomUUID()}`, "student") },
    { name: "supabase", repo: s },
  ];
}

async function report(repo: Repo) {
  const base = buildCvPayload({ fileName: "cv.pdf", text: DEMO_CVS[3].text, sector: "Technology", stage: "Final year" });
  const payload: CvReviewPayload = { ...base, proofreading: await proofreadCv(base.text, process.env, "en-GB") };
  const id = await repo.createReport({ type: "cv_review", title: "cv.pdf", score: payload.analysis.score, payload });
  return { id, payload };
}

/** A repository where something else happens at the moment the language flow is about to write. */
function interleaved(repo: Repo, between: () => Promise<void>): Repo {
  let done = false;
  return new Proxy(repo, {
    get(target, key, self) {
      if (key !== "recordProofreadingChoice") return Reflect.get(target, key, self);
      return async (...args: Parameters<Repo["recordProofreadingChoice"]>) => {
        const out = await target.recordProofreadingChoice(...args);
        if (!done) {
          done = true;
          await between();
        }
        return out;
      };
    },
  });
}

test("a language change can't overwrite a line saved in another tab", async () => {
  for (const { name, repo } of repos()) {
    const { id, payload } = await report(repo);
    const line = payload.analysis.lines[0];
    const r = await languageFlow(interleaved(repo, async () => {
      const out = await acceptRewriteFlow(repo, id, 0, line.text);
      assert.equal(out.error, undefined, `${name}: ${out.error}`);
    }), id, "en-US");
    assert.deepEqual(r, {}, name);
    const after = (await repo.getReport<CvReviewPayload>(id))!.payload;
    assert.equal(after.analysis.lines[0].accepted, line.text, `${name}: the saved line survives`);
    assert.equal(after.proofreading!.language, "en-US", `${name}: and so does the language change`);
  }
});

test("a line saved after the language change is read keeps both, and the score stays out of it", async () => {
  for (const { name, repo } of repos()) {
    const { id } = await report(repo);
    const before = await repo.getReport<CvReviewPayload>(id);
    const r = await languageFlow(repo, id, "en-US");
    assert.deepEqual(r, {}, name);
    const after = await repo.getReport<CvReviewPayload>(id);
    assert.equal(after!.row.score, before!.row.score, name);
    assert.deepEqual(after!.payload.analysis, before!.payload.analysis, `${name}: the analysis isn't touched`);
    assert.equal(after!.payload.editRevision, (before!.payload.editRevision ?? 0) + 1, `${name}: the write moves the revision, so a writer holding the old one is refused`);
  }
});

test("a writer that always loses the race gets an honest error and changes nothing of the other writer's", async () => {
  for (const { name, repo } of repos()) {
    const { id, payload } = await report(repo);
    const line = payload.analysis.lines[0];
    // Something saves again every time the flow is about to write.
    const noisy = new Proxy(repo, {
      get(target, key, self) {
        if (key !== "updateReport") return Reflect.get(target, key, self);
        return async (...args: Parameters<Repo["updateReport"]>) => {
          const now = (await target.getReport<CvReviewPayload>(id))!.payload;
          await target.updateReport(id, { payload: { ...now, editRevision: (now.editRevision ?? 0) + 1, analysis: { ...now.analysis, lines: now.analysis.lines.map((l, i) => (i === 0 ? { ...l, accepted: line.text } : l)) } } }, { ifRevision: now.editRevision ?? null });
          return target.updateReport(...args);
        };
      },
    });
    const r = await languageFlow(noisy, id, "en-US");
    assert.match(r.error ?? "", /another tab/, name);
    const after = (await repo.getReport<CvReviewPayload>(id))!.payload;
    assert.equal(after.analysis.lines[0].accepted, line.text, name);
    assert.equal(after.proofreading!.language, "en-GB", `${name}: the results stay as they were`);
  }
});
