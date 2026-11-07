import { BAND_LABELS, bandLabel, checkLabel } from "@/lib/analysis/labels";
import type { CheckKey } from "@/lib/types";
import type { ActionChoice, DismissReason } from "./types";
import { reportHref, type ArtefactSlot, type ArtefactSummary, type Workspace } from "./workspace";

// OP-019: the short list of what is useful to do next. Rules over what is saved; nothing is generated and no provider is
// called. An action is ranked by how much it matters, how sure we are, and how much work it is. None is ranked or worded
// by points it would add: a student with a sound CV is told to get on with applying, not to polish it for a higher number.

/** How much it matters. Uncalibrated product judgments, with `priority` below. Nobody has reviewed these yet. */
export const IMPORTANCE = { critical: 4, high: 3, medium: 2, low: 1 } as const;
export type Importance = keyof typeof IMPORTANCE;
/** 1 is a minute or two, 3 is real work. */
export type Effort = 1 | 2 | 3;
/** What a finding with no calibrated confidence counts as: an AI-judged or older finding. */
export const UNKNOWN_CONFIDENCE = 0.6;
export const MAX_ACTIONS = 5;
/** At most this many of the list are about polishing the CV itself, so applications stay in view. */
const MAX_CV_ACTIONS = 2;
const DEADLINE_SOON_DAYS = 7;
const DEADLINE_URGENT_DAYS = 3;
export const REMIND_LATER_DAYS = 7;
const MAX_TITLE = 80;
const MAX_WHY = 170;

export interface NextAction {
  /** Stable, and names ids and hashes only. Includes the version when a new version should ask again. */
  key: string;
  title: string;
  why: string;
  href: string;
  cta: string;
  importance: Importance;
  confidence: number;
  effort: Effort;
  priority: number;
}

export interface DismissedAction {
  key: string;
  title: string;
  reason: DismissReason;
  at: string;
}

export const priorityOf = (importance: Importance, confidence: number, effort: Effort) => (IMPORTANCE[importance] ** 2 * confidence) / effort;

/** Plain words for how an action was ranked. */
export function actionChips(a: Pick<NextAction, "importance" | "confidence" | "effort">): string[] {
  return [
    a.importance === "critical" ? "Urgent" : a.importance === "high" ? "Important" : a.importance === "medium" ? "Useful" : "Minor",
    a.confidence >= 0.9 ? "We're sure" : a.confidence >= 0.7 ? "Likely" : "Worth checking",
    a.effort === 1 ? "Quick" : a.effort === 2 ? "Some work" : "Takes time",
  ];
}

const clip = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};
const firstSentence = (s: string) => s.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? s;
/** A sentence about the number is dropped: an action explains the document, never the points. */
const aboutTheNumber = /\b(scores?|(?<!bullet )points?|bands?|percent|percentage|readiness)\b|\+\s?\d/i;

const make = (a: Omit<NextAction, "priority">): NextAction => ({ ...a, title: clip(a.title, MAX_TITLE), why: clip(a.why, MAX_WHY), priority: priorityOf(a.importance, a.confidence, a.effort) });

