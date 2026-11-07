import { z } from "zod";
import { AREA_ORDER, CHECK_ORDER } from "@/lib/analysis/cv";
import { cvAssessment, cvBlocks, documentVersion, letterAssessment } from "@/lib/analysis/findings";
import { normaliseText } from "@/lib/analysis/fingerprint";
import { LINKEDIN_SECTIONS, type LinkedinPayload } from "@/lib/linkedin-types";
import { EXTRACTION_WARNING_CODES, PAYLOAD_VERSION, type Assessment, type CoverLetterPayload, type CvReviewPayload, type DocumentMeta, type EvidenceRef, type Finding, type TailorVersion, type ProofreadingReport, type ReportType, type TailorPayload } from "@/lib/types";

// The contract for everything stored in reports.payload. Both repositories run `toStored` before a
// write, so nothing a provider or an action produces reaches the database unchecked, and `fromStored`
// after a read, so a payload saved under an older shape comes back in the current one. Nothing here
// changes a score: the adapters add the fields a historical record lacks and leave its numbers alone.

export class PayloadError extends Error {}

const int = (lo: number, hi = Number.MAX_SAFE_INTEGER) => z.number().int().min(lo).max(hi);
const str = z.string();
const nstr = z.string().nullable();
const strs = z.array(str);

/* ---------- CV analysis ---------- */

const ConfirmedFactSchema = z.strictObject({
  id: str,
  kind: z.enum(["figure", "date", "entity", "qualification", "responsibility", "outcome", "statement"]),
  value: str,
  issue: str,
  quote: str,
  scope: z.enum(["line", "entry", "cv"]),
  entryId: nstr,
  entryHeading: nstr,
  lineText: nstr,
  provenance: z.strictObject({ by: z.literal("student"), how: z.enum(["confirmed-suggestion", "typed"]), sourceVersion: str, validator: str, reportId: str, at: str }),
});
const AcceptedCheck = z.strictObject({ validator: str, confirmed: strs, facts: z.array(ConfirmedFactSchema).optional(), typed: z.boolean().optional() });

const CheckKeySchema = z.enum(CHECK_ORDER as [CvReviewPayload["analysis"]["areas"][number]["checks"][number]["key"], ...CvReviewPayload["analysis"]["areas"][number]["checks"][number]["key"][]]);
const AreaKeySchema = z.enum(AREA_ORDER as [CvReviewPayload["analysis"]["areas"][number]["key"], ...CvReviewPayload["analysis"]["areas"][number]["key"][]]);

const Check = z.strictObject({
  key: CheckKeySchema,
  area: AreaKeySchema,
  name: str,
  score: int(0, 10),
  summary: str,
  detail: str,
  stat: z.strictObject({ value: str, label: str }),
  affected: z.array(int(0)),
  progress: z.strictObject({ have: int(0), total: int(0), target: int(0) }).optional(),
  extras: strs.optional(),
});

const Line = z.strictObject({
  where: str,
  short: str,
  text: str,
  score: int(0, 10),
  cols: z.array(z.strictObject({ name: str, items: z.array(z.strictObject({ ok: z.boolean(), t: str })) })),
  rewrite: str,
  aiRewrite: z.boolean().optional(),
  accepted: str.optional(),
  acceptedCheck: AcceptedCheck.optional(),
  acceptedHistory: z.array(z.strictObject({ text: nstr, check: AcceptedCheck.nullable(), at: str })).optional(),
});

// Judgments are stored as the judge gave them (after `isJudgment` filtered them), so they stay plain strings here.
const Judgment = z.strictObject({ result: str, verb: str, kind: str, relevance: str });

const Analysis = z.strictObject({
  score: int(0, 100),
  areas: z.array(z.strictObject({ key: AreaKeySchema, name: str, what: str, score: int(0, 100), checks: z.array(Check) })),
  lines: z.array(Line),
  steps: z.array(z.strictObject({ check: CheckKeySchema, text: str, area: str, gain: z.number() })),
  wells: z.array(z.strictObject({ check: CheckKeySchema, text: str, area: str })),
  meta: z.strictObject({
    words: int(0),
    pages: int(0),
    bullets: int(0),
    sections: strs,
    name: nstr,
    email: nstr,
    phone: nstr,
    method: z.enum(["ai", "rules"]).optional(),
    judge: str.optional(),
    rubric: str.optional(),
    fingerprint: str.optional(),
    scoring: z
      .strictObject({ method: z.enum(["ai", "rules"]), rubric: str, parser: str, lexicon: str, normaliser: str, judgePrompt: nstr, model: nstr, identity: str, coreFingerprint: str })
      .optional(),
    judgments: z.array(Judgment).optional(),
  }),
});

/* ---------- Document metadata (OP-005) ---------- */

const DatePointSchema = z.strictObject({ year: int(1900, 2100), month: int(1, 12).nullable() });
const DateRangeSchema = z.strictObject({ raw: str, start: DatePointSchema.nullable(), end: z.union([DatePointSchema, z.literal("present")]).nullable() });

