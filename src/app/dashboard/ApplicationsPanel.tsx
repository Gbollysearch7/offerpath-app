import Link from "next/link";
import { fmtDate } from "@/components/ui";
import { downloadHref, downloadSentence, reportHref, type ApplicationGroup, type ArtefactSlot, type ArtefactSummary, type RoleGroup, type Workspace } from "@/lib/applications/workspace";
import { ARTEFACT_KIND_FOR, type ArtefactKind } from "@/lib/applications/types";
import type { PracticeSummary } from "@/lib/practice-types";
import { APP_STATUS_LABEL, REPORT_TYPE_LABEL } from "@/lib/types";
import { AddToApplicationButton, DownloadButton, LinkPicker, SlotButtons, StopTrackingButton, TrackRoleButton } from "./ApplicationControls";

const KIND_LABEL: Record<ArtefactKind, string> = { cv: "CV", tailor: "Tailored CV", letter: "Cover letter" };
const MISSING: Record<ArtefactKind, { href: (g: ApplicationGroup) => string; cta: string }> = {
  cv: { href: () => "/upload", cta: "Upload a CV" },
  tailor: { href: (g) => (g.application.opportunityId ? `/tailor?opp=${encodeURIComponent(g.application.opportunityId)}` : "/tailor"), cta: "Tailor your CV" },
  letter: { href: () => "/letters", cta: "Write a letter" },
};
const KINDS: ArtefactKind[] = ["tailor", "letter", "cv"];
const textLink = "inline-flex min-h-[38px] items-center rounded-full border border-edge bg-white px-3.5 text-[13px] text-black no-underline hover:bg-paper hover:text-black";

function Downloads({ artefact, versionId, show }: { artefact: ArtefactSummary; versionId: string | null; show: boolean }) {
  if (!show) return null;
  if (artefact.type === "linkedin") return <DownloadButton href={downloadHref(artefact, "docx")} label="Text file" name={artefact.title} />;
  return (
    <>
      <DownloadButton href={downloadHref(artefact, "docx", versionId)} label="Word" name={artefact.title} />
      <DownloadButton href={downloadHref(artefact, "pdf", versionId)} label="PDF" name={artefact.title} />
    </>
  );
}

const canDownload = (s: ArtefactSlot["download"]) => s.state === "current" || s.state === "behind" || s.state === "never";

function SlotRow({ group, kind, optionsFor }: { group: ApplicationGroup; kind: ArtefactKind; optionsFor: (k: ArtefactKind) => { id: string; label: string }[] }) {
  const slot = group.slots[kind];
  const app = group.application;
  const roleName = `${app.role} at ${app.org}`;
  if (!slot) {
    return (
      <li className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line py-2.5">
        <span className="w-[108px] shrink-0 font-mono text-[11px] text-muted">{KIND_LABEL[kind].toUpperCase()}</span>
        <span className="min-w-0 flex-[1_1_120px] text-sm text-muted">None yet</span>
        <Link href={MISSING[kind].href(group)} className={textLink}>
          {MISSING[kind].cta}
          <span className="sr-only-abs"> for {roleName}</span>
        </Link>
        {optionsFor(kind).length > 0 && (
          <details className="w-full text-[13px] text-muted">
            <summary className="min-h-7 cursor-pointer">
              Link one you have<span className="sr-only-abs"> as the {KIND_LABEL[kind]} for {roleName}</span>
            </summary>
            <div className="mt-2">
              <LinkPicker applicationId={app.id} holder={null} options={optionsFor(kind)} label="Choose a document" />
            </div>
          </details>
        )}
      </li>
    );
  }
  const a = slot.artefact;
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 border-t border-line py-3">
      <span className="w-[108px] shrink-0 pt-0.5 font-mono text-[11px] text-muted">{KIND_LABEL[kind].toUpperCase()}</span>
      <div className="min-w-0 flex-[1_1_220px]">
        <Link href={reportHref(a)} className="text-sm text-black [overflow-wrap:anywhere]">
          {a.title}
        </Link>
        <p className="mt-0.5 mb-0 text-[13px] text-muted">
          {slot.versionLabel ? `${slot.versionLabel} · ` : ""}made {fmtDate(a.createdAt)}
          {slot.how === "derived" ? ` · used by ${slot.derivedFrom}` : ""}
          {slot.kept && !slot.kept.isLatest ? ` · ${a.current ? `version ${a.current.n}` : "a newer version"} is the latest` : ""}
        </p>
        <p className="mt-0.5 mb-0 text-[13px] text-ink-2">{downloadSentence(slot.download)}</p>
        {a.stale && <p className="mt-0.5 mb-0 text-[13px] text-ink-2">{a.stale}</p>}
      </div>
      <div className="flex flex-[1_1_100%] flex-wrap items-center gap-2 sm:flex-[0_1_auto]">
        <Downloads artefact={a} versionId={slot.downloadVersionId} show={canDownload(slot.download)} />
        <SlotButtons applicationId={app.id} reportId={a.reportId} kind={kind} name={a.title} linked={slot.how === "linked"} latest={a.latest} kept={!!slot.kept} />
      </div>
      <details className="w-full text-[13px] text-muted">
        <summary className="min-h-7 cursor-pointer">Use a different one<span className="sr-only-abs"> as the {KIND_LABEL[kind]} for {roleName}</span></summary>
        <div className="mt-2">
          <LinkPicker applicationId={app.id} holder={slot.how === "linked" ? a.reportId : null} options={optionsFor(kind).filter((o) => o.id !== a.reportId)} label="Choose another" />
        </div>
      </details>
    </li>
  );
}

