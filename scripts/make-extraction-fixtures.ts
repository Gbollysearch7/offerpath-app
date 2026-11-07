// Generates the synthetic extraction fixtures under tests/fixtures/extraction/ (OP-005).
//
//   npm run fixtures:extraction
//
// Every document here is invented: "Alex Example" and "Sam Sample" are not people, "Example Ltd", "Fenwick
// Systems" and "Northfield University" are not real employers. Each file reproduces one structural challenge
// a real CV can present (columns, wrapped bullets, letter-spaced headings, repeated headers, symbol-font bullets,
// tables, academic sections, mixed date formats, image-only scans) so `tests/extract.test.ts` can compare what
// extraction reads against the structure a reader would expect. Dev-only: pdf-lib and docx are already
// dependencies; nothing here runs in the app. The expected structures live in tests/fixtures/extraction/expected.ts.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import zlib from "node:zlib";
import { Document, HeadingLevel, ImageRun, Packer, PageBreak, Paragraph, Table, TableCell, TableRow, TabStopType, TextRun, WidthType } from "docx";
import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from "pdf-lib";

const OUT = join(process.cwd(), "tests/fixtures/extraction");
const FIXED_DATE = new Date("2026-11-05T00:00:00Z");

/* ---------- a PNG without an image library ---------- */

/** A grey chequered PNG (8-bit RGB), built by hand so the scan fixtures need no image dependency. */
function png(w: number, h: number): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.floor(x / 12) % 2 === Math.floor(y / 12) % 2 ? 235 : 90;
      raw.set([v, v, v], y * (w * 3 + 1) + 1 + x * 3);
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/* ---------- PDF helpers ---------- */

interface Fonts {
  body: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
  symbol: PDFFont;
}

async function newPdf(): Promise<{ doc: PDFDocument; fonts: Fonts }> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  doc.setProducer("Offerpath synthetic fixtures");
  doc.setCreator("scripts/make-extraction-fixtures.ts");
  const fonts = {
    body: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier),
    symbol: await doc.embedFont(StandardFonts.ZapfDingbats),
  };
  return { doc, fonts };
}

/** Writes lines down a page from the top, like a word processor would. */
class Writer {
  y: number;
  constructor(
    readonly page: PDFPage,
    readonly fonts: Fonts,
    readonly x = 50,
    top = 790,
    readonly leading = 16,
  ) {
    this.y = top;
  }
  text(s: string, opts: { font?: PDFFont; size?: number; x?: number } = {}) {
    this.page.drawText(s, { x: opts.x ?? this.x, y: this.y, size: opts.size ?? 11, font: opts.font ?? this.fonts.body, color: rgb(0.1, 0.1, 0.1) });
    this.y -= this.leading + ((opts.size ?? 11) > 11 ? (opts.size ?? 11) - 11 : 0);
    return this;
  }
  name(s: string) {
    return this.text(s, { font: this.fonts.bold, size: 18 });
  }
  heading(s: string) {
    this.y -= 6;
    return this.text(s, { font: this.fonts.bold, size: 12 });
  }
  /** A role line with its dates drawn as a separate, right-hand run of text. */
  role(left: string, date: string, dateX = 430) {
    this.page.drawText(left, { x: this.x, y: this.y, size: 11, font: this.fonts.bold });
    this.page.drawText(date, { x: dateX, y: this.y, size: 11, font: this.fonts.body });
    this.y -= this.leading;
    return this;
  }
  bullet(s: string) {
    return this.text(`• ${s}`, { x: this.x + 10 });
  }
  /** A heading typed with a space between each letter, drawn one letter at a time as designed templates do. */
  spaced(s: string) {
    this.y -= 6;
    let x = this.x;
    for (const ch of s) {
      if (ch === " ") {
        x += 13;
        continue;
      }
      this.page.drawText(ch, { x, y: this.y, size: 12, font: this.fonts.bold });
      x += 13;
    }
    this.y -= this.leading + 1;
    return this;
  }
  /** A bullet whose marker is a ZapfDingbats tick: it comes out of text extraction as the character "3". */
  symbolBullet(s: string) {
    this.page.drawText("✓", { x: this.x, y: this.y, size: 11, font: this.fonts.symbol });
    this.page.drawText(s, { x: this.x + 14, y: this.y, size: 10, font: this.fonts.mono });
    this.y -= this.leading;
    return this;
  }
}

