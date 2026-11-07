import "server-only";
import { z } from "zod";
import { runAnalysisJob } from "@/lib/analysis-job";
import { withoutInstructions } from "@/lib/analysis/claims";
import { documentVersion } from "@/lib/analysis/findings";
import { extractRequirements } from "@/lib/analysis/job-requirements";
import { matchRequirements, remeasure } from "@/lib/analysis/job-match";
import { JOB_POLICY } from "@/lib/analysis/job-state";
import { baseDocument, documentOf, interpretationsNow, tailoredExport } from "@/lib/analysis/tailor-edits";
import { keepVersionFlow, loadWorkspace, type LinkFlowResult } from "@/lib/applications/flow";
import type { ArtefactSlot, Workspace } from "@/lib/applications/workspace";
import { log } from "@/lib/log";
import { INTERVIEW_SECTORS } from "@/lib/practice";
import { practiceFeedback, withModelNotes } from "@/lib/practice-feedback";
import { generalQuestions, groundedQuestions, questionsFor } from "@/lib/practice-questions";
import { ANSWER_MAX, ANSWER_MIN, PRACTICE_OBJECTIVES, PracticeRefusedError, type PracticeAnswer, type PracticeFeedback, type PracticeObjective, type PracticeQuestion } from "@/lib/practice-types";
import type { Repo } from "@/lib/repo/types";
import type { Application, CvReviewPayload, JobMatch, TailorPayload } from "@/lib/types";

// OP-023: interview practice for one application, on top of the repository, with the provider injected. What the questions
// are is always worked out here from the student's own saved records, never taken from what a page sent: the page says which
// application and which question, and the server finds both again. So a forged request can't save a question that quotes
// something the CV doesn't say, or attach an answer to someone else's application.

/* ---------- Which CV version: the student's choice, recorded on the application ---------- */

export interface CandidateVersion {
  kind: "cv" | "tailor";
  reportId: string;
  label: string;
  /** The hash the student is agreeing to. Null: this one can't be chosen yet, and `blocked` says why. */
  version: string | null;
  blocked: string | null;
  /** The report now holding this slot by link, so a second tab can't silently replace it. */
  holder: string | null;
}

export interface ApprovedDocument {
  kind: "cv" | "tailor";
  reportId: string;
  version: string;
  label: string;
  text: string;
  /** Something the student should know: a newer version exists, or the CV has changed. */
  note: string | null;
}

export type Grounding =
  | { state: "not-found" }
  /** Nothing on this application to practise from. */
  | { state: "no-cv"; application: Application }
  /** There's a CV, but the student hasn't said this is the one. Questions wait until they do. */
  | { state: "unapproved"; application: Application; candidates: CandidateVersion[]; note: string | null }
  | {
      state: "ready";
      application: Application;
      document: ApprovedDocument;
      advert: { reportId: string | null; version: string; from: "tailor" | "listing" } | null;
      /** Null when there's no advert, or nothing in it could be read as a requirement. */
      match: JobMatch | null;
      advertText: string | null;
      questions: PracticeQuestion[];
    };

const labelFor = (slot: ArtefactSlot) => (slot.kind === "tailor" ? `Tailored CV${slot.kept?.n ? `, version ${slot.kept.n}` : slot.artefact.current ? `, version ${slot.artefact.current.n}` : ""}` : `CV: ${slot.artefact.fileName ?? slot.artefact.title}`);

/** The words of a kept version, if the report still holds them. */
async function keptText(repo: Repo, slot: ArtefactSlot, hash: string): Promise<{ text: string } | { blocked: string } | null> {
  if (slot.kind === "tailor") {
    const report = await repo.getReport<TailorPayload>(slot.artefact.reportId);
    if (!report) return null;
    const p = report.payload;
    const versionId = p.edits ? p.edits.versions.filter((v) => v.documentVersion === hash).at(-1)?.id : undefined;
    if (p.edits && !versionId) return null;
    const out = tailoredExport(p, versionId ?? null);
    if (out.kind === "placeholders") return { blocked: slot.artefact.blocked ?? "This version still has blanks to fill or keep." };
    return out.kind === "ready" && out.documentVersion === hash ? { text: out.text } : null;
  }
  const report = await repo.getReport<CvReviewPayload>(slot.artefact.reportId);
  if (!report) return null;
  const base = baseDocument(report.payload);
  if (base.version === hash) return { text: base.text };
  return report.payload.assessment.documentVersion === hash && !report.payload.analysis.lines.some((l) => l.accepted) ? { text: base.text } : null;
}

