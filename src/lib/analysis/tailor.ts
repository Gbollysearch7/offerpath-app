import type { ConfirmedFact } from "@/lib/types";
import { allWordsIn, buildClaimInventory, stemsIn, withoutInstructions } from "./claims";
import { SECTION_HEADERS, SECTOR_KEYWORDS, SECTORS, STRONG_VERBS } from "./lexicon";
import { BULLET_RE, normaliseHeader, parseCv } from "./parse";
import { checkProfile, checkRewrite, checkSkill, withPlaceholders, type RewriteCheck, type RewriteIssue } from "./rewrite-check";

// Checks Claude's tailored version against the CV it came from, then writes the whole tailored CV out as text.

export interface TailorDraft {
  summary: string;
  bullets: { id: number; after: string; keywords: string[] }[];
  skills: string[];
  notEvidenced: string[];
}

// "-" is left alone: it means nothing outside a character class, and `\-` is a syntax error in a /u pattern (spansOf).
const esc = (s: string) => s.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");
// Placeholders such as [X%] or [£X] are allowed: they ask the student for a number rather than inventing one.
const numbersIn = (s: string) => (s.replace(/\[[^\]]{0,40}\]/g, " ").match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ""));

/** True when every number in `text` already appears in `source`: tailoring may reword facts, never invent them. */
export function keepsNumbers(text: string, source: string): boolean {
  const known = new Set(numbersIn(source));
  return numbersIn(text).every((n) => known.has(n));
}

const wordsOf = (s: string) => s.toLowerCase().match(/[a-z0-9£$%]+/g) ?? [];
/** A swapped synonym or a dropped clause isn't worth the student's time; a tailored line has to say something new. */
function changesEnough(after: string, before: string): boolean {
  const old = new Set(wordsOf(before));
  return wordsOf(after).filter((w) => !old.has(w)).length >= 2;
}

const inCv = (cvText: string, term: string) => new RegExp(`(^|[^a-z0-9])${esc(term.toLowerCase())}([^a-z0-9]|$)`).test(cvText.toLowerCase());

function uniqueTerms(terms: string[], max: number) {
  const seen = new Set<string>();
  return terms
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && t.length <= 40 && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .slice(0, max);
}

/**
 * What a model says the advert asks for is only shown if the advert says it: every word of the term, in any form. No
 * advert, nothing. The student reads these as a statement about the advert, with no check of their own to fall back on.
 */
export function advertTerms(terms: string[], jobText: string): string[] {
  const advert = stemsIn(jobText);
  return terms.filter((t) => allWordsIn(t, advert));
}

export interface CheckedDraft extends TailorDraft {
  bullets: (TailorDraft["bullets"][number] & { check: RewriteCheck; note: string | null })[];
  summaryCheck: RewriteCheck | null;
  skillChecks: { term: string; check: RewriteCheck }[];
  /** Generated text that failed the check, and why. It isn't kept: only this description of it. */
  withheld: { where: string; reason: string }[];
}

const named = (issues: RewriteIssue[]) => {
  const found = issues.filter((i) => i.severity === "block" && i.found).map((i) => `"${i.found}"`).slice(0, 3);
  return found.length ? found.join(", ") : "wording that isn't a CV line";
};

/**
 * Keeps what holds up against the CV, by the same check as a line rewrite (OP-015). What fails is repaired with a
 * placeholder if a placeholder is all it needs, and otherwise dropped with a reason. `lines[i].text` is what the draft was
 * written from and `lines[i].locate` the line as first scored. Runs on whatever the provider returned, however it got here.
 */