const WarningSchema = z.strictObject({
  code: z.enum(EXTRACTION_WARNING_CODES),
  severity: z.enum(["caution", "info"]),
  message: str,
  detail: str,
  count: int(0).nullable(),
  items: strs,
});

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const FormatSchema = z.enum(["pdf", "docx"]);
const ChangeSchema = z.strictObject({ block: str, kind: z.enum(["heading", "role", "bullet", "line"]), where: str, before: str, after: str });
const OutcomeSchema = z.strictObject({ kind: z.enum(["unsupported", "rejected"]), code: str, message: str });

/** Where a version's text came from (OP-006). The upload shape is OP-005's; a correction or paste names the student. */
const SourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("upload"), format: FormatSchema, bytes: int(1), sha256: hex64 }),
  z.strictObject({ kind: z.literal("correction"), parentDocumentVersion: hex64, correctedAt: z.iso.datetime(), by: z.literal("student"), changes: z.array(ChangeSchema).min(1) }),
  z.strictObject({ kind: z.literal("paste"), pastedAt: z.iso.datetime(), by: z.literal("student"), original: z.strictObject({ fileName: str, format: FormatSchema.nullable(), bytes: int(0), sha256: hex64, outcome: OutcomeSchema.nullable() }).nullable() }),
]);

const DocumentSchema = z.strictObject({
  source: SourceSchema,
  documentVersion: str,
  extraction: z.strictObject({
    extractor: str,
    parser: str,
    pages: z.strictObject({
      measured: int(0).nullable(),
      estimated: int(1),
      provenance: z.enum(["measured", "estimated"]),
      starts: z.array(int(0)),
      withoutText: z.array(int(1)),
      explicitBreaks: int(0).nullable(),
    }),
    warnings: z.array(WarningSchema),
    confidence: z.strictObject({ score: z.number().min(0).max(1), band: z.enum(["high", "medium", "low"]) }),
  }),
  structure: z.strictObject({
    sections: z.array(z.strictObject({ key: str, heading: nstr, bullets: int(0) })),
    roles: z.array(z.strictObject({ section: str, heading: str, dates: DateRangeSchema.nullable(), bullets: int(0) })),
    bullets: int(0),
    wrappedBullets: int(0),
    unrecognisedHeadings: strs,
  }),
});

/** Document metadata has to describe the saved text: same version, page offsets inside it, page counts that agree with each other. */
export function documentProblems(d: DocumentMeta, text: string): string[] {
  const problems: string[] = [];
  if (d.documentVersion !== documentVersion(text)) problems.push("document metadata is for a different text than the saved one");
  if (d.source.kind === "correction" && d.source.parentDocumentVersion === d.documentVersion) problems.push("a correction has the same text as the version it was made from");
  const p = d.extraction.pages;
  if (d.source.kind !== "upload" && p.measured !== null) problems.push("typed or corrected text has no file to count pages in");
  if ((p.provenance === "measured") !== (p.measured !== null)) problems.push("page provenance does not match whether a page count was measured");
  if (p.measured === null && (p.starts.length || p.withoutText.length)) problems.push("page offsets recorded without a measured page count");
  if (p.measured !== null) {
    if (p.starts.length !== p.measured) problems.push(`${p.starts.length} page offsets for ${p.measured} pages`);
    if (p.starts.some((s, i) => s > text.length || (i > 0 && s < p.starts[i - 1])) || (p.starts.length && p.starts[0] !== 0)) problems.push("page offsets are outside the text or out of order");
    if (p.withoutText.some((n) => n > p.measured!)) problems.push("a page without text is numbered beyond the page count");
  }
  return problems;
}

/** Validates document metadata on its own, for a version saved before any report scores it. Throws PayloadError. */
export function checkDocument(document: unknown, text: string): DocumentMeta {
  const r = DocumentSchema.safeParse(document);
  if (!r.success) throw new PayloadError(`document metadata is invalid: ${issues(r.error)}`);
  const problems = documentProblems(r.data, text);
  if (problems.length) throw new PayloadError(`document metadata is invalid: ${problems.join("; ")}`);
  return r.data;
}

/* ---------- Findings ---------- */

const Evidence = z.strictObject({
  documentVersion: str,
  block: str,
  range: z.strictObject({ start: int(0), end: int(0) }).nullable(),
  quote: str,
});

const FindingSchema = z.strictObject({
  id: str,
  check: str,
  status: z.enum(["passed", "needs_attention", "not_applicable", "unavailable", "uncertain"]),
  severity: z.enum(["high", "medium", "low", "info"]),
  confidence: z.number().min(0).max(1).nullable(),
  method: z.enum(["rules", "ai"]).nullable(),
  explanation: str,
  action: nstr,
  evidence: z.array(Evidence),
});

const AssessmentSchema = z.strictObject({
  documentVersion: str,
  versions: z.strictObject({ parser: nstr, rubric: nstr, model: nstr, dictionary: nstr }),
  origin: z.enum(["engine", "legacy"]),
  limits: strs,
  findings: z.array(FindingSchema),
});

/* ---------- Proofreading (OP-007) ---------- */

const CoverageSchema = z.strictObject({ status: z.enum(["assessed", "partial", "not_assessed"]), note: str });

