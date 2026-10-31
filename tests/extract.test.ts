import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { extractText, pdfReadingOrderText } from "@/lib/analysis/extract";
import { parseCv } from "@/lib/analysis/parse";

// A stand-in for a pdf.js document: each item is [text, x, y], drawn in the order given.
function fakePdf(pages: [string, number, number][][]) {
  return {
    numPages: pages.length,
    getPage: async (n: number) => ({
      view: [0, 0, 595, 842],
      getTextContent: async () => ({ items: pages[n - 1].map(([str, x, y]) => ({ str, transform: [10, 0, 0, 10, x, y], width: str.length * 5, hasEOL: true })) }),
    }),
  };
}

test("PDF text is read top to bottom even when headings were drawn before bullets", async () => {
  // Drawn order: both job headings first, then all the bullets (how some PDF makers write the file).
  const pdf = fakePdf([[
    ["Analyst · Fenwick Systems 2024 to present", 40, 700],
    ["Intern · Harlow Partners 2023 to 2023", 40, 600],
    ["Built a churn model that cut losses by 12 per cent.", 50, 680],
    ["Automated weekly reports for five teams.", 50, 665],
    ["Analysed sales data for 40 stores.", 50, 580],
  ]]);
  const lines = (await pdfReadingOrderText(pdf)).split("\n");
  assert.deepEqual(lines, [
    "Analyst · Fenwick Systems 2024 to present",
    "Built a churn model that cut losses by 12 per cent.",
    "Automated weekly reports for five teams.",
    "Intern · Harlow Partners 2023 to 2023",
    "Analysed sales data for 40 stores.",
  ]);
});

test("two-column PDF pages are read one column at a time, contact column first", async () => {
  const side: [string, number, number][] = ["SKILLS", "Python and SQL", "Tableau dashboards", "Excel modelling", "LANGUAGES", "English and French", "Spanish (basic)"].map((s, i) => [s, 30, 760 - i * 22]);
  const main: [string, number, number][] = ["Priya Shah", "priya@email.com · 07700 900321", "EXPERIENCE", "Data Analyst · Fenwick 2024 to present", "Built a churn model that cut losses by 12%.", "Automated reporting for five teams.", "EDUCATION", "BSc Mathematics · Northfield"].map((s, i) => [s, 230, 770 - i * 19]);
  const lines = (await pdfReadingOrderText(fakePdf([[...side, ...main]]))).split("\n");
  assert.equal(lines[0], "Priya Shah");
  assert.equal(lines.indexOf("SKILLS"), main.length, "sidebar follows the main column, unmixed");
  assert.deepEqual(lines.slice(main.length), side.map((s) => s[0]));
});

test("a real PDF goes through the parsing worker and keeps bullets under their roles", async () => {
  const text = await extractText(new Uint8Array(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/cv.pdf"))), "cv.pdf");
  const cv = parseCv(text);
  assert.equal(cv.name, "Alex Morgan");
  assert.equal(cv.email, "alex.morgan@email.com");
  assert.ok(cv.bullets.length >= 6, `bullets: ${cv.bullets.length}`);
  assert.ok(cv.bullets.every((b) => b.role), "every bullet has a role");
});