/** OP-023: the practice that belongs to this role, and whether it was on the version the student is using now. Counts and dates only: answers stay on the practice pages. */
function PracticeRow({ group, summary }: { group: ApplicationGroup; summary: PracticeSummary | undefined }) {
  const app = group.application;
  const onHand = [group.slots.tailor, group.slots.cv].flatMap((s) => (s?.kept ? [s.kept.documentVersion] : s?.artefact.latest ? [s.artefact.latest, ...s.artefact.sameAsLatest] : []));
  const behind = summary?.latestVersion && !onHand.includes(summary.latestVersion);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line py-2.5">
      <span className="w-[108px] shrink-0 font-mono text-[11px] text-muted">INTERVIEW PRACTICE</span>
      <span className="min-w-0 flex-[1_1_120px] text-sm text-muted [overflow-wrap:anywhere]">
        {summary ? `${summary.count} saved ${summary.count === 1 ? "answer" : "answers"} · latest ${fmtDate(summary.latestAt)}${summary.latestDocumentLabel ? ` · on ${summary.latestDocumentLabel}` : ""}${behind ? " · your CV for this role has changed since" : ""}` : "None yet"}
      </span>
      <Link href={`/practice/interview?application=${encodeURIComponent(app.id)}`} className={textLink}>
        Practise
        <span className="sr-only-abs"> for {app.role} at {app.org}</span>
      </Link>
    </li>
  );
}

function ApplicationCard({ group, optionsFor, practice }: { group: ApplicationGroup; optionsFor: (k: ArtefactKind) => { id: string; label: string }[]; practice: PracticeSummary | undefined }) {
  const app = group.application;
  return (
    <article className="rounded-2xl bg-canvas px-4 pt-3.5 pb-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-2.5">
        <h3 className="m-0 min-w-0 flex-[1_1_220px] text-base font-normal tracking-[-0.02em] [overflow-wrap:anywhere]">
          {app.role} <span className="text-muted">at {app.org}</span>
        </h3>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs text-ink-2">{APP_STATUS_LABEL[app.status]}</span>
        {app.closesOn && <span className="text-[13px] text-muted">Closes {fmtDate(app.closesOn)}</span>}
        <StopTrackingButton applicationId={app.id} name={`${app.role} at ${app.org}`} />
      </div>
      <ul className="m-0 list-none p-0">
        {KINDS.map((k) => (
          <SlotRow key={k} group={group} kind={k} optionsFor={optionsFor} />
        ))}
        <PracticeRow group={group} summary={practice} />
      </ul>
    </article>
  );
}

