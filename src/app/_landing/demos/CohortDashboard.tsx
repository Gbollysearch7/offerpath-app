"use client";

import { Bar, Collapse, Count, Icon, Roll, Segmented, Stage, Window, type Act } from '@/components/stageshow/kit'
import './CohortDashboard.css'

// Offerpath's careers dashboard for a fictional university, dark, in the
// "For universities" section of the landing page. Copied from dark-hero (a
// sidebar window inset top-left on black, depth from surface steps, one lit
// color), with chart-scrub's rolling readout for the breakdown and a page
// swap inside one window (chrome kept, only the body crossfades).
//
// Wide story, a loop:
// 1. The dashboard at rest: four KPI tiles, average score by faculty, and
//    the "May need a hand" card, which lists reasons with a count each.
// 2. The adviser switches the breakdown to Year of study: names crossfade, bars
//    ease, scores roll.
// 3. They press "See all" on May need a hand. The address gains
//    /students?f=needs, Students lights in the sidebar, and the Students
//    page arrives filtered to "May need a hand": four students by ID,
//    course and flag. That is the payoff and the poster.
// 4. Hold, then Dashboard in the sidebar: back to a fresh dashboard (its
//    breakdown on Faculty, reset while it was hidden).
//
// Compact story: the Students page alone. The "May need a hand" chip
// filters the list (unflagged students close out, flagged ones move up),
// hold, then "All students" brings them back.
//
// Every string matches the real admin (src/app/admin/page.tsx and
// src/app/admin/students/page.tsx); data is sample data.

type Page = 'dash' | 'students'
type S = { by: 0 | 1; page: Page; needs: boolean }

const initial: S = { by: 0, page: 'dash', needs: false }

const GROUPS: [string, number][][] = [
  [['Business', 74], ['Sciences', 72], ['Engineering', 70], ['Social sciences', 69], ['Arts and humanities', 66]],
  [['Year 1', 64], ['Year 2', 69], ['Year 3', 73], ['Year 4', 75], ['Postgraduate', 71]],
]

const KPIS = [
  { l: 'Active students', v: '1,240', d: '+180 this month', lit: false },
  { l: 'Average score', v: '71', d: 'Up from 57', lit: true },
  { l: 'CVs reviewed', v: '3,580', d: '2.9 per student', lit: false },
  { l: 'Applications tracked', v: '2,115', d: 'This term', lit: false },
]

const NEEDS: [number, string, string][] = [
  [34, 'Signed up but no CV uploaded', 'Over 3 weeks'],
  [22, 'Score not improving after 3 uploads', 'Mostly Impact'],
  [18, 'Deadline in 7 days, score under 50', 'Urgent'],
  [12, 'Inactive for 30 days', 'Final years'],
]

const FILTERS: [string, string][] = [['All students', '1,240'], ['May need a hand', '86'], ['Home', '812'], ['International', '428']]

type Student = { id: string; course: string; year: string; status: string; score: string; change: string; up: boolean; flag: string }
const STUDENTS: Student[] = [
  { id: '2104821', course: 'Economics', year: 'Year 3', status: 'Home', score: '68', change: '+19', up: true, flag: '' },
  { id: '2101776', course: 'History', year: 'Year 2', status: 'Home', score: '46', change: '+1', up: true, flag: 'Not improving' },
  { id: '2103390', course: 'Mechanical Engineering', year: 'Year 3', status: 'Home', score: '81', change: '+22', up: true, flag: '' },
  { id: '2209134', course: 'Law', year: 'Year 3', status: 'International', score: '–', change: '–', up: false, flag: 'No CV yet' },
  { id: '2207365', course: 'Physics', year: 'Year 4', status: 'International', score: '44', change: '+6', up: true, flag: 'Deadline soon' },
  { id: '2208812', course: 'Business Management', year: 'Year 2', status: 'International', score: '74', change: '+15', up: true, flag: '' },
  { id: '2102457', course: 'English Literature', year: 'Year 3', status: 'Home', score: '52', change: '0', up: false, flag: 'Inactive' },
]

const NAV = ['Dashboard', 'Students', 'Import student records', 'Opportunities', 'Careers team', 'Settings and SSO', 'Reports and exports']

// Where the cursor rests between loops, on empty surface
const REST = { wide: { x: 470, y: 318 }, compact: { x: 300, y: 128 } }

