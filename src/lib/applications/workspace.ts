import { CV_THEMES } from "@/lib/cv-themes";
import { presentedScore, scoreContext } from "@/lib/analysis/coverage";
import { documentVersion } from "@/lib/analysis/findings";
import { possibleMistakes } from "@/lib/analysis/proofreading/view";
import { normaliseText, sha256 } from "@/lib/analysis/fingerprint";
import { currentLetterVersion, letterDocumentOf, letterExport } from "@/lib/analysis/letter-edits";
import { openSuggestions, profileText, sectionsWithBlanks } from "@/lib/analysis/linkedin-edits";
import { currentVersion as currentSectionVersion } from "@/lib/analysis/linkedin-check";
import { comparableScores, seriesFields } from "@/lib/analysis/scoring-contract";
import { baseDocument, currentVersion, documentOf, tailoredExport } from "@/lib/analysis/tailor-edits";
import type { LinkedinPayload } from "@/lib/linkedin-types";
import type { Application, CoverLetterPayload, CvReviewPayload, CvSource, FindingSeverity, FindingStatus, ReportType, TailorDecision, TailorPayload } from "@/lib/types";
import { ARTEFACT_KIND_FOR, type ApplicationLink, type ArtefactDownload, type ArtefactKind, type WorkspaceReport } from "./types";

// OP-019: what the dashboard knows about a student's documents and the roles they belong to, read from saved reports
// and nothing else. Pure, and it keeps no document text, so a summary is safe to hand to a client component.

/** Uncalibrated product judgment: a change below this is not called an improvement, or shown as a change at all. */
export const MEANINGFUL_SCORE_CHANGE = 5;

export interface ArtefactVersion {
  id: string;
  n: number;
  documentVersion: string;
}

export interface ArtefactSummary {
  reportId: string;
  type: ReportType;
  title: string;
  createdAt: string;
  /** False when the saved record couldn't be read. It stays listed, with what the row itself says. */
  readable: boolean;
  role: string | null;
  org: string | null;
  deadline: string | null;
  cvReportId: string | null;
  tailorReportId: string | null;
  /** What the report's latest version hashes to. Null: nothing to download yet. */
  latest: string | null;
  /** Hashes that also count as the latest: a CV with no saved lines is the same words as the file it came from. */
  sameAsLatest: string[];
  /** The selected version, for reports that keep numbered versions. */
  current: { n: number; total: number; id: string; at: string } | null;
  versions: ArtefactVersion[];
  /** Why the latest version can't be downloaded yet. */
  blocked: string | null;
  nothingYet: string | null;
  /** Decisions and lines the student has kept in what is selected now. An undone edit doesn't count. */
  keptEdits: number;
  pending: number;
  /** Set when the document was built on something that has since changed. */
  stale: string | null;
  essentialGaps: string[];
  /** Hash of the normalised text, for CVs: the same CV sent twice has the same value. */
  docKey: string | null;
  score: number | null;
  series: string | null;
  sourceId: string | null;
  fileName: string | null;
  /** What the review found, without its evidence quotes. */
  findings: { id: string; status: FindingStatus; severity: FindingSeverity; confidence: number | null; explanation: string; action: string | null }[];
  /** Likely typos the proofreader raised on this text. Ids and confidence only. */
  possibleMistakes: { id: string; confidence: number | null }[];
  /** sha256 of the assessed text. */
  assessedVersion: string | null;
}

const keptDecisions = (d: Record<string, TailorDecision>) => Object.values(d).filter((x) => x.status !== "rejected" && x.text !== null).length;
const dateOnly = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function blank(r: WorkspaceReport): ArtefactSummary {
  return {
    reportId: r.row.id,
    type: r.row.type,
    title: r.row.title,
    createdAt: r.row.createdAt,
    readable: false,
    role: null,
    org: null,
    deadline: null,
    cvReportId: null,
    tailorReportId: null,
    latest: null,
    sameAsLatest: [],
    current: null,
    versions: [],
    blocked: null,
    nothingYet: null,
    keptEdits: 0,
    pending: 0,
    stale: null,
    essentialGaps: [],
    docKey: null,
    score: null,
    series: null,
    sourceId: r.row.sourceId ?? null,
    fileName: null,
    findings: [],
    possibleMistakes: [],
    assessedVersion: null,
  };
}

