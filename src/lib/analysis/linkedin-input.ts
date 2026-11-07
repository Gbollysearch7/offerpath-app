import { normaliseText } from "./claims";
import { LINKEDIN_SECTIONS, type LinkedinSectionKey } from "@/lib/linkedin-types";

// OP-018: what a student may give us: pasted sections or a supported export. A link is text. Nothing in the LinkedIn
// modules opens one, and a section that's only a link counts as empty and says so.

export const SECTION_LIMIT: Record<LinkedinSectionKey, number> = { headline: 400, about: 6_000, experience: 20_000, education: 6_000, skills: 4_000, other: 10_000 };
export const AIM_LIMIT = 160;

/** Characters a Postgres text column can't hold are removed, and line endings made one kind. */
export const cleanSection = (s: string) =>
  s
    .replace(/\u0000/g, "")
    .toWellFormed()
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const LINK_RE = /^(?:https?:\/\/|www\.|linkedin\.com\/|[a-z]{2,3}\.linkedin\.com\/)\S*$/i;

/** True when everything in the text is a web address: a link alone gives us nothing to read, and we won't go and look. */
export function isOnlyLinks(text: string): boolean {
  const parts = normaliseText(text).split(/\s+/).filter(Boolean);
  return parts.length > 0 && parts.every((p) => LINK_RE.test(p));
}

export interface PastedInput {
  sections: Record<LinkedinSectionKey, string>;
  linksIgnored: LinkedinSectionKey[];
}

/** Reads the form's sections. Anything over a section's limit is refused by name, rather than silently cut. */
export function readPastedSections(raw: (key: LinkedinSectionKey) => string): PastedInput | { error: string } {
  const sections = {} as Record<LinkedinSectionKey, string>;
  const linksIgnored: LinkedinSectionKey[] = [];
  for (const key of LINKEDIN_SECTIONS) {
    const text = cleanSection(raw(key));
    if (text.length > SECTION_LIMIT[key]) return { error: `Your ${key} section is longer than we can read (${SECTION_LIMIT[key].toLocaleString("en-GB")} characters). Shorten it and try again.` };
    if (isOnlyLinks(text)) {
      linksIgnored.push(key);
      sections[key] = "";
    } else sections[key] = text;
  }
  return { sections, linksIgnored };
}

export const LINK_ONLY_ERROR = "We can't read a profile from a link, and we didn't try to open it. Paste the words of each section, or upload a LinkedIn data export.";