async function script(a: Act<S>) {
  if (a.layout === 'compact') {
    await a.wait(1000)
    a.mark('filter')
    await a.click({ at: 'chip-needs', x: 0.8, y: 0.62 })
    a.put({ needs: true })
    await a.move({ at: 'chip-needs', x: 0.6, y: -1.2 }, { duration: 600 })
    await a.wait(2800)
    a.mark('all')
    await a.click({ at: 'chip-all', x: 0.8, y: 0.62 })
    a.put({ needs: false })
    await a.move(REST.compact, { duration: 700 })
    await a.wait(1200)
    return
  }
  await a.wait(1100)
  a.mark('switch')
  await a.click({ at: 'by-course', x: 0.72, y: 0.62 })
  a.put({ by: 1 })
  await a.wait(1600)
  a.mark('see-all')
  await a.click({ at: 'see-all', x: 0.75, y: 0.62 })
  a.put({ page: 'students' })
  a.mark('students')
  // Off the list, to empty surface beside the chips
  await a.move({ at: 'chip-intl', x: 1, y: 0.5 }, { duration: 700, path: (e, f, t) => ({ x: f.x + (t.x - f.x) * e + 80 * e, y: f.y + (t.y - f.y) * e }) })
  await a.wait(2600)
  a.mark('back')
  // A fresh dashboard: its breakdown resets while it is hidden
  await a.snap({ by: 0 })
  await a.click({ at: 'nav-dashboard', x: 0.7, y: 0.6 })
  a.put({ page: 'dash' })
  await a.move(REST.wide, { duration: 900 })
  await a.wait(600)
}

// The stage has no ground of its own: it sits straight on the section's black
export function CohortDashboard() {
  return (
    <div
      className="op-cohort-root"
      role="img"
      aria-label="Sample product preview: Offerpath's careers dashboard for a fictional university. Tiles show 1,240 active students, an average score of 71 (up from 57), 3,580 CVs reviewed and 2,115 applications tracked. The average score breakdown switches from faculty to year of study, with groups under five students hidden. The May need a hand card lists 86 students by reason, such as 22 whose score is not improving after 3 uploads. Pressing See all opens the Students list filtered to May need a hand, showing students by ID, course, year, status, score and a flag such as Not improving, No CV yet or Deadline soon. Fictional data."
    >
    <div aria-hidden="true">
    <Stage<S>
      width={1080}
      height={620}
      compact={{ below: 760, width: 358, height: 356 }}
      theme="dark"
      initial={initial}
      poster={{ by: 1, page: 'students', needs: true }}
      script={script}
      cursor={{ at: { wide: REST.wide, compact: REST.compact } }}
      className="op-cohort"
    >
      {(s, _rect, layout) => {
        const compact = layout === 'compact'
        const page: Page = compact ? 'students' : s.page
        const needs = compact ? s.needs : true
        return (
          <Window
            url={
              <span className="op-cohort-url">
                offerpath.app/admin<Roll variant="fade">{page === 'dash' ? '' : needs ? '/students?f=needs' : '/students'}</Roll>
              </span>
            }
            className="op-cohort-win"
            sidebarWidth={196}
            sidebar={compact ? undefined : <Side page={page} />}
          >
            <div className="op-cohort-pages">
              {!compact && (
                <div className="op-cohort-page" data-on={page === 'dash' || undefined}>
                  <Dashboard by={s.by} />
                </div>
              )}
              <div className="op-cohort-page" data-on={page === 'students' || undefined}>
                <Students needs={needs} compact={compact} />
              </div>
            </div>
          </Window>
        )
      }}
    </Stage>
    </div>
    </div>
  )
}

export default CohortDashboard

