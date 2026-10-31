import type { ReactNode } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// Button and link styles from the prototype: pill shapes, black primary, white bordered secondary.
export const btn = {
  primary: "inline-flex items-center justify-center gap-2 rounded-full border-0 bg-black px-[18px] text-sm font-medium text-white no-underline hover:text-white hover:bg-ink-2 disabled:opacity-50 min-h-11",
  secondary: "inline-flex items-center justify-center gap-2 rounded-full border border-edge bg-white px-[18px] text-sm text-black no-underline hover:text-black hover:bg-paper disabled:opacity-50 min-h-11",
  ghost: "inline-flex items-center justify-center gap-2 rounded-full border-0 bg-transparent px-4 text-sm text-muted no-underline hover:text-black min-h-11",
  soft: "inline-flex items-center justify-center rounded-full bg-canvas px-[14px] text-[13px] font-medium text-black no-underline hover:text-black hover:bg-mist min-h-[38px]",
};

export const pill = (on: boolean, size: "sm" | "md" = "md") =>
  cx(
    "rounded-full",
    size === "md" ? "min-h-10 px-4 text-sm" : "min-h-[38px] px-[14px] text-[13px]",
    on ? "border-0 bg-black text-white" : "border border-edge bg-white text-black hover:bg-paper",
  );

export const input = "min-h-12 w-full rounded-[14px] border border-edge bg-white px-[14px] text-[15px] font-normal text-black";

export function Eyebrow({ children, as: Tag = "h2", className, id }: { children: ReactNode; as?: "h2" | "p" | "h3"; className?: string; id?: string }) {
  return (
    <Tag id={id} className={cx("m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle", className)}>
      {children}
    </Tag>
  );
}

export function Kicker({ children }: { children: ReactNode }) {
  return <p className="m-0 font-mono text-xs text-brand">{children}</p>;
}

export function PageTitle({ kicker, title, sub, actions }: { kicker?: ReactNode; title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 px-1 pt-2 pb-1">
      <div className="min-w-0">
        {kicker && <Kicker>{kicker}</Kicker>}
        <h1 className={cx("m-0 text-[34px] font-normal leading-[1.1] tracking-[-1.5px] sm:text-[44px] sm:tracking-[-1.98px]", kicker ? "mt-1.5" : "")}>{title}</h1>
        {sub && <p className="mt-2 mb-0 text-[15px] text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2.5">{actions}</div>}
    </div>
  );
}

export function Card({ children, className, as: Tag = "section", ...rest }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" | "aside"; "aria-label"?: string; "aria-labelledby"?: string }) {
  return (
    <Tag className={cx("rounded-3xl bg-white", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function CheckDot({ size = 18, label = "Passed" }: { size?: number; label?: string | null }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" className="mt-px shrink-0" {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
      <circle cx="11" cy="11" r="10" fill="#DCE6DF" />
      <path d="M6.8 11.3l2.8 2.8 5.6-5.8" fill="none" stroke="#36604E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AlertDot({ size = 18, label = "To fix" }: { size?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" role="img" aria-label={label} className="mt-px shrink-0">
      <circle cx="11" cy="11" r="10" fill="#000000" />
      <path d="M11 6.5v5M11 14.5v.3" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function Tick({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true" className="mt-0.5 shrink-0">
      <path d="M5 11.3l3.6 3.6 8-8.2" fill="none" stroke="#36604E" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Arrow({ dir = "right", color = "currentColor" }: { dir?: "right" | "left"; color?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d={dir === "right" ? "M5 3l4 4-4 4" : "M9 3L5 7l4 4"} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <circle cx="7" cy="7" r="5" fill="none" stroke="#5C6B66" strokeWidth="1.6" />
      <path d="M11 11l3 3" stroke="#5C6B66" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ dark = false, size = 28 }: { dark?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r="14" fill={dark ? "#36604E" : "#DCE6DF"} />
      <path d="M8 17l4-4 3 3 5-6" fill="none" stroke={dark ? "#FFFFFF" : "#36604E"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Circular score ring. `of` is the maximum (100 or 10). */
export function ScoreRing({ value, of = 100, size, stroke, color, track = "#EEF2EF", label, children }: { value: number; of?: number; size: number; stroke: number; color: string; track?: string; label: string; children?: ReactNode }) {
  const r = size / 2 - stroke / 2 - 2;
  const c = 2 * Math.PI * r;
  const dash = `${((c * Math.max(0, Math.min(of, value))) / of).toFixed(1)} ${c.toFixed(1)}`;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={dash} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

export const scoreColor = (score: number, of = 100) => {
  const s = (score / of) * 100;
  return s >= 75 ? "#36604E" : s >= 50 ? "#8FB3A1" : "#000000";
};

export function checkBadge(s: number, on = false) {
  if (on) return "bg-white text-black";
  return s >= 8 ? "bg-mint text-brand" : s >= 5 ? "bg-canvas text-ink-2" : "bg-black text-white";
}

export function Bar({ pct, color = "#36604E", height = 8, track = "#EEF2EF" }: { pct: number; color?: string; height?: number; track?: string }) {
  return (
    <span className="block rounded-full" style={{ height, background: track }}>
      <span className="block rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height, background: color }} />
    </span>
  );
}

export function Tag({ children, tone = "grey" }: { children: ReactNode; tone?: "grey" | "green" | "black" }) {
  const t = tone === "green" ? "bg-mint text-brand" : tone === "black" ? "bg-black text-white" : "bg-canvas text-muted";
  return <span className={cx("rounded-full px-[9px] py-1 font-mono text-[11px]", t)}>{children}</span>;
}

export function Notice({ children, tone = "mist" }: { children: ReactNode; tone?: "mist" | "grey" }) {
  return <p className={cx("m-0 rounded-2xl px-4 py-3.5 text-sm leading-normal text-body", tone === "mist" ? "bg-mist" : "bg-canvas")}>{children}</p>;
}

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const fmtShort = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
