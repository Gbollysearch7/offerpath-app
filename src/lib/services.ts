// Pure builders that turn inputs into stored report payloads. Used by server actions and the demo seed.
import { STAGE_OPTIONS } from "@/lib/stages";
import { analyseCv } from "@/lib/analysis/cv";
import { highlightJob, placeInCv } from "@/lib/analysis/job";
import { highlightTerms, jobMatchAssessment, keywordsFromMatch, matchRequirements } from "@/lib/analysis/job-match";
import { type AdapterStatus, extractRequirements, type RequirementExtraction } from "@/lib/analysis/job-requirements";
import { cvAssessment, letterAssessment } from "@/lib/analysis/findings";
import { draftLetterRuleBased, paragraphsToText, reviewLetter } from "@/lib/analysis/letter";
import { PAYLOAD_VERSION, type CoverLetterPayload, type CvAnalysis, type CvReviewPayload, type DocumentMeta, type LetterParagraph, type InstitutionalGuidance, type TailorPayload } from "@/lib/types";

export function buildCvPayload(input: { fileName: string; text: string; sector: string; stage: string; storagePath?: string | null; analysis?: CvAnalysis; document?: DocumentMeta }): CvReviewPayload {
  const analysis = input.analysis ?? analyseCv(input.text, input.sector);
  return {
    payloadVersion: PAYLOAD_VERSION,
    fileName: input.fileName,
    sector: input.sector,
    stage: input.stage,
    text: input.text,
    storagePath: input.storagePath ?? null,
    analysis,
    // Only when the text came from a file read by `extractDocument`; text-only builders (demo seeds, tests) leave it out.
    ...(input.document ? { document: input.document } : {}),
    assessment: cvAssessment(analysis, input.text),
  };
}

/** Adds an institution's guidance beside a CV report. Only this field differs, so the common score cannot move. */
export const withInstitutionalGuidance = (payload: CvReviewPayload, institutionalGuidance: InstitutionalGuidance): CvReviewPayload => ({ ...payload, institutionalGuidance });

export function buildTailorPayload(input: {
  cvReportId: string;
  cvFileName: string;
  cvText: string;
  jobTitle: string;
  employer: string;
  jobUrl: string | null;
  jobText: string;
  deadline: string | null;
  /** The advert's requirements, when the caller has already read them (with or without the semantic adapter). */
  requirements?: { extraction: RequirementExtraction; status: AdapterStatus };
}): TailorPayload {
  const extraction = input.requirements?.extraction ?? extractRequirements(input.jobText);
  const jobMatch = matchRequirements({ jobText: input.jobText, cvText: input.cvText, extraction, adapter: input.requirements?.status });
  const keywords = keywordsFromMatch(jobMatch, (r) => placeInCv(r.terms[0], r.kind === "tool", input.jobText, input.cvText));
  const highlight = highlightTerms(jobMatch);
  return {
    payloadVersion: PAYLOAD_VERSION,
    cvReportId: input.cvReportId,
    cvFileName: input.cvFileName,
    jobTitle: input.jobTitle,
    employer: input.employer,
    jobUrl: input.jobUrl,
    jobText: input.jobText,
    deadline: input.deadline,
    keywords,
    matchNow: jobMatch.coverage.score,
    // Nothing has been revised yet, so there is nothing to measure. `createTailoredVersion` fills this from the real document.
    matchTailored: null,
    jd: highlightJob(input.jobText, highlight.hits, highlight.aliases),
    added: [],
    tailored: null,
    jobMatch,
    assessment: jobMatchAssessment(jobMatch),
  };
}

export function buildLetterReviewPayload(input: {
  letterText: string;
  jobTitle: string;
  employer: string;
  jobText: string;
  tailorReportId: string | null;
  cvReportId: string | null;
  cvFileName: string | null;
  cvText: string;
}): { payload: CoverLetterPayload; score: number } {
  const r = reviewLetter(input.letterText, input.jobText, input.employer, input.cvText);
  return {
    score: r.score,
    payload: {
      payloadVersion: PAYLOAD_VERSION,
      mode: "review",
      jobTitle: input.jobTitle,
      employer: input.employer,
      jobText: input.jobText,
      tailorReportId: input.tailorReportId,
      cvReportId: input.cvReportId,
      cvFileName: input.cvFileName,
      addressee: null,
      notes: null,
      letterText: input.letterText,
      paragraphs: input.letterText.split(/\n\s*\n/).map((t) => ({ text: t.trim(), src: [] })).filter((p) => p.text),
      checks: r.checks,
      keywordsUsed: r.keywordsUsed,
      keywordsMissing: r.keywordsMissing,
      words: r.words,
      paras: r.paras,
      summary: r.summary,
      saved: true,
      aiAssisted: false,
      assessment: letterAssessment({ letterText: input.letterText, jobText: input.jobText, checks: r.checks, keywordsUsed: r.keywordsUsed, keywordsMissing: r.keywordsMissing }),
    },
  };
}

export function letterHeader(name: string, email: string | null, phone: string | null, date = new Date()): string {
  const d = date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return `${[name, email, phone].filter(Boolean).join(" · ")}\n${d}`;
}

export function buildLetterDraftPayload(input: {
  paragraphs: LetterParagraph[] | null; // from Claude, or null to use the rule-based draft
  name: string;
  email: string | null;
  phone: string | null;
  jobTitle: string;
  employer: string;
  jobText: string;
  tailorReportId: string | null;
  cvReportId: string | null;
  cvFileName: string | null;
  cvPayload: CvReviewPayload | null;
  addressee: string | null;
  notes: string | null;
  stageLabel: string;
}): { payload: CoverLetterPayload; score: number } {
  const paragraphs =
    input.paragraphs ??
    draftLetterRuleBased({
      name: input.name,
      email: input.email,
      phone: input.phone,
      jobTitle: input.jobTitle,
      employer: input.employer,
      jobText: input.jobText,
      cvText: input.cvPayload?.text ?? "",
      analysis: input.cvPayload?.analysis ?? null,
      addressee: input.addressee,
      notes: input.notes,
      stageLabel: input.stageLabel,
    });
  const letterText = paragraphsToText(paragraphs, letterHeader(input.name, input.email, input.phone));
  const r = reviewLetter(letterText, input.jobText, input.employer, input.cvPayload?.text ?? "");
  return {
    score: r.score,
    payload: {
      payloadVersion: PAYLOAD_VERSION,
      mode: "draft",
      jobTitle: input.jobTitle,
      employer: input.employer,
      jobText: input.jobText,
      tailorReportId: input.tailorReportId,
      cvReportId: input.cvReportId,
      cvFileName: input.cvFileName,
      addressee: input.addressee,
      notes: input.notes,
      letterText,
      paragraphs,
      checks: r.checks,
      keywordsUsed: r.keywordsUsed,
      keywordsMissing: r.keywordsMissing,
      words: r.words,
      paras: r.paras,
      summary: r.summary,
      saved: false,
      aiAssisted: !!input.paragraphs,
      assessment: letterAssessment({ letterText, jobText: input.jobText, checks: r.checks, keywordsUsed: r.keywordsUsed, keywordsMissing: r.keywordsMissing }),
    },
  };
}

export function stageLabel(stage: string | null, course: string | null): string {
  const s = STAGE_OPTIONS.find((o) => o.key === stage)?.label ?? "final-year student";
  return course && s.endsWith("student") ? s.replace("student", `${course} student`) : s;
}
