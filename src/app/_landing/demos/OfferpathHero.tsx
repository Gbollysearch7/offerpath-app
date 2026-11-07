"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { Bar, Collapse, Count, Phone, Stage, States, Window, type Act, type Layout, type Point } from "@/components/stageshow/kit"
import { scoreColor } from "@/components/ui"
import "./OfferpathHero.css"

// Offerpath's landing hero, full width under the headline on a white page.
// Jordan's CV is carried in from the desktop and dropped on the Upload screen;
// the drop zone reads it (a short analysing state), then the page turns to the
// Overview: the Readiness Score rolls up to 68 and the six area bars fill.
// Line 6 of the CV is highlighted as costing 4 Impact points; a rewrite opens
// under it with two empty slots, Jordan types their own figures (12, 400+)
// and uses it. The Impact bar grows, the score rolls to 72, still Getting
// there. Re-score CV in the top bar takes the loop back to Upload.
//
// Sample data only: a fictional student. The rewrite never invents numbers,
// so the figures are typed by the student, as the product asks.

type Ghost = { on: boolean; dropped: boolean; at: Point }
type S = {
  page: 'upload' | 'results'
  ghost: Ghost
  reading: boolean
  step: number
  progress: number
  scored: boolean
  flagged: boolean
  rewrite: boolean
  focus: 0 | 1 | 2
  n1: string
  n2: string
  applied: boolean
}

const initial: S = {
  page: 'upload',
  ghost: { on: false, dropped: false, at: { x: 0, y: 0 } },
  reading: false,
  step: 0,
  progress: 0,
  scored: false,
  flagged: false,
  rewrite: false,
  focus: 0,
  n1: '',
  n2: '',
  applied: false,
}

const POSTER: S = { ...initial, page: 'results', scored: true, flagged: true, rewrite: true, n1: '12', n2: '400+', applied: true }

const FILE = 'Jordan_Reed_CV.pdf'
// Matches the upload page's checklist (src/app/upload/page.tsx).
const GUIDES = ['PDF or Word, up to 2 MB', 'Selectable text, not a scan', 'Just your CV, no extra pages', 'Written in English']
const STEPS = ['Reading your file', 'Finding your sections', 'Scoring 16 bullet points', 'Ranking your fixes']
const AREAS: [string, number][] = [
  ['Impact', 58],
  ['Clarity', 72],
  ['Structure and readability', 80],
  ['Sector fit', 61],
  ['UK spelling and consistency', 92],
  ['Length and formatting', 74],
]

// Where the drag image is held: the hand sits over the file icon
const GRAB = { x: 22, y: 22 }
// Off the right edge, where the desktop is: the hand fetches the file from here
const OFF: Record<Layout, Point> = { wide: { x: 1280, y: 430 }, compact: { x: 300, y: 330 } }

