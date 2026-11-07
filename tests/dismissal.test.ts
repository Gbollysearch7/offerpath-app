// OP-008: a student can set a proofreading suggestion aside on one document, reopen it, and choose which English to
// check against. Every contract test runs on both repositories (the Supabase one over the in-memory fake; row-level
// security itself is in supabase/tests). Action and route tests run the real handlers in demo mode with two sessions.
import "./fixtures/next-server-shim";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import JSZip from "jszip";
import { deleteAccount } from "@/app/actions/account";
import { dismissFinding, reopenFinding, setProofreadingLanguage } from "@/app/actions/proofreading";
import { GET as myExport } from "@/app/api/export/route";
import { ChoiceNotFoundError, describeChoice, dismissedIds, splitFindings } from "@/lib/analysis/proofreading/choices";
import { localProvider } from "@/lib/analysis/proofreading/local";
import { proofreadCv, runProofreading } from "@/lib/analysis/proofreading/run";
import { OFFICIAL_NAMES, TERMINOLOGY, TERMINOLOGY_REVIEW } from "@/lib/analysis/proofreading/terminology";
import { possibleMistakes, proofreadingHeadline, proofreadingSummary, regionalExplanation, unrecognisedWords } from "@/lib/analysis/proofreading/view";
import { STAGES } from "@/lib/analysis/lexicon";
import { pasteFlow } from "@/lib/cv-flow";
import { signDemoSession } from "@/lib/demo-session";
import { dismissFlow, languageFlow, NOT_FOUND, reopenFlow } from "@/lib/proofreading-flow";
import { TOO_MANY } from "@/lib/rate-limit";
import { demoRepo } from "@/lib/repo/demo";
import { supabaseRepo } from "@/lib/repo/supabase";
import type { Repo } from "@/lib/repo/types";
import { DEMO_COOKIE } from "@/lib/session";
import type { CvReviewPayload } from "@/lib/types";
import { fakeSupabase } from "./fixtures/fake-supabase";
import { redirectOf, requestScope, withEnv } from "./fixtures/request-scope";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.PROOFREADING_LANGUAGE;
delete process.env.PROOFREADING_PROVIDER;

