// OP-027. Accessibility checks that need no browser, so they run with the engine suite. They guard the patterns that went
// wrong in the audit; tests/e2e/keyboard.mjs and tests/e2e/smoke.mjs drive the real pages. None of this establishes conformance.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { getDocumentProxy } from "unpdf";
import { analyseCv } from "@/lib/analysis/cv";
import { extractText } from "@/lib/analysis/extract";
import { parseCv } from "@/lib/analysis/parse";
import { applyLineEdits } from "@/lib/analysis/tailor";
import { onTabListKey, LIVE_REGION_ID } from "@/components/a11y";
import { scoreColor, scoreTextColor } from "@/components/ui";
import { CV_THEMES, LETTER_THEME } from "@/lib/cv-themes";
import { templateBlocks, toDocx, toPdf, type DocBlock } from "@/lib/documents";

const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(path.join(dir, f)).isDirectory() ? walk(path.join(dir, f)) : [path.join(dir, f)]));
// src/app/admin and the founder's landing page are outside this audit; the vendored kit is third-party.
const studentFiles = [...walk("src/app"), ...walk("src/components")].filter((f) => f.endsWith(".tsx") && !/src\/app\/admin|src\/app\/_landing|stageshow/.test(f));
const read = (f: string) => readFileSync(f, "utf8");

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const WHITE = "#FFFFFF";
const CANVAS = "#F2F4F1";

