// OP-007: proofreading behind an adapter, reported beside the score and never part of it.
//
// The local engine runs for real here. The LanguageTool adapter only ever meets a fake fetch: nothing in
// this file sends text anywhere, and one test proves the default path doesn't call fetch at all.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { analyseCv } from "@/lib/analysis/cv";
import { documentVersion } from "@/lib/analysis/findings";
import { normaliseText } from "@/lib/analysis/fingerprint";
import { languageToolProvider } from "@/lib/analysis/proofreading/languagetool";
import { checkText, editDistance, LIKELY_MISSPELLING, loadSpellers, localProvider, UNRECOGNISED_WORD, type Spellers } from "@/lib/analysis/proofreading/local";
import type { ProofreadingProvider } from "@/lib/analysis/proofreading/provider";
import { proofreadCv, runProofreading } from "@/lib/analysis/proofreading/run";
import { DEFAULT_TIMEOUT_MS, proofreadingLanguage, proofreadingProvider, proofreadingTimeoutMs } from "@/lib/analysis/proofreading/settings";
import { TERMINOLOGY } from "@/lib/analysis/proofreading/terminology";
import { evidenceContext, NOT_ASSESSED_OLD_REPORT, possibleMistakes, proofreadingHeadline, proofreadingSummary } from "@/lib/analysis/proofreading/view";
import { RUBRIC_VERSION } from "@/lib/analysis/rubric";
import { pasteFlow } from "@/lib/cv-flow";
import { demoRepo } from "@/lib/repo/demo";
import { supabaseRepo } from "@/lib/repo/supabase";
import type { Repo } from "@/lib/repo/types";
import { fromStored, PayloadError, toStored } from "@/lib/report-schema";
import { buildCvPayload } from "@/lib/services";
import type { CvReviewPayload, ProofreadingCategory, ProofreadingLanguage, ProofreadingReport } from "@/lib/types";
import { evaluate, parseMarkup, wilson } from "../scripts/eval-proofreading";
import { fakeSupabase } from "./fixtures/fake-supabase";
import { AUDIT_CLEAN_CV, AUDIT_CORRECT_WORDS, AUDIT_MISSPELLED_CV, AUDIT_MISSPELLED_WORDS, AUDIT_SECTOR } from "./fixtures/audit";

const STAGE = "Final year, graduate roles";
const run = (text: string, language: ProofreadingLanguage = "en-GB") => runProofreading(text, { provider: localProvider, language, timeoutMs: 30000 });
const quotes = (p: ProofreadingReport, c: ProofreadingCategory) => p.findings.filter((f) => f.category === c).flatMap((f) => f.evidence.map((e) => e.quote));
const cv = (...lines: string[]) => ["Alex Example", "EXPERIENCE", "Analyst | Example Ltd | 2025 - Present", ...lines].join("\n");

/* ---------- the audit regression ---------- */

test("the four audit misspellings are caught, with a replacement, and the clean source isn't flagged", async () => {
  const bad = await run(AUDIT_MISSPELLED_CV);
  assert.equal(bad.status, "complete");
  assert.deepEqual(quotes(bad, "spelling").sort(), [...AUDIT_MISSPELLED_WORDS].sort());
  const suggested = (w: string) => bad.findings.find((f) => f.evidence[0].quote === w)!.suggestions;
  assert.ok(suggested("custmer").includes("customer"));
  assert.ok(suggested("relatonships").includes("relationships"));
  assert.ok(suggested("finanical").includes("financial"));
  assert.ok(suggested("recomendations").includes("recommendations"));

  const clean = await run(AUDIT_CLEAN_CV);
  assert.equal(clean.status, "complete");
  assert.deepEqual(clean.findings, []);
  for (const w of AUDIT_CORRECT_WORDS) assert.ok(!quotes(bad, "spelling").includes(w), w);
});

test("the engine has no knowledge of the audit words: they appear in none of its files", () => {
  const dir = "src/lib/analysis/proofreading";
  for (const file of readdirSync(dir)) {
    const source = readFileSync(`${dir}/${file}`, "utf8").toLowerCase();
    for (const w of AUDIT_MISSPELLED_WORDS) assert.ok(!source.includes(w), `${file} mentions ${w}`);
  }
  for (const w of AUDIT_MISSPELLED_WORDS) assert.ok(!TERMINOLOGY.has(w), w);
});

