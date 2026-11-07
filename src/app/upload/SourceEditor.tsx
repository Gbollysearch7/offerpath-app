"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { correctVersion, pasteCv, scoreVersion, type ContentBlock } from "@/app/actions/cv";
import { FormError } from "@/components/client";
import { cx } from "@/components/ui";

// Correcting what was read (OP-006). The blocks are the parser's own cut of the text: a wrapped bullet is one
// field, a page header read as a role is a field the student can clear. Nothing is scored until they choose to.

const primaryBtn = "min-h-[50px] rounded-full border-0 bg-black px-[26px] text-[15px] font-medium text-white hover:bg-ink-2 disabled:opacity-40";
const secondaryBtn = "min-h-[50px] rounded-full border border-edge bg-white px-[26px] text-[15px] text-black hover:bg-paper disabled:opacity-40";
const field = "w-full min-w-0 rounded-[14px] border border-edge bg-white px-3.5 py-2.5 text-[15px] font-normal leading-[1.5] text-black";

const KIND_LABEL: Record<ContentBlock["kind"], string> = { heading: "Section heading", role: "Role or heading line", bullet: "Bullet point", line: "Line" };
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** A short, non-reversible name for what an attempt sends (cyrb53 twice), so the tab's storage holds no CV text or file name. */
function slotFor(what: string): string {
  const h = (seed: number) => {
    let a = 0xdeadbeef ^ seed;
    let b = 0x41c6ce57 ^ seed;
    for (let i = 0; i < what.length; i++) {
      const c = what.charCodeAt(i);
      a = Math.imul(a ^ c, 2654435761);
      b = Math.imul(b ^ c, 1597334677);
    }
    a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
    b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
    return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36);
  };
  return `op-attempt:${h(1)}${h(2)}`;
}

/**
 * The key for one attempt, named by what the attempt sends. A retry, a double click, or the same file or text sent
 * again after a refresh in the middle of submitting gets the same key, because it is kept in this tab's session
 * storage, so the server returns what it already saved instead of a second version. Different content gets a new
 * key. `done` forgets the key once the attempt has landed on a report, so a deliberate later upload is a new attempt.
 * Storage can be unavailable (private windows); the key then lasts as long as the page.
 */
export function useAttemptKey() {
  const keys = useRef(new Map<string, string>());
  return {
    key(what: string): string {
      const slot = slotFor(what);
      let k = keys.current.get(slot);
      if (!k) {
        try {
          k = sessionStorage.getItem(slot) ?? undefined;
        } catch {}
      }
      k ??= crypto.randomUUID();
      keys.current.set(slot, k);
      try {
        sessionStorage.setItem(slot, k);
      } catch {}
      return k;
    },
    done(what: string) {
      const slot = slotFor(what);
      keys.current.delete(slot);
      try {
        sessionStorage.removeItem(slot);
      } catch {}
    },
  };
}

