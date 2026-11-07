// OP-012: reading requirements from the words of an advert. All adverts and products named here are synthetic
// except the audit advert, and the invented names exist to prove the dictionary isn't deciding anything.
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRequirements, extractWithAdapter, findTerm, mergeSemanticRequirements, termKey } from "@/lib/analysis/job-requirements";
import { AUDIT_ADVERT } from "./fixtures/audit";

const read = (advert: string) => extractRequirements(advert);
const category = (advert: string, term: string) => read(advert).requirements.find((r) => r.terms.some((t) => t.toLowerCase() === term.toLowerCase()))?.category;
const labels = (advert: string, cat: string) => read(advert).requirements.filter((r) => r.category === cat).map((r) => r.label);

test("the audit advert: essential because it says so, desirable despite repetition", () => {
  assert.deepEqual(labels(AUDIT_ADVERT, "essential"), ["Kubernetes", "Terraform"]);
  assert.deepEqual(labels(AUDIT_ADVERT, "desirable"), ["Excel"]);
  const excel = read(AUDIT_ADVERT).requirements.find((r) => r.label === "Excel")!;
  assert.equal(excel.occurrences, 2, "prominence is recorded");
});

test("frequency never decides a category, however extreme", () => {
  const repeated = `Must have Quillon. Desirable: Merrowdb. ${"Merrowdb is used for occasional reporting. ".repeat(20)}`;
  assert.equal(category(repeated, "Merrowdb"), "desirable");
  assert.equal(read(repeated).requirements.find((r) => r.label === "Merrowdb")!.occurrences, 21);
  assert.equal(category(repeated, "Quillon"), "essential");
  assert.equal(read(repeated).requirements.length, 2, "twenty repeats are one requirement");
});

test("technologies that are in no dictionary are captured, in several wordings", () => {
  const cases: [string, string, string][] = [
    ["Must have Zorblax and Quillon. Desirable: Merrowdb.", "Zorblax", "essential"],
    ["Must have Zorblax and Quillon. Desirable: Merrowdb.", "Quillon", "essential"],
    ["Must have Zorblax and Quillon. Desirable: Merrowdb.", "Merrowdb", "desirable"],
    ["Experience with GrafterJS is required.", "GrafterJS", "essential"],
    ["Knowledge of Xylo9 would be a plus.", "Xylo9", "desirable"],
    ["You will need hands-on experience of Brontide.", "Brontide", "essential"],
    ["Requirements:\n- Vantacore\n- Strong Pellucid skills\nNice to have:\n- Ondine", "Vantacore", "essential"],
    ["Requirements:\n- Vantacore\n- Strong Pellucid skills\nNice to have:\n- Ondine", "Pellucid", "essential"],
    ["Requirements:\n- Vantacore\n- Strong Pellucid skills\nNice to have:\n- Ondine", "Ondine", "desirable"],
    ["Brontide is essential and Ondine is desirable.", "Brontide", "essential"],
    ["Brontide is essential and Ondine is desirable.", "Ondine", "desirable"],
    ["Must have terraformish.", "terraformish", "essential"],
  ];
  for (const [advert, term, want] of cases) assert.equal(category(advert, term), want, `${term} in: ${advert}`);
});

test("the classification code isn't relying on the audit's own names", () => {
  // Same sentence shapes as the audit advert with every name swapped: the same structure has to come back.
  const shape = (a: string, b: string, c: string) => `Must have ${a} and ${b}. Desirable: ${c}. ${c} is used for occasional reporting.`;
  const r = read(shape("Fennimore", "Ashgrove", "Tallowdesk")).requirements.map((x) => [x.label, x.category, x.occurrences]);
  assert.deepEqual(r, [["Fennimore", "essential", 1], ["Ashgrove", "essential", 1], ["Tallowdesk", "desirable", 2]]);
});

