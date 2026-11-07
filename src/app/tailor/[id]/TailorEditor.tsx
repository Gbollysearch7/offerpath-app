"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { acceptClearSuggestions, decideSuggestion, rejectSuggestion, reopenSuggestion, restoreTailorVersion, retainPlaceholders, saveOwnLine, undoTailorEdit } from "@/app/actions/tailor";
import { announce, focusSoon } from "@/components/a11y";
import { FormError } from "@/components/client";
import { cx } from "@/components/ui";
import type { EditView, MatchSummary, SuggestionView } from "@/lib/analysis/tailor-edits";
import { CV_THEMES } from "@/lib/cv-themes";
import type { EvidenceLevel, SavedIssue } from "@/lib/types";

// OP-014, OP-016: what the student decides about each suggestion, and the result for the document those decisions make.
// The page gets a summary worked out on the server (editView), and everything here is checked again there.

const LEVEL: Record<EvidenceLevel, string> = { explicit: "shown in what you did", contextual: "related, not named", weak: "named only", none: "no evidence found", not_assessed: "check yourself" };
const STATUS: Record<SuggestionView["status"], string> = { pending: "Not decided", accepted: "Accepted", edited: "Your edit", rejected: "Rejected" };

type Result = { error?: string; conflict?: boolean; check?: { issues: { severity: string; key: string; message: string }[] } };

// What a screen reader hears when an action lands. The page redraws around the button that was pressed, and doesn't say so itself.
const SAID: Record<string, string> = {
  keep: "Saved. The result has been measured again.",
  reject: "Suggestion rejected.",
  reopen: "Suggestion reopened.",
  own: "Your line is saved. The result has been measured again.",
  undo: "Undone. The result has been measured again.",
  clear: "Suggestions accepted. The result has been measured again.",
  retain: "The brackets stay. You can download this version.",
  restore: "Back to that version.",
};

const scoreText = (m: MatchSummary) => (m.score === null ? "Not scored" : `${m.score} of 100`);

function Assessment({ title, m }: { title: string; m: MatchSummary }) {
  return (
    <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-1.5 rounded-2xl bg-canvas p-4">
      <h3 className="m-0 font-mono text-[11px] font-normal text-subtle">{title}</h3>
      <p className="m-0 text-2xl tracking-[-0.03em]">{scoreText(m)}</p>
      <p className="m-0 text-sm text-muted">{m.explanation}</p>
      {m.essentialGaps.length > 0 && <p className="m-0 text-sm">Essential, no evidence: {m.essentialGaps.join(", ")}</p>}
      {m.essentialThin.length > 0 && <p className="m-0 text-sm text-muted">Essential, thin evidence: {m.essentialThin.join(", ")}</p>}
      <p className="m-0 font-mono text-[11px] text-subtle">DOCUMENT {m.documentVersion.slice(0, 8)}</p>
    </div>
  );
}

