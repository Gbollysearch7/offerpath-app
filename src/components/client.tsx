"use client";

import { useState, useTransition, type ReactNode } from "react";
import { announce } from "./a11y";
import { cx } from "./ui";

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange?: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!on)}
      className={cx("flex h-[30px] w-[52px] shrink-0 rounded-full border-0 p-[3px]", on ? "justify-end bg-brand" : "justify-start bg-[#7D8A85]", disabled && "opacity-50", "forced-colors:border forced-colors:border-[ButtonText]")}
    >
      <span className="h-6 w-6 rounded-full bg-white forced-colors:bg-[ButtonText]" />
    </button>
  );
}

/** A switch that saves itself through a server action. */
export function SavedSwitch({ initial, label, save, disabled }: { initial: boolean; label: string; save: (on: boolean) => Promise<void>; disabled?: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      <Switch
        on={on}
        label={label}
        disabled={disabled || pending}
        onChange={(next) => {
          setOn(next);
          setFailed(false);
          start(async () => {
            try {
              await save(next);
              announce(`${label}: ${next ? "on" : "off"}. Saved.`);
            } catch {
              setOn(!next);
              setFailed(true);
            }
          });
        }}
      />
      {failed && (
        <span role="alert" className="text-right text-xs text-black">
          That didn&apos;t save. Try again.
        </span>
      )}
    </span>
  );
}

export function CopyButton({ text, className, children, copiedLabel = "Copied" }: { text: string; className?: string; children: ReactNode; copiedLabel?: string }) {
  const [said, setSaid] = useState<string | null>(null);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        let label = copiedLabel;
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          label = "Couldn't copy";
        }
        setSaid(label);
        setTimeout(() => setSaid(null), 1600);
      }}
    >
      <span aria-live="polite">{said ?? children}</span>
    </button>
  );
}

export function Expandable({ more, label = "Read more", lessLabel = "Show less", className }: { more: ReactNode; label?: string; lessLabel?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {open && more}
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={cx("mt-2.5 min-h-9 border-0 bg-transparent p-0 text-sm font-medium text-brand", className)}>
        {open ? lessLabel : label}
      </button>
    </>
  );
}

export function FormError({ message, id }: { message: string | null | undefined; id?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="m-0 rounded-2xl border border-black bg-white px-4 py-3 text-sm text-black">
      {message}
    </p>
  );
}