async function script(a: Act<S>) {
  const compact = a.layout === 'compact'
  const off = OFF[a.layout]

  // 1. Jordan's CV comes in from the desktop, held by its icon. On a phone
  //    there is no desktop: Choose a file is tapped instead
  a.mark('carry')
  if (compact) {
    a.place(off)
    await a.wait(500)
    await a.click({ at: 'choose', x: 0.7, y: 0.6 })
    await a.set({ reading: true })
  } else {
    const zone = a.rect('zone')
    const drop = { x: zone.x + zone.width * 0.56, y: zone.y + zone.height * 0.56 }
    a.place(off)
    await a.wait(300)
    await a.set({ ghost: { on: true, dropped: false, at: off } })
    await a.move(drop, { duration: 1400, onMove: (at) => a.put({ ghost: { on: true, dropped: false, at } }) })
    await a.wait(160)

    // 2. Dropped: the drop zone reads it
    a.mark('drop')
    await a.click()
    await a.set((s) => ({ ghost: { ...s.ghost, dropped: true }, reading: true }))
    void a.move({ at: 'rest-upload', x: 0.5, y: 0.5 }, { duration: 900 })
  }
  await a.wait(240)
  await a.set({ progress: 0.18 })
  for (const [step, progress] of [[1, 0.42], [2, 0.7], [3, 1]] as const) {
    await a.wait(560)
    await a.set({ step, progress })
  }
  await a.wait(520)

  // 3. The Overview: the score rolls up, the area bars fill
  a.mark('results')
  await a.set({ page: 'results', scored: true })
  await a.wait(1800)

  // 4. Line 6 is flagged as costing Impact
  a.mark('flag')
  await a.set({ flagged: true })
  await a.wait(1000)

  // 5. The rewrite opens; the numbers come from Jordan
  a.mark('rewrite')
  await a.set({ rewrite: true })
  await a.wait(500)
  await a.click({ at: 'slot-1', x: 0.5, y: 0.6 })
  await a.set({ focus: 1 })
  await a.type('n1', '12', { interval: 110 })
  await a.wait(200)
  await a.click({ at: 'slot-2', x: 0.5, y: 0.6 })
  await a.set({ focus: 2 })
  await a.type('n2', '400+', { interval: 110 })
  await a.wait(260)

  // 6. Use it: Impact grows, the score rolls to 72
  a.mark('apply')
  if (!compact) {
    await a.move({ at: 'use', x: 0.78, y: 0.62 })
    await a.wait(120)
  }
  await a.click(compact ? { at: 'use', x: 0.7, y: 0.6 } : undefined)
  await a.set({ applied: true, focus: 0 })
  if (!compact) void a.move({ at: 'rest-results', x: 0.5, y: 0.5 }, { duration: 800 })
  await a.wait(2600)

  // 7. Re-score CV goes back to Upload, which is where the loop began
  a.mark('rescore')
  if (!compact) {
    await a.move({ at: 'rescore', x: 0.8, y: 0.62 })
    await a.wait(120)
  }
  await a.click(compact ? { at: 'rescore', x: 0.7, y: 0.6 } : undefined)
  await a.set({ page: 'upload', reading: false })
  await a.wait(420)
  await a.snap({ ...initial })
  if (!compact) await a.move(off, { duration: 700 })
  else {
    // A finger leaves no pointer behind, so it lifts from where it last tapped
    await a.wait(500)
    a.place(off)
  }
}

// The compact design is a phone, which takes a finger, not an arrow
const COMPACT_BELOW = 640
function useNarrow() {
  const ref = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < COMPACT_BELOW))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, narrow] as const
}

export function OfferpathHero() {
  const [ref, narrow] = useNarrow()
  return (
    <div ref={ref} className="op-hero-host" role="img" aria-label="Sample product preview with fictional data: a student's CV is uploaded, scored 68 out of 100, one weak line is rewritten with the student's own numbers, and the Readiness Score rises to 72.">
    <div aria-hidden="true">
    <Stage<S>
      width={1080}
      height={640}
      compact={{ below: COMPACT_BELOW, width: 358, height: 584 }}
      initial={initial}
      poster={POSTER}
      script={script}
      accent="#36604e"
      cursor={{ at: OFF, style: narrow ? 'touch' : 'real' }}
      className="op-hero"
    >
      {(s, _rect, layout) => <Scene s={s} layout={layout} />}
    </Stage>
    </div>
    </div>
  )
}

function Scene({ s, layout }: { s: S; layout: Layout }) {
  const compact = layout === 'compact'
  const app: ReactNode = (
    <>
      <TopBar compact={compact} />
      <div className="op-hero-pages">
        <div className="op-hero-page" data-on={s.page === 'upload' || undefined}>
          <Upload s={s} compact={compact} />
        </div>
        <div className="op-hero-page" data-on={s.page === 'results' || undefined}>
          <Results s={s} compact={compact} />
        </div>
      </div>
    </>
  )
  if (compact) {
    return (
      <Phone width={326} className="op-hero-phone">
        <div className="op-hero-body">
          {/* Safari's address bar: Offerpath is a website on the phone, not an app. */}
          <div className="op-hero-safari" aria-hidden>
            <span className="op-hero-safari__url">offerpath.app</span>
          </div>
          {app}
        </div>
      </Phone>
    )
  }
  return (
    <>
      <Window url="offerpath.app" urlShape="pill" className="op-hero-window" body={{ className: 'op-hero-body', 'data-crop': true }}>
        {app}
      </Window>
      <DragImage ghost={s.ghost} />
    </>
  )
}

function TopBar({ compact }: { compact: boolean }) {
  return (
    <div className="op-hero-top">
      <span className="op-hero-brand">
        <Logo />
        Offerpath
      </span>
      {!compact && (
        <span className="op-hero-nav">
          <span>Dashboard</span>
          <span data-on>CV review</span>
          <span>Tailor to a job</span>
          <span>Opportunities</span>
        </span>
      )}
      <span className="op-hero-top-end">
        <span className="op-hero-rescore" data-target="rescore" data-cursor="hand">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path d="M2.5 7a4.5 4.5 0 1 0 1.3-3.2M2.5 2v2.5H5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {compact ? 'Re-score' : 'Re-score CV'}
        </span>
        <span className="op-hero-avatar">JR</span>
      </span>
    </div>
  )
}