const CONTACT = "alex.example@example.com · 07700 900123 · linkedin.com/in/alexexample";

/* ---------- the fixtures ---------- */

async function singleColumn(): Promise<Uint8Array> {
  const { doc, fonts } = await newPdf();
  const w = new Writer(doc.addPage([595, 842]), fonts);
  w.name("Alex Example").text(CONTACT);
  w.heading("EDUCATION").role("BSc Mathematics, Northfield University", "2021 – 2024").text("First-class honours, with modules in statistics, optimisation and programming.");
  w.heading("EXPERIENCE")
    .role("Data Analyst, Example Ltd", "Jun 2024 – Present")
    .bullet("Built a churn model that cut customer losses by 12 per cent across two regions.")
    .bullet("Automated weekly reporting for five teams, saving six hours of manual work a week.")
    .role("Research Intern, Fenwick Systems", "September 2023 to December 2023", 380)
    .bullet("Analysed sales data for 40 stores and presented findings to three regional managers.")
    .bullet("Wrote Python scripts that cleaned 20,000 records a day with no manual checks.");
  w.heading("PROJECTS").role("Budget tracker app", "2023").bullet("Designed and shipped a budgeting app now used by 150 students.");
  w.heading("SKILLS").text("Python, SQL, Excel, Tableau, Git");
  return doc.save();
}

async function twoColumn(): Promise<Uint8Array> {
  const { doc, fonts } = await newPdf();
  const page = doc.addPage([595, 842]);
  // Both columns share one line grid, as sidebar templates do, so a naive top-to-bottom read would interleave them.
  const side = new Writer(page, fonts, 36, 790, 18);
  const main = new Writer(page, fonts, 215, 790, 18);
  side.text("SKILLS", { font: fonts.bold, size: 12 }).text("Python").text("SQL").text("Excel").text("Tableau").text("LANGUAGES", { font: fonts.bold, size: 12 }).text("English (native)").text("French (B2)");
  main.name("Alex Example").text(CONTACT.replace(" · linkedin.com/in/alexexample", ""));
  main.heading("EXPERIENCE").role("Data Analyst, Example Ltd", "Jun 2024 – Present", 440).bullet("Built a churn model that cut customer losses by 12 per cent.").bullet("Automated weekly reporting for five teams.").bullet("Presented monthly findings to the operations director.");
  main.heading("EDUCATION").text("BSc Mathematics, Northfield University, 2021 to 2024.");
  return doc.save();
}

export const WRAPPED_BULLETS = [
  "Built a churn model in Python that cut customer losses by 12 per cent across two regional teams, and presented the results to the operations director each month.",
  "Automated the weekly reporting pack for five teams using SQL and Excel macros, which saved six hours of manual work every week and removed copy-and-paste errors.",
  "Led a four-person student team that designed and shipped a budgeting app now used by 150 students, handling the backlog and the weekly demos.",
];

async function wrappedBullets(): Promise<Uint8Array> {
  const { doc, fonts } = await newPdf();
  const w = new Writer(doc.addPage([595, 842]), fonts);
  w.name("Alex Example").text(CONTACT);
  w.heading("EXPERIENCE").role("Data Analyst, Example Ltd", "Jun 2024 – Present");
  // Each bullet is drawn as two lines, the way a PDF stores a wrapped paragraph: the break falls mid-sentence.
  const breaks = [["Built a churn model in Python that cut customer losses by 12 per cent across two", "regional teams, and presented the results to the operations director each month."], ["Automated the weekly reporting pack for five teams using SQL and Excel macros, which", "saved six hours of manual work every week and removed copy-and-paste errors."], ["Led a four-person student team that designed and shipped a budgeting app now used by", "150 students, handling the backlog and the weekly demos."]];
  for (const [first, rest] of breaks) w.bullet(first).text(rest, { x: 72 });
  w.heading("EDUCATION").text("BSc Mathematics, Northfield University, 2021 to 2024.");
  w.heading("SKILLS").text("Python, SQL, Excel, Tableau");
  return doc.save();
}

