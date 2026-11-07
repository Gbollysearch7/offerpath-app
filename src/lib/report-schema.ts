import { z } from "zod";
import { AREA_ORDER, CHECK_ORDER } from "@/lib/analysis/cv";
import { cvAssessment, cvBlocks, documentVersion, letterAssessment } from "@/lib/analysis/findings";
import { EXTRACTION_WARNING_CODES, PAYLOAD_VERSION, type Assessment, type CoverLetterPayload, type CvReviewPayload, type DocumentMeta, type EvidenceRef, type Finding, type ProofreadingReport, type ReportType, type TailorPayload } from "@/lib/types";

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
  acceptedCheck: z.strictObject({ validator: str, confirmed: strs }).optional(),
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
};

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

const version = { payloadVersion: z.literal(PAYLOAD_VERSION) };

// Current shape: strict, so a stray or misspelled field is a write error rather than silent data. Field order
// follows the engine's own, so a validated payload serialises byte for byte as the engine produced it.
const CURRENT = {
  cv_review: z.strictObject({ ...version, ...cvFields, assessment: AssessmentSchema, proofreading: ProofreadingSchema.optional() }),
  tailor: z.strictObject({ ...version, ...tailorFields }),
  cover_letter: z.strictObject({ ...version, ...letterFields, assessment: AssessmentSchema }),
};

// v0: reports saved before 5 November 2026. Same fields without a version or findings; unknown keys are dropped.
const LEGACY = {
  cv_review: z.object(cvFields),
  tailor: z.object(tailorFields),
  cover_letter: z.object(letterFields),
};

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
/** Compile-time check that the schemas and the TypeScript payload types describe the same shape. */
export const SCHEMAS_MATCH_TYPES: [Exact<z.infer<(typeof CURRENT)["cv_review"]>, CvReviewPayload>, Exact<z.infer<(typeof CURRENT)["tailor"]>, TailorPayload>, Exact<z.infer<(typeof CURRENT)["cover_letter"]>, CoverLetterPayload>] = [true, true, true];

export type ReportPayload = CvReviewPayload | TailorPayload | CoverLetterPayload;

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
  if (type === "cover_letter") {
    const l = p as CoverLetterPayload;
    const doc = documentVersion(l.letterText);
    if (l.assessment.documentVersion !== doc) return ["assessment is for a different letter text than the saved one"];
    return checkEvidence(l.assessment.findings, { [doc]: { doc: l.letterText } });
  }
  return tailorProblems(p as TailorPayload);
}

/**
 * A job match has to agree with the report around it, and every advert quotation has to be in the saved
 * advert. The CV isn't stored on a tailor report, so CV quotations are checked for shape here and against
 * the CV text where they are made (`matchRequirements`), with the CV's hash kept in `cvVersion`.
 */
function tailorProblems(t: TailorPayload): string[] {
  const m = t.jobMatch;
  if (!m) return t.assessment ? ["assessment saved without the job match it describes"] : [];
  const problems: string[] = [];
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

function upgrade(type: ReportType, v0: z.infer<(typeof LEGACY)[ReportType]>): ReportPayload {
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
