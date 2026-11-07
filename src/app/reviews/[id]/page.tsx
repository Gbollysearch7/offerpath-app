import type { Metadata } from "next";
import Link from "next/link";
import { ResultsSidebar } from "@/components/ResultsSidebar";
import { StudentShell, WithSidebar } from "@/components/StudentShell";
import { Bar, bandBadge, cx, Eyebrow, fmtShort, ScoreRing, scoreColor, Tag } from "@/components/ui";
import { AREA_META, checkContext } from "@/lib/analysis/cv";
import { bandLabel, bandLegend, bandRangeText, nextBandLabel } from "@/lib/analysis/labels";
import { dismissedIds } from "@/lib/analysis/proofreading/choices";
import { proofreadingSummary } from "@/lib/analysis/proofreading/view";
import { comparableHistory, scoreCoverage } from "@/lib/analysis/coverage";
import type { BandKey } from "@/lib/analysis/rubric";
import { scoreSeries, seriesFields } from "@/lib/analysis/scoring-contract";
import { CareersOnThisReport } from "@/app/careers-service/CareersOnThisReport";
import { ShareEntry } from "@/app/share/ShareEntry";
import { loadCvReview } from "../load";
import { ShowAround } from "./ShowAround";
import { SupplementalChecks } from "./SupplementalChecks";

