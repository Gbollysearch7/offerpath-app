import assert from "node:assert/strict";
import { test } from "node:test";
import { analyseCv } from "@/lib/analysis/cv";
import { structureCv } from "@/lib/analysis/tailor";
import { CV_EXAMPLES } from "@/lib/cv-examples";
import { CV_THEMES, MAX_TRACKING, withRoles } from "@/lib/cv-themes";
import { templateBlocks, toDocx, toPdf, type DocBlock } from "@/lib/documents";
import { extractText } from "@/lib/analysis/extract";
import { parseCv } from "@/lib/analysis/parse";

const asText = (slug: string) =>
  CV_EXAMPLES[slug]
    .filter((b) => b.kind !== "note")
    .map((b) => (b.kind === "heading" ? b.text.toUpperCase() : b.kind === "bullet" ? `• ${b.text}` : b.text))
    .join("\n");

test("there are at least 10 templates, each a different design", () => {
  assert.ok(CV_THEMES.length >= 10, `${CV_THEMES.length} templates`);
  assert.equal(new Set(CV_THEMES.map((t) => t.slug)).size, CV_THEMES.length, "slugs are unique");
  const look = (t: (typeof CV_THEMES)[number]) => JSON.stringify([t.font, t.accent, t.nameStyle, t.heading, t.date, t.bullet, t.space, t.headerRule]);
  assert.equal(new Set(CV_THEMES.map(look)).size, CV_THEMES.length, "no two templates look the same");
  for (const t of CV_THEMES) {
    assert.ok(CV_EXAMPLES[t.sample], `${t.slug}: missing example ${t.sample}`);
    assert.ok(t.nameStyle.tracking <= t.nameStyle.size * MAX_TRACKING, `${t.slug}: name letter spacing would split words`);
    assert.ok(t.heading.tracking <= t.heading.size * MAX_TRACKING, `${t.slug}: heading letter spacing would split words`);
  }
});

test("every example CV follows our own advice", () => {
  for (const slug of Object.keys(CV_EXAMPLES)) {
    const a = analyseCv(asText(slug), "Finance and banking");
    const impact = a.areas.find((x) => x.key === "impact")!.score;
    assert.ok(impact >= 70, `${slug}: impact ${impact}`);
    assert.ok(!/\[|\]/.test(asText(slug)), `${slug} still has [placeholders]`);
  }
});

test("example roles get their dates split out", () => {
  const blocks = withRoles([{ kind: "para", text: "Summer Analyst, Calder Capital | June 2025 – August 2025" }, { kind: "para", text: "University of Northfield | BSc Economics | 2023 – 2026\nPredicted 2:1." }, { kind: "para", text: "Python | pandas" }]);
  assert.deepEqual(blocks, [
    { kind: "role", text: "Summer Analyst, Calder Capital", date: "June 2025 – August 2025" },
    { kind: "role", text: "University of Northfield · BSc Economics", date: "2023 – 2026" },
    { kind: "para", text: "Predicted 2:1." },
    { kind: "para", text: "Python · pandas" },
  ]);
});

test("every template renders to Word and to a PDF that screening software can read", async () => {
  for (const t of CV_THEMES) {
    const blocks = templateBlocks(t);
    const docx = await toDocx(blocks, t);
    assert.ok(docx.byteLength > 5000, `${t.slug} docx`);
    const pdf = await toPdf(blocks, t);
    // Read the PDF back the way an ATS would, then re-parse it as a CV.
    const text = await extractText(pdf, "cv.pdf");
    const name = blocks.find((b) => b.kind === "name")!.text;
    assert.match(text.toLowerCase(), new RegExp(name.toLowerCase()), `${t.slug}: name readable`);
    const firstBullet = blocks.find((b) => b.kind === "bullet")!.text;
    assert.ok(text.replace(/\s+/g, " ").includes(firstBullet.slice(0, 40)), `${t.slug}: bullet readable`);
    const lines = new Set(text.split("\n").map((l) => l.trim().toLowerCase()));
    for (const h of blocks.filter((b) => b.kind === "heading")) assert.ok(lines.has(h.text.toLowerCase()), `${t.slug}: heading "${h.text}" reads back on its own line`);
    assert.ok(structureCv(text, []).some((b) => b.kind === "role" && b.date), `${t.slug}: role dates read back`);
  }
});