test("every tablist has arrow keys and one Tab stop, and no radio role is left without arrow keys", () => {
  let lists = 0;
  for (const f of studentFiles) {
    const src = read(f);
    for (const m of src.matchAll(/role="tablist"[^>]*>/g)) {
      lists++;
      assert.match(m[0], /onKeyDown=\{onTabListKey\}/, `${f}: ${m[0]}`);
    }
    for (const m of src.matchAll(/role="tab"[^>]*?(?:onClick|className)/g)) assert.match(m[0], /tabIndex=\{/, `${f}: ${m[0].slice(0, 90)}`);
    assert.doesNotMatch(src, /role="radio(group)?"/, `${f} uses a radio role on buttons, which promises arrow keys`);
  }
  assert.ok(lists >= 7, `found ${lists} tablists`);
});

test("arrow keys, Home and End move along a tablist and select the tab", () => {
  const log: string[] = [];
  const tabs = ["a", "b", "c"].map((n) => ({ n, focus: () => log.push(`focus ${n}`), click: () => log.push(`click ${n}`) }));
  const press = (key: string, at: number) => {
    (globalThis as { document?: unknown }).document = { activeElement: tabs[at] };
    let prevented = false;
    onTabListKey({ key, currentTarget: { querySelectorAll: () => tabs } as never, preventDefault: () => (prevented = true) });
    const out = [log.join(), prevented] as const;
    log.length = 0;
    return out;
  };
  assert.deepEqual(press("ArrowRight", 0), ["focus b,click b", true]);
  assert.deepEqual(press("ArrowRight", 2), ["focus a,click a", true], "wraps at the end");
  assert.deepEqual(press("ArrowLeft", 0), ["focus c,click c", true], "wraps at the start");
  assert.deepEqual(press("Home", 2), ["focus a,click a", true]);
  assert.deepEqual(press("End", 0), ["focus c,click c", true]);
  assert.deepEqual(press("Tab", 1), ["", false], "Tab still leaves the group");
  delete (globalThis as { document?: unknown }).document;
});

test("a file input hidden behind a button is not a Tab stop of its own", () => {
  for (const f of studentFiles) {
    for (const m of read(f).matchAll(/<input[^>]*type="file"[^>]*>/g)) {
      if (/sr-only-abs/.test(m[0])) assert.match(m[0], /tabIndex=\{-1\}/, `${f}: an invisible stop`);
    }
  }
});

test("focus is never hidden, and nothing depends on hovering or dragging", () => {
  for (const f of studentFiles) {
    const src = read(f);
    assert.doesNotMatch(src, /outline-none|outline-0/, `${f} removes the focus indicator`);
    assert.doesNotMatch(src, /group-hover:|peer-hover:|onMouseEnter|onMouseOver|draggable/, `${f} has hover-only or drag-only behaviour`);
  }
  // The one drop target has a button that does the same job.
  const upload = read("src/app/upload/UploadForm.tsx");
  assert.match(upload, /onDrop=/);
  assert.match(upload, /inputRef\.current\?\.click\(\)/);
});

test("the live region and the focus safety net are on every page", () => {
  const layout = read("src/app/layout.tsx");
  assert.match(layout, /<A11yRuntime \/>/);
  const runtime = read("src/components/A11yRuntime.tsx");
  assert.match(runtime, /id=\{LIVE_REGION_ID\} role="status" aria-live="polite"/);
  assert.equal(LIVE_REGION_ID, "op-live");
});

test("what replaces a control takes focus: editors, the tour and the upload screens", () => {
  for (const f of ["src/app/reviews/[id]/lines/LineEditor.tsx", "src/app/tailor/[id]/TailorEditor.tsx", "src/app/letters/[id]/LetterWorkspace.tsx", "src/app/linkedin/[id]/LinkedinReportView.tsx"]) {
    assert.match(read(f), /<textarea autoFocus/, `${f}: Edit opens a box focus should land in`);
    assert.match(read(f), /focusSoon\(/, `${f}: Cancel goes back to Edit`);
  }
  const tour = read("src/app/reviews/[id]/ShowAround.tsx");
  assert.match(tour, /e\.key === "Escape"/);
  assert.match(tour, /focusSoon\(\(\) => opener\.current\)/);
  const upload = read("src/app/upload/UploadForm.tsx");
  assert.equal((upload.match(/id="upload-h" tabIndex=\{-1\}/g) ?? []).length, 3);
  assert.match(upload, /announce\(/);
  assert.match(read("src/app/onboarding/OnboardingFlow.tsx"), /heading\.current\?\.focus\(\)/);
});

test("errors are tied to the field they are about", () => {
  assert.match(read("src/app/sign-in/SignInForms.tsx"), /aria-describedby=\{state\?\.error \? "email-error"/);
  assert.match(read("src/app/privacy/page.tsx"), /aria-describedby=\{confirmError \? "confirm-error"/);
});

test("repeated buttons say what they act on", () => {
  assert.match(read("src/app/opportunities/OpportunitiesView.tsx"), /\{tr \? "Tracking" : "Track"\}\s*<span className="sr-only-abs"> \{o\.role\} at \{o\.org\}/);
  assert.match(read("src/app/opportunities/OpportunitiesView.tsx"), /Move <span className="sr-only-abs">\{k\.role\} at \{k\.org\} /);
  assert.match(read("src/app/share/RevokeButton.tsx"), /sr-only-abs"> link: \{name\}/);
});

test("score colours pass contrast, and each has words or a number beside it", () => {
  for (const score of [20, 55, 90]) {
    assert.ok(contrast(scoreColor(score), WHITE) >= 3, `graphic at ${score}`);
    assert.ok(contrast(scoreTextColor(score), WHITE) >= 4.5, `text at ${score}`);
  }
  // A ring can't be drawn without a label: the prop is required, and every use passes a spoken score.
  assert.match(read("src/components/ui.tsx"), /role="img" aria-label=\{label\}/);
  for (const f of studentFiles) {
    for (const m of read(f).matchAll(/<ScoreRing\b[\s\S]*?>/g)) assert.match(m[0], /label=/, `${f}: a score ring with no text`);
  }
  assert.match(read("src/components/ResultsSidebar.tsx"), /sr-only-abs">Score /);
});

test("focus ring, field edges and the off switch reach 3:1", () => {
  const css = read("src/app/globals.css");
  const brand = css.match(/--color-brand: (#[0-9a-f]{6})/)![1];
  const field = css.match(/textarea \{\s*border-color: (#[0-9a-f]{6})/)![1];
  for (const on of [WHITE, CANVAS]) {
    assert.ok(contrast(brand, on) >= 3, `focus ring on ${on}`);
    assert.ok(contrast(field, on) >= 3, `field edge on ${on}`);
  }
  assert.match(read("src/components/client.tsx"), /justify-start bg-\[#7D8A85\]/);
  assert.ok(contrast("#7D8A85", WHITE) >= 3, "off switch");
});

test("a line with a hyphen can be edited: the tailor page used to fail on it", () => {
  const cv = "EXPERIENCE\n• Completed due diligence on 12 mid-market targets (see co-op).\n• Led a team.\n";
  const out = applyLineEdits(cv, [{ from: "Completed due diligence on 12 mid-market targets (see co-op).", to: "Clearly completed due diligence on 12 mid-market targets." }]);
  assert.deepEqual(out.missing, []);
  assert.match(out.text, /Clearly completed/);
});

// ---- exported documents ------------------------------------------------------------------------------------------------------

const wordXml = async (bytes: Uint8Array) => {
  const zip = await JSZip.loadAsync(bytes);
  const read = (p: string) => zip.file(p)!.async("string");
  return { doc: await read("word/document.xml"), styles: await read("word/styles.xml"), core: await read("docProps/core.xml") };
};
const paragraphs = (xml: string) => [...xml.matchAll(/<w:p>([\s\S]*?)<\/w:p>|<w:p [^>]*>([\s\S]*?)<\/w:p>/g)].map((m) => m[1] ?? m[2]);
const textOf = (p: string) => [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("").replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

test("Word: real headings, list bullets, a title and a language, in reading order, for every template", async () => {
  for (const t of CV_THEMES) {
    const blocks = templateBlocks(t);
    const { doc, styles, core } = await wordXml(await toDocx(blocks, t));
    const ps = paragraphs(doc);
    assert.equal(ps.filter((p) => /w:pStyle w:val="Title"/.test(p)).length, 1, `${t.slug}: one title`);
    assert.equal(ps.filter((p) => /w:pStyle w:val="Heading1"/.test(p)).length, blocks.filter((b) => b.kind === "heading").length, `${t.slug}: section headings`);
    assert.equal(ps.filter((p) => /w:pStyle w:val="Heading2"/.test(p)).length, blocks.filter((b) => b.kind === "role").length, `${t.slug}: role headings`);
    assert.equal(ps.filter((p) => /<w:numPr>/.test(p)).length, blocks.filter((b) => b.kind === "bullet").length, `${t.slug}: bullets are a real list`);
    for (const id of ["Title", "Heading1", "Heading2"]) assert.match(styles, new RegExp(`w:styleId="${id}"`), `${t.slug}: style ${id} is defined`);
    assert.match(styles, /<w:lang [^>]*w:val="en-GB"/, `${t.slug}: language`);
    assert.match(core, /<dc:title>[^<]+<\/dc:title>/, `${t.slug}: document title`);
    // Same order as the blocks: nothing floats out of sequence.
    const words = ps.map(textOf).join(" ").replace(/\s+/g, " ").toLowerCase();
    let at = -1;
    for (const b of blocks) {
      const probe = b.text.split("\n")[0].slice(0, 25).toLowerCase();
      if (b.kind === "contact") continue;
      const found = words.indexOf(probe, at);
      assert.ok(found > at, `${t.slug}: "${probe}" out of order`);
      at = found;
    }
  }
});

test("Word: a letter has no invented headings, and it is titled as a letter", async () => {
  const blocks: DocBlock[] = [{ kind: "para", text: "Dear Ms Taylor," }, { kind: "para", text: "I am applying." }];
  const { doc, core } = await wordXml(await toDocx(blocks, LETTER_THEME));
  assert.doesNotMatch(doc, /w:val="Heading/);
  assert.match(core, /<dc:title>Cover letter<\/dc:title>/);
});

test("PDF: selectable text in reading order, with a title and language, for every template", async () => {
  for (const t of CV_THEMES) {
    const blocks = templateBlocks(t);
    const bytes = await toPdf(blocks, t);
    const meta = await PDFDocument.load(bytes, { updateMetadata: false });
    assert.equal(meta.getTitle(), blocks.find((b) => b.kind === "name")!.text, `${t.slug}: title`);
    assert.match(new TextDecoder("latin1").decode(await meta.save({ useObjectStreams: false })), /\/Lang \(en-GB\)/, `${t.slug}: language`);
    // The order the file draws its text in, which is what a reader of an untagged PDF gets. Not sorted by position.
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const raw: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const c = await (await pdf.getPage(i)).getTextContent();
      for (const item of c.items) if ("str" in item) raw.push(item.str);
    }
    const flat = raw.join(" ").replace(/\s+/g, " ");
    let at = -1;
    for (const b of blocks) {
      if (b.kind === "contact") continue;
      const probe = (b.kind === "heading" && t.heading.upper ? b.text.toUpperCase() : b.text).split("\n")[0].slice(0, 18);
      if (b.kind === "name" && t.nameStyle.upper) continue;
      const found = flat.indexOf(probe, Math.max(0, at));
      assert.ok(found > at, `${t.slug}: "${probe}" out of order`);
      at = found;
      if (b.kind === "role" && b.date) {
        const date = flat.indexOf(b.date.slice(0, 6), found);
        assert.ok(date > found, `${t.slug}: the date comes after its role title: ${b.text}`);
      }
      if (b.kind === "bullet") {
        const before = flat.slice(Math.max(0, found - 4), found);
        assert.ok(before.includes(t.bullet), `${t.slug}: the bullet mark comes before its text, got "${before}"`);
      }
    }
  }
});

test("exports read back to the same text, bullets and score, whichever writer made them", async () => {
  // What the audit changed (Word heading styles, PDF draw order) must not alter what a re-uploaded file scores.
  for (const t of CV_THEMES) {
    const blocks = templateBlocks(t);
    const word = await extractText(await toDocx(blocks, t), "cv.docx");
    const pdf = await extractText(await toPdf(blocks, t), "cv.pdf");
    const want = blocks.filter((b) => b.kind === "bullet").length;
    assert.equal(parseCv(word).bullets.length, want, `${t.slug} Word bullets`);
    assert.equal(parseCv(pdf).bullets.length, want, `${t.slug} PDF bullets`);
    assert.equal(analyseCv(word, "Finance and banking").score, analyseCv(pdf, "Finance and banking").score, `${t.slug}: Word and PDF score alike`);
  }
});