const heldBy = (slot: ArtefactSlot) => (slot.how === "linked" ? slot.artefact.reportId : null);

function candidateFor(slot: ArtefactSlot): CandidateVersion | null {
  const a = slot.artefact;
  if (!a.readable) return null;
  if (slot.kind === "tailor" && !a.latest) return null;
  return { kind: slot.kind as "cv" | "tailor", reportId: a.reportId, label: labelFor(slot), version: a.blocked ? null : a.latest, blocked: a.blocked, holder: heldBy(slot) };
}

function matchFor(p: TailorPayload | null, listing: string | null, hash: string, text: string, tailored: boolean): { match: JobMatch | null; advertText: string | null } {
  if (p) {
    const version = tailored ? p.edits?.versions.filter((v) => v.documentVersion === hash).at(-1) : undefined;
    if (p.edits && version) return { match: documentOf(p.edits, version).match, advertText: p.jobText };
    if (p.jobMatch) return { match: p.jobMatch.cvVersion === hash ? p.jobMatch : remeasure(p.jobMatch, p.jobText, text), advertText: p.jobText };
    return { match: matchRequirements({ jobText: p.jobText, cvText: text, extraction: extractRequirements(p.jobText) }), advertText: p.jobText };
  }
  if (listing?.trim()) return { match: matchRequirements({ jobText: listing, cvText: text, extraction: extractRequirements(listing) }), advertText: listing };
  return { match: null, advertText: null };
}

/** Works out what practice for this application is based on. Reads the student's own records only: another student's id finds nothing. */
export async function resolveGrounding(repo: Repo, applicationId: string, known?: Workspace): Promise<Grounding> {
  const workspace = known ?? (await loadWorkspace(repo, { today: new Date().toISOString().slice(0, 10) })).workspace;
  const group = workspace.applications.find((g) => g.application.id === applicationId);
  if (!group) return { state: "not-found" };
  const { application, slots } = group;
  const tailor = slots.tailor;
  const cv = slots.cv;
  if (!tailor && !cv) {
    // Nothing on the application yet, but the student has a CV: offer it, and choosing it puts it there.
    const latest = workspace.latestCv;
    if (!latest?.readable || !latest.latest) return { state: "no-cv", application };
    return { state: "unapproved", application, note: null, candidates: [{ kind: "cv", reportId: latest.reportId, label: `CV: ${latest.fileName ?? latest.title}`, version: latest.blocked ? null : latest.latest, blocked: latest.blocked, holder: null }] };
  }

  let note: string | null = null;
  let approved: { slot: ArtefactSlot; hash: string; text: string } | null = null;
  // What the student kept for this application is their choice. A tailored CV is the more specific document, so it's looked at first.
  for (const slot of [tailor, cv]) {
    if (!slot?.kept || approved) continue;
    const held = await keptText(repo, slot, slot.kept.documentVersion);
    if (held && "text" in held) approved = { slot, hash: slot.kept.documentVersion, text: held.text };
    else if (held) note = held.blocked;
    else note = "The version you kept has changed since, so its words are no longer saved. Choose the one you're using now.";
  }
  if (!approved) {
    const candidates = [tailor, cv].flatMap((s) => {
      const c = s ? candidateFor(s) : null;
      return c ? [c] : [];
    });
    return candidates.length ? { state: "unapproved", application, candidates, note } : { state: "no-cv", application };
  }

  const tailorReport = tailor ? await repo.getReport<TailorPayload>(tailor.artefact.reportId) : null;
  const opportunity = !tailorReport && application.opportunityId ? (await repo.opportunities()).find((o) => o.id === application.opportunityId) : undefined;
  const listing = opportunity?.description ?? null;
  const p = tailorReport?.payload ?? null;
  const { match, advertText } = matchFor(p, listing, approved.hash, approved.text, approved.slot.kind === "tailor");
  const slot = approved.slot;
  const document: ApprovedDocument = {
    kind: slot.kind as "cv" | "tailor",
    reportId: slot.artefact.reportId,
    version: approved.hash,
    label: labelFor(slot),
    text: approved.text,
    note: slot.kept && !slot.kept.isLatest ? "A newer version exists. These questions use the one you kept." : slot.artefact.stale,
  };
  const questions = groundedQuestions({ role: application.role, org: application.org, cvText: approved.text, match, advertText, notRelevant: p ? interpretationsNow(p).map((i) => i.requirementId) : [] });
  return {
    state: "ready",
    application,
    document,
    advert: advertText ? { reportId: tailorReport?.row.id ?? null, version: documentVersion(advertText), from: tailorReport ? "tailor" : "listing" } : null,
    match: match?.requirements.length ? match : null,
    advertText,
    questions,
  };
}