function Upload({ s, compact }: { s: S; compact: boolean }) {
  return (
    <div className="op-hero-upload">
      <div className="op-hero-head">
        <div className="op-hero-title">Upload your CV</div>
        {!compact && <div className="op-hero-sub">A Readiness Score out of 100 and line-by-line feedback in about 20 seconds.</div>}
      </div>
      <div className="op-hero-upgrid">
        <div className="op-hero-card op-hero-upcard">
          <div className="op-hero-label">YOUR CV</div>
          <div className="op-hero-zone" data-target="zone" data-drop data-reading={s.reading || undefined}>
            <States
              value={s.reading ? 'reading' : 'idle'}
              states={{
                idle: (
                  <span className="op-hero-zone-idle">
                    <svg className="op-hero-zone-icon" width="56" height="56" viewBox="0 0 56 56" aria-hidden>
                      <circle cx="28" cy="28" r="28" fill="#dce6df" />
                      <path d="M28 33V22M23 27l5-5 5 5M21 36h14" fill="none" stroke="#36604e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="op-hero-zone-title">Drop your CV here</span>
                    <span className="op-hero-zone-sub">PDF or Word, up to 2 MB</span>
                    <span className="op-hero-choose" data-target="choose" data-cursor="hand">Choose a file</span>
                  </span>
                ),
                reading: (
                  <span className="op-hero-reading">
                    <span className="op-hero-file">
                      <DocIcon />
                      <span className="op-hero-file-name">{FILE}</span>
                    </span>
                    <span className="op-hero-track">
                      <span className="op-hero-track-fill" style={{ transform: `scaleX(${s.progress})` }} />
                    </span>
                    <span className="op-hero-step">
                      <Spinner />
                      <States value={String(s.step)} align="start" states={Object.fromEntries(STEPS.map((t, i) => [String(i), <span key={t}>{t}</span>]))} />
                    </span>
                  </span>
                ),
              }}
            />
          </div>
          {!compact && (
            <div className="op-hero-fields">
              <div className="op-hero-field">
                <span className="op-hero-field-label">Target sector</span>
                <span className="op-hero-select">Finance and banking</span>
              </div>
              <div className="op-hero-field">
                <span className="op-hero-field-label">Stage</span>
                <span className="op-hero-select">Final year, graduate roles</span>
              </div>
            </div>
          )}
        </div>
        {!compact && (
          <div className="op-hero-aside">
            <div className="op-hero-card op-hero-guide">
              <div className="op-hero-label">BEFORE YOU UPLOAD</div>
              {GUIDES.map((g) => (
                <div className="op-hero-guide-row" key={g}>
                  <Tick />
                  {g}
                </div>
              ))}
            </div>
            <div className="op-hero-card op-hero-data">
              <div className="op-hero-data-title">Your data, your call</div>
              <div className="op-hero-data-copy">Only used to give you feedback. Your adviser can&apos;t see it unless you share it.</div>
            </div>
          </div>
        )}
        <span className="op-hero-rest" data-target="rest-upload" />
      </div>
    </div>
  )
}

