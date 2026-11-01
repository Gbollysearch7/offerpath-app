"use client";

import {
  Bar,
  Collapse,
  Count,
  LockScreen,
  Notification,
  Phone,
  Stage,
  States,
  Text,
  Window,
  WALLPAPER,
  type Act,
} from "@/components/stageshow/kit";
import { useId } from "react";
import "./TrackerDemo.css";

// Offerpath's opportunities tracker as a device pair. The tracker window is
// pinned top-left and runs off the bottom; the phone straddles its right
// edge over the page's canvas margin, never over a card. Beats: the cursor
// turns on "Visa sponsorship" and the roles that don't sponsor collapse, the
// rest carrying up; it tracks Graduate Analyst at Northbridge Partners; then
// the deadline reminder lands on the lock screen as an email from Offerpath
// (the product sends reminders by email, for tracked roles closing within a
// week; it has no phone app). Reset: the email is cleared, the switch goes
// off and the role is untracked, both clicked.
//
// Real strings: the page title, the filter, the role cards (the list is the
// subject), the Track button and the email. Everything else is bars.

type S = { visa: boolean; tracked: boolean; note: boolean };

type Opp = {
  role: string;
  org: string;
  type: string;
  visa: boolean;
  closes: string;
  soon?: boolean;
};

const OPPS: Opp[] = [
  {
    role: "Spring Week, Markets",
    org: "Halden & Rowe · London",
    type: "SPRING WEEK",
    visa: false,
    closes: "11 Nov",
    soon: true,
  },
  {
    role: "Graduate Analyst",
    org: "Northbridge Partners · London",
    type: "GRADUATE SCHEME",
    visa: true,
    closes: "13 Nov",
    soon: true,
  },
  {
    role: "Technology Internship",
    org: "Quillon Systems · Leeds",
    type: "INTERNSHIP",
    visa: false,
    closes: "18 Nov",
    soon: true,
  },
  {
    role: "Engineering Placement",
    org: "Brackwater Energy · Bristol",
    type: "PLACEMENT",
    visa: true,
    closes: "24 Nov",
  },
  {
    role: "Graduate Auditor",
    org: "Linmoor & Pike · Birmingham",
    type: "GRADUATE SCHEME",
    visa: true,
    closes: "30 Nov",
  },
  {
    role: "Data Placement",
    org: "Fernhill Analytics · Manchester",
    type: "PLACEMENT",
    visa: true,
    closes: "1 Dec",
  },
];
const FOCUS = 1;
const PILL_ROWS = [
  ["All", "Graduate scheme"],
  ["Placement", "Spring week"],
  ["Internship"],
];

const REST = { wide: { x: 180, y: 505 }, compact: { x: 26, y: 300 } };

const initial: S = { visa: false, tracked: false, note: false };
const poster: S = { visa: true, tracked: true, note: true };

async function script(a: Act<S>) {
  await a.wait(700);
  a.mark("open");
  await a.move({ at: "visa", x: 0.5, y: 0.55 });
  await a.wait(150);
  await a.click({ at: "visa", x: 0.5, y: 0.55 });
  a.mark("filter");
  a.set({ visa: true });
  await a.wait(1500);
  await a.move({ at: "track", x: 0.82, y: 0.62 });
  await a.wait(150);
  await a.click({ at: "track", x: 0.82, y: 0.62 });
  a.mark("track");
  a.set({ tracked: true });
  await a.wait(700);
  a.mark("note");
  a.set({ note: true });
  await a.wait(3000);
  a.mark("payoff");
  // Reset: the email is cleared from the lock screen, then both clicks undone
  a.set({ note: false });
  await a.wait(500);
  const untrack = async () => {
    await a.move({ at: "track", x: 0.82, y: 0.62 });
    await a.click({ at: "track", x: 0.82, y: 0.62 });
    a.set({ tracked: false });
  };
  const visaOff = async () => {
    await a.move({ at: "visa", x: 0.5, y: 0.55 });
    await a.click({ at: "visa", x: 0.5, y: 0.55 });
    a.mark("reset");
    a.set({ visa: false });
  };
  // Wide: the switch first, then the role, now second in the list. Compact:
  // the role first, while it is still above the phone
  if (a.layout === "compact") {
    await untrack();
    await a.wait(500);
    await visaOff();
    await a.wait(1100);
  } else {
    await visaOff();
    await a.wait(1100);
    await untrack();
    await a.wait(500);
  }
  // Back to the resting point in the empty margin, where the loop opens
  await a.move(a.layout === "compact" ? REST.compact : REST.wide);
  await a.wait(300);
}

