import type { ContentBlock, ContentBlockKind, SourceChange } from "@/lib/types";
import { normaliseText } from "./fingerprint";
import { BULLET_RE, cleanRole, parseCv } from "./parse";

// The editable view of a CV's text (OP-006). Blocks are cut from the structure the parser already reads
// (headings, roles, bullets with their line spans), so what the student edits is what the scorer saw: a wrapped
// bullet is one block, a symbol-font marker that decoded to a letter is visible, a repeated page header is a
// plain line they can clear. Nothing here scores anything; a corrected text goes through `analyseCv` like any other.

/** More blocks than this is not a CV: MAX_TEXT_CHARS of 40,000 at a few dozen characters a line. */
export const MAX_CONTENT_BLOCKS = 1200;
/** Longest a single block may be after a correction: twice the longest bullet the parser keeps. */
export const MAX_BLOCK_CHARS = 1200;

const sectionLabel = (section: string) => (section === "header" ? "TOP OF CV" : section.toUpperCase());
const whereOf = (section: string, role: string | null) => (role ? `${sectionLabel(section)} · ${cleanRole(role).toUpperCase().slice(0, 48) || "ROLE"}` : sectionLabel(section));
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Cuts a text into blocks in document order. Runs on the normalised text, the form the scorer sees, so the
 * line indexes agree with the parser's. Ids are `b<n>` by position and are stable for one document version.
 */
export function contentBlocks(rawText: string): ContentBlock[] {
  const parsed = parseCv(normaliseText(rawText));
  const headings = new Map(parsed.structure.sections.filter((s) => s.heading !== null).map((s) => [s.line, s.key]));
  const roleLines = new Set(parsed.structure.roles.map((r) => r.line));
  const bulletAt = new Map(parsed.bullets.map((b) => [b.lines[0], b]));
  const blocks: ContentBlock[] = [];
  let section = "header";
  let role: string | null = null;
  const push = (kind: ContentBlockKind, text: string, where: string) => blocks.push({ id: `b${blocks.length}`, kind, section, where, text });
  for (let i = 0; i < parsed.lines.length && blocks.length < MAX_CONTENT_BLOCKS; i++) {
    const line = parsed.lines[i].trim();
    const key = headings.get(i);
    if (key !== undefined) {
      section = key;
      role = null;
      push("heading", line, "SECTION HEADING");
      continue;
    }
    const scored = bulletAt.get(i);
    if (scored) {
      // A bullet the scorer read, rebuilt from every line it wrapped onto.
      push("bullet", scored.text, whereOf(section, scored.role));
      i = scored.lines[1];
      continue;
    }
    if (BULLET_RE.test(line)) {
      push("bullet", oneLine(line.replace(BULLET_RE, "")), whereOf(section, role));
      continue;
    }
    if (roleLines.has(i)) {
      role = line;
      push("role", line, `${sectionLabel(section)} · ROLE`);
      continue;
    }
    push("line", line, sectionLabel(section));
  }
  return blocks;
}

/** The text a set of blocks stands for: one line each, bullets marked, cleared blocks left out. */
export function assembleContent(blocks: { kind: ContentBlockKind; text: string }[]): string {
  return blocks
    // A bullet keeps one marker even if the student typed their own; any other line keeps whatever they typed,
    // so starting a line with "•" makes it a bullet.
    .map((b) => ({ kind: b.kind, text: oneLine(b.kind === "bullet" ? b.text.replace(BULLET_RE, "") : b.text) }))
    .filter((b) => b.text)
    .map((b) => (b.kind === "bullet" ? `• ${b.text}` : b.text))
    .join("\n");
}

/** Every block whose text the student changed, with what it said before and after (empty after = removed). */
export function contentChanges(parent: ContentBlock[], edited: { id: string; text: string }[]): SourceChange[] {
  const after = new Map(edited.map((e) => [e.id, oneLine(e.text)]));
  return parent.flatMap((p) => {
    const next = after.get(p.id);
    const before = oneLine(p.text);
    return next === undefined || next === before ? [] : [{ block: p.id, kind: p.kind, where: p.where, before, after: next }];
  });
}

/** The blocks of a parent version with the student's edits applied, in the parent's order. */
export function applyEdits(parent: ContentBlock[], edited: { id: string; text: string }[]): { kind: ContentBlockKind; text: string }[] {
  const after = new Map(edited.map((e) => [e.id, e.text]));
  return parent.map((p) => ({ kind: p.kind, text: after.get(p.id) ?? p.text }));
}
