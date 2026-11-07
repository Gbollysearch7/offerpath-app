import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui";
import { PilotForm } from "./PilotForm";
import { CohortDashboard } from "./demos/CohortDashboard";
import { LineFixDemo } from "./demos/LineFixDemo";
import { OfferpathHero } from "./demos/OfferpathHero";
import { PrivacyCard } from "./demos/PrivacyCard";
import { ProblemDemo } from "./demos/ProblemDemo";
import { TailorDemo } from "./demos/TailorDemo";
import { TrackerDemo } from "./demos/TrackerDemo";

// Public marketing page (design: Landing_v2). Claims here must match what the product actually does.

const ICONS = {
  letter: "M3.5 6.5h17v11h-17zM3.5 7l8.5 6 8.5-6",
  doc: "M7 3.5h7l4 4v13H7zM10 12h5M10 16h3.5",
  trend: "M4 17l5-5 4 4 7-8M15 8h5v5",
};

const MARQUEE = ["Graduate schemes", "Spring weeks", "Placements", "Internships", "Visa sponsorship filter", "Deadline reminders"];

const PROBLEMS = [
  ["One CV", "sent to every role", "Students send the same generic CV to role after role, and rarely learn why they were rejected."],
  ["Every CV", "is more than a team can read", "Careers teams are small next to their student numbers, so many students apply without line-by-line feedback."],
  ["US-first", "tools that stop at a score", "Many tools ignore UK grad schemes, spring weeks and placements, or give a number with no next step."],
];

const JOURNEY: [string, string, string, boolean][] = [
  ["01", "CV", "Readiness Score with line-level fixes.", true],
  ["02", "Applications", "Tailor to each job, cover letters and a deadline tracker.", true],
  ["03", "Tests", "Numerical, verbal and logical practice sets.", true],
  ["04", "Interviews", "Practice questions with instant feedback on structure.", true],
  ["05", "Offer", "Outcome tracking for students and universities.", false],
];

// Features with their own animated demo, shown beside their copy.
const SHOWCASE = [
  ["Tailor to a job", "Paste a job ad to see the keywords, your match before and after, and a side-by-side tailored version."],
  ["Opportunities tracker", "UK grad schemes, spring weeks, placements and internships, with deadlines, email reminders and a visa sponsorship filter."],
];

const BANDS = [
  ["0–49", "Needs work", "bg-[#FDE4E1] text-black"],
  ["50–74", "Getting there", "bg-[#FBEFC9] text-black"],
  ["75–89", "Strong", "bg-[#D6F0DE] text-black"],
  ["90+", "Very strong", "bg-brand text-white"],
];

// Only what the demos above don't already show.
const FEATURES: [keyof typeof ICONS, string, string][] = [
  ["doc", "One-column templates", "Plain, one-column CV layouts that give screening software the best chance of reading them, with PDF and Word export."],
  ["letter", "Cover letters", "Write or review a letter from your CV and the job ad, following UK conventions."],
  ["trend", "Reports and history", "Every review is saved, so students can watch their score improve."],
];

const UNI_POINTS = [
  ["01", "Engagement and progress data", "Active students, completed reviews, useful edits, repeat use and adviser referrals, each with its definition and denominator."],
  ["02", "Breakdowns that matter", "By faculty, year of study, and home versus international students, one at a time."],
  ["03", "Who needs a hand", "A list of students who may need support, so advisers can reach out early."],
  ["04", "Privacy-safe exports", "Aggregate CSV exports, with small groups hidden and counts rounded."],
  ["05", "Evidence for your reporting", "An export of engagement and progress to support your own TEF and outcomes evidence."],
  ["06", "Adviser access, with consent", "Advisers see a CV only when the student agrees. Switched on after legal review."],
];