test("A or B is one requirement with two ways to meet it", () => {
  const { requirements } = read("Must have Terraform or Pulumi.");
  assert.equal(requirements.length, 1);
  assert.deepEqual(requirements[0].terms, ["Terraform", "Pulumi"]);
  assert.equal(requirements[0].category, "essential");
  assert.deepEqual(read("Must have Quillon, Merrowdb or Ondine.").requirements.map((r) => r.terms), [["Quillon", "Merrowdb", "Ondine"]]);
  assert.deepEqual(read("Experience with Quillon/Ondine is required.").requirements.map((r) => r.terms), [["Quillon", "Ondine"]]);
  assert.deepEqual(read("Must have either Quillon and/or Ondine.").requirements.map((r) => r.terms), [["Quillon", "Ondine"]]);
  assert.deepEqual(read("Must have Quillon and Ondine.").requirements.map((r) => r.terms), [["Quillon"], ["Ondine"]], "and is not or");
  assert.deepEqual(read("Experience of CI/CD is essential.").requirements.map((r) => r.terms), [["CI/CD"]], "a slash inside a name is not an alternative");
});

test("or similar and examples stay what they are", () => {
  const similar = read("Experience with Power BI or similar tools is a plus.").requirements[0];
  assert.deepEqual(similar.terms, ["Power BI"]);
  assert.equal(similar.orEquivalent, true);
  assert.equal(similar.category, "desirable");
  const example = read("Requirements:\n- BI tools such as Looker or Metabase").requirements[0];
  assert.deepEqual(example.terms, ["Looker", "Metabase"]);
  assert.equal(example.category, "essential");
});

test("no experience necessary keeps its meaning", () => {
  for (const phrase of ["No experience necessary.", "No prior experience necessary.", "No previous experience is required.", "You don't need any experience.", "Experience is not required."]) {
    const r = read(`Junior role. ${phrase} Must have Quillon.`);
    assert.ok(r.notRequired.length === 1, `not recorded: ${phrase}`);
    assert.ok(!r.requirements.some((q) => q.kind === "experience" || /experience/i.test(q.label)), `became a barrier: ${phrase}`);
    assert.equal(r.notRequired[0].source.quote, phrase.replace(/\.$/, "."), "quoted from the advert");
    assert.deepEqual(r.requirements.map((q) => q.label), ["Quillon"]);
  }
});

test("a negated skill or qualification is not a requirement", () => {
  const r = read("No Zorblax experience required. A degree is not essential. Must have Quillon.");
  assert.deepEqual(r.requirements.map((q) => q.label), ["Quillon"]);
  assert.deepEqual(r.notRequired.map((n) => n.label), ["Zorblax experience", "A degree"]);
  assert.ok(r.notRequired[0].terms.includes("Zorblax"));
  // "Not essential, but..." is a preference, not a dismissal.
  assert.equal(category("Quillon is not essential but would be useful.", "Quillon"), "desirable");
});

test("a preference stated around a negation stays a preference, and only there", () => {
  assert.equal(category("Experience with Quillon would be useful but is not essential.", "Quillon"), "desirable");
  assert.equal(category("Experience with Quillon is not required but welcome.", "Quillon"), "desirable");
  const both = read("No degree required, but Quillon would be useful.");
  assert.deepEqual(both.notRequired.map((n) => n.label), ["Degree"]);
  assert.deepEqual(both.requirements.map((r) => [r.label, r.category]), [["Quillon", "desirable"]]);
});

test("realistic wording doesn't turn into false requirements", () => {
  const advert = "You must be organised, have excellent written English and hold a full UK driving licence. You will work with Product Managers. We require a qualifying law degree. Desirable: experience in acute care. Fluent Breton is an advantage.";
  const r = read(advert).requirements;
  assert.ok(!r.some((q) => q.label.toLowerCase() === "hold"), "a stray verb is not a skill");
  assert.ok(!r.some((q) => q.label === "Product Managers"), "people are not a product");
  assert.equal(r.find((q) => q.label === "English")!.assessable, false);
  assert.equal(r.find((q) => /driving licence/.test(q.label))!.assessable, false);
  assert.equal(r.find((q) => /law degree/.test(q.label))!.kind, "qualification");
  assert.equal(r.find((q) => q.label === "acute care")!.category, "desirable");
  assert.equal(r.find((q) => q.label === "Breton")!.category, "desirable");
});

test("an advert that contradicts itself is uncertain, not resolved by guessing", () => {
  assert.equal(category("Must have Quillon. Quillon is desirable.", "Quillon"), "uncertain");
  assert.equal(category("Must have Quillon. Quillon is not required.", "Quillon"), "uncertain");
});