function Results({ s, compact }: { s: S; compact: boolean }) {
  const score = s.applied ? 72 : s.scored ? 68 : 0
  const R = compact ? 46 : 52
  const C = 2 * Math.PI * R
  const size = (R + 8) * 2
  const areas = compact ? AREAS.slice(0, 1) : AREAS
  return (
    <div className="op-hero-results">
      <span className="op-hero-rest op-hero-rest--results" data-target="rest-results" />
      {!compact && (
        <div className="op-hero-head op-hero-head--row">
          <div className="op-hero-title">Overview</div>
          <div className="op-hero-sub">{`${FILE} · Finance and banking`}</div>
        </div>
      )}
      <div className="op-hero-grid">
        <div className="op-hero-card op-hero-score">
          <div className="op-hero-label">READINESS SCORE</div>
          <div className="op-hero-score-row">
            <span className="op-hero-ring" style={{ width: size, height: size }}>
              <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
                <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="#eef2ef" strokeWidth={compact ? 8 : 10} />
                <circle
                  className="op-hero-ring-arc"
                  cx={size / 2}
                  cy={size / 2}
                  r={R}
                  fill="none"
                  stroke={scoreColor(score)}
                  strokeWidth={compact ? 8 : 10}
                  strokeLinecap="round"
                  strokeDasharray={`${C} ${C}`}
                  strokeDashoffset={C * (1 - score / 100)}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                  data-applied={s.applied || undefined}
                />
              </svg>
              <span className="op-hero-ring-num">
                <Count value={score} duration={900} />
                <span className="op-hero-ring-of">OF 100</span>
              </span>
            </span>
            <span className="op-hero-score-side">
              <span className="op-hero-band" data-show={s.scored || undefined}>
                Getting there
              </span>
              <span className="op-hero-score-copy">Adding results to your bullets is the quickest way to reach Strong.</span>
            </span>
          </div>
          {compact && (
            <div className="op-hero-areas">
              <Area name="Impact" value={s.applied ? 66 : s.scored ? 58 : 0} i={0} grow={s.applied} />
            </div>
          )}
          {!compact && (
            <div className="op-hero-areas">
              {areas.map(([name, v], i) => (
                <Area key={name} name={name} i={i} grow={s.applied && i === 0} value={!s.scored ? 0 : i === 0 && s.applied ? 66 : v} />
              ))}
            </div>
          )}
        </div>

        <div className="op-hero-card op-hero-lines">
          <div className="op-hero-lines-head">
            <span className="op-hero-label">LINE BY LINE</span>
            {!compact && <span className="op-hero-label op-hero-label--quiet">LINE 6 OF 16</span>}
          </div>
          <div className="op-hero-line" data-flagged={s.flagged || undefined} data-applied={s.applied || undefined}>
            <div className="op-hero-line-tag">
              <States
                value={s.applied ? 'fixed' : s.flagged ? 'flag' : 'none'}
                align="start"
                states={{
                  none: <span className="op-hero-tag-quiet">EXPERIENCE, LINE 6</span>,
                  flag: <span>−4 IMPACT · EXPERIENCE, LINE 6</span>,
                  fixed: <span className="op-hero-tag-fixed">+4 IMPACT · FIX APPLIED</span>,
                }}
              />
            </div>
            <div className="op-hero-line-text">
              <span className="op-hero-mark">Helped organise events for the Economics Society.</span>
            </div>
            {!compact && (
              <div className="op-hero-checks">
                <Check fixed={s.applied} bad="No number or result" good="Number and result added" />
                <Check fixed={s.applied} bad="Weak opening verb" good="Strong opening verb" />
              </div>
            )}
          </div>
          <Collapse open={s.rewrite} reveal="drop">
            <div className="op-hero-rewrite">
              <div className="op-hero-lines-head">
                <span className="op-hero-label">SUGGESTED REWRITE</span>
                {!compact && <span className="op-hero-ai">AI-assisted guidance</span>}
              </div>
              <div className="op-hero-fix" data-applied={s.applied || undefined}>
                {/* On the phone the sentence wraps, so each run of words is its own box */}
                {compact ? <span>Organised</span> : 'Organised'} <Slot n={1} value={s.n1} focus={s.focus === 1} hint="no." /> {compact ? <span>society events for</span> : 'society events for'}{' '}
                <Slot n={2} value={s.n2} focus={s.focus === 2} hint="how many" /> {compact ? <span>students.</span> : 'students.'}
              </div>
              <div className="op-hero-actions">
                <span className="op-hero-use" data-target="use" data-cursor="hand" data-applied={s.applied || undefined}>
                  <States
                    value={s.applied ? 'done' : 'use'}
                    states={{
                      use: <span>Use this rewrite</span>,
                      done: (
                        <span className="op-hero-use-done">
                          <svg width="14" height="14" viewBox="0 0 22 22" aria-hidden>
                            <path d="M5 11.3l3.6 3.6 8-8.2" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          Applied
                        </span>
                      ),
                    }}
                  />
                </span>
                {!compact && <span className="op-hero-note">Your figures, with [brackets] where only you know the number.</span>}
              </div>
            </div>
          </Collapse>
          <div className="op-hero-next">
            {/* On the phone this row runs off the crop, so it is all filler there */}
            {compact ? <Bar w={56} h={7} tone={3} /> : <span className="op-hero-label op-hero-label--quiet">NEXT · LINE 7</span>}
            <Bar w={600} h={7} tone={2} />
          </div>
        </div>
      </div>
    </div>
  )
}

