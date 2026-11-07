import "server-only";
import { z } from "zod";
import { runAnalysisJob } from "@/lib/analysis-job";
import { type ClaimInventory, withoutInstructions } from "@/lib/analysis/claims";
import { documentVersion } from "@/lib/analysis/findings";
import { sha256 } from "@/lib/analysis/fingerprint";
import { JOB_POLICY } from "@/lib/analysis/job-state";
import { assessSection, contextFor } from "@/lib/analysis/linkedin-assess";
import { checkSectionText, currentVersion, inventoryFor, isUnresolvedBlank, linesOf, profileAsSource, sectionOf } from "@/lib/analysis/linkedin-check";
import { addVersion, applySuggestion, MAX_ASSESSMENTS, newSection, openSuggestions, undoSection } from "@/lib/analysis/linkedin-edits";
import { cleanSection, LINK_ONLY_ERROR, SECTION_LIMIT } from "@/lib/analysis/linkedin-input";
import { offerCandidates, ruleCandidates, type Candidate } from "@/lib/analysis/linkedin-suggest";
import { proofreadCv } from "@/lib/analysis/proofreading/run";
import { factsFromCheck, type RewriteCheck } from "@/lib/analysis/rewrite-check";
import { baseDocument } from "@/lib/analysis/tailor-edits";
import { LINKEDIN_SECTIONS, type LinkedinPayload, type LinkedinSection, type LinkedinSectionKey, type LinkedinSource } from "@/lib/linkedin-types";
import { ReportConflictError, type Repo } from "@/lib/repo/types";
import { PAYLOAD_VERSION, type CvReviewPayload, type ProofreadingLanguage } from "@/lib/types";

// OP-018: the logic behind the LinkedIn actions, with the provider injected. Every write reads the student's own report
// with their session, changes it and saves it only if nothing has been saved since. Nothing in this file, or in the
// modules it uses, opens a link or talks to LinkedIn.

export interface FlowResult {
  id?: string;
  error?: string;
  conflict?: boolean;
  /** Named things to tick before this can be saved. Nothing was saved. */
  confirm?: { key: string; message: string }[];
  ai?: boolean;
}

export interface Attempt {
  /** The revision the student's page was showing. */
  revision?: number | null;
  key?: string;
}

const NOT_FOUND = "We couldn't find that LinkedIn review.";
const CONFLICT = "This review changed in another tab. Reload the page to see the latest version, then try again.";
const BLANK = "Fill in the blanks in square brackets first, using only what's true.";
const WRITE_TRIES = 3;
const KEEP_ATTEMPTS = 40;
const nowIso = () => new Date().toISOString();

type Report = { row: { id: string; type: string }; payload: LinkedinPayload };

export async function readLinkedin(repo: Repo, id: string): Promise<Report | null> {
  const r = await repo.getReport<LinkedinPayload>(id);
  return r && r.row.type === "linkedin" ? (r as Report) : null;
}

/** The chosen CV as it stands, including lines saved in its review. Null text if none was chosen or it's gone. */
export async function cvFor(repo: Repo, p: Pick<LinkedinPayload, "cv">): Promise<{ text: string | null; gone: boolean; changed: boolean }> {
  if (!p.cv) return { text: null, gone: false, changed: false };
  const r = await repo.getReport<CvReviewPayload>(p.cv.reportId);
  if (!r || r.row.type !== "cv_review") return { text: null, gone: true, changed: false };
  const base = baseDocument(r.payload);
  return { text: base.text, gone: false, changed: base.version !== p.cv.documentVersion };
}

async function write(repo: Repo, id: string, attempt: Attempt, change: (p: LinkedinPayload) => Promise<FlowResult | void> | FlowResult | void): Promise<FlowResult> {
  for (let i = 0; i < WRITE_TRIES; i++) {
    const r = await readLinkedin(repo, id);
    if (!r) return { error: NOT_FOUND };
    if (attempt.key && (r.payload.attempts ?? []).includes(attempt.key)) return {};
    const before = r.payload.editRevision ?? null;
    if (attempt.revision !== undefined && before !== attempt.revision) return { error: CONFLICT, conflict: true };
    const out = await change(r.payload);
    if (out?.error || out?.confirm) return out;
    r.payload.editRevision = (before ?? 0) + 1;
    if (attempt.key) r.payload.attempts = [...(r.payload.attempts ?? []), attempt.key].slice(-KEEP_ATTEMPTS);
    try {
      await repo.updateReport(id, { payload: r.payload }, { ifRevision: before });
      return out ?? {};
    } catch (e) {
      if (!(e instanceof ReportConflictError)) throw e;
    }
  }
  return { error: CONFLICT, conflict: true };
}