test("work descriptions are contextual and company copy is ignored", () => {
  const advert = "About us\nWe use Nimbusware and care about people.\nWhat you will do\nYou will build pipelines using Airwick.\nRequirements\nQuillon";
  assert.equal(category(advert, "Nimbusware"), undefined);
  assert.equal(category(advert, "Airwick"), "contextual");
  assert.equal(category(advert, "Quillon"), "essential");
  assert.equal(category("You will use SQL every day.", "SQL"), "contextual");
  assert.equal(category("Excel is used for reporting.", "Excel"), "contextual");
});

test("headings only count when they are headings", () => {
  assert.equal(category("Requirements gathering with clients is part of the job. Must have Quillon.", "Quillon"), "essential");
  assert.equal(category("Nice to have:\n- AWS\n- Experience with Ondine", "AWS"), "desirable");
  assert.equal(category("Nice to have:\n- AWS\n- Experience with Ondine", "Ondine"), "desirable", "a bullet starting with Experience is not a new heading");
  assert.equal(category("Skills:\n- Quillon", "Quillon"), "uncertain", "a bare Skills heading doesn't say it is required");
});

test("conditions a CV can't settle are kept but marked", () => {
  const r = read("Requirements:\n- 3+ years of Quillon experience\n- Right to work in the UK\n- Full driving licence\n- Must be based in Leeds\n- A 2:1 degree in Maths, Physics or Engineering").requirements;
  const of = (label: RegExp) => r.find((q) => label.test(q.label));
  assert.equal(of(/years/)!.kind, "experience");
  assert.equal(of(/years/)!.assessable, false);
  assert.equal(of(/^Quillon$/)!.assessable, true, "the skill inside a years phrase is still a skill");
  assert.equal(of(/Right to work/)!.kind, "eligibility");
  assert.equal(of(/licence/)!.assessable, false);
  assert.equal(of(/based in/)!.kind, "location");
  assert.equal(of(/degree/)!.kind, "qualification");
  assert.match(of(/degree/)!.label, /Maths, Physics or Engineering/, "the subject list stays inside the degree");
});

test("synonyms group, including ones the advert itself defines", () => {
  const a = read("Must have Quillon (QLN). Quillon and QLN are both used daily. Must have Postgres. PostgreSQL is required.").requirements;
  assert.equal(a.filter((r) => r.terms.some((t) => termKey(t) === "postgresql")).length, 1, "Postgres and PostgreSQL are one requirement");
  const q = a.find((r) => r.label === "Quillon")!;
  assert.deepEqual(q.aliases, ["QLN"]);
  assert.equal(a.filter((r) => /Quillon|QLN/.test(r.label)).length, 1);
});

test("everyday words are not mistaken for products", () => {
  assert.equal(findTerm("I excel at reading and go to the gym", "Excel").length, 0);
  assert.equal(findTerm("I excel at reading and go to the gym", "Go").length, 0);
  assert.equal(findTerm("Built tools in Excel and Go", "Excel").length, 1);
  assert.equal(findTerm("EXCEL", "Excel").length, 1);
  assert.equal(findTerm("Used python daily", "Python").length, 1);
  assert.equal(findTerm("C++ and C#", "C").length, 0);
  assert.equal(findTerm("Used Résumé Parser", "Resume Parser").length, 1, "accents don't hide a match");
  assert.equal(findTerm("Node.js", "Node.js").length, 1);
});

test("every requirement quotes the advert at the position it claims", () => {
  const advert = "Graduate Analyst\nRequirements:\n• Must have Quillon, Ondine or Merrowdb.\n• A 2:1 degree in any subject.\nNo experience necessary.\nDesirable: Pellucid and teamwork.\nYou will use SQL.";
  const r = read(advert);
  for (const q of [...r.requirements.map((x) => x.source), ...r.notRequired.map((x) => x.source)]) {
    assert.equal(advert.slice(q.range!.start, q.range!.end), q.quote);
    assert.ok(q.quote.length > 0);
  }
});

test("same advert, same reading", () => {
  assert.deepEqual(read(AUDIT_ADVERT), read(AUDIT_ADVERT));
});

test("hostile input stays quick", () => {
  const started = Date.now();
  read(`${"a ".repeat(6000)}must have ${"(((".repeat(1000)}`);
  read(`${"Requirement, ".repeat(1100)}`);
  assert.ok(Date.now() - started < 3000, `${Date.now() - started}ms`);
});