function cvSummary(s: ArtefactSummary, p: CvReviewPayload, row: WorkspaceReport["row"]): ArtefactSummary {
  const base = baseDocument(p);
  const saved = p.analysis.lines.filter((l) => l.accepted).length;
  const context = scoreContext(seriesFields(p));
  return {
    ...s,
    readable: true,
    fileName: p.fileName,
    latest: base.version,
    sameAsLatest: saved ? [] : [p.assessment.documentVersion],
    keptEdits: saved,
    docKey: sha256(normaliseText(p.text)),
    score: presentedScore({ score: row.score, scoring: context }),
    series: context.series,
    findings: p.assessment.findings.map((f) => ({ id: f.id, status: f.status, severity: f.severity, confidence: f.confidence, explanation: f.explanation, action: f.action })),
    possibleMistakes: possibleMistakes(p.proofreading).map((f) => ({ id: f.id, confidence: f.confidence })),
    assessedVersion: p.assessment.documentVersion,
  };
}

function tailorSummary(s: ArtefactSummary, p: TailorPayload, cv: CvReviewPayload | null): ArtefactSummary {
  const out = tailoredExport(p);
  const e = p.edits;
  const v = e ? currentVersion(e) : null;
  const common = { ...s, readable: true, role: p.jobTitle, org: p.employer, deadline: dateOnly(p.deadline), cvReportId: p.cvReportId, fileName: p.cvFileName };
  const gone = cv ? null : "The CV this came from is no longer here. What's saved is what was measured at the time.";
  if (!e || !v) {
    return { ...common, latest: out.kind === "ready" || out.kind === "placeholders" ? out.documentVersion : null, blocked: out.kind === "placeholders" ? `Fill or keep ${plural(out.placeholders.length, "blank")} first.` : null, nothingYet: out.kind === "none" ? "Nothing tailored yet." : null, stale: gone, essentialGaps: p.jobMatch?.essentialGaps ?? [] };
  }
  const changed = cv && baseDocument(cv).version !== v.baseVersion ? "You've changed lines in this CV since this was tailored. They aren't in this document." : null;
  return {
    ...common,
    latest: out.kind === "ready" || out.kind === "placeholders" ? out.documentVersion : null,
    current: { n: v.n, total: e.versions.length, id: v.id, at: v.at },
    versions: e.versions.map((x) => ({ id: x.id, n: x.n, documentVersion: x.documentVersion })),
    blocked: out.kind === "placeholders" ? `Fill or keep ${plural(out.placeholders.length, "blank")} first.` : null,
    nothingYet: out.kind === "none" ? "No changes kept yet." : null,
    keptEdits: keptDecisions(v.decisions),
    pending: v.shown.filter((id) => !v.decisions[id]).length,
    stale: gone ?? changed,
    essentialGaps: documentOf(e, v).match.essentialGaps,
  };
}

function letterSummary(s: ArtefactSummary, p: CoverLetterPayload, cv: CvReviewPayload | null): ArtefactSummary {
  const out = letterExport(p);
  const e = p.edits;
  const v = e ? currentLetterVersion(e) : null;
  const common = {
    ...s,
    readable: true,
    role: p.jobTitle,
    org: p.employer,
    cvReportId: p.cvReportId,
    tailorReportId: p.tailorReportId,
    latest: out.kind === "unknown-version" ? null : out.documentVersion,
    blocked: out.kind === "review" ? `Look at ${plural(out.items.length, "point")} first.` : null,
    fileName: p.cvFileName,
  };
  const gone = p.cvReportId && !cv ? "The CV this was checked against is no longer here." : null;
  if (!e || !v) return { ...common, stale: gone };
  const doc = letterDocumentOf(e, v);
  // The same words either way when no lines have been saved: a letter can record the CV as uploaded or as laid out.
  const sameCv = cv ? [documentVersion(baseDocument(cv).text), ...(cv.analysis.lines.some((l) => l.accepted) ? [] : [cv.assessment.documentVersion])] : [];
  const changed = cv && doc.review.cvVersion && !sameCv.includes(doc.review.cvVersion) ? "Your CV has changed since this letter was checked against it." : null;
  return {
    ...common,
    current: { n: v.n, total: e.versions.length, id: v.id, at: v.at },
    versions: e.versions.map((x) => ({ id: x.id, n: x.n, documentVersion: x.documentVersion })),
    keptEdits: keptDecisions(v.decisions),
    pending: v.shown.filter((id) => !v.decisions[id]).length,
    stale: gone ?? changed,
  };
}

function linkedinSummary(s: ArtefactSummary, p: LinkedinPayload): ArtefactSummary {
  const blanks = sectionsWithBlanks(p);
  return {
    ...s,
    readable: true,
    latest: sha256(profileText(p)),
    blocked: blanks.length ? `Fill in the blanks in ${plural(blanks.length, "section")} first.` : null,
    keptEdits: p.sections.filter((x) => currentSectionVersion(x).n > 1).length,
    pending: p.sections.reduce((n, x) => n + openSuggestions(x).length, 0),
  };
}

