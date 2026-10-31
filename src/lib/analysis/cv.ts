import type { AreaKey, AreaResult, CheckKey, CheckResult, CvAnalysis, LineResult } from "@/lib/types";
import {
  BUZZWORDS, DUTY_PHRASES, FILLER_WORDS, PASSIVE_RE, SECTOR_KEYWORDS, STRONG_VERBS, US_SPELLINGS, WEAK_VERBS, PRESENT_STRONG_VERBS } from "./lexicon";
import { normaliseText, sha256 } from "./fingerprint";
import { AI_JUDGE_MODEL, ruleJudgment, type BulletJudgment, type ScoringMethod } from "./judgment";
import { AREA_WEIGHTS, BANDS, LINE_PENALTIES as P, RUBRIC_VERSION, TARGETS as T } from "./rubric";
import { parseCv, roleLabel, wordCount, type ParsedBullet, type ParsedCv } from "./parse";

export const AREA_META: Record<AreaKey, { name: string; weight: number; what: (sector: string) => string }> = {
  impact: { name: "Impact", weight: AREA_WEIGHTS.impact, what: () => "Do your bullets show results, not just duties?" },
  clarity: { name: "Clarity", weight: AREA_WEIGHTS.clarity, what: () => "Is every line easy to read in one pass?" },
  structure: { name: "Structure and ATS", weight: AREA_WEIGHTS.structure, what: () => "Can people and screening software find what matters?" },
  sector: { name: "Sector fit", weight: AREA_WEIGHTS.sector, what: (s) => `Does it speak the language of ${s.toLowerCase()}? Shown next to your score, not counted in it.` },
  spelling: { name: "Spelling and grammar", weight: AREA_WEIGHTS.spelling, what: () => "UK English, consistent and correct." },
  length: { name: "Length and formatting", weight: AREA_WEIGHTS.length, what: () => "Right length, consistent bullets." },
};

export const AREA_ORDER: AreaKey[] = ["impact", "clarity", "structure", "sector", "spelling", "length"];

export const CHECK_META: Record<CheckKey, { area: AreaKey; name: string }> = {
  quant: { area: "impact", name: "Quantifying impact" },
  verbs: { area: "impact", name: "Action verbs" },
  accomp: { area: "impact", name: "Accomplishments" },
  repeat: { area: "impact", name: "Repetition" },
  filler: { area: "clarity", name: "Filler words" },
  buzz: { area: "clarity", name: "Buzzwords and clichés" },
  passive: { area: "clarity", name: "Passive voice" },
  sections: { area: "structure", name: "Sections" },
  ats: { area: "structure", name: "ATS readability" },
  contact: { area: "structure", name: "Contact details" },
  sector: { area: "sector", name: "Sector keywords" },
  spell: { area: "spelling", name: "Spelling" },
  grammar: { area: "spelling", name: "Grammar" },
  length: { area: "length", name: "Length" },
  bulletlen: { area: "length", name: "Bullet length" },
  bullets: { area: "length", name: "Bullet count" },
};

export const CHECK_ORDER: CheckKey[] = Object.keys(CHECK_META) as CheckKey[];

export function band(score: number): string {
  return BANDS.find((b) => score >= b.min)?.label ?? "Needs work";
}

