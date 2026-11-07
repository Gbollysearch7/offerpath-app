// Anonymisation aid. It finds and replaces the obvious identifiers and flags what a person must look at. It does not
// make a document anonymous: a careful human review is still required and is recorded per document in the manifest.
//
// Replacements keep the shape of what they replace, because the engine's contact check looks for an email, a phone
// number and a LinkedIn link. Removing them outright would change the score and bias every comparison with advisers.
// The log records positions and categories only. It never repeats the personal data it found.

export interface PiiHit {
  category: string;
  line: number;
}

export interface AnonymiseResult {
  text: string;
  replaced: PiiHit[];
  /** Quasi-identifiers and sensitive details left in place for a human to decide on. */
  review: PiiHit[];
}

export const PLACEHOLDER_PHONE = "07700 900000";
export const PLACEHOLDER_POSTCODE = "AA1 1AA";
const PLACEHOLDER_EMAIL = /^candidate\.[\w-]+@example\.invalid$/i;
const PLACEHOLDER_LINKEDIN = /linkedin\.com\/in\/candidate-[\w-]+/i;
const PLACEHOLDER_URL = /example\.invalid/i;

const EMAIL = /[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/g;
const LINKEDIN = /(?:https?:\/\/)?(?:[\w-]+\.)?linkedin\.com\/[\w/%-]*/gi;
const URL_RE = /(?:https?:\/\/|www\.)[^\s,;|]+|\b(?:github\.com|gitlab\.com|behance\.net|medium\.com|twitter\.com|x\.com|instagram\.com)\/[^\s,;|]+/gi;
const PHONE = /(?:(?:\+|00)44[\s-]?(?:\(0\)[\s-]?)?|\b0)\d(?:[\s-]?\d){8,9}\b/g;
const POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b/g;
const NI_NUMBER = /\b[A-CEGHJ-PR-TW-Z]{2} ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b/g;
const STUDENT_ID = /\b(?:student|candidate|staff|matric(?:ulation)?|passport|driving licen[cs]e)\s*(?:id|no\.?|number|num)\s*[:#]?\s*[A-Z]{0,3}\d[\dA-Z-]{4,}\b/gi;
const DOB = /\b(?:d\.?o\.?b\.?|date of birth|born(?: on)?)\b[^\n]*/gi;
const STREET = /\b\d{1,4}[A-Za-z]?,? +(?:[A-Z][\w'-]+ +){1,4}(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Close|Drive|Dr|Way|Crescent|Court|Ct|Place|Terrace|Gardens|Grove|Hill|Square)\b\.?/g;
const TITLED_NAME = /\b(?:Dr|Mr|Mrs|Ms|Miss|Mx|Prof|Professor|Sir)\.? +[A-Z][\w'-]+(?: +[A-Z][\w'-]+){0,2}/g;

const REVIEW: [string, RegExp][] = [
  ["university or school named", /\b(?:university|college|school|academy|institute|polytechnic)\b/i],
  ["employer or organisation named", /\b(?:ltd|limited|plc|llp|inc|group|nhs|council|bank|trust)\b/i],
  ["references or referee", /\b(?:referees?|references?)\b/i],
  ["age, gender or family details", /\b(?:aged? \d{2}|gender|male|female|married|single|children|pronouns?)\b/i],
  ["nationality or immigration status", /\b(?:nationality|citizen(?:ship)?|visa|right to work|work permit|sponsorship|asylum|refugee)\b/i],
  ["health or disability", /\b(?:disabilit|disabled|dyslexi|autis|neurodiver|mental health|medical condition|wheelchair)\w*\b/i],
  ["religion, ethnicity, politics or sexuality", /\b(?:muslim|christian|jewish|hindu|sikh|buddhist|islamic|church|mosque|synagogue|ethnicity|bame|lgbt\w*|labour party|conservative party|trade union)\b/i],
  ["photo or image mentioned", /\b(?:photo|photograph|headshot)\b/i],
];

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

function looksLikeName(line: string): boolean {
  const words = line.trim().split(/\s+/);
  return words.length >= 2 && words.length <= 4 && words.every((w) => /^[A-Z][\w'’.-]*$/.test(w)) && !/\b(?:curriculum|vitae|resume|cv|profile|education|experience|skills)\b/i.test(line);
}

/** The first non-empty line, when it reads as a person's name. A guess: `knownNames` from the intake sheet is firmer. */
function headerName(text: string): string | null {
  const first = text.split("\n").map((l) => l.trim()).find(Boolean);
  return first && looksLikeName(first) ? first : null;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replaces identifiers with placeholders of the same shape, and lists what a person still has to check. */
export function anonymiseText(raw: string, pseudonym: string, knownNames: string[] = []): AnonymiseResult {
  const replaced: PiiHit[] = [];
  let text = raw;
  const sub = (re: RegExp, category: string, by: string) => {
    text = text.replace(re, (_m, ...rest) => {
      const at = rest.find((r) => typeof r === "number") as number;
      replaced.push({ category, line: lineOf(text, at) });
      return by;
    });
  };
  // Links before email and names, so a name inside a link isn't half replaced.
  sub(LINKEDIN, "LinkedIn link", `linkedin.com/in/candidate-${pseudonym}`);
  sub(EMAIL, "email", `candidate.${pseudonym}@example.invalid`);
  sub(URL_RE, "web link", `https://example.invalid/${pseudonym}`);
  sub(NI_NUMBER, "national insurance number", "[id removed]");
  sub(STUDENT_ID, "identity number", "[id removed]");
  sub(DOB, "date of birth", "[date of birth removed]");
  sub(STREET, "street address", "[address removed]");
  sub(POSTCODE, "postcode", PLACEHOLDER_POSTCODE);
  sub(PHONE, "phone", PLACEHOLDER_PHONE);
  sub(TITLED_NAME, "titled name", "[name removed]");

  const names = new Set(knownNames.map((n) => n.trim()).filter(Boolean));
  const header = headerName(raw);
  if (header) names.add(header);
  // Longest first, so "Amara Okafor" goes before "Amara". Then each part alone, because a surname reappears in text.
  const whole = [...names].sort((a, b) => b.length - a.length);
  for (const n of whole) sub(new RegExp(`\\b${esc(n)}\\b`, "gi"), "name", `Candidate ${pseudonym}`);
  const parts = new Set(whole.flatMap((n) => n.split(/\s+/)).filter((p) => p.length >= 3));
  // Matched with its capital only: a surname like "Long" must not take the word "long" with it.
  for (const p of parts) sub(new RegExp(`(?<!Candidate )\\b${esc(p)}\\b`, "g"), "part of name", "[name removed]");

  return { text, replaced, review: reviewFlags(text) };
}

export function reviewFlags(text: string): PiiHit[] {
  const out: PiiHit[] = [];
  text.split("\n").forEach((l, i) => {
    for (const [category, re] of REVIEW) if (re.test(l)) out.push({ category, line: i + 1 });
  });
  return out;
}

/** Identifiers still present. Placeholders written by `anonymiseText` are allowed; anything else stops the dataset. */
export function scanPii(text: string): PiiHit[] {
  const out: PiiHit[] = [];
  const add = (re: RegExp, category: string, allowed: (m: string) => boolean = () => false) => {
    for (const m of text.matchAll(re)) if (!allowed(m[0])) out.push({ category, line: lineOf(text, m.index) });
  };
  add(EMAIL, "email", (m) => PLACEHOLDER_EMAIL.test(m));
  add(LINKEDIN, "LinkedIn link", (m) => PLACEHOLDER_LINKEDIN.test(m));
  add(URL_RE, "web link", (m) => PLACEHOLDER_URL.test(m));
  add(PHONE, "phone", (m) => m.replace(/\D/g, "") === PLACEHOLDER_PHONE.replace(/\D/g, ""));
  add(POSTCODE, "postcode", (m) => m === PLACEHOLDER_POSTCODE);
  add(NI_NUMBER, "national insurance number");
  add(STUDENT_ID, "identity number");
  add(DOB, "date of birth", (m) => /^date of birth removed\]/.test(m));
  add(STREET, "street address");
  add(TITLED_NAME, "titled name");
  return out;
}