const replace = (p: LinkedinPayload, next: LinkedinSection) => {
  p.sections = p.sections.map((s) => (s.key === next.key ? next : s));
};

/* ---------- Feedback ---------- */

async function proofread(repo: Repo, text: string) {
  let language: ProofreadingLanguage | null = null;
  try {
    language = await repo.proofreadingLanguagePreference();
  } catch {
    // Scoring carries on with the default if the preference can't be read; so does this.
  }
  return proofreadCv(text, process.env, language);
}

/** Feedback and fresh rule suggestions for a section's current words. Undecided rule suggestions for earlier words go. */
async function reassess(repo: Repo, p: LinkedinPayload, key: LinkedinSectionKey, cvText: string | null, inv: ClaimInventory, at: string): Promise<void> {
  const s = sectionOf(p, key);
  const v = currentVersion(s);
  const assessment = assessSection(key, v.text, contextFor(p, cvText), v.text.trim() ? await proofread(repo, v.text) : null, at);
  const offered = offerCandidates(p, inv, key, ruleCandidates(p, key, cvText), "rules", at);
  const decided = new Set([...v.accepted, ...s.rejected.map((r) => r.suggestionId)]);
  const kept = s.suggestions.filter((x) => x.method === "ai" || decided.has(x.id));
  const fresh = offered.suggestions.filter((x) => !kept.some((k) => k.id === x.id));
  replace(p, {
    ...s,
    assessments: [...s.assessments.filter((a) => a.assessment.documentVersion !== v.documentVersion), assessment].slice(-MAX_ASSESSMENTS),
    suggestions: [...kept, ...fresh],
    withheld: offered.withheld,
  });
}

/* ---------- Starting a review ---------- */

export interface CreateInput {
  sections: Record<LinkedinSectionKey, string>;
  source: LinkedinSource;
  aim: string | null;
  cvReportId: string | null;
  /** The client's key for one attempt: a double click finds the first report instead of making a second. */
  key: string | null;
}

export async function createLinkedinFlow(repo: Repo, input: CreateInput): Promise<FlowResult> {
  const anyText = LINKEDIN_SECTIONS.some((k) => input.sections[k].trim());
  let cv: LinkedinPayload["cv"] = null;
  let cvText: string | null = null;
  if (input.cvReportId) {
    const r = await repo.getReport<CvReviewPayload>(input.cvReportId);
    // The same answer for someone else's report as for one that doesn't exist.
    if (!r || r.row.type !== "cv_review") return { error: "We couldn't find that CV." };
    const base = baseDocument(r.payload);
    cvText = base.text;
    cv = { reportId: r.row.id, fileName: r.row.title, documentVersion: base.version };
  }
  if (!anyText && !cv) return { error: input.source.linksIgnored.length ? LINK_ONLY_ERROR : "Paste at least one section, upload an export, or choose a CV to start from." };

  const hash = sha256(JSON.stringify([input.sections, input.aim, input.cvReportId, input.source.method]));
  const key = input.key ? `${hash}:${input.key}` : hash;
  return runAnalysisJob<FlowResult>(
    repo,
    { workflow: "linkedin_create", key, freshSeconds: input.key ? null : JOB_POLICY.repeatWindowSeconds, replay: async (job) => (job.resultId ? { id: job.resultId } : null), refuse: (error) => ({ error }) },
    async () => {
      const at = nowIso();
      const p: LinkedinPayload = { payloadVersion: PAYLOAD_VERSION, source: input.source, aim: input.aim, cv, sections: LINKEDIN_SECTIONS.map((k) => newSection(k, input.sections[k], at)), aiAssisted: false };
      const inv = inventoryFor(p, cvText);
      for (const k of LINKEDIN_SECTIONS) await reassess(repo, p, k, cvText, inv, at);
      const id = await repo.createReport({ type: "linkedin", title: input.aim ? `Profile review: ${input.aim}` : "Profile review", score: null, payload: p });
      return { status: "completed", value: { id }, resultId: id };
    },
  );
}

/* ---------- Decisions ---------- */

function factsFor(check: RewriteCheck, confirmed: string[], p: LinkedinPayload, reportId: string, key: LinkedinSectionKey, text: string, how: "typed" | "confirmed-suggestion", at: string) {
  const s = sectionOf(p, key);
  return factsFromCheck(check, confirmed, { idPrefix: `${key}:v${s.versions.length + 1}`, quote: text.slice(0, 700), scope: "cv", entryId: null, entryHeading: null, lineText: null, sourceVersion: s.versions[0].documentVersion, reportId, how, at });
}

