import assert from "node:assert/strict";
import { test } from "node:test";
import { analyseCv, band, findCheck, judgmentFromLine, ruleRewrite } from "@/lib/analysis/cv";
import { highlightJob, htmlToText, jobKeywords, matchScores } from "@/lib/analysis/job";
import { buildTailoredCv, checkTailorDraft, keepsNumbers, structureCv } from "@/lib/analysis/tailor";
import { draftLetterRuleBased, reviewLetter } from "@/lib/analysis/letter";
import { cleanRole, parseCv } from "@/lib/analysis/parse";
import { DEMO_CVS, DEMO_LETTER, SAMPLE_OPPORTUNITIES } from "@/lib/seed-data";

const wordCountOf = (s: string) => s.split(/\s+/).filter((w) => /\w/.test(w)).length;

const v3 = DEMO_CVS[0].text;
const v6 = DEMO_CVS[3].text;
const ad = SAMPLE_OPPORTUNITIES[0].description;

test("score bands match the prototype thresholds", () => {
  // Thresholds are the rubric's; the words are labels.ts (OP-003), and the top band describes the document, not an outcome.
  assert.equal(band(49), "Needs work");
  assert.equal(band(50), "Getting there");
  assert.equal(band(75), "Strong");
  assert.equal(band(90), "Very strong");
});

test("parser finds sections, bullets and contact details", () => {
  const p = parseCv(v6);
  assert.deepEqual(["education", "experience", "projects", "skills", "interests"].filter((s) => p.sections.includes(s)).length, 5);
  assert.ok(p.bullets.length >= 12, `expected bullets, got ${p.bullets.length}`);
  assert.equal(p.email, "jordan.reed@email.com");
  assert.ok(p.linkedin);
  assert.equal(p.name, "Jordan Reed");
});

test("parser reads PDFs with letter-spaced headings, no bullet characters and wrapped lines", () => {
  // How text comes out of many designed PDF CVs: headings lose their word gaps, bullet glyphs are dropped,
  // and wrapped lines can start with a capital.
  const pdf = [
    "Sam Okoro",
    "London · 07700 900123 · sam.okoro@email.com",
    "P R O F I L E",
    "Marketing analyst with three years of experience in SEO and lifecycle email.",
    "W O R K E X P E R I E N C E",
    "Lead Marketing Analyst · Brightfold Ltd June 2024 to present",
    "Lead the SEO and email programme for two consumer brands across UK and German markets, reporting to the",
    "Head of Growth and working closely with product and design teams.",
    "Grew organic clicks from 4,200 to 19,800 a month through a technical and content SEO programme.",
    "Run weekly A/B tests on subject lines and landing pages, lifting email click rates by 18 per cent across",
    "Google and Meta campaigns.",
    "Rebuilt more than 300 articles using keyword research from Search Console and an editorial checklist.",
    "Content Assistant · Northway Media September 2022 to May 2024",
    "Produced more than 200 listings and ran the content calendar across the website and social channels.",
    "E D U C A T I O N",
    "BSc Economics · University of Northfield 2019 to 2022",
    "S K I L L S",
    "SEO, GA4, Search Console, Brevo, A/B testing",
  ].join("\n");
  const p = parseCv(pdf);
  assert.deepEqual(p.sections, ["summary", "experience", "education", "skills"]);
  const texts = p.bullets.map((b) => b.text);
  assert.equal(texts.length, 5, texts.join("\n"));
  assert.ok(texts[0].startsWith("Lead the SEO") && texts[0].endsWith("product and design teams."), "wrapped line starting with a capital is joined");
  assert.ok(texts[2].endsWith("Google and Meta campaigns."));
  assert.ok(texts.some((t) => t.startsWith("Rebuilt")));
  assert.ok(!texts.some((t) => t.startsWith("Lead Marketing Analyst") || t.startsWith("Content Assistant")), "role lines aren't bullets");
  assert.equal(p.bullets[4].role, "Content Assistant · Northway Media September 2022 to May 2024");
});

