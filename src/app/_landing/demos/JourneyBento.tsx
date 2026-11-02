"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Bar, Collapse, Count, Icon, Roll, Stage, States, Toggle, Window, useReducedMotion } from "@/components/stageshow/kit"
import type { Act, Layout } from "@/components/stageshow/kit"
import { scoreColor } from "@/components/ui"
import "./JourneyBento.css"

// Offerpath, "02 · The whole journey": a bento set under the five-step row.
// Sample data only (a fictional student, fictional employers).
//
//   Tile       Span   Kind        The one thing                         Moves (once, in view)
//   Score      2 × 1  Hero UI     Readiness Score 68 and its six areas  the ring fills, the bars grow
//   Match      1 × 1  Stat        "81" job match, the one brand tile    counts up from 54
//   Letter     1 × 1  Object      the letter's sign-off                 "faithfully" rolls to "sincerely"
//   Tracker    1 × 1  Component   the visa sponsorship filter           the toggle turns on, a row leaves
//   Practice   1 × 1  Component   one interview answer's feedback       three verdicts arrive
//
// One window in the set (the hero's). Each picture is its own Stage at 1:1,
// pinned to its tile's bottom; the copy is page text. Tiles play one beat
// each, 110ms apart in reading order.

const STEP = 110
const LEAD = 450

type Beat = { on: boolean }
const before: Beat = { on: false }
const after: Beat = { on: true }
const beat = (i: number) => async (a: Act<Beat>) => {
  await a.wait(LEAD + i * STEP)
  await a.set({ on: true })
}

function usePictureWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(340)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const measure = () => setWidth(Math.max(1, Math.round(node.getBoundingClientRect().width)))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

function useInView<T extends Element>(delay: number) {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let t = 0
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return
        io.disconnect()
        t = window.setTimeout(() => setSeen(true), delay)
      },
      { threshold: 0.4 },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      clearTimeout(t)
    }
  }, [delay])
  return [ref, seen] as const
}

function Tile({ area, title, children, picture, tone }: { area: string; title?: ReactNode; children?: ReactNode; picture?: ReactNode; tone?: 'brand' | 'mint' }) {
  return (
    <section className={`op-journey-tile op-journey-tile--${area}`} data-tone={tone} data-crop>
      {title ? (
        <p className="op-journey-copy">
          {title} {children}
        </p>
      ) : (
        children
      )}
      {/* The picture is decoration beside the copy; screen readers get the copy only. */}
      <div aria-hidden="true" style={{ display: 'contents' }}>
        {picture}
      </div>
    </section>
  )
}

/* ---------------- Score (hero) ---------------- */

const AREAS: [string, number][] = [
  ['Impact', 58],
  ['Clarity', 72],
  ['Structure and ATS', 80],
  ['Sector fit', 61],
  ['Spelling and grammar', 92],
  ['Length and formatting', 74],
]
const SCORE = 68
// The last upload scored 61: the ring and number move up to this upload's 68
const PREVIOUS = 61
const RING = 2 * Math.PI * 50

function Ring({ on, size }: { on: boolean; size: number }) {
  return (
    <div className="op-journey-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden>
        <circle cx="60" cy="60" r="50" fill="none" stroke="#eef2ef" strokeWidth="9" />
        <circle
          className="op-journey-ring-fill"
          cx="60"
          cy="60"
          r="50"
          fill="none"
          stroke={scoreColor(on ? SCORE : PREVIOUS)}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={RING}
          strokeDashoffset={RING * (1 - (on ? SCORE : PREVIOUS) / 100)}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <span className="op-journey-ring-text">
        <span className="op-journey-ring-num">
          <Count value={on ? SCORE : PREVIOUS} duration={900} />
        </span>
        <span className="op-journey-ring-of">of 100</span>
      </span>
    </div>
  )
}

function Areas() {
  return (
    <div className="op-journey-areas">
      {AREAS.map(([name, v]) => (
        <div key={name} className="op-journey-area">
          <span className="op-journey-area-name">{name}</span>
          <span className="op-journey-area-track">
            <span className="op-journey-area-fill" data-strong={v >= 75 || undefined} style={{ background: scoreColor(v), transform: `scaleX(${v / 100})` }} />
          </span>
          <span className="op-journey-area-v">{v}</span>
        </div>
      ))}
    </div>
  )
}