function Diff({ s }: { s: SuggestionView }) {
  return (
    <p className="m-0 rounded-2xl bg-canvas px-4 py-3.5 text-[15px] leading-normal">
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

function Confirmations({ issues, ticked, setTicked }: { issues: Pick<SavedIssue, "key" | "message">[]; ticked: string[]; setTicked: (f: (t: string[]) => string[]) => void }) {
  if (!issues.length) return null;
  return (
    <fieldset className="m-0 flex flex-col gap-2.5 rounded-2xl border border-edge p-4">
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

function Suggestion({ report, s, busy, act, locked }: { report: string; s: SuggestionView; busy: boolean; act: (id: string, fn: (attempt: { key: string; revision: number | null }) => Promise<Result>) => Promise<Result>; locked: boolean }) {
  const [ticked, setTicked] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [asked, setAsked] = useState<{ key: string; message: string }[]>([]);
  const toConfirm = editing === null ? (s.check?.issues.filter((i) => i.severity === "confirm") ?? []) : asked;
  const unconfirmed = toConfirm.some((i) => !ticked.includes(i.key));
  const notes = s.check?.issues.filter((i) => i.severity === "note") ?? [];
  const open = s.status === "pending";

  const keep = async (text: string | null) => {
    const res = await act(`keep:${s.id}:${text ?? ""}`, (a) => decideSuggestion(report, { suggestionId: s.id, text, confirmed: ticked }, a));
    if (res.check) setAsked(res.check.issues.filter((i) => i.severity === "confirm").map((i) => ({ key: i.key, message: i.message })));
    if (!res.error) {
      setEditing(null);
      setTicked([]);
      setAsked([]);
    }
  };

  return (
    <article aria-label={`Suggestion for ${s.where}`} className="flex flex-col gap-2 border-b border-line pb-4 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 font-mono text-[11px] text-subtle">
          {s.where}
          {s.origin === "student" ? " · YOUR OWN WORDS" : ""}
        </p>
        <span className={cx("rounded-full px-2.5 py-1 text-xs", s.status === "rejected" ? "bg-canvas text-muted" : open ? "bg-canvas text-ink-2" : "bg-okbg text-brand")}>{STATUS[s.status]}</span>
      </div>
      {s.kind === "skill" ? <p className="m-0 rounded-2xl bg-canvas px-4 py-3.5 text-[15px]">Add to your skills list: {s.text ?? s.proposed}</p> : <Diff s={s} />}
      {s.keywords.length > 0 && s.kind !== "skill" && <p className="m-0 text-sm text-muted">Why: uses the advert&apos;s wording for {s.keywords.join(", ")}, where your line already backs it up.</p>}
      {s.note && <p className="m-0 text-sm text-black">{s.note}</p>}
      {s.blocked && <p className="m-0 text-sm text-black">We can&apos;t use this wording as it stands: {s.blocked}</p>}
      {s.preview && (
        <p className="m-0 text-sm text-muted">
          <span className="font-medium text-black">Hypothetical, not saved: </span>
          {`if you kept this, the same check on that document would give ${s.preview.score === null ? "no number" : `${s.preview.score} of 100`}${s.preview.gains.length ? `, changing ${s.preview.gains.join(", ")}` : ""}. It only counts once it's in your CV, and only keep it if it's true.`}
        </p>
      )}
      {s.check && s.check.questions.length > 0 && <p className="m-0 text-sm text-black">Only you can fill the [brackets]: {s.check.questions.join(" ")}</p>}
      {notes.length > 0 && <p className="m-0 text-sm text-muted">{notes.map((n) => n.message).join(" ")}</p>}
      {editing !== null && (
        <label className="flex flex-col gap-1 text-sm">
          Your wording
          <textarea autoFocus value={editing} onChange={(e) => setEditing(e.target.value)} rows={3} className="rounded-2xl border border-edge bg-white p-3 text-[15px] text-black" />
        </label>
      )}
      {!locked && (open || editing !== null) && <Confirmations issues={toConfirm} ticked={ticked} setTicked={setTicked} />}
      {!locked && (
        <div className="flex flex-wrap gap-2">
          {editing !== null ? (
            <>
              <button type="button" disabled={busy || unconfirmed} onClick={() => keep(editing)} className="min-h-10 rounded-full border-0 bg-black px-4 text-sm font-medium text-white hover:bg-ink-2 disabled:opacity-50">
                Save my wording
              </button>
              <button type="button" disabled={busy} onClick={() => { setEditing(null); setAsked([]); setTicked([]); focusSoon(`edit-${s.id}`); }} className="min-h-10 rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper">
                Cancel
              </button>
            </>
          ) : (
            <>
              {open && !s.blocked && (
                <button type="button" disabled={busy || unconfirmed} onClick={() => keep(null)} className="min-h-10 rounded-full border-0 bg-black px-4 text-sm font-medium text-white hover:bg-ink-2 disabled:opacity-50">
                  Accept<span className="sr-only-abs"> suggestion for {s.where}</span>
                </button>
              )}
              {s.status !== "rejected" && (
                <button id={`edit-${s.id}`} type="button" disabled={busy} onClick={() => setEditing(s.text ?? s.proposed)} className="min-h-10 rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper">
                  Edit<span className="sr-only-abs"> suggestion for {s.where}</span>
                </button>
              )}
              {s.status !== "rejected" && (
                <button type="button" disabled={busy} onClick={() => act(`reject:${s.id}`, (a) => rejectSuggestion(report, s.id, a))} className="min-h-10 rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper">
                  Reject<span className="sr-only-abs"> suggestion for {s.where}</span>
                </button>
              )}
              {!open && (
                <button type="button" disabled={busy} onClick={() => act(`reopen:${s.id}`, (a) => reopenSuggestion(report, s.id, a))} className="min-h-10 rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper">
                  Decide again<span className="sr-only-abs"> on the suggestion for {s.where}</span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}

function OwnLine({ reportId, view, busy, act }: { reportId: string; view: EditView; busy: boolean; act: (id: string, fn: (attempt: { key: string; revision: number | null }) => Promise<Result>) => Promise<Result> }) {
  const [choice, setChoice] = useState("");
  const [text, setText] = useState("");
  const [asked, setAsked] = useState<{ key: string; message: string }[]>([]);
  const [ticked, setTicked] = useState<string[]>([]);
  const [mode, index] = choice.split(":");
  const unconfirmed = asked.some((i) => !ticked.includes(i.key));
  const save = async () => {
    const input = { lineIndex: Number(index), asNewLine: mode === "new", text, confirmed: ticked };
    const res = await act(`own:${choice}:${text}`, (a) => saveOwnLine(reportId, input, a));
    if (res.check) setAsked(res.check.issues.filter((i) => i.severity === "confirm").map((i) => ({ key: i.key, message: i.message })));
    if (!res.error) {
      setText("");
      setChoice("");
      setAsked([]);
      setTicked([]);
    }
  };
  return (
    <details className="rounded-2xl bg-canvas px-4 py-3.5 text-sm">
      <summary className="cursor-pointer font-medium">Write a line yourself</summary>
      <div className="mt-3 flex flex-col gap-2.5">
        <p className="m-0 text-muted">Your own words go in your CV and are measured as written. Anything your CV doesn&apos;t already show, we&apos;ll ask you to confirm by name.</p>
        <label className="flex flex-col gap-1">
          Where it goes
          <select value={choice} onChange={(e) => setChoice(e.target.value)} className="min-h-10 max-w-full rounded-xl border border-edge bg-white px-2 text-sm text-black">
            <option value="">Choose…</option>
            <optgroup label="Add a new line under">
              {view.entries.map((e) => (
                <option key={e.entryId} value={`new:${e.anchor}`}>
                  {e.heading.slice(0, 70)}
                </option>
              ))}
            </optgroup>
            <optgroup label="Reword a line">
              {view.lines.map((l) => (
                <option key={l.index} value={`line:${l.index}`}>
                  {l.text.slice(0, 70)}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Your line
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="rounded-2xl border border-edge bg-white p-3 text-[15px] text-black" />
        </label>
        <Confirmations issues={asked} ticked={ticked} setTicked={setTicked} />
        <div>
          <button type="button" disabled={busy || !choice || text.trim().length < 3 || unconfirmed} onClick={save} className="min-h-10 rounded-full border-0 bg-black px-4 text-sm font-medium text-white hover:bg-ink-2 disabled:opacity-50">
            Save my line
          </button>
        </div>
      </div>
    </details>
  );
}

export function TailorEditor({ id, view }: { id: string; view: EditView }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [copied, setCopied] = useState(false);
  const [template, setTemplate] = useState(CV_THEMES[1].slug);
  const [pending, start] = useTransition();
  // One key per attempt, kept until it succeeds, so a retry after a dropped connection can't apply twice.
  const keys = useRef(new Map<string, string>());
  const locked = view.stale.some((s) => s.code === "cv-deleted");

  const act = (name: string, fn: (attempt: { key: string; revision: number | null }) => Promise<Result>) =>
    new Promise<Result>((resolve) => {
      start(async () => {
        setError(null);
        const key = keys.current.get(name) ?? crypto.randomUUID();
        keys.current.set(name, key);
        try {
          const res = await fn({ key, revision: view.revision });
          if (res.conflict) setConflict(true);
          if (res.error) setError(res.error);
          else {
            keys.current.delete(name);
            router.refresh();
            announce(SAID[name.split(":")[0]] ?? "Saved.");
          }
          resolve(res);
        } catch {
          setError("That didn't reach us. Try again: it won't be applied twice.");
          resolve({ error: "network" });
        }
      });
    });

  const blanks = view.placeholders.items.length > 0 && !view.placeholders.retained;
  const clear = view.suggestions.filter((s) => s.status === "pending" && !s.blocked && s.origin === "ai" && s.check?.verdict === "pass" && !s.check.questions.length).length;
  const copy = async () => {
    if (!view.text) return;
    try {
      await navigator.clipboard.writeText(view.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Your browser blocked copying. Use Download instead.");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {conflict && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border-2 border-black px-4 py-3 text-sm">
          <span>This tailoring changed in another tab or window. Nothing was saved from here.</span>
          <button type="button" onClick={() => window.location.reload()} className="min-h-10 rounded-full border-0 bg-black px-4 text-sm font-medium text-white">
            Reload the latest version
          </button>
        </div>
      )}
      {view.stale.map((s) => (
        <p key={s.code} role="status" className="m-0 rounded-2xl border-2 border-edge px-4 py-3 text-sm">
          <span className="font-medium">Out of date: </span>
          {s.message}
        </p>
      ))}
      <FormError message={error} />

      <section aria-labelledby="ba-h" className="flex flex-col gap-3">
        <h3 id="ba-h" className="m-0 text-base font-normal">
          Before and after, each measured on its own document
        </h3>
        <div className="flex flex-wrap gap-3">
          <Assessment title="YOUR CV AS UPLOADED" m={view.before} />
          {view.after ? (
            <Assessment title={`VERSION ${view.versionN}: ${view.versionLabel.toUpperCase()}`} m={view.after} />
          ) : (
            <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-1.5 rounded-2xl bg-canvas p-4">
              <h3 className="m-0 font-mono text-[11px] font-normal text-subtle">REVISED VERSION</h3>
              <p className="m-0 text-sm text-muted">No revised document yet, so there&apos;s nothing to measure. Accept or write a change and it&apos;s measured as written.</p>
            </div>
          )}
        </div>
        {view.changes.length > 0 && (
          <ul aria-label="What changed between the two" className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
            {view.changes.map((c) => (
              <li key={c.label}>
                {c.label}: {LEVEL[c.from]} → {LEVEL[c.to]}
              </li>
            ))}
          </ul>
        )}
        <p className="m-0 text-sm text-muted">This describes the evidence in the document, not your chance of being hired. It goes up when your CV&apos;s words change, so only keep what&apos;s true.</p>
      </section>

      <div className="flex flex-wrap gap-2">
        {/* aria-disabled rather than disabled once there's nothing left to undo, so the button pressed last can keep focus. */}
        <button type="button" disabled={pending} aria-disabled={!view.undoLabel} onClick={() => view.undoLabel && act("undo", (a) => undoTailorEdit(id, a))} className="min-h-10 rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper disabled:opacity-50 aria-disabled:opacity-50">
          {view.undoLabel ? `Undo, back to: ${view.undoLabel}` : "Nothing to undo"}
        </button>
        {!locked && clear > 0 && (
          <button type="button" disabled={pending} onClick={() => act("clear", (a) => acceptClearSuggestions(id, a))} className="min-h-10 rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper">
            Accept the {clear} with nothing to confirm
          </button>
        )}
      </div>

      {view.note && (
        <p role="status" className="m-0 text-sm text-black">
          {view.note}
        </p>
      )}

      {view.suggestions.length > 0 && (
        <section aria-label="Suggestions" className="flex flex-col gap-4">
          {view.suggestions.map((s) => (
            <Suggestion key={s.id} report={id} s={s} busy={pending} act={act} locked={locked} />
          ))}
        </section>
      )}

      {view.withheld.length > 0 && (
        <div className="flex flex-col gap-1 rounded-2xl bg-canvas px-4 py-3.5 text-sm">
          <p className="m-0 font-medium">Left out by our check</p>
          <ul className="m-0 list-disc pl-5 text-muted">
            {view.withheld.map((w, i) => (
              <li key={i}>
                {w.where}: {w.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {view.prompts.length > 0 && (
        <section aria-labelledby="hyp-h" className="flex flex-col gap-2 rounded-2xl border border-dashed border-edge px-4 py-3.5">
          <h3 id="hyp-h" className="m-0 text-sm font-medium">
            Hypothetical: what could help, only if it&apos;s true
          </h3>
          <p className="m-0 text-sm text-muted">These aren&apos;t in your CV and don&apos;t change your result. Only a line in your CV that really shows the requirement counts as evidence.</p>
          {view.prompts.map((t, i) => (
            <p key={i} className="m-0 text-sm">
              <span className="font-mono text-[11px] text-subtle">{t.where}</span> {t.after}
            </p>
          ))}
        </section>
      )}

      {!locked && <OwnLine reportId={id} view={view} busy={pending} act={act} />}

      {view.text && (
        <section aria-labelledby="dl-h" className="flex flex-col gap-2.5 rounded-2xl bg-canvas px-4 py-3.5">
          <h3 id="dl-h" className="m-0 text-sm font-medium">
            Version {view.versionN}: this is what you&apos;ll download
          </h3>
          {blanks ? (
            <div className="flex flex-col gap-2 text-sm">
              <p className="m-0">Still to fill in: {view.placeholders.items.join(", ")}. Edit the lines above and put in the real details, or remove them.</p>
              <div>
                <button type="button" disabled={pending} onClick={() => act("retain", (a) => retainPlaceholders(id, a))} className="min-h-10 rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper">
                  Keep the brackets and let me download
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2.5">
              <button type="button" onClick={copy} className="min-h-10 rounded-full border-0 bg-black px-4 text-sm font-medium text-white hover:bg-ink-2">
                {copied ? "Copied" : "Copy this version"}
              </button>
              <label className="flex items-center gap-2 text-sm text-muted">
                Template
                <select value={template} onChange={(e) => setTemplate(e.target.value)} className="min-h-10 rounded-full border border-edge bg-white px-3 text-sm text-black">
                  {CV_THEMES.map((t) => (
                    <option key={t.slug} value={t.slug}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <a href={`/api/tailor/${id}?format=docx&template=${template}&version=${view.versionId}`} className="inline-flex min-h-10 items-center rounded-full border border-edge bg-white px-4 text-sm text-black no-underline hover:bg-paper hover:text-black">
                Download Word
              </a>
              <a href={`/api/tailor/${id}?format=pdf&template=${template}&version=${view.versionId}`} className="inline-flex min-h-10 items-center rounded-full border border-edge bg-white px-4 text-sm text-black no-underline hover:bg-paper hover:text-black">
                Download PDF
              </a>
              <span aria-live="polite" className="sr-only-abs">
                {copied ? "Tailored CV copied" : ""}
              </span>
            </div>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer">Read this version</summary>
            <pre tabIndex={0} aria-label="This version of your CV" className="mt-2 mb-0 max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-white p-3 font-sans text-sm">{view.text}</pre>
          </details>
        </section>
      )}

      {view.facts.length > 0 && (
        <details className="rounded-2xl bg-canvas px-4 py-3.5 text-sm">
          <summary className="cursor-pointer">What you&apos;ve told us that your CV doesn&apos;t show ({view.facts.length})</summary>
          <ul className="mt-2 mb-0 list-disc pl-5 text-muted">
            {view.facts.map((f, i) => (
              <li key={i}>
                {f.value}
                {f.heading ? `, under ${f.heading}` : ""} ({f.how === "typed" ? "you typed this" : "you confirmed a suggestion"})
              </li>
            ))}
          </ul>
          <p className="mt-2 mb-0 text-muted">We use these when checking later suggestions. They count for a job requirement only where the words are in your CV. Undo the decision and they&apos;re withdrawn.</p>
        </details>
      )}

      <details className="rounded-2xl bg-canvas px-4 py-3.5 text-sm">
        <summary className="cursor-pointer">Version history ({view.history.length})</summary>
        <ol className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
          {view.history.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2 last:border-b-0">
              <span className="min-w-0">
                <span className="font-mono text-[11px] text-subtle">V{h.n}</span> {h.label} · {h.score === null ? "not scored" : `${h.score} of 100`}
                {h.current ? " · selected" : ""}
              </span>
              {!h.current && (
                <button type="button" disabled={pending} onClick={() => act(`restore:${h.id}`, (a) => restoreTailorVersion(id, h.id, a))} className="min-h-9 rounded-full border border-edge bg-white px-3 text-[13px] text-black hover:bg-paper">
                  Go back to this<span className="sr-only-abs"> version, {h.n}</span>
                </button>
              )}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
