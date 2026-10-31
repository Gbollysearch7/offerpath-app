import type { DocBlock } from "@/lib/documents-types";

// CV designs. One theme drives the Word file, the PDF and the on-screen preview, so all three match.
// Every design stays single column with real text, so applicant tracking systems can read it.

export type TemplateTag = "one" | "two" | "skills" | "serif" | "colour";

export interface CvTheme {
  slug: string;
  name: string;
  best: string;
  tags: TemplateTag[];
  /** Example CV shown until the student switches to their own. */
  sample: string;
  font: "georgia" | "garamond" | "times" | "cambria" | "calibri" | "arial";
  /** Body text size in points. */
  body: number;
  accent: string;
  /** Spacing: 0.8 is tight, 1 normal, 1.2 airy. */
  space: number;
  nameStyle: { align: "left" | "center"; size: number; upper: boolean; tracking: number; accent: boolean; bold: boolean };
  heading: { style: "rule" | "rule-above" | "double" | "band" | "bar" | "plain"; upper: boolean; accent: boolean; tracking: number; size: number };
  date: "right" | "below" | "inline";
  bullet: "•" | "–" | "›" | "·";
  /** A line under the contact details. */
  headerRule: boolean;
}

export const FONTS: Record<CvTheme["font"], { word: string; css: string; pdf: "sans" | "serif" }> = {
  georgia: { word: "Georgia", css: "Georgia, 'Times New Roman', serif", pdf: "serif" },
  garamond: { word: "Garamond", css: "Garamond, 'EB Garamond', 'Times New Roman', serif", pdf: "serif" },
  times: { word: "Times New Roman", css: "'Times New Roman', Times, serif", pdf: "serif" },
  cambria: { word: "Cambria", css: "Cambria, Georgia, serif", pdf: "serif" },
  calibri: { word: "Calibri", css: "Calibri, Carlito, 'Segoe UI', Arial, sans-serif", pdf: "sans" },
  arial: { word: "Arial", css: "Arial, Helvetica, sans-serif", pdf: "sans" },
};

const base = {
  space: 1,
  nameStyle: { align: "left", size: 20, upper: false, tracking: 0, accent: false, bold: true },
  heading: { style: "rule", upper: true, accent: false, tracking: 0, size: 11 },
  date: "right",
  bullet: "•",
  headerRule: false,
} as const;

export const CV_THEMES: CvTheme[] = [
  {
    ...base,
    slug: "classic",
    name: "Classic",
    best: "Finance, law and the public sector. Serif type and quiet rules that read as traditional.",
    tags: ["two", "serif"],
    sample: "classic",
    font: "georgia",
    body: 10.5,
    accent: "#111111",
  },
  {
    ...base,
    slug: "centred",
    name: "Centred",
    best: "A clean, balanced header that suits any sector.",
    tags: ["one"],
    sample: "centred",
    font: "arial",
    body: 10.5,
    accent: "#111111",
    nameStyle: { ...base.nameStyle, align: "center", size: 22, upper: true, tracking: 1.5 },
    heading: { ...base.heading, tracking: 0.7 },
    headerRule: true,
  },
  {
    ...base,
    slug: "modern",
    name: "Modern",
    best: "Marketing, tech and start-ups. A green side bar on each heading gives it energy.",
    tags: ["one", "colour"],
    sample: "creative-brief",
    font: "calibri",
    body: 11,
    accent: "#36604E",
    nameStyle: { ...base.nameStyle, size: 26, accent: true },
    heading: { ...base.heading, style: "bar", accent: true, size: 12 },
    bullet: "›",
  },
  {
    ...base,
    slug: "executive",
    name: "Executive",
    best: "Law, consulting and banking. Garamond, spaced capitals and double rules.",
    tags: ["two", "serif", "colour"],
    sample: "law",
    font: "garamond",
    body: 11.5,
    accent: "#1F3A5F",
    nameStyle: { ...base.nameStyle, align: "center", size: 24, upper: true, tracking: 1.6, accent: true, bold: false },
    heading: { ...base.heading, style: "double", accent: true, tracking: 0.7 },
    headerRule: true,
  },
  {
    ...base,
    slug: "compact",
    name: "Compact",
    best: "Fits the most on one page. Good for spring weeks and first internships.",
    tags: ["one"],
    sample: "compact",
    font: "arial",
    body: 9.5,
    accent: "#111111",
    space: 0.75,
    nameStyle: { ...base.nameStyle, size: 16 },
    heading: { ...base.heading, size: 10 },
    date: "inline",
    bullet: "–",
  },
  {
    ...base,
    slug: "technical",
    name: "Technical",
    best: "Engineering and technology. Shaded section bands and projects up front.",
    tags: ["two", "skills", "colour"],
    sample: "technical",
    font: "calibri",
    body: 10.5,
    accent: "#2F4858",
    heading: { ...base.heading, style: "band", accent: true, tracking: 0.7 },
  },
  {
    ...base,
    slug: "skills-first",
    name: "Skills first",
    best: "Career changers and students with little work experience. Skills lead the page.",
    tags: ["skills", "one", "colour"],
    sample: "skills-first",
    font: "calibri",
    body: 11,
    accent: "#8A5A00",
    heading: { ...base.heading, style: "plain", accent: true, tracking: 0.8, size: 11.5 },
    headerRule: true,
  },
  {
    ...base,
    slug: "creative-brief",
    name: "Creative brief",
    best: "Marketing, media and the arts. A warm accent, still simple enough for screening software.",
    tags: ["one", "colour"],
    sample: "creative-brief",
    font: "arial",
    body: 10.5,
    accent: "#B4532A",
    nameStyle: { ...base.nameStyle, size: 28, accent: true },
    heading: { ...base.heading, style: "rule-above", accent: true, upper: false, size: 13 },
    date: "below",
  },
  {
    ...base,
    slug: "minimal",
    name: "Minimal",
    best: "Design-led employers. No rules, lots of white space, small spaced headings.",
    tags: ["one"],
    sample: "data",
    font: "arial",
    body: 10,
    accent: "#5C6B66",
    space: 1.2,
    nameStyle: { ...base.nameStyle, size: 24, bold: false },
    heading: { ...base.heading, style: "plain", accent: true, tracking: 0.6, size: 9.5 },
    bullet: "·",
  },
  {
    ...base,
    slug: "academic",
    name: "Academic",
    best: "Research, PhD and master's applications. Cambria, dates under each entry.",
    tags: ["two", "serif"],
    sample: "research",
    font: "cambria",
    body: 11,
    accent: "#4A3B6B",
    nameStyle: { ...base.nameStyle, align: "center", size: 20 },
    heading: { ...base.heading, upper: false, accent: true, size: 12.5 },
    date: "below",
    bullet: "–",
  },
  {
    ...base,
    slug: "city",
    name: "City",
    best: "Investment banking and accounting. The dense, one-page format the City expects.",
    tags: ["one", "serif"],
    sample: "classic",
    font: "times",
    body: 10.5,
    accent: "#111111",
    space: 0.8,
    nameStyle: { ...base.nameStyle, align: "center", size: 16, upper: true, tracking: 1 },
    heading: { ...base.heading, size: 10.5 },
  },
  {
    ...base,
    slug: "bold",
    name: "Bold",
    best: "Sales, hospitality and customer-facing roles. Strong headings that stand out.",
    tags: ["one", "colour"],
    sample: "skills-first",
    font: "arial",
    body: 10.5,
    accent: "#0F5257",
    nameStyle: { ...base.nameStyle, size: 26, upper: true, tracking: 1, accent: true },
    heading: { ...base.heading, style: "band", accent: true, tracking: 0.7, size: 10.5 },
    bullet: "›",
  },
];

