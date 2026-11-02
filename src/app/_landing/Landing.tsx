import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui";
import { PilotForm } from "./PilotForm";
import { CohortDashboard } from "./demos/CohortDashboard";
import { JourneyBento } from "./demos/JourneyBento";
import { LineFixDemo } from "./demos/LineFixDemo";
import { OfferpathHero } from "./demos/OfferpathHero";
import { PrivacyCard } from "./demos/PrivacyCard";
import { ProblemDemo } from "./demos/ProblemDemo";
import { TailorDemo } from "./demos/TailorDemo";
import { TrackerDemo } from "./demos/TrackerDemo";

// Public marketing page (design: Landing_v2). Claims here must match what the product actually does.

const ICONS = {
  score: "M12 3.5a8.5 8.5 0 1 0 8.5 8.5M12 3.5V12l5.5 3",
  target: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  letter: "M3.5 6.5h17v11h-17zM3.5 7l8.5 6 8.5-6",
  cal: "M4.5 6h15v14h-15zM4.5 10h15M8.5 3.5V7M15.5 3.5V7",
  doc: "M7 3.5h7l4 4v13H7zM10 12h5M10 16h3.5",
  trend: "M4 17l5-5 4 4 7-8M15 8h5v5",
  chat: "M4 5.5h16v10H9l-5 4z",
  path: "M5 19V5M5 7h10l-2 3 2 3H5",
};

const MARQUEE = ["Graduate schemes", "Spring weeks", "Placements", "Internships", "Visa sponsorship filter", "Deadline reminders"];

const PROBLEMS = [
  ["Dozens", "of applications, no feedback", "Students send generic CVs to role after role and rarely learn why they were rejected."],
  ["1:2,000", "advisers to students, at some universities", "Some services have one adviser for more than 2,000 students. Nobody can review every CV."],
  ["US-first", "tools that stop at a score", "Most tools ignore UK grad schemes, spring weeks and placements, or give a number with no next step."],
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
  ["90+", "Interview-ready", "bg-brand text-white"],
];

const FEATURES: [keyof typeof ICONS, string, string][] = [
  ["score", "CV review and Readiness Score", "A score out of 100 across impact, clarity, structure and ATS, sector relevance, spelling and grammar, and length and formatting."],
  ["letter", "Cover letters", "Write or review a letter from your CV and the job ad, following UK conventions."],
  ["doc", "ATS-friendly templates", "CV layouts that screening software can read, with PDF and Word export."],
  ["trend", "Reports and history", "Every review is saved, so students can watch their score improve."],
  ["chat", "Interview practice", "Sector questions with instant feedback on structure, detail and length."],
  ["path", "Tests and roadmaps", "Timed aptitude practice, and what to do when for each sector."],
];

const UNI_POINTS = [
  ["01", "Real outcome data", "Active students, average score, improvement, CVs reviewed and applications tracked."],
  ["02", "Breakdowns that matter", "By faculty, course, and home versus international students."],
  ["03", "Who needs a hand", "A list of students who may need support, so advisers can reach out early."],
  ["04", "Privacy-safe exports", "CSV exports, with any group of fewer than five students hidden."],
  ["05", "Supports your reporting", "Data that feeds into Graduate Outcomes and TEF submissions."],
  ["06", "Adviser access, with consent", "Advisers see a CV only when the student agrees. Switched on after legal review."],
];

const TRUST = [
  ["UK GDPR compliant", "Data is stored in the UK or EU."],
  ["You control the data", "The university is the controller. Offerpath processes data on your behalf."],
  ["Students stay in charge", "Every student can export or delete their own data."],
  ["Honest about AI", "Scores are labelled as AI-assisted guidance, and advisers can add their own advice."],
  ["Accessible by design", "Built to meet WCAG 2.2 AA."],
  ["Secure sign-in", "University single sign-on or a one-time email link. Only partner university emails can sign up."],
];

