"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { aiEnabled, aiExtractRequirements, aiTailorCv } from "@/lib/ai";
import { runAnalysisJob } from "@/lib/analysis-job";
import { linkNewReport } from "@/lib/applications/flow";
import { sha256 } from "@/lib/analysis/fingerprint";
import { JOB_POLICY } from "@/lib/analysis/job-state";
import { guessJobTitle, htmlToText } from "@/lib/analysis/job";
import { extractWithAdapter } from "@/lib/analysis/job-requirements";
import type { Repo } from "@/lib/repo/types";
import { acceptClearFlow, decideFlow, ownLineFlow, reopenFlow, rejectFlow, restoreFlow, retainPlaceholdersFlow, setInterpretationFlow, tailorFlow, toggleKeywordFlow, undoFlow, type Attempt, type FlowResult } from "@/lib/tailor-flow";
import { buildTailorPayload } from "@/lib/services";
import { fetchPublicText, UnsafeUrlError } from "@/lib/safe-fetch";
import { hit, TOO_MANY } from "@/lib/rate-limit";
import { getRepo } from "@/lib/session";
import type { CvReviewPayload } from "@/lib/types";

async function fetchJobAd(raw: string) {
  let html: string;
  try {
    // Job boards such as Lever put the structured job posting near the end of a large page.
    html = await fetchPublicText(raw, { maxBytes: 1_500_000 });
  } catch (e) {
    if (e instanceof UnsafeUrlError) throw new Error("We can only read public job ad web pages. Paste the job ad text instead.");
    throw new Error("We couldn't open that link. Paste the job ad text instead.");
  }
  const out = htmlToText(html);
  if (out.text.length < 200) throw new Error("That page didn't have much text we could read. Paste the job ad text instead.");
  return out;
}

export async function createTailor(formData: FormData): Promise<{ id?: string; error?: string }> {
  const repo = await getRepo();
  if (!repo) return { error: "Your session has expired. Sign in again." };
  const cvReportId = String(formData.get("cvReportId") ?? "");
  const opportunityId = String(formData.get("opportunityId") ?? "");
  const url = String(formData.get("url") ?? "").trim();
  let text = String(formData.get("text") ?? "").trim();
  let title = String(formData.get("title") ?? "").trim();
  let employer = String(formData.get("employer") ?? "").trim();
  let deadline: string | null = null;

  const cv = cvReportId ? await repo.getReport<CvReviewPayload>(cvReportId) : await repo.latestReport<CvReviewPayload>("cv_review");
  if (!cv) return { error: "Upload a CV first, then tailor it to a job." };

  if (opportunityId) {
    const opp = (await repo.opportunities()).find((o) => o.id === opportunityId);
    if (!opp) return { error: "We couldn't find that role." };
    text = opp.description;
    title = opp.role;
    employer = opp.org;
    deadline = opp.closesOn;
  } else if (!text && url) {
    if (!(await hit("linkFetchPerUser", repo.userId))) return { error: TOO_MANY };
    try {
      const page = await fetchJobAd(url);
      text = page.text;
      if (!title && page.title) title = page.title;
      if (!employer && page.employer) employer = page.employer;
      deadline = page.deadline;
    } catch (e) {
      return { error: (e as Error).message };
    }
  }
  if (text.length < 80) return { error: "Add the job ad: paste a link or at least a few lines of the description." };
  if (text.length > 15000) text = text.slice(0, 15000);
  title = (title || guessJobTitle(text)).slice(0, 120);
  employer = (employer || "the employer").slice(0, 80);

  // Rules first. The provider is only asked when they left the advert undecided, and whatever it returns is checked against the advert.
  const adText = text;
  // A second click on the same CV and advert, while the first runs or just after, finds the first.
  return runAnalysisJob<{ id?: string; error?: string }>(
    repo,
    { workflow: "tailor_create", key: sha256(JSON.stringify([cv.row.id, title, employer, url, deadline, adText])), freshSeconds: JOB_POLICY.repeatWindowSeconds, replay: async (j) => (j.resultId ? { id: j.resultId } : null), refuse: (error) => ({ error }) },
    async (run) => {
      let asked = false;
      const requirements = await extractWithAdapter(
        adText,
        aiEnabled()
          ? async () => {
              if (!(await run.charge("tailor")).allowed) return null;
              asked = true;
              return aiExtractRequirements(adText);
            }
          : undefined,
      );
      const payload = buildTailorPayload({ cvReportId: cv.row.id, cvFileName: cv.payload.fileName, cvText: cv.payload.text, jobTitle: title, employer, jobUrl: url || null, jobText: text, deadline, requirements });
      const id = await repo.createReport({ type: "tailor", title: `${title} · ${employer}`, score: payload.matchNow, payload });
      if (opportunityId) await linkNewReport(repo, opportunityId, id);
      revalidatePath("/dashboard");
      // The report is complete on the rules' reading. A provider that failed gives its use back; the report records "failed" as the adapter's status.
      return requirements.status === "failed" ? { status: "partial", value: { id }, resultId: id, errorCode: asked ? "provider" : "quota", release: asked } : { status: "completed", value: { id }, resultId: id };
    },
  );
}

