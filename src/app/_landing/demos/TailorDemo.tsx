"use client";

import {
  Count,
  Icon,
  Segmented,
  Spinner,
  Stage,
  States,
  type Act,
} from "@/components/stageshow/kit";
import "./TailorDemo.css";

// Offerpath's tailor screen at feature-card scale. Beats: a job ad is pasted
// into the field; its keywords come out as chips, found or missing, and the
// match ring fills to 54%; "Tailor my CV" is pressed and the view slides to
// the tailored line side by side; the missing keyword it now covers turns
// found and the ring rolls to 81%. Reset with a seen cause: back on the job
// ad, select all and delete, so the keywords and the match leave with it.
//
// Sample data only: a fictional student (Jordan Reed) and employer
// (Northbank). The tailored line rephrases what the CV already says; Power BI
// stays missing because the CV never mentions it.
//
// Real strings: the title, the pasted ad, four keywords, the match, the
// before and after line, the button.

type Btn = "idle" | "busy" | "again";
type S = {
  view: 0 | 1;
  focused: boolean;
  text: boolean;
  selected: boolean;
  extracted: boolean;
  covered: boolean;
  match: number;
  shown: boolean;
  btn: Btn;
};

const initial: S = {
  view: 0,
  focused: false,
  text: false,
  selected: false,
  extracted: false,
  covered: false,
  match: 54,
  shown: false,
  btn: "idle",
};
const poster: S = {
  view: 1,
  focused: false,
  text: true,
  selected: false,
  extracted: true,
  covered: true,
  match: 81,
  shown: true,
  btn: "again",
};

const AD =
  "You’ll analyse customer data in SQL and Excel, build dashboards in Power BI and share what you find with stakeholders across the business.";

const KEYWORDS: { word: string; found: boolean; covers?: boolean }[] = [
  { word: "SQL", found: true },
  { word: "Excel", found: true },
  { word: "Stakeholders", found: false, covers: true },
  { word: "Power BI", found: false },
];

const REST = { wide: { x: 452, y: 318 }, compact: { x: 318, y: 404 } };

async function script(a: Act<S>) {
  await a.wait(700);
  // 1. Paste the ad
  await a.move({ at: "field", x: 0.62, y: 0.42 });
  await a.click();
  a.put({ focused: true });
  await a.wait(350);
  a.mark("paste");
  await a.key("cmd+v");
  a.put({ text: true });
  await a.wait(250);
  // Off the words, between the tabs and the button it goes to next
  {
    const t = a.rect("tailor");
    await a.move({ x: t.x - 28, y: t.y + t.height / 2 });
  }
  await a.wait(200);
  // 2. Keywords and the match before tailoring
  a.mark("extract");
  a.put({ extracted: true, shown: true });
  await a.wait(1600);
  // 3. Tailor
  a.mark("tailor");
  await a.move({ at: "tailor", x: 0.8, y: 0.62 });
  await a.click();
  a.put({ btn: "busy", focused: false });
  await a.wait(1000);
  a.put({ view: 1, btn: "again" });
  await a.move({ at: "rest-tailored", x: 0.82, y: 0.07 });
  await a.wait(150);
  a.mark("payoff");
  a.put({ covered: true });
  await a.wait(300);
  a.put({ match: 81 });
  await a.wait(2800);
  // 4. Reset: back to the ad, select all, delete
  a.mark("reset");
  await a.move({ at: "tab-ad", x: 0.7, y: 0.6 });
  await a.click();
  a.put({ view: 0 });
  await a.wait(500);
  await a.move({ at: "field", x: 0.62, y: 0.42 });
  await a.click();
  a.put({ focused: true });
  await a.wait(250);
  await a.key("cmd+a");
  a.put({ selected: true });
  await a.wait(450);
  await a.key("backspace");
  a.put({
    text: false,
    selected: false,
    extracted: false,
    shown: false,
    btn: "idle",
  });
  await a.wait(700);
  // Hidden under the cleared match and the departed chips
  a.snap({ covered: false, match: 54 });
  await a.move(a.layout === "compact" ? REST.compact : REST.wide);
  a.put({ focused: false });
  await a.wait(300);
}