/** One report as the dashboard needs it. A record that can't be read becomes a row saying so, and never stops the rest. */
export function summarise(r: WorkspaceReport, cvOf: (id: string | null) => CvReviewPayload | null): ArtefactSummary {
  const s = blank(r);
  if (r.payload === null) return s;
  try {
    if (r.row.type === "cv_review") return cvSummary(s, r.payload as CvReviewPayload, r.row);
    if (r.row.type === "tailor") return tailorSummary(s, r.payload as TailorPayload, cvOf((r.payload as TailorPayload).cvReportId));
    if (r.row.type === "cover_letter") return letterSummary(s, r.payload as CoverLetterPayload, cvOf((r.payload as CoverLetterPayload).cvReportId));
    return linkedinSummary(s, r.payload as LinkedinPayload);
  } catch {
    return s;
  }
}

/* ---------- Downloads ---------- */

export type DownloadState =
  | { state: "current"; at: string }
  /** The student has a file, but not this version. */
  | { state: "behind"; at: string; versionLabel: string | null }
  | { state: "never" }
  | { state: "blocked"; reason: string }
  | { state: "nothing"; reason: string };

const versionLabel = (a: ArtefactSummary, hash: string) => {
  const n = a.versions.filter((v) => v.documentVersion === hash).at(-1)?.n;
  return n ? `version ${n}` : null;
};

/** Whether what the student downloaded holds this version. A retried download is the same record, and an older file doesn't undo a newer one. */
export function downloadState(a: ArtefactSummary, downloads: ArtefactDownload[], target: string | null = a.latest): DownloadState {
  if (!a.readable) return { state: "nothing", reason: "This record can't be read at the moment." };
  if (a.blocked && target === a.latest) return { state: "blocked", reason: a.blocked };
  if (!target) return { state: "nothing", reason: a.nothingYet ?? "Nothing to download yet." };
  const mine = downloads.filter((d) => d.reportId === a.reportId);
  const same = mine.filter((d) => d.documentVersion === target || (target === a.latest && a.sameAsLatest.includes(d.documentVersion)));
  if (same.length) return { state: "current", at: same.map((d) => d.lastAt).sort().at(-1)! };
  if (!mine.length) return { state: "never" };
  const last = [...mine].sort((x, y) => x.lastAt.localeCompare(y.lastAt)).at(-1)!;
  return { state: "behind", at: last.lastAt, versionLabel: versionLabel(a, last.documentVersion) };
}

/** The sentence a student reads. Says what we know: the server handed over a file, not that it's still on their device. */
export function downloadSentence(d: DownloadState): string {
  const on = (at: string) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  if (d.state === "current") return `Your download from ${on(d.at)} has this version.`;
  if (d.state === "behind") return `Your last download (${on(d.at)}${d.versionLabel ? `, ${d.versionLabel}` : ""}) doesn't have this version.`;
  if (d.state === "never") return "Not downloaded yet.";
  return d.reason;
}

const DOWNLOAD_THEME = CV_THEMES[1].slug;

export function downloadHref(a: Pick<ArtefactSummary, "reportId" | "type">, format: "docx" | "pdf", versionId?: string | null): string {
  const v = versionId ? `&version=${encodeURIComponent(versionId)}` : "";
  if (a.type === "cv_review") return `/api/templates/${DOWNLOAD_THEME}?with=mine&report=${a.reportId}&format=${format}`;
  if (a.type === "tailor") return `/api/tailor/${a.reportId}?format=${format}${v}`;
  if (a.type === "cover_letter") return `/api/letters/${a.reportId}?format=${format}${v}`;
  return `/linkedin/${a.reportId}/download`;
}

export function reportHref(a: Pick<ArtefactSummary, "reportId" | "type">): string {
  return a.type === "cv_review" ? `/reviews/${a.reportId}` : a.type === "tailor" ? `/tailor/${a.reportId}` : a.type === "linkedin" ? `/linkedin/${a.reportId}` : `/letters/${a.reportId}`;
}

/* ---------- Applications ---------- */

export interface ArtefactSlot {
  kind: ArtefactKind;
  artefact: ArtefactSummary;
  /** linked: on this application by the student's choice, or when it was made from the tracked role. derived: named by a linked document, so it follows that document. */
  how: "linked" | "derived";
  derivedFrom: string | null;
  /** The version kept for this application. Null: it follows the latest. */
  kept: { documentVersion: string; n: number | null; versionId: string | null; isLatest: boolean } | null;
  /** The version this application uses, as a label. */
  versionLabel: string | null;
  download: DownloadState;
  /** The version a download from this application asks for. Null: the selected one. */
  downloadVersionId: string | null;
}