const needed = (check: RewriteCheck) => check.issues.filter((i) => i.severity === "confirm");
const toConfirm = (check: RewriteCheck) => needed(check).map((i) => ({ key: i.key, message: i.message }));

/** The student's own words for a section. Facts they add are asked about by name, never silently accepted or refused. */
export function saveSectionFlow(repo: Repo, id: string, key: LinkedinSectionKey, raw: string, confirmed: string[], attempt: Attempt = {}): Promise<FlowResult> {
  const text = cleanSection(raw);
  if (text.length > SECTION_LIMIT[key]) return Promise.resolve({ error: "That's longer than we can save for this section. Shorten it and try again." });
  if (isUnresolvedBlank(text)) return Promise.resolve({ error: BLANK });
  return write(repo, id, attempt, async (p) => {
    const s = sectionOf(p, key);
    if (currentVersion(s).text === text) return { error: "That's the same as the saved text, so there's nothing new to save." };
    const cv = await cvFor(repo, p);
    const check = checkSectionText(p, inventoryFor(p, cv.text), key, text, { typed: true });
    if (check.verdict === "block") return { error: check.issues.find((i) => i.severity === "block")?.message ?? "We can't save that." };
    if (needed(check).some((i) => !confirmed.includes(i.key))) return { confirm: toConfirm(check) };
    const at = nowIso();
    const next = addVersion(s, { action: "typed", label: "Your edit", text, confirmed: needed(check).map((i) => i.key), facts: factsFor(check, confirmed, p, id, key, text, "typed", at), at });
    if ("error" in next) return next;
    replace(p, next);
  });
}

/** Keeps a suggestion. The check runs again here, on the server, whatever the page showed. */
export function acceptSuggestionFlow(repo: Repo, id: string, key: LinkedinSectionKey, suggestionId: string, confirmed: string[], attempt: Attempt = {}): Promise<FlowResult> {
  return write(repo, id, attempt, async (p) => {
    const s = sectionOf(p, key);
    const suggestion = openSuggestions(s).find((x) => x.id === suggestionId);
    if (!suggestion) return { error: "That suggestion is no longer available. Reassess this section for new ones." };
    if (isUnresolvedBlank(suggestion.after)) return { error: BLANK };
    const current = currentVersion(s);
    const text = applySuggestion(current.text, suggestion);
    if (text === null) return { error: "That suggestion no longer matches this section." };
    const cv = await cvFor(repo, p);
    const check = suggestion.after ? checkSectionText(p, inventoryFor(p, cv.text), key, suggestion.after, { before: suggestion.before }) : null;
    if (check?.verdict === "block") return { error: check.issues.find((i) => i.severity === "block")?.message ?? "This suggestion didn't pass our check." };
    if (check && needed(check).some((i) => !confirmed.includes(i.key))) return { confirm: toConfirm(check) };
    const at = nowIso();
    const next = addVersion(s, { action: "accepted", label: "Kept a suggestion", text, suggestionId, confirmed: check ? needed(check).map((i) => i.key) : [], facts: check ? factsFor(check, confirmed, p, id, key, suggestion.after, "confirmed-suggestion", at) : [], at });
    if ("error" in next) return next;
    replace(p, next);
  });
}

export function rejectSuggestionFlow(repo: Repo, id: string, key: LinkedinSectionKey, suggestionId: string, attempt: Attempt = {}): Promise<FlowResult> {
  return write(repo, id, attempt, (p) => {
    const s = sectionOf(p, key);
    if (!openSuggestions(s).some((x) => x.id === suggestionId)) return { error: "That suggestion is no longer available." };
    replace(p, { ...s, rejected: [...s.rejected, { suggestionId, at: nowIso() }] });
  });
}

export function undoSectionFlow(repo: Repo, id: string, key: LinkedinSectionKey, attempt: Attempt = {}): Promise<FlowResult> {
  return write(repo, id, attempt, (p) => {
    const next = undoSection(sectionOf(p, key));
    if ("error" in next) return next;
    replace(p, next);
  });
}

export function reassessFlow(repo: Repo, id: string, key: LinkedinSectionKey, attempt: Attempt = {}): Promise<FlowResult> {
  return write(repo, id, attempt, async (p) => {
    const cv = await cvFor(repo, p);
    await reassess(repo, p, key, cv.text, inventoryFor(p, cv.text), nowIso());
  });
}

