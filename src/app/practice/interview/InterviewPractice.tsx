"use client";

import { useState } from "react";
import { AlertDot, btn, CheckDot, cx, scoreTextColor } from "@/components/ui";
import { type AnswerFeedback, type InterviewQuestion, starFeedback } from "@/lib/practice";

const KIND_LABEL: Record<InterviewQuestion["kind"], string> = { competency: "Competency", motivation: "Motivation", commercial: "Commercial awareness", technical: "Technical" };

export function InterviewPractice({ questions }: { questions: InterviewQuestion[] }) {
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<AnswerFeedback | null>(null);
  const q = questions[i];
  const go = (next: number) => {
    setI((next + questions.length) % questions.length);
    setAnswer("");
    setFeedback(null);
  };

  return (
    <section aria-labelledby="q-h" className="flex flex-col gap-4 rounded-3xl bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 font-mono text-xs text-subtle">
          QUESTION {i + 1} OF {questions.length} · {KIND_LABEL[q.kind].toUpperCase()}
        </p>
        <div className="flex gap-2">
          <button type="button" className={btn.secondary} onClick={() => go(i - 1)}>
            Previous
          </button>
          <button type="button" className={btn.secondary} onClick={() => go(i + 1)}>
            Next question
          </button>
        </div>
      </div>
      <h2 id="q-h" className="m-0 text-[24px] font-normal leading-snug tracking-[-0.04em]">
        {q.q}
      </h2>
      <p className="m-0 text-sm text-muted">Tip: {q.tip}</p>
      <label htmlFor="answer" className="sr-only-abs">
        Your answer
      </label>
      <textarea
        id="answer"
        value={answer}
        maxLength={4000}
        onChange={(e) => {
          setAnswer(e.target.value);
          setFeedback(null);
        }}
        rows={9}
        placeholder="Write your answer here…"
        className="w-full rounded-[14px] border border-edge bg-white p-3.5 text-[15px] leading-relaxed"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btn.primary} disabled={answer.trim().length < 20} onClick={() => setFeedback(starFeedback(answer, q.kind))}>
          Get feedback
        </button>
        <span className="text-[13px] text-subtle">{answer.trim() ? answer.trim().split(/\s+/).length : 0} words</span>
      </div>
      {feedback && (
        <div role="status" className="flex flex-col gap-3 rounded-2xl bg-canvas p-5">
          <p className="m-0 text-lg">
            <span className="font-mono" style={{ color: scoreTextColor(feedback.score, 10) }}>
              {feedback.score}/10
            </span>{" "}
            <span className="text-muted">for structure</span>
          </p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {feedback.points.map((p) => (
              <li key={p.t} className={cx("flex items-start gap-2.5 text-[15px]", p.ok ? "text-black" : "text-body")}>
                {p.ok ? <CheckDot /> : <AlertDot />}
                {p.t}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
