"use client";

import { useState, useTransition } from "react";
import { createReferral, recordDisagreement, updateReferral, withdrawDisagreement } from "@/app/actions/adviser";
import { FormError } from "@/components/client";
import { Eyebrow, fmtDate } from "@/components/ui";
import { nextStepWith, REFERRAL_STATUS_LABEL } from "@/lib/institution/labels";
import type { Disagreement, InstitutionContact, Referral, ReferralStatus, StaffOption } from "@/lib/institution/types";
import type { StudentDetail } from "@/lib/repo/types";

const field = "min-h-11 rounded-[14px] border border-edge bg-white px-3 text-[15px] font-normal";
const primary = "min-h-11 self-start rounded-full border-0 bg-black px-[18px] text-sm font-medium text-white hover:bg-ink-2 disabled:opacity-50";
const quiet = "min-h-11 self-start rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper disabled:opacity-50";

const targetLabel = (d: Pick<Disagreement, "targetKind" | "judgment">) => (d.targetKind === "score" ? "Overall score" : (d.judgment.name ?? "Part of the report"));

export function DisagreementPanel({ studentKey, reports, disagreements, viewerName, viewerIsAdmin }: { studentKey: string; reports: StudentDetail["reports"]; disagreements: Disagreement[]; viewerName: string; viewerIsAdmin: boolean }) {
  const [reportId, setReportId] = useState(reports[0]?.id ?? "");
  const [target, setTarget] = useState("score:");
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const report = reports.find((r) => r.id === reportId);
  const withdrawals = new Map(disagreements.filter((d) => d.kind === "withdrawal").map((d) => [d.withdrawsId, d]));
  return (
    <section aria-labelledby="dis-h" className="flex flex-col gap-3 rounded-3xl bg-white px-6 py-[22px]">
      <Eyebrow id="dis-h">DISAGREE WITH THE FEEDBACK · VISIBLE TO THE STUDENT</Eyebrow>
      <p className="m-0 text-sm text-muted">This records your view and your reasons beside the automated result. It can&apos;t change a score, for this student or any other.</p>
      {reports.length === 0 ? (
        <p className="m-0 text-sm text-muted">Available once the student has reviewed a CV.</p>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              setSaved(false);
              const [targetKind, targetKey] = target.split(":");
              const r = await recordDisagreement(studentKey, { reportId, targetKind, targetKey, rationale });
              if (r.error) setError(r.error);
              else {
                setRationale("");
                setSaved(true);
              }
            });
          }}
        >
          <div className="flex flex-wrap gap-3">
            <label className="flex min-w-[220px] flex-1 flex-col gap-1.5 text-sm font-medium">
              Which review
              <select value={reportId} onChange={(e) => { setReportId(e.target.value); setTarget("score:"); }} className={field}>
                {reports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title} · {fmtDate(r.createdAt)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-[220px] flex-1 flex-col gap-1.5 text-sm font-medium">
              Which part
              <select value={target} onChange={(e) => setTarget(e.target.value)} className={field}>
                <option value="score:">Overall score ({report?.score ?? "none"})</option>
                {report?.areas?.map((a) => (
                  <option key={a.key} value={`area:${a.key}`}>
                    {a.name} ({a.score})
                  </option>
                ))}
                {report?.areas?.flatMap((a) => a.checks ?? []).map((c) => (
                  <option key={c.key} value={`check:${c.key}`}>
                    Check: {c.name} ({c.score}/10)
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Why you disagree
            <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={3} maxLength={2000} className="resize-y rounded-[14px] border border-edge p-3 text-[15px] font-normal" />
          </label>
          <FormError message={error} />
          {saved && <p role="status" className="m-0 text-sm text-brand">Recorded. The automated result hasn&apos;t changed.</p>}
          <button type="submit" disabled={pending || rationale.trim().length < 10} className={primary}>
            {pending ? "Saving…" : "Record disagreement"}
          </button>
        </form>
      )}
      {disagreements
        .filter((d) => d.kind === "disagreement")
        .map((d) => {
          const w = withdrawals.get(d.id);
          return (
            <article key={d.id} className="flex flex-col gap-1 border-t border-line pt-3">
              <p className="m-0 text-[15px] font-medium">
                {targetLabel(d)}: automated result {d.judgment.score ?? "none"}
              </p>
              <p className="m-0 whitespace-pre-line text-[15px] leading-relaxed">{d.rationale}</p>
              <p className="m-0 text-[13px] text-subtle">
                {d.author} · {fmtDate(d.createdAt)}
              </p>
              {w ? (
                <p className="m-0 text-[13px] text-subtle">
                  Withdrawn by {w.author} on {fmtDate(w.createdAt)}: {w.rationale}
                </p>
              ) : (
                (viewerIsAdmin || d.author === viewerName) && <WithdrawForm studentKey={studentKey} id={d.id} />
              )}
            </article>
          );
        })}
    </section>
  );
}

function WithdrawForm({ studentKey, id }: { studentKey: string; id: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={quiet}>Withdraw</button>;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await withdrawDisagreement(studentKey, id, reason);
          if (r.error) setError(r.error);
        });
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Why you are withdrawing it (the original stays on record)
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={2000} className="resize-y rounded-[14px] border border-edge p-3 text-[15px] font-normal" />
      </label>
      <FormError message={error} />
      <button type="submit" disabled={pending || reason.trim().length < 10} className={quiet}>
        Confirm withdrawal
      </button>
    </form>
  );
}