test("with no bullets found, the step text asks for bullets instead of resizing zero", () => {
  const a = analyseCv("Sam Okoro\nsam@email.com\nExperience\nAnalyst at a firm\nEducation\nBSc", "Technology");
  assert.ok(!a.steps.some((s) => /Resize 0/.test(s.text)), JSON.stringify(a.steps.map((s) => s.text)));
});

test("present-tense verbs for a current role count as action verbs", () => {
  const cv = (bullet: string) => `Sam Okoro\nsam@email.com\nExperience\nAnalyst · Fenwick 2024 to present\n• ${bullet}\nEducation\nBSc Economics`;
  for (const b of ["Run the CRM programme for two brands across UK and German markets.", "Lead the SEO programme for two consumer brands in four markets.", "Manage a team of three analysts producing weekly revenue reports."]) {
    const line = analyseCv(cv(b), "Technology").lines[0];
    assert.ok(!line.cols.flatMap((c) => c.items).some((i) => !i.ok && /action verb/.test(i.t)), `${b}: ${JSON.stringify(line.cols)}`);
  }
});

test("role labels drop dates", () => {
  assert.equal(cleanRole("Summer Intern, Harlow Partners | June 2026 – August 2026"), "Summer Intern, Harlow Partners");
  assert.equal(cleanRole("Customer Assistant, Greenway Supermarket | 2023 – 2024"), "Customer Assistant, Greenway Supermarket");
});

test("a stronger CV scores higher than a weaker one", () => {
  const weak = analyseCv(v3, "Finance and banking");
  const strong = analyseCv(v6, "Finance and banking");
  assert.ok(strong.score > weak.score, `${strong.score} should beat ${weak.score}`);
  assert.equal(strong.areas.length, 6);
  for (const a of strong.areas) for (const c of a.checks) assert.ok(c.score >= 0 && c.score <= 10);
});

test("checks catch specific problems", () => {
  const a = analyseCv(v3, "Finance and banking");
  assert.ok(findCheck(a, "verbs")!.affected.length > 0, "weak verbs");
  assert.ok(findCheck(a, "sections")!.summary.includes("References"), "references line");
  assert.ok(findCheck(a, "buzz")!.extras!.length > 0, "buzzwords");
  assert.ok(findCheck(a, "spell")!.score < 10, "US spelling");
  const empty = analyseCv("Jordan\nEDUCATION\nBSc", "Consulting");
  assert.ok(empty.score < 40, "near-empty CV scores low");
});

test("rewrites leave placeholders and never invent numbers", () => {
  const r = ruleRewrite("Helped organise events for the Economics Society.");
  assert.match(r, /^Jointly organised/, "a shared task stays shared");
  assert.match(ruleRewrite("Helped manage a £5,000 monthly budget for the society."), /^Jointly managed/);
  assert.doesNotMatch(ruleRewrite("Supported the team with weekly reports for the society."), /^(Built|Led)/);
  assert.match(r, /\[number\]/);
  assert.equal(ruleRewrite("Raised £2,400 for a student-led charity week, beating the target by 20%."), "This line is already strong. No rewrite needed.");
});