/**
 * Most letter spacing a line can have before PDF readers, and so screening software, start reading
 * "PRIYA" as "P R I Y A". Measured with pdf.js: words split at about 9% of the font size.
 */
export const MAX_TRACKING = 0.07;

/** A light tint of a colour, used behind band headings. The heading text stays in the full colour, so it still reads if an app drops the band. */
export function tint(hex: string, amount = 0.14): string {
  const h = hex.replace("#", "");
  const mix = (i: number) => Math.round(255 - (255 - parseInt(h.slice(i, i + 2), 16)) * amount).toString(16).padStart(2, "0");
  return `#${mix(0)}${mix(2)}${mix(4)}`.toUpperCase();
}

/** The line under the name ("Product growth & marketing technology"): the theme's colour when it has one, else dark grey. */
export const taglineColour = (t: CvTheme) => (t.accent === "#111111" ? "#333333" : t.accent);

/** Contact items joined so a line only breaks between them, never inside "London, United Kingdom", and never before a "·". */
export const contactLine = (text: string) =>
  text
    .split(/\s+·\s+/)
    .map((item) => item.trim().replace(/\s+/g, "\u00A0"))
    .join("\u00A0·  ");

export const themeBySlug = (slug: string | null | undefined) => CV_THEMES.find((t) => t.slug === slug) ?? null;

/** Plain theme for cover letters: Arial, no colour. */
export const LETTER_THEME: CvTheme = { ...CV_THEMES[0], slug: "letter", font: "arial", body: 11 };

const YEAR_RANGE = /\s*\|\s*((?:[A-Z][a-z]+\.?\s+)?(?:19|20)\d{2}(?:\s*[–—-]\s*(?:(?:[A-Z][a-z]+\.?\s+)?(?:19|20)\d{2}|present|current))?)\s*$/i;

/** Example CVs write roles as "Job, Employer | 2024 – 2025"; split those into role lines with dates. */
export function withRoles(blocks: DocBlock[]): DocBlock[] {
  return blocks.flatMap((b): DocBlock[] => {
    if (b.kind !== "para") return [b];
    const [first, ...rest] = b.text.split("\n");
    const m = first.match(YEAR_RANGE);
    // "Kingsway School | A levels: ..." has no dates; use the same "·" separator as the role lines.
    if (!m) return [{ ...b, text: b.text.replace(/\s+\|\s+/g, " · ") }];
    const role: DocBlock = { kind: "role", text: first.slice(0, m.index).replace(/\s*\|\s*/g, " · "), date: m[1] };
    return rest.length ? [role, { kind: "para", text: rest.join("\n") }] : [role];
  });
}
