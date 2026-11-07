"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acceptLinkedinSuggestion, reassessLinkedinSection, rejectLinkedinSuggestion, saveLinkedinSection, setLinkedinFinding, suggestLinkedinWithAi, undoLinkedinSection } from "@/app/actions/linkedin";
import { announce, focusSoon } from "@/components/a11y";
import { FormError } from "@/components/client";
import { AlertDot, btn, Card, CheckDot, cx, Eyebrow, PageTitle } from "@/components/ui";
import type { LinkedinSectionView, LinkedinSuggestionView, LinkedinView } from "@/lib/analysis/linkedin-edits";
import type { DiffPart } from "@/lib/analysis/word-diff";
import { LINKEDIN_SECTION_LABEL, type LinkedinSource } from "@/lib/linkedin-types";
import type { Finding } from "@/lib/types";

const SAVED_HERE = "Saved in Offerpath only. LinkedIn hasn't changed.";

function Diff({ parts }: { parts: DiffPart[] }) {
  return (
    <p className="m-0 text-sm leading-relaxed break-words whitespace-pre-wrap">
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && " "}
          {p.kind === "added" ? <ins className="rounded bg-mist px-0.5 no-underline">{p.t}</ins> : p.kind === "removed" ? <del className="text-muted">{p.t}</del> : p.t}
        </span>
      ))}
    </p>
  );
}

function FindingRow({ f }: { f: Finding }) {
  const ok = f.status === "passed";
  const label = ok ? "Looks fine" : f.status === "needs_attention" ? "To look at" : f.status === "uncertain" ? "Couldn't tell" : "Optional";
  return (
    <li className="flex items-start gap-2.5">
      {ok ? <CheckDot label={label} /> : f.status === "needs_attention" ? <AlertDot label={label} /> : <span className="mt-px shrink-0 rounded-full bg-canvas px-2 py-0.5 text-xs text-ink-2">{label}</span>}
      <div className="min-w-0 text-sm leading-relaxed">
        <p className="m-0 break-words">{f.explanation}</p>
        {f.action && <p className="mt-1 mb-0 text-muted">{f.action}</p>}
      </div>
    </li>
  );
}

function CopyButton({ text, label, disabled, note, name }: { text: string; label: string; disabled?: boolean; note?: string; name?: string }) {
  const [said, setSaid] = useState("");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setSaid(note ?? "Copied. Paste it into LinkedIn yourself to use it.");
    } catch {
      setSaid("Your browser blocked copying. Select the text and copy it yourself.");
    }
  };
  return (
    <>
      <button type="button" onClick={copy} disabled={disabled} className={btn.secondary}>
        {label}
        {name && <span className="sr-only-abs"> {name}</span>}
      </button>
      <span role="status" className="text-sm text-muted">
        {said}
      </span>
    </>
  );
}

interface Tools {
  id: string;
  revision: number | null;
  ai: boolean;
}

function SuggestionCard({ tools, sectionKey, sectionLabel, s, onEdit }: { tools: Tools; sectionKey: string; sectionLabel: string; s: LinkedinSuggestionView; onEdit: (text: string) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);
  const toConfirm = s.issues.filter((i) => i.severity === "confirm");
  const canKeep = !s.blocked && !s.hasBlank && toConfirm.every((i) => ticked.includes(i.key));
  const act = (fn: () => Promise<{ error?: string; confirm?: unknown }>) =>
    start(async () => {
      setError(null);
      const out = await fn();
      if (out.error) setError(out.error);
      else {
        announce(`${sectionLabel}: suggestion updated.`);
        router.refresh();
      }
    });
  return (
    <li className="flex flex-col gap-2.5 rounded-2xl bg-canvas p-4">
      <p className="m-0 font-mono text-xs text-subtle">{s.method === "ai" ? "AI SUGGESTION, CHECKED" : "SUGGESTION FROM OUR RULES"}</p>
      {s.after ? <Diff parts={s.diff} /> : <p className="m-0 text-sm break-words">Remove: <del className="text-muted">{s.before}</del></p>}
      <p className="m-0 text-sm text-muted">{s.why}</p>
      {s.hasBlank && <p className="m-0 text-sm">This has a blank in square brackets. Choose &quot;Edit first&quot; and fill it in with something true, or skip it.</p>}
      {s.blocked && <p className="m-0 text-sm">This no longer holds up against what you gave us, so it can&apos;t be kept.</p>}
      {toConfirm.map((i) => (
        <label key={i.key} className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={ticked.includes(i.key)} onChange={(e) => setTicked(e.target.checked ? [...ticked, i.key] : ticked.filter((k) => k !== i.key))} />
          <span className="min-w-0 break-words">{i.message}</span>
        </label>
      ))}
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending || !canKeep} onClick={() => act(() => acceptLinkedinSuggestion(tools.id, sectionKey, s.id, ticked, { revision: tools.revision }))} className={btn.primary}>
          Keep<span className="sr-only-abs"> suggestion for {sectionLabel}</span>
        </button>
        {s.after && (
          <button type="button" disabled={pending} onClick={() => onEdit(s.after)} className={btn.secondary}>
            Edit first<span className="sr-only-abs"> suggestion for {sectionLabel}</span>
          </button>
        )}
        <button type="button" disabled={pending} onClick={() => act(() => rejectLinkedinSuggestion(tools.id, sectionKey, s.id, { revision: tools.revision }))} className={btn.ghost}>
          Skip<span className="sr-only-abs"> suggestion for {sectionLabel}</span>
        </button>
      </div>
    </li>
  );
}

