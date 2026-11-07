"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { acceptClearLetterSuggestions, decideLetterSuggestion, deleteParagraph, editParagraph, improveLetter, rejectLetterSuggestion, reopenLetterSuggestion, restoreLetterVersion, retainLetterGaps, reviewDraft, saveLetter, undoLetterEdit } from "@/app/actions/letters";
import { announce, focusSoon, onTabListKey } from "@/components/a11y";
import { FormError } from "@/components/client";
import { AlertDot, CheckDot, cx, ScoreRing, scoreColor } from "@/components/ui";
import type { LetterSuggestionView, LetterView } from "@/lib/analysis/letter-edits";
import { GUIDANCE_NOTE } from "@/lib/analysis/letter-content";
import { bandLabel } from "@/lib/analysis/labels";
import type { CoverLetterPayload, FindingStatus, LetterArea, LetterRequirement, LetterReview } from "@/lib/types";

// OP-016, OP-017: one page for a letter with versions. It shows the assessment of the selected text, the evidence behind it, and each
// suggestion against its paragraph. The summary is worked out on the server (letterView), and everything here is checked again there.

type Attempt = { key: string; revision: number | null };
type Result = { error?: string; conflict?: boolean; check?: { issues: { severity: string; key: string; message: string }[] } };
type Act = (name: string, fn: (a: Attempt) => Promise<Result>) => Promise<Result>;

const STATUS: Record<FindingStatus, string> = { passed: "Looks fine", needs_attention: "Worth changing", not_applicable: "Not assessed", unavailable: "Not assessed", uncertain: "Can't tell" };
const LEVEL: Record<LetterRequirement["level"], string> = { demonstrated: "Shown with an example", mentioned: "Named, not shown", absent: "Not in the letter" };
const CV_LEVEL: Record<LetterRequirement["cv"]["level"], string> = { explicit: "Your CV shows it in what you did", contextual: "Your CV shows something related", weak: "Your CV names it only", none: "Not in your CV", not_assessed: "Check this yourself", not_checked: "No CV linked" };
const SUGGESTION: Record<LetterSuggestionView["status"], string> = { pending: "Not decided", accepted: "Accepted", edited: "Your edit", rejected: "Rejected" };
// What a screen reader hears when an action lands. The page redraws around the button that was pressed, and doesn't say so itself.
const SAID: Record<string, string> = {
  keep: "Saved. The letter has been checked again.",
  reject: "Suggestion rejected.",
  reopen: "Decision taken back.",
  own: "Paragraph saved. The letter has been checked again.",
  del: "Paragraph deleted. The letter has been checked again.",
  undo: "Undone.",
  save: "Saved to reports.",
  retain: "The gaps stay. You can download this version.",
  improve: "New suggestions added.",
  "accept-clear": "Suggestions accepted. The letter has been checked again.",
  restore: "Back to that version.",
};

const STALE: Record<NonNullable<LetterView["stale"]>, string> = {
  "cv-changed": "You've changed your CV since this was assessed, so what it says about your CV may be out of date. Use “Check as a new letter” to compare with your CV as it is now.",
  "cv-deleted": "The CV this was compared with has been deleted, so what it says about your CV can't be rechecked.",
  "older-method": "This version was assessed by an earlier method. Use “Check as a new letter” for today's.",
};

function Quote({ label, text }: { label: string; text: string }) {
  return (
    <p className="m-0 text-[13px] leading-[1.45] text-muted">
      <span className="font-mono text-[11px] text-subtle">{label}: </span>“{text}”
    </p>
  );
}

