"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { aiEnabled, aiExtractRequirements, aiTailorCv } from "@/lib/ai";
import { displayTerm, guessJobTitle, htmlToText, isToolTerm, jobKeywords, matchScores } from "@/lib/analysis/job";
import { remeasure } from "@/lib/analysis/job-match";
import { extractWithAdapter } from "@/lib/analysis/job-requirements";
import { buildTailoredCv, checkTailorDraft } from "@/lib/analysis/tailor";
import { AI_LIMITS } from "@/lib/repo/types";
import { buildTailorPayload } from "@/lib/services";
import { fetchPublicText, UnsafeUrlError } from "@/lib/safe-fetch";
import { hit, TOO_MANY } from "@/lib/rate-limit";
import { getRepo } from "@/lib/session";
import type { CvReviewPayload, TailorPayload } from "@/lib/types";

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
  const requirements = await extractWithAdapter(adText, aiEnabled() ? async () => ((await repo.bumpAi("tailor")) <= AI_LIMITS.tailor ? aiExtractRequirements(adText) : null) : undefined);
  const payload = buildTailorPayload({ cvReportId: cv.row.id, cvFileName: cv.payload.fileName, cvText: cv.payload.text, jobTitle: title, employer, jobUrl: url || null, jobText: text, deadline, requirements });
  const id = await repo.createReport({ type: "tailor", title: `${title} · ${employer}`, score: payload.matchNow, payload });
  revalidatePath("/dashboard");
  return { id };
}

export async function toggleKeyword(reportId: string, word: string): Promise<{ error?: string }> {
  const repo = await getRepo();
  if (!repo) return { error: "Your session has expired. Sign in again." };
  const r = await repo.getReport<TailorPayload>(reportId);
  if (!r || !r.payload.keywords.some((k) => k.w === word)) return { error: "We couldn't find that keyword." };
  const added = r.payload.added.includes(word) ? r.payload.added.filter((w) => w !== word) : [...r.payload.added, word];
  r.payload.added = added;
  r.payload.tailored = null;
  r.payload.tailoredCv = null;
  // A choice about what to work on, not evidence: no score moves until an actual revised CV is measured.
  await repo.updateReport(reportId, { payload: r.payload });
  revalidatePath(`/tailor/${reportId}`);
  return {};
}

export async function createTailoredVersion(reportId: string): Promise<{ error?: string; ai?: boolean }> {
  const repo = await getRepo();
  if (!repo) return { error: "Your session has expired. Sign in again." };
  const r = await repo.getReport<TailorPayload>(reportId);
  if (!r) return { error: "We couldn't find that report." };
  const cv = await repo.getReport<CvReviewPayload>(r.payload.cvReportId);
  if (!cv) return { error: "The CV for this report has been deleted." };
  const p = r.payload;
  const lines = cv.payload.analysis.lines;
  const current = (i: number) => lines[i].accepted ?? lines[i].text;

  // Claude first, within the daily limit; the rule-based version below is the fallback.
  if (aiEnabled() && (await repo.bumpAi("tailor")) <= AI_LIMITS.tailor) {
    const draft = await aiTailorCv({
      jobTitle: p.jobTitle,
      employer: p.employer,
      jobText: p.jobText,
      cvText: cv.payload.text,
      lines: lines.map((l, i) => ({ id: i, where: l.where, text: current(i) })),
      keywords: p.added,
    });
    const checked = draft && checkTailorDraft(draft, lines.map((_, i) => ({ text: current(i) })), cv.payload.text);
    if (checked && (checked.bullets.length || checked.summary)) {
      const tailoredCv = buildTailoredCv(cv.payload.text, {
        summary: checked.summary,
        replacements: checked.bullets.map((b) => ({ from: lines[b.id].text, to: b.after })),
        skills: checked.skills,
      });
      p.tailored = checked.bullets.sort((a, b) => a.id - b.id).map((b) => ({ where: lines[b.id].where, before: current(b.id), after: b.after, keywords: b.keywords }));
      p.summary = checked.summary || null;
      p.skillsToAdd = checked.skills;
      p.notEvidenced = checked.notEvidenced;
      p.tailoredCv = tailoredCv;
      p.aiTailored = true;
      // Measured, not estimated. An older report stays on its own scale, so it still compares with its saved number.
      p.matchTailored = p.jobMatch ? remeasure(p.jobMatch, p.jobText, tailoredCv).coverage.score : Math.max(p.matchNow ?? 0, matchScores(jobKeywords(p.jobText, tailoredCv)).now);
      await repo.updateReport(reportId, { payload: p });
      revalidatePath(`/tailor/${reportId}`);
      return { ai: true };
    }
  }

  const targets = p.added.length ? p.keywords.filter((k) => p.added.includes(k.w)) : p.keywords.filter((k) => k.must && !k.inCv);
  if (!targets.length) return { error: p.jobMatch ? "Pick at least one requirement to include first." : "Pick at least one keyword to add first." };
  const used = new Set<number>();
  const tailored: { where: string; before: string; after: string }[] = [];
  const skills: string[] = [];
  for (const k of targets) {
    if (k.where === "Skills section") {
      skills.push(k.w);
      continue;
    }
    const roleWord = k.where.replace(/ role$/, "").toUpperCase().split(/\s+/)[0];
    let i = lines.findIndex((l, idx) => !used.has(idx) && l.where.includes(roleWord));
    if (i < 0) i = lines.findIndex((_, idx) => !used.has(idx));
    if (i < 0) {
      skills.push(k.w);
      continue;
    }
    used.add(i);
    const base = current(i).replace(/\.$/, "");
    tailored.push({ where: lines[i].where, before: current(i), after: `${base}, ${weave(k.w, p.jobMatch?.requirements.find((q) => q.label === k.w)?.kind === "tool")}.` });
  }
  if (skills.length) tailored.push({ where: "SKILLS", before: "Your current skills list", after: `Add to skills: ${skills.join(", ")}` });

  p.tailored = tailored;
  p.summary = null;
  p.skillsToAdd = [];
  p.notEvidenced = [];
  p.tailoredCv = null;
  p.aiTailored = false;
  // These are suggestions, not a revised document, so there is nothing new to measure and no score changes.
  await repo.updateReport(reportId, { payload: p });
  revalidatePath(`/tailor/${reportId}`);
  return { ai: false };
}

/** Phrase that works a keyword into the end of an existing bullet. */
function weave(word: string, namedTool = false): string {
  if (/^stakeholder$/i.test(word)) return "working closely with stakeholders";
  if (namedTool || isToolTerm(word)) return `using ${word}`;
  return `drawing on my ${displayTerm(word)} skills`;
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
  return {};
}
