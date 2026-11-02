"use client";

import { FileText, Inbox, Search, Send, Tag, File } from 'lucide-react'
import { Bar, Collapse, Stage, Text, Window, type Act, type Layout } from '@/components/stageshow/kit'
import './ProblemDemo.css'

// Offerpath, 01 · The problem: applying blind. A plain mail app, not
// Offerpath. The student's "Applications" folder fills with replies, one
// after another, each a thread carrying the same CV, each opening with
// "Unfortunately" and none saying why. Beside it, the careers service's
// review queue. A system story, no cursor. The replies run as a conveyor of
// seven: the oldest leaves under the crop as the newest opens at the top, so
// after seven arrivals the list is exactly where it began.

type Reply = { from: string; role: string; text: string }

const REPLIES: Reply[] = [
  { from: 'Calder & Finch', role: 'Graduate Analyst 2027', text: 'Unfortunately, on this occasion we will not be progressing your application.' },
  { from: 'Larkspur Partners', role: 'Spring Week 2027', text: 'Unfortunately, due to the volume of applications we cannot offer individual feedback.' },
  { from: 'Pellow & Hart', role: 'Summer Placement', text: 'Unfortunately, you have not been successful at this stage.' },
  { from: 'Ashby Morrow', role: 'Graduate Scheme, Finance', text: 'Unfortunately, we have decided not to move forward with your application.' },
  { from: 'Fernhill Group', role: 'Industrial Placement', text: "Unfortunately, we won't be taking your application further this time." },
  { from: 'Tidewell Energy', role: 'Graduate Analyst', text: 'Unfortunately, after careful consideration your application was unsuccessful.' },
  { from: 'Kestrel Lane', role: 'Spring Insight Week', text: 'Unfortunately, we are unable to offer you a place on this programme.' },
]
const P = REPLIES.length

type S = { n: number; opening: boolean; fresh: boolean }
const initial: S = { n: 0, opening: false, fresh: false }

async function script(a: Act<S>) {
  for (let i = 1; i <= P; i++) {
    await a.wait(i === 1 ? 1100 : 1050)
    a.mark(`reply-${i}`)
    // The oldest reply (hidden under the crop) becomes the newest, closed at the top
    await a.snap({ n: i, opening: true, fresh: true })
    await a.set({ opening: false })
    await a.wait(900)
    await a.set({ fresh: false })
  }
  // Seven arrivals later the list is the one we started with
  await a.wait(400)
  await a.snap({ n: 0 })
}

// Newest first: position k shows reply (n - 1 - k) mod P, so reply n-1 is on top
const order = (n: number) => Array.from({ length: P }, (_, k) => (((n - 1 - k) % P) + P * 2) % P)

function Chip() {
  return (
    <span className="op-problem-chip">
      <FileText size={13} strokeWidth={1.8} className="op-problem-chip__icon" aria-hidden />
      <span className="op-problem-chip__name">Jordan_Reed_CV.pdf</span>
    </span>
  )
}

function Row({ r, fresh }: { r: Reply; fresh: boolean }) {
  return (
    <div className="op-problem-row" data-fresh={fresh || undefined}>
      <div className="op-problem-row__top">
        <Text className="op-problem-row__from">{r.from}</Text>
        <Chip />
      </div>
      <div className="op-problem-row__line">
        <Text className="op-problem-row__role">{r.role}</Text>
        <span className="op-problem-row__text">{r.text}</span>
      </div>
    </div>
  )
}

function Sidebar() {
  const icon = { size: 15, strokeWidth: 1.7, className: 'op-problem-icon', 'aria-hidden': true } as const
  return (
    <div className="op-problem-side">
      <div className="op-problem-nav">
        <Inbox {...icon} />
        <Text className="op-problem-nav__label">Inbox</Text>
      </div>
      <div className="op-problem-nav" data-active>
        <Tag {...icon} />
        <Text className="op-problem-nav__label">Applications</Text>
      </div>
      <div className="op-problem-nav">
        <Send {...icon} />
        <Bar w={34} h={5} tone={3} />
      </div>
      <div className="op-problem-nav">
        <File {...icon} />
        <Bar w={44} h={5} tone={3} />
      </div>
      <div className="op-problem-section">
        <Bar w={40} h={5} tone={2} />
      </div>
      <div className="op-problem-nav">
        <Tag {...icon} />
        <Bar w={52} h={5} tone={3} />
      </div>
      <div className="op-problem-nav">
        <Tag {...icon} />
        <Bar w={38} h={5} tone={3} />
      </div>
      <div className="op-problem-nav">
        <Tag {...icon} />
        <Bar w={46} h={5} tone={3} />
      </div>
    </div>
  )
}

function Queue() {
  return (
    <div className="op-problem-queue">
      <p className="op-problem-queue__label">CAREERS SERVICE</p>
      <p className="op-problem-queue__title">CV review queue</p>
      <p className="op-problem-queue__stat">
        <span className="op-problem-queue__num">312</span>
        <span className="op-problem-queue__unit">CVs waiting</span>
      </p>
      <div className="op-problem-queue__foot">
        <span>Next appointment</span>
        <span className="op-problem-queue__when">in 3 weeks</span>
      </div>
    </div>
  )
}

function Scene({ s, layout }: { s: S; layout: Layout }) {
  const compact = layout === 'compact'
  const list = (
    <div className="op-problem-list">
      {order(s.n).map((idx, k) => (
        <Collapse key={idx} open={!(k === 0 && s.opening)}>
          <Row r={REPLIES[idx]} fresh={k === 0 && s.fresh} />
        </Collapse>
      ))}
    </div>
  )
  const toolbar = (
    <span className="op-problem-search">
      <Search size={14} strokeWidth={1.8} className="op-problem-icon" aria-hidden />
      {!compact && <Bar w={70} h={5} tone={2} />}
    </span>
  )
  const props = { title: 'Applications', toolbar, className: 'op-problem-window', body: { className: 'op-problem-body', 'data-crop': true } }
  return (
    <>
      {compact ? (
        <Window {...props}>{list}</Window>
      ) : (
        <Window {...props} sidebar={<Sidebar />} sidebarWidth={196}>
          {list}
        </Window>
      )}
      {!compact && <Queue />}
    </>
  )
}

export function ProblemDemo() {
  return (
    <div className="op-problem-root" role="img" aria-label="Sample illustration, not Offerpath: a student's mail folder called Applications, where reply after reply from fictional employers arrives for graduate schemes, spring weeks and placements, each sent with the same CV, Jordan_Reed_CV.pdf, and each beginning “Unfortunately” with no reason given. Beside it, a careers service card shows 312 CVs waiting for review and the next appointment in 3 weeks. Fictional data.">
    <div aria-hidden="true">
    <Stage<S>
      width={1040}
      height={456}
      compact={{ below: 640, width: 358, height: 340 }}
      initial={initial}
      poster={initial}
      script={script}
      accent="#36604e"
      className="op-problem"
    >
      {(s, _rect, layout) => <Scene s={s} layout={layout} />}
    </Stage>
    </div>
    </div>
  )
}