async function letterSpacedHeadings(): Promise<Uint8Array> {
  const { doc, fonts } = await newPdf();
  const w = new Writer(doc.addPage([595, 842]), fonts);
  w.name("Alex Example").text(CONTACT);
  w.spaced("PROFILE").text("Mathematics graduate with two years of analytics experience in retail.");
  w.spaced("EDUCATION").role("BSc Mathematics, Northfield University", "2021 – 2024");
  w.spaced("WORK EXPERIENCE")
    .role("Data Analyst, Example Ltd", "Jun 2024 – Present")
    .bullet("Built a churn model that cut customer losses by 12 per cent across two regions.")
    .bullet("Automated weekly reporting for five teams, saving six hours of manual work a week.")
    .bullet("Presented monthly findings to the operations director and two regional managers.");
  w.spaced("SKILLS").text("Python, SQL, Excel, Tableau");
  return doc.save();
}

export const HEADER_LINE = "Alex Example — Curriculum Vitae";

async function repeatedHeader(): Promise<Uint8Array> {
  const { doc, fonts } = await newPdf();
  const footer = (page: PDFPage, n: number) => page.drawText(`Page ${n} of 2`, { x: 260, y: 40, size: 9, font: fonts.body });
  const p1 = doc.addPage([595, 842]);
  const a = new Writer(p1, fonts);
  a.text(HEADER_LINE, { size: 9 }).name("Alex Example").text(CONTACT);
  a.heading("EDUCATION").role("BSc Mathematics, Northfield University", "2021 – 2024");
  a.heading("EXPERIENCE").role("Data Analyst, Example Ltd", "Jun 2024 – Present").bullet("Built a churn model that cut customer losses by 12 per cent across two regions.").bullet("Automated weekly reporting for five teams, saving six hours of manual work a week.");
  footer(p1, 1);
  // Page 2 opens with the rest of the first role's bullets, under the repeated header line.
  const p2 = doc.addPage([595, 842]);
  const b = new Writer(p2, fonts);
  b.text(HEADER_LINE, { size: 9 }).bullet("Presented monthly findings to the operations director and two regional managers.").bullet("Trained three new analysts on the reporting pack and the data warehouse.");
  b.role("Research Intern, Fenwick Systems", "September 2023 to December 2023", 380).bullet("Analysed sales data for 40 stores and presented findings to three regional managers.").bullet("Wrote Python scripts that cleaned 20,000 records a day with no manual checks.");
  b.heading("SKILLS").text("Python, SQL, Excel, Tableau, Git");
  footer(p2, 2);
  return doc.save();
}

async function symbolBullets(): Promise<Uint8Array> {
  const { doc, fonts } = await newPdf();
  const w = new Writer(doc.addPage([595, 842]), fonts);
  w.name("Alex Example").text(CONTACT);
  w.heading("EXPERIENCE").role("Data Analyst, Example Ltd", "Jun 2024 – Present");
  w.symbolBullet("Built a churn model that cut customer losses by 12 per cent across two regions.")
    .symbolBullet("Automated weekly reporting for five teams, saving six hours of manual work a week.")
    .symbolBullet("Presented monthly findings to the operations director and two regional managers.")
    .symbolBullet("Trained three new analysts on the reporting pack and the data warehouse.");
  w.heading("EDUCATION").text("BSc Mathematics, Northfield University, 2021 to 2024.");
  w.heading("SKILLS").text("Python, SQL, Excel, Tableau");
  return doc.save();
}