// The system Mail app's tile (Offerpath reminders arrive as email): one svg,
// the gradient tile with the kit's mail glyph centered on it
const MAIL =
  "M2.5 3h11A1.5 1.5 0 0 1 15 4.4L8 8.9 1 4.4A1.5 1.5 0 0 1 2.5 3ZM1 6.1v5.4A1.5 1.5 0 0 0 2.5 13h11a1.5 1.5 0 0 0 1.5-1.5V6.1l-6.6 4.2a.8.8 0 0 1-.8 0Z";

function MailIcon() {
  const id = `op-tracker-mail-${useId().replace(/:/g, "")}`;
  return (
    <svg
      viewBox="0 0 38 38"
      width="38"
      height="38"
      aria-hidden="true"
      className="op-tracker-mail"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1fa2ff" />
          <stop offset="1" stopColor="#0a6cf5" />
        </linearGradient>
      </defs>
      <rect width="38" height="38" fill={`url(#${id})`} />
      <path d={MAIL} fill="#fff" transform="translate(7.5 7.5) scale(1.4375)" />
    </svg>
  );
}

export function TrackerDemo() {
  return (
    <div
      className="op-tracker-root"
      role="img"
      aria-label="Sample product preview: the Offerpath opportunities tracker filters UK roles to those that sponsor visas, Jordan tracks the Graduate Analyst role at Northbridge Partners, and a deadline reminder email from Offerpath arrives on their phone a few days before it closes."
    >
      <Stage<S>
        width={1000}
        height={560}
        compact={{ below: 1000, width: 358, height: 600 }}
        initial={initial}
        poster={poster}
        script={script}
        cursor={{ at: REST }}
        className="op-tracker"
      >
        {(s, _rect, layout) => {
          const compact = layout === "compact";
          return (
            <>
              <div className="op-tracker-mask">
                <Window
                  url="offerpath.app/opportunities"
                  className="op-tracker-win"
                >
                  <div className="op-tracker-body">
                    <div className="op-tracker-head">
                      <div className="op-tracker-titles">
                        <div className="op-tracker-title">Opportunities</div>
                        {!compact && <Bar w={300} h={6} tone={2} />}
                      </div>
                      {!compact && (
                        <div className="op-tracker-tabs">
                          <span className="op-tracker-tab" data-on>
                            Browse
                          </span>
                          <span className="op-tracker-tab">
                            <span>My applications ·</span>
                            <Count value={s.tracked ? 3 : 2} />
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="op-tracker-cols">
                      <aside className="op-tracker-filters">
                        {!compact && (
                          <>
                            <div>
                              <div className="op-tracker-micro">TYPE</div>
                              <div className="op-tracker-pills">
                                {PILL_ROWS.map((row, r) => (
                                  <div key={r} className="op-tracker-pillrow">
                                    {row.map((t) => (
                                      <span
                                        key={t}
                                        className="op-tracker-pill"
                                        data-on={t === "All" || undefined}
                                      >
                                        {t}
                                      </span>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </>
                        )}
                        <div
                          className="op-tracker-switchrow"
                          data-first={compact || undefined}
                        >
                          <div className="op-tracker-switchtext">
                            <div className="op-tracker-switchlabel">
                              Visa sponsorship
                            </div>
                            <div className="op-tracker-switchhint">
                              Only show roles that sponsor
                            </div>
                          </div>
                          <span
                            className="op-tracker-switch"
                            data-on={s.visa || undefined}
                            data-target="visa"
                            data-cursor="pointer"
                            role="switch"
                            aria-checked={s.visa}
                          >
                            <span className="op-tracker-knob" />
                          </span>
                        </div>
                        {!compact && (
                          <>
                            <div className="op-tracker-switchrow">
                              <div className="op-tracker-switchlabel">
                                Closing in 30 days
                              </div>
                              <span
                                className="op-tracker-switch"
                                data-on
                                role="switch"
                                aria-checked
                              >
                                <span className="op-tracker-knob" />
                              </span>
                            </div>
                            <div className="op-tracker-fine">
                              <Bar w={150} h={5} tone={2} />
                              <Bar w={112} h={5} tone={2} />
                            </div>
                          </>
                        )}
                      </aside>

                      <section className="op-tracker-results">
                        <div className="op-tracker-count">
                          <Count value={s.visa ? 11 : 18} />
                          <span className="op-tracker-countword">
                            opportunities · sorted by deadline
                          </span>
                        </div>
                        {OPPS.map((o, i) => (
                          <Collapse
                            key={o.role}
                            open={!s.visa || o.visa}
                            className="op-tracker-slot"
                          >
                            <article className="op-tracker-card">
                              <span className="op-tracker-tile">
                                {o.org.charAt(0)}
                              </span>
                              <div className="op-tracker-main">
                                <div className="op-tracker-role">{o.role}</div>
                                <div className="op-tracker-org">
                                  {compact ? o.org.split(" · ")[0] : o.org}
                                </div>
                                <div className="op-tracker-chips">
                                  {!(compact && o.visa) && (
                                    <span className="op-tracker-chip">
                                      {o.type}
                                    </span>
                                  )}
                                  {o.visa && (
                                    <span className="op-tracker-chip" data-visa>
                                      SPONSORS VISAS
                                    </span>
                                  )}
                                </div>
                              </div>
                              {!compact && (
                                <div className="op-tracker-closes">
                                  <div className="op-tracker-closeslabel">
                                    Closes
                                  </div>
                                  <div
                                    className="op-tracker-date"
                                    data-soon={o.soon || undefined}
                                  >
                                    {o.closes}
                                  </div>
                                </div>
                              )}
                              {i === FOCUS ? (
                                <span
                                  className="op-tracker-btn"
                                  data-on={s.tracked || undefined}
                                  data-target="track"
                                >
                                  <States
                                    value={s.tracked ? "on" : "off"}
                                    states={{ off: "Track", on: "Tracking" }}
                                  />
                                </span>
                              ) : (
                                <span className="op-tracker-btn">
                                  <Text>Track</Text>
                                </span>
                              )}
                            </article>
                          </Collapse>
                        ))}
                      </section>
                    </div>
                  </div>
                </Window>
              </div>

              <Phone
                width={compact ? 300 : 250}
                frame="pro"
                dark
                wallpaper={WALLPAPER}
                time="8:02"
                className="op-tracker-phone"
              >
                <LockScreen
                  size="satellite"
                  stack="top"
                  date="Monday 9 November"
                  time="8:02"
                >
                  <Notification
                    className="op-tracker-note"
                    data-show={s.note || undefined}
                    icon={<MailIcon />}
                    title="Offerpath"
                    body={
                      <>
                        <span className="op-tracker-subject">
                          Northbridge Partners closes Friday 13 November
                        </span>
                        Hi Jordan, you&rsquo;re tracking a role that closes
                        within a week.
                      </>
                    }
                  />
                </LockScreen>
              </Phone>
            </>
          );
        }}
      </Stage>
    </div>
  );
}