export function checkTailorDraft(draft: TailorDraft, lines: { text: string; locate?: string; where?: string }[], cvText: string, facts: ConfirmedFact[] = [], jobText = ""): CheckedDraft {
  const inv = buildClaimInventory(cvText, facts);
  const used = new Set<number>();
  const withheld: CheckedDraft["withheld"] = [];
  const bullets: CheckedDraft["bullets"] = [];
  for (const raw of draft.bullets) {
    const after = raw.after.replace(/\s+/g, " ").trim();
    const line = lines[raw.id];
    if (!Number.isInteger(raw.id) || !line || used.has(raw.id)) continue;
    if (after.length < 12 || after.length > 400 || after === line.text || !changesEnough(after, line.text)) continue;
    const ref = { index: raw.id, text: line.text, locate: line.locate };
    let text = after;
    let check = checkRewrite(inv, ref, text);
    let note: string | null = null;
    if (check.verdict === "block") {
      const repaired = withPlaceholders(text, check);
      const again = repaired ? checkRewrite(inv, ref, repaired) : null;
      if (!repaired || !again || again.verdict === "block") {
        withheld.push({ where: line.where ?? "A line", reason: `The suggestion included ${named(check.issues)}, which your CV doesn't show for this entry.` });
        continue;
      }
      note = `We replaced ${named(check.issues)} with a placeholder, because your CV doesn't give that for this entry. Add the real figure only if you have one.`;
      text = repaired;
      check = again;
    }
    used.add(raw.id);
    const own = stemsIn(text);
    // A keyword is only "matched" if the sentence says it and the advert does too: the page calls it the advert's wording.
    const keywords = advertTerms(uniqueTerms(raw.keywords, 4), jobText).filter((k) => allWordsIn(k, own));
    bullets.push({ ...raw, after: text, keywords, check, note });
  }
  // The model's own list decides what it can't also claim as a skill; only what the advert asks and the CV lacks is shown.
  const listed = uniqueTerms(draft.notEvidenced, 12);
  const notEvidenced = advertTerms(listed, jobText).filter((t) => !inCv(cvText, t));
  const unproven = new Set(listed.map((t) => t.toLowerCase()));

  let summary = draft.summary.replace(/\s+/g, " ").trim();
  let summaryCheck: RewriteCheck | null = null;
  if (summary) {
    // No placeholder repair here: with the figure gone the sentence still claims what the CV doesn't show.
    const first = checkProfile(inv, summary);
    if (first.verdict !== "block") summaryCheck = first;
    else {
      withheld.push({ where: "Profile", reason: `The suggested profile included ${named(first.issues)}, which your CV doesn't show.` });
      summary = "";
    }
  }

  const skillChecks: CheckedDraft["skillChecks"] = [];
  // A skill can't be both shown by the CV and missing from it; when Claude says both, leave it out.
  for (const term of uniqueTerms(draft.skills, 10).filter((s) => !inCv(cvText, s) && !unproven.has(s.toLowerCase()))) {
    const check = checkSkill(inv, term);
    if (check.verdict === "block") withheld.push({ where: "Skills", reason: `The suggestion listed ${named(check.issues)}, which your CV doesn't show.` });
    else skillChecks.push({ term, check });
  }
  return { summary, bullets: bullets.slice(0, 10), skills: skillChecks.map((s) => s.term), notEvidenced, summaryCheck, skillChecks, withheld };
}

/* ---------- Putting edits into the document ---------- */

export interface LineEdit {
  /** The line's words, as the parser joined them. */
  from: string;
  /** Which appearance of those words, in document order: the same words can sit under two roles. */
  occurrence?: number;
  /** New words for the line. Omit to leave it as it is. */
  to?: string;
  /** New lines to add after it. */
  add?: string[];
}

const edgeMark = "[^\\p{L}\\p{N}\\n]{0,4}";

/** Where a line's words sit in the text. A whole line first, so a line can't match the start of a longer one. */
function spansOf(text: string, from: string): [number, number][] {
  const words = from.split(/\s+/).filter(Boolean).map(esc);
  if (!words.length) return [];
  const body = words.join("\\s+");
  const whole = [...text.matchAll(new RegExp(`(^|\\n)([^\\S\\n]*${edgeMark}[^\\S\\n]*)(${body})(?=[^\\S\\n]*(?:\\n|$))`, "gu"))].map((m): [number, number] => {
    const start = m.index + m[1].length + m[2].length;
    return [start, start + m[3].length];
  });
  if (whole.length) return whole;
  return [...text.matchAll(new RegExp(body, "gu"))].map((m): [number, number] => [m.index, m.index + m[0].length]);
}

