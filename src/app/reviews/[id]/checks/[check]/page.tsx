import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Expandable } from "@/components/client";
import { ResultsSidebar } from "@/components/ResultsSidebar";
import { StudentShell, WithSidebar } from "@/components/StudentShell";
import { Arrow, Eyebrow, ScoreRing, scoreColor, Tick } from "@/components/ui";
import { CHECK_CONTENT } from "@/lib/analysis/check-content";
import { AREA_META, CHECK_META, CHECK_ORDER, findCheck } from "@/lib/analysis/cv";
import type { CheckKey } from "@/lib/types";
import { loadCvReview } from "../../../load";

export async function generateMetadata({ params }: { params: Promise<{ check: string }> }): Promise<Metadata> {
  const { check } = await params;
  return { title: CHECK_META[check as CheckKey]?.name ?? "Check" };
}

export default async function CheckPage({ params, searchParams }: { params: Promise<{ id: string; check: string }>; searchParams: Promise<{ all?: string }> }) {
  const { id, check } = await params;
  const showAll = (await searchParams).all === "1";
  if (!(check in CHECK_META)) notFound();
  const key = check as CheckKey;
  const { profile, a } = await loadCvReview(id);
  const c = findCheck(a, key);
  if (!c) notFound();
  const content = CHECK_CONTENT[key];
  const nextKey = CHECK_ORDER[(CHECK_ORDER.indexOf(key) + 1) % CHECK_ORDER.length];
  const affected = c.affected.map((i) => ({ i, line: a.lines[i] })).filter((x) => x.line);
  const visible = showAll ? affected : affected.slice(0, 4);
  const passing = key === "quant" ? a.lines.map((l, i) => ({ l, i })).filter(({ i }) => !c.affected.includes(i)) : [];

  return (
    <StudentShell profile={profile} active="review">
      <WithSidebar narrow sidebar={<ResultsSidebar reviewId={id} areas={a.areas} active={key} />}>
        <div className="flex items-center gap-5 px-1 pt-2 pb-1">
          <ScoreRing value={c.score} of={10} size={72} stroke={6} color={scoreColor(c.score, 10)} track="#E6EDE8" label={`Check score ${c.score} out of 10`}>
            <span className="text-2xl tracking-[-0.04em]">
              {c.score}
              <span className="text-[13px] text-subtle">/10</span>
            </span>
          </ScoreRing>
          <div className="min-w-0">
            <p className="m-0 font-mono text-xs text-brand">{AREA_META[c.area].name.toUpperCase()}</p>
            <h1 className="mt-1 mb-0 text-[32px] font-normal leading-[1.1] tracking-[-1.4px] sm:text-[40px] sm:tracking-[-1.8px]">{c.name}</h1>
            <p className="mt-1.5 mb-0 text-[15px] text-muted">{content.tagline}</p>
          </div>
        </div>

        <section aria-labelledby="c1" className="flex flex-wrap items-center gap-6 rounded-3xl bg-white px-[26px] py-6">
          <div className="flex flex-[0_0_140px] flex-col items-center gap-2.5 text-center">
            {c.score >= 8 ? (
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-mint">
                <Tick size={26} />
              </span>
            ) : (
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black">
                <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 7v6M12 16.5v.5" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </span>
            )}
            <span className="text-sm leading-[1.35]">{c.score >= 8 ? "Looking good" : content.icon}</span>
          </div>
          <div className="min-w-0 flex-[1_1_380px]">
            <Eyebrow id="c1">{c.name.toUpperCase()}</Eyebrow>
            <p className="mt-2.5 mb-0 text-base leading-relaxed">{c.detail}</p>
            {c.progress && (
              <div className="mt-3.5 flex items-center gap-3">
                <div className="h-2 flex-1 rounded-full bg-line">
                  <div className="h-2 rounded-full bg-black" style={{ width: `${c.progress.total ? Math.round((c.progress.have / c.progress.total) * 100) : 0}%` }} />
                </div>
                <span className="font-mono text-xs text-muted">
                  {c.progress.have} / {c.progress.total} · TARGET {c.progress.target}
                </span>
              </div>
            )}
            {!!c.extras?.length && key !== "verbs" && (
              <div className="mt-3.5 flex flex-wrap gap-2">
                {c.extras.map((e) => (
                  <span key={e} className="rounded-full bg-canvas px-3.5 py-2 text-sm">
                    {e}
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>

        <section aria-labelledby="c2" className="rounded-3xl bg-white px-[26px] py-6">
          <Eyebrow id="c2">RECRUITER&apos;S INSIGHT</Eyebrow>
          <p className="mt-2.5 mb-0 text-base leading-[1.65] text-ink-2">{content.insight}</p>
          <Expandable more={<p className="mt-3 mb-0 text-base leading-[1.65] text-ink-2">{content.more}</p>} />
        </section>

        {(affected.length > 0 || c.affected.length > 0) && (
          <section aria-labelledby="c3" className="flex flex-col gap-4 rounded-3xl bg-white px-[26px] py-6">
            <div className="flex flex-wrap items-start gap-5">
              <div className="flex-[0_0_140px] text-center">
                <p className="m-0 text-[56px] leading-none tracking-[-0.05em]">{c.stat.value}</p>
                <p className="mt-1.5 mb-0 text-sm leading-[1.35] text-muted">{c.stat.label}</p>
              </div>
              <div className="min-w-0 flex-[1_1_380px]">
                <Eyebrow id="c3">LINES AFFECTED</Eyebrow>
                <p className="mt-2.5 mb-0 text-[15px] leading-[1.55] text-body">Open a line to get a suggested rewrite. We leave blanks where only you know the real number.</p>
              </div>
            </div>
            <div className="flex flex-col">
              {visible.map(({ i, line }) => (
                <div key={i} className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-line py-3.5">
                  <span className="w-24 font-mono text-xs text-subtle">{line.short}</span>
                  <span className="min-w-0 flex-[1_1_320px] text-[15px] leading-normal">{line.accepted ?? line.text}</span>
                  <Link href={`/reviews/${id}/lines?i=${i}`} className="inline-flex min-h-[38px] items-center rounded-full bg-canvas px-3.5 text-[13px] font-medium text-black no-underline hover:bg-mist hover:text-black">
                    Fix this line
                  </Link>
                </div>
              ))}
            </div>
            {affected.length > 4 && (
              <Link href={showAll ? `/reviews/${id}/checks/${key}` : `/reviews/${id}/checks/${key}?all=1`} className="inline-flex min-h-10 items-center self-start rounded-full border border-edge bg-white px-4 text-sm text-black no-underline hover:bg-paper hover:text-black">
                {showAll ? "Show fewer" : `Show all ${affected.length} lines`}
              </Link>
            )}
            {passing.length > 0 && (
              <div className="border-t border-line pt-4">
                <p className="mt-0 mb-2.5 text-sm font-medium">Already quantified · {passing.length}</p>
                {passing.slice(0, 3).map(({ l, i }) => (
                  <p key={i} className="mt-0 mb-1.5 flex gap-2.5 text-[15px] leading-normal text-body">
                    <Tick />
                    {l.text}
                  </p>
                ))}
              </div>
            )}
          </section>
        )}

        {content.measure && (
          <section aria-labelledby="c4" className="flex flex-col gap-3.5 rounded-3xl bg-white px-[26px] py-6">
            <Eyebrow id="c4">WHAT COULD YOU MEASURE?</Eyebrow>
            <p className="m-0 text-[15px] leading-[1.55] text-body">No exact figure? A careful estimate is fine, as long as you can explain it at interview.</p>
            <div className="flex flex-wrap gap-2">
              {content.measure.map((m) => (
                <span key={m} className="rounded-full bg-canvas px-3.5 py-2 text-sm">
                  {m}
                </span>
              ))}
            </div>
          </section>
        )}

        <section aria-labelledby="c5" className="flex flex-col gap-3.5 rounded-3xl bg-white px-[26px] py-6">
          <Eyebrow id="c5">EXAMPLES</Eyebrow>
          <div className="grid grid-cols-2 gap-3 font-mono text-[13px] text-subtle">
            <span>BEFORE</span>
            <span>AFTER</span>
          </div>
          {content.examples.map((e) => (
            <div key={e.b} className="grid grid-cols-2 gap-3">
              <p className="m-0 rounded-2xl bg-canvas px-4 py-3.5 text-[15px] leading-normal text-muted">{e.b}</p>
              <p className="m-0 rounded-2xl border border-mint bg-okbg px-4 py-3.5 text-[15px] leading-normal">{e.a}</p>
            </div>
          ))}
        </section>

        <nav aria-label="Checks" className="flex flex-wrap justify-between gap-3 p-1">
          <Link href={`/reviews/${id}`} className="inline-flex min-h-11 items-center text-[15px] text-muted no-underline hover:text-black">
            Back to overview
          </Link>
          <Link href={`/reviews/${id}/checks/${nextKey}`} className="inline-flex min-h-12 items-center gap-2 rounded-full bg-black px-[22px] text-[15px] font-medium text-white no-underline hover:bg-ink-2 hover:text-white">
            Next check: {CHECK_META[nextKey].name}
            <Arrow color="#FFFFFF" />
          </Link>
        </nav>
      </WithSidebar>
    </StudentShell>
  );
}
