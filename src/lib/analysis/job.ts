import type { JdBlock, KeywordHit } from "@/lib/types";
import { EXTRA_HARD_TERMS, SECTOR_KEYWORDS, SOFT_SKILLS } from "./lexicon";
import { cleanRole, parseCv } from "./parse";

const esc = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
const termRe = (t: string) => new RegExp(`(^|[^a-z0-9])(${esc(t)}(?:s|ing)?)(?=[^a-z0-9]|$)`, "gi");
const countIn = (text: string, term: string) => (text.match(termRe(term)) ?? []).length;

// Variant spellings that should count as the same keyword.
const ALIASES: Record<string, string[]> = {
  "financial modelling": ["financial modeling", "financial model"],
  "stakeholder management": ["managing stakeholders", "stakeholder engagement"],
  "problem solving": ["problem-solving"],
  teamwork: ["team work", "working in a team"],
  analytical: ["analytic"],
  organisation: ["organization", "organisational"],
};

const inText = (text: string, term: string) => [term, ...(ALIASES[term] ?? [])].some((t) => countIn(text, t) > 0);
const countAll = (text: string, term: string) => [term, ...(ALIASES[term] ?? [])].reduce((s, t) => s + countIn(text, t), 0);

const DICTIONARY = (() => {
  const all = new Set<string>([...EXTRA_HARD_TERMS, ...Object.values(SECTOR_KEYWORDS).flat()]);
  // Single generic words that are too noisy on their own.
  ["data", "case", "public", "report", "design", "project", "technical", "care", "client", "r"].forEach((w) => all.delete(w));
  // Prefer multi-word terms when one contains another.
  return [...all].sort((a, b) => b.length - a.length);
})();

const TOOL_TERMS = new Set(["excel", "sql", "python", "power bi", "tableau", "vba", "bloomberg", "powerpoint", "javascript", "typescript", "react", "java", "git", "aws", "matlab", "cad", "solidworks", "seo"]);

export function jobKeywords(jobText: string, cvText: string): KeywordHit[] {
  const ad = jobText.toLowerCase();
  const cv = cvText.toLowerCase();
  const parsed = parseCv(cvText);
  const sentences = jobText.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);

  const bestPlace = (term: string): string => {
    if (TOOL_TERMS.has(term)) return "Skills section";
    const sentence = sentences.find((s) => inText(s.toLowerCase(), term)) ?? term;
    const words = new Set(sentence.toLowerCase().match(/[a-z]{4,}/g) ?? []);
    let best: { score: number; label: string } = { score: 0, label: parsed.sections.includes("summary") ? "Summary" : "Skills section" };
    for (const b of parsed.bullets) {
      const overlap = (b.text.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => words.has(w)).length;
      if (overlap > best.score) {
        const role = b.role ? cleanRole(b.role) : null;
        best = { score: overlap, label: role ? `${role.split(/[,|–—-]/)[0].trim()} role` : b.section === "projects" ? "Projects" : "Experience" };
      }
    }
    return best.label;
  };

  const seen = new Set<string>();
  const hits: KeywordHit[] = [];
  for (const term of [...DICTIONARY, ...SOFT_SKILLS]) {
    if (seen.has(term)) continue;
    const n = countAll(ad, term);
    if (n === 0) continue;
    // Skip a term already covered by a longer one ("modelling" inside "financial modelling").
    if ([...seen].some((s) => s.includes(term))) continue;
    seen.add(term);
    const soft = SOFT_SKILLS.includes(term);
    const inCv = inText(cv, term);
    hits.push({ w: titleCase(term), n, must: !soft && n >= 2, where: inCv ? "Already in your CV" : bestPlace(term), soft, inCv });
  }
  // Sort: missing must-haves first, then by frequency.
  return hits.sort((a, b) => Number(b.must) - Number(a.must) || b.n - a.n);
}

export function matchScores(hits: KeywordHit[], added: string[] = []) {
  const weight = (k: KeywordHit) => (k.soft ? 0.5 : k.must ? 2 : 1);
  const total = hits.reduce((s, k) => s + weight(k), 0) || 1;
  const have = hits.filter((k) => k.inCv).reduce((s, k) => s + weight(k), 0);
  const withAdded = hits.filter((k) => k.inCv || added.includes(k.w)).reduce((s, k) => s + weight(k), 0);
  const tailoredSet = hits.filter((k) => k.inCv || k.must || added.includes(k.w)).reduce((s, k) => s + weight(k), 0);
  const base = 30; // a CV with none of the keywords still shows some fit
  const toScore = (x: number) => Math.round(base + (x / total) * (100 - base));
  return { now: toScore(have), withAdded: toScore(withAdded), tailored: Math.max(toScore(tailoredSet), toScore(withAdded)) };
}

