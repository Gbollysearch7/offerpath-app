// Pure builders that turn inputs into stored report payloads. Used by server actions and the demo seed.
import { STAGE_OPTIONS } from "@/lib/stages";
import { analyseCv } from "@/lib/analysis/cv";
import { highlightJob, jobKeywords, matchScores } from "@/lib/analysis/job";
import { draftLetterRuleBased, paragraphsToText, reviewLetter } from "@/lib/analysis/letter";
import type { CoverLetterPayload, CvAnalysis, CvReviewPayload, LetterParagraph, TailorPayload } from "@/lib/types";

export function buildCvPayload(input: { fileName: string; text: string; sector: string; stage: string; storagePath?: string | null; analysis?: CvAnalysis }): CvReviewPayload {
  const { analysis, ...rest } = input;
  return { ...rest, storagePath: input.storagePath ?? null, analysis: analysis ?? analyseCv(input.text, input.sector) };
}

export function buildTailorPayload(input: {
  cvReportId: string;
  cvFileName: string;
  cvText: string;
  jobTitle: string;
  employer: string;
  jobUrl: string | null;
  jobText: string;
  deadline: string | null;
}): TailorPayload {
  const keywords = jobKeywords(input.jobText, input.cvText);
  const m = matchScores(keywords);
  return {
    cvReportId: input.cvReportId,
    cvFileName: input.cvFileName,
    jobTitle: input.jobTitle,
    employer: input.employer,
    jobUrl: input.jobUrl,
    jobText: input.jobText,
    deadline: input.deadline,
    keywords,
    matchNow: m.now,
    matchTailored: m.tailored,
    jd: highlightJob(input.jobText, keywords),
    added: [],
    tailored: null,
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
    },
  };
}

export function stageLabel(stage: string | null, course: string | null): string {
  const s = STAGE_OPTIONS.find((o) => o.key === stage)?.label ?? "final-year student";
  return course && s.endsWith("student") ? s.replace("student", `${course} student`) : s;
}