const ProofreadingFindingSchema = FindingSchema.extend({
  status: z.literal("needs_attention"),
  category: z.enum(["spelling", "grammar", "punctuation", "regional"]),
  rule: str,
  suggestions: strs,
});

const ProofreadingSchema = z.strictObject({
  status: z.enum(["complete", "partial", "unavailable"]),
  provider: str,
  engine: nstr,
  dictionary: nstr,
  terminology: nstr,
  language: z.enum(["en-GB", "en-US"]),
  documentVersion: str,
  coverage: z.strictObject({ spelling: CoverageSchema, grammar: CoverageSchema, punctuation: CoverageSchema, regional: CoverageSchema }),
  stats: z.strictObject({ wordsChecked: int(0), wordsSkipped: int(0) }),
  limits: strs,
  findings: z.array(ProofreadingFindingSchema),
});

/* ---------- Payloads ---------- */

const InstitutionalGuidanceSchema = z.strictObject({ kind: z.literal("institutional_guidance"), label: str, institutionId: str, version: str, notes: z.array(z.strictObject({ title: str, text: str })) });
const cvFields = { fileName: str, sector: str, stage: str, text: str, storagePath: nstr.optional(), analysis: Analysis, document: DocumentSchema.optional(), institutionalGuidance: InstitutionalGuidanceSchema.optional() };

const JobRequirementFields = {
  id: str,
  label: str,
  kind: z.enum(["skill", "tool", "qualification", "experience", "location", "eligibility"]),
  category: z.enum(["essential", "desirable", "contextual", "uncertain"]),
  terms: strs,
  aliases: strs,
  orEquivalent: z.boolean(),
  soft: z.boolean(),
  occurrences: int(0),
  reason: str,
  source: Evidence,
  method: z.enum(["rules", "ai"]),
  assessable: z.boolean(),
};

const JobMatchSchema = z.strictObject({
  version: str,
  method: z.enum(["rules", "rules+ai"]),
  adapter: z.enum(["not_used", "applied", "failed"]),
  advertVersion: str,
  cvVersion: str,
  requirements: z.array(z.strictObject({ ...JobRequirementFields, evidence: z.strictObject({ level: z.enum(["explicit", "contextual", "weak", "none", "not_assessed"]), matchedTerm: nstr, refs: z.array(Evidence), note: str }) })),
  notRequired: z.array(z.strictObject({ label: str, terms: strs, source: Evidence })),
  coverage: z.strictObject({
    status: z.enum(["scored", "limited", "insufficient"]),
    score: int(0, 100).nullable(),
    explanation: str,
    earned: z.number().min(0),
    possible: z.number().min(0),
    assessed: z.strictObject({ essential: int(0), desirable: int(0) }),
    notCounted: z.strictObject({ contextual: int(0), uncertain: int(0), toConfirm: int(0) }),
  }),
  essentialGaps: strs,
  essentialThin: strs,
  toConfirm: strs,
});

const SavedCheckSchema = z.strictObject({
  validator: str,
  verdict: z.enum(["pass", "confirm"]),
  issues: z.array(z.strictObject({ code: str, severity: z.enum(["confirm", "note"]), found: str, key: str, message: str, from: str.optional() })),
  used: z.array(z.strictObject({ kind: str, value: str, heading: str, student: z.boolean().optional() })),
  questions: strs,
});
const TailorEditsSchema = z.strictObject({
  generation: int(0),
  suggestions: z.array(
    z.strictObject({
      id: str,
      kind: z.enum(["bullet", "summary", "skill", "new-line"]),
      lineIndex: int(0).nullable(),
      occurrence: int(0),
      entryId: nstr,
      where: str,
      before: str,
      proposed: str,
      origin: z.enum(["ai", "student"]),
      keywords: strs,
      note: nstr,
      generation: int(0),
      check: SavedCheckSchema,
    }),
  ),
  documents: z.array(z.strictObject({ documentVersion: str, text: str, match: JobMatchSchema })),
  versions: z.array(
    z.strictObject({
      id: str,
      n: int(0),
      at: str,
      action: z.enum(["start", "accept", "edit", "reject", "reopen", "tailor", "accept-all", "own-line"]),
      label: str,
      documentVersion: str,
      scoringVersion: str,
      baseVersion: str,
      shown: strs,
      decisions: z.record(z.string(), z.strictObject({ status: z.enum(["accepted", "edited", "rejected"]), text: nstr, confirmed: strs, facts: z.array(ConfirmedFactSchema), at: str })),
    }),
  ),
  current: str,
  undoStack: strs,
  withheld: z.array(z.strictObject({ where: str, reason: str })),
  prompts: z.array(z.strictObject({ where: str, before: str, after: str })),
  note: nstr,
});