function DocumentRow({ a, children }: { a: ArtefactSummary; children?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 border-t border-line py-3">
      <div className="min-w-0 flex-[1_1_220px]">
        <Link href={reportHref(a)} className="text-sm text-black [overflow-wrap:anywhere]">
          {a.title}
        </Link>
        <p className="mt-0.5 mb-0 text-[13px] text-muted">
          {REPORT_TYPE_LABEL[a.type]}
          {a.current ? ` · version ${a.current.n}` : ""} · made {fmtDate(a.createdAt)}
        </p>
        {!a.readable && <p className="mt-0.5 mb-0 text-[13px] text-ink-2">We couldn&apos;t read this record just now. It hasn&apos;t been lost: try opening it, or contact support.</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </li>
  );
}

function RoleCard({ group, workspace, downloads }: { group: RoleGroup; workspace: Workspace; downloads: (a: ArtefactSummary) => { sentence: string; can: boolean } }) {
  const newest = group.documents[0];
  const name = group.role && group.org ? `${group.role} at ${group.org}` : newest.title;
  const onSuggestion = group.suggestion ? workspace.applications.find((g) => g.application.id === group.suggestion!.id) : null;
  return (
    <article className="rounded-2xl bg-canvas px-4 pt-3.5 pb-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-2.5">
        <h3 className="m-0 min-w-0 flex-[1_1_220px] text-base font-normal tracking-[-0.02em] [overflow-wrap:anywhere]">{name}</h3>
        {!group.suggestion && newest.role && <TrackRoleButton reportId={newest.reportId} name={name} />}
      </div>
      {group.suggestion && <p className="mt-0 mb-2 text-[13px] text-muted">You&apos;re tracking a role with the same title and employer. These stay separate until you link them.</p>}
      <ul className="m-0 list-none p-0">
        {group.documents.map((a) => {
          const d = downloads(a);
          const kind = ARTEFACT_KIND_FOR[a.type]!;
          const free = onSuggestion && !onSuggestion.slots[kind];
          return (
            <DocumentRow key={a.reportId} a={a}>
              <span className="w-full text-[13px] text-ink-2">{d.sentence}</span>
              <Downloads artefact={a} versionId={null} show={d.can} />
              {free && <AddToApplicationButton applicationId={group.suggestion!.id} reportId={a.reportId} name={a.title} role={group.suggestion!.role} />}
            </DocumentRow>
          );
        })}
      </ul>
    </article>
  );
}

export function ApplicationsPanel({ workspace, downloads, practice = {} }: { workspace: Workspace; downloads: (a: ArtefactSummary) => { sentence: string; can: boolean }; practice?: Record<string, PracticeSummary> }) {
  const optionsFor = (kind: ArtefactKind) => workspace.all.filter((a) => ARTEFACT_KIND_FOR[a.type] === kind && a.readable).slice(0, 25).map((a) => ({ id: a.reportId, label: `${a.title} · ${fmtDate(a.createdAt)}` }));
  return (
    <>
      <section id="applications" aria-labelledby="apps-h" className="flex scroll-mt-4 flex-col gap-3 rounded-3xl bg-white px-4 py-[22px] sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="apps-h" className="m-0 text-lg font-normal tracking-[-0.02em]">
            My applications
          </h2>
          <Link href="/opportunities" className="text-sm">
            Find or move roles
          </Link>
        </div>
        <p className="m-0 text-[13px] text-muted">Which document belongs to which role, and whether your download has its latest changes. Each document keeps its own history.</p>
        {workspace.applications.length === 0 && <p className="m-0 rounded-2xl bg-canvas p-4 text-sm text-muted">You aren&apos;t tracking a role yet. Track one in Opportunities, or from a tailored CV below.</p>}
        {workspace.applications.map((g) => (
          <ApplicationCard key={g.application.id} group={g} optionsFor={optionsFor} practice={practice[g.application.id]} />
        ))}
      </section>

      {(workspace.roles.length > 0 || workspace.profile.length > 0) && (
        <section aria-labelledby="other-h" className="flex flex-col gap-3 rounded-3xl bg-white px-4 py-[22px] sm:px-6">
          <h2 id="other-h" className="m-0 text-lg font-normal tracking-[-0.02em]">
            Not on an application
          </h2>
          {workspace.roles.map((g) => (
            <RoleCard key={g.key} group={g} workspace={workspace} downloads={downloads} />
          ))}
          {workspace.profile.length > 0 && (
            <article className="rounded-2xl bg-canvas px-4 pt-3.5 pb-1">
              <h3 className="m-0 pb-1 text-base font-normal tracking-[-0.02em]">Your LinkedIn profile</h3>
              <p className="mt-0 mb-2.5 text-[13px] text-muted">A profile isn&apos;t written for one role, so it isn&apos;t linked to an application.</p>
              <ul className="m-0 list-none p-0">
                {workspace.profile.map((a) => {
                  const d = downloads(a);
                  return (
                    <DocumentRow key={a.reportId} a={a}>
                      <span className="w-full text-[13px] text-ink-2">{d.sentence}</span>
                      <Downloads artefact={a} versionId={null} show={d.can} />
                    </DocumentRow>
                  );
                })}
              </ul>
            </article>
          )}
        </section>
      )}
    </>
  );
}