const TRUST: [string, ReactNode][] = [
  [
    "Built with UK GDPR in mind",
    <>
      Accounts, CVs and reports are stored in the UK or EU. For AI feedback, the relevant text is sent to Anthropic in the US. A data processing agreement and a UK transfer safeguard are required before any pilot goes live. Anthropic&apos;s published commercial terms say it may not train models on customer content.{" "}
      <Link href="/legal/sub-processors">See our sub-processors</Link>
    </>,
  ],
  ["You control the data", "The university is the controller. Offerpath processes data on your behalf."],
  ["Students stay in charge", "Every student can export or delete their own data."],
  ["Honest about AI", "Scores are labelled as AI-assisted guidance. Each report explains how its score was worked out, with the same formula for every student."],
  ["Accessibility in progress", "We're working towards WCAG 2.2 AA. The main student tasks are checked with automated tools and scripted keyboard tests. Screen reader testing and an independent audit haven't been done yet."],
  ["Secure sign-in", "A one-time email link, for partner university email addresses only. Single sign-on is built, but isn't yet connected for any university."],
];

const PILOT_STEPS = [
  ["We reply to arrange a call", "We read every request and email you to talk through your service, your students and what you'd want from a pilot."],
  ["We set it up with you", "Sign-in for your university email domain, or single sign-on if you use it, optional student records for breakdowns, and some adviser time to check scoring against their judgement."],
  ["Places are limited", "We're starting with a small number of UK universities so we can support each one closely."],
];

const ROAD = [
  ["NOW", "Getting ready for pilots", "Sign-in, CV parsing, AI scoring, tailoring, cover letters, the tracker, practice tools and the admin dashboard are built and tested in development. Backups, email delivery and legal agreements must be in place before any pilot goes live.", "bg-black text-white"],
  ["PILOT TERM", "Calibrate with advisers", "We tune scoring against your advisers' judgement and switch on adviser CV access after legal review.", "bg-white text-black"],
  ["AFTER THAT", "The full journey", "Outcome tracking, integrations with your careers systems, and a mobile app.", "bg-mint text-black"],
];

function SectionHead({ n, title, id, dark = false, children }: { n: string; title: ReactNode; id: string; dark?: boolean; children?: ReactNode }) {
  return (
    <div className="op-reveal max-w-[820px]">
      <p className={`m-0 font-mono text-[13px] ${dark ? "text-sage" : "text-brand"}`}>{n}</p>
      <h2 id={id} className={`mt-3.5 mb-0 text-[36px] leading-[1.12] font-normal tracking-[-1.5px] sm:text-[56px] sm:tracking-[-2.52px] ${dark ? "text-white" : "text-black"}`}>
        {title}
      </h2>
      {children}
    </div>
  );
}

const ArrowIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
    <path d="M2 7h9M7.5 3.5L11 7l-3.5 3.5" fill="none" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function Landing() {
  return (
    <div className="op-root overflow-x-clip bg-white text-black">
      <a href="#main" className="sr-only-abs focus:static focus:m-2 focus:inline-block focus:rounded-full focus:bg-black focus:px-4 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <header className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-3 gap-y-4 min-[380px]:gap-x-4 lg:gap-x-8 px-4 py-[22px] sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 text-[19px] font-medium tracking-[-0.02em] text-black no-underline hover:text-black">
          <Logo size={30} />
          Offerpath
        </Link>
        <nav aria-label="Main" className="ml-auto flex items-center gap-x-7 text-[15px]">
          {[["#students", "Students"], ["#universities", "Universities"], ["#trust", "Trust"], ["#roadmap", "Roadmap"]].map(([href, label]) => (
            <a key={href} href={href} className="hidden py-2.5 text-muted no-underline hover:text-black lg:inline">
              {label}
            </a>
          ))}
          <a href="/sign-in" className="py-2.5 text-muted no-underline hover:text-black">
            Sign in
          </a>
        </nav>
        <a href="#pilot" className="op-arrow inline-flex min-h-[46px] items-center gap-2 rounded-full bg-black px-4 text-sm font-medium max-[379px]:[&>svg]:hidden sm:px-5 sm:text-[15px] text-white no-underline hover:text-white">
          Apply for a pilot
          <ArrowIcon />
        </a>
      </header>

      <main id="main">
        <section aria-labelledby="hero-h" className="mx-auto flex max-w-[1240px] flex-col items-center px-4 pt-12 pb-10 text-center sm:px-8 sm:pt-[72px]">
          <p className="op-rise m-0 inline-flex items-center gap-2.5 rounded-full bg-canvas px-3.5 py-2 font-mono text-[13px] text-brand">
            <span className="op-breathe h-2 w-2 rounded-full bg-brand" />
            Taking requests for free UK university pilots
          </p>
          <h1 id="hero-h" className="mt-7 mb-0 max-w-[1100px] text-[44px] leading-[1.15] font-normal tracking-[-1.8px] sm:text-[64px] sm:tracking-[-2.8px] lg:text-[84px] lg:leading-[1.2] lg:tracking-[-3.78px]">
            <span className="op-rise op-d1 inline lg:block">Help every student reach</span>{" "}
            <span className="op-rise op-d2 inline lg:block">
              their first offer, <span className="text-brand">calmly.</span>
            </span>
          </h1>
          <p className="op-rise op-d3 mt-7 mb-0 max-w-[640px] text-lg leading-[1.55] tracking-[-0.01em] text-muted sm:text-xl">
            Line-by-line CV feedback built for UK graduate recruitment, from first draft to signed offer. Your careers team sees how every cohort is getting on.
          </p>
          <div className="op-rise op-d4 mt-9 flex flex-wrap justify-center gap-3">
            <a href="#pilot" className="op-arrow inline-flex min-h-14 items-center gap-2.5 rounded-full bg-black px-7 text-base font-medium text-white no-underline hover:text-white">
              Apply for a free pilot
              <ArrowIcon size={16} />
            </a>
            <a href="#students" className="inline-flex min-h-14 items-center rounded-full bg-canvas px-[26px] text-base font-medium text-black no-underline hover:text-black">
              See how it works
            </a>
          </div>
        </section>

        <section aria-label="Product preview with sample data" className="op-rise op-d5 mx-auto max-w-[1240px] px-4 pt-8 sm:px-8">
          <OfferpathHero />
        </section>

        <div aria-label="Opportunity types covered" className="mt-14 overflow-hidden border-y border-line py-[18px]">
          <div className="op-marquee flex w-max gap-12 text-[22px] tracking-[-0.03em] whitespace-nowrap text-muted">
            {[...MARQUEE, ...MARQUEE].map((m, i) => (
              <span key={i} aria-hidden={i >= MARQUEE.length || undefined} className="inline-flex items-center gap-12">
                {m}
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-sage" />
              </span>
            ))}
          </div>
        </div>

        <section aria-labelledby="prob-h" className="mx-auto flex max-w-[1240px] flex-col gap-12 px-4 pt-20 pb-16 sm:px-8 sm:pt-[120px] sm:pb-24">
          <SectionHead n="01 · THE PROBLEM" id="prob-h" title="Students apply blind. Careers teams can't reach everyone." />
          <ProblemDemo />
          <div className="flex flex-wrap gap-5">
            {PROBLEMS.map(([big, t, d]) => (
              <div key={t} className="op-reveal op-card flex min-w-0 flex-[1_1_320px] flex-col gap-2.5 rounded-[28px] bg-canvas p-8">
                <p className="m-0 text-[56px] leading-none tracking-[-2.5px] text-brand">{big}</p>
                <p className="mt-[18px] mb-0 text-[19px] font-medium tracking-[-0.01em]">{t}</p>
                <p className="m-0 text-base leading-[1.55] text-muted">{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="universities" aria-labelledby="uni-h" className="scroll-mt-4 bg-black text-white">
          <div className="mx-auto flex max-w-[1240px] flex-col gap-12 px-4 py-20 sm:px-8 sm:py-[120px]">
            <SectionHead n="02 · FOR UNIVERSITIES" id="uni-h" title="See how every cohort is getting on, and who needs a hand." dark />
            <CohortDashboard />
            <div className="flex flex-wrap gap-px overflow-clip rounded-[28px] bg-night-3">
              {UNI_POINTS.map(([n, t, d]) => (
                <div key={n} className="op-reveal min-w-0 flex-[1_1_340px] bg-night p-[30px]">
                  <p className="m-0 font-mono text-xs text-sage">{n}</p>
                  <p className="mt-3.5 mb-0 text-[22px] tracking-[-0.04em]">{t}</p>
                  <p className="mt-2 mb-0 text-[15px] leading-[1.55] text-night-muted">{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="students" aria-labelledby="stu-h" className="scroll-mt-4 bg-canvas">
          <div className="mx-auto flex max-w-[1240px] flex-col gap-14 px-4 py-20 sm:px-8 sm:py-28">
            <SectionHead n="03 · FOR STUDENTS" id="stu-h" title="Not just a CV score. Support from first draft to signed offer." />
            <div className="relative">
              <div aria-hidden="true" className="absolute top-[18px] right-[18px] left-[18px] hidden h-0.5 bg-edge lg:block">
                <div className="op-line h-0.5 w-[80%] bg-brand" />
              </div>
              <ol className="relative m-0 flex list-none flex-wrap gap-5 p-0">
                {JOURNEY.map(([n, t, d, live]) => (
                  <li key={n} className="op-reveal flex min-w-0 flex-[1_1_180px] flex-col gap-3.5">
                    <span className={`flex h-[38px] w-[38px] items-center justify-center rounded-full border-2 font-mono text-[13px] ${live ? "border-brand bg-brand text-white" : "border-chip bg-white text-muted"}`}>{n}</span>
                    <span className="text-[26px] tracking-[-0.04em]">{t}</span>
                    <span className="text-[15px] leading-normal text-muted">{d}</span>
                    <span className={`self-start rounded-full px-2.5 py-1 font-mono text-[11px] ${live ? "bg-mint text-brand" : "bg-white text-muted"}`}>{live ? "AVAILABLE NOW" : "COMING LATER"}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="flex flex-col gap-8">
              <div className="op-reveal flex flex-wrap items-end justify-between gap-6">
                <h3 className="m-0 max-w-[640px] text-[30px] leading-[1.15] font-normal tracking-[-1.2px] sm:text-[40px] sm:tracking-[-1.8px]">Know exactly what to fix, and why.</h3>
                <p className="m-0 max-w-[420px] text-[17px] leading-relaxed text-muted">Every point lost names the exact line and the reason. Scores are labelled as AI-assisted guidance.</p>
              </div>
              <LineFixDemo />
              <div className="op-reveal flex flex-col gap-3">
                <p className="m-0 text-[15px] leading-normal text-muted">Each CV gets a Readiness Score out of 100, in one of four bands:</p>
                <div className="flex flex-wrap overflow-hidden rounded-3xl">
                  {BANDS.map(([range, name, cls]) => (
                    <div key={name} className={`flex-[1_1_200px] px-6 py-[22px] ${cls}`}>
                      <p className="m-0 font-mono text-xs opacity-85">{range}</p>
                      <p className="mt-2 mb-0 text-2xl tracking-[-0.04em]">{name}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-12 gap-y-6">
              <div className="op-reveal min-w-0 flex-[1_1_300px]">
                <h3 className="m-0 text-[28px] font-normal tracking-[-0.04em]">{SHOWCASE[0][0]}</h3>
                <p className="mt-3 mb-0 text-[17px] leading-relaxed text-muted">{SHOWCASE[0][1]}</p>
              </div>
              <div className="min-w-0 flex-[1.4_1_358px]">
                <TailorDemo />
              </div>
            </div>
            <div className="flex flex-col gap-6">
              <div className="op-reveal max-w-[640px]">
                <h3 className="m-0 text-[28px] font-normal tracking-[-0.04em]">{SHOWCASE[1][0]}</h3>
                <p className="mt-3 mb-0 text-[17px] leading-relaxed text-muted">{SHOWCASE[1][1]}</p>
              </div>
              <TrackerDemo />
            </div>
            <div className="flex flex-wrap gap-5">
              {FEATURES.map(([icon, t, d]) => (
                <article key={t} className="op-reveal op-card flex min-w-0 flex-[1_1_300px] flex-col gap-3 rounded-[28px] bg-white p-[30px]">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-canvas">
                    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                      <path d={ICONS[icon]} fill="none" stroke="#36604E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <h3 className="mt-2 mb-0 text-[22px] font-normal tracking-[-0.04em]">{t}</h3>
                  <p className="m-0 text-base leading-[1.55] text-muted">{d}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="trust" aria-labelledby="trust-h" className="mx-auto flex max-w-[1240px] scroll-mt-4 flex-wrap gap-12 px-4 py-20 sm:px-8 sm:py-[120px]">
          <div className="min-w-0 flex-[1_1_360px]">
            <SectionHead n="04 · TRUST AND COMPLIANCE" id="trust-h" title="Your students' data stays yours." />
            <div className="mt-10 max-w-[460px]">
              <PrivacyCard />
            </div>
          </div>
          <div className="flex min-w-0 flex-[1.4_1_520px] flex-col">
            {TRUST.map(([t, d]) => (
              <div key={t} className="op-reveal grid grid-cols-1 gap-2 border-t border-edge py-5 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)] sm:gap-6">
                <p className="m-0 text-[19px] tracking-[-0.03em]">{t}</p>
                <p className="m-0 text-base leading-[1.55] text-muted">{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="roadmap" aria-labelledby="road-h" className="scroll-mt-4 bg-canvas">
          <div className="mx-auto flex max-w-[1240px] flex-col gap-12 px-4 py-20 sm:px-8 sm:py-28">
            <SectionHead n="05 · WHERE WE ARE" id="road-h" title="Getting ready for our first pilot universities." />
            <div className="flex flex-wrap gap-5">
              {ROAD.map(([when, t, d, cls]) => (
                <div key={when} className={`op-reveal op-card flex min-w-0 flex-[1_1_320px] flex-col gap-3 rounded-[28px] p-[30px] ${cls}`}>
                  <p className="m-0 font-mono text-xs opacity-85">{when}</p>
                  <p className="mt-1.5 mb-0 text-[28px] tracking-[-0.04em]">{t}</p>
                  <p className="m-0 text-[15px] leading-[1.55] opacity-90">{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="pilot" aria-labelledby="pilot-h" className="mx-auto max-w-[1240px] scroll-mt-4 px-4 py-20 sm:px-8 sm:py-[120px]">
          <div className="op-reveal flex flex-wrap items-start gap-14">
            <div className="min-w-0 flex-[1_1_400px]">
              <p className="m-0 font-mono text-[13px] text-brand">FREE PILOT PROGRAMME</p>
              <h2 id="pilot-h" className="mt-3.5 mb-0 text-[40px] leading-[1.08] font-normal tracking-[-1.8px] sm:text-[72px] sm:tracking-[-3.24px]">
                Shape Offerpath with us, free for your first year.
              </h2>
              <p className="mt-[22px] mb-0 max-w-[520px] text-lg leading-relaxed text-muted">You get the full platform and a direct line to the team building it. No cost, no multi-year contract.</p>
              <h3 className="mt-10 mb-0 font-mono text-[13px] font-normal text-brand">WHAT HAPPENS NEXT</h3>
              <ol className="mt-5 mb-0 flex max-w-[520px] list-none flex-col gap-5 p-0">
                {PILOT_STEPS.map(([t, d], i) => (
                  <li key={t} className="flex gap-4">
                    <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-mint font-mono text-xs text-brand">{i + 1}</span>
                    <span className="flex flex-col gap-1">
                      <span className="text-[19px] tracking-[-0.03em]">{t}</span>
                      <span className="text-[15px] leading-[1.55] text-muted">{d}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <PilotForm />
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-8 gap-y-4 p-4 text-sm text-subtle sm:p-8">
          <span className="flex items-center gap-2 font-medium text-black">
            <Logo size={22} />
            Offerpath
          </span>
          <span>AI-assisted career guidance for UK universities</span>
          <nav aria-label="Footer" className="flex flex-wrap gap-5 md:ml-auto">
            {[["/legal/privacy", "Privacy"], ["/legal/terms", "Terms"], ["/legal/accessibility", "Accessibility"], ["/legal/cookies", "Cookies"], ["#pilot", "Contact"]].map(([href, label]) => (
              <a key={href} href={href} className="text-muted no-underline hover:text-black">
                {label}
              </a>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
