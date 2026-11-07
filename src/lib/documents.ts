import "server-only";
import { AlignmentType, BorderStyle, Document, HeadingLevel, LevelFormat, Packer, Paragraph, ShadingType, TabStopType, TextRun, type IBorderOptions, type IRunOptions } from "docx";
import { PDFDocument, rgb, setCharacterSpacing, StandardFonts, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { CV_EXAMPLES } from "@/lib/cv-examples";
import { contactLine, FONTS, LETTER_THEME, taglineColour, tint, withRoles, type CvTheme } from "@/lib/cv-themes";
import type { DocBlock } from "@/lib/documents-types";

// Builds Word and PDF files from blocks and a theme: one column, standard fonts, real text, no tables or
// text boxes. That is the layout screening software reads most reliably, not a guarantee about any system.

export type { DocBlock } from "@/lib/documents-types";

const A4 = { w: 11906, h: 16838 }; // twips
const marginOf = (t: CvTheme) => Math.round(1000 * (t.space < 0.9 ? 0.8 : t.space > 1.1 ? 1.15 : 1));
const GREY = "4A5550";
const hex = (c: string) => c.replace("#", "").toUpperCase();

/** A file's title and language are what a screen reader reads first. */
const documentTitle = (blocks: DocBlock[], theme: CvTheme) => blocks.find((b) => b.kind === "name")?.text ?? blocks.find((b) => b.kind === "heading")?.text ?? (theme === LETTER_THEME ? "Cover letter" : "Document");

export async function toDocx(blocks: DocBlock[], theme: CvTheme = LETTER_THEME): Promise<Uint8Array> {
  const font = FONTS[theme.font].word;
  // Word lays out its own lines; standard PDF font metrics are close enough to pick where the contact line breaks.
  const metrics = await (await PDFDocument.create()).embedFont(FONTS[theme.font].pdf === "serif" ? StandardFonts.TimesRoman : StandardFonts.Helvetica);
  const accent = hex(theme.accent);
  const margin = marginOf(theme);
  const textWidth = A4.w - 2 * margin;
  const sz = (pt: number) => Math.round(pt * 2);
  const sp = (twips: number) => Math.round(twips * theme.space);
  const run = (text: string, o: Omit<IRunOptions, "text"> = {}) => new TextRun({ text, font, size: sz(theme.body), ...o });
  const align = theme.nameStyle.align === "center" ? AlignmentType.CENTER : AlignmentType.LEFT;

  const heading = (text: string) => {
    const h = theme.heading;
    const colour = h.accent || h.style === "band" ? accent : "111111";
    const line = (style: IBorderOptions["style"], size: number, space: number): IBorderOptions => ({ style, size, space, color: h.accent ? accent : "111111" });
    const border =
      h.style === "rule" ? { bottom: line(BorderStyle.SINGLE, 6, 2) } :
      h.style === "rule-above" ? { top: line(BorderStyle.SINGLE, 8, 6) } :
      h.style === "double" ? { bottom: line(BorderStyle.DOUBLE, 4, 2) } :
      h.style === "bar" ? { left: { style: BorderStyle.SINGLE, size: 24, space: 6, color: accent } } :
      undefined;
    return new Paragraph({
      heading: HeadingLevel.HEADING_1,
      keepNext: true,
      spacing: { before: sp(260), after: sp(100) },
      border,
      indent: h.style === "bar" ? { left: 140 } : undefined,
      shading: h.style === "band" ? { type: ShadingType.CLEAR, color: "auto", fill: hex(tint(theme.accent)) } : undefined,
      children: [run(`${h.style === "band" ? " " : ""}${h.upper ? text.toUpperCase() : text}`, { bold: true, size: sz(h.size), color: colour, characterSpacing: Math.round(h.tracking * 20) })],
    });
  };

  const role = (b: DocBlock) => {
    const title = run(b.text, { bold: true });
    const date = b.date ?? "";
    const children =
      !date ? [title] :
      theme.date === "right" ? [title, run(`\t${date}`, { color: GREY, size: sz(theme.body - 0.5) })] :
      theme.date === "inline" ? [title, run(`  ·  ${date}`, { color: GREY })] :
      [title, new TextRun({ break: 1 }), run(date, { italics: true, color: GREY, size: sz(theme.body - 0.5) })];
    return new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, spacing: { before: sp(160), after: sp(50) }, tabStops: [{ type: TabStopType.RIGHT, position: textWidth }], children });
  };

  const children = blocks.map((b) => {
    switch (b.kind) {
      case "name":
        return new Paragraph({
          heading: HeadingLevel.TITLE,
          alignment: align,
          spacing: { after: sp(40) },
          children: [run(theme.nameStyle.upper ? b.text.toUpperCase() : b.text, { bold: theme.nameStyle.bold, size: sz(theme.nameStyle.size), color: theme.nameStyle.accent ? accent : "111111", characterSpacing: Math.round(theme.nameStyle.tracking * 20) })],
        });
      case "tagline":
        return new Paragraph({
          alignment: align,
          spacing: { after: sp(60) },
          children: [run(b.text, { size: sz(theme.body + 1), color: taglineColour(theme).replace("#", "") })],
        });
      case "contact":
        return new Paragraph({
          alignment: align,
          spacing: { after: sp(theme.headerRule ? 120 : 180) },
          border: theme.headerRule ? { bottom: { style: BorderStyle.SINGLE, size: 4, space: 8, color: "BFC7C2" } } : undefined,
          children: contactLines(b.text, (t) => metrics.widthOfTextAtSize(t, theme.body - 1) * 1.04, (textWidth / 20) * 0.97).flatMap((line, i) => [
            ...(i ? [new TextRun({ break: 1 })] : []),
            run(line, { size: sz(theme.body - 1), color: GREY }),
          ]),
        });
      case "heading":
        return heading(b.text);
      case "role":
        return role(b);
      case "bullet":
        return new Paragraph({ numbering: { reference: "cv-bullet", level: 0 }, keepLines: true, spacing: { after: sp(50) }, children: [run(b.text)] });
      case "note":
        return new Paragraph({ spacing: { after: 200 }, children: [run(b.text, { size: sz(9), italics: true, color: "5C6B66" })] });
      default:
        return new Paragraph({ keepLines: true, spacing: { after: sp(110) }, children: b.text.split("\n").flatMap((line, i) => [...(i ? [new TextRun({ break: 1 })] : []), run(line)]) });
    }
  });

  const doc = new Document({
    creator: "Offerpath",
    title: documentTitle(blocks, theme),
    styles: { default: { document: { run: { language: { value: "en-GB" } } } } },
    numbering: {
      config: [
        {
          reference: "cv-bullet",
          levels: [{ level: 0, format: LevelFormat.BULLET, text: theme.bullet, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 340, hanging: 220 } }, run: { font, color: accent } } }],
        },
      ],
    },
    sections: [{ properties: { page: { size: { width: A4.w, height: A4.h }, margin: { top: margin, bottom: margin, left: margin, right: margin } } }, children }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

// pdf-lib's standard fonts cover WinAnsi only; swap or drop anything outside it.
const safe = (s: string) =>
  s
    .replace(/[▪●◦‣]/g, "•")
    .replace(/[^\x20-\x7E\xA0-\xFF€•–—‘’“”›‹…\n]/g, "");

/** Contact items in as few lines as they need, with two lines evened out so one item doesn't sit alone. */
function contactLines(text: string, width: (s: string) => number, max: number): string[] {
  const items = contactLine(text).split("\u00A0·  ");
  const join = (xs: string[]) => xs.join("\u00A0·  ");
  if (width(join(items)) <= max) return [join(items)];
  let best: string[] | null = null;
  for (let i = 1; i < items.length; i++) {
    const pair = [join(items.slice(0, i)), join(items.slice(i))];
    const widest = Math.max(...pair.map(width));
    if (widest <= max && (!best || widest < Math.max(...best.map(width)))) best = pair;
  }
  return best ?? [contactLine(text)];
}

const toRgb = (c: string): RGB => {
  const h = hex(c);
  return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
};

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split("\n")) {
    let line = "";
    // Only ordinary spaces break a line; a non-breaking space keeps a contact item in one piece.
    for (const word of para.split(/[ \t]+/)) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) > width && line) {
        out.push(line);
        line = word;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

export async function toPdf(blocks: DocBlock[], theme: CvTheme = LETTER_THEME): Promise<Uint8Array> {
  // When only a few lines would spill onto an extra page, tighten the spacing a little so the CV ends cleanly.
  let best = await layoutPdf(blocks, theme, 1);
  for (const fit of [0.94, 0.88, 0.84]) {
    if (best.pages === 1 || best.lastFill >= 0.3) break;
    const tighter = await layoutPdf(blocks, theme, fit);
    if (tighter.pages < best.pages) best = tighter;
  }
  return best.pdf.save();
}

async function layoutPdf(blocks: DocBlock[], theme: CvTheme, fit: number) {
  const pdf = await PDFDocument.create();
  pdf.setCreator("Offerpath");
  pdf.setTitle(safe(documentTitle(blocks, theme)), { showInWindowTitleBar: true });
  pdf.setLanguage("en-GB");
  const serif = FONTS[theme.font].pdf === "serif";
  const regular = await pdf.embedFont(serif ? StandardFonts.TimesRoman : StandardFonts.Helvetica);
  const bold = await pdf.embedFont(serif ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(serif ? StandardFonts.TimesRomanItalic : StandardFonts.HelveticaOblique);
  // Times sets smaller than Calibri or Georgia at the same size; nudge it up so pages look alike.
  const k = serif ? 1.04 : 1;
  const [W, H] = [595.28, 841.89];
  const M = marginOf(theme) / 20;
  const accent = toRgb(theme.accent);
  const ink = rgb(0.07, 0.07, 0.07);
  const grey = toRgb(GREY);
  const gap = (pt: number) => pt * theme.space * fit;
  const lh = 1.4 - (1 - fit) * 1.5; // line height: 1.4, down to about 1.22 at the tightest fit
  const body = theme.body * k;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  const ensure = (h: number) => {
    if (y - h < M) {
      page = pdf.addPage([W, H]);
      y = H - M;
    }
  };
  const tracked = (text: string, font: PDFFont, size: number, tracking: number) => font.widthOfTextAtSize(text, size) + tracking * Math.max(0, text.length - 1);
  // Letter spacing uses the PDF's own character-spacing setting, so the word stays one piece of text for screening software.
  const drawTracked = (text: string, x: number, font: PDFFont, size: number, color: RGB, tracking: number) => {
    if (tracking) page.pushOperators(setCharacterSpacing(tracking));
    page.drawText(text, { x, y: y - size, size, font, color });
    if (tracking) page.pushOperators(setCharacterSpacing(0));
  };
  /** Draws wrapped text, keeping it on one page when it fits on one. Returns where its first line went. */
  const draw = (text: string, font: PDFFont, size: number, color: RGB, indent = 0, center = false, keepWith = 0) => {
    const lines = wrap(text, font, size, W - 2 * M - indent);
    const height = lines.length * size * lh;
    if (height + keepWith < H - 2 * M) ensure(height + keepWith);
    let first: { page: PDFPage; y: number } | null = null;
    for (const line of lines) {
      ensure(size * lh);
      const x = center ? (W - font.widthOfTextAtSize(line, size)) / 2 : M + indent;
      first ??= { page, y };
      page.drawText(line, { x, y: y - size, size, font, color });
      y -= size * lh;
    }
    return first ?? { page, y };
  };
  // Room for the first line of whatever follows, so a heading or job title never ends a page.
  const nextLine = body * lh * 2;
  const hline = (at: number, thickness: number, color: RGB) => page.drawLine({ start: { x: M, y: at }, end: { x: W - M, y: at }, thickness, color });

  // How much of the next block has to sit under a heading: all of a short paragraph or bullet, else its first lines.
  const startOf = (b: DocBlock | undefined) => {
    if (!b) return 0;
    if (b.kind === "role") return body * lh * (theme.date === "below" ? 2 : 1) + gap(6.5) + nextLine;
    const lines = wrap(b.text, regular, body, W - 2 * M - (b.kind === "bullet" ? 14 : 0)).length;
    return body * lh * Math.min(lines <= 6 ? lines : 2, 6);
  };

  for (const [i, b] of blocks.entries()) {
    if (b.kind === "note") {
      draw(b.text, italic, 8.5, grey);
      y -= 6;
    } else if (b.kind === "name") {
      const n = theme.nameStyle;
      const text = safe(n.upper ? b.text.toUpperCase() : b.text);
      const size = n.size * k;
      const font = n.bold ? bold : regular;
      ensure(size * lh);
      const x = n.align === "center" ? (W - tracked(text, font, size, n.tracking)) / 2 : M;
      drawTracked(text, x, font, size, n.accent ? accent : ink, n.tracking);
      y -= size * 1.3;
    } else if (b.kind === "tagline") {
      draw(b.text, regular, body + 1, toRgb(taglineColour(theme)), 0, theme.nameStyle.align === "center");
      y -= 1;
    } else if (b.kind === "contact") {
      draw(contactLines(b.text, (t) => regular.widthOfTextAtSize(safe(t), body - 1), W - 2 * M).join("\n"), regular, body - 1, grey, 0, theme.nameStyle.align === "center");
      if (theme.headerRule) {
        hline(y - 3, 0.5, rgb(0.75, 0.78, 0.76));
        y -= 6;
      }
      y -= gap(8);
    } else if (b.kind === "heading") {
      const h = theme.heading;
      const size = h.size * k;
      const text = safe(h.upper ? b.text.toUpperCase() : b.text);
      const colour = h.accent ? accent : ink;
      y -= gap(11);
      ensure(size * 2 + gap(6) + startOf(blocks[i + 1]));
      if (h.style === "rule-above") {
        hline(y, 0.9, colour);
        y -= 7;
      }
      if (h.style === "band") {
        page.drawRectangle({ x: M - 3, y: y - size * 1.45, width: W - 2 * M + 6, height: size * 1.75, color: toRgb(tint(theme.accent)) });
        y -= size * 0.1;
        drawTracked(text, M + 4, bold, size, accent, h.tracking);
        y -= size * 1.55;
      } else if (h.style === "bar") {
        page.drawRectangle({ x: M, y: y - size * 1.15, width: 3, height: size * 1.3, color: accent });
        drawTracked(text, M + 10, bold, size, colour, h.tracking);
        y -= size * 1.4;
      } else {
        drawTracked(text, M, bold, size, colour, h.tracking);
        y -= size * 1.35;
      }
      if (h.style === "rule") hline(y, 0.8, colour);
      if (h.style === "double") {
        hline(y + 1, 0.5, colour);
        hline(y - 1.2, 0.5, colour);
      }
      y -= gap(6);
    } else if (b.kind === "role") {
      y -= gap(5);
      const date = b.date ? safe(b.date) : "";
      if (date && theme.date === "right") {
        const dw = regular.widthOfTextAtSize(date, body - 0.5);
        const lines = wrap(b.text, bold, body, W - 2 * M - dw - 12);
        ensure(body * lh * lines.length + nextLine);
        // The title first: an untagged PDF is read in the order it's drawn.
        const dateY = y - body;
        for (const line of lines) {
          page.drawText(line, { x: M, y: y - body, size: body, font: bold, color: ink });
          y -= body * lh;
        }
        page.drawText(date, { x: W - M - dw, y: dateY, size: body - 0.5, font: regular, color: grey });
      } else if (date && theme.date === "inline") {
        const text = `${b.text}  ·  `;
        const lines = wrap(text + date, bold, body, W - 2 * M);
        if (lines.length === 1) {
          ensure(body * lh + nextLine);
          page.drawText(safe(text), { x: M, y: y - body, size: body, font: bold, color: ink });
          page.drawText(date, { x: M + bold.widthOfTextAtSize(safe(text), body), y: y - body, size: body, font: regular, color: grey });
          y -= body * lh;
        } else {
          draw(b.text, bold, body, ink, 0, false, body * lh + nextLine);
          draw(date, regular, body - 0.5, grey);
        }
      } else {
        draw(b.text, bold, body, ink, 0, false, (date ? body * lh : 0) + nextLine);
        if (date) draw(date, italic, body - 0.5, grey);
      }
      y -= gap(1.5);
    } else if (b.kind === "bullet") {
      // The mark first, as an untagged PDF is read in the order it's drawn. It takes the same page break draw() would.
      const height = wrap(b.text, regular, body, W - 2 * M - 14).length * body * lh;
      if (height < H - 2 * M) ensure(height);
      ensure(body * lh);
      page.drawText(safe(theme.bullet), { x: M + 3, y: y - body, size: body, font: bold, color: accent });
      draw(b.text, regular, body, ink, 14);
      y -= gap(1.5);
    } else {
      draw(b.text, regular, body, ink);
      y -= gap(6);
    }
  }
  const lastFill = (H - M - y) / (H - 2 * M);
  return { pdf, pages: pdf.getPageCount(), lastFill };
}

/** The example CV behind a theme, with its role lines split out. */
export function templateBlocks(theme: CvTheme): DocBlock[] {
  return withRoles(CV_EXAMPLES[theme.sample] ?? CV_EXAMPLES.classic);
}