/**
 * Applies line edits at their own positions, all from the original text, so one edit can't move another. `missing` lists
 * the edits that couldn't be placed: a caller must not tell the student they were made.
 */
export function applyLineEdits(cvText: string, edits: LineEdit[]): { text: string; missing: LineEdit[] } {
  const text = cvText.replace(/\r/g, "");
  const missing: LineEdit[] = [];
  const placed: { span: [number, number]; edit: LineEdit }[] = [];
  for (const edit of edits) {
    const span = spansOf(text, edit.from)[edit.occurrence ?? 0];
    if (span) placed.push({ span, edit });
    else missing.push(edit);
  }
  let out = text;
  for (const { span, edit } of placed.sort((a, b) => b.span[0] - a.span[0])) {
    const words = edit.to ?? out.slice(span[0], span[1]);
    out = out.slice(0, span[0]) + words + (edit.add ?? []).map((l) => `\n• ${l}`).join("") + out.slice(span[1]);
  }
  return { text: out, missing };
}

/** How many earlier lines have the same words: which appearance in the document this line is. */
export const occurrenceOf = (texts: string[], index: number) => texts.slice(0, index).filter((t) => t === texts[index]).length;

/** The CV as the student has it now: the uploaded text with the lines they saved in the review. */
export function withSavedLines(cvText: string, lines: { text: string; accepted?: string }[]): string {
  const originals = lines.map((l) => l.text);
  const edits = lines.flatMap((l, i): LineEdit[] => (l.accepted ? [{ from: l.text, occurrence: occurrenceOf(originals, i), to: l.accepted }] : []));
  return applyLineEdits(cvText, edits).text;
}

/** The existing profile's words, which an accepted new profile replaces. Empty if the CV has none. */
export function existingProfile(cvText: string): string {
  const lines = cvText.replace(/\r/g, "").split("\n");
  const at = lines.findIndex((l) => normaliseHeader(l) === "summary");
  if (at < 0) return "";
  const out: string[] = [];
  for (let i = at + 1; i < lines.length && normaliseHeader(lines[i]) === null; i++) if (lines[i].trim()) out.push(lines[i].trim());
  return out.join(" ");
}

/** CV text for a prompt: sentences that read like instructions to software don't reach the model. */
export const promptSafeCv = (cvText: string) => cvText.replace(/\r/g, "").split("\n").map((l) => (l.trim() ? withoutInstructions(l).text : "")).join("\n");

/** The CV text with tailored bullets swapped in, the profile at the top and new skills in the skills section. */
export function buildTailoredCv(cvText: string, change: { summary: string; replacements: LineEdit[] | { from: string; to: string }[]; skills: string[] }): string {
  return buildTailoredDocument(cvText, change).text;
}

/** As buildTailoredCv, and says which line edits couldn't be placed. */
export function buildTailoredDocument(cvText: string, change: { summary: string; replacements: LineEdit[]; skills: string[] }): { text: string; missing: LineEdit[] } {
  const applied = applyLineEdits(cvText, change.replacements);
  return { text: addProfileAndSkills(applied.text, change), missing: applied.missing };
}