/** A CV whose bullets were flattened into plain text: every marker is a "3" in the body font, so nothing shows it was ever a bullet. */
async function lostBullets(): Promise<Uint8Array> {
  const { doc, fonts } = await newPdf();
  const w = new Writer(doc.addPage([595, 842]), fonts);
  w.name("Alex Example").text(CONTACT);
  w.heading("EXPERIENCE").role("Data Analyst, Example Ltd", "Jun 2024 – Present");
  w.text("3 Built a churn model that cut customer losses by 12 per cent across two regions.")
    .text("3 Automated weekly reporting for five teams, saving six hours of manual work a week.")
    .text("3 Presented monthly findings to the operations director and two regional managers.")
    .text("3 Trained three new analysts on the reporting pack and the data warehouse.");
  w.heading("EDUCATION").text("BSc Mathematics, Northfield University, 2021 to 2024.");
  w.heading("SKILLS").text("Python, SQL, Excel, Tableau");
  return doc.save();
}

/** Three headings the lexicon doesn't know, so what sits under them may be read as part of the section above. */
async function unknownHeadings(): Promise<Uint8Array> {
  const { doc, fonts } = await newPdf();
  const w = new Writer(doc.addPage([595, 842]), fonts);
  w.name("Alex Example").text(CONTACT);
  w.heading("EXPERIENCE").role("Data Analyst, Example Ltd", "Jun 2024 – Present").bullet("Built a churn model that cut customer losses by 12 per cent across two regions.");
  w.heading("MILITARY SERVICE").role("Reservist, Example Regiment", "2019 – 2021").bullet("Led a team of eight through a two-week logistics exercise with no losses.");
  w.heading("PATENTS").text("Filed one patent on sensor calibration.");
  w.heading("EXHIBITIONS").text("Showed two pieces at a regional gallery.");
  w.heading("EDUCATION").text("BSc Mathematics, Northfield University, 2021 to 2024.");
  w.heading("SKILLS").text("Python, SQL, Excel, Tableau");
  return doc.save();
}

async function academic(): Promise<Uint8Array> {
  const { doc, fonts } = await newPdf();
  const w = new Writer(doc.addPage([595, 842]), fonts);
  w.name("Dr Sam Sample").text("sam.sample@example.ac.uk · 07700 900456");
  w.heading("EDUCATION").role("PhD Computational Biology, Northfield University", "Oct 2021 – present", 410).role("MSc Bioinformatics, Northfield University", "2019 – 2021");
  w.heading("RESEARCH EXPERIENCE").role("Research Assistant, Genome Lab", "03/2018 – 09/2018").bullet("Analysed sequencing data from 1,200 samples using Python and R pipelines.").bullet("Co-wrote two grant applications that secured £40,000 of funding.");
  w.heading("PUBLICATIONS").text("Sample, S. and Example, A. (2024). A method for aligning long reads. Journal of Examples, 12(3), 45–67.", { size: 10 });
  w.heading("TEACHING").role("Teaching Assistant, Introduction to Programming", "Autumn 2022").bullet("Ran weekly labs for 60 first-year students and marked 120 assignments a term.");
  w.heading("CONFERENCES AND TALKS").bullet("Presented a poster on long-read alignment at the Example Genomics Meeting, 2023.");
  w.heading("SKILLS").text("Python, R, Bash, Nextflow");
  return doc.save();
}

async function scan(): Promise<Uint8Array> {
  const { doc } = await newPdf();
  const image = await doc.embedPng(png(240, 340));
  doc.addPage([595, 842]).drawImage(image, { x: 48, y: 60, width: 499, height: 722 });
  return doc.save();
}

