import { AlertDot, CheckDot, cx } from "@/components/ui";
import { STRUCTURE_NOTE, type PracticeFeedback } from "@/lib/practice-types";

// Keeps the shape of an answer apart from what's in it. No overall mark, on purpose. Used straight after answering and on the saved list.

const LEVEL_LABEL: Record<PracticeFeedback["substance"]["level"], string> = { little: "Not much to go on yet", some: "Some real detail", concrete: "Details someone could ask about" };

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="m-0 text-[15px] font-medium">{children}</h3>;
}

function Dot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="mt-0.5 shrink-0">{ok ? <CheckDot label={label} /> : <AlertDot label={label} />}</span>
  );
}

function Quote({ children }: { children: string }) {
  return <blockquote className="m-0 border-l-2 border-edge pl-3 text-sm text-body [overflow-wrap:anywhere]">{children}</blockquote>;
}

export function FeedbackView({ feedback }: { feedback: PracticeFeedback }) {
  const open = feedback.unsupported.items;
  return (
    <div className="flex flex-col gap-5 rounded-2xl bg-canvas p-5">
      <section className="flex flex-col gap-2">
        <Heading>Substance: what&apos;s in the answer</Heading>
        <p className="m-0 text-[15px]">
          <span className="font-medium">{LEVEL_LABEL[feedback.substance.level]}.</span> <span className="text-body">{feedback.substance.summary}</span>
        </p>
        {feedback.substance.details.length > 0 && <p className="m-0 text-sm text-muted [overflow-wrap:anywhere]">Details we picked out: {feedback.substance.details.join(", ")}</p>}
      </section>

      {feedback.contribution.level !== "not_asked" && (
        <section className="flex flex-col gap-2">
          <Heading>Your contribution</Heading>
          <p className="m-0 text-[15px] text-body">{feedback.contribution.summary}</p>
          {feedback.contribution.quotes.map((q) => (
            <Quote key={q}>{q}</Quote>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <Heading>What the question asked</Heading>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {feedback.parts.map((p) => (
            <li key={p.id} className={cx("flex items-start gap-2.5 text-[15px]", p.seen ? "text-black" : "text-body")}>
              <Dot ok={p.seen} label={p.seen ? "Found" : "Not found"} />
              <span className="[overflow-wrap:anywhere]">
                {p.label}
                {!p.seen && " (we couldn't find this in your answer)"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <Heading>Claims to check</Heading>
        {!feedback.unsupported.compared && <p className="m-0 text-sm text-muted">This is general practice, so nothing was compared with your CV. We only looked at whether claims have something behind them in the answer itself.</p>}
        {open.length === 0 ? (
          <p className="m-0 text-[15px] text-body">Nothing flagged by our rules. They can miss things, so read it back yourself.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {open.map((c) => (
              <li key={`${c.kind}:${c.quote}`} className="text-[15px] text-body [overflow-wrap:anywhere]">
                {c.note}
              </li>
            ))}
          </ul>
        )}
      </section>

      {(feedback.clearer.length > 0 || feedback.modelNotes.length > 0) && (
        <section className="flex flex-col gap-2">
          <Heading>Ways to be clearer</Heading>
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[15px] text-body">
            {feedback.clearer.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          {feedback.modelNotes.map((n) => (
            <div key={`${n.quote}:${n.comment}`} className="flex flex-col gap-1">
              <Quote>{n.quote}</Quote>
              <p className="m-0 text-sm text-body">
                {n.comment} <span className="text-muted">(AI comment, checked by our rules. Check it yourself too.)</span>
              </p>
            </div>
          ))}
        </section>
      )}

      {feedback.ignoredSentences > 0 && <p className="m-0 text-sm text-muted">We left out part of your answer because it read like instructions to software rather than an answer.</p>}

      <section className="flex flex-col gap-2 border-t border-line pt-4">
        <Heading>Structure: the shape of the answer</Heading>
        <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0">
          {feedback.structure.map((s) => (
            <li key={s.key} className="flex items-center gap-2 text-sm">
              <Dot ok={s.seen} label={s.seen ? "Can see" : "Can't see"} />
              {s.label}
            </li>
          ))}
        </ul>
        <p className="m-0 text-[13px] text-muted">{STRUCTURE_NOTE}</p>
      </section>

      <p className="m-0 text-[13px] text-muted">
        {feedback.method === "rules" ? "From fixed rules that read your wording." : "From fixed rules that read your wording, with AI comments checked by those rules."} This can&apos;t tell whether your answer is right or true, or how an interviewer would react. It doesn&apos;t predict interview results, and no careers adviser has reviewed these rules yet.
      </p>
    </div>
  );
}