export const metadata: Metadata = { title: "Results overview" };

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { repo, profile, report, a } = await loadCvReview(id);
  const [history, opps, allNotes] = await Promise.all([repo.listReports({ type: "cv_review", limit: 50 }), repo.opportunities(), repo.myAdviserNotes()]);
  const notes = allNotes.filter((n) => n.reportId === id);
  // Only scores in this report's series are charted or compared (scoring-contract.ts). A rule change or a method
  // change is the one thing besides an edit that can move a score, so it must never read as progress or decline.
  const fields = seriesFields(report.payload);
  const coverage = scoreCoverage(fields);
  const withheld = coverage.status === "withheld";
  const comparable = comparableHistory(history.rows, id, scoreSeries(fields));
  const upTo = comparable.rows.slice(-6);
  const idx = upTo.findIndex((r) => r.id === id);
  const previous = idx > 0 ? upTo[idx - 1].score! : null;
  const highest = Math.max(...upTo.map((r) => r.score!));
  const first = upTo[0]?.score ?? a.score;
  const change = previous !== null ? a.score - previous : null;
  const sector = report.payload.sector;
  const doc = report.payload.document;
  const NOT_COMPARED = "Earlier reviews were scored under different rules, or weren't fully assessed, so they aren't compared with this one. ";
  const fit = a.areas.find((ar) => ar.key === "sector");
  const soon = opps.filter((o) => o.sector === sector && new Date(o.closesOn).getTime() - Date.now() < 30 * 864e5 && new Date(o.closesOn).getTime() > Date.now()).length;

  const xs = upTo.map((_, i) => (upTo.length === 1 ? 245 : 60 + (i * 370) / (upTo.length - 1)));
  const y = (s: number) => Math.max(20, Math.min(186, 20 + (90 - s) * 3));
  const pts = upTo.map((r, i) => `${xs[i].toFixed(0)},${y(r.score!).toFixed(0)}`);
  const top = a.steps[0];
  // Band words come from the score at render time (labels.ts), so this report and every older one use the same ones.
  const next = nextBandLabel(a.score);
  const legend = bandLegend();
  const stripColour: Record<BandKey, string> = { low: "bg-[#F4B8B1]", mid: "bg-[#F2D27A]", high: "bg-[#9FD3AE]", top: "bg-brand" };

  return (
    <StudentShell profile={profile} active="review">
      <WithSidebar sidebar={<ResultsSidebar reviewId={id} areas={a.areas} active="overview" />}>
        {a.lines.some((l) => l.accepted) && (
          <p role="status" className="m-0 rounded-3xl border-2 border-edge bg-white px-6 py-4 text-[15px]">
            You&apos;ve saved {a.lines.filter((l) => l.accepted).length === 1 ? "1 reworded line" : `${a.lines.filter((l) => l.accepted).length} reworded lines`}. The score below is still for the CV as you uploaded it. Upload the updated CV to score those changes.
          </p>
        )}
        <div className="flex flex-wrap items-end justify-between gap-4 px-1 pt-2 pb-1">
          <div>
            <h1 className="m-0 text-[34px] font-normal leading-[1.1] tracking-[-1.5px] sm:text-[44px] sm:tracking-[-1.98px]">Overview</h1>
            <p className="mt-2 mb-0 text-[15px] text-muted">
              {report.payload.fileName} · reviewed {fmtShort(report.row.createdAt)} · {sector}
            </p>
            <Link href={`/reviews/${id}/breakdown#how`} className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs text-muted no-underline hover:text-black">
              {a.meta.method === "ai" ? "Scored with Claude Haiku against a fixed rubric" : "Scored by the Offerpath rule engine"} · same CV, same score
            </Link>
            {/* Which text was scored: a correction or typed text is said up front, and every report links to its source. */}
            <p className="mt-2 mb-0 text-[13px] text-muted" data-scored-source={doc?.source.kind ?? "unrecorded"}>
              {doc?.source.kind === "correction" ? "Scored your corrected text, not the text read from the file. " : doc?.source.kind === "paste" ? "Scored the text you typed or pasted. " : ""}
              <Link href={`/reviews/${id}/source`} className="text-muted">
                See the source document{report.row.sourceId ? " and its versions" : ""}
              </Link>
            </p>
        <CareersOnThisReport reportId={id} />
        <ShareEntry repo={repo} reportId={id} />
          </div>
          <ShowAround />
        </div>

        <div className="flex flex-wrap items-stretch gap-5">
          <section id="tour-score" aria-labelledby="sc-h" className="flex min-w-0 flex-[1_1_380px] flex-col gap-5 rounded-3xl bg-white px-[26px] py-6">
            <Eyebrow id="sc-h">READINESS SCORE</Eyebrow>
            <div className="flex flex-wrap items-center gap-6">
              {withheld ? (
                <div className="min-w-[180px] flex-1" data-score-coverage="withheld">
                  <span className="inline-flex rounded-full bg-canvas px-3 py-1.5 text-[13px] font-medium text-black">No overall score</span>
                  <p className="mt-3 mb-0 text-[15px] leading-normal text-body">
                    We found no bullet points, so only about {Math.round(coverage.assessedShare * 100)}% of what makes up the score could be assessed. A total from that little wouldn&apos;t tell you much about your CV, so we don&apos;t give one. Add bullet points (•) under each role and project, then upload again.
                  </p>
                </div>
              ) : (
              <>
              <ScoreRing value={a.score} size={144} stroke={11} color={scoreColor(a.score)} label={`Readiness Score ${a.score} out of 100`}>
                <span className="text-5xl leading-none tracking-[-0.05em]">{a.score}</span>
                <span className="mt-1.5 font-mono text-[11px] text-subtle">OF 100</span>
              </ScoreRing>
              <div className="min-w-[180px] flex-1">
                <span className={cx("inline-flex rounded-full px-3 py-1.5 text-[13px] font-medium", bandBadge(a.score))}>{bandLabel(a.score)}</span>
                {coverage.status === "incomplete" && (
                  <p className="mt-3 mb-0 text-sm leading-normal text-black" data-score-coverage="incomplete">
                    <span className="font-medium">Incomplete score.</span> We weren&apos;t confident we read your whole file, so this may not reflect your full CV. Check how we read it from the link above.
                  </p>
                )}
                <p className="mt-3 mb-0 text-[15px] leading-normal text-body">
                  {change === null ? (comparable.setAside > 0 ? NOT_COMPARED : "Your first review. ") : change > 0 ? `Up ${change} since your last upload. ` : change < 0 ? `Down ${-change} since your last upload. ` : "Same as your last upload. "}
                  {top ? `${top.text} is the quickest way to ${next ? `reach ${next}` : "add to your score"}.` : "Keep tailoring it to each role."}
                </p>
              </div>
              </>
              )}
            </div>
            {!withheld && (
            <div>
              <div className="flex h-2 overflow-hidden rounded-full" role="img" aria-label={`Score bands: ${legend.map((b) => `${b.label.toLowerCase()} ${bandRangeText(b)}`).join(", ")}. You are at ${a.score}.`}>
                {legend.map((b) => (
                  <span key={b.key} className={stripColour[b.key]} style={{ flex: b.max - b.min + (b.max >= 100 ? 0 : 1) }} />
                ))}
              </div>
              <div className="relative h-[18px]">
                <span className="absolute top-0.5 h-3.5 w-0.5 bg-black" style={{ left: `${a.score}%` }} />
              </div>
              <div className="flex justify-between font-mono text-[11px] text-subtle">
                {legend.map((b) => (
                  <span key={b.key}>{b.label.toUpperCase()}</span>
                ))}
              </div>
            </div>
            )}
            <div className="flex flex-col gap-3 border-t border-line pt-[18px]">
              {a.areas.filter((ar) => ar.key !== "sector").map((ar) => (
                <Link key={ar.key} href={`/reviews/${id}/checks/${[...ar.checks].sort((p, q) => p.score - q.score)[0].key}`} className="grid grid-cols-[minmax(0,1fr)_100px_30px] items-center gap-3 text-sm text-black no-underline hover:text-brand sm:grid-cols-[minmax(0,1fr)_140px_30px]">
                  <span>{AREA_META[ar.key].name}</span>
                  <Bar pct={ar.score} color={scoreColor(ar.score)} />
                  <span className="text-right font-mono text-[13px]">{ar.score}</span>
                </Link>
              ))}
              {fit && (
                <Link href={`/reviews/${id}/checks/sector`} className="mt-1 grid grid-cols-[minmax(0,1fr)_100px_30px] items-center gap-3 border-t border-line pt-3 text-sm text-black no-underline hover:text-brand sm:grid-cols-[minmax(0,1fr)_140px_30px]">
                  <span>
                    Fit for {sector.toLowerCase()}
                    <span className="block text-xs text-subtle">Not counted in your score</span>
                  </span>
                  <Bar pct={fit.score} color={scoreColor(fit.score)} />
                  <span className="text-right font-mono text-[13px]">{fit.score}</span>
                </Link>
              )}
            </div>
          </section>

          <section id="tour-history" aria-labelledby="hist-h" className="flex min-w-0 flex-[1_1_380px] flex-col gap-4 rounded-3xl bg-white px-[26px] py-6">
            <Eyebrow id="hist-h">SCORE HISTORY</Eyebrow>
            {withheld ? (
              <p className="m-0 text-[15px] leading-normal text-body">This review has no overall score, so it isn&apos;t part of your score history.</p>
            ) : (
            <>
            <div className="flex flex-wrap gap-2.5">
              <span className="rounded-full bg-canvas px-3 py-1.5 text-[13px]">
                Highest <span className="font-medium">{highest}</span>
              </span>
              {previous !== null && (
                <span className="rounded-full bg-canvas px-3 py-1.5 text-[13px]">
                  Previous <span className="font-medium">{previous}</span>
                </span>
              )}
              {upTo.length > 1 && (
                <span className="rounded-full bg-mint px-3 py-1.5 text-[13px] text-brand">
                  {a.score - first >= 0 ? "+" : ""}
                  {a.score - first} since {comparable.setAside > 0 ? "first comparable upload" : "first upload"}
                </span>
              )}
            </div>
            <svg viewBox="0 0 460 220" width="100%" height="220" role="img" aria-label={`Score by upload: ${upTo.map((r) => `${fmtShort(r.createdAt)} ${r.score}`).join(", ")}`}>
              {[20, 80, 140].map((ly) => (
                <line key={ly} x1="36" y1={ly} x2="450" y2={ly} stroke="#EEF2EF" />
              ))}
              <line x1="36" y1="190" x2="450" y2="190" stroke="#DCE3DE" />
              <text x="28" y="24" fontSize="11" fill="#5C6B66" textAnchor="end" fontFamily="var(--font-geist-mono)">90</text>
              <text x="28" y="84" fontSize="11" fill="#5C6B66" textAnchor="end" fontFamily="var(--font-geist-mono)">70</text>
              <text x="28" y="144" fontSize="11" fill="#5C6B66" textAnchor="end" fontFamily="var(--font-geist-mono)">50</text>
              {upTo.length > 1 && <path d={`M${pts.join(" L")} L${xs[xs.length - 1].toFixed(0)} 190 L${xs[0].toFixed(0)} 190 Z`} fill="#DCE6DF" opacity="0.6" />}
              {upTo.length > 1 && <polyline points={pts.join(" ")} fill="none" stroke="#36604E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
              {upTo.map((r, i) => {
                const cur = r.id === id;
                return (
                  <g key={r.id}>
                    <circle cx={xs[i]} cy={y(r.score!)} r={cur ? 6 : 4} fill={cur ? "#36604E" : "#FFFFFF"} stroke="#36604E" strokeWidth="2" />
                    {cur && (
                      <text x={xs[i]} y={y(r.score!) - 14} fontSize="12" textAnchor="middle" fontFamily="var(--font-geist-mono)">
                        {r.score}
                      </text>
                    )}
                    <text x={xs[i]} y="210" fontSize="11" fill="#5C6B66" textAnchor="middle">
                      {fmtShort(r.createdAt)}
                    </text>
                  </g>
                );
              })}
            </svg>
            {comparable.setAside > 0 && (
              <p className="m-0 text-[13px] leading-normal text-muted" data-score-history="set-aside">
                {comparable.setAside === 1 ? "1 earlier review isn't" : `${comparable.setAside} earlier reviews aren't`} shown here: scored under different rules or not fully assessed, so the scores don&apos;t compare. All reports still lists {comparable.setAside === 1 ? "it" : "them"} with the original {comparable.setAside === 1 ? "score" : "scores"}.
              </p>
            )}
            </>
            )}
            <p className="m-0 rounded-2xl bg-canvas px-4 py-3.5 text-sm leading-normal text-body">You don&apos;t need 100. Take the advice that fits the roles you want and ignore what doesn&apos;t. Scores are guidance; if you disagree, talk to your careers adviser.</p>
            <div className="mt-auto flex flex-wrap gap-2.5">
              <Link href="/dashboard" className="rounded-full border border-edge px-3.5 py-[9px] text-sm text-black no-underline hover:bg-paper hover:text-black">
                All reports
              </Link>
              <span className="rounded-full border border-edge px-3.5 py-[9px] text-sm text-muted">Target sector: {sector}</span>
            </div>
          </section>
        </div>

        {notes.length > 0 && (
          <section aria-labelledby="adv-h" className="flex flex-col gap-3 rounded-3xl bg-mist px-[26px] py-6">
            <h2 id="adv-h" className="m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">
              FROM YOUR CAREERS ADVISER
            </h2>
            {notes.map((n) => (
              <div key={n.id}>
                <p className="m-0 whitespace-pre-line text-[15px] leading-relaxed text-ink-2">{n.note}</p>
                <p className="mt-1 mb-0 text-[13px] text-subtle">
                  {n.author} · {fmtShort(n.createdAt)}
                </p>
              </div>
            ))}
          </section>
        )}

        <section id="tour-highlights" aria-labelledby="hl-h" className="flex flex-col gap-[18px] rounded-3xl bg-white px-[26px] py-6">
          <Eyebrow id="hl-h">HIGHLIGHTS</Eyebrow>
          <div className="flex flex-wrap gap-7">
            <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-2.5">
              <h3 className="mt-0 mb-1 text-xl font-normal tracking-[-0.03em]">Steps to improve your CV</h3>
              {a.steps.length === 0 && <p className="m-0 text-sm text-muted">No big fixes left. Tailor your CV to each job next.</p>}
              {a.steps.map((s, i) => (
                <Link key={s.check} href={`/reviews/${id}/checks/${s.check}`} className="flex items-center gap-3.5 rounded-2xl bg-canvas px-4 py-3.5 text-black no-underline hover:bg-mist hover:text-black">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black font-mono text-xs text-white">{i + 1}</span>
                  <span className="flex-1">
                    <span className="block text-[15px]">{s.text}</span>
                    <span className="mt-0.5 block text-[13px] text-subtle">{checkContext(s.check)}</span>
                  </span>
                  <span className="font-mono text-xs text-brand">{s.gain ? <><span className="sr-only-abs">Estimated gain </span>+{s.gain}</> : "Fit"}</span>
                </Link>
              ))}
            </div>
            <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-2.5">
              <h3 className="mt-0 mb-1 text-xl font-normal tracking-[-0.03em]">What you did well</h3>
              {a.wells.length === 0 && <p className="m-0 text-sm text-muted">Fix the steps on the left and your strengths will show here.</p>}
              {a.wells.map((w) => (
                <div key={w.check} className="flex items-center gap-3.5 rounded-2xl border border-line px-4 py-3.5">
                  <svg width="28" height="28" viewBox="0 0 22 22" aria-hidden="true" className="shrink-0">
                    <circle cx="11" cy="11" r="10" fill="#DCE6DF" />
                    <path d="M6.8 11.3l2.8 2.8 5.6-5.8" fill="none" stroke="#36604E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="flex-1">
                    <span className="block text-[15px]">{w.text}</span>
                    <span className="mt-0.5 block text-[13px] text-subtle">{checkContext(w.check)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <Link href={`/reviews/${id}/checks/spell`} className="flex min-h-11 flex-wrap items-center gap-2.5 rounded-3xl bg-white px-[26px] py-4 text-[15px] text-black no-underline hover:bg-paper hover:text-black">
          Dictionary check: {proofreadingSummary(report.payload, dismissedIds(await repo.proofreadingChoices(report.payload.proofreading?.documentVersion ?? ""), report.payload.proofreading?.documentVersion))}
          <Tag tone="grey">NOT PART OF YOUR SCORE</Tag>
        </Link>

        <SupplementalChecks assessment={report.payload.assessment} />

        <section aria-label="Next steps" className="flex flex-wrap gap-4">
          {[
            { t: "Tailor to a job", d: "Paste a job ad to see missing keywords and a tailored version.", cta: "Start tailoring", href: "/tailor" },
            { t: "Review a cover letter", d: "Check structure and UK conventions against the job ad.", cta: "Review a letter", href: "/letters" },
            { t: "Find opportunities", d: soon ? `${soon} ${sector.toLowerCase()} ${soon === 1 ? "role closes" : "roles close"} in the next 30 days.` : "Browse graduate schemes, internships and placements.", cta: "Open tracker", href: "/opportunities" },
          ].map((x) => (
            <Link key={x.t} href={x.href} className="flex min-w-0 flex-[1_1_260px] flex-col gap-1.5 rounded-[22px] bg-white px-[22px] py-5 text-black no-underline hover:text-black hover:ring-1 hover:ring-edge">
              <span className="text-lg tracking-[-0.03em]">{x.t}</span>
              <span className="text-sm leading-[1.45] text-muted">{x.d}</span>
              <span className="mt-2 text-sm font-medium text-brand">{x.cta}</span>
            </Link>
          ))}
        </section>
      </WithSidebar>
    </StudentShell>
  );
}