const EXPIRED = "Your session has expired. Sign in again.";
const Id = z.string().min(1).max(80);
const AttemptInput = z.object({ key: z.string().regex(/^[\w-]{16,64}$/).optional(), revision: z.number().int().min(0).nullable().optional() }).catch({});
const Confirmed = z.array(z.string().max(200)).max(50).catch([]);

async function run(repo: Repo | null, reportId: string, fn: (repo: Repo, id: string) => Promise<FlowResult>): Promise<FlowResult> {
  if (!repo) return { error: EXPIRED };
  const id = Id.safeParse(reportId);
  if (!id.success) return { error: "We couldn't find that report." };
  const out = await fn(repo, id.data);
  if (!out.error) revalidatePath(`/tailor/${id.data}`);
  return out;
}

export async function toggleKeyword(reportId: string, word: string): Promise<FlowResult> {
  return run(await getRepo(), reportId, (repo, id) => toggleKeywordFlow(repo, id, z.string().max(200).catch("").parse(word)));
}

export async function createTailoredVersion(reportId: string, attempt?: Attempt): Promise<FlowResult> {
  return run(await getRepo(), reportId, (repo, id) => tailorFlow(repo, id, aiEnabled() ? (input) => aiTailorCv(input) : null, AttemptInput.parse(attempt ?? {})));
}

export async function decideSuggestion(reportId: string, input: { suggestionId: string; text: string | null; confirmed: string[] }, attempt?: Attempt): Promise<FlowResult> {
  return run(await getRepo(), reportId, (repo, id) =>
    decideFlow(repo, id, { suggestionId: z.string().max(80).catch("").parse(input?.suggestionId), text: z.string().max(4_000).nullable().catch(null).parse(input?.text), confirmed: Confirmed.parse(input?.confirmed) }, AttemptInput.parse(attempt ?? {})),
  );
}

export async function acceptClearSuggestions(reportId: string, attempt?: Attempt): Promise<FlowResult> {
  return run(await getRepo(), reportId, (repo, id) => acceptClearFlow(repo, id, AttemptInput.parse(attempt ?? {})));
}

export async function rejectSuggestion(reportId: string, suggestionId: string, attempt?: Attempt): Promise<FlowResult> {
  return run(await getRepo(), reportId, (repo, id) => rejectFlow(repo, id, z.string().max(80).catch("").parse(suggestionId), AttemptInput.parse(attempt ?? {})));
}

export async function reopenSuggestion(reportId: string, suggestionId: string, attempt?: Attempt): Promise<FlowResult> {
  return run(await getRepo(), reportId, (repo, id) => reopenFlow(repo, id, z.string().max(80).catch("").parse(suggestionId), AttemptInput.parse(attempt ?? {})));
}

export async function saveOwnLine(reportId: string, input: { lineIndex: number; asNewLine: boolean; text: string; confirmed: string[] }, attempt?: Attempt): Promise<FlowResult> {
  const parsed = z.object({ lineIndex: z.number().int().min(0).max(1_000), asNewLine: z.boolean(), text: z.string().max(4_000), confirmed: Confirmed }).safeParse(input);
  if (!parsed.success) return { error: "That version is too short or too long to save." };
  return run(await getRepo(), reportId, (repo, id) => ownLineFlow(repo, id, parsed.data, AttemptInput.parse(attempt ?? {})));
}

export async function undoTailorEdit(reportId: string, attempt?: Attempt): Promise<FlowResult> {
  return run(await getRepo(), reportId, (repo, id) => undoFlow(repo, id, AttemptInput.parse(attempt ?? {})));
}

export async function restoreTailorVersion(reportId: string, versionId: string, attempt?: Attempt): Promise<FlowResult> {
  return run(await getRepo(), reportId, (repo, id) => restoreFlow(repo, id, z.string().max(20).catch("").parse(versionId), AttemptInput.parse(attempt ?? {})));
}

export async function retainPlaceholders(reportId: string, attempt?: Attempt): Promise<FlowResult> {
  return run(await getRepo(), reportId, (repo, id) => retainPlaceholdersFlow(repo, id, AttemptInput.parse(attempt ?? {})));
}

export async function setRequirementInterpretation(reportId: string, requirementId: string, on: boolean, note: string | null, attempt?: Attempt): Promise<FlowResult> {
  return run(await getRepo(), reportId, (repo, id) => setInterpretationFlow(repo, id, z.string().max(120).catch("").parse(requirementId), on === true, z.string().max(300).nullable().catch(null).parse(note), AttemptInput.parse(attempt ?? {})));
}

export async function trackOpportunity(opportunityId: string, on: boolean): Promise<{ error?: string }> {
  const repo = await getRepo();
  if (!repo) return { error: "Your session has expired. Sign in again." };
  z.string().min(1).parse(opportunityId);
  if (on) await repo.track(opportunityId);
  else await repo.untrack(opportunityId);
  revalidatePath("/opportunities");
  revalidatePath("/dashboard");
  return {};
}

export async function moveApplication(applicationId: string, status: string): Promise<{ error?: string }> {
  const repo = await getRepo();
  if (!repo) return { error: "Your session has expired. Sign in again." };
  const s = z.enum(["saved", "applied", "tests", "interview", "offer"]).safeParse(status);
  if (!s.success) return { error: "Unknown status." };
  await repo.setApplicationStatus(applicationId, s.data);
  revalidatePath("/opportunities");
  revalidatePath("/dashboard");
  return {};
}