/** Every block of the text as a labelled field, grouped under its section heading. */
export function SourceEditor({ blocks, edits, onEdit }: { blocks: ContentBlock[]; edits: Record<string, string>; onEdit: (id: string, text: string) => void }) {
  // Group by heading block; the lines before the first heading form the top of the CV.
  const groups = useMemo(() => {
    const out: { heading: ContentBlock | null; items: ContentBlock[] }[] = [{ heading: null, items: [] }];
    for (const b of blocks) {
      if (b.kind === "heading") out.push({ heading: b, items: [] });
      else out[out.length - 1].items.push(b);
    }
    return out.filter((g) => g.heading || g.items.length);
  }, [blocks]);
  const value = (b: ContentBlock) => edits[b.id] ?? b.text;
  const changed = (b: ContentBlock) => edits[b.id] !== undefined && oneLine(edits[b.id]) !== oneLine(b.text);
  let bulletNo = 0;
  let lineNo = 0;
  return (
    <div className="flex flex-col gap-5">
      {groups.map((g, gi) => {
        bulletNo = 0;
        lineNo = 0;
        const headingId = `sec-${gi}`;
        return (
          <section key={headingId} {...(g.heading ? { "aria-label": `Section: ${value(g.heading) || "heading cleared"}` } : { "aria-labelledby": headingId })} className="flex flex-col gap-3 rounded-3xl bg-white px-4 py-4 sm:px-6">
            {g.heading ? (
              <label className="flex flex-col gap-1">
                <span id={headingId} className="font-mono text-[11px] tracking-[0.04em] text-subtle">
                  {KIND_LABEL.heading.toUpperCase()}
                  {changed(g.heading) && <span className="ml-2 rounded-full bg-black px-1.5 py-px text-[10px] text-white">EDITED</span>}
                </span>
                <input value={value(g.heading)} onChange={(e) => onEdit(g.heading!.id, e.target.value)} className={cx(field, "font-medium")} />
              </label>
            ) : (
              <h3 id={headingId} className="m-0 font-mono text-[11px] font-normal tracking-[0.04em] text-subtle">
                TOP OF CV
              </h3>
            )}
            {g.items.map((b) => {
              // Numbered, so a screen reader can tell one field from the next.
              const label = `${KIND_LABEL[b.kind]} ${b.kind === "bullet" ? ++bulletNo : ++lineNo}`;
              return (
                <label key={b.id} className={cx("flex gap-2.5", b.kind === "bullet" ? "items-start" : "items-center")}>
                  <span className="sr-only-abs">
                    {label}, {b.where.toLowerCase()}
                  </span>
                  <span aria-hidden="true" className={cx("w-5 shrink-0 text-center font-mono text-[13px] text-subtle", b.kind === "bullet" ? "pt-2.5" : "")}>
                    {b.kind === "bullet" ? "•" : b.kind === "role" ? "§" : ""}
                  </span>
                  {/* Bullets and long lines wrap, so the whole line can be read on a phone; short lines stay one row. */}
                  {b.kind === "bullet" || b.text.length > 40 ? (
                    <textarea value={value(b)} rows={Math.min(5, Math.max(2, Math.ceil(b.text.length / 44)))} onChange={(e) => onEdit(b.id, e.target.value)} className={cx(field, "resize-y", b.kind === "role" && "font-medium", changed(b) && "border-black")} />
                  ) : (
                    <input value={value(b)} onChange={(e) => onEdit(b.id, e.target.value)} className={cx(field, b.kind === "role" && "font-medium", changed(b) && "border-black")} />
                  )}
                </label>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

/**
 * The editor with its actions. "Score my corrections" saves a new version and scores it; "Score the text as it is"
 * scores the reviewed version unchanged (offered only while it is unscored). Either way the student lands on the report.
 */
export function CorrectionPanel({ sourceId, blocks, sector, stage, scoreAsIs, intro, cancelHref }: { sourceId: string; blocks: ContentBlock[]; sector: string; stage: string; scoreAsIs: boolean; intro?: ReactNode; cancelHref?: string }) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const attempt = useAttemptKey();
  const changedCount = blocks.filter((b) => edits[b.id] !== undefined && oneLine(edits[b.id]) !== oneLine(b.text)).length;
  const cleared = blocks.filter((b) => edits[b.id] !== undefined && !oneLine(edits[b.id])).length;

  const submit = (correct: boolean) =>
    start(async () => {
      setError(null);
      const sent = blocks.map((b) => ({ id: b.id, text: edits[b.id] ?? b.text }));
      // Named by the edits themselves: the same corrections sent twice are one attempt, changed ones a new one.
      const what = `correct|${sourceId}|${sector}|${stage}|${JSON.stringify(sent)}`;
      const res = correct ? await correctVersion({ sourceId, blocks: sent, sector, stage, key: attempt.key(what) }) : await scoreVersion({ sourceId, sector, stage });
      if (res.error || !res.id) return setError(res.error ?? "Something went wrong. Try again.");
      if (correct) attempt.done(what);
      router.push(`/reviews/${res.id}`);
    });

  return (
    <div className="flex flex-col gap-4" data-correction={sourceId}>
      {intro}
      <p className="m-0 text-sm leading-[1.55] text-body">Each field is one line as we read it. Fix anything that doesn&apos;t match your CV. Clear a line to leave it out. Start a line with • to make it a bullet point.</p>
      <SourceEditor blocks={blocks} edits={edits} onEdit={(id, text) => setEdits((e) => ({ ...e, [id]: text }))} />
      <p className="m-0 font-mono text-xs text-subtle" aria-live="polite">
        {changedCount === 0 ? "NO CHANGES YET" : `${changedCount} ${changedCount === 1 ? "LINE" : "LINES"} CHANGED${cleared ? ` · ${cleared} CLEARED` : ""}`}
      </p>
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => submit(true)} disabled={pending || changedCount === 0} className={primaryBtn}>
          {pending ? "Scoring…" : "Score my corrections"}
        </button>
        {scoreAsIs && (
          <button type="button" onClick={() => submit(false)} disabled={pending} className={secondaryBtn}>
            Score the text as it is
          </button>
        )}
        {cancelHref && (
          <Link href={cancelHref} className={cx(secondaryBtn, "inline-flex items-center no-underline")}>
            Cancel
          </Link>
        )}
      </div>
      <p className="m-0 text-[13px] leading-[1.5] text-subtle">Your corrections are saved as a new version with a note of what changed. The file you uploaded is kept as it was.</p>
    </div>
  );
}

/** Type or paste the CV's text when the file could not be read. The file, if there was one, is kept beside the text. */
export function PastePanel({ file, sector, stage, onCancel }: { file: File | null; sector: string; stage: string; onCancel: () => void }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const attempt = useAttemptKey();
  const submit = () =>
    start(async () => {
      setError(null);
      const fd = new FormData();
      const what = `paste|${sector}|${stage}|${file ? `${file.name}|${file.size}|${file.lastModified}` : "-"}|${text}`;
      fd.set("text", text);
      fd.set("sector", sector);
      fd.set("stage", stage);
      fd.set("key", attempt.key(what));
      if (file) fd.set("file", file);
      const res = await pasteCv(fd);
      if (res.error || !res.id) return setError(res.error ?? "Something went wrong. Try again.");
      attempt.done(what);
      router.push(`/reviews/${res.id}`);
    });
  return (
    <section aria-labelledby="paste-h" data-paste className="flex flex-col gap-3.5 rounded-[22px] border border-black bg-white px-5 py-5">
      <p className="m-0 font-mono text-xs tracking-[0.04em] text-subtle">TYPE OR PASTE YOUR CV</p>
      <h2 id="paste-h" tabIndex={-1} className="m-0 text-[22px] font-normal leading-[1.2] tracking-[-0.03em]">Paste the text of your CV instead</h2>
      <p className="m-0 text-sm leading-[1.55] text-body">
        Open your CV, select everything, copy it and paste it here. Put each bullet point on its own line, starting with •. We score exactly the text you paste.
        {file ? ` ${file.name} is kept with it, unchanged, so you can see where the text came from.` : ""}
      </p>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Your CV text
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={14} required className={cx(field, "resize-y font-normal")} placeholder={"Alex Example\nalex@example.com\nEXPERIENCE\nData Analyst, Example Ltd  Jun 2024 – Present\n• Built a churn model that cut losses by 12%."} />
      </label>
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={submit} disabled={pending || text.trim().length < 20} className={primaryBtn}>
          {pending ? "Scoring…" : "Score this text"}
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className={secondaryBtn}>
          Back
        </button>
      </div>
    </section>
  );
}