const DEMO = { NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", DEMO_MODE: undefined, VERCEL_ENV: undefined, NODE_ENV: "development" };
const TYPO = "spelling:likely-misspelling:custmer";
const UNKNOWN = "spelling:unrecognised-word:metronidazole";
const COLOR = "regional:other-variant:color";

// Synthetic. One likely typo, one correct specialist word, and US spellings that are valid English.
const CV = [
  "Alex Example",
  "alex@example.com 07700 900123",
  "EDUCATION",
  "Example University 2023 - 2026",
  "BSc Computing",
  "EXPERIENCE",
  "Analyst | Example Ltd | 2025 - Present",
  "• Managed custmer relationships and improved team reporting accuracy by 20%.",
  "• Reviewed the color of labor data with senior colleagues across the whole team.",
  "• Prepared summary notes about metronidazole for 12 colleagues on the ward.",
  "SKILLS",
  "Excel SQL Python Communication",
].join("\n");

function pairs(): { name: string; a: Repo; b: Repo; again: () => Repo; fake?: ReturnType<typeof fakeSupabase>; ua?: string }[] {
  const fake = fakeSupabase();
  const [ua, ub] = [crypto.randomUUID(), crypto.randomUUID()];
  const [da, db] = [`student-${crypto.randomUUID()}`, `student-${crypto.randomUUID()}`];
  return [
    { name: "demo", a: demoRepo(da, "student"), b: demoRepo(db, "student"), again: () => demoRepo(da, "student") },
    { name: "supabase", a: supabaseRepo(fake.client, ua, () => fake.client), b: supabaseRepo(fake.client, ub, () => fake.client), again: () => supabaseRepo(fake.client, ua, () => fake.client), fake, ua },
  ];
}

async function scored(repo: Repo, text = CV): Promise<string> {
  const r = await pasteFlow(repo, { text, original: null, sector: "Technology", stage: STAGES[0], key: crypto.randomUUID() });
  assert.ok("id" in r, JSON.stringify(r));
  return (r as { id: string }).id;
}
const read = async (repo: Repo, id: string) => (await repo.getReport<CvReviewPayload>(id))!;
const dismissedOn = async (repo: Repo, id: string) => {
  const v = (await read(repo, id)).payload.proofreading!.documentVersion;
  return [...dismissedIds(await repo.proofreadingChoices(v), v)].sort();
};

function student() {
  const id = crypto.randomUUID();
  const scope = requestScope({ [DEMO_COOKIE]: signDemoSession("student", id) });
  return { repo: demoRepo(`student-${id}`, "student"), as: <T>(fn: () => Promise<T>) => scope.run(fn) };
}

test("the fixture raises what these tests rely on", async () => {
  const p = await proofreadCv(CV, {});
  assert.deepEqual(p.findings.map((f) => f.id).sort(), [COLOR, "regional:other-variant:labor", TYPO, UNKNOWN].sort());
});

test("both repositories: dismiss and reopen work and survive a refresh", async () => {
  for (const { name, a, again } of pairs()) {
    const id = await scored(a);
    assert.deepEqual(await dismissedOn(a, id), [], name);
    assert.deepEqual(await dismissFlow(a, id, UNKNOWN), {});
    assert.deepEqual(await dismissedOn(again(), id), [UNKNOWN], `${name}: a fresh repository, as after a refresh, still has it`);
    assert.deepEqual(await reopenFlow(again(), id, UNKNOWN), {});
    assert.deepEqual(await dismissedOn(again(), id), [], `${name}: reopened survives too`);
  }
});

test("both repositories: a dismissal belongs to one document", async () => {
  for (const { name, a } of pairs()) {
    const first = await scored(a);
    await dismissFlow(a, first, UNKNOWN);
    const sameText = await scored(a);
    assert.deepEqual(await dismissedOn(a, sameText), [UNKNOWN], `${name}: the same text scored again is the same document`);
    const changed = await scored(a, `${CV}\nGit`);
    assert.ok((await read(a, changed)).payload.proofreading!.findings.some((f) => f.id === UNKNOWN), `${name}: the changed text has the finding`);
    assert.deepEqual(await dismissedOn(a, changed), [], `${name}: changed text is another document`);
  }
});

test("the state read from a history keeps documents apart and follows each finding's latest choice", () => {
  const row = (documentVersion: string, kind: "dismiss" | "reopen", findingId: string) => ({ id: crypto.randomUUID(), reportId: "r", documentVersion, kind, findingId, quote: "x", language: null, actor: "student" as const, createdAt: "" });
  const history = [row("doc-a", "dismiss", TYPO), row("doc-b", "dismiss", UNKNOWN), row("doc-a", "dismiss", COLOR), row("doc-a", "reopen", COLOR)];
  assert.deepEqual([...dismissedIds(history, "doc-a")], [TYPO]);
  assert.deepEqual([...dismissedIds(history, "doc-b")], [UNKNOWN]);
  assert.deepEqual([...dismissedIds(history, undefined)], []);
});

test("both repositories: a second student can't read or alter dismissals by changing an id", async () => {
  for (const { name, a, b, fake } of pairs()) {
    const id = await scored(a);
    await dismissFlow(a, id, UNKNOWN);
    const version = (await read(a, id)).payload.proofreading!.documentVersion;
    const before = JSON.stringify(await a.proofreadingChoices());

    assert.deepEqual(await b.proofreadingChoices(version), [], `${name}: knowing the document hash reads nothing`);
    assert.deepEqual(await b.proofreadingChoices(), [], name);
    assert.equal(await b.proofreadingLanguagePreference(), null, name);
    await assert.rejects(b.recordProofreadingChoice({ reportId: id, kind: "reopen", findingId: UNKNOWN }), ChoiceNotFoundError, name);
    await assert.rejects(b.recordProofreadingChoice({ reportId: id, kind: "dismiss", findingId: TYPO }), ChoiceNotFoundError, name);
    await assert.rejects(b.recordProofreadingChoice({ reportId: id, kind: "language", language: "en-US" }), ChoiceNotFoundError, name);
    assert.deepEqual(await reopenFlow(b, id, UNKNOWN), { error: NOT_FOUND }, name);
    assert.deepEqual(await dismissFlow(b, id, TYPO), { error: NOT_FOUND }, name);
    assert.deepEqual(await languageFlow(b, id, "en-US"), { error: NOT_FOUND }, name);
    for (const bad of ["../../etc/passwd", "' or 1=1 --", "", "x".repeat(10_000)]) await assert.rejects(b.recordProofreadingChoice({ reportId: bad, kind: "dismiss", findingId: UNKNOWN }), ChoiceNotFoundError, name);

    assert.equal(JSON.stringify(await a.proofreadingChoices()), before, `${name}: A's history is unchanged`);
    assert.equal((await read(a, id)).payload.proofreading!.language, "en-GB", `${name}: A's report is unchanged`);
    if (fake) assert.equal(fake.choices.length, 1, "no row was written for B");
  }
});

test("both repositories: only a finding the report holds can be dismissed, and only a report with proofreading", async () => {
  for (const { name, a } of pairs()) {
    const id = await scored(a);
    await assert.rejects(a.recordProofreadingChoice({ reportId: id, kind: "dismiss", findingId: "spelling:likely-misspelling:forged" }), ChoiceNotFoundError, name);
    const legacy = (await a.listReports({ type: "cv_review", limit: 100 })).rows.find((r) => r.id !== id);
    if (legacy && !(await read(a, legacy.id)).payload.proofreading) {
      assert.deepEqual(await dismissFlow(a, legacy.id, UNKNOWN), { error: NOT_FOUND }, name);
      assert.deepEqual(await languageFlow(a, legacy.id, "en-US"), { error: NOT_FOUND }, name);
    }
    assert.deepEqual(await a.proofreadingChoices(), [], name);
  }
});

test("both repositories: dismissing changes no score, and leaves the saved report byte for byte", async () => {
  for (const { name, a, b } of pairs()) {
    const id = await scored(a);
    const before = JSON.stringify(await read(a, id));
    for (const f of [TYPO, UNKNOWN, COLOR]) await dismissFlow(a, id, f);
    assert.equal(JSON.stringify(await read(a, id)), before, `${name}: dismissing`);
    await reopenFlow(a, id, TYPO);
    assert.equal(JSON.stringify(await read(a, id)), before, `${name}: reopening`);
    // A student with no dismissals scores the same text to the same numbers.
    const theirs = await read(b, await scored(b));
    const mine = await read(a, id);
    assert.equal(mine.row.score, theirs.row.score, name);
    assert.deepEqual(mine.payload.analysis, theirs.payload.analysis, name);
  }
});

test("both repositories: changing language changes the proofreading and no number, and shapes the next CV", async () => {
  for (const { name, a, again } of pairs()) {
    const id = await scored(a);
    const before = await read(a, id);
    assert.deepEqual(await languageFlow(a, id, "en-US"), {});
    const after = await read(again(), id);
    assert.equal(after.payload.proofreading!.language, "en-US", name);
    assert.ok(!after.payload.proofreading!.findings.some((f) => f.id === COLOR), `${name}: "color" is simply correct in US English`);
    assert.equal(after.row.score, before.row.score, name);
    for (const k of ["analysis", "assessment", "text", "document", "sector", "stage"] as const) assert.deepEqual(after.payload[k], before.payload[k], `${name}: ${k}`);

    assert.equal(await again().proofreadingLanguagePreference(), "en-US", `${name}: survives a refresh`);
    const next = await read(a, await scored(a, `${CV}\nGit`));
    assert.equal(next.payload.proofreading!.language, "en-US", `${name}: the next CV uses it`);
    assert.equal(next.payload.analysis.score, (await read(a, await scored(a, `${CV}\nGit`))).payload.analysis.score, name);

    // Asking again changes nothing and adds nothing.
    const count = (await a.proofreadingChoices()).length;
    assert.deepEqual(await languageFlow(a, id, "en-US"), {});
    assert.equal((await a.proofreadingChoices()).length, count, `${name}: no second entry`);
  }
});

test("a language check that can't run keeps the working result and records nothing", async () => {
  for (const { name, a } of pairs()) {
    const id = await scored(a);
    const before = JSON.stringify(await read(a, id));
    await withEnv({ PROOFREADING_PROVIDER: "off" }, async () => {
      const r = await languageFlow(a, id, "en-US");
      assert.ok(r.error, name);
    });
    assert.equal(JSON.stringify(await read(a, id)), before, name);
    assert.deepEqual(await a.proofreadingChoices(), [], name);
  }
});

test("a student with no choice gets the deployment's default, and a failed read of the choice can't lose the report", async () => {
  const { a } = pairs()[0];
  const report = await read(a, await scored(a));
  assert.equal(report.payload.proofreading!.language, "en-GB");
  const broken: Repo = { ...a, proofreadingLanguagePreference: () => Promise.reject(new Error("table missing")) };
  const saved = await read(a, await scored(broken, `${CV}\nGit`));
  assert.equal(saved.payload.proofreading!.language, "en-GB");
  assert.equal((await proofreadCv(CV, { PROOFREADING_LANGUAGE: "en-US" })).language, "en-US");
  assert.equal((await proofreadCv(CV, { PROOFREADING_LANGUAGE: "en-US" }, "en-GB")).language, "en-GB", "the student's choice beats the default");
});

test("one student's dismissal changes no global list and no other account", async () => {
  const size = TERMINOLOGY.size;
  const hash = createHash("sha256").update([...TERMINOLOGY].sort().join()).digest("hex");
  for (const { name, a, b } of pairs()) {
    const id = await scored(a);
    await dismissFlow(a, id, UNKNOWN);
    await dismissFlow(a, id, TYPO);
    const theirs = await scored(b);
    assert.deepEqual(await dismissedOn(b, theirs), [], `${name}: the same text on another account has no dismissals`);
    assert.ok((await read(b, theirs)).payload.proofreading!.findings.some((f) => f.id === UNKNOWN), `${name}: and is still questioned`);
  }
  assert.ok((await proofreadCv(CV, {})).findings.some((f) => f.id === UNKNOWN), "the engine still questions it");
  assert.equal(TERMINOLOGY.size, size);
  assert.equal(createHash("sha256").update([...TERMINOLOGY].sort().join()).digest("hex"), hash);
  // Nothing that scores or checks can read a choice, and nothing that handles a choice can reach the lists.
  for (const file of ["src/lib/analysis/cv.ts", "src/lib/analysis/rubric.ts", "src/lib/analysis/judgment.ts", "src/lib/analysis/fingerprint.ts", "src/lib/services.ts", "src/lib/analysis/proofreading/local.ts", "src/lib/analysis/proofreading/terminology.ts"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(process.cwd(), file), "utf8"), /proofreading\/choices|proofreadingChoices|proofreading_choices/, file);
  }
  for (const file of ["src/lib/analysis/proofreading/choices.ts", "src/lib/proofreading-flow.ts"]) assert.doesNotMatch(fs.readFileSync(path.join(process.cwd(), file), "utf8"), /from "[^"]*(terminology|nspell|dictionary)/, file);
});

