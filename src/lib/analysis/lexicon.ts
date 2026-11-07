// Word lists used by the rule-based CV, job ad and cover letter checks.

/** Bump when any list below changes: saved findings record which word lists they were checked against. */
export const LEXICON_VERSION = "lexicon-2026-11-07.1";

export const SECTORS = [
  "Finance and banking",
  "Consulting",
  "Technology",
  "Law",
  "Engineering",
  "Public sector",
  "Healthcare",
  "Marketing and media",
  "Retail and FMCG",
  "Charity and NGO",
] as const;

export const STAGES = [
  "Final year, graduate roles",
  "Penultimate year, internships",
  "First year, spring weeks",
  "Placement year",
] as const;

// Weak opening verbs and stronger replacements.
export const WEAK_VERBS: Record<string, string[]> = {
  // Replacements keep the same level of involvement: "supported" never becomes "built" or "led".
  helped: ["Contributed to", "Coordinated", "Supported"],
  assisted: ["Coordinated", "Supported delivery of", "Contributed to"],
  supported: ["Contributed to", "Coordinated", "Enabled"],
  worked: ["Collaborated on", "Contributed to", "Delivered"],
  participated: ["Contributed to", "Collaborated on", "Took part in"],
  involved: ["Contributed to", "Collaborated on", "Delivered"],
  responsible: ["Managed", "Led", "Ran"],
  handled: ["Managed", "Resolved", "Processed"],
  did: ["Completed", "Delivered", "Produced"],
  made: ["Created", "Built", "Produced"],
  tried: ["Tested", "Piloted", "Trialled"],
  attended: ["Represented", "Contributed to", "Completed"],
  used: ["Applied", "Deployed", "Used"],
  served: ["Served", "Looked after", "Resolved queries for"],
  got: ["Secured", "Earned", "Won"],
};

export const STRONG_VERBS = [
  "achieved", "analysed", "analyzed", "built", "captained", "chaired", "coordinated", "created", "cut",
  "delivered", "designed", "developed", "directed", "doubled", "drafted", "earned", "edited", "established",
  "exceeded", "expanded", "forecast", "founded", "generated", "grew", "guided", "identified", "implemented",
  "improved", "increased", "launched", "led", "managed", "mentored", "modelled", "negotiated", "organised",
  "organized", "oversaw", "pitched", "presented", "produced", "raised", "reconciled", "recruited", "reduced",
  "researched", "resolved", "saved", "secured", "streamlined", "supervised", "taught", "trained", "tutored",
  "won", "wrote", "counted", "planned", "ran", "set", "translated", "tested", "audited", "evaluated",
];

// Present-tense forms, for current roles ("Run the CRM programme", "Lead marketing for two brands").
const IRREGULAR_PRESENT: Record<string, string> = {
  built: "build", cut: "cut", forecast: "forecast", grew: "grow", led: "lead", oversaw: "oversee", ran: "run",
  set: "set", taught: "teach", won: "win", wrote: "write",
};
export const PRESENT_STRONG_VERBS = new Set(
  STRONG_VERBS.flatMap((v) => {
    if (IRREGULAR_PRESENT[v]) return [IRREGULAR_PRESENT[v]];
    if (v.endsWith("ied")) return [v.slice(0, -3) + "y"];
    if (/([bdgklmnprt])\1ed$/.test(v)) return [v.slice(0, -3)]; // planned -> plan, modelled -> model
    if (v.endsWith("ed")) return [v.slice(0, -1), v.slice(0, -2)]; // managed -> manage; launched -> launch
    return [];
  }),
);

export const DUTY_PHRASES = [
  "responsible for", "duties included", "duties include", "tasks included", "in charge of",
  "my role was", "role involved", "was tasked with", "job involved",
];

export const FILLER_WORDS = [
  "very", "really", "just", "basically", "actually", "quite", "various", "successfully", "literally",
  "extremely", "highly", "simply",
];

export const BUZZWORDS = [
  "hard-working", "hardworking", "team player", "passionate", "go-getter", "synergy", "detail-oriented",
  "results-driven", "self-starter", "think outside the box", "dynamic", "highly motivated", "proactive",
  "perfectionist", "best of breed", "go-to person", "people person", "excellent communication skills",
];

// US spelling → UK spelling.
export const US_SPELLINGS: Record<string, string> = {
  organize: "organise", organized: "organised", organizing: "organising", organization: "organisation",
  analyze: "analyse", analyzed: "analysed", analyzing: "analysing", optimize: "optimise", optimized: "optimised",
  prioritize: "prioritise", prioritized: "prioritised", recognize: "recognise", recognized: "recognised",
  utilize: "utilise", utilized: "utilised", modeled: "modelled", modeling: "modelling", color: "colour",
  behavior: "behaviour", center: "centre", favorite: "favourite", license: "licence", labor: "labour",
  catalog: "catalogue", program: "programme", traveled: "travelled", enrollment: "enrolment",
  specialize: "specialise", specialized: "specialised", summarize: "summarise", summarized: "summarised",
  finalized: "finalised", standardized: "standardised", minimize: "minimise", maximize: "maximise",
};

