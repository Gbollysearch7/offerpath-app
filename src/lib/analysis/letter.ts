import type { CvAnalysis, LetterCheck, LetterParagraph } from "@/lib/types";
import { displayTerm, jobKeywords } from "./job";
import { US_SPELLINGS } from "./lexicon";
import { parseCv, wordCount } from "./parse";

export interface LetterReview {
  checks: LetterCheck[];
  score: number;
  keywordsUsed: string[];
  keywordsMissing: string[];
  words: number;
  paras: number;
  summary: string;
  signoffMismatch: boolean;
}

const GREETING_RE = /^dear\s+(.+?),?\s*$/im;
const SIGNOFF_RE = /(yours\s+(faithfully|sincerely)|kind regards|best regards|best wishes|regards),?/i;

export function reviewLetter(letter: string, jobText: string, employer: string, cvText = ""): LetterReview {
  const words = wordCount(letter);
  const paras = letter.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !/^dear\b/i.test(p) && !SIGNOFF_RE.test(p.split("\n")[0]) && wordCount(p) > 8).length;
  const greeting = letter.match(GREETING_RE)?.[1]?.trim() ?? null;
  const signoff = letter.match(SIGNOFF_RE)?.[0]?.replace(/,$/, "") ?? null;
  const namedOrManager = !!greeting && !/sir|madam|whom it may concern/i.test(greeting);
  const expected = greeting ? (namedOrManager ? "Yours sincerely" : "Yours faithfully") : null;
  const signoffOk = !!signoff && (!expected || signoff.toLowerCase() === expected.toLowerCase() || /regards|best wishes/i.test(signoff));

  const kw = jobText.trim() ? jobKeywords(jobText, letter + "\n" + cvText).filter((k) => !k.soft || k.n >= 1).slice(0, 8) : [];
  const used = kw.filter((k) => new RegExp(k.w.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "i").test(letter)).map((k) => k.w);
  const missing = kw.map((k) => k.w).filter((w) => !used.includes(w));
  const hasEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(letter);
  const hasPhone = /(\+44|0)\s?\d[\d\s]{8,}/.test(letter);
  const mentionsEmployer = !!employer && new RegExp(employer.split(/\s+/)[0], "i").test(letter);
  const whyEmployer = mentionsEmployer && /(drawn to|appeals|because|why i|particularly|excited by|impressed|interested in)/i.test(letter);
  const usSpell = Object.keys(US_SPELLINGS).filter((w) => new RegExp(`\\b${w}\\b`, "i").test(letter));

  const checks: LetterCheck[] = [
    {
      ok: signoffOk,
      t: "Sign-off matches the greeting",
      d: signoffOk ? `"${signoff ?? "Sign-off"}" fits "Dear ${greeting ?? "…"}".` : signoff ? `Change "${signoff}" to "${expected}".` : `End with "${expected ?? "Yours sincerely"}".`,
    },
    {
      ok: kw.length === 0 || missing.length <= Math.floor(kw.length / 4),
      t: "Keywords from the job ad",
      d: kw.length === 0 ? "Add the job ad to check keywords." : `${used.length} of ${kw.length} key terms used.${missing.length ? ` Missing: ${missing.slice(0, 4).map(displayTerm).join(", ")}.` : ""}`,
    },
    { ok: hasEmail && hasPhone, t: "Contact details in the header", d: hasEmail && hasPhone ? "Email and phone number found." : `Add your ${[!hasEmail && "email", !hasPhone && "phone number"].filter(Boolean).join(" and ")}.` },
    { ok: !!greeting, t: "Professional greeting", d: greeting ? (namedOrManager ? `Addressed to ${greeting}.` : "A named person is better if you can find one.") : 'Start with "Dear [name]," or "Dear Hiring Manager,".' },
    { ok: words >= 250 && words <= 400, t: "Length", d: `${words} words, ${words >= 250 && words <= 400 ? "inside" : words < 250 ? "under" : "over"} the 250 to 400 range.` },
    { ok: whyEmployer, t: "Says why this employer", d: whyEmployer ? "Gives a specific reason for choosing this employer." : `Say what draws you to ${employer || "this employer"} specifically.` },
  ];
  if (usSpell.length) checks.push({ ok: false, t: "UK spelling", d: `Change ${usSpell.slice(0, 3).map((w) => `"${w}" to "${US_SPELLINGS[w]}"`).join(", ")}.` });

  const weights = [12, 22, 12, 12, 14, 18, 10];
  const totalW = weights.slice(0, checks.length).reduce((a, b) => a + b, 0);
  const got = checks.reduce((s, c, i) => s + (c.ok ? weights[i] : c.t === "Keywords from the job ad" && kw.length ? (used.length / kw.length) * weights[i] : 0), 0);
  const score = Math.round(35 + (got / totalW) * 65);

  const fails = checks.filter((c) => !c.ok);
  const fixes = fails.slice(0, 2).map((f) => fixPhrase(f, missing.length)).join(" and ");
  const summary = fails.length === 0 ? "Ready to send. Read it aloud once more before you do." : `${paras >= 3 ? "Good structure. " : "Add more structure. "}${cap(fixes)}.`;
  return { checks, score, keywordsUsed: used, keywordsMissing: missing, words, paras, summary: cap(summary.trim()), signoffMismatch: !signoffOk && !!signoff };
}

