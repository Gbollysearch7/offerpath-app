import { SECTION_HEADERS, STRONG_VERBS, WEAK_VERBS } from "./lexicon";

export interface ParsedBullet {
  index: number;
  section: string; // normalised section key
  role: string | null; // closest heading line above the bullet
  text: string;
  posInSection: number; // 1-based position among bullets in that section
}

export interface ParsedCv {
  text: string;
  lines: string[];
  sections: string[]; // normalised keys found, in order
  sectionLines: Record<string, string[]>;
  bullets: ParsedBullet[];
  words: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
}

// Includes the arrows and ticks some templates use (ours use ›) and the private-use code points Word bullets turn into.
export const BULLET_RE = /^\s*([•●▪‣◦∙·*–—›»▸►▶➢➤→✓✔■□◆◇♦○❖-]|\d+[.)])\s+/;
// Bounded quantifiers only: these run over the whole CV, so they must stay linear on hostile input.
const EMAIL_RE = /[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,24}/i;
const PHONE_RE = /(\+44\s?7\d{3}|\(?07\d{3}\)?)\s?\d{3}\s?\d{3}|(\+?\d[\d\s().-]{8,20}\d)/;
const LINKEDIN_RE = /linkedin\.com\/[\w/-]{1,100}|linkedin/i;

/** Most bullets the scorer will read from one CV, and the longest a single bullet can be. */
export const MAX_BULLETS = 60;
export const MAX_BULLET_CHARS = 600;
/** Run a regex line by line, so no single match attempt can span the whole document. */
const findInLines = (lines: string[], re: RegExp) => {
  for (const l of lines) {
    const m = l.slice(0, 500).match(re);
    if (m) return m[0];
  }
  return null;
};

// Headings typed with letter spacing ("W O R K  E X P E R I E N C E") often lose their word gaps in PDF text,
// so they're matched with all spaces removed.
const HEADERS_NO_SPACE = new Map(Object.entries(SECTION_HEADERS).map(([k, v]) => [k.replace(/\s+/g, ""), v]));