test("a typo and a word we don't know are told apart, and only the typo counts as a possible mistake", async () => {
  // Drug, legal and engineering words of the kind no general dictionary holds: invented for this test, not taken from an evaluation set.
  const p = await run(cv("• Prescribed zolpidem and monitored the custmer on metronidazole."));
  const rule = (w: string) => p.findings.find((f) => f.evidence[0].quote === w)!.rule;
  assert.equal(rule("custmer"), LIKELY_MISSPELLING);
  assert.equal(rule("metronidazole"), UNRECOGNISED_WORD);
  const unknown = p.findings.find((f) => f.evidence[0].quote === "metronidazole")!;
  assert.equal(unknown.severity, "info");
  assert.match(unknown.explanation, /We don't recognise/);
  assert.doesNotMatch(unknown.explanation, /misspelled/);
  assert.equal(possibleMistakes(p).length, 1);
  assert.match(proofreadingHeadline(p), /^1 possible spelling mistake to look at/);
  assert.equal(editDistance("finanical", "financial"), 1, "a swap of neighbouring letters is one edit");
  assert.equal(editDistance("abc", "abc"), 0);
  assert.equal(editDistance("kitten", "sitting"), 3);
});

test("a long capitalised word one edit from a common word is questioned; names, and the name line, aren't", async () => {
  const p = await run(["Managment Example", "SKILLS", "Enviroment Analysis, Python, Wojciechowski, Okonkwo-Hartley", "• Worked with Dr Venkataraman at Thandiwe Partners on Enviroment reporting."].join("\n"));
  assert.deepEqual(possibleMistakes(p).flatMap((f) => f.evidence.map((e) => e.quote)), ["Enviroment", "Enviroment"]);
});

test("an unseen typo of the same kinds is caught too, so detection isn't tied to the four words", async () => {
  const p = await run(cv("• Coordinated the anual budgeting proccess for 12 managers.", "• Recieved praise for acheiving targets."));
  assert.deepEqual(quotes(p, "spelling"), ["anual", "proccess", "Recieved", "acheiving"]);
});

/* ---------- negative cases: names and specialist terms ---------- */

test("specialist terms a dictionary lacks aren't flagged, in any case", async () => {
  const p = await run(cv(
    "• Led stakeholder onboarding and upskilled 12 colleagues on Kubernetes, Terraform, kubectl and PyTorch.",
    "• Kubernetes clusters ran our microservices; onboarding took days and the backend and frontend were refactored.",
    "• Built a dataset in pandas, numpy and scikit-learn, then a dashboard in Tableau, Power BI and Salesforce.",
    "SKILLS",
    "Python, SQL, kubernetes, terraform, CI/CD, DevOps, HubSpot, GitHub, JavaScript, Node.js, C++, C#, file_name.py, S3, H2O",
  ));
  assert.deepEqual(p.findings, []);
});

test("financial product names and qualifications aren't flagged", async () => {
  const p = await run(cv(
    "• Compared stocks and shares ISAs, SIPPs, gilts and ETFs for 40 clients at the FCA's request.",
    "• Built a DCF and an LBO model from EBITDA and valued swaptions against SONIA under IFRS and Basel III.",
    "• Sipps and isas were reviewed; ebitda fell 3% and the CFA and ACCA reading lists were completed.",
  ));
  assert.deepEqual(p.findings, []);
});

test("personal and employer names aren't flagged, wherever they sit", async () => {
  const p = await run([
    "Ngozi Adebayo-Okonkwo",
    "ngozi.okonkwo@example.com | linkedin.com/in/ngoziokonkwo | github.com/nokonkwo",
    "EXPERIENCE",
    "Analyst | Monzo | 2025 - Present",
    "Intern | Szczepański Mróz LLP | 2024",
    "• Worked with Dr Wojciechowski and Siobhan Nguyen at Revolut on the Thandiwe Scholarship.",
    "• Monzo internship covered customer calls with Priyanka Venkataraman at Deloitte.",
    "• Supported Mr Ifeanyi Chukwuemeka; Oyelaran Partners later hired him.",
  ].join("\n"));
  assert.deepEqual(quotes(p, "spelling"), []);
  assert.ok(p.stats.wordsSkipped > 0, "and the report counts what it left alone");
});

test("a capitalised misspelling at the start of a bullet is caught, but a name opening a bullet is not", async () => {
  const p = await run(cv("• Custmer calls were logged daily.", "• Okonjo Partners hired me after Okonjo Partners ran the scheme."));
  assert.deepEqual(quotes(p, "spelling"), ["Custmer"]);
});

test("long capital headings are checked, short acronyms aren't", async () => {
  const p = await run(["Alex Example", "EXPERINCE", "EDUCATION", "SKILLS", "• Reported to the CMA, FRC and NHS on KPIs."].join("\n"));
  assert.deepEqual(quotes(p, "spelling"), ["EXPERINCE"]);
  assert.deepEqual(p.findings[0].suggestions.slice(0, 1), ["EXPERIENCE"], "a replacement in the same case");
});

test("URLs, emails, possessives and hyphenated compounds aren't flagged", async () => {
  const p = await run(cv("• Published to https://kubernetz.example.com/foo-barr and emailed qwrt@zxcv.org about the team's clients' cross-functional, re-engineered, well-being work."));
  assert.deepEqual(p.findings, []);
});

test("in a hyphenated word only the doubtful part is quoted", async () => {
  const p = await run(cv("• Ran a cross-funtional review."));
  assert.deepEqual(quotes(p, "spelling"), ["funtional"]);
});

/* ---------- regional preference ---------- */

test("valid US English is a regional preference, never a misspelling", async () => {
  const p = await run(cv("• We analyzed the color of labor data, traveled to the center and fixed our defense modeling."));
  assert.deepEqual(quotes(p, "spelling"), [], "not one is called a misspelling");
  assert.deepEqual(quotes(p, "regional").sort(), ["analyzed", "color", "defense", "labor", "modeling", "traveled", "center"].sort());
  const color = p.findings.find((f) => f.evidence[0].quote === "color")!;
  assert.equal(color.severity, "info");
  assert.ok(color.suggestions.includes("colour"));
  assert.match(color.explanation, /valid US spelling/);
  assert.match(color.explanation, /preference rather than a mistake/);
  assert.match(color.explanation, /name, a quotation or a product/);
});

test("official names keep their spelling, and -ize is accepted as UK English", async () => {
  const p = await run(cv("• Volunteered at the World Health Organization and the Center for American Progress.", "• We organize events and recognized their organization."));
  assert.deepEqual(p.findings, []);
});

test("with US English selected the same rule runs the other way", async () => {
  const p = await run(cv("• We analysed the colour of data and analyzed the color of data."), "en-US");
  assert.equal(p.language, "en-US");
  assert.deepEqual(quotes(p, "spelling"), []);
  assert.deepEqual(quotes(p, "regional").sort(), ["analysed", "colour"]);
  assert.match(p.findings.find((f) => f.evidence[0].quote === "colour")!.explanation, /valid UK spelling/);
});

/* ---------- honest coverage ---------- */

test("categories are separate, and grammar is reported as not assessed rather than clean", async () => {
  const text = cv("• She were managing the team, , and form the start they was late.");
  const p = await run(text);
  assert.equal(p.coverage.grammar.status, "not_assessed");
  assert.match(p.coverage.grammar.note, /Not assessed/);
  assert.equal(p.coverage.punctuation.status, "partial");
  assert.match(p.coverage.spelling.note, /real word used wrongly/);
  assert.deepEqual(quotes(p, "grammar"), [], "the local engine can't see any of this and doesn't pretend to");
  assert.deepEqual(quotes(p, "spelling"), [], "\"form\" for \"from\" is a known miss");
});

test("the three punctuation patterns are found and ordinary punctuation isn't", async () => {
  const p = await run(cv("• Reduced costs , then grew sales,,and met targets,then left.."));
  assert.deepEqual([...new Set(p.findings.filter((f) => f.category === "punctuation").map((f) => f.rule))].sort(), ["doubled-punctuation", "no-space-after-comma", "space-before-punctuation"]);
  const fine = await run(cv("• Grew revenue to £1,000,000 (12.5%), using .NET, Node.js and A/B tests... then left: on time.", "Skills: SQL, Excel - and more"));
  assert.deepEqual(quotes(fine, "punctuation"), []);
});

/* ---------- evidence ---------- */

test("every span quotes the normalised text exactly, and a payload carrying them passes the write gate", async () => {
  const raw = `${AUDIT_MISSPELLED_CV}\r\n•   Custmer  calls’ color ,  logged`;
  const p = await run(raw);
  const doc = normaliseText(raw);
  assert.equal(p.documentVersion, documentVersion(raw));
  assert.ok(p.findings.length >= 5);
  for (const f of p.findings) {
    assert.equal(f.status, "needs_attention");
    for (const e of f.evidence) {
      assert.equal(e.block, "doc");
      assert.equal(doc.slice(e.range!.start, e.range!.end), e.quote);
    }
  }
  const payload = { ...buildCvPayload({ fileName: "cv.pdf", text: raw, sector: AUDIT_SECTOR, stage: STAGE }), proofreading: p };
  assert.deepEqual((toStored("cv_review", payload) as CvReviewPayload).proofreading, p);
});

test("findings suggest a replacement and change nothing", async () => {
  const before = AUDIT_MISSPELLED_CV;
  const p = await run(before);
  assert.equal(AUDIT_MISSPELLED_CV, before);
  const f = p.findings[0];
  assert.match(f.action!, /We haven't changed anything/);
  assert.match(f.explanation, /may be misspelled/);
  assert.equal(f.confidence, null, "there's no calibrated confidence, so none is claimed");
});

test("the panel shows a word on its own line", () => {
  const doc = "First line\n• We met the custmer here\nLast";
  const start = doc.indexOf("custmer");
  assert.deepEqual(evidenceContext(doc, { start, end: start + 7 }), { before: "We met the ", match: "custmer", after: " here" });
});

/* ---------- failure: unavailable or partial, never a pass ---------- */

const provider = (proofread: ProofreadingProvider["proofread"]): ProofreadingProvider => ({ id: "fake", sendsTextOffServer: false, proofread });
const fake = (p: ProofreadingProvider, timeoutMs = 30000) => runProofreading(AUDIT_MISSPELLED_CV, { provider: p, language: "en-GB", timeoutMs });

function assertNotAPass(p: ProofreadingReport) {
  assert.equal(p.status, "unavailable");
  assert.deepEqual(p.findings, []);
  for (const c of ["spelling", "grammar", "punctuation", "regional"] as const) assert.equal(p.coverage[c].status, "not_assessed", c);
  assert.ok(p.limits.length);
  const headline = proofreadingHeadline(p).replace("This doesn't mean your CV has no mistakes.", "");
  assert.doesNotMatch(headline, /passed|looks good|no (mistakes|errors|issues|unknown)/i);
  assert.equal(proofreadingSummary({ proofreading: p }), "Not assessed");
}

test("a provider that never answers times out as unavailable", async () => {
  const started = Date.now();
  const p = await fake(provider(() => new Promise(() => {})), 100);
  assertNotAPass(p);
  assert.match(p.limits[0], /took too long/);
  assert.ok(Date.now() - started < 2000);
});

test("a provider that throws is unavailable", async () => {
  const p = await fake(provider(async () => {
    throw new Error("boom");
  }));
  assertNotAPass(p);
  assert.match(p.limits[0], /couldn't run/);
});

test("malformed provider output is unavailable", async () => {
  const good = await localProvider.proofread({ text: normaliseText(AUDIT_MISSPELLED_CV), language: "en-GB", signal: new AbortController().signal }) as Record<string, unknown>;
  const cases: unknown[] = [
    null,
    undefined,
    "ok",
    [],
    {},
    { status: "complete" },
    { ...good, status: "passed" },
    { ...good, issues: "none" },
    { ...good, issues: [{ start: 0 }] },
    { ...good, stats: { wordsChecked: -1, wordsSkipped: 0 } },
    { ...good, coverage: { spelling: { status: "assessed", note: "x" } } },
    { ...good, extra: true },
  ];
  for (const bad of cases) {
    const p = await fake(provider(async () => bad));
    assertNotAPass(p);
    assert.match(p.limits[0], /couldn't read/);
  }
});

test("a finding that doesn't line up with the text is dropped and the run is partial", async () => {
  const text = normaliseText(AUDIT_MISSPELLED_CV);
  const good = await localProvider.proofread({ text, language: "en-GB", signal: new AbortController().signal }) as { issues: { start: number; end: number; quote: string }[] };
  const shifted = { ...good.issues[0], start: good.issues[0].start + 1, end: good.issues[0].end + 1 };
  const outside = { ...good.issues[1], start: text.length + 5, end: text.length + 9 };
  const reversed = { ...good.issues[2], start: 9, end: 2 };
  const p = await fake(provider(async () => ({ ...good, issues: [shifted, outside, reversed, good.issues[3]] })));
  assert.equal(p.status, "partial");
  assert.equal(p.findings.length, 1);
  assert.equal(p.coverage.spelling.status, "partial");
  assert.match(p.limits.join(" "), /3 of the check's results didn't line up/);
  assert.match(proofreadingHeadline(p), /^Part of your CV was checked/);
  assert.doesNotThrow(() => toStored("cv_review", { ...buildCvPayload({ fileName: "cv.pdf", text: AUDIT_MISSPELLED_CV, sector: AUDIT_SECTOR, stage: STAGE }), proofreading: p }));
});

test("a provider that checked nothing hasn't passed anything", async () => {
  const good = await localProvider.proofread({ text: "x", language: "en-GB", signal: new AbortController().signal });
  assertNotAPass(await fake(provider(async () => good)));
  assertNotAPass(await runProofreading("", { provider: localProvider, language: "en-GB", timeoutMs: 30000 }));
});

test("running out of time between words returns a partial result with what was found", async () => {
  const spellers = await loadSpellers();
  const controller = new AbortController();
  // Time runs out while it's on the first unknown word; the next yield point stops the run.
  const text = normaliseText(`• ${"custmer ".repeat(5)}${"management ".repeat(600)}finanical`);
  const counting: Spellers = { gb: { correct: (w) => spellers.gb.correct(w), suggest: (w) => { controller.abort(); return spellers.gb.suggest(w); } }, us: spellers.us };
  const r = await checkText(text, counting, "en-GB", controller.signal);
  assert.equal(r.status, "partial");
  assert.equal(r.coverage.spelling.status, "partial");
  assert.equal(r.coverage.regional.status, "partial");
  assert.match(r.limits[0], /ran out of time after \d+ of \d+ words/);
  assert.ok(r.issues.some((i) => i.quote === "custmer"));
  assert.ok(!r.issues.some((i) => i.quote === "finanical"), "the words it never reached aren't claimed either way");
  const saved = await fake(provider(async () => r));
  assert.equal(saved.status, "partial", "and the status survives into the report, with the limit");
  assert.match(saved.limits.join(" "), /ran out of time/);
});

test("a dictionary that fails to load is unavailable", async () => {
  const p = await fake({ ...localProvider, proofread: async () => { throw new Error("ENOENT index.aff"); } });
  assertNotAPass(p);
});

test("a garbled document stops at a limit and says so", async () => {
  const garbage = Array.from({ length: 400 }, (_, i) => `qx${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + (Math.floor(i / 26) % 26))}zv`).join(" ");
  const p = await run(`• ${garbage}`);
  assert.equal(p.status, "partial");
  assert.match(p.limits.join(" "), /stopped after 150 different suggestions/);
});

test("failure logs never carry the student's text", async () => {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (s: string) => void lines.push(s);
  try {
    await fake(provider(async () => {
      throw new Error(AUDIT_MISSPELLED_CV);
    }));
    await fake(provider(async () => AUDIT_MISSPELLED_CV));
  } finally {
    console.warn = original;
  }
  assert.equal(lines.length, 2);
  for (const l of lines) for (const w of AUDIT_MISSPELLED_WORDS) assert.ok(!l.includes(w), l);
});

/* ---------- settings: nothing leaves the server by default ---------- */

test("the default is the local dictionary, UK English, five seconds", () => {
  assert.equal(proofreadingProvider({}), localProvider);
  assert.equal(localProvider.sendsTextOffServer, false);
  assert.equal(proofreadingLanguage({}), "en-GB");
  assert.equal(proofreadingLanguage({ PROOFREADING_LANGUAGE: "en-US" }), "en-US");
  assert.equal(proofreadingLanguage({ PROOFREADING_LANGUAGE: "klingon" }), "en-GB");
  assert.equal(proofreadingTimeoutMs({}), DEFAULT_TIMEOUT_MS);
  assert.equal(proofreadingTimeoutMs({ PROOFREADING_TIMEOUT_MS: "2000" }), 2000);
  assert.equal(proofreadingTimeoutMs({ PROOFREADING_TIMEOUT_MS: "nonsense" }), DEFAULT_TIMEOUT_MS);
  assert.equal(proofreadingTimeoutMs({ PROOFREADING_TIMEOUT_MS: "0" }), DEFAULT_TIMEOUT_MS);
});

test("LanguageTool can't activate without an explicit approval and a URL", () => {
  const url = "https://languagetool.invalid/v2";
  assert.equal(proofreadingProvider({ PROOFREADING_PROVIDER: "languagetool" }), localProvider);
  assert.equal(proofreadingProvider({ PROOFREADING_PROVIDER: "languagetool", PROOFREADING_LANGUAGETOOL_URL: url }), localProvider);
  assert.equal(proofreadingProvider({ PROOFREADING_PROVIDER: "languagetool", PROOFREADING_EXTERNAL_TEXT_APPROVED: "true" }), localProvider);
  assert.equal(proofreadingProvider({ PROOFREADING_PROVIDER: "languagetool", PROOFREADING_EXTERNAL_TEXT_APPROVED: "yes", PROOFREADING_LANGUAGETOOL_URL: url }), localProvider);
  const approved = proofreadingProvider({ PROOFREADING_PROVIDER: "languagetool", PROOFREADING_EXTERNAL_TEXT_APPROVED: "true", PROOFREADING_LANGUAGETOOL_URL: url });
  assert.equal(approved?.id, "languagetool");
  assert.equal(approved?.sendsTextOffServer, true);
});

test("the default path makes no network call", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("no network in this test");
  }) as typeof fetch;
  try {
    const p = await proofreadCv(AUDIT_MISSPELLED_CV, {});
    assert.equal(p.provider, "local-hunspell");
    assert.equal(p.findings.length, 4);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("switching proofreading off is unavailable, not a pass", async () => {
  const p = await proofreadCv(AUDIT_MISSPELLED_CV, { PROOFREADING_PROVIDER: "off" });
  assertNotAPass(p);
  assert.match(p.limits[0], /switched off/);
});

/* ---------- the LanguageTool adapter, against a fake server only ---------- */

const ltMatch = (text: string, word: string, categoryId: string, replacements: string[] = []) => {
  const offset = text.indexOf(word);
  return { message: `About ${word}`, offset, length: word.length, replacements: replacements.map((value) => ({ value })), context: { text, offset, length: word.length }, rule: { id: `RULE_${categoryId}`, category: { id: categoryId } } };
};
const lt = (respond: () => Promise<Response>, maxChars = 20000) => {
  const sent: { url: string; body: string }[] = [];
  const p = languageToolProvider({
    url: "https://languagetool.invalid/v2/",
    maxChars,
    isOtherVariant: async (w) => w === "color",
    fetch: (async (url: string, init: RequestInit) => {
      sent.push({ url, body: String(init.body) });
      return respond();
    }) as unknown as typeof fetch,
  });
  return { p, sent };
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test("the LanguageTool adapter separates the categories and US spelling is never a misspelling", async () => {
  const text = "We met the custmer, , and color they was happy.";
  const { p, sent } = lt(async () => json({ software: { version: "6.6" }, matches: [ltMatch(text, "custmer", "TYPOS", ["customer"]), ltMatch(text, "color", "TYPOS", ["colour"]), ltMatch(text, " ,", "PUNCTUATION", [","]), ltMatch(text, "they was", "GRAMMAR", ["they were"]), ltMatch(text, "happy", "STYLE")] }));
  const r = await runProofreading(text, { provider: p, language: "en-GB", timeoutMs: 1000 });
  assert.equal(sent[0].url, "https://languagetool.invalid/v2/check");
  assert.match(sent[0].body, /language=en-GB/);
  assert.equal(r.status, "complete");
  assert.equal(r.engine, "languagetool-6.6");
  assert.deepEqual(quotes(r, "spelling"), ["custmer"]);
  assert.deepEqual(quotes(r, "regional"), ["color"]);
  assert.deepEqual(quotes(r, "punctuation"), [" ,"]);
  assert.deepEqual(quotes(r, "grammar"), ["they was"]);
  assert.equal(r.findings.length, 4, "style advice is out of scope");
});

test("LanguageTool failures are unavailable or partial, never a pass", async () => {
  const text = AUDIT_MISSPELLED_CV;
  for (const bad of [json({ error: "nope" }, 500), json({ software: { version: "6" } }), json({ software: { version: "6" }, matches: [{ offset: "x" }] }), new Response("<html>not json</html>")]) {
    assertNotAPass(await runProofreading(text, { provider: lt(async () => bad).p, language: "en-GB", timeoutMs: 1000 }));
  }
  assertNotAPass(await runProofreading(text, { provider: lt(() => new Promise(() => {})).p, language: "en-GB", timeoutMs: 100 }));
  assertNotAPass(await runProofreading(text, { provider: lt(async () => json({ software: { version: "6" }, matches: [] }), 10).p, language: "en-GB", timeoutMs: 1000 }));
  const doc = normaliseText(text);
  const offByOne = { ...ltMatch(doc, "custmer", "TYPOS"), offset: doc.indexOf("custmer") + 1 };
  const shifted = await runProofreading(text, { provider: lt(async () => json({ software: { version: "6" }, matches: [offByOne] })).p, language: "en-GB", timeoutMs: 1000 });
  assert.equal(shifted.status, "partial");
  assert.deepEqual(shifted.findings, []);
});

/* ---------- beside the score, never part of it ---------- */

test("proofreading changes no score, fingerprint, step or rubric", async () => {
  const bare = buildCvPayload({ fileName: "cv.pdf", text: AUDIT_MISSPELLED_CV, sector: AUDIT_SECTOR, stage: STAGE });
  const snapshot = JSON.stringify(bare);
  const withProof = toStored("cv_review", { ...bare, proofreading: await run(AUDIT_MISSPELLED_CV) }) as CvReviewPayload;
  assert.equal(JSON.stringify(bare), snapshot, "the input isn't changed");
  assert.deepEqual(withProof.analysis, bare.analysis);
  assert.deepEqual(withProof.assessment, bare.assessment);
  assert.deepEqual(analyseCv(AUDIT_MISSPELLED_CV, AUDIT_SECTOR), bare.analysis);
  assert.equal(withProof.analysis.meta.rubric, RUBRIC_VERSION);
  assert.ok(!JSON.stringify(withProof.analysis).includes("custmer\"") || !JSON.stringify(withProof.analysis.steps).includes("custmer"));
  assert.equal(analyseCv(AUDIT_CLEAN_CV, AUDIT_SECTOR).score, analyseCv(AUDIT_MISSPELLED_CV, AUDIT_SECTOR).score, "still reported apart: the composite doesn't move");
});

test("a report made through the real flow carries proofreading in both repositories, and a failure doesn't lose the report", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const fake = fakeSupabase();
  const repos: [string, Repo][] = [["demo", demoRepo(`student-${crypto.randomUUID()}`, "student")], ["supabase", supabaseRepo(fake.client, crypto.randomUUID(), () => fake.client)]];
  for (const [name, repo] of repos) {
    const made = await pasteFlow(repo, { text: AUDIT_MISSPELLED_CV, original: null, sector: AUDIT_SECTOR, stage: STAGE, key: `t-${crypto.randomUUID()}` });
    assert.ok("id" in made && made.id, name);
    const saved = (await repo.getReport(made.id!))!.payload as CvReviewPayload;
    assert.equal(saved.proofreading?.status, "complete", name);
    assert.deepEqual(saved.proofreading?.findings.flatMap((f) => f.evidence.map((e) => e.quote)).sort(), [...AUDIT_MISSPELLED_WORDS].sort(), name);
    assert.equal(saved.analysis.score, analyseCv(AUDIT_MISSPELLED_CV, AUDIT_SECTOR).score, name);

    process.env.PROOFREADING_PROVIDER = "off";
    try {
      const down = await pasteFlow(repo, { text: AUDIT_CLEAN_CV, original: null, sector: AUDIT_SECTOR, stage: STAGE, key: `t-${crypto.randomUUID()}` });
      assert.ok("id" in down && down.id, `${name}: the report is still made`);
      const p = (await repo.getReport(down.id!))!.payload as CvReviewPayload;
      assertNotAPass(p.proofreading!);
      assert.equal(p.analysis.score, analyseCv(AUDIT_CLEAN_CV, AUDIT_SECTOR).score, `${name}: and scored as usual`);
    } finally {
      delete process.env.PROOFREADING_PROVIDER;
    }
  }
});

test("a report saved without proofreading reads as not assessed, in every saved shape", () => {
  const current = buildCvPayload({ fileName: "cv.pdf", text: AUDIT_CLEAN_CV, sector: AUDIT_SECTOR, stage: STAGE });
  assert.equal(current.proofreading, undefined);
  const v1 = fromStored("cv_review", JSON.parse(JSON.stringify(current))) as CvReviewPayload;
  assert.equal(v1.proofreading, undefined);
  const v0Shape: Partial<CvReviewPayload> = JSON.parse(JSON.stringify(current));
  delete v0Shape.payloadVersion;
  delete v0Shape.assessment;
  const v0 = fromStored("cv_review", v0Shape) as CvReviewPayload;
  assert.equal(v0.proofreading, undefined);
  for (const p of [v1, v0]) {
    assert.equal(proofreadingHeadline(p.proofreading), NOT_ASSESSED_OLD_REPORT);
    assert.equal(proofreadingSummary(p), "Not assessed");
  }
  assert.match(NOT_ASSESSED_OLD_REPORT, /doesn't mean it passed/);
});

test("the write gate refuses a proofreading report that doesn't describe the saved text", async () => {
  const bare = buildCvPayload({ fileName: "cv.pdf", text: AUDIT_MISSPELLED_CV, sector: AUDIT_SECTOR, stage: STAGE });
  const good = await run(AUDIT_MISSPELLED_CV);
  const f = good.findings[0];
  const e = f.evidence[0];
  const bad: [string, ProofreadingReport][] = [
    ["other document", { ...good, documentVersion: "0".repeat(64) }],
    ["unavailable with findings", { ...good, status: "unavailable" }],
    ["shifted range", { ...good, findings: [{ ...f, evidence: [{ ...e, range: { start: e.range!.start + 1, end: e.range!.end + 1 } }] }] }],
    ["range outside the text", { ...good, findings: [{ ...f, evidence: [{ ...e, range: { start: 1e6, end: 1e6 + 7 } }] }] }],
    ["no position", { ...good, findings: [{ ...f, evidence: [{ ...e, range: null }] }] }],
    ["no evidence", { ...good, findings: [{ ...f, evidence: [] }] }],
    ["category mismatch", { ...good, findings: [{ ...f, category: "regional" }] }],
    ["duplicate id", { ...good, findings: [f, f] }],
    ["a finding claiming to pass", { ...good, findings: [{ ...f, status: "passed" as never }] }],
    ["an invented status", { ...good, status: "passed" as never }],
    ["an unknown field", { ...good, score: 10 } as never],
  ];
  for (const [name, proofreading] of bad) assert.throws(() => toStored("cv_review", { ...bare, proofreading }), PayloadError, name);
});

test("the headline never reads a clean run as a clean CV", async () => {
  const h = proofreadingHeadline(await run(AUDIT_CLEAN_CV));
  assert.match(h, /doesn't prove your spelling is correct/);
  assert.match(proofreadingHeadline(await run(AUDIT_MISSPELLED_CV)), /^4 possible spelling mistakes/);
  assert.equal(proofreadingSummary({ proofreading: await run(AUDIT_MISSPELLED_CV) }), "4 possible mistakes");
});

/* ---------- the evaluator itself ---------- */

test("the evaluator counts true and false positives, misses and category swaps correctly", async () => {
  const text = [
    "Alex Example",
    "• Managed [[custmer|spelling|customer]] calls and [[color|regional|colour]] swatches, a pulmanager item.",
    "• Sent it [[form|spelling-realword|from]] home and [[they was|grammar|they were]] late,, sadly.",
  ].join("\n");
  const r = await evaluate([{ id: "t", text }]);
  assert.equal(r.spellingNonWord.truePositives, 1);
  assert.equal(r.spellingNonWord.falsePositives, 0);
  assert.equal(r.spellingNonWord.precision, 1);
  assert.deepEqual(r.unrecognisedCorrectWords, ["t: pulmanager"], "a correct word listed as unrecognised isn't called a mistake");
  assert.equal(r.spellingNonWord.recall, 1);
  assert.equal(r.spellingIncludingRealWord.recall, 0.5, "the real-word error counts against recall");
  assert.equal(r.regional.recall, 1);
  assert.deepEqual(r.regionalReportedAsSpelling, []);
  assert.deepEqual(r.falsePositives.map((x) => x.split(": ").pop()), [",,"]);
  assert.deepEqual(r.missed, ["t: spelling-realword: form"]);
  assert.equal(r.grammar.labelled, 1);
});

test("markup comes out cleanly and offsets point at the marked text", () => {
  const { text, labels } = parseMarkup("• A [[bad|spelling|good]] word and[[ ,|punctuation|,]] done");
  assert.equal(text, "• A bad word and , done");
  assert.equal(text.slice(labels[0].start, labels[0].end), "bad");
  assert.equal(text.slice(labels[1].start, labels[1].end), " ,");
  assert.equal(labels[0].correct, "good");
  const [lo, hi] = wilson(9, 10)!;
  assert.ok(lo < 0.9 && hi > 0.9 && lo > 0.5 && hi < 1);
  assert.equal(wilson(0, 0), null);
});