test("rewrite placeholders go at the end, never inside a phrase, and the suggestion stays short", () => {
  const lines = [
    "Developed an adaptive Challenge Builder that uses customer preferences and current product information to route prospective customers into a suitable product journey.",
    "Designed and automated Hyros reports monitoring campaign performance, audience segmentation and return on investment.",
    "Managed CRM segmentation and personalised content across an international customer base.",
    "Ran A/B tests on subject lines, CTAs, landing pages and email design, and worked with cross-functional teams to keep campaigns consistent with the brand.",
  ];
  for (const t of lines) {
    const r = ruleRewrite(t);
    assert.ok(!/\[number\] (customer|reports)/.test(r), r);
    assert.ok(/, (which|resulting|lifting)[^,]*\.$/.test(r), `placeholder at the end: ${r}`);
    assert.ok(wordCountOf(r) <= 25, `${wordCountOf(r)} words: ${r}`);
  }
  assert.match(ruleRewrite("Ran A/B tests on subject lines, CTAs, landing pages and email design, and worked with cross-functional teams to keep campaigns consistent with the brand."), /^Ran A\/B tests on subject lines, CTAs, landing pages and email design, which/);
  assert.match(ruleRewrite("Introduced AI-assisted workflows that let a small team deliver significantly more output."), /deliver \[X%\] more output\.$/);
  assert.equal(ruleRewrite("Improved email engagement through testing and template redesign in Brevo."), "Improved email engagement by [X%] through testing and template redesign in Brevo.");
  assert.doesNotMatch(ruleRewrite("Created a dynamic Tableau dashboard visualising key marketing metrics for management."), /dynamic/);
});