function ScoreCard({ on, layout }: { on: boolean; layout: Layout }) {
  const head = (
    <>
      <span className="op-journey-label">Readiness score · up 7</span>
      <span className="op-journey-band">Getting there</span>
    </>
  )
  if (layout === 'compact')
    return (
      <div className="op-journey-card op-journey-score op-journey-score--compact">
        <div className="op-journey-score-top">
          <Ring on={on} size={92} />
          <div className="op-journey-score-head op-journey-score-head--stack">{head}</div>
        </div>
        <Areas />
      </div>
    )
  return (
    <div className="op-journey-card op-journey-score">
      <div className="op-journey-score-head">{head}</div>
      <div className="op-journey-score-body">
        <Ring on={on} size={112} />
        <Areas />
      </div>
    </div>
  )
}

function LineCard() {
  return (
    <div className="op-journey-card op-journey-line">
      <span className="op-journey-label op-journey-label--brand">−4 impact · line 6</span>
      <p className="op-journey-line-was">Supported the team with weekly reporting in Excel.</p>
      <p className="op-journey-line-now">
        Built a weekly Excel report for a team of <span className="op-journey-fill">6</span>, cutting prep time by <span className="op-journey-fill">3 hours</span>.
      </p>
      <span className="op-journey-line-rest">
        <Bar w={92} h={30} r={15} tone={2} />
        <Bar w={70} h={30} r={15} tone={1} />
      </span>
    </div>
  )
}

function Score() {
  const [picture, width] = usePictureWidth()
  const wide = width >= 720
  return (
    <Tile
      area="score"
      title={<b>A Readiness Score out of 100.</b>}
      picture={
        <div ref={picture} className="op-journey-picture op-journey-picture--full">
          <Stage<Beat> width={width} height={wide ? 330 : 380} initial={before} poster={after} play="once" script={beat(0)} className="op-journey-stage">
            {(s) => (
              <Window url="offerpath.app/dashboard" className={`op-journey-window${wide ? '' : ' op-journey-window--compact'}`} body={{ 'data-crop': '' }}>
                <div className="op-journey-cards">
                  <ScoreCard on={s.on} layout={wide ? 'wide' : 'compact'} />
                  {wide && <LineCard />}
                </div>
              </Window>
            )}
          </Stage>
        </div>
      }
    >
      Across six areas, with the exact line behind every point lost.
    </Tile>
  )
}

/* ---------------- Match (stat) ---------------- */

function Match() {
  const reduced = useReducedMotion()
  const [ref, seen] = useInView<HTMLDivElement>(LEAD + STEP)
  return (
    <Tile area="match" tone="brand">
      <div ref={ref} className="op-journey-stat">
        <span className="op-journey-stat-lead">
          <b>Tailor to a job.</b> Paste the ad and see your match.
        </span>
        <span className="op-journey-stat-number">
          <span aria-hidden="true">
            <Count value={seen || reduced ? 81 : 54} duration={1300} />
          </span>
          <span className="sr-only-abs">81%</span>
        </span>
        <span className="op-journey-stat-label">Job match after adding three missing keywords, up from 54.</span>
      </div>
    </Tile>
  )
}

/* ---------------- Letter (object) ---------------- */

function Letter() {
  const [picture, width] = usePictureWidth()
  return (
    <Tile
      area="letter"
      title={<b>Cover letters.</b>}
      picture={
        <div ref={picture} className="op-journey-picture op-journey-picture--full">
          <Stage<Beat> width={width} height={200} initial={before} poster={after} play="once" script={beat(2)} className="op-journey-stage">
            {(s) => (
              <div className="op-journey-sheet" data-on={s.on || undefined}>
                <span className="op-journey-sheet-greet">Dear Ms Okafor,</span>
                <span className="op-journey-sheet-lines" aria-hidden>
                  <Bar w="96%" h={5} tone={2} />
                  <Bar w="88%" h={5} tone={2} />
                  <Bar w="62%" h={5} tone={2} />
                </span>
                <span className="op-journey-sheet-sign">
                  <span>Yours</span>
                  <span className="op-journey-sheet-word">
                    <Roll>{s.on ? 'sincerely,' : 'faithfully,'}</Roll>
                  </span>
                </span>
                <span className="op-journey-sheet-name">Jordan Reed</span>
                <span className="op-journey-check" data-on={s.on || undefined}>
                  <States
                    value={s.on ? 'done' : 'ask'}
                    states={{
                      ask: (
                        <span className="op-journey-check-in">
                          <span className="op-journey-check-dot" /> Sign-off to fix
                        </span>
                      ),
                      done: (
                        <span className="op-journey-check-in">
                          <Icon name="check" size={14} filled /> Sign-off fixed
                        </span>
                      ),
                    }}
                  />
                </span>
              </div>
            )}
          </Stage>
        </div>
      }
    >
      Checked against the job ad and UK conventions.
    </Tile>
  )
}