function addProfileAndSkills(text: string, change: { summary: string; skills: string[] }): string {
  const lines = text.split("\n");
  const headerAt = (key: string | null, from = 0) => lines.findIndex((l, i) => i >= from && (key ? normaliseHeader(l) === key : normaliseHeader(l) !== null));
  const sectionEnd = (start: number) => {
    const next = headerAt(null, start + 1);
    let end = next < 0 ? lines.length : next;
    while (end > start + 1 && !lines[end - 1].trim()) end--;
    return end;
  };

  if (change.skills.length) {
    const s = headerAt("skills");
    if (s >= 0) lines.splice(sectionEnd(s), 0, `• ${change.skills.join(", ")}`);
    else lines.push("", "SKILLS", change.skills.join(", "));
  }
  if (change.summary) {
    const s = headerAt("summary");
    if (s >= 0) lines.splice(s + 1, sectionEnd(s) - s - 1, change.summary);
    else {
      const first = headerAt(null);
      lines.splice(first < 0 ? Math.min(1, lines.length) : first, 0, "PROFILE", change.summary, "");
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* ---------- Laying the tailored CV out as a document ---------- */

export interface CvBlock {
  kind: "name" | "tagline" | "contact" | "heading" | "role" | "para" | "bullet";
  text: string;
  /** Dates on a role line, set right-aligned in the document. */
  date?: string;
}

// Letter-spaced headings ("C E R T I F I C A T I O N S") lose their gaps; look the heading back up in the known list.
const SPACED_HEADING = new Map(Object.keys(SECTION_HEADERS).map((h) => [h.replace(/\s+/g, ""), h]));
const ROLE_SECTIONS = new Set(["experience", "education", "projects", "activities"]);
// Sections that are lists: every line is its own item.
const LIST_SECTIONS = new Set(["skills", "achievements", "interests"]);
const MON = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const WHEN = `(?:${MON}\\s+)?(?:19|20)\\d{2}`;
const DATE_TAIL = new RegExp(`\\s*[·|,]?\\s*(${WHEN}(?:\\s*(?:–|—|-|to)\\s*(?:${WHEN}|present|current|now|ongoing))?)\\s*$`, "i");
const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
// Words often found in letter-spaced CV taglines, on top of the CV's own words.
const TAGLINE_WORDS = new Set([
  ...words([...SECTORS, ...Object.keys(SECTION_HEADERS), ...Object.values(SECTOR_KEYWORDS).flat(), ...STRONG_VERBS].join(" ")),
  ..."product growth marketing technology digital data science engineer engineering software developer analyst analytics finance financial design designer graduate student manager management business strategy operations consultant consulting creative content brand research economics law legal health computer web full stack and of in for the".split(" "),
]);

/**
 * PDF text loses the gaps in letter-spaced lines ("D I G I T A L M A R K E T I N G"). Rebuild the words,
 * using the CV's own vocabulary as the dictionary; runs it can't split stay as they are.
 */
function unspace(line: string, vocab: Set<string>): string {
  return line.replace(/(?:^|(?<=\s))(?:\S ){3,}\S(?=\s|$)/g, (run) => {
    const letters = run.replace(/ /g, "");
    const lower = letters.toLowerCase();
    // best[i] = fewest words covering lower.slice(0, i)
    const best: (string[] | null)[] = [[]];
    for (let i = 1; i <= lower.length; i++) {
      best[i] = null;
      for (let j = Math.max(0, i - 20); j < i; j++) {
        const w = lower.slice(j, i);
        const ok = vocab.has(w) || /^[^a-z0-9]+$/.test(w);
        if (ok && best[j] && (!best[i] || best[j]!.length + 1 < best[i]!.length)) best[i] = [...best[j]!, letters.slice(j, i)];
      }
    }
    return best[lower.length]?.join(" ").replace(/ ([^a-z0-9 ]+) /gi, " $1 ") ?? letters;
  });
}

/** Turns CV text into document blocks. `bullets` are the CV's known bullet texts, used where the PDF lost its bullet marks. */
export function structureCv(cvText: string, bullets: string[]): CvBlock[] {
  const parsed = parseCv(cvText);
  const vocab = new Set([...words(cvText).filter((w) => w.length >= 2), ...TAGLINE_WORDS]);
  const starts = new Set(bullets.map((b) => words(b).slice(0, 6).join(" ")).filter((k) => k.split(" ").length >= 3));
  const startsBullet = (l: string) => {
    const w = words(l);
    return w.length >= 3 && starts.has(w.slice(0, 6).join(" "));
  };
  const lines = cvText.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  // A line that runs close to the full text width wrapped onto the next one; a short line ended where the student ended it.
  const widths = lines.map((l) => l.length).sort((a, b) => a - b);
  const fullWidth = widths[Math.floor(widths.length * 0.9)] ?? 0;
  const wrapped = (l: string) => l.length >= fullWidth * 0.75;
  const out: CvBlock[] = [];
  const contact: string[] = [];
  let section: string | null = null;
  let name: string | null = null;
  let prev = "";

  for (const raw of lines) {
    const key = normaliseHeader(raw);
    const last = out[out.length - 1];
    const joinable = last && (last.kind === "bullet" || last.kind === "para");
    const list = section !== null && LIST_SECTIONS.has(section);
    if (key) {
      const label = raw.replace(/[:|_*#]+/g, " ").replace(/\s+/g, " ").trim();
      const spaced = label.split(" ").every((t) => t.length === 1);
      const text = spaced ? (SPACED_HEADING.get(label.replace(/ /g, "").toLowerCase()) ?? key) : label;
      // Spaced headings come back lower case; give them a capital. Typed headings keep the student's own casing.
      out.push({ kind: "heading", text: spaced ? text[0].toUpperCase() + text.slice(1) : text });
      section = key;
    } else if (section === null) {
      // Header block: the name, then everything else as contact items. PDFs can give these lines in any order.
      if (!name && parsed.name && raw.replace(/\s*[|·•].*$/, "").trim() === parsed.name) name = parsed.name;
      else
        contact.push(
          ...unspace(raw, vocab)
            // Split on separators, and before a link or email that runs on from a tagline.
            .split(/\s+[|·•]\s+|\s+(?=\S+@\S+|(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.[a-z]{2,}\/\S*)/i)
            .map((c) => c.trim())
            .filter(Boolean),
        );
    } else if (list && joinable && !BULLET_RE.test(raw) && (wrapped(prev) || /^[a-z()]/.test(raw) || /[,·&(-]$/.test(prev) || (prev.match(/\(/g) ?? []).length > (prev.match(/\)/g) ?? []).length)) {
      // A list item or paragraph that wrapped: the line before ran to the edge or stopped mid-item.
      last.text += (/[a-z]-$/i.test(last.text) && /^[a-z]/.test(raw) ? "" : " ") + raw;
    } else if (list && !BULLET_RE.test(raw) && wrapped(raw)) {
      // Running text in a list section (a skills paragraph, a list of certificates) stays a paragraph.
      out.push({ kind: "para", text: raw });
    } else if (BULLET_RE.test(raw) || startsBullet(raw) || list) {
      out.push({ kind: "bullet", text: raw.replace(BULLET_RE, "") });
    } else if (joinable && /^[a-z(]/.test(raw)) {
      last.text += (/[a-z]-$/i.test(last.text) ? "" : " ") + raw;
    } else if (section && ROLE_SECTIONS.has(section) && DATE_TAIL.test(raw) && words(raw).length <= 22) {
      const m = raw.match(DATE_TAIL)!;
      out.push({ kind: "role", text: raw.slice(0, m.index).replace(/[\s·|,–-]+$/, ""), date: m[1] });
    } else if (joinable && !/[.!?:;]$/.test(prev)) {
      last.text += " " + raw;
    } else if (last?.kind === "bullet" && section && ROLE_SECTIONS.has(section)) {
      // Under a role, a new sentence after a bullet is another bullet whose mark the PDF lost.
      out.push({ kind: "bullet", text: raw });
    } else if (section && ROLE_SECTIONS.has(section) && words(raw).length <= 10 && !/[.!?]$/.test(raw)) {
      out.push({ kind: "role", text: raw });
    } else {
      out.push({ kind: "para", text: unspace(raw, vocab) });
    }
    prev = raw;
  }
  // A tagline ("Product Growth & Marketing Technology") is the one header item that isn't a way to get in touch.
  const t = contact.findIndex((c) => !/[@\d/,]|www\.|\.[a-z]{2,}\b/i.test(c) && words(c).length >= 2 && words(c).length <= 10);
  const tagline = t >= 0 ? contact.splice(t, 1)[0] : null;
  const head: CvBlock[] = [];
  if (name) head.push({ kind: "name", text: name });
  if (tagline) head.push({ kind: "tagline", text: tagline });
  if (contact.length) head.push({ kind: "contact", text: [...new Set(contact)].join("  ·  ") });
  return [...head, ...out];
}