const tailorFields = {
  cvReportId: str,
  cvFileName: str,
  jobTitle: str,
  employer: str,
  jobUrl: nstr,
  jobText: str,
  deadline: nstr,
  keywords: z.array(z.strictObject({ w: str, n: int(0), must: z.boolean(), where: str, soft: z.boolean(), inCv: z.boolean() })),
  matchNow: int(0, 100).nullable(),
  matchTailored: int(0, 100).nullable(),
  jd: z.array(z.strictObject({ isH: z.boolean(), text: str.optional(), segs: z.array(z.strictObject({ t: str, kind: z.enum(["plain", "found", "missing"]) })).optional() })),
  added: strs,
  tailored: z.array(z.strictObject({ where: str, before: str, after: str, keywords: strs.optional() })).nullable(),
  summary: nstr.optional(),
  skillsToAdd: strs.optional(),
  notEvidenced: strs.optional(),
  tailoredCv: nstr.optional(),
  aiTailored: z.boolean().optional(),
  jobMatch: JobMatchSchema.optional(),
  assessment: AssessmentSchema.optional(),
  edits: TailorEditsSchema.optional(),
  interpretations: z
    .array(z.strictObject({ requirementId: str, label: str, category: z.enum(["essential", "desirable", "contextual", "uncertain"]), stance: z.literal("not_relevant"), note: nstr, by: z.literal("student"), at: str, withdrawnAt: nstr }))
    .optional(),
  retainedPlaceholders: z.array(z.strictObject({ documentVersion: str, at: str })).optional(),
  editRevision: int(0).optional(),
  attempts: strs.optional(),
};

/* ---------- Cover letter assessment and editing (OP-016, OP-017) ---------- */

const LetterContextSchema = z.strictObject({
  format: z.enum(["letter", "statement"]),
  limit: z.strictObject({ amount: int(1), unit: z.enum(["words", "characters"]), source: z.enum(["advert", "student"]), ref: Evidence.nullable() }).nullable(),
});
const LetterReviewSchema = z.strictObject({
  version: str,
  method: z.literal("rules"),
  letterVersion: str,
  advertVersion: nstr,
  notesVersion: nstr,
  cvVersion: nstr,
  context: LetterContextSchema,
  score: int(0, 100).nullable(),
  coverage: z.enum(["complete", "partial", "not_scored"]),
  scoreNote: str,
  areas: z.array(
    z.strictObject({
      key: z.enum(["employer_motivation", "role_motivation", "hard_skills", "soft_skills", "examples", "cv_consistency", "structure", "length", "clarity", "mechanics"]),
      label: str,
      status: z.enum(["passed", "needs_attention", "not_applicable", "unavailable", "uncertain"]),
      severity: z.enum(["high", "medium", "low", "info"]),
      credit: z.number().min(0).max(1).nullable(),
      weight: z.number().min(0),
      impact: z.enum(["meaning", "style"]),
      explanation: str,
      action: nstr,
      evidence: z.array(Evidence),
    }),
  ),
  motivation: z.strictObject({ verdict: z.enum(["specific_sourced", "specific_personal", "specific_unverified", "generic", "absent", "information_missing"]), employerInfo: z.enum(["advert", "notes", "none"]), quote: Evidence.nullable(), source: Evidence.nullable() }),
  requirements: z.array(
    z.strictObject({
      id: str,
      label: str,
      category: z.enum(["essential", "desirable"]),
      soft: z.boolean(),
      level: z.enum(["demonstrated", "mentioned", "absent"]),
      term: nstr,
      letter: Evidence.nullable(),
      advert: Evidence,
      cv: z.strictObject({ level: z.enum(["explicit", "contextual", "weak", "none", "not_assessed", "not_checked"]), refs: z.array(Evidence) }),
      counted: z.boolean(),
      note: str,
    }),
  ),
  toConfirm: strs,
  examples: z.array(z.strictObject({ quote: Evidence, cv: Evidence.nullable() })),
  factIssues: z.array(z.strictObject({ code: str, severity: z.enum(["block", "confirm"]), found: str, message: str, quote: Evidence })),
  length: z.strictObject({ words: int(0), verdict: z.enum(["fits_limit", "over_limit", "very_short", "short", "typical", "long", "very_long"]), explanation: str }),
  placeholders: strs,
  signedName: z.strictObject({ expected: nstr, found: nstr }),
});
const LetterParagraphSchema = z.strictObject({ text: str, src: strs });
const LetterEditsSchema = z.strictObject({
  generation: int(0),
  header: str,
  base: str,
  suggestions: z.array(
    z.strictObject({
      id: str,
      kind: z.enum(["replace", "own", "delete", "insert"]),
      paragraph: int(0),
      before: str,
      proposed: str,
      origin: z.enum(["ai", "rule", "student"]),
      reason: str,
      area: z.enum(["employer_motivation", "role_motivation", "hard_skills", "soft_skills", "examples", "cv_consistency", "structure", "length", "clarity", "mechanics"]).nullable(),
      generation: int(0),
      check: SavedCheckSchema,
    }),
  ),
  documents: z.array(z.strictObject({ documentVersion: str, scoringVersion: str, text: str, paragraphs: z.array(LetterParagraphSchema), review: LetterReviewSchema })),
  versions: z.array(
    z.strictObject({
      id: str,
      n: int(0),
      at: str,
      action: z.enum(["start", "suggest", "accept", "edit", "reject", "reopen", "accept-all", "own", "delete"]),
      label: str,
      documentVersion: str,
      scoringVersion: str,
      shown: strs,
      decisions: z.record(z.string(), z.strictObject({ status: z.enum(["accepted", "edited", "rejected"]), text: nstr, confirmed: strs, facts: z.array(ConfirmedFactSchema), at: str })),
    }),
  ),
  current: str,
  undoStack: strs,
  withheld: z.array(z.strictObject({ where: str, reason: str })),
  aiClaims: z.array(z.strictObject({ text: str, issues: z.array(z.strictObject({ code: str, severity: z.enum(["confirm", "note"]), found: str, key: str, message: str, from: str.optional() })) })),
  note: nstr,
});