export interface ApplicationGroup {
  application: Application;
  slots: Record<ArtefactKind, ArtefactSlot | null>;
}

/** Documents for one role with no application row: the student tailored to an advert they aren't tracking. */
export interface RoleGroup {
  key: string;
  role: string | null;
  org: string | null;
  deadline: string | null;
  /** Newest first. Older ones keep their own history; nothing is merged. */
  documents: ArtefactSummary[];
  /** An application with the exact same role and employer. A suggestion only: it isn't linked until the student says so. */
  suggestion: Application | null;
}

export interface UsefulProgress {
  uploads: number;
  reviewedVersions: number;
  /** Reviews of text already reviewed, including a re-export that differs only in formatting. Not progress. */
  repeatUploads: number;
  tailored: number;
  letters: number;
  completedEdits: number;
  corrections: number;
  /** Distinct CV versions that measured meaningfully better than the distinct version before, in the same scoring series. */
  improvements: number;
  applicationsSent: number;
}

/** A CV version without its text. */
export type WorkspaceSource = Pick<CvSource, "id" | "parentId" | "kind" | "fileName" | "documentVersion" | "reportId" | "createdAt"> & { readable: boolean };

export interface Workspace {
  applications: ApplicationGroup[];
  roles: RoleGroup[];
  /** Reports not written for one role, such as a LinkedIn profile. */
  profile: ArtefactSummary[];
  all: ArtefactSummary[];
  sources: WorkspaceSource[];
  latestCv: ArtefactSummary | null;
  progress: UsefulProgress;
  /** Which role or roles each report belongs to, for the reports table. */
  belongsTo: Record<string, string[]>;
  /** The student has more reports than were read. Counts cover those read. */
  truncated: boolean;
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** "the employer" is what a tailor report says when no employer was given: two of them aren't the same employer. */
const knownRole = (a: { role: string | null; org: string | null }) => norm(a.role) !== "" && norm(a.org) !== "" && norm(a.org) !== "the employer";
export const sameRole = (a: { role: string | null; org: string | null }, b: { role: string; org: string }) => knownRole(a) && norm(a.role) === norm(b.role) && norm(a.org) === norm(b.org);

function slotFor(a: ArtefactSummary, kind: ArtefactKind, link: ApplicationLink | null, downloads: ArtefactDownload[], derivedFrom: string | null): ArtefactSlot {
  const pin = link?.documentVersion ?? null;
  const isLatest = pin !== null && (pin === a.latest || a.sameAsLatest.includes(pin));
  const version = pin ? a.versions.filter((v) => v.documentVersion === pin).at(-1) ?? null : null;
  // A CV download is always of the lines as they stand, so only numbered versions can be asked for by version.
  const usesKept = pin !== null && !isLatest && !!version;
  const label = usesKept ? `Version ${version!.n} kept` : pin && !version && !isLatest ? "An earlier version kept" : a.current ? `Version ${a.current.n}, the latest` : null;
  return {
    kind,
    artefact: a,
    how: link ? "linked" : "derived",
    derivedFrom,
    kept: pin ? { documentVersion: pin, n: version?.n ?? null, versionId: version?.id ?? null, isLatest } : null,
    versionLabel: label,
    download: downloadState(a, downloads, usesKept ? pin : a.latest),
    downloadVersionId: usesKept ? version!.id : null,
  };
}

function progressOf(all: ArtefactSummary[], sources: Workspace["sources"], applications: Application[]): UsefulProgress {
  const cvs = all.filter((a) => a.type === "cv_review").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const seen = new Set<string>();
  let prev: ArtefactSummary | null = null;
  let improvements = 0;
  for (const cv of cvs) {
    if (!cv.docKey || seen.has(cv.docKey)) continue;
    seen.add(cv.docKey);
    if (prev && prev.score !== null && cv.score !== null && comparableScores(prev.series, cv.series) && cv.score - prev.score >= MEANINGFUL_SCORE_CHANGE) improvements++;
    prev = cv;
  }
  const readableCvs = cvs.filter((c) => c.docKey).length;
  const corrections = new Set(sources.filter((s) => s.kind === "correction").map((s) => s.documentVersion)).size;
  return {
    uploads: sources.filter((s) => s.kind === "upload").length + cvs.filter((c) => !c.sourceId).length,
    reviewedVersions: seen.size,
    repeatUploads: readableCvs - seen.size,
    tailored: all.filter((a) => a.type === "tailor").length,
    letters: all.filter((a) => a.type === "cover_letter").length,
    completedEdits: all.reduce((n, a) => n + a.keptEdits, 0) + corrections,
    corrections,
    improvements,
    applicationsSent: applications.filter((a) => a.status !== "saved").length,
  };
}

/** Everything the dashboard shows about documents and roles. `reports` should hold every report a link or a parent names. */
export function buildWorkspace(input: { applications: Application[]; links: ApplicationLink[]; reports: WorkspaceReport[]; sources: Workspace["sources"]; downloads: ArtefactDownload[]; truncated?: boolean }): Workspace {
  const { applications, links, reports, sources, downloads } = input;
  const byId = new Map(reports.map((r) => [r.row.id, r]));
  const cvOf = (id: string | null) => {
    const r = id ? byId.get(id) : undefined;
    return r?.row.type === "cv_review" && r.payload ? (r.payload as CvReviewPayload) : null;
  };
  const all = reports.map((r) => summarise(r, cvOf)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const summary = new Map(all.map((a) => [a.reportId, a]));
  const onApplication = new Set<string>();
  const belongsTo: Record<string, string[]> = {};
  const note = (reportId: string, label: string) => {
    const list = (belongsTo[reportId] ??= []);
    if (!list.includes(label)) list.push(label);
  };

  const groups = applications.map((application): ApplicationGroup => {
    const mine = links.filter((l) => l.applicationId === application.id);
    const linked = (kind: ArtefactKind) => {
      const l = mine.find((x) => x.kind === kind);
      const a = l ? summary.get(l.reportId) : undefined;
      return l && a ? slotFor(a, kind, l, downloads, null) : null;
    };
    const slots: ApplicationGroup["slots"] = { cv: linked("cv"), tailor: linked("tailor"), letter: linked("letter") };
    // What a linked document names belongs here too: the student chose that CV or tailored CV when making it. A link always wins.
    const follow = (kind: ArtefactKind, id: string | null, from: string) => {
      const a = id ? summary.get(id) : undefined;
      if (!slots[kind] && a && ARTEFACT_KIND_FOR[a.type] === kind) slots[kind] = slotFor(a, kind, null, downloads, from);
    };
    const letterAtStart = slots.letter?.artefact;
    if (letterAtStart) follow("tailor", letterAtStart.tailorReportId, "your cover letter");
    const tailor = slots.tailor?.artefact;
    if (tailor && !slots.letter) {
      const made = all.filter((a) => a.type === "cover_letter" && a.tailorReportId === tailor.reportId)[0];
      if (made) follow("letter", made.reportId, "your tailored CV");
    }
    if (slots.tailor) follow("cv", slots.tailor.artefact.cvReportId, "your tailored CV");
    if (slots.letter) follow("cv", slots.letter.artefact.cvReportId, "your cover letter");
    const label = `${application.role} · ${application.org}`;
    for (const s of Object.values(slots)) {
      if (!s) continue;
      onApplication.add(s.artefact.reportId);
      note(s.artefact.reportId, label);
    }
    return { application, slots };
  });

  // Not on an application: tailored CVs and letters, one group per role, and only an exact role and employer ever groups two.
  const byRole = new Map<string, RoleGroup>();
  const keyFor = (a: ArtefactSummary): string => {
    const parent = a.tailorReportId ? summary.get(a.tailorReportId) : undefined;
    if (parent) return keyFor(parent);
    return knownRole(a) ? `role:${norm(a.role)}|${norm(a.org)}` : `report:${a.reportId}`;
  };
  for (const a of all) {
    if ((a.type !== "tailor" && a.type !== "cover_letter") || onApplication.has(a.reportId)) continue;
    const key = keyFor(a);
    const group = byRole.get(key) ?? { key, role: a.role, org: a.org, deadline: a.deadline, documents: [], suggestion: applications.find((x) => sameRole(a, x)) ?? null };
    group.documents.push(a);
    group.deadline ??= a.deadline;
    byRole.set(key, group);
    const label = knownRole(a) ? `${a.role} · ${a.org}, not tracked` : "A role with no employer named";
    note(a.reportId, label);
    if (a.cvReportId && summary.has(a.cvReportId)) note(a.cvReportId, label);
  }
  const profile = all.filter((a) => a.type === "linkedin");
  for (const a of profile) belongsTo[a.reportId] = ["Your profile, not one role"];

  const cvs = all.filter((a) => a.type === "cv_review");
  return {
    applications: groups,
    roles: [...byRole.values()],
    profile,
    all,
    sources,
    latestCv: cvs[0] ?? null,
    progress: progressOf(all, sources, applications),
    belongsTo,
    truncated: !!input.truncated,
  };
}