export function TailorDemo() {
  return (
    <div
      className="op-tailor-root"
      role="img"
      aria-label="Sample product preview: a job ad for a Graduate Data Analyst is pasted in, its keywords are marked found or missing, and the CV match rises from 54% to 81% once the tailored version is shown side by side."
    >
      <Stage
        width={520}
        height={340}
        compact={{ below: 520, width: 358, height: 420 }}
        initial={initial}
        poster={poster}
        script={script}
        cursor={{ at: REST }}
        keys="bottom-right"
        className="op-tailor"
      >
        {(s, _rect, layout) => (
          <div className="op-tailor-card">
            <div className="op-tailor-body">
              <div className="op-tailor-head">
                <div className="op-tailor-who">
                  <span className="op-tailor-eyebrow">TAILOR TO A JOB</span>
                  <span className="op-tailor-title">Graduate Data Analyst</span>
                  <span className="op-tailor-sub">
                    Northbank · Jordan_Reed_CV_v6.pdf
                  </span>
                </div>
                <div className="op-tailor-match">
                  <span className="op-tailor-match-label">MATCH</span>
                  <span
                    className="op-tailor-ring"
                    data-tailored={s.match > 54 || undefined}
                  >
                    <svg viewBox="0 0 64 64" aria-hidden="true">
                      <circle
                        cx="32"
                        cy="32"
                        r="27"
                        className="op-tailor-ring-track"
                      />
                      <circle
                        cx="32"
                        cy="32"
                        r="27"
                        className="op-tailor-ring-arc"
                        data-on={s.shown || undefined}
                        pathLength={100}
                        style={{
                          strokeDashoffset: s.shown ? 100 - s.match : 100,
                        }}
                      />
                    </svg>
                    <States
                      className="op-tailor-ring-value"
                      value={s.shown ? "n" : "dash"}
                      states={{
                        dash: <span className="op-tailor-dash">–</span>,
                        n: (
                          <Count
                            value={s.match}
                            format={(n) => `${Math.round(n)}%`}
                            duration={900}
                          />
                        ),
                      }}
                    />
                  </span>
                </div>
              </div>

              <div className="op-tailor-bar">
                <Segmented
                  className="op-tailor-tabs"
                  items={["Job ad", "Tailored CV"]}
                  value={s.view}
                  targets={["tab-ad", "tab-tailored"]}
                />
                <span
                  className="op-tailor-btn"
                  data-target="tailor"
                  data-busy={s.btn === "busy" || undefined}
                >
                  <States
                    value={s.btn}
                    states={{
                      idle: <span>Tailor my CV</span>,
                      busy: (
                        <span className="op-tailor-btn-busy">
                          <Spinner size={12} />
                          Tailoring…
                        </span>
                      ),
                      again: <span>Tailor again</span>,
                    }}
                  />
                </span>
              </div>

              <div className="op-tailor-pane">
                <div
                  className="op-tailor-view"
                  data-on={s.view === 0 || undefined}
                  aria-hidden={s.view !== 0}
                >
                  <div
                    className="op-tailor-field"
                    data-target="field"
                    data-cursor="ibeam"
                    data-focused={s.focused || undefined}
                  >
                    <span
                      className="op-tailor-placeholder"
                      data-on={!s.text || undefined}
                      data-typing
                    >
                      {s.focused && <span className="op-tailor-caret" />}
                      Paste the job ad text
                    </span>
                    <span
                      className="op-tailor-ad"
                      data-on={s.text || undefined}
                      data-snap
                    >
                      <span
                        className="op-tailor-ad-text"
                        data-selected={s.selected || undefined}
                      >
                        {AD}
                      </span>
                    </span>
                  </div>
                </div>
                <div
                  className="op-tailor-view"
                  data-on={s.view === 1 || undefined}
                  aria-hidden={s.view !== 1}
                >
                  <div className="op-tailor-sbs">
                    <div className="op-tailor-col">
                      <span className="op-tailor-col-label">YOUR CV</span>
                      <p className="op-tailor-before">
                        Used SQL and Excel to chart ticket sales for the society
                        committee.
                      </p>
                    </div>
                    <div className="op-tailor-col" data-target="rest-tailored">
                      <span className="op-tailor-col-label">TAILORED</span>
                      <p className="op-tailor-after">
                        <span>
                          Analysed ticket sales in SQL and Excel and shared the
                          charts with committee{" "}
                        </span>
                        <mark data-on={s.covered || undefined}>
                          stakeholders
                        </mark>
                        <span>.</span>
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <span className="op-tailor-keys-label">KEYWORDS IN THE AD</span>
              <div className="op-tailor-keys">
                <States
                  align="start"
                  value={s.extracted ? "chips" : "hint"}
                  states={{
                    hint: (
                      <span className="op-tailor-hint">
                        Keywords from the ad show up here
                      </span>
                    ),
                    chips: (
                      <div className="op-tailor-chips">
                        {(layout === "compact"
                          ? [KEYWORDS.slice(0, 2), KEYWORDS.slice(2)]
                          : [KEYWORDS]
                        ).map((row, r) => (
                          <div key={r} className="op-tailor-chip-row">
                            {row.map((k) => {
                              const i = KEYWORDS.indexOf(k);
                              const found = k.found || (k.covers && s.covered);
                              return (
                                <span
                                  key={k.word}
                                  className="op-tailor-chip"
                                  data-on={s.extracted || undefined}
                                  data-found={found || undefined}
                                  style={{
                                    ["--d" as string]: s.extracted
                                      ? `${i * 70}ms`
                                      : `${(KEYWORDS.length - 1 - i) * 50}ms`,
                                  }}
                                >
                                  <span className="op-tailor-chip-tick">
                                    <Icon name="check" size={12} stroke={2.2} />
                                  </span>
                                  <span className="op-tailor-chip-word">
                                    {k.word}
                                  </span>
                                </span>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    ),
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </Stage>
    </div>
  );
}

export default TailorDemo;