test("a rewrite follows the judgment that scored the line", () => {
  const t = "Managed approximately £51,000 of monthly ad spend across Google and Meta.";
  assert.match(ruleRewrite(t), /already strong/);
  assert.match(ruleRewrite(t, 0, { result: "measured", verb: "strong", kind: "duty", relevance: "high" }), /\[X%\]|\[result/, "a duty line gets asked for its result");
  const line = analyseCv(`Sam Okoro\nsam@email.com\nExperience\nAnalyst · Fenwick 2024 to present\n• Supported lead-generation projects using Google Analytics.\nEducation\nBSc`, "Technology").lines[0];
  assert.deepEqual(judgmentFromLine(line).verb, "weak");
});

test("accomplishments are scored by the share of duty-style lines", () => {
  const cv = (duties: number, total: number) => `Sam Okoro\nsam@email.com\nExperience\nAnalyst · Fenwick 2024 to present\n${Array.from({ length: total }, (_, i) => (i < duties ? `• Responsible for weekly report number ${i + 1} for the sales team.` : `• Cut report time by ${i + 10} per cent for the sales team in one quarter.`)).join("\n")}\nEducation\nBSc`;
  assert.equal(findCheck(analyseCv(cv(4, 26), "Technology"), "accomp")!.score, 7);
  assert.equal(findCheck(analyseCv(cv(4, 6), "Technology"), "accomp")!.score, 0);
});

test("job keywords split into found and missing, with must-haves", () => {
  const k = jobKeywords(ad, v6);
  const sql = k.find((x) => x.w === "SQL")!;
  assert.ok(sql && !sql.inCv && sql.must);
  assert.ok(k.find((x) => x.w === "Excel")!.inCv);
  const m = matchScores(k);
  assert.ok(m.tailored > m.now);
  const jd = highlightJob(ad, k);
  assert.ok(jd.some((b) => b.isH));
  assert.ok(jd.some((b) => b.segs?.some((s) => s.kind === "missing")));
});

test("letter review flags the sign-off and keywords", () => {
  const r = reviewLetter(DEMO_LETTER, ad, "Northbank", v6);
  assert.equal(r.checks.find((c) => c.t === "Sign-off matches the greeting")!.ok, false);
  assert.ok(r.keywordsMissing.length > 0);
  assert.ok(r.score > 0 && r.score <= 100);
});

test("rule-based draft uses only CV facts and UK conventions", () => {
  const analysis = analyseCv(v6, "Finance and banking");
  const paras = draftLetterRuleBased({ name: "Jordan Reed", email: null, phone: null, jobTitle: "Analyst Graduate Scheme", employer: "Northbank", jobText: ad, cvText: v6, analysis, addressee: "Ms Taylor", notes: null, stageLabel: "final-year student" });
  assert.equal(paras[0].text, "Dear Ms Taylor,");
  assert.match(paras[paras.length - 1].text, /^Yours sincerely,/);
  assert.ok(paras.some((p) => p.src.some((s) => s.startsWith("CV ·"))));
  const body = paras.map((p) => p.text).join(" ");
  assert.ok(!/\| ?(June|2026)/.test(body), "no raw dates leak into the letter");
});

test("draft never links a CV line to a skill it doesn't show, and has a usable length", () => {
  const analysis = analyseCv(v6, "Finance and banking");
  const dataAd = "Graduate Data Analyst\nWHAT YOU WILL DO\nBuild dashboards in Power BI and Tableau, write SQL queries.\nWHAT WE LOOK FOR\nStrong Excel and SQL skills, attention to detail.";
  const paras = draftLetterRuleBased({ name: "Jordan Reed", email: null, phone: null, jobTitle: "Graduate Data Analyst", employer: "Brightline Data", jobText: dataAd, cvText: v6, analysis, addressee: null, notes: "I met two of your analysts at a careers fair", stageLabel: "final-year student" });
  const body = paras.map((p) => p.text).join(" ");
  assert.ok(!/taught me about/i.test(body));
  assert.ok(!/\bSQL\b|Power BI|Tableau/.test(body), "missing tools must not appear as claims");
  assert.match(body, /Graduate Data Analyst role/);
  const r = reviewLetter(body, dataAd, "Brightline Data", v6);
  assert.ok(r.checks.find((c) => c.t === "Says why this employer")!.ok, "student's reason counts");
  assert.ok(r.words >= 200, `draft too short: ${r.words} words`);
});

test("rubric area weights add up to 1", async () => {
  const { AREA_WEIGHTS } = await import("@/lib/analysis/rubric");
  assert.equal(Math.round(Object.values(AREA_WEIGHTS).reduce((a: number, b) => a + b, 0) * 1000), 1000);
});

test("job pages: the embedded JobPosting gives title, employer, deadline and clean text", () => {
  const desc = "&lt;p&gt;You will build financial models in Excel and SQL for our clients.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Work with stakeholders&lt;/li&gt;&lt;/ul&gt;".repeat(4);
  const ld = { "@context": "https://schema.org", "@graph": [{ "@type": "WebPage" }, { "@type": "JobPosting", title: "Graduate Analyst", hiringOrganization: { "@type": "Organization", name: "Northbank" }, validThrough: "2099-01-31T23:59", description: desc }] };
  const html = `<html><head><title>Careers | Northbank</title><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><nav>Menu</nav><p>Accept cookies</p></body></html>`;
  const page = htmlToText(html);
  assert.equal(page.title, "Graduate Analyst");
  assert.equal(page.employer, "Northbank");
  assert.equal(page.deadline, "2099-01-31");
  assert.match(page.text, /^Graduate Analyst\n/);
  assert.match(page.text, /• Work with stakeholders/);
  assert.doesNotMatch(page.text, /cookies|<p>/);
});

test("job pages: Greenhouse titles, past deadlines and pages without JobPosting", () => {
  const body = "<p>" + "We are hiring an engineer to build our Android app. ".repeat(10) + "</p>";
  const gh = htmlToText(`<title>Job Application for Android Engineer at Monzo</title>${body}`);
  assert.equal(gh.title, "Android Engineer");
  assert.equal(gh.employer, "Monzo");
  assert.equal(gh.deadline, null);
  assert.match(gh.text, /Android app/);
  const old = htmlToText(`<script type="application/ld+json">{"@type":"JobPosting","title":"X","validThrough":"2001-01-01"}</script>${body}`);
  assert.equal(old.deadline, null);
  assert.match(old.text, /Android app/, "a short description falls back to the page text");
  assert.equal(htmlToText(`<script type="application/ld+json">{broken</script>${body}`).title, null);
});

test("tailoring never adds a number the CV doesn't have", () => {
  assert.ok(keepsNumbers("Raised £2400 for 6 charities", "Raised £2,400 across 6 charities"));
  assert.ok(keepsNumbers("Cut costs by [X%] for a team of 6", "Cut costs for a team of 6"));
  assert.ok(!keepsNumbers("Cut costs by 30%", "Cut costs"));
  const lines = [{ text: "Helped run 4 society events for students" }, { text: "Built a budget tracker in Excel" }, { text: "Monitored campaign performance and return on investment" }];
  const out = checkTailorDraft(
    {
      summary: "Economics student with 5 years of banking experience.",
      bullets: [
        { id: 0, after: "Coordinated 4 society events for 200 students", keywords: ["Events"] },
        { id: 1, after: "Built an Excel budget tracker used to plan [X] events", keywords: ["Excel", "excel", "Budgeting"] },
        { id: 1, after: "A second version of the same line, which is dropped", keywords: [] },
        { id: 2, after: "Tracked campaign performance and return on investment", keywords: [] },
        { id: 9, after: "A line that isn't in the CV at all, so it goes", keywords: [] },
      ],
      skills: ["Excel", "Budgeting", "budgeting", "SQL"],
      notEvidenced: ["SQL"],
    },
    lines,
    "Helped run 4 society events for students\nBuilt a budget tracker in Excel",
    [],
    "Run society events. Budgeting in Excel. SQL.",
  );
  assert.equal(out.summary, "", "the invented 5 years is dropped");
  assert.deepEqual(out.bullets.map((b) => b.id), [0, 1], "duplicates, unknown ids and one-word swaps go");
  assert.equal(out.bullets[0].after, "Coordinated 4 society events for [X] students", "200 students is invented: asked for, as a line rewrite does");
  assert.deepEqual(out.bullets[1].keywords, ["Excel", "Budgeting"]);
  assert.deepEqual(out.skills, ["Budgeting"], "skills already named in the CV, or also listed as unproven, aren't added");
  assert.deepEqual(out.notEvidenced, ["SQL"]);
});

test("the tailored CV swaps bullets, adds a profile and new skills", () => {
  const cv = ["Ada Lovelace", "ada@uni.ac.uk", "", "EXPERIENCE", "Analyst Intern, Northbank", "• Built a budget tracker in Excel for the", "  finance team", "", "SKILLS", "Excel, Python", "", "INTERESTS", "Chess"].join("\n");
  const out = buildTailoredCv(cv, {
    summary: "Economics student who builds finance tools.",
    replacements: [{ from: "Built a budget tracker in Excel for the finance team", to: "Built an Excel budget tracker that the finance team used to plan spending" }],
    skills: ["Financial modelling"],
  });
  const lines = out.split("\n");
  assert.equal(lines[lines.indexOf("PROFILE") + 1], "Economics student who builds finance tools.");
  assert.ok(lines.indexOf("PROFILE") < lines.indexOf("EXPERIENCE"), "the profile goes above the first section");
  assert.ok(lines.includes("• Built an Excel budget tracker that the finance team used to plan spending"), "a wrapped bullet is matched across lines");
  assert.ok(lines.indexOf("• Financial modelling") > lines.indexOf("Excel, Python") && lines.indexOf("• Financial modelling") < lines.indexOf("INTERESTS"));
  const withProfile = buildTailoredCv(["Ada", "PROFILE", "Old profile line one", "Old line two", "", "EXPERIENCE", "• Did a thing at work"].join("\n"), { summary: "New profile.", replacements: [], skills: [] });
  assert.deepEqual(withProfile.split("\n").slice(0, 4), ["Ada", "PROFILE", "New profile.", ""]);
  assert.ok(!withProfile.includes("Old profile"));
});

test("the tailored CV is laid out as a CV for Word and PDF", () => {
  const text = [
    "London · 07700 900123",
    "Ada Lovelace",
    "ada@uni.ac.uk",
    "D I G I T A L M A R K E T I N G & S E O linkedin.com/in/ada",
    "P R O F I L E",
    "Marketing graduate who grows organic traffic.",
    "W O R K E X P E R I E N C E",
    "Marketing Intern · Northbank · Jun 2025 - Present",
    "Fintech serving 2,000 small businesses.",
    "Grew organic search impressions 40% through a structured technical",
    "and content SEO programme.",
    "Wrote 30 blog posts on saving money.",
    "Ran the company newsletter for 1,200 readers.",
    "SKILLS",
    "SEO (SEMrush, Ahrefs,",
    "Screaming Frog)",
    "GA4 & Search Console",
  ].join("\n");
  const blocks = structureCv(text, ["Grew organic search impressions 40% through a structured technical and content SEO programme.", "Wrote 30 blog posts on saving money."]);
  const kinds = (k: string) => blocks.filter((b) => b.kind === k).map((b) => b.text);
  assert.deepEqual(kinds("name"), ["Ada Lovelace"]);
  assert.deepEqual(kinds("tagline"), ["DIGITAL MARKETING & SEO"]);
  assert.deepEqual(kinds("contact"), ["London  ·  07700 900123  ·  ada@uni.ac.uk  ·  linkedin.com/in/ada"]);
  assert.deepEqual(kinds("heading"), ["Profile", "Work experience", "SKILLS"]);
  assert.deepEqual(blocks.find((b) => b.kind === "role"), { kind: "role", text: "Marketing Intern · Northbank", date: "Jun 2025 - Present" });
  assert.deepEqual(kinds("para"), ["Marketing graduate who grows organic traffic.", "Fintech serving 2,000 small businesses."]);
  assert.deepEqual(kinds("bullet"), [
    "Grew organic search impressions 40% through a structured technical and content SEO programme.",
    "Wrote 30 blog posts on saving money.",
    "Ran the company newsletter for 1,200 readers.",
    "SEO (SEMrush, Ahrefs, Screaming Frog)",
    "GA4 & Search Console",
  ]);
});

test("letter-spaced headings keep their own names and wrapped list text stays whole", () => {
  const wide = "x".repeat(100);
  const text = [
    "Ada Lovelace",
    "ada@uni.ac.uk",
    "P R O F I L E",
    `Marketing graduate. ${wide}`,
    "P U B L I C A T I O N H I S T O R Y",
    '"Funding round announced," company press release distributed through EIN Presswire, 22 June 2026. Named',
    "author contact in the distributor record.",
    "C E R T I F I C A T I O N S",
    "Google: Google Analytics Certification (2025). Ahrefs: Certified Specialist (2025). HubSpot: SEO, Digital",
    "Marketing, Content Marketing (2025). Semrush: Navigating On-Page and Technical SEO, Content-Led SEO (2025).",
    "Klaviyo: Product (2025).",
    "L A N G U A G E S",
    "English",
    "French",
    "R E F E R E N C E S",
    "Available on request.",
  ].join("\n");
  const blocks = structureCv(text, []);
  assert.deepEqual(blocks.filter((b) => b.kind === "heading").map((b) => b.text), ["Profile", "Publication history", "Certifications", "Languages", "References"]);
  const after = (h: string) => blocks.slice(blocks.findIndex((b) => b.text === h) + 1).findIndex((b) => b.kind === "heading");
  assert.equal(after("Certifications"), 1, "the certificates are one paragraph, not a bullet per wrapped line");
  assert.match(blocks.find((b) => b.text.startsWith("Google:"))!.text, /Digital Marketing, Content Marketing \(2025\)\. Semrush:.*Klaviyo: Product \(2025\)\.$/);
  assert.equal(after("Publication history"), 1);
  assert.deepEqual(blocks.slice(-4).map((b) => [b.kind, b.text]), [["bullet", "English"], ["bullet", "French"], ["heading", "References"], ["para", "Available on request."]]);
});
