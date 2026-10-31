"use client";

import { useState, useTransition, type ReactNode } from "react";
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
      className={cx("flex h-[30px] w-[52px] shrink-0 rounded-full border-0 p-[3px]", on ? "justify-end bg-brand" : "justify-start bg-edge", disabled && "opacity-50")}
    >
      <span className="h-6 w-6 rounded-full bg-white" />
    </button>
  );
}

/** A switch that saves itself through a server action. */
export function SavedSwitch({ initial, label, save, disabled }: { initial: boolean; label: string; save: (on: boolean) => Promise<void>; disabled?: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <Switch
      on={on}
      label={label}
      disabled={disabled || pending}
      onChange={(next) => {
        setOn(next);
        start(async () => {
          try {
            await save(next);
          } catch {
            setOn(!next);
          }
        });
      }}
    />
  );
}

export function CopyButton({ text, className, children, copiedLabel = "Copied" }: { text: string; className?: string; children: ReactNode; copiedLabel?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
    >
      <span aria-live="polite">{copied ? copiedLabel : children}</span>
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

export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="m-0 rounded-2xl border border-black bg-white px-4 py-3 text-sm text-black">
      {message}
    </p>
  );
}