/* ---------------- Tracker (component) ---------------- */

const ROLES = [
  { role: 'Risk Summer Internship', org: 'Calder Capital', due: '18 NOV', sponsors: true },
  { role: 'Industrial Placement', org: 'Brightwater Energy', due: '21 NOV', sponsors: false },
  { role: 'Consulting Internship', org: 'Ashby & Co', due: '22 NOV', sponsors: true },
]

function Tracker() {
  const [picture, width] = usePictureWidth()
  return (
    <Tile
      area="tracker"
      title={<b>Opportunities tracker.</b>}
      picture={
        <div ref={picture} className="op-journey-picture op-journey-picture--full">
          <Stage<Beat> width={width} height={216} initial={before} poster={after} play="once" script={beat(3)} className="op-journey-stage">
            {(s) => (
              <div className="op-journey-list">
                <div className="op-journey-filter">
                  <span className="op-journey-filter-name">Visa sponsorship</span>
                  <Toggle on={s.on} className="op-journey-toggle" />
                </div>
                {ROLES.map((r) => (
                  <Collapse key={r.role} open={!s.on || r.sponsors}>
                    <div className="op-journey-role">
                      <span className="op-journey-role-text">
                        <span className="op-journey-role-name">{r.role}</span>
                        <span className="op-journey-role-org">{r.org}</span>
                      </span>
                      <span className="op-journey-role-due">{r.due}</span>
                    </div>
                  </Collapse>
                ))}
                <div className="op-journey-role" aria-hidden>
                  <span className="op-journey-role-text">
                    <Bar w={128} h={6} tone={3} />
                    <Bar w={84} h={5} tone={2} />
                  </span>
                  <Bar w={44} h={6} tone={2} />
                </div>
              </div>
            )}
          </Stage>
        </div>
      }
    >
      Grad schemes, spring weeks and placements, sorted by deadline.
    </Tile>
  )
}

/* ---------------- Practice (component) ---------------- */

const VERDICTS = [
  { name: 'Structure', ok: true, w: 94 },
  { name: 'Detail', ok: false, w: 72 },
  { name: 'Length', ok: true, w: 80 },
]

function Practice() {
  const [picture, width] = usePictureWidth()
  return (
    <Tile
      area="practice"
      tone="mint"
      title={<b>Tests and interviews.</b>}
      picture={
        <div ref={picture} className="op-journey-picture op-journey-picture--full">
          <Stage<Beat> width={width} height={200} initial={before} poster={after} play="once" script={beat(4)} className="op-journey-stage">
            {(s) => (
              <div className="op-journey-answer" data-on={s.on || undefined}>
                <span className="op-journey-label">Interview practice · Finance</span>
                <span className="op-journey-question">Why do you want to work in risk?</span>
                <span className="op-journey-verdicts">
                  {VERDICTS.map((v, i) => (
                    <span key={v.name} className="op-journey-verdict" data-ok={v.ok || undefined} style={{ width: v.w, transitionDelay: `${i * 90}ms` }}>
                      {v.ok ? <Icon name="check" size={14} filled /> : <span className="op-journey-verdict-dot" />}
                      {v.name}
                    </span>
                  ))}
                </span>
                <span className="op-journey-answer-rest" aria-hidden>
                  <Bar w="90%" h={5} tone={2} />
                  <Bar w="70%" h={5} tone={2} />
                </span>
              </div>
            )}
          </Stage>
        </div>
      }
    >
      Timed aptitude sets, and feedback on every answer.
    </Tile>
  )
}

export function JourneyBento() {
  return (
    <div className="op-journey">
      <div className="op-journey-grid">
        <Score />
        <Match />
        <Letter />
        <Tracker />
        <Practice />
      </div>
    </div>
  )
}