/** The student says which version they're practising from. It's the same record as keeping a version on the dashboard, so there's one source of truth. */
export function approveVersionFlow(repo: Repo, input: { applicationId: string; reportId: string; kind: "cv" | "tailor"; seen: string; ifCurrent: string | null }): Promise<LinkFlowResult> {
  return keepVersionFlow(repo, input);
}

/* ---------- Saving an answer ---------- */

export interface PracticeProviderInput {
  question: string;
  parts: { id: string; label: string }[];
  answer: string;
  cvText: string | null;
}
/** Null means it could not (no key, a provider error, a refusal). It may also throw or return junk: it's treated as untrusted. */
export type PracticeProvider = (input: PracticeProviderInput) => Promise<unknown>;

export interface SubmitInput {
  applicationId: string | null;
  sector: string;
  objective: string;
  questionId: string;
  answer: string;
  attemptKey: string;
}

export interface SubmitResult {
  error?: string;
  /** The question or CV changed since the page loaded. Nothing was saved. */
  conflict?: boolean;
  feedback?: PracticeFeedback;
  answerId?: string;
  /** True: it's saved. False: the feedback is real, but the answer didn't save and the student should know. */
  saved?: boolean;
}

const SESSION_NOTE = "This question has changed, because the CV version or the advert has. Reload the page and your answer can go on the new one. Nothing was saved.";
const NOT_FOUND = "We couldn't find that application. Reload the page and try again.";
const Observations = z.object({
  notAnswered: z.array(z.string().max(80)).max(12),
  observations: z.array(z.object({ kind: z.enum(["contribution", "unsupported", "clearer"]), quote: z.string().max(500), comment: z.string().max(500) })).max(12),
});

// NUL and broken surrogates can't be stored in a Postgres text column.
const storable = (s: string) => s.replace(/\u0000/g, "").toWellFormed().trim();

const objectiveOf = (raw: string): PracticeObjective => (PRACTICE_OBJECTIVES.includes(raw as PracticeObjective) ? (raw as PracticeObjective) : "all");

const CLEAN_LINE = (s: string) =>
  s
    .split("\n")
    .map((l) => withoutInstructions(l).text)
    .filter(Boolean)
    .join("\n");

/** A checked model pass over the answer. Everything it does is optional: any failure leaves the rule feedback as it is. */
async function modelPass(repo: Repo, provider: PracticeProvider, input: { key: string; question: PracticeQuestion; answer: string; cvText: string | null; rules: PracticeFeedback }): Promise<PracticeFeedback> {
  return runAnalysisJob<PracticeFeedback>(
    repo,
    { workflow: "practice_feedback", key: input.key, freshSeconds: JOB_POLICY.repeatWindowSeconds, replay: async () => input.rules, refuse: () => input.rules },
    async (run) => {
      const charge = await run.charge("practice");
      if (!charge.allowed) return { status: "failed", value: input.rules, errorCode: "quota", countFailure: false };
      const raw = await provider({ question: input.question.q, parts: input.question.parts.map((p) => ({ id: p.id, label: p.label })), answer: CLEAN_LINE(input.answer), cvText: input.cvText ? CLEAN_LINE(input.cvText) : null }).catch(() => null);
      const parsed = Observations.safeParse(raw);
      if (!parsed.success) return { status: "failed", value: input.rules, errorCode: "provider" };
      const { feedback } = withModelNotes({ raw: parsed.data, rules: input.rules, question: input.question, answer: input.answer, cvText: input.cvText });
      return { status: "completed", value: feedback };
    },
  );
}