const letterFields = {
  mode: z.enum(["review", "draft"]),
  jobTitle: str,
  employer: str,
  jobText: str,
  tailorReportId: nstr,
  cvReportId: nstr,
  cvFileName: nstr,
  addressee: nstr,
  notes: nstr,
  letterText: str,
  paragraphs: z.array(z.strictObject({ text: str, src: strs })),
  checks: z.array(z.strictObject({ ok: z.boolean(), t: str, d: str })),
  keywordsUsed: strs,
  keywordsMissing: strs,
  words: int(0),
  paras: int(0),
  summary: str,
  saved: z.boolean(),
  aiAssisted: z.boolean(),
};

// OP-018. Only ever saved in the current shape, so there is no older version of it to adapt.
const LinkedinSectionSchema = z.strictObject({
  key: z.enum(LINKEDIN_SECTIONS),
  versions: z.array(
    z.strictObject({ id: str, n: int(1), at: str, action: z.enum(["start", "typed", "accepted"]), label: str, text: str, documentVersion: str, accepted: strs, confirmed: strs, facts: z.array(ConfirmedFactSchema) }),
  ).min(1),
  current: str,
  undoStack: strs,
  suggestions: z.array(z.strictObject({ id: str, before: nstr, after: str, why: str, method: z.enum(["rules", "ai"]), basedOn: str, at: str })),
  rejected: z.array(z.strictObject({ suggestionId: str, at: str })),
  withheld: strs,
  assessments: z.array(z.strictObject({ at: str, assessment: AssessmentSchema, proofreading: ProofreadingSchema.nullable() })),
  choices: z.array(z.strictObject({ documentVersion: str, kind: z.enum(["dismiss", "reopen"]), findingId: str, quote: str, actor: z.literal("student"), at: str })),
});

const linkedinFields = {
  source: z.strictObject({ method: z.enum(["paste", "export"]), files: strs, skippedFiles: int(0), linksIgnored: z.array(z.enum(LINKEDIN_SECTIONS)) }),
  aim: nstr,
  cv: z.strictObject({ reportId: str, fileName: str, documentVersion: str }).nullable(),
  sections: z.array(LinkedinSectionSchema),
  aiAssisted: z.boolean(),
  editRevision: int(0).optional(),
  attempts: strs.optional(),
};

const version = { payloadVersion: z.literal(PAYLOAD_VERSION) };

// Current shape: strict, so a stray or misspelled field is a write error rather than silent data. Field order
// follows the engine's own, so a validated payload serialises byte for byte as the engine produced it.
const CURRENT = {
  cv_review: z.strictObject({ ...version, ...cvFields, editRevision: int(0).optional(), assessment: AssessmentSchema, proofreading: ProofreadingSchema.optional() }),
  tailor: z.strictObject({ ...version, ...tailorFields }),
  cover_letter: z.strictObject({ ...version, ...letterFields, assessment: AssessmentSchema, review: LetterReviewSchema.optional(), edits: LetterEditsSchema.optional(), signer: nstr.optional(), editRevision: int(0).optional(), attempts: strs.optional(), retainedPlaceholders: z.array(z.strictObject({ documentVersion: str, at: str })).optional() }),
  linkedin: z.strictObject({ ...version, ...linkedinFields }),
};

// v0: reports saved before 5 November 2026. Same fields without a version or findings; unknown keys are dropped.
const LEGACY = {
  cv_review: z.object(cvFields),
  tailor: z.object(tailorFields),
  cover_letter: z.object(letterFields),
};

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
/** Compile-time check that the schemas and the TypeScript payload types describe the same shape. */
export const SCHEMAS_MATCH_TYPES: [Exact<z.infer<(typeof CURRENT)["cv_review"]>, CvReviewPayload>, Exact<z.infer<(typeof CURRENT)["tailor"]>, TailorPayload>, Exact<z.infer<(typeof CURRENT)["cover_letter"]>, CoverLetterPayload>, Exact<z.infer<(typeof CURRENT)["linkedin"]>, LinkedinPayload>] = [true, true, true, true];

export type ReportPayload = CvReviewPayload | TailorPayload | CoverLetterPayload | LinkedinPayload;

const issues = (e: z.ZodError) => e.issues.slice(0, 5).map((i) => `${i.path.join(".") || "payload"}: ${i.message}`).join("; ");

/* ---------- Evidence ---------- */

/**
 * Every evidence reference has to resolve in the text it claims to describe: a known document version, a
 * known block, offsets inside it, and a quote equal to what sits there. Returns the problems found.
 */