function Area({ a }: { a: LetterArea }) {
  return (
    <div className={cx("flex gap-3 rounded-2xl px-3.5 py-3", a.status === "needs_attention" ? "bg-canvas" : "bg-white")}>
      {a.status === "passed" ? <CheckDot size={20} /> : <AlertDot size={20} />}
      <div className="flex min-w-0 flex-col gap-1">
        <p className="m-0 text-[15px]">
          {a.label} <span className="text-[13px] text-muted">· {STATUS[a.status]}{a.status === "needs_attention" && a.impact === "style" ? ", optional" : ""}</span>
        </p>
        <p className="m-0 text-[13px] leading-[1.45] text-muted">{a.explanation}</p>
        {a.evidence.slice(0, 2).map((e, i) => (
          <Quote key={i} label={e.documentVersion === a.evidence[0].documentVersion ? "PASSAGE" : "SOURCE"} text={e.quote} />
        ))}
        {a.action && <p className="m-0 text-[13px] leading-[1.45] text-black">{a.action}</p>}
      </div>
    </div>
  );
}

function Requirements({ title, list }: { title: string; list: LetterRequirement[] }) {
  if (!list.length) return null;
  return (
    <div className="flex flex-col gap-3">
      <h3 className="m-0 text-[15px] font-medium">{title}</h3>
      {list.map((q) => (
        <div key={q.id} className="flex flex-col gap-1 border-b border-line pb-3 last:border-b-0">
          <p className="m-0 text-sm">
            {q.label} <span className="text-[13px] text-muted">· {q.category === "essential" ? "Essential" : "Desirable"} · {LEVEL[q.level]}{q.counted ? "" : " · not in the number"}</span>
          </p>
          <p className="m-0 text-[13px] text-muted">{q.note}</p>
          {q.letter && <Quote label="YOUR LETTER" text={q.letter.quote} />}
          <Quote label="THE ADVERT" text={q.advert.quote} />
          {q.cv.refs[0] ? <Quote label="YOUR CV" text={q.cv.refs[0].quote} /> : <p className="m-0 font-mono text-[11px] text-subtle">{CV_LEVEL[q.cv.level].toUpperCase()}</p>}
        </div>
      ))}
    </div>
  );
}

function Diff({ s }: { s: LetterSuggestionView }) {
  return (
    <p className="m-0 rounded-2xl bg-canvas px-4 py-3 text-[15px] leading-normal">
      {s.diff.map((d, i) =>
        d.kind === "same" ? (
          <span key={i}>{d.t} </span>
        ) : d.kind === "added" ? (
          <ins key={i} className="rounded bg-mint px-0.5 no-underline">
            <span className="sr-only-abs">added: </span>
            {d.t}{" "}
          </ins>
        ) : (
          <del key={i} className="text-muted">
            <span className="sr-only-abs">removed: </span>
            {d.t}{" "}
          </del>
        ),
      )}
    </p>
  );
}

function Ticks({ issues, ticked, setTicked }: { issues: { key: string; message: string }[]; ticked: string[]; setTicked: (f: (t: string[]) => string[]) => void }) {
  if (!issues.length) return null;
  return (
    <fieldset className="m-0 flex flex-col gap-2 rounded-2xl border border-edge p-3.5">
      <legend className="px-1 text-sm font-medium text-black">Is this accurate? Tick each one to use this version.</legend>
      {issues.map((x) => (
        <label key={x.key} className="flex items-start gap-2.5 text-sm leading-[1.45] text-black">
          <input type="checkbox" className="mt-[3px] size-4 shrink-0" checked={ticked.includes(x.key)} onChange={(e) => setTicked((t) => (e.target.checked ? [...t, x.key] : t.filter((k) => k !== x.key)))} />
          <span>{x.message}</span>
        </label>
      ))}
    </fieldset>
  );
}

const asked = (res: Result) => res.check?.issues.filter((i) => i.severity === "confirm") ?? [];

