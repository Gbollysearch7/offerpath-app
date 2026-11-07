import type { ConfirmedFact } from "@/lib/types";
import { LINKEDIN_SECTIONS, type LinkedinPayload, type LinkedinSection, type LinkedinSectionKey, type LinkedinVersion } from "@/lib/linkedin-types";
import { blankBrackets, buildClaimInventory, figuresIn, MONTHS, normaliseText, stemsIn, withoutInstructions, wordsIn, type ClaimInventory, type CvEntry } from "./claims";
import { checkProfile, checkRewrite, checkSkill, forTypedText, REWRITE_CHECK_VERSION, type RewriteCheck, type RewriteIssue } from "./rewrite-check";

// OP-018: LinkedIn text goes through the same fact check as a CV rewrite (OP-015). The source is what the student gave
// us: their chosen CV and their profile as first pasted. The career aim is deliberately not source: wanting a role isn't
// holding it. On top of OP-015's rules is one more, for lower-case job titles those rules can't see.

export const currentVersion = (s: LinkedinSection): LinkedinVersion => s.versions.find((v) => v.id === s.current)!;
export const sectionOf = (p: Pick<LinkedinPayload, "sections">, key: LinkedinSectionKey): LinkedinSection => p.sections.find((s) => s.key === key)!;

const BULLET_RE = /^\s*[•\-*–▪◦‣›]\s*/;
const HAS_DATE = /\b(?:19|20)\d{2}\b|\bpresent\b/i;

export const stripBullet = (line: string) => line.replace(BULLET_RE, "").trim();
export const linesOf = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

/** A role line rather than a description: not marked as a bullet, short, not a sentence, and saying when or where. */
export function isRoleLine(line: string): boolean {
  if (BULLET_RE.test(line) || /[.!?:]$/.test(line.trim())) return false;
  const words = line.trim().split(/\s+/).length;
  return words <= 16 && (HAS_DATE.test(line) || /\s(?:at|@)\s/.test(line) || words <= 6);
}

const SOURCE_HEADINGS: Record<LinkedinSectionKey, string> = { headline: "PROFILE", about: "PROFILE", experience: "EXPERIENCE", education: "EDUCATION", skills: "SKILLS", other: "ACTIVITIES" };

/** The profile as first given, laid out so the claim parser reads roles and bullets as it does on a CV. */
export function profileAsSource(sections: { key: LinkedinSectionKey; text: string }[]): string {
  const parts = new Map<string, string[]>();
  for (const { key, text } of sections) {
    if (!text.trim()) continue;
    const heading = SOURCE_HEADINGS[key];
    const body = key === "experience" ? linesOf(text).map((l) => (isRoleLine(l) ? l : `• ${stripBullet(l)}`)).join("\n") : text;
    parts.set(heading, [...(parts.get(heading) ?? []), body]);
  }
  return [...parts].map(([h, b]) => `${h}\n${b.join("\n")}`).join("\n\n");
}

/** What a suggestion may rely on. Only the current versions' facts count, so undoing a version withdraws what it said. */
export function factsOf(p: Pick<LinkedinPayload, "sections">): ConfirmedFact[] {
  return p.sections.flatMap((s) => currentVersion(s).facts);
}

export function inventoryFor(p: Pick<LinkedinPayload, "sections">, cvText: string | null): ClaimInventory {
  const originals = LINKEDIN_SECTIONS.map((key) => ({ key, text: sectionOf(p, key).versions[0].text }));
  return buildClaimInventory([cvText ?? "", profileAsSource(originals)].filter((t) => t.trim()).join("\n\n"), factsOf(p));
}

/* ---------- Roles ---------- */

const ROLE_NOUN = /\b(analyst|consultant|engineer|developer|manager|director|founder|co-founder|ceo|cto|cfo|coo|head of|team lead|project lead|tech lead|officer|specialist|associate|intern|executive|scientist|designer|researcher|coordinator|accountant|solicitor|lawyer|barrister|president|chair|treasurer|secretary|assistant|adviser|advisor|architect|programmer|administrator|mentor|tutor|ambassador|partner)s?\b/gi;
/** Wanting a role, or naming one someone else holds, isn't claiming to hold it. */
const ASPIRES = /\b(aspiring|seeking|looking for|looking to|interested in|targeting|towards|hoping|open to|pursuing|future|prospective|aiming|aim to|want to|to become|applying for)\b/i;
const NOT_A_CLAIM_BEFORE = new Set(["with", "for", "to", "alongside", "by", "of", "the", "from", "and", "our", "other", "their", "senior"]);
const JOB_NOUN_AFTER = /^\s*(roles?|positions?|jobs?|schemes?|programmes?|internships?|vacanc)/i;

