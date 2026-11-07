"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { aiEnabled, aiLinkedinSuggest } from "@/lib/ai";
import { friendlyFailure } from "@/lib/analysis-job";
import { ExportError, readLinkedinExport } from "@/lib/analysis/linkedin-export";
import { AIM_LIMIT, cleanSection, isOnlyLinks, readPastedSections } from "@/lib/analysis/linkedin-input";
import { acceptSuggestionFlow, aiSuggestFlow, createLinkedinFlow, linkedinChoiceFlow, reassessFlow, rejectSuggestionFlow, saveSectionFlow, undoSectionFlow, type Attempt, type FlowResult } from "@/lib/linkedin-flow";
import { LINKEDIN_SECTIONS, type LinkedinSectionKey, type LinkedinSource } from "@/lib/linkedin-types";
import { hit, TOO_MANY } from "@/lib/rate-limit";
import { getRepo } from "@/lib/session";

const EXPIRED: FlowResult = { error: "Your session has expired. Sign in again." };
const BAD: FlowResult = { error: "We couldn't do that. Reload the page and try again." };
const Section = z.enum(LINKEDIN_SECTIONS);
const ClientKey = z.string().regex(/^[\w-]{16,64}$/);
const Id = z.string().min(1).max(64);
const Short = z.string().min(1).max(320);
const Confirmed = z.array(z.string().max(400)).max(60);
const AttemptSchema = z.object({ revision: z.number().int().min(0).nullable().optional(), key: ClientKey.optional() });

const refuse = (error: string): FlowResult => ({ error });

type SignedIn = NonNullable<Awaited<ReturnType<typeof getRepo>>>;

/** Within the limit, with a well-formed request. The action has checked the session; ownership is checked where the report is read. */
async function edit(repo: SignedIn, id: unknown, key: unknown, attempt: unknown, run: (id: string, key: LinkedinSectionKey, attempt: Attempt) => Promise<FlowResult>): Promise<FlowResult> {
  const parsed = z.object({ id: Id, key: Section, attempt: AttemptSchema }).safeParse({ id, key, attempt: attempt ?? {} });
  if (!parsed.success) return BAD;
  if (!(await hit("linkedinEditPerUser", repo.userId))) return { error: TOO_MANY };
  const out = await friendlyFailure(() => run(parsed.data.id, parsed.data.key, parsed.data.attempt), refuse);
  if (!out.error && !out.confirm) revalidatePath(`/linkedin/${parsed.data.id}`);
  return out;
}

export async function createLinkedinReview(formData: FormData): Promise<FlowResult> {
  const repo = await getRepo();
  if (!repo) return EXPIRED;
  if (!(await hit("aiWritePerUser", repo.userId))) return { error: TOO_MANY };
  const method = formData.get("method") === "export" ? "export" : "paste";
  const rawAim = cleanSection(String(formData.get("aim") ?? ""));
  if (rawAim.length > AIM_LIMIT) return { error: `Keep your career aim under ${AIM_LIMIT} characters.` };
  const aim = rawAim && !isOnlyLinks(rawAim) ? rawAim : null;
  const cvReportId = String(formData.get("cvReportId") ?? "");
  const client = ClientKey.safeParse(formData.get("key"));

  let sections: Record<LinkedinSectionKey, string>;
  let source: LinkedinSource;
  if (method === "export") {
    const uploads = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    try {
      const read = await readLinkedinExport(await Promise.all(uploads.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
      sections = read.sections;
      source = { method, files: read.files, skippedFiles: read.skippedFiles, linksIgnored: [] as LinkedinSectionKey[] };
    } catch (e) {
      if (e instanceof ExportError) return { error: e.message };
      return { error: "We couldn't read that export. Try pasting your sections instead." };
    }
  } else {
    const read = readPastedSections((k) => String(formData.get(k) ?? ""));
    if ("error" in read) return read;
    sections = read.sections;
    source = { method, files: [] as string[], skippedFiles: 0, linksIgnored: read.linksIgnored };
  }
  const out = await friendlyFailure(() => createLinkedinFlow(repo, { sections, source, aim, cvReportId: cvReportId && cvReportId !== "none" ? cvReportId : null, key: client.success ? client.data : null }), refuse);
  if (out.id) revalidatePath("/dashboard");
  return out;
}

export async function saveLinkedinSection(id: string, key: string, text: string, confirmed: string[] = [], attempt: Attempt = {}): Promise<FlowResult> {
  const repo = await getRepo();
  if (!repo) return EXPIRED;
  const c = Confirmed.safeParse(confirmed);
  if (typeof text !== "string" || !c.success) return BAD;
  return edit(repo, id, key, attempt, (i, k, a) => saveSectionFlow(repo, i, k, text, c.data, a));
}

export async function acceptLinkedinSuggestion(id: string, key: string, suggestionId: string, confirmed: string[] = [], attempt: Attempt = {}): Promise<FlowResult> {
  const repo = await getRepo();
  if (!repo) return EXPIRED;
  const c = Confirmed.safeParse(confirmed);
  if (!Short.safeParse(suggestionId).success || !c.success) return BAD;
  return edit(repo, id, key, attempt, (i, k, a) => acceptSuggestionFlow(repo, i, k, suggestionId, c.data, a));
}

export async function rejectLinkedinSuggestion(id: string, key: string, suggestionId: string, attempt: Attempt = {}): Promise<FlowResult> {
  const repo = await getRepo();
  if (!repo) return EXPIRED;
  if (!Short.safeParse(suggestionId).success) return BAD;
  return edit(repo, id, key, attempt, (i, k, a) => rejectSuggestionFlow(repo, i, k, suggestionId, a));
}

export async function undoLinkedinSection(id: string, key: string, attempt: Attempt = {}): Promise<FlowResult> {
  const repo = await getRepo();
  if (!repo) return EXPIRED;
  return edit(repo, id, key, attempt, (i, k, a) => undoSectionFlow(repo, i, k, a));
}

export async function reassessLinkedinSection(id: string, key: string, attempt: Attempt = {}): Promise<FlowResult> {
  const repo = await getRepo();
  if (!repo) return EXPIRED;
  return edit(repo, id, key, attempt, (i, k, a) => reassessFlow(repo, i, k, a));
}

export async function setLinkedinFinding(id: string, key: string, kind: "dismiss" | "reopen", findingId: string, attempt: Attempt = {}): Promise<FlowResult> {
  const repo = await getRepo();
  if (!repo) return EXPIRED;
  if ((kind !== "dismiss" && kind !== "reopen") || !Short.safeParse(findingId).success) return BAD;
  return edit(repo, id, key, attempt, (i, k, a) => linkedinChoiceFlow(repo, i, k, kind, findingId, a));
}

export async function suggestLinkedinWithAi(id: string, key: string, attempt: Attempt = {}): Promise<FlowResult> {
  const repo = await getRepo();
  if (!repo) return EXPIRED;
  return edit(repo, id, key, attempt, (i, k, a) => aiSuggestFlow(repo, i, k, aiEnabled() ? aiLinkedinSuggest : null, a));
}