const clamp = (n: number, lo = 0, hi = 10) => Math.max(lo, Math.min(hi, Math.round(n)));
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const firstWord = (s: string) => (s.trim().split(/\s+/)[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");
const has = (s: string, phrase: string) => new RegExp(`(^|[^a-z])${phrase.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}([^a-z]|$)`, "i").test(s);

/* ---------- per-line analysis ---------- */

interface LineFacts {
  hasNumber: boolean;
  partial: boolean;
  relevance: BulletJudgment["relevance"];
  weakVerb: string | null;
  strongVerb: boolean;
  duty: boolean;
  passive: boolean;
  filler: string[];
  buzz: string[];
  words: number;
  startsWithVerb: boolean;
}

/** Facts about one bullet. Judgment-based facts come from the judge; the rest are exact rule checks. */
function lineFacts(text: string, j: BulletJudgment): LineFacts {
  const fw = firstWord(text);
  const ruleWeak = WEAK_VERBS[fw] && fw !== "used" && fw !== "served" ? fw : null;
  return {
    hasNumber: j.result === "measured",
    partial: j.result === "partial",
    relevance: j.relevance,
    weakVerb: j.verb === "weak" ? (ruleWeak ?? fw) || "weak" : null,
    strongVerb: j.verb === "strong",
    duty: j.kind === "duty",
    passive: PASSIVE_RE.test(text),
    filler: FILLER_WORDS.filter((w) => has(text, w)),
    buzz: BUZZWORDS.filter((w) => has(text, w)),
    words: wordCount(text),
    startsWithVerb: j.verb !== "ok" || STRONG_VERBS.includes(fw) || PRESENT_STRONG_VERBS.has(fw) || !!ruleWeak || /^[a-z]+ed$/.test(fw),
  };
}

function scoreLine(f: LineFacts): number {
  let s = 10;
  if (!f.hasNumber) s -= f.partial ? P.partialResult : P.noResult;
  if (f.weakVerb) s -= P.weakVerb;
  if (f.duty) s -= P.duty;
  if (f.passive) s -= P.passive;
  if (f.filler.length) s -= P.filler;
  if (f.words < T.bulletWords.min || f.words > T.bulletWords.max) s -= P.badLength;
  if (!f.startsWithVerb) s -= P.noVerb;
  return clamp(s, 1, 10);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Longest a suggested rewrite should be before its placeholder is added. */
const REWRITE_CORE_WORDS = 15;

/**
 * Cuts a long line at its last clause break inside the word budget, so side notes drop off. Breaks
 * before a new clause (", enabling", ", and collaborated") are tried before plain commas, which are
 * often inside a list.
 */
function trimToCore(body: string): string {
  if (wordCount(body) <= REWRITE_CORE_WORDS) return body;
  const fits = (i: number) => i > 0 && wordCount(body.slice(0, i)) >= 6 && wordCount(body.slice(0, i)) <= REWRITE_CORE_WORDS;
  for (const re of [/[:;]\s/g, /,\s(?:and\s)?(?:[a-z]+ly\s)?(?:[a-z]+(?:ing|ed)|which|including)\b/g, /\s(?:using|to|that|which|while|including|across)\s/g, /,\s/g]) {
    const cuts = [...body.matchAll(re)].map((m) => m.index!).filter(fits);
    if (cuts.length) return body.slice(0, cuts[cuts.length - 1]).replace(/,?\s+(and|or)$/i, "");
  }
  return body;
}

/** Rebuilds the judgment behind a saved line from its checklist, so a later rewrite matches its score. */
export function judgmentFromLine(line: LineResult): BulletJudgment {
  const items = line.cols.flatMap((c) => c.items);
  const failed = (re: RegExp) => items.some((i) => !i.ok && re.test(i.t));
  return {
    result: items.some((i) => i.ok && /number or result/.test(i.t)) ? "measured" : failed(/not how big/) ? "partial" : "none",
    verb: failed(/Weak opening verb/) ? "weak" : items.some((i) => /Strong opening verb/.test(i.t)) ? "strong" : "ok",
    kind: failed(/duty/) ? "duty" : "achievement",
    relevance: items.some((i) => /Highly relevant/.test(i.t)) ? "high" : items.some((i) => /Some relevance/.test(i.t)) ? "some" : "none",
  };
}

/**
 * Rule-based rewrite. Leaves [brackets] where only the student knows the real figure, always at the
 * end of the sentence, and keeps the suggestion short. Pass the line's judgment so the rewrite fixes
 * the same problems its score shows, and its position on the page to vary the ending.
 */
export function ruleRewrite(text: string, variant = 0, judgment?: BulletJudgment, line = 0): string {
  const f = lineFacts(text, judgment ?? ruleJudgment(text, []));
  const tooLong = f.words > T.bulletWords.max;
  if (f.hasNumber && !f.weakVerb && !f.duty && !f.passive && !f.filler.length && !tooLong) return "This line is already strong. No rewrite needed.";
  let body = text.trim().replace(/\.$/, "");
  for (const p of DUTY_PHRASES) body = body.replace(new RegExp(`^${p}\\s+`, "i"), "");
  for (const w of FILLER_WORDS) body = body.replace(new RegExp(`\\b${w}\\s+`, "gi"), "");
  const fw = firstWord(body);
  if (f.weakVerb) {
    const opts = WEAK_VERBS[f.weakVerb];
    const verb = opts[variant % opts.length];
    // "Helped organise events" -> "Jointly organised events"; "Supported the team with X" -> "Contributed to X"
    let rest = body.split(/\s+/).slice(1).join(" ");
    const next = firstWord(rest);
    if (["to", "with", "in", "on"].includes(next)) rest = rest.split(/\s+/).slice(1).join(" ");
    const nextBare = firstWord(rest);
    if (/^(organise|organize|run|plan|manage|build|create|deliver|coordinate|set)$/.test(nextBare)) {
      const past: Record<string, string> = { organise: "Organised", organize: "Organised", run: "Ran", plan: "Planned", manage: "Managed", build: "Built", create: "Created", deliver: "Delivered", coordinate: "Coordinated", set: "Set up" };
      // "Helped manage" becomes "Jointly managed": a shared task stays shared.
      const shared = ["helped", "assisted", "supported", "worked", "participated"].includes(f.weakVerb);
      body = `${shared ? `Jointly ${past[nextBare].toLowerCase()}` : past[nextBare]} ${rest.split(/\s+/).slice(1).join(" ")}`;
    } else {
      rest = rest.replace(/^the team with\s+/i, "").replace(/^the\s+/i, "the ");
      body = `${verb} ${rest}`;
    }
  } else if (!f.startsWithVerb && fw) {
    body = cap(body);
  }
  body = cap(body.replace(/\s+/g, " ").trim());
  // "significantly more output" -> "[X%] more output": the vague claim becomes the placeholder.
  const vague = /\b(significantly|substantially|greatly|considerably|dramatically|massively|much)\s+(more|less|fewer|higher|lower|faster|better)\b/i;
  const sized = vague.test(body);
  if (sized) body = body.replace(vague, "[X%] $2");
  else if (!f.hasNumber || f.duty || tooLong) body = trimToCore(body);
  for (const w of BUZZWORDS) body = body.replace(new RegExp(`\\b${w}\\s+`, "gi"), "");
  // "Improved email engagement through testing" already names the change; it only needs its size.
  const change = /^(?:Improved|Increased|Reduced|Grew|Cut|Raised|Boosted|Lifted|Lowered)\s/.test(body);
  if (change && !f.hasNumber && !sized) {
    const at = body.search(/\s(?:through|with|using|via|across|by|in|for)\s/);
    body = at > 0 && wordCount(body.slice(0, at)) <= 5 ? `${body.slice(0, at)} by [X%]${body.slice(at)}` : `${body} by [X%]`;
  } else if ((!f.hasNumber || f.duty) && !sized) {
    // Count people only when the line is about people; otherwise ask for the result.
    const people = /\b(events?|society|students?|members?|attendees|volunteers|workshops?|pupils)\b/i.test(body);
    const tails = [
      ...(people ? [", reaching [number] people and [result]"] : []),
      ", which [grew / cut] [what] by [X%]",
      ", resulting in [result, e.g. +X% sign-ups]",
      ", lifting [metric] from [X] to [Y]",
    ];
    // The line number rotates the ending so a page of suggestions doesn't read like one template.
    body += tails[(variant + line) % tails.length];
  }
  return body + ".";
}

function lineCols(f: LineFacts, sector: string) {
  return [
    {
      name: "Impact",
      items: [
        { ok: f.hasNumber, t: f.hasNumber ? "Clear number or result" : f.partial ? "Shows a result, but not how big" : "No number or result" },
        f.weakVerb ? { ok: false, t: `Weak opening verb: "${cap(f.weakVerb)}"` } : { ok: true, t: f.strongVerb ? "Strong opening verb" : "Opening verb is fine" },
        { ok: !f.duty, t: f.duty ? "Reads like a duty, not an achievement" : "Describes a real achievement" },
        { ok: f.relevance !== "none", t: f.relevance === "high" ? `Highly relevant to ${sector.toLowerCase()}` : f.relevance === "some" ? `Some relevance to ${sector.toLowerCase()}` : `Not clearly relevant to ${sector.toLowerCase()}` },
      ],
    },
    {
      name: "Clarity",
      items: [
        { ok: f.filler.length === 0, t: f.filler.length ? `Filler word: "${f.filler[0]}"` : "No filler words" },
        { ok: !f.passive, t: f.passive ? "Passive voice" : "Active voice" },
        { ok: f.buzz.length === 0, t: f.buzz.length ? `Buzzword: "${f.buzz[0]}"` : "No buzzwords" },
      ],
    },
    {
      name: "Length and formatting",
      items: [
        f.words < 10 ? { ok: false, t: `Short: ${f.words} words, aim for 12 to 25` } : f.words > 30 ? { ok: false, t: `Long: ${f.words} words, aim for 12 to 25` } : { ok: true, t: "Good length" },
        { ok: f.startsWithVerb, t: f.startsWithVerb ? "Starts with a verb" : "Start with an action verb" },
      ],
    },
  ];
}

/* ---------- whole-CV checks ---------- */

export interface ScoringInput {
  /** One judgment per bullet from cvBullets(), in order. Omit to judge with the rule engine. */
  judgments?: BulletJudgment[];
  method?: ScoringMethod;
}

/** The bullets the scorer judges, in order. Same text in, same bullets out. */
export function cvBullets(rawText: string): ParsedBullet[] {
  return parseCv(normaliseText(rawText)).bullets;
}

/**
 * Scores a CV. Pure and deterministic: the same text, sector and judgments always produce the
 * same analysis and score. The judge (AI or rules) only supplies categorical judgments.
 */
export function analyseCv(rawText: string, sector: string, input: ScoringInput = {}): CvAnalysis {
  const text = normaliseText(rawText);
  const cv = parseCv(text);
  const bullets = cv.bullets;
  const kwList = SECTOR_KEYWORDS[sector] ?? SECTOR_KEYWORDS["Finance and banking"];
  const method: ScoringMethod = input.judgments ? (input.method ?? "ai") : "rules";
  if (input.judgments && input.judgments.length !== bullets.length) throw new Error(`Expected ${bullets.length} judgments, got ${input.judgments.length}`);
  const judgments = input.judgments ?? bullets.map((b) => ruleJudgment(b.text, kwList));
  const facts = bullets.map((b, i) => lineFacts(b.text, judgments[i]));
  const n = bullets.length;
  const lower = cv.text.toLowerCase();
  const idx = (pred: (f: LineFacts, b: ParsedBullet) => boolean) => facts.map((f, i) => (pred(f, bullets[i]) ? i : -1)).filter((i) => i >= 0);

  const checks: CheckResult[] = [];
  const add = (key: CheckKey, c: Omit<CheckResult, "key" | "area" | "name">) => checks.push({ key, area: CHECK_META[key].area, name: CHECK_META[key].name, ...c });

  // Impact
  const withNum = idx((f) => f.hasNumber);
  const partialN = idx((f) => f.partial).length;
  const target = Math.max(1, Math.ceil(n * T.quantifiedShare));
  const credit = withNum.length + partialN * 0.5;
  add("quant", {
    score: n === 0 ? 0 : clamp((credit / target) * 10),
    summary: `${withNum.length} of ${n} bullets show a measurable result`,
    detail: `We found ${plural(n, "bullet point")} in your experience and projects. ${withNum.length === 0 ? "None" : withNum.length >= target ? withNum.length : `Only ${withNum.length}`} show a measurable result${partialN ? `, and ${plural(partialN, "more bullet")} ${partialN === 1 ? "shows" : "show"} a result without saying how big` : ""}. Aim for at least half.`,
    stat: { value: String(n - withNum.length), label: "lines without a measurable result" },
    affected: idx((f) => !f.hasNumber),
    progress: { have: withNum.length, total: n, target },
  });
  const weak = idx((f) => !!f.weakVerb);
  add("verbs", {
    score: n === 0 ? 0 : clamp(10 - (weak.length / n) * 20),
    summary: weak.length ? `${plural(weak.length, "weak opening verb")}, like "${facts[weak[0]].weakVerb}"` : "Strong opening verbs",
    detail: weak.length ? `${plural(weak.length, "bullet")} open with a weak verb such as "${facts[weak[0]].weakVerb}". Lead with what you did.` : "Every bullet leads with a clear action verb.",
    stat: { value: String(weak.length), label: "weak opening verbs" },
    affected: weak,
    extras: [...new Set(weak.map((i) => facts[i].weakVerb!))],
  });
  const duty = idx((f) => f.duty);
  add("accomp", {
    // By share of bullets, like action verbs: four duty lines in a 26-line CV isn't the same as four in six.
    score: n === 0 ? 0 : clamp(10 - (duty.length / n) * 20),
    summary: duty.length ? `${plural(duty.length, "bullet")} ${duty.length === 1 ? "reads" : "read"} like a duty` : "No duty-style bullets",
    detail: duty.length ? `${plural(duty.length, "line")} ${duty.length === 1 ? "describes" : "describe"} what the job was rather than what you achieved.` : "Your bullets describe achievements rather than duties.",
    stat: { value: String(duty.length), label: "duty-style lines" },
    affected: duty,
  });
  const openers: Record<string, number[]> = {};
  bullets.forEach((b, i) => (openers[firstWord(b.text)] ??= []).push(i));
  const repeated = Object.entries(openers).filter(([w, arr]) => w && arr.length > 2);
  const excess = repeated.reduce((s, [, arr]) => s + arr.length - 2, 0);
  add("repeat", {
    score: clamp(10 - excess * 2),
    summary: repeated.length ? `"${cap(repeated[0][0])}" starts ${repeated[0][1].length} bullets` : "Varied wording",
    detail: repeated.length ? `You open ${repeated[0][1].length} bullets with "${cap(repeated[0][0])}". Vary your verbs so each line stands out.` : "You vary the way your bullets start.",
    stat: { value: String(excess), label: "repeated openings" },
    affected: repeated.flatMap(([, arr]) => arr.slice(2)),
  });

  // Clarity
  const fillerLines = idx((f) => f.filler.length > 0);
  const fillerCount = facts.reduce((s, f) => s + f.filler.length, 0);
  add("filler", {
    score: clamp(10 - fillerCount),
    summary: fillerCount ? `${plural(fillerCount, "filler word")}` : "No filler words",
    detail: fillerCount ? `Words like "${facts[fillerLines[0]].filler[0]}" add length without meaning.` : "No filler words found.",
    stat: { value: String(fillerCount), label: "filler words" },
    affected: fillerLines,
  });
  const buzzFound = BUZZWORDS.filter((w) => has(cv.text, w));
  add("buzz", {
    score: clamp(10 - buzzFound.length * 2.5),
    summary: buzzFound.length ? `${plural(buzzFound.length, "buzzword")}: "${buzzFound[0]}"` : "No buzzwords",
    detail: buzzFound.length ? `Recruiters skip words like ${buzzFound.slice(0, 3).map((b) => `"${b}"`).join(", ")}. Show the quality with evidence instead.` : "No clichés recruiters skip over.",
    stat: { value: String(buzzFound.length), label: "buzzwords" },
    affected: idx((f) => f.buzz.length > 0),
    extras: buzzFound,
  });
  const passive = idx((f) => f.passive);
  add("passive", {
    score: clamp(10 - passive.length * 2),
    summary: passive.length ? `${plural(passive.length, "passive line")}` : "All active",
    detail: passive.length ? `${plural(passive.length, "line")} use the passive voice. Say who did it: you.` : "Every line is in the active voice.",
    stat: { value: String(passive.length), label: "passive lines" },
    affected: passive,
  });

  // Structure
  const required = ["education", "experience", "skills"];
  const missing = required.filter((s) => !cv.sections.includes(s));
  const hasRefs = cv.sections.includes("references") || /references (are )?available/i.test(cv.text);
  add("sections", {
    score: clamp(10 - missing.length * 3 - (hasRefs ? 5 : 0)),
    summary: missing.length ? `Missing: ${missing.join(", ")}` : hasRefs ? "References line can go" : "All key sections found",
    detail: [missing.length ? `Add ${missing.join(" and ")} headings so recruiters find them fast.` : "Education, experience and skills are all there.", hasRefs ? 'UK employers don\'t expect "References available on request". Use the space for results.' : ""].filter(Boolean).join(" "),
    stat: { value: String(cv.sections.length), label: "sections found" },
    affected: [],
    extras: missing,
  });
  const odd = (cv.text.match(/[^\x00-\x7F£€–—’‘“”•●▪·é]/g) ?? []).length;
  const atsScore = cv.words < 150 ? 3 : clamp(10 - Math.floor(odd / 15) - (cv.sections.length < 3 ? 2 : 0));
  add("ats", {
    score: atsScore,
    summary: atsScore >= 8 ? "Simple layout, readable text" : cv.words < 150 ? "Very little readable text" : "Some text may not read cleanly",
    detail: atsScore >= 8 ? "Screening software can read your text and headings." : "Use a single-column layout with standard headings and no text in images or tables.",
    stat: { value: `${cv.words}`, label: "words read" },
    affected: [],
  });
  const contactParts = [cv.email && "email", cv.phone && "phone", cv.linkedin && "LinkedIn"].filter(Boolean) as string[];
  add("contact", {
    score: clamp((cv.email ? 4 : 0) + (cv.phone ? 3 : 0) + (cv.linkedin ? 3 : 0)),
    summary: contactParts.length === 3 ? "Email, phone and LinkedIn found" : contactParts.length ? `Found ${contactParts.join(" and ")}` : "No contact details found",
    detail: contactParts.length === 3 ? "Recruiters can reach you easily." : `Add ${["email", "phone", "LinkedIn"].filter((p) => !contactParts.includes(p)).join(" and ")} to your header.`,
    stat: { value: String(contactParts.length), label: "of 3 contact details" },
    affected: [],
  });

  // Sector
  const top = kwList.slice(0, 12);
  const foundKw = top.filter((k) => has(lower, k));
  const missingKw = top.filter((k) => !foundKw.includes(k));
  const kwScore = clamp((foundKw.length / Math.min(T.sectorKeywords, top.length)) * 10);
  const relValue = n === 0 ? 0 : facts.reduce((acc, f) => acc + (f.relevance === "high" ? 1 : f.relevance === "some" ? 0.5 : 0), 0) / n;
  const relScore = clamp((relValue / T.relevanceAverage) * 10);
  const notRelevant = idx((f) => f.relevance === "none");
  add("sector", {
    // Half keywords recruiters search for, half how relevant your experience reads to the sector.
    score: clamp((kwScore + relScore) / 2),
    summary: missingKw.length ? `${plural(missingKw.length, "common keyword")} missing` : "Strong sector language",
    detail: `You use ${foundKw.length} of ${top.length} terms recruiters in ${sector.toLowerCase()} look for, and ${n - notRelevant.length} of ${n} bullets read as relevant to the sector. Add keywords only where they're true for you.`,
    stat: { value: String(foundKw.length), label: `of ${top.length} sector keywords` },
    affected: notRelevant,
    extras: missingKw,
  });

  // Spelling and grammar
  const usFound = Object.keys(US_SPELLINGS).filter((w) => new RegExp(`\\b${w}\\b`, "i").test(cv.text));
  add("spell", {
    score: clamp(10 - usFound.length * 2),
    summary: usFound.length ? `${plural(usFound.length, "US spelling")}: "${usFound[0]}"` : "UK spelling throughout",
    detail: usFound.length ? `Use UK spelling for UK employers: ${usFound.slice(0, 4).map((w) => `${w} → ${US_SPELLINGS[w]}`).join(", ")}.` : "No US spellings found.",
    stat: { value: String(usFound.length), label: "US spellings" },
    affected: idx((_, b) => usFound.some((w) => new RegExp(`\\b${w}\\b`, "i").test(b.text))),
    extras: usFound.map((w) => `${w} → ${US_SPELLINGS[w]}`),
  });
  const doubles = cv.lines.flatMap((l) => l.slice(0, 1000).match(/\b(\w{1,40})\s+\1\b/gi) ?? []).filter((m) => !/^\d/.test(m));
  const lowerStarts = idx((_, b) => /^[a-z]/.test(b.text));
  const endings = bullets.map((b) => /\.$/.test(b.text));
  const mixed = endings.length > 2 && endings.some(Boolean) && endings.some((e) => !e) ? 1 : 0;
  const grammarIssues = doubles.length + (lowerStarts.length ? 1 : 0) + mixed;
  add("grammar", {
    score: clamp(10 - grammarIssues * 2),
    summary: grammarIssues ? `${plural(grammarIssues, "issue")} to fix` : "No issues",
    detail: [doubles.length ? `Repeated word: "${doubles[0]}".` : "", lowerStarts.length ? "Some bullets start with a lowercase letter." : "", mixed ? "Some bullets end with a full stop and some don't. Pick one." : ""].filter(Boolean).join(" ") || "No grammar issues found.",
    stat: { value: String(grammarIssues), label: "grammar issues" },
    affected: lowerStarts,
  });

  // Length and formatting
  const pages = Math.max(1, Math.round(cv.words / 450));
  const lenScore = cv.words >= T.cvWords.min && cv.words <= T.cvWords.max ? 10 : cv.words < T.cvWords.min ? clamp((cv.words / T.cvWords.min) * 10) : clamp(10 - (cv.words - T.cvWords.max) / 100);
  add("length", {
    score: lenScore,
    summary: `${plural(pages, "page")}`,
    detail: lenScore >= 9 ? "Two pages or fewer is right for UK graduate roles." : cv.words < 300 ? "Your CV is short. Add detail about what you achieved." : "Trim your CV to two pages at most.",
    stat: { value: String(pages), label: pages === 1 ? "page" : "pages" },
    affected: [],
  });
  const badLen = idx((f) => f.words < T.bulletWords.min || f.words > T.bulletWords.max);
  add("bulletlen", {
    score: clamp(10 - badLen.length * 0.67),
    summary: badLen.length ? `${plural(badLen.length, "bullet")} under 10 or over 30 words` : "Bullet lengths are right",
    detail: badLen.length ? "Aim for 12 to 25 words: long enough for a result, short enough to scan." : "Your bullets are a scannable length.",
    stat: { value: String(badLen.length), label: "bullets to resize" },
    affected: badLen,
  });
  add("bullets", {
    score: n >= T.bulletCount.min && n <= T.bulletCount.max ? 10 : n < T.bulletCount.min ? clamp((n / T.bulletCount.min) * 10) : clamp(10 - (n - T.bulletCount.max) / 2),
    summary: `${plural(n, "bullet")} in core sections`,
    detail: n < 8 ? "Add more bullets under your experience and projects." : n > 24 ? "You have a lot of bullets. Keep the strongest." : "A good number of bullets to show your experience.",
    stat: { value: String(n), label: "bullets" },
    affected: [],
  });

  // With no bullet points there is nothing to judge, so line-based checks can't pass by default.
  if (n === 0) {
    for (const c of checks) {
      if (["accomp", "repeat", "filler", "buzz", "passive", "grammar", "bulletlen"].includes(c.key)) {
        c.score = 0;
        c.summary = "No bullet points found";
        c.detail = "Add bullet points (•) under each role and project so we can check them.";
      }
    }
  }

  const areas: AreaResult[] = AREA_ORDER.map((key) => {
    const cs = checks.filter((c) => c.area === key);
    const avg = cs.reduce((s, c) => s + c.score, 0) / cs.length;
    return { key, name: AREA_META[key].name, what: AREA_META[key].what(sector), score: Math.round(avg * 10), checks: cs };
  });
  const score = Math.round(areas.reduce((s, a) => s + a.score * AREA_META[a.key].weight, 0));

  const lines: LineResult[] = bullets.map((b, i) => {
    const f = facts[i];
    const { where, short } = roleLabel(b);
    return { where, short, text: b.text, score: scoreLine(f), cols: lineCols(f, sector), rewrite: ruleRewrite(b.text, 0, judgments[i], i) };
  });

  const steps = checks
    .filter((c) => c.score < 8)
    .map((c) => {
      const area = areas.find((a) => a.key === c.area)!;
      // Sector fit isn't in the score, so its step improves fit, not the score.
      const gain = AREA_META[c.area].weight ? Math.max(1, Math.round(((10 - c.score) / area.checks.length) * AREA_META[c.area].weight * 10)) : 0;
      return { check: c.key, text: stepText(c), area: `${area.name} · ${c.name}`, gain };
    })
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 3);
  const wells = checks
    .filter((c) => c.score >= 9)
    .sort((a, b) => AREA_META[b.area].weight - AREA_META[a.area].weight)
    .slice(0, 3)
    .map((c) => ({ check: c.key, text: wellText(c), area: `${AREA_META[c.area].name} · ${c.name}` }));

  return {
    score,
    areas,
    lines,
    steps,
    wells,
    meta: {
      words: cv.words,
      pages,
      bullets: n,
      sections: cv.sections,
      name: cv.name,
      email: cv.email,
      phone: cv.phone,
      method,
      judge: method === "ai" ? AI_JUDGE_MODEL : "rules",
      rubric: RUBRIC_VERSION,
      fingerprint: sha256([RUBRIC_VERSION, method, sector.toLowerCase(), text].join("\u0000")),
      judgments,
    },
  };
}

function stepText(c: CheckResult): string {
  switch (c.key) {
    case "quant": return `Add numbers to ${plural(c.affected.length, "bullet point")}`;
    case "verbs": return `Swap ${plural(c.affected.length, "weak action verb")}`;
    case "accomp": return "Turn duties into achievements";
    case "repeat": return "Vary how your bullets start";
    case "filler": return "Cut filler words";
    case "buzz": return `Replace ${plural(c.extras?.length ?? 1, "buzzword")} with evidence`;
    case "passive": return "Rewrite passive lines in the active voice";
    case "sections": return c.extras?.length ? `Add a ${c.extras[0]} section` : "Remove the references line";
    case "ats": return "Simplify your layout for screening software";
    case "contact": return "Complete your contact details";
    case "sector": return `Add ${Math.min(4, c.extras?.length ?? 4)} keywords recruiters look for`;
    case "spell": return "Switch to UK spelling";
    case "grammar": return "Fix grammar and punctuation";
    case "length": return "Adjust your CV length";
    case "bulletlen": return c.affected.length ? `Resize ${plural(c.affected.length, "bullet")}` : "Add bullet points under each role";
    case "bullets": return "Adjust your number of bullets";
  }
}

function wellText(c: CheckResult): string {
  const m: Partial<Record<CheckKey, string>> = {
    quant: "Results backed by numbers", verbs: "Strong, clear action verbs", accomp: "Achievements, not duties",
    repeat: "Strong, varied action words", filler: "Tight, filler-free writing", buzz: "No clichés",
    passive: "Active voice throughout", sections: "All the sections recruiters expect", ats: "Clean layout screening software can read",
    contact: "Complete contact details", sector: "Speaks the language of your sector", spell: "Consistent UK spelling",
    grammar: "Clean grammar", length: "The right length", bulletlen: "Scannable bullet lengths", bullets: "A good number of bullets",
  };
  return m[c.key] ?? c.name;
}

export function findCheck(a: CvAnalysis, key: CheckKey): CheckResult | undefined {
  for (const area of a.areas) for (const c of area.checks) if (c.key === key) return c;
  return undefined;
}

export type { ParsedCv };
