"use client";

import { useRef, useState } from "react";
import { submitPracticeAnswer } from "@/app/actions/practice";
import { btn } from "@/components/ui";
import type { SubmitResult } from "@/lib/practice-flow";
import { ANSWER_MAX, ANSWER_MIN, type PracticeQuestion } from "@/lib/practice-types";
import { FeedbackView } from "./FeedbackView";

const KIND_LABEL: Record<PracticeQuestion["kind"], string> = { competency: "Competency", motivation: "Motivation", commercial: "Commercial awareness", technical: "Technical" };

const newKey = () => crypto.randomUUID();

export function InterviewPractice({ questions, applicationId, sector, objective }: { questions: PracticeQuestion[]; applicationId: string | null; sector: string; objective: string }) {
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  // One key per version of the words: a double click or a retry is the same attempt, and new words are a new one.
  const attempt = useRef<string | null>(null);
  const q = questions[i];
  const go = (next: number) => {
    setI((next + questions.length) % questions.length);
    setAnswer("");
    setResult(null);
    attempt.current = null;
  };
  const submit = async () => {
    attempt.current ??= newKey();
    setBusy(true);
    setResult(null);
    try {
      setResult(await submitPracticeAnswer({ applicationId, sector, objective, questionId: q.id, answer, attemptKey: attempt.current }));
    } catch {
      setResult({ error: "We couldn't reach the server. Your answer is still here. Try again." });
    } finally {
      setBusy(false);
    }
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
      <h2 id="q-h" className="m-0 text-[24px] font-normal leading-snug tracking-[-0.04em] [overflow-wrap:anywhere]">
        {q.q}
      </h2>
      <div className="rounded-2xl bg-canvas px-4 py-3">
        <p className="m-0 text-sm font-medium">Why this question</p>
        <p className="mt-1 mb-0 text-sm text-body [overflow-wrap:anywhere]">{q.why}</p>
      </div>
      <p className="m-0 text-sm text-muted">Tip: {q.tip}</p>
      <label htmlFor="answer" className="sr-only-abs">
        Your answer
      </label>
      <textarea
        id="answer"
        value={answer}
        maxLength={ANSWER_MAX}
        onChange={(e) => {
          setAnswer(e.target.value);
          setResult(null);
          attempt.current = null;
        }}
        rows={9}
        placeholder="Write your answer here…"
        className="w-full rounded-[14px] border border-edge bg-white p-3.5 text-[15px] leading-relaxed"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btn.primary} disabled={busy || answer.trim().length < ANSWER_MIN} onClick={submit}>
          {busy ? "Working…" : "Save and get feedback"}
        </button>
        <span className="text-[13px] text-subtle">{answer.trim() ? answer.trim().split(/\s+/).length : 0} words</span>
      </div>
      <p className="m-0 text-[13px] text-muted">Saving keeps your answer and its feedback in your account{applicationId ? ", on this application" : ""}. Only you can see them. Careers staff can&apos;t, and you can delete them at any time.</p>
      <div role="status" className="flex flex-col gap-3">
        {result?.error && <p className="m-0 rounded-2xl bg-canvas p-4 text-sm text-black">{result.error}</p>}
        {result?.saved && <p className="m-0 text-sm text-muted">Saved. You can find it under your saved answers.</p>}
        {result?.feedback && <FeedbackView feedback={result.feedback} />}
      </div>
    </section>
  );
}