function Dashboard({ by }: { by: 0 | 1 }) {
  const groups = GROUPS[by]!
  return (
    <div className="op-cohort-body">
      <header className="op-cohort-head">
        <div className="op-cohort-head__text">
          <div className="op-cohort-eyebrow">Sample data · Fictional university</div>
          <div className="op-cohort-title">Dashboard</div>
        </div>
        <div className="op-cohort-head__tools">
          <span className="op-cohort-pill">
            Autumn term 2026
            <Icon name="chevron-down" size={14} stroke={1.75} />
          </span>
          <span className="op-cohort-pill op-cohort-pill--solid">Export CSV</span>
        </div>
      </header>

      <div className="op-cohort-kpis">
        {KPIS.map(k => (
          <div key={k.l} className="op-cohort-kpi">
            <div className="op-cohort-kpi__l">{k.l}</div>
            <div className="op-cohort-kpi__v">{k.v}</div>
            <div className="op-cohort-kpi__d" data-lit={k.lit || undefined}>{k.d}</div>
          </div>
        ))}
      </div>

      <div className="op-cohort-grid">
        <section className="op-cohort-card op-cohort-break">
          <div className="op-cohort-eyebrow">Average score by</div>
          <Segmented className="op-cohort-seg" items={['Faculty', 'Year of study', 'Home vs intl']} value={by} targets={['by-faculty', 'by-course', undefined]} cursor="pointer" />
          <div className="op-cohort-bars">
            {groups.map(([, v], i) => (
              <div key={i} className="op-cohort-bar" style={{ ['--i' as string]: i }}>
                {/* Both sets of names stacked in one cell and crossfaded, so
                    no word is ever cut by an easing width */}
                <span className="op-cohort-bar__name">
                  {GROUPS.map((g, k) => (
                    <span key={k} data-on={k === by || undefined}>{g[i]![0]}</span>
                  ))}
                </span>
                <span className="op-cohort-bar__track">
                  <span className="op-cohort-bar__fill" style={{ width: `${v}%` }} />
                </span>
                <span className="op-cohort-bar__v"><Count value={v} duration={600} /></span>
              </div>
            ))}
          </div>
          <div className="op-cohort-note">Groups under five students are hidden</div>
        </section>

        <section className="op-cohort-card op-cohort-needs">
          <div className="op-cohort-needs__head">
            <div className="op-cohort-eyebrow">May need a hand · 86 students</div>
            <span className="op-cohort-link" data-target="see-all" data-cursor="pointer">See all</span>
          </div>
          {NEEDS.map(([n, why, hint]) => (
            <div key={why} className="op-cohort-reason">
              <span className="op-cohort-reason__n">{n}</span>
              <span className="op-cohort-reason__why">{why}</span>
              <span className="op-cohort-reason__hint">{hint}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}

function Students({ needs, compact }: { needs: boolean; compact: boolean }) {
  return (
    <div className="op-cohort-body">
      <header className="op-cohort-head__text">
        <div className="op-cohort-title">Students</div>
        <div className="op-cohort-intro">Sample data for a fictional university.</div>
      </header>

      {!compact && (
        <div className="op-cohort-search">
          <span className="op-cohort-field">
            <Icon name="search" size={14} stroke={1.75} />
            Search student ID or course
          </span>
          <span className="op-cohort-pill">
            All faculties
            <Icon name="chevron-down" size={14} stroke={1.75} />
          </span>
          <span className="op-cohort-pill op-cohort-pill--raised">Apply</span>
        </div>
      )}

      <div className="op-cohort-chips">
        {(compact ? FILTERS.slice(0, 2) : FILTERS).map(([label, n], i) => {
          const on = i === (needs ? 1 : 0)
          return (
            <span key={label} className="op-cohort-chip" data-on={on || undefined} data-target={['chip-all', 'chip-needs', undefined, 'chip-intl'][i]} data-cursor="pointer">
              {label}
              <span className="op-cohort-chip__n">{n}</span>
            </span>
          )
        })}
      </div>

      <section className="op-cohort-card op-cohort-table">
        {!compact && (
          <div className="op-cohort-tr op-cohort-tr--head">
            {['Student ID', 'Course', 'Year', 'Status', 'Score', 'Change', 'Flag'].map(h => (
              <span key={h}>{h}</span>
            ))}
          </div>
        )}
        {STUDENTS.map(r => (
          <Collapse key={r.id} open={!needs || !!r.flag}>
            {compact ? (
              <div className="op-cohort-tr">
                <span className="op-cohort-tr__who">
                  <span className="op-cohort-tr__id">{r.id}</span>
                  <span className="op-cohort-tr__course">{r.course}, {r.year}</span>
                </span>
                {r.flag ? <span className="op-cohort-flag">{r.flag}</span> : <span className="op-cohort-tr__score">{r.score}</span>}
              </div>
            ) : (
              <div className="op-cohort-tr">
                <span className="op-cohort-tr__id">{r.id}</span>
                <span className="op-cohort-tr__course">{r.course}</span>
                <span className="op-cohort-tr__muted">{r.year}</span>
                <span className="op-cohort-tr__muted">{r.status}</span>
                <span className="op-cohort-tr__num">{r.score}</span>
                <span className="op-cohort-tr__num" data-up={r.up || undefined}>{r.change}</span>
                <span>{r.flag && <span className="op-cohort-flag">{r.flag}</span>}</span>
              </div>
            )}
          </Collapse>
        ))}
        {!compact &&
          [180, 120, 150].map((w, i) => (
            <div key={i} className="op-cohort-tr op-cohort-tr--filler">
              <Bar w={56} h={7} r={3.5} tone={3} />
              <Bar w={w} h={7} r={3.5} tone={2} />
              <Bar w={40} h={7} r={3.5} tone={2} />
              <Bar w={56} h={7} r={3.5} tone={2} />
              <Bar w={18} h={7} r={3.5} tone={2} />
              <Bar w={18} h={7} r={3.5} tone={2} />
              <Bar w={84} h={22} r={11} tone={1} />
            </div>
          ))}
      </section>
    </div>
  )
}

function Side({ page }: { page: Page }) {
  return (
    <nav className="op-cohort-side">
      <div className="op-cohort-side__label">Careers admin</div>
      {NAV.map((label, i) => {
        const on = (i === 0 && page === 'dash') || (i === 1 && page === 'students')
        return (
          <span key={label} className="op-cohort-nav" data-active={on || undefined} data-target={i === 0 ? 'nav-dashboard' : undefined} data-cursor={i === 0 ? 'pointer' : undefined}>
            {label}
          </span>
        )
      })}
    </nav>
  )
}