export function checkEvidence(findings: Pick<Finding, "id" | "evidence">[], documents: Record<string, Record<string, string>>): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const f of findings) {
    if (ids.has(f.id)) problems.push(`${f.id}: duplicate finding id`);
    ids.add(f.id);
    for (const e of f.evidence) {
      const blocks = documents[e.documentVersion];
      if (!blocks) {
        problems.push(`${f.id}: unknown document version ${e.documentVersion.slice(0, 12)}`);
        continue;
      }
      const block = blocks[e.block];
      if (block === undefined) {
        problems.push(`${f.id}: unknown block ${e.block}`);
        continue;
      }
      if (e.range) {
        const { start, end } = e.range;
        if (start >= end || end > block.length) problems.push(`${f.id}: range ${start}-${end} is outside ${e.block} (${block.length} characters)`);
        else if (block.slice(start, end) !== e.quote) problems.push(`${f.id}: quote does not match ${e.block} at ${start}-${end}`);
      } else if (e.quote !== block) problems.push(`${f.id}: quote does not match ${e.block}`);
    }
  }
  return problems;
}

/** A proofreading report has to describe the saved text, and "unavailable" can't carry findings it says it never made. */
function proofreadingProblems(p: ProofreadingReport, doc: string, blocks: Record<string, Record<string, string>>): string[] {
  const problems: string[] = [];
  if (p.documentVersion !== doc) problems.push("proofreading is for a different document version than the saved text");
  if (p.status === "unavailable" && p.findings.length) problems.push("an unavailable proofreading run has findings");
  if (p.findings.some((f) => f.check !== `proofreading.${f.category}`)) problems.push("a proofreading finding's check doesn't match its category");
  if (p.findings.some((f) => !f.evidence.length || f.evidence.some((e) => !e.range))) problems.push("a proofreading finding doesn't say where it is");
  return [...problems, ...checkEvidence(p.findings, blocks)];
}

function assessmentProblems(type: ReportType, p: ReportPayload): string[] {
  if (type === "cv_review") {
    const cv = p as CvReviewPayload;
    const doc = documentVersion(cv.text);
    if (cv.assessment.documentVersion !== doc) return ["assessment is for a different document version than the saved text"];
    const blocks = { [doc]: cvBlocks(cv.text, cv.analysis.lines) };
    return [...(cv.document ? documentProblems(cv.document, cv.text) : []), ...checkEvidence(cv.assessment.findings, blocks), ...(cv.proofreading ? proofreadingProblems(cv.proofreading, doc, blocks) : [])];
  }
  if (type === "linkedin") return linkedinProblems(p as LinkedinPayload);
  if (type === "cover_letter") {
    const l = p as CoverLetterPayload;
    const doc = documentVersion(l.letterText);
    if (l.assessment.documentVersion !== doc) return ["assessment is for a different letter text than the saved one"];
    return letterProblems(l, doc);
  }
  return tailorProblems(p as TailorPayload);
}

/**
 * A letter's assessment has to be of its own words. Every passage it quotes has to be where it says in the letter, the advert or the
 * notes, the selected version has to be what the report shows, and a kept wording has to be in the document that version points at.
 * A report with no `review` predates this and only has its own findings to check.
 */
function letterProblems(l: CoverLetterPayload, doc: string): string[] {
  const sources: Record<string, Record<string, string>> = { [doc]: { doc: l.letterText }, [documentVersion(l.jobText)]: { doc: l.jobText } };
  if (l.notes?.trim()) sources[documentVersion(l.notes.trim())] = { doc: l.notes.trim() };
  const problems = checkEvidence(l.assessment.findings.map((f) => ({ id: f.id, evidence: f.evidence.filter((e) => e.documentVersion !== l.review?.cvVersion) })), sources);
  const r = l.review;
  if (!r) return l.edits ? [...problems, "edits saved without the assessment they belong to"] : problems;
  if (r.letterVersion !== doc) problems.push("review is for a different letter text than the saved one");
  if (r.advertVersion !== null && r.advertVersion !== documentVersion(l.jobText)) problems.push("review is for a different advert than the saved one");
  for (const q of r.requirements) {
    if (q.letter && (q.letter.documentVersion !== doc || l.letterText.slice(q.letter.range?.start ?? 0, q.letter.range?.end ?? 0) !== q.letter.quote)) problems.push(`${q.id}: the letter passage is not in this letter`);
    if (q.cv.refs.some((e) => e.documentVersion !== r.cvVersion || !e.quote)) problems.push(`${q.id}: CV evidence is not a quotation from the CV it was compared with`);
    if (q.level === "absent" && q.letter) problems.push(`${q.id}: a passage cited for a requirement marked as absent`);
  }
  const e = l.edits;
  if (!e) return problems;
  for (const d of e.documents) {
    if (documentVersion(d.text) !== d.documentVersion) problems.push(`document ${d.documentVersion.slice(0, 8)}: text does not match its version`);
    if (d.review.letterVersion !== d.documentVersion) problems.push(`document ${d.documentVersion.slice(0, 8)}: assessment is of a different document`);
  }
  const ids = new Set(e.suggestions.map((s) => s.id));
  for (const v of e.versions) {
    const d = e.documents.find((x) => x.documentVersion === v.documentVersion && x.scoringVersion === v.scoringVersion);
    if (!d) {
      problems.push(`version ${v.id}: no document`);
      continue;
    }
    for (const id of [...v.shown, ...Object.keys(v.decisions)]) if (!ids.has(id)) problems.push(`version ${v.id}: unknown suggestion ${id}`);
    for (const [id, dec] of Object.entries(v.decisions)) {
      const s = e.suggestions.find((x) => x.id === id);
      if (dec.status !== "rejected" && dec.text && s?.kind !== "delete" && !squash(d.text).includes(squash(dec.text))) {
        // A later whole-paragraph edit may have replaced a kept passage: only a decision nothing overrode has to be there.
        const overridden = Object.entries(v.decisions).some(([other]) => e.suggestions.find((x) => x.id === other)?.paragraph === s?.paragraph && ["own", "delete"].includes(e.suggestions.find((x) => x.id === other)?.kind ?? ""));
        if (!overridden) problems.push(`version ${v.id}: kept text for ${id} is not in its document`);
      }
    }
  }
  const cur = e.versions.find((v) => v.id === e.current);
  if (!cur) problems.push("the selected version does not exist");
  else if (cur.documentVersion !== doc) problems.push("the selected version's document is not the saved letter text");
  return problems;
}