async function mixedScan(): Promise<Uint8Array> {
  const { doc, fonts } = await newPdf();
  const w = new Writer(doc.addPage([595, 842]), fonts);
  w.name("Alex Example").text(CONTACT);
  w.heading("EXPERIENCE").role("Data Analyst, Example Ltd", "Jun 2024 – Present").bullet("Built a churn model that cut customer losses by 12 per cent across two regions.").bullet("Automated weekly reporting for five teams, saving six hours of manual work a week.");
  const image = await doc.embedPng(png(240, 340));
  doc.addPage([595, 842]).drawImage(image, { x: 48, y: 60, width: 499, height: 722 });
  return doc.save();
}

export const LONG_BULLETS = [
  "Built a churn model that cut customer losses by 12 per cent across two regions.",
  "Automated weekly reporting for five teams, saving six hours of manual work a week.",
  "Presented monthly findings to the operations director and two regional managers.",
  "Trained three new analysts on the reporting pack and the data warehouse.",
  "Cut dashboard load times from 40 seconds to 4 by rewriting six SQL views.",
  "Ran a pricing test across 30 stores that lifted margin by 2 points.",
  "Analysed sales data for 40 stores and presented findings to three regional managers.",
  "Wrote Python scripts that cleaned 20,000 records a day with no manual checks.",
  "Mapped the returns process and removed two approval steps, saving a day per claim.",
  "Built a forecasting model that reduced stock-outs by 18 per cent over a quarter.",
  "Designed a survey of 400 customers and turned the results into three product changes.",
  "Documented 25 reports so a new starter could run month-end without help.",
  "Designed and shipped a budgeting app now used by 150 students.",
  "Organised a 12-team hackathon with 90 entrants and three sponsor companies.",
  "Raised £3,000 for the society through two events and a sponsorship deal.",
  "Coached a six-person committee and handed over a 20-page operations guide.",
  "Edited the society newsletter for 600 members, doubling the open rate to 48 per cent.",
  "Negotiated a 20 per cent discount on venue hire for the year's events.",
];

async function blankTrailingPage(): Promise<Uint8Array> {
  const { doc, fonts } = await newPdf();
  // A whole CV (over 300 words) on page one, so the empty second page reads as overflow rather than a missing scan.
  const w = new Writer(doc.addPage([595, 842]), fonts, 50, 800, 15);
  w.name("Alex Example").text(CONTACT);
  w.heading("PROFILE").text("Mathematics graduate with two years of analytics experience in retail, now moving into data").text("engineering. Comfortable owning a reporting pipeline end to end and explaining results to non-specialists.");
  w.heading("EDUCATION").role("BSc Mathematics, Northfield University", "2021 – 2024").text("First-class honours, with modules in statistics, optimisation and programming.");
  w.heading("EXPERIENCE").role("Data Analyst, Example Ltd", "Jun 2024 – Present");
  LONG_BULLETS.slice(0, 6).forEach((b) => w.bullet(b));
  w.role("Research Intern, Fenwick Systems", "September 2023 to December 2023", 380);
  LONG_BULLETS.slice(6, 12).forEach((b) => w.bullet(b));
  w.heading("EXTRACURRICULAR ACTIVITIES").role("President, Data Society", "2022 – 2024");
  LONG_BULLETS.slice(12).forEach((b) => w.bullet(b));
  w.heading("SKILLS").text("Python, SQL, Excel, Tableau, Git, R, dbt and Power BI");
  doc.addPage([595, 842]); // a blank second page, as a CV that just overflows produces
  return doc.save();
}

/* ---------- Word fixtures ---------- */

const para = (text: string, opts: { bold?: boolean; size?: number } = {}) => new Paragraph({ children: [new TextRun({ text, bold: opts.bold, size: opts.size })] });
const bullet = (text: string) => new Paragraph({ text, bullet: { level: 0 } });
const cell = (children: Paragraph[]) => new TableCell({ children, width: { size: 50, type: WidthType.PERCENTAGE } });

