"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { completeOnboarding } from "@/app/actions/auth";
import { FormError, Switch } from "@/components/client";
import { cx, Logo } from "@/components/ui";
import { SECTORS } from "@/lib/analysis/lexicon";
import { STAGE_OPTIONS } from "@/lib/stages";

type Stage = (typeof STAGE_OPTIONS)[number]["key"];
interface State {
  stage: Stage;
  sectors: string[];
  visaSponsorship: boolean;
  deadlineReminders: boolean;
  shareProgress: boolean;
}

const PREFS: [keyof Omit<State, "stage" | "sectors">, string, string][] = [
  ["visaSponsorship", "I need visa sponsorship", "We’ll show you opportunities that sponsor Skilled Worker visas. General information only, not legal advice."],
  ["deadlineReminders", "Deadline reminders", "An email a week before each tracked deadline closes."],
  ["shareProgress", "Share progress with my careers service", "Your careers team sees your scores and activity, never your CV. You can switch this off any time."],
];

export function OnboardingFlow({ firstName, initial }: { firstName: string; initial: State }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [s, setS] = useState<State>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Each step is a new screen: the heading takes focus, so a screen reader reads it and Tab starts from the step's first choice.
  const heading = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current !== step) heading.current?.focus();
    shownStep.current = step;
  }, [step]);

  const toggleSector = (t: string) => {
    setError(null);
    setS((p) => {
      if (p.sectors.includes(t)) return { ...p, sectors: p.sectors.filter((x) => x !== t) };
      if (p.sectors.length >= 3) {
        setError("Pick up to three sectors. Deselect one to choose another.");
        return p;
      }
      return { ...p, sectors: [...p.sectors, t] };
    });
  };

  const next = () => {
    if (step === 1 && s.sectors.length === 0) return setError("Pick at least one sector.");
    setError(null);
    setStep((x) => Math.min(2, x + 1));
  };

  const finish = () =>
    start(async () => {
      const res = await completeOnboarding(s);
      if (res.error) setError(res.error);
      else router.push("/upload");
    });

  return (
    <div className="min-h-screen bg-canvas text-black">
      <header className="mx-auto flex max-w-[900px] items-center gap-5 p-7">
        <div className="flex items-center gap-2.5 text-lg font-medium tracking-[-0.02em]">
          <Logo />
          Offerpath
        </div>
        <p className="m-0 ml-auto font-mono text-xs text-muted">STEP {step + 1} OF 3</p>
      </header>
      <div className="mx-auto max-w-[900px] px-7">
        <div role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={3} aria-label="Setup progress" className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className={cx("h-1 flex-1 rounded-full", i <= step ? "bg-black" : "bg-edge")} />
          ))}
        </div>
      </div>

      <main id="main" className="mx-auto flex max-w-[900px] flex-col gap-7 px-7 pt-12 pb-16">
        {step === 0 && (
          <>
            <div>
              <h1 ref={heading} tabIndex={-1} className="m-0 text-[36px] font-normal leading-[1.1] tracking-[-1.6px] sm:text-5xl sm:tracking-[-2.16px]">Welcome, {firstName}. Where are you right now?</h1>
              <p className="mt-3 mb-0 text-[17px] text-muted">We&apos;ll tune your feedback and deadlines to your stage.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              {STAGE_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  aria-pressed={s.stage === o.key}
                  onClick={() => setS({ ...s, stage: o.key })}
                  className={cx("flex-[1_1_260px] rounded-[22px] border-2 bg-white px-6 py-[22px] text-left text-black", s.stage === o.key ? "border-black" : "border-transparent hover:border-edge")}
                >
                  <span className="block text-lg tracking-[-0.02em]">{o.t}</span>
                  <span className="mt-1 block text-sm text-muted">{o.d}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div>
              <h1 ref={heading} tabIndex={-1} className="m-0 text-[36px] font-normal leading-[1.1] tracking-[-1.6px] sm:text-5xl sm:tracking-[-2.16px]">Which sectors are you aiming for?</h1>
              <p className="mt-3 mb-0 text-[17px] text-muted">Pick up to three. We&apos;ll show how well your CV fits each one.</p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {SECTORS.map((t) => {
                const on = s.sectors.includes(t);
                return (
                  <button key={t} type="button" aria-pressed={on} onClick={() => toggleSector(t)} className={cx("min-h-[46px] rounded-full px-[18px] text-[15px]", on ? "border-0 bg-black text-white" : "border border-edge bg-white text-black hover:bg-paper")}>
                    {t}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div>
              <h1 ref={heading} tabIndex={-1} className="m-0 text-[36px] font-normal leading-[1.1] tracking-[-1.6px] sm:text-5xl sm:tracking-[-2.16px]">A couple of preferences</h1>
              <p className="mt-3 mb-0 text-[17px] text-muted">You can change these any time in settings.</p>
            </div>
            <div className="rounded-3xl bg-white px-6 py-2">
              {PREFS.map(([k, t, d], i) => (
                <div key={k} className={cx("flex items-center gap-5 py-[18px]", i < PREFS.length - 1 && "border-b border-line")}>
                  <div className="flex-1">
                    <p className="m-0 text-[17px]">{t}</p>
                    <p className="mt-1 mb-0 text-sm leading-[1.45] text-muted">{d}</p>
                  </div>
                  <Switch on={s[k]} label={t} onChange={(v) => setS({ ...s, [k]: v })} />
                </div>
              ))}
            </div>
          </>
        )}

        <FormError message={error} />

        <div className="flex items-center justify-between gap-3 pt-2">
          <button type="button" onClick={() => setStep((x) => Math.max(0, x - 1))} disabled={step === 0} className="min-h-[50px] rounded-full border-0 bg-transparent px-5 text-[15px] text-muted disabled:invisible">
            Back
          </button>
          {step < 2 ? (
            <button type="button" onClick={next} className="min-h-[54px] rounded-full border-0 bg-black px-[30px] text-base font-medium text-white hover:bg-ink-2">
              Continue
            </button>
          ) : (
            <button type="button" onClick={finish} disabled={pending} className="min-h-[54px] rounded-full border-0 bg-black px-[30px] text-base font-medium text-white hover:bg-ink-2 disabled:opacity-60">
              {pending ? "Saving…" : "Upload my CV"}
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