/**
 * A job match has to agree with the report around it, and every advert quotation has to be in the saved
 * advert. The CV isn't stored on a tailor report, so CV quotations are checked for shape here and against
 * the CV text where they are made (`matchRequirements`), with the CV's hash kept in `cvVersion`.
 */
function tailorProblems(t: TailorPayload): string[] {
  const m = t.jobMatch;
  if (!m) return t.assessment || t.edits ? [t.edits ? "edits saved without the job match they compare with" : "assessment saved without the job match it describes"] : [];
  const problems: string[] = [...editProblems(t)];
  const advert = documentVersion(t.jobText);
  if (m.advertVersion !== advert) problems.push("job match is for a different advert than the saved one");
  if (m.coverage.score !== t.matchNow) problems.push("match score does not equal the job match's coverage");
  if (t.assessment && t.assessment.documentVersion !== m.cvVersion) problems.push("assessment is for a different CV version than the job match");
  const sources = [...m.requirements.map((r) => ({ id: r.id, ref: r.source })), ...m.notRequired.map((n) => ({ id: n.label, ref: n.source }))];
  const stub = (id: string, ref: EvidenceRef): Finding => ({ id, check: id, status: "uncertain", severity: "info", confidence: null, method: null, explanation: "", action: null, evidence: [ref] });
  problems.push(...checkEvidence(sources.map((s, i) => stub(`${s.id}#${i}`, s.ref)), { [advert]: { doc: t.jobText } }));
  for (const r of m.requirements) {
    for (const e of r.evidence.refs) {
      if (e.documentVersion !== m.cvVersion || !e.quote || (e.range && e.range.end - e.range.start !== e.quote.length)) problems.push(`${r.id}: CV evidence is not a quotation from this CV version`);
    }
    if (r.evidence.level === "none" && r.evidence.refs.length) problems.push(`${r.id}: evidence cited for a requirement marked as having none`);
  }
  return problems;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * A displayed result has to be the result for its own document, so this is checked before anything is saved: each stored
 * assessment is of its own text, the top-level figures are the selected version's, and every word the student kept is in
 * the document that version points at.
 */
function editProblems(t: TailorPayload): string[] {
  const e = t.edits;
  if (!e) return [];
  const problems: string[] = [];
  const advert = documentVersion(t.jobText);
  for (const d of e.documents) {
    if (documentVersion(d.text) !== d.documentVersion) problems.push(`document ${d.documentVersion.slice(0, 8)}: text does not match its version`);
    if (d.match.cvVersion !== d.documentVersion) problems.push(`document ${d.documentVersion.slice(0, 8)}: assessment is of a different document`);
    if (d.match.advertVersion !== advert) problems.push(`document ${d.documentVersion.slice(0, 8)}: assessment is of a different advert`);
    const flat = squash(d.text);
    for (const r of d.match.requirements) for (const ref of r.evidence.refs) if (ref.documentVersion !== d.documentVersion || !flat.includes(squash(ref.quote))) problems.push(`document ${d.documentVersion.slice(0, 8)}: ${r.id} cites text that is not in it`);
  }
  const ids = new Set(e.suggestions.map((s) => s.id));
  const docOf = (v: TailorVersion) => e.documents.find((d) => d.documentVersion === v.documentVersion && d.match.version === v.scoringVersion);
  for (const v of e.versions) {
    const doc = docOf(v);
    if (!doc) problems.push(`version ${v.id}: no document`);
    for (const id of [...v.shown, ...Object.keys(v.decisions)]) if (!ids.has(id)) problems.push(`version ${v.id}: unknown suggestion ${id}`);
    if (!doc) continue;
    const flat = squash(doc.text);
    for (const [id, d] of Object.entries(v.decisions)) {
      if (d.status === "rejected") continue;
      if (!d.text) problems.push(`version ${v.id}: ${id} kept with no text`);
      else if (!flat.includes(squash(d.text))) problems.push(`version ${v.id}: ${id} is not in the document`);
    }
  }
  const current = e.versions.find((v) => v.id === e.current);
  if (!current) return [...problems, "selected version does not exist"];
  const doc = docOf(current);
  if (doc) {
    const revised = current.documentVersion !== current.baseVersion;
    if ((t.tailoredCv ?? null) !== (revised ? doc.text : null)) problems.push("tailored CV is not the selected version's document");
    if (t.matchTailored !== (revised ? doc.match.coverage.score : null)) problems.push("tailored match is not the selected version's own assessment");
  }
  for (const id of e.undoStack) if (!e.versions.some((v) => v.id === id)) problems.push(`undo refers to missing version ${id}`);
  return problems;
}

/** Every section once, every version's hash true to its text, and all feedback describing a version that exists. */
function linkedinProblems(p: LinkedinPayload): string[] {
  const problems: string[] = [];
  if (p.sections.map((s) => s.key).join() !== LINKEDIN_SECTIONS.join()) problems.push("a LinkedIn report must hold each section once, in order");
  for (const s of p.sections) {
    const hashes = new Map(s.versions.map((v) => [v.documentVersion, v.text]));
    if (s.versions.some((v) => documentVersion(v.text) !== v.documentVersion)) problems.push(`${s.key}: a version's hash doesn't match its text`);
    if (!s.versions.some((v) => v.id === s.current)) problems.push(`${s.key}: the current version doesn't exist`);
    if (s.undoStack.some((id) => !s.versions.some((v) => v.id === id))) problems.push(`${s.key}: undo refers to a version that doesn't exist`);
    for (const a of s.assessments) {
      const doc = a.assessment.documentVersion;
      const text = hashes.get(doc);
      if (text === undefined) {
        problems.push(`${s.key}: feedback is for text this section never held`);
        continue;
      }
      const blocks = { [doc]: { doc: normaliseText(text) } };
      problems.push(...checkEvidence(a.assessment.findings, blocks), ...(a.proofreading ? proofreadingProblems(a.proofreading, doc, blocks) : []));
    }
  }
  return problems;
}

/** A LinkedIn review has its own feedback and no number, file or CV version: nothing that could mix with the CV score. */
export function checkReportRow(type: ReportType, row: { score: number | null | undefined; source?: unknown }): void {
  if (type === "linkedin" && (row.score != null || row.source)) throw new PayloadError("a LinkedIn report has no score and no source file");
}

/* ---------- The two sides of the contract ---------- */

/** Validates a payload about to be saved. Throws PayloadError rather than letting an invalid one persist. */
export function toStored(type: ReportType, payload: unknown): ReportPayload {
  const r = CURRENT[type].safeParse(payload);
  if (!r.success) throw new PayloadError(`${type} payload is invalid: ${issues(r.error)}`);
  const problems = assessmentProblems(type, r.data);
  if (problems.length) throw new PayloadError(`${type} evidence is invalid: ${problems.join("; ")}`);
  return r.data;
}

/**
 * Reads a saved payload in whatever version it was written. Older records are adapted in memory, not
 * rewritten in storage, and anything they did not record stays unknown.
 */
export function fromStored(type: ReportType, raw: unknown): ReportPayload {
  const v = raw && typeof raw === "object" ? (raw as { payloadVersion?: unknown }).payloadVersion : undefined;
  if (v === undefined) {
    if (type === "linkedin") throw new PayloadError("saved linkedin payload has no version, and no older shape of it exists");
    const r = LEGACY[type].safeParse(raw);
    if (!r.success) throw new PayloadError(`saved ${type} payload could not be read: ${issues(r.error)}`);
    return upgrade(type, r.data);
  }
  if (v === PAYLOAD_VERSION) {
    const r = CURRENT[type].safeParse(raw);
    if (!r.success) throw new PayloadError(`saved ${type} payload (v${v}) could not be read: ${issues(r.error)}`);
    return r.data;
  }
  throw new PayloadError(`saved ${type} payload is version ${String(v)}, which this version of Offerpath cannot read`);
}

function upgrade(type: keyof typeof LEGACY, v0: z.infer<(typeof LEGACY)[keyof typeof LEGACY]>): ReportPayload {
  if (type === "cv_review") {
    const p = v0 as z.infer<(typeof LEGACY)["cv_review"]>;
    return { payloadVersion: PAYLOAD_VERSION, ...p, assessment: cvAssessment(p.analysis, p.text, "legacy") };
  }
  if (type === "cover_letter") {
    const p = v0 as z.infer<(typeof LEGACY)["cover_letter"]>;
    return { payloadVersion: PAYLOAD_VERSION, ...p, assessment: letterAssessment(p, "legacy") };
  }
  return { payloadVersion: PAYLOAD_VERSION, ...(v0 as z.infer<(typeof LEGACY)["tailor"]>) };
}

export type { Assessment };