async function tableDocx(): Promise<Uint8Array> {
  const doc = new Document({
    creator: "scripts/make-extraction-fixtures.ts",
    sections: [
      {
        children: [
          para("Alex Example", { bold: true, size: 36 }),
          para(CONTACT),
          new Paragraph({ text: "EXPERIENCE", heading: HeadingLevel.HEADING_2 }),
          // Roles and their dates in a two-column table, as many Word templates lay them out.
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ children: [cell([para("Data Analyst, Example Ltd", { bold: true })]), cell([para("Jun 2024 – Present")])] }),
              new TableRow({ children: [cell([bullet("Built a churn model that cut customer losses by 12 per cent across two regions."), bullet("Automated weekly reporting for five teams, saving six hours of manual work a week.")]), cell([para("")])] }),
              new TableRow({ children: [cell([para("Research Intern, Fenwick Systems", { bold: true })]), cell([para("Sep 2023 – Dec 2023")])] }),
              new TableRow({ children: [cell([bullet("Analysed sales data for 40 stores and presented findings to three regional managers."), bullet("Wrote Python scripts that cleaned 20,000 records a day with no manual checks.")]), cell([para("")])] }),
            ],
          }),
          new Paragraph({ children: [new PageBreak()] }),
          new Paragraph({ text: "EDUCATION", heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ children: [new TextRun("BSc Mathematics, Northfield University"), new TextRun("\t2021 – 2024")], tabStops: [{ type: TabStopType.RIGHT, position: 9000 }] }),
          new Paragraph({ text: "SKILLS", heading: HeadingLevel.HEADING_2 }),
          para("Python, SQL, Excel, Tableau"),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

/** A Word CV laid out as a table with no dates anywhere: nothing shows the table kept roles and bullets together. */
async function tableUndatedDocx(): Promise<Uint8Array> {
  const doc = new Document({
    creator: "scripts/make-extraction-fixtures.ts",
    sections: [
      {
        children: [
          para("Alex Example", { bold: true, size: 36 }),
          para(CONTACT),
          new Paragraph({ text: "EXPERIENCE", heading: HeadingLevel.HEADING_2 }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [new TableRow({ children: [cell([para("Data Analyst", { bold: true }), para("Built a churn model that cut customer losses by 12 per cent across two regions.")]), cell([para("Example Ltd")])] })],
          }),
          new Paragraph({ text: "EDUCATION", heading: HeadingLevel.HEADING_2 }),
          para("BSc Mathematics, Northfield University"),
          new Paragraph({ text: "SKILLS", heading: HeadingLevel.HEADING_2 }),
          para("Python, SQL, Excel, Tableau"),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

async function scanDocx(): Promise<Uint8Array> {
  const doc = new Document({
    creator: "scripts/make-extraction-fixtures.ts",
    sections: [{ children: [new Paragraph({ children: [new ImageRun({ type: "png", data: png(240, 340), transformation: { width: 480, height: 680 } })] })] }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

/* ---------- write them ---------- */

export const FIXTURE_BUILDERS: Record<string, () => Promise<Uint8Array>> = {
  "single-column.pdf": singleColumn,
  "two-column.pdf": twoColumn,
  "wrapped-bullets.pdf": wrappedBullets,
  "letter-spaced-headings.pdf": letterSpacedHeadings,
  "repeated-header.pdf": repeatedHeader,
  "symbol-bullets.pdf": symbolBullets,
  "lost-bullets.pdf": lostBullets,
  "academic.pdf": academic,
  "unknown-headings.pdf": unknownHeadings,
  "scan.pdf": scan,
  "mixed-scan.pdf": mixedScan,
  "blank-trailing-page.pdf": blankTrailingPage,
  "table.docx": tableDocx,
  "table-undated.docx": tableUndatedDocx,
  "scan.docx": scanDocx,
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  for (const [name, build] of Object.entries(FIXTURE_BUILDERS)) {
    const bytes = await build();
    writeFileSync(join(OUT, name), bytes);
    console.log(`${name}: ${bytes.byteLength} bytes`);
  }
}

if (process.argv[1]?.endsWith("make-extraction-fixtures.ts")) void main();