export function ReferralPanel({ studentKey, reportId, referrals, staff, contacts, viewerId, viewerIsAdmin }: { studentKey: string; reportId: string | null; referrals: Referral[]; staff: StaffOption[]; contacts: InstitutionContact[]; viewerId: string; viewerIsAdmin: boolean }) {
  const [contactId, setContactId] = useState("");
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  return (
    <section aria-labelledby="ref-h" className="flex flex-col gap-3 rounded-3xl bg-white px-6 py-[22px]">
      <Eyebrow id="ref-h">REFERRALS · THE STUDENT DECIDES</Eyebrow>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setError(null);
            setSaved(false);
            const r = await createReferral({ studentKey, reportId, contactId: contactId || null, target, reason, ownerId: ownerId || null });
            if (r.error) setError(r.error);
            else {
              setReason("");
              setTarget("");
              setSaved(true);
            }
          });
        }}
      >
        <div className="flex flex-wrap gap-3">
          {contacts.length > 0 && (
            <label className="flex min-w-[220px] flex-1 flex-col gap-1.5 text-sm font-medium">
              Service
              <select value={contactId} onChange={(e) => setContactId(e.target.value)} className={field}>
                <option value="">Somewhere else</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!contactId && (
            <label className="flex min-w-[220px] flex-1 flex-col gap-1.5 text-sm font-medium">
              Refer to
              <input value={target} onChange={(e) => setTarget(e.target.value)} maxLength={80} className={field} />
            </label>
          )}
          <label className="flex min-w-[220px] flex-1 flex-col gap-1.5 text-sm font-medium">
            Who owns it
            <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={field}>
              <option value="">Me</option>
              {staff.filter((o) => o.id !== viewerId).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Why you are suggesting it (the student sees this)
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} className="resize-y rounded-[14px] border border-edge p-3 text-[15px] font-normal" />
        </label>
        <FormError message={error} />
        {saved && <p role="status" className="m-0 text-sm text-brand">Saved. It&apos;s waiting for the student on their careers service page; Offerpath doesn&apos;t email them about it.</p>}
        <button type="submit" disabled={pending || reason.trim().length < 10 || (!contactId && target.trim().length < 2)} className={primary}>
          {pending ? "Saving…" : "Suggest referral"}
        </button>
      </form>
      {referrals.map((r) => (
        <ReferralRow key={r.id} studentKey={studentKey} referral={r} staff={staff} canAct={viewerIsAdmin || r.ownerId === viewerId} />
      ))}
    </section>
  );
}

const NEXT: Partial<Record<ReferralStatus, { to: ReferralStatus; label: string }[]>> = {
  proposed: [{ to: "withdrawn", label: "Withdraw" }],
  accepted: [{ to: "in_progress", label: "Start" }, { to: "closed", label: "Close" }],
  in_progress: [{ to: "closed", label: "Close" }],
};

function ReferralRow({ studentKey, referral: r, staff, canAct }: { studentKey: string; referral: Referral; staff: StaffOption[]; canAct: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState("");
  const [pending, start] = useTransition();
  const act = (status: ReferralStatus | null, owner: string | null) =>
    start(async () => {
      setError(null);
      const res = await updateReferral(studentKey, { id: r.id, status, ownerId: owner, note: null });
      if (res.error) setError(res.error);
      else setOwnerId("");
    });
  const others = staff.filter((o) => o.id !== r.ownerId);
  return (
    <article className="flex flex-col gap-2 border-t border-line pt-3">
      <h3 className="m-0 text-[17px] font-normal">{r.target}</h3>
      <p className="m-0 whitespace-pre-line text-[15px] leading-relaxed">{r.reason}</p>
      <dl className="m-0 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[150px_1fr]">
        <dt className="text-subtle">Status</dt>
        <dd className="m-0">{REFERRAL_STATUS_LABEL[r.status]}</dd>
        <dt className="text-subtle">Owner</dt>
        <dd className="m-0">{r.owner ?? "Nobody at the moment"}</dd>
        <dt className="text-subtle">Next step is with</dt>
        <dd className="m-0">{nextStepWith(r)}</dd>
      </dl>
      {r.events.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer">History ({r.events.length})</summary>
          <ul className="mt-1.5 mb-0 flex list-none flex-col gap-1 p-0 text-muted">
            {r.events.map((e, i) => (
              <li key={i}>
                {fmtDate(e.at)}: {e.actor} {e.from ? `moved it to "${REFERRAL_STATUS_LABEL[e.to]}"` : "suggested it"}
                {e.fromOwner !== e.toOwner && e.toOwner ? `, owner now ${e.toOwner}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
      {canAct && (NEXT[r.status] || others.length > 0) && !["closed", "declined", "withdrawn"].includes(r.status) && (
        <div className="flex flex-wrap items-end gap-2">
          {NEXT[r.status]?.map((n) => (
            <button key={n.to} type="button" disabled={pending} onClick={() => act(n.to, null)} className={quiet} aria-label={`${n.label} the referral to ${r.target}`}>
              {n.label}
            </button>
          ))}
          {others.length > 0 && (
            <>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Hand over to
                <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={field}>
                  <option value="">Choose</option>
                  {others.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" disabled={pending || !ownerId} onClick={() => act(null, ownerId)} className={quiet}>
                Hand over
              </button>
            </>
          )}
        </div>
      )}
      <FormError message={error} />
    </article>
  );
}