function Area({ name, value, i, grow }: { name: string; value: number; i: number; grow: boolean }) {
  return (
    <div className="op-hero-area" data-grow={grow || undefined}>
      <span className="op-hero-area-name">{name}</span>
      <span className="op-hero-area-track">
        <span className="op-hero-area-fill" data-zero={value === 0 || undefined} style={{ background: scoreColor(value), transform: `scaleX(${value / 100})`, transitionDelay: grow ? '0ms' : `${i * 70}ms` }} />
      </span>
      <span className="op-hero-area-val">
        <Count value={value} duration={800} />
      </span>
    </div>
  )
}

function Check({ fixed, bad, good }: { fixed: boolean; bad: string; good: string }) {
  return (
    <States
      className="op-hero-check"
      value={fixed ? 'good' : 'bad'}
      align="start"
      states={{
        bad: (
          <span className="op-hero-check-in">
            <Flag />
            {bad}
          </span>
        ),
        good: (
          <span className="op-hero-check-in">
            <Passed />
            {good}
          </span>
        ),
      }}
    />
  )
}

function Slot({ n, value, focus, hint }: { n: number; value: string; focus: boolean; hint: string }) {
  return (
    <span className="op-hero-slot" data-target={`slot-${n}`} data-cursor="ibeam" data-focus={focus || undefined} data-filled={value ? '' : undefined} data-typing>
      {value || <span className="op-hero-slot-hint">{hint}</span>}
      {focus && <span className="op-hero-caret" />}
    </span>
  )
}

function DragImage({ ghost }: { ghost: Ghost }) {
  const ref = useRef<HTMLDivElement>(null)
  const over = useRef<HTMLElement | null>(null)
  const following = ghost.on && !ghost.dropped
  const { x, y } = ghost.at
  useLayoutEffect(() => {
    const root = ref.current?.closest<HTMLElement>('.ss-stage')
    let next: HTMLElement | null = null
    if (following && root) {
      const box = root.getBoundingClientRect()
      const scale = box.width / root.offsetWidth || 1
      const hit = document.elementFromPoint(box.left + x * scale, box.top + y * scale)?.closest<HTMLElement>('[data-drop]') ?? null
      if (hit && root.contains(hit)) next = hit
    }
    if (next !== over.current) {
      over.current?.removeAttribute('data-over')
      next?.setAttribute('data-over', '')
      over.current = next
    }
  }, [following, x, y])
  useLayoutEffect(() => () => over.current?.removeAttribute('data-over'), [])
  return (
    <div ref={ref} className="op-hero-drag" data-show={following || undefined} data-dropped={ghost.dropped || undefined} style={{ transform: `translate(${x - GRAB.x}px, ${y - GRAB.y}px)` }} aria-hidden>
      <div className="op-hero-drag-inner" style={{ transformOrigin: `${GRAB.x}px ${GRAB.y}px` }}>
        <DocIcon />
        <span>{FILE}</span>
      </div>
    </div>
  )
}

// Offerpath's own marks, from the product's design files
function Logo() {
  return (
    <svg width="24" height="24" viewBox="0 0 28 28" aria-hidden>
      <circle cx="14" cy="14" r="14" fill="#dce6df" />
      <path d="M8 17l4-4 3 3 5-6" fill="none" stroke="#36604e" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function DocIcon() {
  return (
    <span className="op-hero-doc">
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
        <path d="M7 3.5h7l4 4v13H7zM10 12h5M10 16h3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

function Tick() {
  return (
    <svg width="16" height="16" viewBox="0 0 22 22" aria-hidden className="op-hero-tick">
      <path d="M5 11.3l3.6 3.6 8-8.2" fill="none" stroke="#36604e" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Flag() {
  return (
    <svg width="16" height="16" viewBox="0 0 22 22" aria-hidden className="op-hero-flag">
      <circle cx="11" cy="11" r="10" fill="#000" />
      <path d="M11 6.5v5M11 14.5v.3" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

function Passed() {
  return (
    <svg width="16" height="16" viewBox="0 0 22 22" aria-hidden className="op-hero-flag">
      <circle cx="11" cy="11" r="10" fill="#dce6df" />
      <path d="M6.8 11.3l2.8 2.8 5.6-5.8" fill="none" stroke="#36604e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg className="op-hero-spin" width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="#dce3de" strokeWidth="2.5" />
      <path d="M12 2.5a9.5 9.5 0 0 1 9.5 9.5" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

export default OfferpathHero
