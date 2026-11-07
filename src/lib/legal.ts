// Details that appear in the legal pages. Set them in the environment before launch; until then the
// pages show clearly marked placeholders. These pages are templates and need review by a lawyer and
// each partner university's data protection officer.

const v = (key: string, placeholder: string) => process.env[key]?.trim() || placeholder;

export const legal = {
  operator: () => v("LEGAL_OPERATOR_NAME", "[Operator company name]"),
  operatorAddress: () => v("LEGAL_OPERATOR_ADDRESS", "[Registered address]"),
  companyNumber: () => v("LEGAL_COMPANY_NUMBER", "[Company number]"),
  icoNumber: () => v("LEGAL_ICO_NUMBER", "[ICO registration number]"),
  contactEmail: () => v("LEGAL_CONTACT_EMAIL", "[privacy@your-domain]"),
  supportEmail: () => v("SUPPORT_EMAIL", "[support@your-domain]"),
  retentionInactiveMonths: () => Number(process.env.RETENTION_INACTIVE_MONTHS || 24),
  lastUpdated: "27 October 2026",
};

export const SUB_PROCESSORS = [
  { name: "Supabase", purpose: "Database, sign-in and file storage", data: "Account details, CVs, reports, applications", location: "UK or EU region (chosen when the project is created)" },
  { name: "Anthropic (Claude)", purpose: "AI feedback: CV scoring, rewrites and cover letter drafts", data: "Text of CVs, job ads and cover letters, only when AI feedback is used", location: "United States. A data processing agreement and UK transfer safeguard are required before any pilot goes live" },
  { name: "Vercel", purpose: "Hosting the app", data: "Requests passing through the app, server logs", location: "UK (London region) with global edge network" },
  { name: "Resend", purpose: "Sending sign-in and deadline reminder emails", data: "Email address, email content", location: "United States / EU. A data processing agreement is required before any pilot goes live" },
];