function roleClaims(text: string, source: string): { phrase: string }[] {
  const out: { phrase: string }[] = [];
  const clauses = blankBrackets(normaliseText(text)).split(/[|;\n.]+/);
  const haystack = ` ${normaliseText(source).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ")} `;
  const inSource = (phrase: string) => haystack.includes(` ${phrase} `) || haystack.includes(` ${phrase}s `);
  for (const clause of clauses) {
    for (const m of clause.matchAll(ROLE_NOUN)) {
      const before = clause.slice(0, m.index);
      const after = clause.slice(m.index + m[0].length);
      if (ASPIRES.test(before) || JOB_NOUN_AFTER.test(after)) continue;
      const noun = m[1].toLowerCase();
      const prev = wordsIn(before).pop()?.toLowerCase() ?? "";
      if (NOT_A_CLAIM_BEFORE.has(prev)) continue;
      // "Retail Assistant" in the source doesn't support "Marketing Assistant".
      const describing = prev && !["a", "an", "as", "am", "i", "was", "is"].includes(prev) && !/^\d/.test(prev);
      const phrase = describing ? `${prev} ${noun}` : noun;
      if (!inSource(phrase)) out.push({ phrase });
    }
  }
  return out;
}

const roleIssue = (phrase: string): RewriteIssue => ({
  code: "unsupported-entity",
  severity: "block",
  found: phrase,
  key: `invented-role:${phrase}`,
  message: `This says you are or were "${phrase}", and nothing you've given us shows that role. To say you want it, use wording like "seeking ${phrase} roles".`,
});

/* ---------- Whole sections ---------- */

const verdictOf = (issues: RewriteIssue[]): RewriteCheck["verdict"] => (issues.some((i) => i.severity === "block") ? "block" : issues.some((i) => i.severity === "confirm") ? "confirm" : "pass");