function Suggestion({ id, s, busy, act }: { id: string; s: LetterSuggestionView; busy: boolean; act: Act }) {
  const [ticked, setTicked] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [typedAsks, setTypedAsks] = useState<{ key: string; message: string }[]>([]);
  const open = s.status === "pending";
  const toConfirm = editing === null ? s.check.issues.filter((i) => i.severity === "confirm") : typedAsks;
  const unconfirmed = toConfirm.some((i) => !ticked.includes(i.key));
  const keep = async (text: string | null) => {
    const res = await act(`keep:${s.id}:${text ?? ""}:${ticked.join()}`, (a) => decideLetterSuggestion(id, { suggestionId: s.id, text, confirmed: ticked }, a));
    if (res.check) setTypedAsks(asked(res));
    if (!res.error) {
      setEditing(null);
      setTicked([]);
      setTypedAsks([]);
    }
  };
  return (
    <article aria-label={`Suggestion for ${s.where}`} className="flex flex-col gap-2 rounded-2xl border border-line p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 font-mono text-[11px] text-subtle">{s.origin === "ai" ? "WRITING TOOL" : s.origin === "student" ? "YOUR OWN WORDS" : "OUR RULES"}</p>
        <span className={cx("rounded-full px-2.5 py-1 text-xs", open ? "bg-canvas text-ink-2" : s.status === "rejected" ? "bg-canvas text-muted" : "bg-okbg text-brand")}>{SUGGESTION[s.status]}</span>
      </div>
      <Diff s={s} />
      <p className="m-0 text-sm text-muted">{s.reason}</p>
      {s.check.questions.length > 0 && <p className="m-0 text-sm text-black">Only you can fill the [brackets]: {s.check.questions.join(" ")}</p>}
      {s.unplaceable && <p className="m-0 text-sm text-black">This passage has changed since, so this suggestion can&apos;t be applied as it stands.</p>}
      {editing !== null && (
        <label className="flex flex-col gap-1 text-sm">
          Your wording
          <textarea autoFocus value={editing} onChange={(e) => setEditing(e.target.value)} rows={3} className="rounded-2xl border border-edge bg-white p-3 text-[15px] text-black" />
        </label>
      )}
      {(open || editing !== null) && <Ticks issues={toConfirm} ticked={ticked} setTicked={setTicked} />}
      <div className="flex flex-wrap gap-2">
        {editing !== null ? (
          <>
            <button type="button" disabled={busy || unconfirmed} onClick={() => keep(editing)} className="min-h-10 rounded-full border-0 bg-black px-4 text-sm font-medium text-white hover:bg-ink-2 disabled:opacity-50">
              Save my wording
            </button>
            <button type="button" disabled={busy} onClick={() => { setEditing(null); setTicked([]); setTypedAsks([]); focusSoon(`letter-edit-${s.id}`); }} className="min-h-10 rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper">
              Cancel
            </button>
          </>
        ) : (
          <>
            {open && !s.unplaceable && (
              <button type="button" disabled={busy || unconfirmed} onClick={() => keep(null)} className="min-h-10 rounded-full border-0 bg-black px-4 text-sm font-medium text-white hover:bg-ink-2 disabled:opacity-50">
                Accept<span className="sr-only-abs"> suggestion for {s.where}</span>
              </button>
            )}
            {s.kind !== "delete" && s.status !== "rejected" && (
              <button id={`letter-edit-${s.id}`} type="button" disabled={busy} onClick={() => setEditing(s.text ?? s.proposed)} className="min-h-10 rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper">
                Edit<span className="sr-only-abs"> suggestion for {s.where}</span>
              </button>
            )}
            {open && (
              <button type="button" disabled={busy} onClick={() => act(`reject:${s.id}`, (a) => rejectLetterSuggestion(id, s.id, a))} className="min-h-10 rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper">
                Reject<span className="sr-only-abs"> suggestion for {s.where}</span>
              </button>
            )}
            {!open && (
              <button type="button" disabled={busy} onClick={() => act(`reopen:${s.id}`, (a) => reopenLetterSuggestion(id, s.id, a))} className="min-h-10 rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper">
                Take back<span className="sr-only-abs"> decision for {s.where}</span>
              </button>
            )}
          </>
        )}
      </div>
    </article>
  );
}