export const SECTION_HEADERS: Record<string, string> = {
  education: "education",
  "education and qualifications": "education",
  qualifications: "education",
  "academic background": "education",
  experience: "experience",
  "work experience": "experience",
  "professional experience": "experience",
  "relevant experience": "experience",
  employment: "experience",
  "employment history": "experience",
  "work history": "experience",
  "career history": "experience",
  "research experience": "experience",
  research: "experience",
  "academic experience": "experience",
  "academic appointments": "experience",
  "teaching experience": "experience",
  teaching: "experience",
  "research and teaching": "experience",
  "teaching and research": "experience",
  projects: "projects",
  "academic projects": "projects",
  "selected projects": "projects",
  skills: "skills",
  "skills and interests": "skills",
  "technical skills": "skills",
  "key skills": "skills",
  "skills and languages": "skills",
  interests: "interests",
  hobbies: "interests",
  "hobbies and interests": "interests",
  activities: "activities",
  "other activities": "activities",
  "student activities": "activities",
  "extracurricular activities": "activities",
  extracurricular: "activities",
  "extra-curricular activities": "activities",
  "positions of responsibility": "activities",
  leadership: "activities",
  "leadership and activities": "activities",
  "activities and interests": "activities",
  volunteering: "activities",
  "volunteer experience": "activities",
  achievements: "achievements",
  "awards and achievements": "achievements",
  awards: "achievements",
  certifications: "achievements",
  publications: "achievements",
  "publication history": "achievements",
  "publications and presentations": "achievements",
  conferences: "achievements",
  "conferences and talks": "achievements",
  "conferences and presentations": "achievements",
  presentations: "achievements",
  talks: "achievements",
  "talks and presentations": "achievements",
  grants: "achievements",
  "grants and funding": "achievements",
  "funding and awards": "achievements",
  funding: "achievements",
  scholarships: "achievements",
  "honours and awards": "achievements",
  "awards and honours": "achievements",
  references: "references",
  summary: "summary",
  profile: "summary",
  "personal profile": "summary",
  "professional summary": "summary",
  "personal statement": "summary",
  about: "summary",
  "about me": "summary",
  contact: "contact",
  languages: "skills",
};

/**
 * One-word headings that are also ordinary items in a skills or interests list. Written normally on a line of their
 * own inside such a list they are list items; in capitals they are headings, wherever they appear.
 */
export const LIST_ITEM_HEADINGS = new Set(["activities", "research", "teaching", "conferences", "presentations", "talks", "grants", "funding", "scholarships"]);

export const SECTOR_KEYWORDS: Record<string, string[]> = {
  "Finance and banking": ["financial modelling", "excel", "valuation", "due diligence", "commercial awareness", "financial statements", "risk", "analysis", "sql", "python", "bloomberg", "stakeholder", "accounting", "markets", "investment", "forecasting"],
  Consulting: ["problem solving", "stakeholder", "client", "strategy", "analysis", "presentation", "powerpoint", "excel", "research", "recommendations", "project management", "commercial awareness", "data"],
  Technology: ["python", "javascript", "typescript", "sql", "git", "agile", "cloud", "aws", "api", "testing", "data", "machine learning", "react", "java"],
  Law: ["legal research", "drafting", "commercial awareness", "attention to detail", "negotiation", "client", "contract", "compliance", "advocacy", "mooting", "case", "research"],
  Engineering: ["cad", "matlab", "design", "testing", "project", "simulation", "manufacturing", "safety", "technical", "analysis", "prototype", "solidworks"],
  "Public sector": ["policy", "stakeholder", "research", "analysis", "communication", "community", "public", "governance", "report", "data", "evidence"],
  Healthcare: ["patient", "care", "clinical", "safeguarding", "communication", "teamwork", "compassion", "nhs", "audit", "research"],
  "Marketing and media": ["campaign", "social media", "content", "analytics", "brand", "seo", "copywriting", "audience", "engagement", "creative", "digital"],
  "Retail and FMCG": ["customer", "sales", "commercial awareness", "supply chain", "merchandising", "stock", "brand", "targets", "teamwork", "data"],
  "Charity and NGO": ["fundraising", "volunteers", "community", "campaign", "impact", "stakeholder", "events", "grant", "advocacy", "outreach"],
};

export const SOFT_SKILLS = [
  "communication", "teamwork", "leadership", "problem solving", "time management", "attention to detail",
  "adaptability", "creativity", "organisation", "resilience", "initiative", "collaboration", "presentation",
  "interpersonal", "negotiation", "analytical",
];

// Hard terms recognised in job ads, on top of all sector keywords.
export const EXTRA_HARD_TERMS = [
  "power bi", "tableau", "vba", "r", "financial modelling", "stakeholder management", "commercial awareness",
  "due diligence", "data analysis", "project management", "customer service", "budgeting", "reporting",
  "strategy", "corporate finance", "accounting", "audit", "tax", "consulting", "marketing",
  "operations", "product management", "user research", "statistics", "economics",
];

export const NUMBER_RE = /(\d|£|\$|€|%|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand|million|dozen)\b)/i;

export const PASSIVE_RE = /\b(was|were|been|being|is|are|be)\s+(\w+ly\s+)?(\w+ed|built|made|given|taken|done|shown|seen|known|written|chosen|led|run|sent|held|kept|set|paid|awarded)\b/i;