const KIND_NAME = { cv: "CV", tailor: "tailored CV", letter: "cover letter" } as const;
const roleName = (a: { role: string; org: string }) => `${a.role} at ${a.org}`;
const daysUntil = (date: string, today: string) => Math.round((new Date(date.slice(0, 10)).getTime() - new Date(today).getTime()) / 864e5);
const day = (date: string) => new Date(date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const isCheck = (id: string): id is CheckKey => !id.includes(".");

function fromSlot(slot: ArtefactSlot, app: Workspace["applications"][number]["application"]): NextAction[] {
  const a = slot.artefact;
  const name = KIND_NAME[slot.kind];
  const role = roleName(app);
  const hash = slot.kept?.documentVersion ?? a.latest ?? "none";
  const out: NextAction[] = [];
  const open = app.status === "saved";
  if (slot.download.state === "blocked") out.push(make({ key: `blocked:${a.reportId}:${hash}`, title: `Finish the ${name} for ${role}`, why: `${slot.download.reason} Until then it can't be downloaded.`, href: reportHref(a), cta: "Open it", importance: open ? "high" : "low", confidence: 1, effort: 1 }));
  if (open && slot.download.state === "behind") out.push(make({ key: `download:${a.reportId}:${hash}`, title: `Download the latest ${name} for ${role}`, why: "The file you downloaded doesn't include the changes you've kept since.", href: reportHref(a), cta: "Open it", importance: "high", confidence: 1, effort: 1 }));
  if (open && slot.download.state === "never" && a.keptEdits > 0) out.push(make({ key: `download:${a.reportId}:${hash}`, title: `Download your ${name} for ${role}`, why: "You've kept changes in it, and they're only here until you download them.", href: reportHref(a), cta: "Open it", importance: "medium", confidence: 1, effort: 1 }));
  if (open && slot.kept && !slot.kept.isLatest && a.latest) out.push(make({ key: `newer:${app.id}:${slot.kind}:${a.latest}`, title: `A newer ${name} exists for ${role}`, why: "You kept an earlier version for this application. Check it's still the one you want to send.", href: "#applications", cta: "See the application", importance: "medium", confidence: 1, effort: 1 }));
  if (open && a.stale) out.push(make({ key: `stale:${a.reportId}:${a.latest ?? "none"}`, title: `Check the ${name} for ${role}`, why: a.stale, href: reportHref(a), cta: "Open it", importance: "medium", confidence: 1, effort: 2 }));
  if (open && a.pending > 0) out.push(make({ key: `pending:${a.reportId}:${a.latest ?? "none"}`, title: `Decide on ${a.pending === 1 ? "a suggestion" : `${a.pending} suggestions`} for ${role}`, why: "None of them changes your document until you keep it.", href: reportHref(a), cta: "Review them", importance: "medium", confidence: 0.8, effort: 1 }));
  if (open && slot.kind === "tailor" && a.essentialGaps.length) out.push(make({ key: `gaps:${a.reportId}:${a.latest ?? "none"}`, title: `Show evidence for “${a.essentialGaps[0]}” for ${role}`, why: `The advert treats ${a.essentialGaps.length === 1 ? "this" : `this and ${a.essentialGaps.length - 1} more`} as essential and we can't find it in your CV. Add it only if it's true for you.`, href: reportHref(a), cta: "See what's missing", importance: "high", confidence: 0.7, effort: 3 }));
  return out;
}

function forApplication(g: Workspace["applications"][number], today: string): NextAction[] {
  const app = g.application;
  const out = Object.values(g.slots).flatMap((s) => (s ? fromSlot(s, app) : []));
  if (app.status !== "saved") return out;
  const days = app.closesOn ? daysUntil(app.closesOn, today) : null;
  const soon = days !== null && days >= 0 && days <= DEADLINE_SOON_DAYS;
  if (soon) {
    const missing = !g.slots.tailor ? "tailored CV" : !g.slots.letter ? "cover letter" : null;
    const href = app.opportunityId ? `/tailor?opp=${encodeURIComponent(app.opportunityId)}` : "/tailor";
    out.push(
      make({
        key: `deadline:${app.id}:${app.closesOn}`,
        title: `${roleName(app)} closes ${day(app.closesOn!)}`,
        why: missing ? `There's no ${missing} on this application yet, and it's marked as not sent.` : "It's still marked as not sent. Move it on once you've applied.",
        href: !g.slots.tailor ? href : missing ? "/letters" : "/opportunities",
        cta: !g.slots.tailor ? "Tailor your CV" : missing ? "Write a letter" : "Open my applications",
        importance: days! <= DEADLINE_URGENT_DAYS ? "critical" : "high",
        confidence: 1,
        effort: 2,
      }),
    );
  } else if (g.slots.tailor?.download.state === "current" && (!g.slots.letter || g.slots.letter.download.state === "current")) {
    out.push(make({ key: `sent:${app.id}`, title: `Have you applied to ${roleName(app)}?`, why: "Your download is up to date. Mark it as sent so your list stays true.", href: "/opportunities", cta: "Open my applications", importance: "medium", confidence: 0.8, effort: 1 }));
  }
  return out;
}

function forCv(cv: ArtefactSummary, dismissedFindings: ReadonlySet<string>): NextAction[] {
  const out: NextAction[] = [];
  const typos = cv.possibleMistakes.filter((f) => !dismissedFindings.has(f.id));
  if (typos.length) {
    const known = typos.map((f) => f.confidence ?? UNKNOWN_CONFIDENCE);
    out.push(make({ key: `proofread:${cv.reportId}:${cv.assessedVersion}`, title: `Check ${typos.length === 1 ? "a possible spelling mistake" : `${typos.length} possible spelling mistakes`} in your CV`, why: "An employer may notice a typo first. Some may be fine as they are, such as a name.", href: `/reviews/${cv.reportId}/checks/spell`, cta: "See them", importance: "high", confidence: known.reduce((x, y) => x + y, 0) / known.length, effort: 1 }));
  }
  // A CV that has reached the top bands isn't sent back for another pass.
  const sound = cv.score !== null && (bandLabel(cv.score) === BAND_LABELS.top || bandLabel(cv.score) === BAND_LABELS.high);
  if (sound) return out;
  for (const f of cv.findings) {
    if (f.status !== "needs_attention" || (f.severity !== "high" && f.severity !== "medium") || !isCheck(f.id)) continue;
    const reason = firstSentence(f.explanation);
    out.push(make({ key: `finding:${cv.reportId}:${f.id}`, title: `${checkLabel(f.id)}: ${(f.action ?? "look at this").replace(/^./, (c) => c.toLowerCase())}`, why: aboutTheNumber.test(reason) ? "This came up in your latest CV review." : reason, href: `/reviews/${cv.reportId}/checks/${f.id}`, cta: "See where", importance: f.severity, confidence: f.confidence ?? UNKNOWN_CONFIDENCE, effort: 2 }));
  }
  return out;
}

function everyCandidate(w: Workspace, today: string, dismissedFindings: ReadonlySet<string>): NextAction[] {
  const out = w.applications.flatMap((g) => forApplication(g, today));
  // Held uploads: the same rule as the upload page's waiting list, newest few.
  const waiting = w.sources.filter((s) => s.kind === "upload" && s.readable && !s.reportId && !w.sources.some((c) => c.parentId === s.id)).slice(0, 2);
  for (const s of waiting) out.push(make({ key: `held:${s.id}`, title: `Check how we read ${s.fileName}`, why: "We weren't sure we read this file correctly, so it's saved and waiting for you before anything is scored.", href: `/upload?source=${s.id}`, cta: "Check the text", importance: "high", confidence: 1, effort: 2 }));
  for (const r of w.roles) {
    const newest = r.documents[0];
    if (r.suggestion) out.push(make({ key: `link:${newest.reportId}:${r.suggestion.id}`, title: `Link your documents to ${roleName(r.suggestion)}`, why: "They name the same role and employer, but aren't on that application yet.", href: "#applications", cta: "See them", importance: "medium", confidence: 0.9, effort: 1 }));
    if (newest.blocked) out.push(make({ key: `blocked:${newest.reportId}:${newest.latest ?? "none"}`, title: `Finish “${newest.title}”`, why: `${newest.blocked} Until then it can't be downloaded.`, href: reportHref(newest), cta: "Open it", importance: "medium", confidence: 1, effort: 1 }));
    if (newest.pending > 0) out.push(make({ key: `pending:${newest.reportId}:${newest.latest ?? "none"}`, title: `Decide on ${newest.pending === 1 ? "a suggestion" : `${newest.pending} suggestions`} in “${newest.title}”`, why: "None of them changes your document until you keep it.", href: reportHref(newest), cta: "Review them", importance: "low", confidence: 0.8, effort: 1 }));
  }
  if (w.latestCv?.readable) out.push(...forCv(w.latestCv, dismissedFindings));
  if (!w.latestCv && !waiting.length) out.push(make({ key: "first-cv", title: "Upload your CV", why: "Everything else here works from it: the review, tailoring to a role, and checking a letter against it.", href: "/upload", cta: "Upload my CV", importance: "high", confidence: 1, effort: 1 }));
  return out;
}

/** What is dismissed now, from the student's history. A later choice wins; "not now" comes back by itself. */
export function dismissedNow(choices: ActionChoice[], today: string): Map<string, ActionChoice> {
  const latest = new Map<string, ActionChoice>();
  for (const c of [...choices].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) latest.set(c.actionKey, c);
  const out = new Map<string, ActionChoice>();
  for (const [k, c] of latest) {
    if (c.kind !== "dismiss") continue;
    if (c.reason === "later" && daysUntil(today, c.createdAt.slice(0, 10)) >= REMIND_LATER_DAYS) continue;
    out.set(k, c);
  }
  return out;
}

/** The list: highest priority first, stable for equal priorities, never longer than MAX_ACTIONS. */
export function nextActions(w: Workspace, input: { today: string; choices: ActionChoice[]; dismissedFindings?: ReadonlySet<string> }): { actions: NextAction[]; dismissed: DismissedAction[]; candidates: NextAction[]; settled: boolean } {
  const candidates = everyCandidate(w, input.today, input.dismissedFindings ?? new Set());
  const gone = dismissedNow(input.choices, input.today);
  const unique = [...new Map(candidates.map((a) => [a.key, a])).values()];
  const sorted = unique.filter((a) => !gone.has(a.key)).sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key));
  let cv = 0;
  const actions = sorted.filter((a) => !a.key.startsWith("finding:") || ++cv <= MAX_CV_ACTIONS).slice(0, MAX_ACTIONS);
  const dismissed = unique.filter((a) => gone.has(a.key)).map((a) => ({ key: a.key, title: a.title, reason: gone.get(a.key)!.reason!, at: gone.get(a.key)!.createdAt }));
  return { actions, dismissed, candidates: unique, settled: actions.length === 0 };
}