const ROAD = [
  ["NOW", "Ready for pilots", "Sign-in, CV parsing, AI scoring, tailoring, cover letters, the tracker, practice tools and the admin dashboard.", "bg-black text-white"],
  ["PILOT TERM", "Calibrated with advisers", "We tune scoring against your advisers' judgement and switch on adviser CV access after legal review.", "bg-white text-black"],
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
    <div className="op-root overflow-hidden bg-white text-black">
      <a href="#main" className="sr-only-abs focus:static focus:m-2 focus:inline-block focus:rounded-full focus:bg-black focus:px-4 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <header className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-8 gap-y-4 px-4 py-[22px] sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 text-[19px] font-medium tracking-[-0.02em] text-black no-underline hover:text-black">
          <Logo size={30} />
          Offerpath
        </Link>
        <nav aria-label="Main" className="order-3 flex w-full flex-wrap gap-x-7 gap-y-1 text-[15px] md:order-none md:ml-auto md:w-auto">
          {[["#students", "Students"], ["#universities", "Universities"], ["#trust", "Trust"], ["#roadmap", "Roadmap"], ["/sign-in", "Sign in"]].map(([href, label]) => (
            <a key={href} href={href} className="py-2.5 text-muted no-underline hover:text-black">
              {label}
            </a>
          ))}
        </nav>
        <a href="#pilot" className="op-arrow ml-auto inline-flex min-h-[46px] items-center gap-2 rounded-full bg-black px-5 text-[15px] font-medium text-white no-underline hover:text-white md:ml-0">
          Apply for a pilot
          <ArrowIcon />
        </a>
      </header>

      <main id="main">
        <section aria-labelledby="hero-h" className="mx-auto flex max-w-[1240px] flex-col items-center px-4 pt-12 pb-10 text-center sm:px-8 sm:pt-[72px]">
          <p className="op-rise m-0 inline-flex items-center gap-2.5 rounded-full bg-canvas px-3.5 py-2 font-mono text-[13px] text-brand">
            <span className="op-breathe h-2 w-2 rounded-full bg-brand" />
            Free pilots open for UK universities
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

        <section aria-labelledby="journey-h" className="bg-canvas">
          <div className="mx-auto flex max-w-[1240px] flex-col gap-14 px-4 py-20 sm:px-8 sm:py-28">
            <SectionHead n="02 · THE WHOLE JOURNEY" id="journey-h" title="Not just a CV score. Support from first draft to signed offer." />
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
            <JourneyBento />
          </div>
        </section>

        <section id="students" aria-labelledby="stu-h" className="mx-auto flex max-w-[1240px] scroll-mt-4 flex-col gap-12 px-4 py-20 sm:px-8 sm:py-[120px]">
          <div className="op-reveal flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-[720px]">
              <p className="m-0 font-mono text-[13px] text-brand">03 · FOR STUDENTS</p>
              <h2 id="stu-h" className="mt-3.5 mb-0 text-[36px] leading-[1.12] font-normal tracking-[-1.5px] sm:text-[56px] sm:tracking-[-2.52px]">
                Know exactly what to fix, and why.
              </h2>
            </div>
            <p className="m-0 max-w-[420px] text-[17px] leading-relaxed text-muted">Every point lost names the exact line and the reason. Scores are labelled as AI-assisted guidance.</p>
          </div>
          <div className="op-reveal flex flex-wrap overflow-hidden rounded-3xl">
            {BANDS.map(([range, name, cls]) => (
              <div key={name} className={`flex-[1_1_200px] px-6 py-[22px] ${cls}`}>
                <p className="m-0 font-mono text-xs opacity-85">{range}</p>
                <p className="mt-2 mb-0 text-2xl tracking-[-0.04em]">{name}</p>
              </div>
            ))}
          </div>
          <LineFixDemo />
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
              <article key={t} className="op-reveal op-card flex min-w-0 flex-[1_1_340px] flex-col gap-3 rounded-[28px] bg-canvas p-[30px]">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white">
                  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                    <path d={ICONS[icon]} fill="none" stroke="#36604E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <h3 className="mt-2 mb-0 text-[22px] font-normal tracking-[-0.04em]">{t}</h3>
                <p className="m-0 text-base leading-[1.55] text-muted">{d}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="universities" aria-labelledby="uni-h" className="scroll-mt-4 bg-black text-white">
          <div className="mx-auto flex max-w-[1240px] flex-col gap-12 px-4 py-20 sm:px-8 sm:py-[120px]">
            <SectionHead n="04 · FOR UNIVERSITIES" id="uni-h" title="See how every cohort is getting on, and who needs a hand." dark />
            <CohortDashboard />
            <div className="flex flex-wrap gap-px overflow-hidden rounded-[28px] bg-night-3">
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

        <section id="trust" aria-labelledby="trust-h" className="mx-auto flex max-w-[1240px] scroll-mt-4 flex-wrap gap-12 px-4 py-20 sm:px-8 sm:py-[120px]">
          <div className="min-w-0 flex-[1_1_360px]">
            <SectionHead n="05 · TRUST AND COMPLIANCE" id="trust-h" title="Your students' data stays yours." />
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
            <SectionHead n="06 · WHERE WE ARE" id="road-h" title="Built in the open, with our pilot universities." />
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
              <p className="mt-[22px] mb-0 max-w-[520px] text-lg leading-relaxed text-muted">We&apos;re working with a small number of UK universities. You get the full platform and a direct line to the team building it. No cost, no multi-year contract.</p>
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