function fixPhrase(c: LetterCheck, nMissing: number) {
  switch (c.t) {
    case "Sign-off matches the greeting": return "fix the sign-off";
    case "Keywords from the job ad": return `work in ${nMissing} more keywords from the ad`;
    case "Contact details in the header": return "add your contact details";
    case "Professional greeting": return "add a greeting";
    case "Length": return "adjust the length";
    case "Says why this employer": return "say why this employer";
    default: return "switch to UK spelling";
  }
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------- rule-based draft ---------- */

export interface DraftInput {
  name: string;
  email: string | null;
  phone: string | null;
  jobTitle: string;
  employer: string;
  jobText: string;
  cvText: string;
  analysis: CvAnalysis | null;
  addressee: string | null;
  notes: string | null;
  stageLabel: string;
}

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const sentence = (s: string) => s.replace(/\s*\.?$/, ".");

export function draftLetterRuleBased(input: DraftInput): LetterParagraph[] {
  const kws = input.jobText ? jobKeywords(input.jobText, input.cvText) : [];
  const found = kws.filter((k) => k.inCv && !k.soft).slice(0, 2).map((k) => displayTerm(k.w));
  const lines = [...(input.analysis?.lines ?? [])].sort((a, b) => b.score - a.score);
  const best = lines.slice(0, 2);
  const more = lines.slice(2, 5);
  const greet = input.addressee?.trim() ? input.addressee.trim().replace(/,.*$/, "") : "Hiring Manager";
  const formalSirMadam = /sir|madam/i.test(greet);
  const isProgramme = /scheme|programme|program|internship|placement|week/i.test(input.jobTitle);
  const roleName = isProgramme || /\brole\b/i.test(input.jobTitle) ? input.jobTitle : `${input.jobTitle} role`;
  const parsed = parseCv(input.cvText);
  const skillsLine = parsed.sectionLines.skills?.[0]?.replace(/\s+/g, " ").trim() ?? null;
  // "University of Northfield | BSc Economics | 2024 – 2027" -> "studying BSc Economics at the University of Northfield"
  const eduParts = (parsed.sectionLines.education?.[0] ?? "").split(/\s*[|·]\s*/).filter((x) => x && !/\d{4}/.test(x));
  const grade = (parsed.sectionLines.education ?? []).join(" ").match(/(predicted|expected|achieved)\s+(a\s+)?(first|2:1|2:2|\d:\d)/i)?.[0];
  const study = eduParts.length >= 2 ? ` I am studying ${eduParts[1]} at ${/^university/i.test(eduParts[0]) ? "the " : ""}${eduParts[0]}${grade ? ` (${grade.toLowerCase()})` : ""}.` : "";

  // "EXPERIENCE · EVENTS OFFICER, ECONOMICS SOCIETY" -> "Events Officer at the Economics Society"
  const roleOf = (where: string) => {
    const part = where.split("·")[1]?.trim();
    if (!part) return null;
    const title = part.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(And|Of|For|The|At|In)\b/g, (m) => m.toLowerCase());
    const [role, org] = title.split(/,\s*/);
    return org ? `${role} at ${/society|club|union|team/i.test(org) ? "the " : ""}${org}` : role;
  };
  const evidence = (l: (typeof lines)[number], lead: string, fallback: string) => {
    const role = roleOf(l.where);
    const body = sentence(lowerFirst(l.accepted ?? l.text));
    return role ? `${lead} ${role}, I ${body}` : `${fallback} ${body}`;
  };

  // Every sentence below is either a CV fact, the student's own note, or a placeholder.
  const paras: LetterParagraph[] = [{ text: `Dear ${greet},`, src: [input.addressee ? "YOU ADDED" : "UK CONVENTION"] }];
  paras.push({
    text: `I am applying for the ${roleName} at ${input.employer}. As a ${input.stageLabel}, I have been building the ${found.length ? found.join(" and ") : "analytical and communication"} skills ${isProgramme ? "your programme" : "the role"} asks for, and I would like to put them to work in your team.${study}`,
    src: ["CV · EDUCATION", "JOB AD · REQUIREMENTS"],
  });
  if (best.length) {
    paras.push({ text: best.map((l, i) => evidence(l, i === 0 ? "As" : "In my role as", i === 0 ? "I" : "I also")).join(" "), src: best.map((l) => `CV · ${l.short}`) });
  }
  if (more.length || skillsLine) {
    const parts = more.map((l, i) => evidence(l, i === 0 ? "As" : "As", i === 0 ? "I" : "I also"));
    if (skillsLine) parts.push(`Alongside this, my skills include ${skillsLine.replace(/\.$/, "")}.`);
    paras.push({ text: parts.join(" "), src: [...more.map((l) => `CV · ${l.short}`), ...(skillsLine ? ["CV · SKILLS"] : [])] });
  }
  const notes = input.notes?.trim();
  const why = notes
    ? new RegExp(input.employer.split(/\s+/)[0], "i").test(notes)
      ? sentence(notes)
      : `${sentence(notes)} This is a big part of why I am particularly drawn to ${input.employer}.`
    : `[Why ${input.employer}: add one specific reason, such as part of the programme or a conversation with someone who works there.]`;
  paras.push({ text: `${why} Thank you for considering my application. I would welcome the chance to discuss it further.`, src: notes ? ["YOU ADDED"] : ["ADD YOUR REASON"] });
  paras.push({ text: `${formalSirMadam ? "Yours faithfully" : "Yours sincerely"},\n${input.name}`, src: ["UK CONVENTION"] });
  return paras;
}

export function paragraphsToText(p: LetterParagraph[], header: string): string {
  return [header, ...p.map((x) => x.text)].join("\n\n");
}
