"use client";

import {
  Bar,
  Collapse,
  Count,
  Roll,
  Stage,
  States,
  Swap,
  Window,
  type Act,
} from "@/components/stageshow/kit";
import { scoreColor } from "@/components/ui";
import "./LineFixDemo.css";

// Offerpath line by line, as a margin note on the student's own CV. Beats:
// the pointer hovers the weak bullet and opens its note, the note names the
// reason and offers a rewrite with placeholders, the student fills in their
// own figures, Apply, the line changes in place on the CV, and the Impact
// score rolls up a beat later. Undo (with its keys) is the loop's reset.
//
// Built from close-up (one row whole, the rest placeholder lines, a window
// off the bottom) and table-edit (an edit committed in place, the total it
// feeds rolling after it). Sample data only: Jordan Reed is fictional.
//
// Real strings: the name, the section, the role, the weak line and its
// rewrite, the note's label and reason, Apply, Impact and its score.

type S = {
  hover: boolean;
  open: boolean;
  focus: "" | "a" | "b";
  a: string;
  b: string;
  applied: boolean;
  fixed: boolean;
  wash: boolean;
  impact: number;
};

const initial: S = {
  hover: false,
  open: false,
  focus: "",
  a: "",
  b: "",
  applied: false,
  fixed: false,
  wash: false,
  impact: 58,
};
const poster: S = {
  hover: false,
  open: true,
  focus: "",
  a: "40%",
  b: "one term",
  applied: true,
  fixed: true,
  wash: false,
  impact: 63,
};

const START = { wide: { x: 980, y: 540 }, compact: { x: 312, y: 560 } };

const BEFORE = "Responsible for the society’s social media accounts.";

async function script(a: Act<S>) {
  await a.wait(900);
  a.mark("hover");
  await a.move({ at: "line", x: 0.82, y: 0.6 });
  a.put({ hover: true });
  await a.wait(350);
  await a.click({ at: "line", x: 0.82, y: 0.6 });
  a.mark("open");
  a.put({ open: true });
  // Reading time for the reason before the hand moves on
  await a.wait(1500);
  a.mark("fill");
  await a.click({ at: "slot-a", x: 0.8, y: 0.75 });
  a.put({ focus: "a", hover: false });
  await a.wait(150);
  await a.type("a", "40%", { interval: 110 });
  await a.wait(250);
  await a.click({ at: "slot-b", x: 0.85, y: 0.75 });
  a.put({ focus: "b" });
  await a.wait(150);
  await a.type("b", "one term", { interval: 75 });
  await a.wait(350);
  a.mark("apply");
  await a.click({ at: "apply", x: 0.9, y: 0.78 });
  a.put({ focus: "", applied: true });
  await a.wait(350);
  a.put({ fixed: true, wash: true });
  // The cause lands on the CV, then the score it feeds rolls
  await a.wait(700);
  a.put({ impact: 63 });
  await a.move({ at: "apply", x: 1.7, y: 1.3 }, { duration: 700 });
  a.put({ wash: false });
  a.mark("payoff");
  await a.wait(2600);
  // Reset with a seen cause: the note closes, then Undo puts the line back
  a.mark("reset");
  a.put({ open: false });
  await a.wait(700);
  await a.key("cmd+z");
  a.put({ fixed: false, applied: false, impact: 58 });
  await a.wait(600);
  await a.snap({ a: "", b: "" });
  // Back to where it started, ready for the next pass
  await a.move(a.layout === "wide" ? START.wide : START.compact, {
    duration: 800,
  });
  await a.wait(300);
}

function Slot({
  name,
  value,
  hint,
  active,
}: {
  name: string;
  value: string;
  hint: string;
  active: boolean;
}) {
  return (
    <span
      className={`op-linefix-slot op-linefix-slot--${name}`}
      data-target={`slot-${name}`}
      data-cursor="ibeam"
      data-active={active || undefined}
      data-filled={value ? true : undefined}
    >
      <span className="op-linefix-slot__hint">{hint}</span>
      <span className="op-linefix-slot__val" data-typing>
        {value}
        <span className="op-linefix-caret" data-hide={!active || undefined} />
      </span>
    </span>
  );
}

function Note({ s }: { s: S }) {
  return (
    <div className="op-linefix-note" data-open={s.open || undefined}>
      <div className="op-linefix-note__head" data-target="note-head">
        <span className="op-linefix-mono op-linefix-note__label">
          <Roll>{`${s.applied ? "+5" : "\u22125"} IMPACT · EXPERIENCE, LINE 2`}</Roll>
        </span>
      </div>
      <Collapse open={s.open}>
        <div className="op-linefix-note__body">
          <div className="op-linefix-reason">
            No result shown. What changed because of your work?
          </div>
          <div className="op-linefix-rewrite">
            <div className="op-linefix-rewrite__text">
              Grew the society&rsquo;s Instagram by{" "}
              <Slot name="a" value={s.a} hint="[x%]" active={s.focus === "a"} />{" "}
              in{" "}
              <Slot
                name="b"
                value={s.b}
                hint="[time]"
                active={s.focus === "b"}
              />
              .
            </div>
            <div className="op-linefix-help">
              Numbers come from you. We never add facts.
            </div>
            <div className="op-linefix-actions">
              <span
                className="op-linefix-apply"
                data-target="apply"
                data-applied={s.applied || undefined}
              >
                <States
                  value={s.applied ? "done" : "apply"}
                  states={{
                    apply: (
                      <span className="op-linefix-apply__label">
                        Apply to CV
                      </span>
                    ),
                    done: (
                      <span className="op-linefix-apply__label">
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 14 14"
                          aria-hidden="true"
                        >
                          <path
                            d="M3 7.4l2.6 2.6L11 4.4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        Applied
                      </span>
                    ),
                  }}
                />
              </span>
            </div>
          </div>
        </div>
      </Collapse>
    </div>
  );
}