test("long CVs break pages cleanly: no split bullets, no heading or job title left at the foot of a page", async () => {
  const { getDocumentProxy } = await import("unpdf");
  const long = "Ran the lifecycle and CRM programme across two brands, with campaigns and automations that drove repeat revenue and kept churn down across";
  const blocks: DocBlock[] = [{ kind: "name", text: "Ada Lovelace" }, { kind: "contact", text: "London  ·  ada@uni.ac.uk" }];
  for (let s = 0; s < 4; s++) {
    blocks.push({ kind: "heading", text: `Section ${s}` });
    for (let r = 0; r < 3; r++) {
      blocks.push({ kind: "role", text: `Role ${s}${r} · Employer`, date: "2024 – 2025" });
      for (let b = 0; b < 4; b++) blocks.push({ kind: "bullet", text: `B${s}${r}${b} ${long} ${"several markets and channels. ".repeat(b % 3)}` });
    }
  }
  for (const t of CV_THEMES) {
    const pdf = await getDocumentProxy(await toPdf(blocks, t));
    assert.ok(pdf.numPages > 1, `${t.slug}: the test CV runs over a page`);
    for (let p = 1; p <= pdf.numPages; p++) {
      const items = (await (await pdf.getPage(p)).getTextContent()).items as { str: string; transform: number[] }[];
      // Group text into lines by height on the page, then read each line left to right.
      const rows = new Map<number, { x: number; s: string }[]>();
      for (const it of items) if (it.str.trim()) rows.set(Math.round(it.transform[5]), [...(rows.get(Math.round(it.transform[5])) ?? []), { x: it.transform[4], s: it.str }]);
      const lines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, xs]) => xs.sort((a, b) => a.x - b.x).map((x) => x.s).join(" ").replace(/^[•›–·]\s*/, "").trim());
      if (p > 1) assert.match(lines[0], /^(B\d{3} |Section |Role )/i, `${t.slug} page ${p} starts mid-bullet: "${lines[0]}"`);
      if (p < pdf.numPages) assert.doesNotMatch(lines.at(-1)!, /^(Section |Role |\d{4} – \d{4})/i, `${t.slug} page ${p} ends on "${lines.at(-1)}"`);
    }
  }
});

test("the contact line breaks between items, evened out over two lines", async () => {
  const { getDocumentProxy } = await import("unpdf");
  const contact = "London, United Kingdom  ·  07700 900555  ·  someone.long@gmail.com  ·  linkedin.com/in/someone-long-a1b2c3  ·  github.com/someone";
  const t = CV_THEMES.find((x) => x.slug === "executive")!;
  const pdf = await getDocumentProxy(await toPdf([{ kind: "name", text: "Ada" }, { kind: "contact", text: contact }], t));
  const items = (await (await pdf.getPage(1)).getTextContent()).items as { str: string }[];
  const lines = items.map((i) => i.str.replace(/ /g, " ").trim()).filter((s) => s && s.toLowerCase() !== "ada");
  assert.equal(lines.length, 2, JSON.stringify(lines));
  for (const l of lines) assert.doesNotMatch(l, /^·|·$/, `"${l}" starts or ends on a separator`);
  assert.ok(lines.every((l) => l.split(" · ").length >= 2), `no item sits alone: ${JSON.stringify(lines)}`);
});

test("every template's PDF and Word download reads back with all its bullets", async () => {
  for (const t of CV_THEMES) {
    const blocks = templateBlocks(t);
    const want = blocks.filter((b) => b.kind === "bullet").length;
    const pdf = parseCv(await extractText(await toPdf(blocks, t), "cv.pdf")).bullets.length;
    const word = parseCv(await extractText(await toDocx(blocks, t), "cv.docx")).bullets.length;
    assert.deepEqual({ slug: t.slug, pdf, word }, { slug: t.slug, pdf: want, word: want });
  }
});