function Paragraph({ id, para, n, busy, act }: { id: string; para: LetterView["paragraphs"][number]; n: number; busy: boolean; act: Act }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);
  const [asks, setAsks] = useState<{ key: string; message: string }[]>([]);
  const slot = para.slot;
  const save = async () => {
    const res = await act(`own:${slot}:${draft}:${ticked.join()}`, (a) => editParagraph(id, slot!, draft!, ticked, a));
    if (res.check) setAsks(asked(res));
    if (!res.error) {
      setDraft(null);
      setTicked([]);
      setAsks([]);
      focusSoon(`para-edit-${n}`);
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      {draft !== null ? (
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor={`para-${n}`}>
            Paragraph {n + 1}
          </label>
          <textarea autoFocus id={`para-${n}`} value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.max(3, Math.ceil(draft.length / 80))} className="w-full resize-y rounded-[14px] border border-edge p-3 text-base leading-[1.75]" />
          <Ticks issues={asks} ticked={ticked} setTicked={setTicked} />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || asks.some((x) => !ticked.includes(x.key))} onClick={save} className="min-h-10 rounded-full border-0 bg-black px-4 text-sm text-white disabled:opacity-60">
              Save paragraph
            </button>
            <button type="button" disabled={busy} onClick={() => { setDraft(null); setAsks([]); setTicked([]); focusSoon(`para-edit-${n}`); }} className="min-h-10 rounded-full border border-edge bg-white px-4 text-sm text-black">
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={async () => { const r = await act(`del:${slot}`, (a) => deleteParagraph(id, slot!, a)); if (!r.error) setDraft(null); }} className="min-h-10 rounded-full border-0 bg-transparent px-3 text-sm text-muted hover:text-black">
              Delete paragraph
            </button>
          </div>
        </div>
      ) : (
        <p className="m-0 whitespace-pre-line text-base leading-[1.75]">{para.text}</p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {para.src.map((s) => (
          <span key={s} className="rounded-full bg-canvas px-2 py-[3px] font-mono text-[11px] text-muted">
            {s}
          </span>
        ))}
        {draft === null && slot !== null && (
          <button id={`para-edit-${n}`} type="button" onClick={() => setDraft(para.text)} className="min-h-[26px] rounded-full border-0 bg-transparent px-2.5 text-xs text-brand hover:underline">
            Edit<span className="sr-only-abs"> paragraph {n + 1}</span>
          </button>
        )}
      </div>
    </div>
  );
}