const sentences = (text: string) => linesOf(text).flatMap((l) => l.split(/(?<=[.!?])\s+(?=[A-Z"“[])/)).map((s) => s.trim()).filter(Boolean);

function inventoryText(inv: ClaimInventory): string {
  return [...inv.entries.flatMap((e) => [e.heading, e.context, ...e.lines, ...e.factValues]), ...inv.facts.map((f) => f.value)].join("\n");
}

function checkLines(p: Pick<LinkedinPayload, "sections">, inv: ClaimInventory, key: LinkedinSectionKey, text: string, known: Set<string>): RewriteCheck[] {
  const same = (s: string) => known.has(squash(s));
  if (key === "skills") {
    const haystack = normaliseText(inventoryText(inv)).toLowerCase();
    return text
      .split(/[,\n;•|]+/)
      .map((t) => t.trim())
      .filter((t) => t && !same(t) && !haystack.includes(normaliseText(t).toLowerCase()))
      .map((t) => checkSkill(inv, t));
  }
  if (key === "experience") return checkExperience(p, inv, text, same);
  const view = roleViewOf(p, inv);
  return sentences(text)
    .filter((s) => !same(s))
    .flatMap((s) => {
      const line = stripBullet(s);
      const profile = checkProfile(inv, line);
      // Education reads across roles by nature: a degree's dates aren't a claim about a job.
      return key === "education" ? [profile] : [profile, issuesOnly(crossRoleIssues(view, line))];
    });
}

const squash = (s: string) => normaliseText(s).replace(/\s+/g, " ").trim().toLowerCase();

/* ---------- Experience, role by role ---------- */

// A section's text isn't a CV line, so "this figure exists somewhere" is all checkProfile can say about it. Here the text
// is cut into roles and each piece goes through OP-015's checkRewrite against its own role. The profile's roles are cut
// from the section itself rather than by the CV parser, which reads a page pasted from LinkedIn as one long role.

interface RoleBlock {
  heading: string | null;
  lines: string[];
}

interface Role {
  headings: Set<string>;
  tokens: Set<string>;
  years: Set<string>;
  /** Squashed, for an exact match: whatever the source or the current text has under this role. */
  lines: Set<string>;
  /** Words only this role's heading has, so naming one of them names this role. */
  distinctive: Set<string>;
  entry: CvEntry;
}

interface RoleView {
  roles: Role[];
  /** The inventory with experience replaced by these roles, first, so a figure is traced to its role before any summary repeating it. */
  inv: ClaimInventory;
}

const yearsIn = (s: string) => new Set(normaliseText(s).match(/\b(?:19|20)\d{2}\b/g) ?? []);
const NOT_IDENTITY = /^(at|in|of|the|and|for|to|a|an|present|current|now|full|part|time|ltd|limited|plc|inc|llp|\d+)$/i;
function headingTokens(heading: string): Set<string> {
  return new Set(wordsIn(heading.replace(/-/g, " ")).filter((w) => !NOT_IDENTITY.test(w) && !MONTHS.test(w)).map((w) => [...stemsIn(w)][0]));
}
const subset = (a: Set<string>, b: Set<string>) => [...a].every((x) => b.has(x));
const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((x) => b.has(x)).length;
const sameYears = (a: Set<string>, b: Set<string>) => !a.size || !b.size || (a.size === b.size && subset(a, b));
/** "Data Analyst, Acme Ltd" and "Data Analyst at Acme, 2022" are one role. Different years aren't: people return to a job. */
const isSameRole = (heading: string, r: Pick<Role, "tokens" | "years">) => {
  const t = headingTokens(heading);
  return t.size > 0 && r.tokens.size > 0 && (subset(t, r.tokens) || subset(r.tokens, t)) && sameYears(yearsIn(heading), r.years);
};

const STRONG_HEADING = (l: string) => HAS_DATE.test(l) || /\s(?:at|@)\s/.test(l);
const WORK_VERB = /^(?:[A-Z][a-z]+ed|Built|Led|Ran|Wrote|Won|Taught|Made|Grew|Sold|Set|Cut|Kept|Drew|Gave|Took|Held|Met)\b/;
/** Short and unmarked, but says what someone did: a line that has lost its bullet, not a heading. */
const looksLikeWork = (l: string) => figuresIn(l).some((f) => f.kind !== "date") || (WORK_VERB.test(stripBullet(l)) && stripBullet(l).search(ROLE_NOUN) < 0);

/** Cuts section text into roles. `view`, when given, recognises headings and lines the student has already given us. */
function roleBlocksOf(text: string, view?: RoleView): RoleBlock[] {
  const lines = linesOf(text);
  const isKnownLine = (l: string) => !!view?.roles.some((r) => r.lines.has(squash(stripBullet(l))));
  const isKnownHeading = (l: string) => {
    const t = headingTokens(stripBullet(l).replace(/[:*_]+$/, ""));
    return !!view?.roles.some((r) => t.size > 0 && t.size === r.tokens.size && subset(t, r.tokens));
  };
  const isHead = (l: string) => !isKnownLine(l) && (isKnownHeading(l) || (isRoleLine(l) && !looksLikeWork(l)));
  const anyStrong = lines.some((l) => isHead(l) && (STRONG_HEADING(l) || isKnownHeading(l)));

  const blocks: RoleBlock[] = [];
  const open = () => blocks[blocks.length - 1];
  const body = (l: string) => {
    if (!blocks.length) blocks.push({ heading: null, lines: [] });
    open().lines.push(l);
  };
  for (let i = 0; i < lines.length; ) {
    if (!isHead(lines[i])) {
      body(lines[i++]);
      continue;
    }
    const group: string[] = [];
    while (i < lines.length && isHead(lines[i])) group.push(lines[i++]);
    // A short line among real headings is a line, unless a bullet follows it. With no real headings it's all there is.
    const strong = group.some((l) => STRONG_HEADING(l) || isKnownHeading(l));
    if (!strong && anyStrong && !/^\s*[•\-*–▪◦‣›]/.test(lines[i] ?? "")) {
      group.forEach(body);
      continue;
    }
    // A date closes a heading, so two roles with nothing between them stay two roles. A location after it stays with it.
    let part: string[] = [];
    const headings: string[][] = [];
    for (const l of group) {
      part.push(stripBullet(l).replace(/:+$/, ""));
      if (HAS_DATE.test(l)) {
        headings.push(part);
        part = [];
      }
    }
    if (part.length) {
      if (headings.length) headings[headings.length - 1].push(...part);
      else headings.push(part);
    }
    for (const h of headings) blocks.push({ heading: h.join(", "), lines: [] });
  }
  return blocks;
}

/** The roles the student has given us: the profile as first given, the current text, and the chosen CV. */
function roleViewOf(p: Pick<LinkedinPayload, "sections">, inv: ClaimInventory): RoleView {
  const section = sectionOf(p, "experience");
  const texts = [section.versions[0].text, currentVersion(section).text];
  const own = stemsIn(texts[0]);
  const isExperienceRole = (e: CvEntry) => e.section === "experience" && e.isRole;
  // The parser's reading of the profile is replaced by the roles below. What it read from the CV is kept.
  const fromCv = inv.entries.filter((e) => isExperienceRole(e) && !subset(stemsIn(`${e.heading}\n${e.context}\n${e.lines.join("\n")}`), own));
  const blocks = [
    ...texts.flatMap((t) => roleBlocksOf(t)).filter((b) => b.heading),
    ...fromCv.map((e) => ({ heading: e.heading, lines: [...e.rawLines, ...linesOf(e.context).filter((l) => !isRoleLine(l))], facts: e.factValues })),
  ] as (RoleBlock & { heading: string; facts?: string[] })[];

  const roles: Role[] = [];
  for (const b of blocks) {
    const lines = b.lines.map(stripBullet);
    let role = roles.find((r) => isSameRole(b.heading, r));
    if (!role) {
      role = { headings: new Set(), tokens: headingTokens(b.heading), years: yearsIn(b.heading), lines: new Set(), distinctive: new Set(), entry: { id: `role${roles.length}`, section: "experience", heading: b.heading, context: "", lines: [], bulletIndex: [], rawLines: [], isRole: true, claims: [], factValues: [] } };
      roles.push(role);
    }
    role.headings.add(squash(b.heading));
    if (!role.entry.heading.includes(b.heading)) role.entry.heading += ` / ${b.heading}`;
    for (const l of lines) {
      if (role.lines.has(squash(l))) continue;
      role.lines.add(squash(l));
      const clean = withoutInstructions(l).text;
      if (clean) role.entry.lines.push(clean);
      role.entry.rawLines.push(l);
      role.entry.bulletIndex.push(null);
    }
    role.entry.factValues.push(...(b.facts ?? []));
  }
  const elsewhere = stemsIn(inv.entries.filter((e) => e.section === "education" || e.section === "skills").map((e) => `${e.heading}\n${e.context}`).join("\n"));
  for (const r of roles) r.distinctive = new Set([...r.tokens].filter((t) => !elsewhere.has(t) && !roles.some((o) => o !== r && o.tokens.has(t))));
  return { roles, inv: { ...inv, entries: [...roles.map((r) => r.entry), ...inv.entries.filter((e) => !isExperienceRole(e))] } };
}

const issuesOnly = (issues: RewriteIssue[]): RewriteCheck => ({ validator: REWRITE_CHECK_VERSION, verdict: verdictOf(issues), issues, used: [], questions: [], unchanged: false, entry: null, sourceHadInstructions: false });
const checkUnderRole = (view: RoleView, role: Role, line: string) => checkRewrite(view.inv, { index: -1, text: "", entryId: role.entry.id }, line);

/** A heading that isn't word for word one we were given: which role it means, and whether it says anything from another. */
function checkHeading(view: RoleView, inv: ClaimInventory, heading: string, out: RewriteCheck[]): Role | null {
  const exact = view.roles.find((r) => r.headings.has(squash(heading)));
  if (exact) return exact;
  const score = (r: Role) => overlap(headingTokens(heading), r.tokens) + overlap(yearsIn(heading), r.years);
  const best = view.roles.find((r) => isSameRole(heading, r)) ?? [...view.roles].sort((a, b) => score(b) - score(a)).find((r) => score(r) > 0);
  if (!best) {
    out.push(checkProfile(inv, heading));
    return null;
  }
  const check = checkUnderRole(view, best, heading);
  // A heading can be shorter than a line needs to be.
  const issues = check.issues.filter((i) => i.key !== "not-a-cv-line:short");
  out.push({ ...check, issues, verdict: verdictOf(issues) });
  return best;
}

const shortText = (s: string) => (s.length > 40 ? `${s.slice(0, 37)}…` : s);
const firstHeading = (r: Role) => r.entry.heading.split(" / ")[0];
const lineWords = (s: string) => new Set([...stemsIn(s)].filter((w) => !NOT_IDENTITY.test(w)));
function likeness(a: string, b: string): number {
  const [x, y] = [lineWords(a), lineWords(b)];
  return overlap(x, y) / (new Set([...x, ...y]).size || 1);
}
/** Close enough to read as the same line after a light rewording. */
const SAME_LINE = 0.75;

/** The role this line really belongs to, when it's another role's and not this one's, word for word or nearly. */
function ownerElsewhere(view: RoleView, line: string, role: Role | null): Role | null {
  const best = (r: Role) => Math.max(0, ...r.entry.rawLines.map((l) => likeness(line, l)));
  const others = view.roles.filter((r) => r !== role).map((r) => ({ r, near: best(r) })).sort((a, b) => b.near - a.near)[0];
  return others && others.near >= SAME_LINE && others.near > (role ? best(role) : 0) ? others.r : null;
}

function movedLine(line: string, to: string, owner: Role): RewriteIssue {
  return {
    code: "entity-from-other-entry",
    severity: "block",
    found: line.slice(0, 120),
    key: `line-from-other-role:${squash(line).slice(0, 80)}`,
    from: firstHeading(owner),
    message: `This puts "${shortText(line)}" under "${shortText(to)}", but you gave it under "${shortText(firstHeading(owner))}".`,
  };
}

const AT_NAME = /(?:\b[Aa]t|@)\s+(\p{Lu}[\p{L}&-]*)/u;
const HELD_AT = /([\p{L}&-]+(?:\s+[\p{L}&-]+)?)\s+(?:at|@)\s+(\p{Lu}[\p{L}&-]*(?:\s+\p{Lu}[\p{L}&-]*)*)/gu;

/**
 * For text outside a role heading (a profile sentence, a line with no heading above it). If it says which role it means,
 * nothing from another role may come with it. Text that doesn't say which role it means can't be held to one: see the report.
 */
function crossRoleIssues(view: RoleView, line: string): RewriteIssue[] {
  if (view.roles.length < 2) return [];
  const clean = blankBrackets(normaliseText(line));
  const issues: RewriteIssue[] = [];
  // "Retail Assistant at Economics Society": each half true, and together not.
  for (const m of clean.matchAll(HELD_AT)) {
    if (m[1].search(ROLE_NOUN) < 0) continue;
    const title = headingTokens(m[1]);
    const employer = headingTokens(m[2]);
    const holders = view.roles.filter((r) => subset(title, r.tokens));
    const employers = view.roles.filter((r) => overlap(employer, r.tokens) > 0);
    if (holders.length && employers.length && !holders.some((h) => employers.includes(h))) {
      issues.push({ code: "entity-from-other-entry", severity: "block", found: m[0], key: `entity-from-other-entry:${squash(m[0])}`, from: firstHeading(employers[0]), message: `"${m[0]}" joins two different roles you gave us: "${shortText(firstHeading(holders[0]))}" and "${shortText(firstHeading(employers[0]))}".` });
    }
  }
  // Clause by clause: "I organised 4 events for the Society and served customers at Boots" is about two roles, each as given.
  const roleHeadings = new Set(view.roles.map((r) => r.entry.heading));
  for (const clause of clean.split(/\s+and\s+|;|,\s+/)) {
    const atName = AT_NAME.exec(clause)?.[1];
    const atRoles = atName ? view.roles.filter((r) => overlap(headingTokens(atName), r.tokens) > 0) : [];
    const stems = stemsIn(clause);
    const named = atRoles.length ? atRoles : view.roles.filter((r) => [...r.distinctive].some((t) => stems.has(t)));
    if (named.length !== 1) continue;
    issues.push(...checkUnderRole(view, named[0], clause).issues.filter((i) => (i.code === "figure-from-other-entry" || i.code === "date-from-other-entry") && i.from && roleHeadings.has(i.from)));
  }
  return issues;
}

function checkExperience(p: Pick<LinkedinPayload, "sections">, inv: ClaimInventory, text: string, same: (s: string) => boolean): RewriteCheck[] {
  const view = roleViewOf(p, inv);
  const out: RewriteCheck[] = [];
  for (const block of roleBlocksOf(text, view)) {
    const role = block.heading ? checkHeading(view, inv, block.heading, out) : null;
    for (const raw of block.lines) {
      const line = stripBullet(raw);
      if (role?.lines.has(squash(line))) continue;
      const owner = block.heading ? ownerElsewhere(view, line, role) : null;
      if (owner) {
        out.push(issuesOnly([movedLine(line, block.heading!, owner)]));
        continue;
      }
      if (role) {
        out.push(checkUnderRole(view, role, line));
        continue;
      }
      // Under no role, or a role we weren't given. A line of the student's own isn't asked about again.
      if (same(line) || same(raw)) continue;
      out.push(checkProfile(inv, line), issuesOnly(crossRoleIssues(view, line)));
    }
  }
  return out;
}

/** Every line or sentence of the source and of the current text: already the student's own or already decided. */
export function knownLines(p: Pick<LinkedinPayload, "sections">, key: LinkedinSectionKey): Set<string> {
  const s = sectionOf(p, key);
  const out = new Set<string>();
  for (const text of [s.versions[0].text, currentVersion(s).text]) {
    for (const line of linesOf(text)) {
      out.add(squash(line));
      out.add(squash(stripBullet(line)));
    }
    for (const sentence of sentences(text)) out.add(squash(sentence));
  }
  return out;
}

export interface CheckOptions {
  /** The line this replaces, for a suggestion that swaps one line of a role: checked against that line and role. */
  before?: string | null;
  /** The student's own words: factual blocks become confirmations, as in OP-016. */
  typed?: boolean;
}

/**
 * Runs the OP-015 checks over a piece of section text. Line by line, because a section isn't one CV line, and only over
 * words that are new: a student's own unchanged text isn't asked about again.
 */
export function checkSectionText(p: Pick<LinkedinPayload, "sections">, inv: ClaimInventory, key: LinkedinSectionKey, text: string, options: CheckOptions = {}): RewriteCheck {
  const known = knownLines(p, key);
  const source = inventoryText(inv);
  const checks = options.before
    ? [checkRewrite(inv, { index: -1, text: stripBullet(options.before) }, stripBullet(text))]
    : checkLines(p, inv, key, text, known);
  const merged = new Map<string, RewriteIssue>();
  for (const check of checks) for (const i of check.issues) if (!merged.has(i.key)) merged.set(i.key, i);
  // The role rule reads the new words only.
  const fresh = linesOf(text).filter((l) => !known.has(squash(l)) && !known.has(squash(stripBullet(l))));
  for (const line of fresh) for (const { phrase } of roleClaims(line, source)) if (!merged.has(`invented-role:${phrase}`)) merged.set(`invented-role:${phrase}`, roleIssue(phrase));
  // Where an issue sits is measured within one line, so it means nothing in text of several lines or sentences: a placeholder
  // repair there would land on the wrong words, and flattening the section would lose which line is under which role.
  const oneLine = !!options.before || (linesOf(text).length === 1 && sentences(text).length === 1 && stripBullet(text) === text.trim());
  let issues = [...merged.values()].map((i) => (oneLine ? i : { ...i, span: undefined, placeholder: undefined }));
  // A headline can be short and a skill shorter; and a student's own link is theirs to include. A model's isn't.
  issues = issues.filter((i) => !(i.key === "not-a-cv-line:short" && (options.typed || key === "headline" || key === "skills")));
  if (options.typed) issues = issues.filter((i) => i.key !== "not-a-cv-line:link");
  const check: RewriteCheck = {
    validator: REWRITE_CHECK_VERSION,
    verdict: verdictOf(issues),
    issues,
    used: [],
    questions: [...new Set(checks.flatMap((c) => c.questions))],
    unchanged: fresh.length === 0 && !options.before,
    entry: null,
    sourceHadInstructions: inv.instructionSentences > 0,
  };
  return options.typed ? forTypedText(check) : check;
}

export const isUnresolvedBlank = (text: string) => /\[[^\]\n]*\]/.test(text);