/** OP-008's choice, for one section's exact words: changed text starts afresh, and the words stay in the report only. */
export function linkedinChoiceFlow(repo: Repo, id: string, key: LinkedinSectionKey, kind: "dismiss" | "reopen", findingId: string, attempt: Attempt = {}): Promise<FlowResult> {
  return write(repo, id, attempt, (p) => {
    const s = sectionOf(p, key);
    const v = currentVersion(s);
    const finding = s.assessments.find((a) => a.assessment.documentVersion === v.documentVersion)?.proofreading?.findings.find((f) => f.id === findingId);
    if (!finding) return { error: "We couldn't find that suggestion." };
    replace(p, { ...s, choices: [...s.choices, { documentVersion: v.documentVersion, kind, findingId, quote: (finding.evidence[0]?.quote ?? "").slice(0, 200), actor: "student", at: nowIso() }] });
  });
}

/* ---------- AI suggestions: optional, on request, and never unchecked ---------- */

export type LinkedinProvider = (input: { section: string; text: string; aim: string | null; source: string }) => Promise<unknown>;

const Draft = z.object({ suggestions: z.array(z.object({ before: z.string().max(2_000).nullable(), after: z.string().max(6_000), why: z.string().max(300).catch("") })).max(6) }); // a bad explanation is judged later and doesn't sink its suggestion
const NO_NEW = "We couldn't get suggestions that held up against what you gave us. Nothing you've saved has changed. The rule-based advice still applies.";

export async function aiSuggestFlow(repo: Repo, id: string, key: LinkedinSectionKey, provider: LinkedinProvider | null, attempt: Attempt = {}): Promise<FlowResult> {
  if (!provider) return { error: "AI suggestions aren't switched on. All the feedback and suggestions here come from our rules." };
  const first = await readLinkedin(repo, id);
  if (!first) return { error: NOT_FOUND };
  if (attempt.revision !== undefined && (first.payload.editRevision ?? null) !== attempt.revision) return { error: CONFLICT, conflict: true };
  const current = currentVersion(sectionOf(first.payload, key));
  const jobKey = `${id}:${key}:${current.documentVersion}`;
  return runAnalysisJob<FlowResult>(
    repo,
    { workflow: "linkedin_suggest", key: jobKey, freshSeconds: JOB_POLICY.repeatWindowSeconds, replay: async (j) => ({ ai: !!j.result?.ai }), refuse: (error) => ({ error }) },
    async (run) => {
      const charge = await run.charge("linkedin");
      if (!charge.allowed) return { status: "failed", value: { error: "You've used today's AI suggestions for LinkedIn. You can get more tomorrow, and the rule-based advice still applies." }, errorCode: "quota", countFailure: false };
      const cv = await cvFor(repo, first.payload);
      const clean = (t: string) => linesOf(t).map((l) => withoutInstructions(l).text).filter(Boolean).join("\n");
      const originals = LINKEDIN_SECTIONS.map((k) => ({ key: k, text: clean(sectionOf(first.payload, k).versions[0].text) }));
      const raw = await provider({ section: key, text: clean(current.text), aim: first.payload.aim, source: clean([cv.text ?? "", profileAsSource(originals)].join("\n")) }).catch(() => null);
      const parsed = Draft.safeParse(raw);
      if (!parsed.success) return { status: "failed", value: { error: NO_NEW }, errorCode: "provider", result: { ai: false } };
      let usable = 0;
      const out = await write(repo, id, {}, (p) => {
        const s = sectionOf(p, key);
        const v = currentVersion(s);
        const at = nowIso();
        const candidates: Candidate[] = parsed.data.suggestions.filter((c) => c.after.trim() && (c.before === null || applySuggestion(v.text, { before: c.before, after: c.after, basedOn: documentVersion(v.text) }) !== null));
        const offered = offerCandidates(p, inventoryFor(p, cv.text), key, candidates, "ai", at);
        usable = offered.suggestions.length;
        // Nothing is saved, so this message is the only place the student can learn why.
        if (!usable) return { error: offered.withheld[0] ? `${NO_NEW} ${offered.withheld[0]}` : NO_NEW };
        const fresh = offered.suggestions.filter((x) => !s.suggestions.some((k) => k.id === x.id));
        replace(p, { ...s, suggestions: [...s.suggestions, ...fresh], withheld: offered.withheld });
        p.aiAssisted = true;
      });
      if (out.error) return { status: "failed", value: out, errorCode: "provider", result: { ai: false } };
      return { status: "completed", value: { ai: true }, resultId: id, result: { ai: true } };
    },
  );
}