/* ---------- The optional semantic adapter, with simulated responses only ---------- */

const VAGUE = "We're after a bright person. Our analysts spend most days inside Quillon and a dash of Merrowdb. Candidates tend to know Ondine.";

test("a valid adapter result fills what the rules left open, quoted from the advert", () => {
  const rules = extractRequirements(VAGUE);
  const raw = { requirements: [{ label: "Quillon", terms: ["Quillon"], category: "essential", kind: "tool", quote: "Our analysts spend most days inside Quillon and a dash of Merrowdb." }] };
  const { extraction, status } = mergeSemanticRequirements(VAGUE, rules, raw);
  assert.equal(status, "applied");
  const q = extraction.requirements.find((r) => r.label === "Quillon")!;
  assert.equal(q.category, "essential");
  assert.equal(q.method, "ai");
  assert.equal(VAGUE.slice(q.source.range!.start, q.source.range!.end), q.source.quote);
});

test("adapter output that isn't in the advert is rejected item by item", () => {
  const rules = extractRequirements(AUDIT_ADVERT);
  const raw = {
    requirements: [
      { label: "Invented", terms: ["Invented"], category: "essential", kind: "tool", quote: "Must have Invented." },
      { label: "Docker", terms: ["Docker"], category: "essential", kind: "tool", quote: "Must have Kubernetes and Terraform." },
      { label: "Excel", terms: ["Excel"], category: "essential", kind: "tool", quote: "Desirable: Excel." },
      { label: "Kubernetes", terms: ["Kubernetes"], category: "desirable", kind: "tool", quote: "Must have Kubernetes and Terraform." },
    ],
  };
  const { extraction, rejected } = mergeSemanticRequirements(AUDIT_ADVERT, rules, raw);
  assert.equal(rejected, 4, "made-up quote, term outside quote, and two categories the quotation contradicts");
  assert.deepEqual(extraction.requirements.map((r) => [r.label, r.category]), rules.requirements.map((r) => [r.label, r.category]));
});

test("the adapter can't overrule the advert's stated wording, or negation", () => {
  const advert = "No Quillon experience required. Must have Ondine. Merrowdb is mentioned here.";
  const rules = extractRequirements(advert);
  const raw = { requirements: [
    { label: "Quillon", terms: ["Quillon"], category: "essential", kind: "tool", quote: "No Quillon experience required." },
    { label: "Ondine", terms: ["Ondine"], category: "contextual", kind: "tool", quote: "Must have Ondine." },
  ] };
  const { extraction } = mergeSemanticRequirements(advert, rules, raw);
  assert.ok(!extraction.requirements.some((r) => r.label === "Quillon"));
  assert.equal(extraction.requirements.find((r) => r.label === "Ondine")!.category, "essential");
});

test("malformed provider results fail safe to the rules", async () => {
  const rules = extractRequirements(VAGUE);
  const garbage: unknown[] = [null, 42, "nonsense", {}, { requirements: "all of them" }, { requirements: [{ label: "x" }] }, { requirements: [{ label: "x", terms: [], category: "essential", kind: "tool", quote: "x" }] }, { requirements: [{ label: "x", terms: ["x"], category: "vital", kind: "tool", quote: "x" }] }];
  for (const raw of garbage) {
    const out = await extractWithAdapter(VAGUE, async () => raw);
    assert.equal(out.status, "failed", JSON.stringify(raw));
    assert.deepEqual(out.extraction, rules);
  }
  const thrown = await extractWithAdapter(VAGUE, async () => {
    throw new Error("provider down");
  });
  assert.equal(thrown.status, "failed");
  assert.deepEqual(thrown.extraction, rules);
});

test("with no adapter, and when the rules are sure, no provider is called", async () => {
  assert.equal((await extractWithAdapter(VAGUE)).status, "not_used");
  let calls = 0;
  const sure = "Must have Quillon, Ondine and Merrowdb. Desirable: Pellucid.";
  const out = await extractWithAdapter(sure, async () => {
    calls++;
    return { requirements: [] };
  });
  assert.equal(calls, 0);
  assert.equal(out.status, "not_used");
  let vagueCalls = 0;
  await extractWithAdapter(VAGUE, async () => {
    vagueCalls++;
    return { requirements: [] };
  });
  assert.equal(vagueCalls, 1, "an undecided advert does ask");
});