// Other points lost on this CV, named by line, quiet until opened
function Quiet({ hide }: { hide: boolean }) {
  return (
    <Collapse open={!hide}>
      <div className="op-linefix-more">
        {[
          ["\u22123", "CLARITY · EXPERIENCE, LINE 5"],
          ["\u22122", "LENGTH · EXPERIENCE, LINE 4"],
          ["\u22122", "SECTOR FIT · SKILLS"],
          ["\u22121", "SPELLING · EDUCATION, LINE 1"],
        ].map(([n, t]) => (
          <div
            key={t}
            className="op-linefix-more__row op-linefix-mono"
          >{`${n} ${t}`}</div>
        ))}
      </div>
    </Collapse>
  );
}

function Filler({ widths }: { widths: string[] }) {
  return (
    <div className="op-linefix-bullet">
      <span className="op-linefix-dot" />
      <span className="op-linefix-bars">
        {widths.map((w, i) => (
          <Bar key={i} w={w} h={6} tone={2} />
        ))}
      </span>
    </div>
  );
}

function Focal({ s }: { s: S }) {
  return (
    <div
      className="op-linefix-bullet op-linefix-focal"
      data-target="line"
      data-cursor="pointer"
      data-hover={s.hover || undefined}
      data-active={s.open || undefined}
      data-wash={s.wash || undefined}
      data-fixed={s.fixed || undefined}
    >
      <span className="op-linefix-dot op-linefix-dot--real">•</span>
      <span className="op-linefix-line">
        <Swap id={s.fixed ? "after" : "before"}>
          {s.fixed ? (
            <>
              Grew the society&rsquo;s Instagram by <b>40%</b> in{" "}
              <b>one term</b>.
            </>
          ) : (
            BEFORE
          )}
        </Swap>
      </span>
    </div>
  );
}

function Score({ s, inline }: { s: S; inline?: boolean }) {
  return (
    <div className="op-linefix-score" data-inline={inline || undefined}>
      <div className="op-linefix-score__top">
        <span className="op-linefix-score__name">Impact</span>
        <span className="op-linefix-score__num">
          <Count value={s.impact} duration={600} />
        </span>
      </div>
      <div className="op-linefix-track">
        <span className="op-linefix-fill" style={{ width: `${s.impact}%`, background: scoreColor(s.impact) }} />
      </div>
      <div className="op-linefix-mono op-linefix-score__note">
        AI-ASSISTED GUIDANCE
      </div>
    </div>
  );
}

export function LineFixDemo() {
  return (
    <div
      className="op-linefix-root"
      role="img"
      aria-label="Sample product preview: a fictional student's CV in Offerpath's line by line review. The bullet “Responsible for the society's social media accounts” is flagged −5 Impact because no result is shown; the suggested rewrite has placeholders the student fills with their own figures, giving “Grew the society's Instagram by 40% in one term”, which is applied to the CV and the Impact score rises from 58 to 63. Scores are AI-assisted guidance. Fictional data."
    >
      <Stage<S>
        width={1040}
        height={590}
        compact={{ below: 720, width: 358, height: 596 }}
        initial={initial}
        poster={poster}
        script={script}
        cursor={{ at: START }}
        keys={{ wide: "bottom-left", compact: "bottom" }}
        className="op-linefix"
      >
        {(s, _rect, layout) =>
          layout === "wide" ? (
            <Window url="offerpath.app/reviews" className="op-linefix-win">
              <div className="op-linefix-body">
                <div className="op-linefix-paper">
                  <div className="op-linefix-name">Jordan Reed</div>
                  <div className="op-linefix-contact">
                    <Bar w={92} h={6} tone={2} />
                    <Bar w={128} h={6} tone={2} />
                    <Bar w={74} h={6} tone={2} />
                  </div>
                  <div className="op-linefix-heading">EXPERIENCE</div>
                  <div className="op-linefix-role">
                    <span className="op-linefix-role__title">
                      Social Media Officer, Film Society
                    </span>
                    <Bar w={72} h={6} tone={2} />
                  </div>
                  <Filler widths={["88%", "46%"]} />
                  <Focal s={s} />
                  <Filler widths={["74%"]} />
                  <div className="op-linefix-role op-linefix-role--next">
                    <Bar w={196} h={7} tone={3} />
                    <Bar w={64} h={6} tone={2} />
                  </div>
                  <Filler widths={["92%", "38%"]} />
                  <Filler widths={["66%"]} />
                  <div className="op-linefix-heading op-linefix-heading--next">
                    EDUCATION
                  </div>
                  <div className="op-linefix-role">
                    <Bar w={170} h={7} tone={3} />
                    <Bar w={64} h={6} tone={2} />
                  </div>
                  <Filler widths={["58%"]} />
                </div>

                <div className="op-linefix-margin">
                  <Score s={s} />
                  <Note s={s} />
                  <Quiet hide={s.open} />
                </div>
              </div>
            </Window>
          ) : (
            <div className="op-linefix-stack">
              <div className="op-linefix-card">
                <div className="op-linefix-mono op-linefix-where">
                  EXPERIENCE · SOCIAL MEDIA OFFICER
                </div>
                <Filler widths={["86%", "40%"]} />
                <Focal s={s} />
                <Filler widths={["70%"]} />
                <div className="op-linefix-card__score">
                  <Score s={s} inline />
                </div>
              </div>
              <Note s={s} />
              <Quiet hide={s.open} />
            </div>
          )
        }
      </Stage>
    </div>
  );
}