function SectionCard({ tools, s }: { tools: Tools; s: LinkedinSectionView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(s.text);
  const [compare, setCompare] = useState(false);
  const [confirm, setConfirm] = useState<{ key: string; message: string }[]>([]);
  const [ticked, setTicked] = useState<string[]>([]);
  const empty = !s.text.trim();

  const act = (fn: () => Promise<{ error?: string; confirm?: { key: string; message: string }[] }>, after?: () => void) =>
    start(async () => {
      setError(null);
      setSaved(false);
      const out = await fn();
      if (out.confirm) setConfirm(out.confirm);
      else if (out.error) setError(out.error);
      else {
        setConfirm([]);
        setTicked([]);
        after?.();
        announce(`${s.label} updated.`);
        router.refresh();
      }
    });
  const save = () =>
    act(
      () => saveLinkedinSection(tools.id, s.key, draft, ticked, { revision: tools.revision }),
      () => {
        setEditing(false);
        setSaved(true);
        focusSoon(`li-open-${s.key}`);
      },
    );
  const startEdit = (text: string) => {
    setDraft(text);
    setConfirm([]);
    setTicked([]);
    setEditing(true);
  };

  return (
    <Card as="section" aria-labelledby={`li-h-${s.key}`} className="flex scroll-mt-4 flex-col gap-4 px-5 py-5 sm:px-6">
      <div id={`section-${s.key}`} className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`li-h-${s.key}`} className="m-0 text-2xl font-normal tracking-[-0.02em]">
          {s.label}
        </h2>
        <p className="m-0 text-sm text-muted">{empty ? "Empty" : `Version ${s.versionNumber}${s.changed ? ", edited" : ""}`}</p>
      </div>

      {editing ? (
        <div className="flex flex-col gap-2.5">
          <label htmlFor={`li-edit-${s.key}`} className="text-sm font-medium">
            Edit {s.label.toLowerCase()}
          </label>
          <textarea autoFocus id={`li-edit-${s.key}`} rows={s.key === "headline" ? 3 : 8} value={draft} onChange={(e) => setDraft(e.target.value)} className="w-full rounded-[14px] border border-edge bg-white px-3.5 py-3 text-[15px] text-black" />
          {confirm.length > 0 && (
            <div className="flex flex-col gap-2 rounded-2xl bg-canvas p-4">
              <p className="m-0 text-sm font-medium">Please check these are true before saving:</p>
              {confirm.map((i) => (
                <label key={i.key} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={ticked.includes(i.key)} onChange={(e) => setTicked(e.target.checked ? [...ticked, i.key] : ticked.filter((k) => k !== i.key))} />
                  <span className="min-w-0 break-words">{i.message}</span>
                </label>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending || (confirm.length > 0 && !confirm.every((i) => ticked.includes(i.key)))} onClick={save} className={btn.primary}>
              Save in Offerpath
            </button>
            <button type="button" disabled={pending} onClick={() => { setEditing(false); focusSoon(`li-open-${s.key}`); }} className={btn.ghost}>
              Cancel
            </button>
          </div>
        </div>
      ) : empty ? (
        <p className="m-0 rounded-2xl bg-canvas p-4 text-sm text-muted">Nothing here yet.</p>
      ) : (
        <p className="m-0 rounded-2xl bg-canvas p-4 text-sm leading-relaxed break-words whitespace-pre-wrap">{s.text}</p>
      )}

      {compare && s.changed && (
        <div className="flex flex-col gap-1.5 rounded-2xl border border-line p-4">
          <p className="m-0 font-mono text-xs text-subtle">COMPARED WITH WHAT YOU FIRST GAVE US</p>
          <Diff parts={s.diff} />
        </div>
      )}

      {saved && (
        <p role="status" className="m-0 text-sm">
          {SAVED_HERE}
        </p>
      )}
      {s.hasBlank && <p className="m-0 text-sm">This section has a blank in square brackets. Fill it in before copying.</p>}
      <FormError message={error} />

      {!editing && (
        <div className="flex flex-wrap items-center gap-2">
          <button id={`li-open-${s.key}`} type="button" disabled={pending} onClick={() => startEdit(s.text)} className={btn.secondary}>
            {empty ? "Write this section" : "Edit"}
            <span className="sr-only-abs"> {s.label}</span>
          </button>
          {s.changed && (
            <button type="button" aria-pressed={compare} onClick={() => setCompare(!compare)} className={btn.secondary}>
              {compare ? "Hide comparison" : "Compare"}
            </button>
          )}
          {s.canUndo && (
            <button type="button" disabled={pending} onClick={() => act(() => undoLinkedinSection(tools.id, s.key, { revision: tools.revision }))} className={btn.secondary}>
              Undo<span className="sr-only-abs"> {s.label}</span>
            </button>
          )}
          <button type="button" disabled={pending} onClick={() => act(() => reassessLinkedinSection(tools.id, s.key, { revision: tools.revision }))} className={s.stale ? btn.primary : btn.secondary}>
            Reassess<span className="sr-only-abs"> {s.label}</span>
          </button>
          {tools.ai && !empty && (
            <button type="button" disabled={pending} onClick={() => act(() => suggestLinkedinWithAi(tools.id, s.key, { revision: tools.revision }))} className={btn.secondary}>
              Ask AI for suggestions
            </button>
          )}
          {!empty && !s.hasBlank && <CopyButton text={s.text} label="Copy" name={s.label} />}
        </div>
      )}

      {s.stale && (
        <p role="status" className="m-0 rounded-2xl border border-black p-3 text-sm">
          The feedback below is for your earlier words, not these. Choose Reassess to check what&apos;s here now.
        </p>
      )}

      <div className="flex flex-col gap-2.5">
        <Eyebrow as="h3">FEEDBACK</Eyebrow>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {s.findings.map((f) => (
            <FindingRow key={f.id} f={f} />
          ))}
        </ul>
      </div>

      {s.guidance.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <Eyebrow as="h3">COMPARED WITH YOUR CV: GUIDANCE ONLY</Eyebrow>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {s.guidance.map((f) => (
              <FindingRow key={f.id} f={f} />
            ))}
          </ul>
        </div>
      )}

      {s.proofreading && !empty && (
        <div className="flex flex-col gap-2.5">
          <Eyebrow as="h3">SPELLING AND PUNCTUATION</Eyebrow>
          {s.proofreading.status === "unavailable" ? (
            <p className="m-0 text-sm text-muted">Not assessed. There may be too few ordinary words here to check, since names and tools are skipped, or the check wasn&apos;t available.</p>
          ) : s.proofreading.open.length === 0 ? (
            <p className="m-0 text-sm text-muted">Nothing to raise{s.proofreading.dismissed.length ? `, ${s.proofreading.dismissed.length} dismissed` : ""}. That doesn&apos;t prove the spelling is correct.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {s.proofreading.open.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 break-words">{f.explanation}</span>
                  <button type="button" disabled={pending} onClick={() => act(() => setLinkedinFinding(tools.id, s.key, "dismiss", f.id, { revision: tools.revision }))} className={btn.ghost} aria-label={`Dismiss: ${f.explanation}`}>
                    Dismiss
                  </button>
                </li>
              ))}
            </ul>
          )}
          {s.proofreading.dismissed.map((f) => (
            <p key={f.id} className="m-0 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
              <span className="min-w-0 break-words">Dismissed: {f.explanation}</span>
              <button type="button" disabled={pending} onClick={() => act(() => setLinkedinFinding(tools.id, s.key, "reopen", f.id, { revision: tools.revision }))} className={btn.ghost} aria-label={`Reopen: ${f.explanation}`}>
                Reopen
              </button>
            </p>
          ))}
        </div>
      )}

      {s.suggestions.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <Eyebrow as="h3">SUGGESTIONS</Eyebrow>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {s.suggestions.map((x) => (
              <SuggestionCard key={x.id} tools={tools} sectionKey={s.key} sectionLabel={s.label} s={x} onEdit={startEdit} />
            ))}
          </ul>
        </div>
      )}
      {s.withheld.length > 0 && (
        <div className="text-sm text-muted">
          <p className="m-0">We left out {s.withheld.length === 1 ? "a suggestion" : `${s.withheld.length} suggestions`} that didn&apos;t hold up against what you gave us.</p>
          <ul className="m-0 mt-1 pl-5">
            {s.withheld.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

export function LinkedinReportView({ id, view, aim, cvName, source, allText, ai }: { id: string; view: LinkedinView; aim: string | null; cvName: string | null; source: LinkedinSource; allText: string; ai: boolean }) {
  const tools: Tools = { id, revision: view.revision, ai };
  const blanks = view.sections.some((s) => s.hasBlank);
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 pt-6 pb-14 sm:px-7 lg:flex-row lg:items-start">
      <nav aria-label="Profile sections" className="flex w-full flex-wrap gap-1 rounded-3xl bg-white p-3 lg:sticky lg:top-4 lg:max-w-[240px] lg:flex-col">
        {view.sections.map((s) => (
          <a key={s.key} href={`#section-${s.key}`} className="rounded-xl px-2.5 py-2 text-sm text-ink-2 no-underline hover:bg-canvas hover:text-black">
            {s.label}
          </a>
        ))}
        <a href="#next-steps" className="rounded-xl px-2.5 py-2 text-sm text-ink-2 no-underline hover:bg-canvas hover:text-black">
          Next steps
        </a>
      </nav>

      <main id="main" className="flex min-w-0 flex-1 flex-col gap-5">
        <PageTitle title="Your LinkedIn review" sub={aim ? `Read with your aim in mind: ${aim}` : "No career aim given, so we couldn't check direction."} />

        <Card className="flex flex-col gap-3 px-5 py-5 sm:px-6">
          <Eyebrow>SUMMARY</Eyebrow>
          <p className="m-0 text-base leading-relaxed">{view.summary.headline}</p>
          {view.summary.first && <p className="m-0 text-sm leading-relaxed text-muted">{view.summary.first.text}</p>}
          <p className="m-0 text-sm text-muted">This review has no score, and nothing here affects your CV Readiness Score.</p>
          <p className="m-0 text-sm text-muted">
            We read only what you {source.method === "export" ? `uploaded (${source.files.join(", ")})` : "pasted"}{cvName ? `, and compared it with ${cvName}` : ""}. We haven&apos;t seen your LinkedIn profile, and we don&apos;t look at photographs, appearance or personal traits.
          </p>
          {source.skippedFiles > 0 && <p className="m-0 text-sm text-muted">{source.skippedFiles} other {source.skippedFiles === 1 ? "file" : "files"} in your export weren&apos;t opened or kept.</p>}
          {source.linksIgnored.length > 0 && <p className="m-0 text-sm">You pasted only a link for {source.linksIgnored.map((k) => LINKEDIN_SECTION_LABEL[k]).join(", ")}. We didn&apos;t open it, so we treated that section as empty.</p>}
          {view.cvGone && <p className="m-0 text-sm">The CV you compared with is no longer available, so suggestions now rely on your profile alone.</p>}
          {view.cvChanged && <p className="m-0 text-sm">Your CV has changed since this review started. Reassess a section to compare with the latest version.</p>}
        </Card>

        {view.sections.map((s) => (
          <SectionCard key={`${s.key}:${s.versionNumber}`} tools={tools} s={s} />
        ))}

        <Card as="section" aria-labelledby="next-steps" className="flex scroll-mt-4 flex-col gap-3 px-5 py-5 sm:px-6">
          <h2 id="next-steps" className="m-0 text-2xl font-normal tracking-[-0.02em]">
            Using this on LinkedIn
          </h2>
          <p className="m-0 text-sm font-medium">{SAVED_HERE} We can&apos;t change your profile, so these steps are yours to do.</p>
          <ol className="m-0 flex flex-col gap-1.5 pl-5 text-sm leading-relaxed text-body">
            <li>Read each section once more. Everything in it should be true and sound like you.</li>
            <li>Copy a section here, or copy everything below.</li>
            <li>Sign in to LinkedIn yourself, in your own browser, and open that section of your profile to edit it.</li>
            <li>Paste your text, adjust it if it doesn&apos;t fit, and save it there.</li>
          </ol>
          {blanks && <p className="m-0 text-sm">Copy all and the download are unavailable while a section has a blank in square brackets.</p>}
          <div className="flex flex-wrap items-center gap-2">
            {!blanks && <CopyButton text={allText} label="Copy all" />}
            {!blanks && (
              <a href={`/linkedin/${id}/download`} className={cx(btn.secondary)}>
                Download as text
              </a>
            )}
          </div>
        </Card>
      </main>
    </div>
  );
}