export function normaliseHeader(line: string): string | null {
  const clean = line.replace(/[:|_*#]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  if (!clean) return null;
  const tokens = clean.split(" ");
  if (tokens.length >= 4 && tokens.length <= 40 && tokens.every((t) => t.length === 1)) return HEADERS_NO_SPACE.get(tokens.join("")) ?? null;
  if (tokens.length > 5) return null;
  return SECTION_HEADERS[clean] ?? null;
}

export function wordCount(s: string): number {
  return s.split(/\s+/).filter((w) => /[A-Za-z0-9£$%]/.test(w)).length;
}

// Verbs a bullet can start with even when the PDF has lost the bullet character.
const ACTION_STARTS = new Set([
  ...STRONG_VERBS, ...Object.keys(WEAK_VERBS),
  "lead", "run", "grow", "build", "manage", "own", "drive", "took", "helped", "worked", "made", "won", "began", "kept", "wrote", "gave", "sold", "spoke", "taught",
]);

/** "Lead SEO Strategist · TopTier Trader June 2024 to August 2025": a role heading, not a bullet. */
function looksLikeRoleLine(raw: string): boolean {
  const line = raw.slice(0, 300);
  const year = /\b(19|20)\d{2}\b/;
  return (/[·|]/.test(line) && year.test(line)) || new RegExp(`(${MONTH}\\s+)?(19|20)\\d{2}\\s*(–|—|-|to)\\s*((${MONTH}\\s+)?(19|20)\\d{2}|present|now|current)`, "i").test(line);
}

function looksLikeAction(line: string): boolean {
  const first = line.trim().split(/\s+/)[0] ?? "";
  if (!/^[A-Z][a-z]+$/.test(first) || wordCount(line) < 5 || looksLikeRoleLine(line)) return false;
  const w = first.toLowerCase();
  return ACTION_STARTS.has(w) || /^[a-z]+(ed|t)$/.test(w);
}

export function parseCv(raw: string): ParsedCv {
  const text = raw.replace(/\r/g, "").replace(/ /g, " ");
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\s+$/g, ""))
    .filter((l) => l.trim().length > 0);

  const sections: string[] = [];
  const sectionLines: Record<string, string[]> = {};
  const bullets: ParsedBullet[] = [];
  let current = "header";
  let lastRole: string | null = null;
  const perSection: Record<string, number> = {};

  // Bullets that wrap onto a second line are joined back together. A wrapped line runs close to the full text
  // width and doesn't end a sentence; that catches wraps that start with a capital ("Google Search Console").
  const widths = lines.map((l) => l.trim().length).sort((a, b) => a - b);
  const fullWidth = widths[Math.floor(widths.length * 0.9)] ?? 0;
  let lastRaw = "";
  let pending: { section: string; role: string | null; text: string } | null = null;
  const flush = () => {
    if (!pending) return;
    const t = pending.text.replace(/\s+/g, " ").trim().slice(0, MAX_BULLET_CHARS);
    if (wordCount(t) >= 3 && bullets.length < MAX_BULLETS * 2) {
      perSection[pending.section] = (perSection[pending.section] ?? 0) + 1;
      bullets.push({ index: bullets.length, section: pending.section, role: pending.role, text: t, posInSection: perSection[pending.section] });
    }
    pending = null;
  };

  for (const line of lines) {
    const prevRaw = lastRaw;
    lastRaw = line.trim();
    const header = normaliseHeader(line);
    if (header) {
      flush();
      current = header;
      lastRole = null;
      if (!sections.includes(header)) sections.push(header);
      sectionLines[header] ??= [];
      continue;
    }
    (sectionLines[current] ??= []).push(line);
    const inBulletSection = ["experience", "projects", "activities", "achievements"].includes(current);
    if (BULLET_RE.test(line)) {
      flush();
      pending = { section: current, role: lastRole, text: line.replace(BULLET_RE, "") };
    } else if (inBulletSection && looksLikeAction(line)) {
      flush();
      pending = { section: current, role: lastRole, text: line };
    } else if (pending && pending.text.length < MAX_BULLET_CHARS && (/^[a-z(]/.test(line.trim()) || (prevRaw.length >= fullWidth * 0.8 && !/[.!?:;]$/.test(prevRaw) && !looksLikeRoleLine(line)))) {
      pending.text += (pending.text.endsWith("-") && /^[a-z]/.test(line.trim()) ? "" : " ") + line.trim();
    } else {
      flush();
      // Role headings: a line with dates, or a short line that isn't a sentence (company blurbs end with a full stop).
      if (inBulletSection && (looksLikeRoleLine(line) || (wordCount(line) <= 14 && !/[.!?]$/.test(line.trim())))) lastRole = line.trim();
    }
  }
  flush();

  const email = findInLines(lines, EMAIL_RE);
  const phone = findInLines(lines, PHONE_RE)?.trim() ?? null;
  const linkedin = findInLines(lines, LINKEDIN_RE);
  // The name is usually the first line, but a side-by-side header can put contact lines above it.
  const looksLikeName = (l: string) => /^[\p{L}][\p{L}'’.-]*(\s+[\p{L}][\p{L}'’.-]*){1,3}$/u.test(l) && !normaliseHeader(l) && !/^(curriculum vitae|resume|résumé|cv)$/i.test(l);
  const first = lines[0]?.trim() ?? "";
  const nameLine =
    lines.slice(0, 5).map((l) => l.replace(/\s*[|·•].*$/, "").trim()).find(looksLikeName) ??
    (first && wordCount(first) <= 4 && !EMAIL_RE.test(first) && !normaliseHeader(first) ? first.replace(/[|·•].*$/, "").trim() : null);
  const name = nameLine || null;

  // Only count bullets from sections where results matter.
  const core = bullets.filter((b) => b.section !== "skills" && b.section !== "interests" && b.section !== "header" && b.section !== "summary" && b.section !== "education");
  const scored = (core.length >= 3 ? core : bullets).slice(0, MAX_BULLETS);
  scored.forEach((b, i) => (b.index = i));

  return { text, lines, sections, sectionLines, bullets: scored, words: wordCount(text), name, email, phone, linkedin };
}

const MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*";

/** "Summer Intern, Harlow Partners | June 2026 – Aug 2026" -> "Summer Intern, Harlow Partners" */
export function cleanRole(role: string): string {
  return role
    .replace(/\s*[|·•]\s.*$/, "")
    .replace(new RegExp(`\\s*[,–—-]?\\s*(${MONTH}\\s+)?\\d{4}.*$`, "i"), "")
    .replace(new RegExp(`\\s*[,–—-]?\\s*${MONTH}\\s*[–—-].*$`, "i"), "")
    .replace(/[\s,–—-]+$/, "")
    .trim();
}

export function roleLabel(b: ParsedBullet): { where: string; short: string } {
  const sec = b.section === "activities" ? "ACTIVITIES" : b.section.toUpperCase();
  const role = b.role ? cleanRole(b.role).toUpperCase().slice(0, 48) || null : null;
  return { where: role ? `${sec} · ${role}` : `${sec} ${b.posInSection}`, short: `${sec} ${b.posInSection}` };
}