export function highlightJob(jobText: string, hits: KeywordHit[]): JdBlock[] {
  const terms = hits.map((h) => ({ t: h.w.toLowerCase(), kind: h.inCv ? ("found" as const) : ("missing" as const) }));
  const blocks: JdBlock[] = [];
  for (const raw of jobText.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const isHeader = line.length <= 48 && (/^[A-Z0-9 ,&'’/-]+:?$/.test(line) || /:$/.test(line)) && !/[.!?]$/.test(line);
    if (isHeader) {
      blocks.push({ isH: true, text: line.replace(/:$/, "").toUpperCase() });
      continue;
    }
    const segs: { t: string; kind: "plain" | "found" | "missing" }[] = [];
    const lower = line.toLowerCase();
    let i = 0;
    while (i < line.length) {
      let match: { len: number; kind: "found" | "missing" } | null = null;
      if (i === 0 || !/[a-z0-9]/i.test(line[i - 1])) {
        for (const term of terms) {
          for (const v of [term.t, ...(ALIASES[term.t] ?? [])]) {
            if (lower.startsWith(v, i) && !/[a-z0-9]/i.test(line[i + v.length] ?? " ")) {
              if (!match || v.length > match.len) match = { len: v.length, kind: term.kind };
            }
          }
        }
      }
      if (match) {
        segs.push({ t: line.slice(i, i + match.len), kind: match.kind });
        i += match.len;
      } else {
        const last = segs[segs.length - 1];
        if (last && last.kind === "plain") last.t += line[i];
        else segs.push({ t: line[i], kind: "plain" });
        i++;
      }
    }
    blocks.push({ isH: false, segs });
  }
  return blocks;
}

export const isToolTerm = (w: string) => TOOL_TERMS.has(w.toLowerCase());

/** Keyword as it should read mid-sentence: tools keep their capitals, everything else is lower case. */
export function displayTerm(w: string): string {
  return TOOL_TERMS.has(w.toLowerCase()) || /[A-Z]{2}/.test(w) ? w : w.toLowerCase();
}

export function guessJobTitle(jobText: string): string {
  const first = jobText.split("\n").map((l) => l.trim()).find((l) => l.length > 3 && l.length < 80);
  return first ?? "Job ad";
}

function titleCase(s: string) {
  const keepUpper = ["sql", "aws", "api", "vba", "cad", "seo", "nhs", "bi"];
  return s
    .split(" ")
    .map((w, i) => (keepUpper.includes(w) ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ")
    .replace(/^Power BI$/i, "Power BI");
}

const decodeEntities = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&rsquo;/g, "’")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n• ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/&[a-z]+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

type LdNode = Record<string, unknown>;

/** The schema.org JobPosting that most job boards (Lever, Workday, Indeed, LinkedIn, gov.uk) embed for search engines. */
function jobPosting(html: string): LdNode | null {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const stack = [data];
    while (stack.length) {
      const n = stack.pop();
      if (Array.isArray(n)) stack.push(...n);
      else if (n && typeof n === "object") {
        const t = (n as LdNode)["@type"];
        if (t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"))) return n as LdNode;
        if ((n as LdNode)["@graph"]) stack.push((n as LdNode)["@graph"]);
      }
    }
  }
  return null;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? decodeEntities(v.trim()) : null);
const meta = (html: string, prop: string) => str(html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)`, "i"))?.[1]);

/** Reads a fetched job page: the job ad text, plus the title, employer and closing date when the page says. */
export function htmlToText(html: string): { title: string | null; employer: string | null; deadline: string | null; text: string } {
  const ld = jobPosting(html);
  const titleTag = str(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]);
  // Greenhouse: "Job Application for Android Engineer at Monzo".
  const gh = titleTag?.match(/^Job Application for (.+) at (.+)$/i);
  const org = ld?.hiringOrganization;
  const title = str(ld?.title) ?? gh?.[1] ?? meta(html, "og:title") ?? titleTag?.split(/\s[|–—-]\s/)[0] ?? null;
  const employer = str(org && typeof org === "object" ? (org as LdNode).name : org) ?? gh?.[2] ?? meta(html, "og:site_name");
  const until = str(ld?.validThrough)?.slice(0, 10) ?? null;
  const deadline = until && /^\d{4}-\d{2}-\d{2}$/.test(until) && until >= new Date().toISOString().slice(0, 10) ? until : null;
  // The posting's own description skips the page's menus, cookie banners and application form.
  const description = str(ld?.description) ? stripTags(decodeEntities(String(ld!.description))) : "";
  const text = description.length >= 200 ? `${title ?? ""}\n${description}`.trim() : stripTags(html);
  return { title, employer, deadline, text: text.slice(0, 12000) };
}