test("regional suggestions are explained without calling valid English incorrect, in both directions", async () => {
  const WRONG = /misspell|incorrect|\bwrong\b|\berror\b|\btypo/i;
  for (const [language, word, valid] of [["en-GB", "color", "US"], ["en-US", "colour", "UK"]] as const) {
    const p = await proofreadCv(`Alex Example\n• Reviewed the ${word} of the reports with senior colleagues on the team.`, {}, language);
    const f = p.findings.find((x) => x.category === "regional");
    assert.ok(f, language);
    assert.equal(f!.severity, "info");
    assert.match(f!.explanation, new RegExp(`valid ${valid} spelling`));
    assert.doesNotMatch(f!.explanation, WRONG);
    assert.equal(possibleMistakes(p).length, 0, "not counted as a mistake");
    assert.doesNotMatch(regionalExplanation(language), WRONG);
    assert.match(regionalExplanation(language), new RegExp(`valid ${valid} spellings`));
    assert.match(regionalExplanation(language), /official organisation's name/);
  }
});

test("official names stay as they are, in either English; the same word elsewhere is still raised", async () => {
  const line = (s: string) => `Alex Example\n• ${s} placement with the data team reviewing reports for senior colleagues.`;
  for (const [name, language] of [["Center for Disease Control", "en-GB"], ["Department of Defense", "en-GB"], ["Pearl Harbor", "en-GB"], ["Ministry of Defence", "en-US"], ["Labour Party", "en-US"], ["World Food Programme", "en-US"]] as const) {
    assert.ok(OFFICIAL_NAMES.includes(name));
    const p = await proofreadCv(line(name), {}, language);
    assert.notEqual(p.status, "unavailable");
    assert.deepEqual(p.findings, [], `${name} in ${language}`);
  }
  // The control: without the list, this word opening a bullet is raised, so the test above proves something.
  const control = await proofreadCv(line("Center of the"), {}, "en-GB");
  assert.ok(control.findings.some((f) => f.id === "regional:other-variant:center"));
  // Case matters: an ordinary use of the word is a preference to raise.
  assert.ok((await proofreadCv("Alex Example\n• Reviewed the department of defense reports with senior colleagues on the team.", {}, "en-GB")).findings.some((f) => f.category === "regional"));
  // Whichever provider raises it: a hosted one would go through the same filter.
  const text = `Alex Example\n• Worked at the World Health Organization with colour.`;
  const start = text.indexOf("Organization");
  const raised = { category: "regional", rule: "other-variant", start, end: start + 12, quote: "Organization", message: "x", suggestions: ["Organisation"] };
  const provider = { id: "fake", sendsTextOffServer: false, proofread: async () => { const base = (await localProvider.proofread({ text, language: "en-GB", signal: new AbortController().signal })) as { issues: unknown[] }; return { ...base, issues: [...base.issues, raised] }; } };
  const r = await runProofreading(text, { provider, language: "en-GB", timeoutMs: 2000 });
  assert.equal(r.status, "complete", "dropping it isn't a failure");
  assert.ok(!r.findings.some((f) => f.evidence.some((e) => e.quote === "Organization")));
  // No path rewrites the student's text.
  for (const { a } of pairs().slice(0, 1)) {
    const named = `${CV}\n• Center for Disease Control placement with the data team reviewing reports.`;
    const id = await scored(a, named);
    await languageFlow(a, id, "en-US");
    assert.equal((await read(a, id)).payload.text, named);
  }
});

test("terminology claims no adviser review it hasn't had", () => {
  assert.equal(TERMINOLOGY_REVIEW.adviserReviewedBy, null);
  assert.equal(TERMINOLOGY_REVIEW.adviserReviewedOn, null);
});

test("the audit history records each student choice, says it was the student's, and takes the word from our report", async () => {
  for (const { name, a, b } of pairs()) {
    const id = await scored(a);
    await dismissFlow(a, id, TYPO);
    await dismissFlow(a, id, TYPO); // a double click
    await reopenFlow(a, id, TYPO);
    await reopenFlow(a, id, TYPO);
    await dismissFlow(a, id, TYPO);
    await languageFlow(a, id, "en-US");
    const h = await a.proofreadingChoices();
    assert.deepEqual(h.map((c) => c.kind), ["dismiss", "reopen", "dismiss", "language"], `${name}: every change, in order, each once`);
    assert.ok(h.every((c) => c.actor === "student" && c.reportId === id && c.createdAt && c.documentVersion.length === 64), name);
    assert.equal(h[0].quote, "custmer", name);
    assert.equal(h[3].language, "en-US", name);
    assert.equal(describeChoice(h[0]), `You dismissed the suggestion for "custmer".`);
    assert.equal(describeChoice(h[1]), `You reopened the suggestion for "custmer".`);
    assert.equal(describeChoice(h[3]), "You chose to check this CV in US English.");
    assert.deepEqual(await b.proofreadingChoices(), [], name);
  }
});

test("what the student reads: dismissing everything never reads as a clean result, and the lists shrink", async () => {
  const p = await proofreadCv(CV, {});
  assert.match(proofreadingHeadline(splitFindings(p, new Set()).open), /^1 possible spelling mistake to look at\.$/);
  const noTypo = splitFindings(p, new Set([TYPO]));
  assert.equal(noTypo.dismissed.length, 1);
  assert.equal(possibleMistakes(noTypo.open).length, 0);
  const headline = proofreadingHeadline(noTypo.open, 1);
  assert.match(headline, /No likely typos left to look at\. That doesn't prove your spelling is correct\. You've dismissed 1 suggestion on this CV\./);
  assert.equal(unrecognisedWords(splitFindings(p, new Set([UNKNOWN])).open).length, 0, "a correct word leaves the don't-recognise list");
  assert.equal(proofreadingSummary({ proofreading: p }), "1 possible mistake");
  assert.equal(proofreadingSummary({ proofreading: p }, new Set([UNKNOWN])), "1 possible mistake, 1 dismissed");
  assert.equal(proofreadingSummary({ proofreading: p }, new Set([TYPO])), "No likely typos left, 1 dismissed");
  assert.equal(p.findings.length, 4, "the report itself is left alone");
  assert.equal(proofreadingSummary({}, new Set([TYPO])), "Not assessed");
});

test("server actions: the owner can, another student's ids get nowhere, and a signed-out request gets nothing", async () => {
  await withEnv(DEMO, async () => {
    const [a, b] = [student(), student()];
    const id = await scored(a.repo);
    assert.deepEqual(await a.as(() => dismissFinding(id, UNKNOWN)), {}, "the control: the owner can");
    assert.deepEqual(await dismissedOn(a.repo, id), [UNKNOWN]);
    const before = JSON.stringify([await a.repo.proofreadingChoices(), await read(a.repo, id)]);

    assert.ok((await b.as(() => reopenFinding(id, UNKNOWN))).error);
    assert.ok((await b.as(() => dismissFinding(id, TYPO))).error);
    assert.ok((await b.as(() => setProofreadingLanguage(id, "en-US"))).error);
    assert.equal(JSON.stringify([await a.repo.proofreadingChoices(), await read(a.repo, id)]), before, "A's data is unchanged");
    assert.deepEqual(await b.repo.proofreadingChoices(), [], "and nothing landed on B's account");
    assert.equal(await b.repo.proofreadingLanguagePreference(), null);

    const signedOut = requestScope();
    assert.ok((await signedOut.run(() => dismissFinding(id, UNKNOWN))).error);
    assert.ok((await signedOut.run(() => setProofreadingLanguage(id, "en-US"))).error);

    assert.ok((await a.as(() => setProofreadingLanguage(id, "fr"))).error, "only a language we can check");
    assert.ok((await a.as(() => dismissFinding(id, "x".repeat(301)))).error, "an oversized id");
    assert.ok((await a.as(() => dismissFinding(id, "spelling:likely-misspelling:forged"))).error, "a finding the report doesn't hold");
    assert.equal(JSON.stringify([await a.repo.proofreadingChoices(), await read(a.repo, id)]), before);

    assert.deepEqual(await a.as(() => reopenFinding(id, UNKNOWN)), {});
    assert.deepEqual(await a.as(() => setProofreadingLanguage(id, "en-US")), {});
    assert.equal((await read(a.repo, id)).payload.proofreading!.language, "en-US");
    assert.equal(await a.repo.proofreadingLanguagePreference(), "en-US");
  });
});

test("server actions: choices are rate limited", async () => {
  await withEnv(DEMO, async () => {
    const a = student();
    const id = await scored(a.repo);
    let last = {};
    for (let i = 0; i < 121; i++) last = await a.as(() => dismissFinding(id, UNKNOWN));
    assert.deepEqual(last, { error: TOO_MANY });
    for (let i = 0; i < 21; i++) last = await a.as(() => setProofreadingLanguage(id, "en-GB"));
    assert.deepEqual(last, { error: TOO_MANY });
  });
});

test("the data export carries the student's choices and language, and nobody else's", async () => {
  await withEnv(DEMO, async () => {
    const [a, b] = [student(), student()];
    const id = await scored(a.repo);
    await a.as(() => dismissFinding(id, UNKNOWN));
    await a.as(() => setProofreadingLanguage(id, "en-US"));
    const unzip = async (who: typeof a) => {
      const res = await who.as(() => myExport());
      assert.equal(res.status, 200);
      const zip = await JSZip.loadAsync(await res.arrayBuffer());
      return JSON.parse(await zip.file("proofreading-choices.json")!.async("string"));
    };
    const mine = await unzip(a);
    assert.equal(mine.languagePreference, "en-US");
    assert.deepEqual(mine.history.map((c: { kind: string }) => c.kind), ["dismiss", "language"]);
    assert.equal(mine.history[0].findingId, UNKNOWN);
    assert.equal(mine.history[0].quote, "metronidazole");
    assert.equal(mine.history[0].actor, "student");
    assert.deepEqual(await unzip(b), { languagePreference: null, history: [] });
  });
});

test("deleting an account removes the choices and the preference, and only that account's", async () => {
  await withEnv(DEMO, async () => {
    const [a, b] = [student(), student()];
    const [ida, idb] = [await scored(a.repo), await scored(b.repo)];
    await dismissFlow(a.repo, ida, UNKNOWN);
    await languageFlow(a.repo, ida, "en-US");
    await dismissFlow(b.repo, idb, UNKNOWN);
    const form = new FormData();
    form.set("confirm", "DELETE");
    assert.match(await redirectOf(() => a.as(() => deleteAccount(form))), /deleted=1/);
    assert.deepEqual(await a.repo.proofreadingChoices(), []);
    assert.equal(await a.repo.proofreadingLanguagePreference(), null);
    assert.equal((await b.repo.proofreadingChoices()).length, 1);
  });
  const { a, b, fake, ua } = pairs()[1];
  const [ida, idb] = [await scored(a), await scored(b)];
  await dismissFlow(a, ida, UNKNOWN);
  await languageFlow(a, ida, "en-US");
  await dismissFlow(b, idb, UNKNOWN);
  assert.equal(fake!.choices.length, 3);
  fake!.session.userId = ua!;
  await a.deleteAccount();
  assert.deepEqual(await a.proofreadingChoices(), []);
  assert.equal(fake!.choices.length, 1);
  assert.equal((await b.proofreadingChoices()).length, 1);
});