/**
 * Feedback first, then the save. A repeat of the same attempt returns what was saved and doesn't ask the provider twice.
 * If the save fails the student still gets the feedback they asked for, and is told it wasn't kept.
 */
export async function submitPracticeFlow(repo: Repo, input: SubmitInput, provider: PracticeProvider | null = null): Promise<SubmitResult> {
  const answer = storable(input.answer);
  if (answer.length < ANSWER_MIN) return { error: `Write at least ${ANSWER_MIN} characters so there's something to give feedback on.` };
  if (answer.length > ANSWER_MAX) return { error: `That's longer than we can take. Keep it under ${ANSWER_MAX} characters.` };

  const already = (await repo.practiceAnswers({ attemptKey: input.attemptKey }))[0];
  if (already) return { feedback: already.feedback, answerId: already.id, saved: true };

  const objective = objectiveOf(input.objective);
  let question: PracticeQuestion | undefined;
  let cvText: string | null = null;
  let context = "";
  let record: Pick<Parameters<Repo["savePracticeAnswer"]>[0], "applicationId" | "mode" | "roleLabel" | "documentReportId" | "documentVersion" | "documentLabel" | "advertReportId" | "advertVersion">;
  if (input.applicationId) {
    const g = await resolveGrounding(repo, input.applicationId);
    if (g.state === "not-found") return { error: NOT_FOUND };
    if (g.state !== "ready") return { error: SESSION_NOTE, conflict: true };
    question = g.questions.find((q) => q.id === input.questionId);
    cvText = g.document.text;
    context = [g.advertText ?? "", g.application.role, g.application.org].join("\n");
    record = { applicationId: g.application.id, mode: "application", roleLabel: `${g.application.role} · ${g.application.org}`, documentReportId: g.document.reportId, documentVersion: g.document.version, documentLabel: g.document.label, advertReportId: g.advert?.reportId ?? null, advertVersion: g.advert?.version ?? null };
  } else {
    const sector = INTERVIEW_SECTORS.includes(input.sector) ? input.sector : "";
    question = generalQuestions(sector).find((q) => q.id === input.questionId);
    record = { applicationId: null, mode: "general", roleLabel: null, documentReportId: null, documentVersion: null, documentLabel: null, advertReportId: null, advertVersion: null };
  }
  if (!question) return { error: SESSION_NOTE, conflict: true };

  const rules = practiceFeedback({ question, answer, cvText, context });
  const feedback = provider ? await modelPass(repo, provider, { key: input.attemptKey, question, answer, cvText, rules }).catch(() => rules) : rules;

  try {
    const saved = await repo.savePracticeAnswer({ ...record, attemptKey: input.attemptKey, objective, question, answer, feedback });
    return { feedback: saved.feedback, answerId: saved.id, saved: true };
  } catch (e) {
    if (e instanceof PracticeRefusedError) log("warn", "practice-save-refused", { reason: e.message });
    else log("error", "practice-save-failed", { error: e });
    return { feedback, saved: false, error: "Your feedback is below, but your answer wasn't saved. Copy it if you want to keep it, then try again." };
  }
}

export async function deleteAnswerFlow(repo: Repo, id: string): Promise<{ error?: string }> {
  try {
    // Already gone is what was asked for: a double click, or a second tab.
    await repo.deletePracticeAnswer(id);
    return {};
  } catch (e) {
    log("error", "practice-delete-failed", { error: e });
    return { error: "That wasn't deleted. Try again." };
  }
}

export { questionsFor };
export type { PracticeAnswer };
