"use client";

import { useEffect, useState } from "react";
import { AlertDot, btn, CheckDot, cx } from "@/components/ui";
import type { AptitudeQuestion } from "@/lib/practice";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function AptitudeQuiz({ title, intro, minutes, questions }: { title: string; intro: string; minutes: number; questions: AptitudeQuestion[] }) {
  const [started, setStarted] = useState(false);
  const [left, setLeft] = useState(minutes * 60);
  const [answers, setAnswers] = useState<(number | null)[]>(() => questions.map(() => null));
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!started || done) return;
    const t = setInterval(() => setLeft((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [started, done]);
  useEffect(() => {
    if (started && left === 0) setDone(true);
  }, [started, left]);

  const correct = answers.filter((a, i) => a === questions[i].answer).length;
  const reset = () => {
    setAnswers(questions.map(() => null));
    setLeft(minutes * 60);
    setDone(false);
    setStarted(true);
  };

  if (!started) {
    return (
      <section aria-labelledby="apt-h" className="flex flex-col gap-3 rounded-3xl bg-white p-6">
        <h2 id="apt-h" className="m-0 text-[24px] font-normal tracking-[-0.04em]">
          {title}
        </h2>
        <p className="m-0 text-[15px] leading-relaxed text-body">{intro}</p>
        <p className="m-0 text-sm text-muted">
          {questions.length} questions · {minutes} minutes
        </p>
        <div>
          <button type="button" className={btn.primary} onClick={() => setStarted(true)}>
            Start the timer
          </button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="apt-h" className="flex flex-col gap-4 rounded-3xl bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="apt-h" className="m-0 text-[22px] font-normal tracking-[-0.04em]">
          {title}
        </h2>
        <p className="m-0 font-mono text-sm" aria-live={left <= 30 ? "polite" : "off"}>
          {done ? `${correct} of ${questions.length} correct` : `Time left ${fmt(left)}`}
        </p>
      </div>
      {done && left === 0 && <p className="m-0 text-sm text-muted">Time&apos;s up. Here are the answers.</p>}
      <ol className="m-0 flex list-none flex-col gap-5 p-0">
        {questions.map((q, qi) => (
          <li key={q.id}>
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-2 p-0 text-[15px]">
                {q.context && <span className="mb-1.5 block rounded-xl bg-canvas px-3.5 py-2.5 text-sm text-body">{q.context}</span>}
                <span className="font-medium">
                  {qi + 1}. {q.prompt}
                </span>
              </legend>
              <div className="flex flex-wrap gap-2">
                {q.options.map((o, oi) => {
                  const chosen = answers[qi] === oi;
                  const right = done && oi === q.answer;
                  const wrong = done && chosen && oi !== q.answer;
                  return (
                    <label key={o} className={cx("flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm", right ? "border-brand bg-mist" : wrong ? "border-black" : chosen ? "border-black bg-canvas" : "border-edge bg-white", done && "cursor-default")}>
                      <input type="radio" name={q.id} checked={chosen} disabled={done} onChange={() => setAnswers((a) => a.map((x, i) => (i === qi ? oi : x)))} className="accent-brand" />
                      {o}
                    </label>
                  );
                })}
              </div>
              {done && (
                <p className="m-0 flex items-start gap-2 text-sm text-body">
                  {answers[qi] === q.answer ? <CheckDot label="Correct" /> : <AlertDot label="Incorrect" />}
                  {q.explain}
                </p>
              )}
            </fieldset>
          </li>
        ))}
      </ol>
      <div className="flex gap-2.5">
        {done ? (
          <button type="button" className={btn.primary} onClick={reset}>
            Try again
          </button>
        ) : (
          <button type="button" className={btn.primary} onClick={() => setDone(true)}>
            Check answers
          </button>
        )}
      </div>
    </section>
  );
}