export function LetterWorkspace({ id, p, view, review, left, limit, ai }: { id: string; p: CoverLetterPayload; view: LetterView; review: LetterReview; left: number; limit: number; ai: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [tab, setTab] = useState<"letter" | "ad">("letter");
  const [consent, setConsent] = useState(true);
  const [pending, start] = useTransition();
  // One key per attempt, kept until it succeeds, so a retry after a dropped connection can't apply twice.
  const keys = useRef(new Map<string, string>());
  const act: Act = (name, fn) =>
    new Promise((resolve) =>
      start(async () => {
        setError(null);
        const key = keys.current.get(name) ?? crypto.randomUUID();
        keys.current.set(name, key);
        const res = await fn({ key, revision: view.revision });
        if (res.conflict) setConflict(true);
        if (res.error) setError(res.error);
        else {
          keys.current.delete(name);
          router.refresh();
          announce(SAID[name.split(":")[0]] ?? "Saved.");
        }
        resolve(res);
      }),
    );
  const score = review.score;
  const hard = review.requirements.filter((q) => !q.soft);
  const soft = review.requirements.filter((q) => q.soft);
  const placedBy = new Set(view.paragraphs.map((x) => x.slot));
  const orphaned = view.suggestions.filter((s) => !placedBy.has(s.paragraph));
  const open = view.suggestions.filter((s) => s.status === "pending");
  const sorted = [...review.areas].sort((a, b) => Number(a.status !== "needs_attention") - Number(b.status !== "needs_attention") || Number(a.impact === "style") - Number(b.impact === "style"));

  return (
    <main id="main" className="mx-auto flex max-w-[1440px] flex-col gap-5 px-4 pt-6 pb-14 sm:px-7">
      <div className="flex flex-wrap items-end justify-between gap-4 px-1 pt-2 pb-1">
        <div className="min-w-0">
          <p className="m-0 font-mono text-xs text-brand">{p.mode === "draft" ? `DRAFT${p.aiAssisted ? " · AI-ASSISTED" : ""}` : "COVER LETTER REVIEW"} · VERSION {view.versionN}</p>
          <h1 className="mt-1.5 mb-0 text-[32px] font-normal leading-[1.1] tracking-[-1.4px] sm:text-[44px] sm:tracking-[-1.98px]">{p.employer} cover letter</h1>
          <p className="mt-2 mb-0 text-[15px] text-muted">
            {p.jobTitle}, {p.employer}{p.cvFileName ? ` · compared with ${p.cvFileName}` : " · no CV linked"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {view.canUndo && (
            <button type="button" disabled={pending} onClick={() => act("undo", (a) => undoLetterEdit(id, a))} className="min-h-11 rounded-full border border-edge bg-white px-[18px] text-sm text-black hover:bg-paper disabled:opacity-60">
              Undo
            </button>
          )}
          {view.download.ready && (
            <>
              <a href={`/api/letters/${id}?format=docx`} className="inline-flex min-h-11 items-center rounded-full border border-edge bg-white px-[18px] text-sm text-black no-underline hover:bg-paper hover:text-black">
                Download Word
              </a>
              <a href={`/api/letters/${id}?format=pdf`} className="inline-flex min-h-11 items-center rounded-full border border-edge bg-white px-[18px] text-sm text-black no-underline hover:bg-paper hover:text-black">
                Download PDF
              </a>
            </>
          )}
          {p.mode === "draft" && (
            <button type="button" disabled={pending} aria-disabled={p.saved} onClick={() => !p.saved && act("save", () => saveLetter(id))} className="min-h-11 rounded-full border-0 bg-black px-[18px] text-sm font-medium text-white hover:bg-ink-2 disabled:opacity-60 aria-disabled:opacity-60">
              {p.saved ? "Saved to reports" : "Save to reports"}
            </button>
          )}
        </div>
      </div>
      <FormError message={error} />
      {conflict && (
        <p role="alert" className="m-0 flex flex-wrap items-center gap-3 rounded-2xl bg-white px-5 py-4 text-sm">
          This letter changed in another tab or window, so nothing was saved.
          <button type="button" onClick={() => { setConflict(false); setError(null); router.refresh(); }} className="min-h-10 rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper">
            Reload the latest version
          </button>
        </p>
      )}
      {view.stale && <p role="status" className="m-0 rounded-2xl bg-white px-5 py-4 text-sm leading-[1.55]">{STALE[view.stale]}</p>}
      {!view.download.ready && (
        <section aria-labelledby="gaps-h" className="flex flex-col gap-2.5 rounded-3xl bg-white px-6 py-5">
          <h2 id="gaps-h" className="m-0 text-base font-medium">Before you download</h2>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm">
            {view.download.items.map((x, i) => (
              <li key={i}>{x.kind === "placeholder" ? `A gap to fill: ${x.text}` : x.text}</li>
            ))}
          </ul>
          <div>
            <button type="button" disabled={pending} onClick={() => act("retain", (a) => retainLetterGaps(id, a))} className="min-h-10 rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper disabled:opacity-60">
              I&apos;ve checked these: let me download this version
            </button>
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[1_1_400px] flex-col gap-5 lg:max-w-[520px]">
          <section aria-labelledby="os-h" className="flex items-center gap-5 rounded-3xl bg-white px-6 py-[22px]">
            {score === null ? (
              <p className="m-0 w-[88px] shrink-0 text-center font-mono text-xs text-subtle">NOT SCORED</p>
            ) : (
              <ScoreRing value={score} size={88} stroke={7} color={scoreColor(score)} label={`Letter score ${score}`}>
                <span className="text-[28px] tracking-[-0.04em]">{score}</span>
              </ScoreRing>
            )}
            <div className="min-w-0">
              <h2 id="os-h" className="m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">
                {score === null ? "NO OVERALL SCORE" : `THIS VERSION · ${bandLabel(score).toUpperCase()}${review.coverage === "partial" ? " · PARTIAL" : ""}`}
              </h2>
              <p className="mt-2 mb-0 text-[15px] leading-normal">{p.summary}</p>
              <p className="mt-2 mb-0 text-[13px] leading-[1.45] text-muted">{review.scoreNote}</p>
              {view.versionN > 1 && view.firstScore !== score && <p className="mt-2 mb-0 text-[13px] text-muted">First version: {view.firstScore ?? "not scored"}. Assessed again when you saved this one.</p>}
            </div>
          </section>

          <section aria-labelledby="ck-h" className="flex flex-col gap-1.5 rounded-3xl bg-white px-6 py-[22px]">
            <h2 id="ck-h" className="mt-0 mb-1.5 font-mono text-xs font-normal tracking-[0.04em] text-subtle">WHAT WE CHECKED</h2>
            {sorted.map((a) => (
              <Area key={a.key} a={a} />
            ))}
            <p className="mt-1.5 mb-0 text-xs leading-[1.45] text-subtle">{GUIDANCE_NOTE}</p>
          </section>

          {review.requirements.length > 0 && (
            <section aria-labelledby="rq-h" className="flex flex-col gap-4 rounded-3xl bg-white px-6 py-[22px]">
              <h2 id="rq-h" className="m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">THE ADVERT&apos;S REQUIREMENTS</h2>
              <Requirements title="Technical and subject skills" list={hard} />
              <Requirements title="Interpersonal skills" list={soft} />
              {review.toConfirm.length > 0 && <p className="m-0 text-sm text-muted">Check these yourself, because a letter can&apos;t settle them: {review.toConfirm.join(", ")}.</p>}
            </section>
          )}

          <section aria-labelledby="rw-h" className="flex flex-col gap-3 rounded-3xl bg-white px-6 py-[22px]">
            <h2 id="rw-h" className="m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">{ai ? "AI SUGGESTIONS" : "SUGGESTIONS"}</h2>
            <p className="m-0 text-[15px] leading-[1.55]">
              {ai ? "We'll suggest changes paragraph by paragraph, drawing on your CV and the advert. " : "We'll suggest changes from our rules. "}Nothing changes until you accept it. We don&apos;t look up employers, so anything about {p.employer} has to come from the advert or from you.
            </p>
            {ai && (
              <label className="flex items-start gap-2.5 text-[13px] leading-[1.45] text-body">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-px h-[18px] w-[18px] shrink-0 accent-brand" />
                <span>
                  Use my CV and this job ad for the suggestions. <Link href="/privacy">How we use your data</Link>
                </span>
              </label>
            )}
            <button type="button" disabled={pending || (ai && (!consent || left <= 0))} onClick={() => act("improve", (a) => improveLetter(id, a))} className="min-h-12 rounded-full border-0 bg-black text-[15px] font-medium text-white hover:bg-ink-2 disabled:opacity-50">
              {pending ? "Working…" : "Suggest improvements"}
            </button>
            {ai && <p className="m-0 text-center text-xs text-subtle">{Math.max(0, left)} of {limit} left today</p>}
            {view.note && <p className="m-0 text-sm text-muted">{view.note}</p>}
            {view.withheld.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="m-0 text-sm font-medium">Left out, because it didn&apos;t hold up against your CV or the advert</p>
                <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13px] text-muted">
                  {view.withheld.slice(0, 6).map((w, i) => (
                    <li key={i}>{w.where}: {w.reason}</li>
                  ))}
                </ul>
              </div>
            )}
            {open.length > 1 && (
              <button type="button" disabled={pending} onClick={() => act("accept-clear", (a) => acceptClearLetterSuggestions(id, a))} className="min-h-10 rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper disabled:opacity-60">
                Accept those with nothing to confirm or fill in
              </button>
            )}
          </section>

          <section aria-labelledby="hs-h" className="flex flex-col gap-2 rounded-3xl bg-white px-6 py-[22px]">
            <h2 id="hs-h" className="m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">VERSIONS</h2>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {view.versions.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2 text-sm last:border-b-0">
                  <span className="min-w-0">
                    {x.n}. {x.label} <span className="text-muted">· {x.score ?? "not scored"}{x.current ? " · selected" : ""}</span>
                  </span>
                  {!x.current && (
                    <button type="button" disabled={pending} onClick={() => act(`restore:${x.id}`, (a) => restoreLetterVersion(id, x.id, a))} className="min-h-9 rounded-full border border-edge bg-white px-3 text-[13px] text-black hover:bg-paper">
                      Go back to this<span className="sr-only-abs"> version {x.n}</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <button type="button" disabled={pending} onClick={() => start(async () => { const r = await reviewDraft(id); if (r.error) setError(r.error); else if (r.id) router.push(`/letters/${r.id}`); })} className="mt-1 min-h-10 rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper disabled:opacity-60">
              Check as a new letter
            </button>
          </section>
        </div>

        <section aria-label="Your letter" className="flex min-w-0 flex-[999_1_560px] flex-col gap-[18px] rounded-3xl bg-white px-[26px] pt-[22px] pb-9">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="View" onKeyDown={onTabListKey} className="flex gap-1 rounded-full bg-canvas p-1">
              <button type="button" role="tab" id="view-tab-letter" aria-selected={tab === "letter"} tabIndex={tab === "letter" ? 0 : -1} aria-controls="view-panel" onClick={() => setTab("letter")} className={cx("min-h-9 rounded-full border-0 px-4 text-sm", tab === "letter" ? "bg-white text-black" : "bg-transparent text-muted")}>
                Cover letter
              </button>
              <button type="button" role="tab" id="view-tab-ad" aria-selected={tab === "ad"} tabIndex={tab === "ad" ? 0 : -1} aria-controls="view-panel" onClick={() => setTab("ad")} className={cx("min-h-9 rounded-full border-0 px-4 text-sm", tab === "ad" ? "bg-white text-black" : "bg-transparent text-muted")}>
                Job ad
              </button>
            </div>
            <span className="font-mono text-xs text-subtle">{review.length.words} WORDS · {p.paras} PARAGRAPHS</span>
          </div>
          {tab === "ad" ? (
            <div id="view-panel" role="tabpanel" aria-labelledby="view-tab-ad" className="max-w-[680px] whitespace-pre-line text-[15px] leading-[1.75] text-ink-2">{p.jobText || "No job ad was added for this letter."}</div>
          ) : (
            <div id="view-panel" role="tabpanel" aria-labelledby="view-tab-letter" className="flex max-w-[720px] flex-col gap-4">
              {view.header && <p className="m-0 whitespace-pre-line text-[15px] leading-[1.7] text-muted">{view.header}</p>}
              {view.paragraphs.map((para, i) => (
                <div key={`${para.slot}-${para.insertedBy}-${i}`} className="flex flex-col gap-2.5">
                  <Paragraph id={id} para={para} n={i} busy={pending} act={act} />
                  {view.suggestions.filter((s) => para.slot !== null && s.paragraph === para.slot).map((s) => (
                    <Suggestion key={s.id} id={id} s={s} busy={pending} act={act} />
                  ))}
                </div>
              ))}
              {orphaned.map((s) => (
                <Suggestion key={s.id} id={id} s={s} busy={pending} act={act} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
