import { fmtShort } from "@/components/ui";
import { SCOPE_INFO } from "@/lib/sharing/projection";
import { STATUS_LABEL, type ShareStatus } from "@/lib/sharing/flow";
import type { ShareLinkRecord } from "@/lib/sharing/types";
import { RevokeButton } from "./RevokeButton";

/** A student's links: what each shares, whether it still works, and when it was opened. Times are all the log holds. */
export function LinkList({ links, statuses, titles }: { links: ShareLinkRecord[]; statuses: Map<string, ShareStatus>; titles?: Map<string, string> }) {
  if (links.length === 0) return <p className="m-0 text-[15px] text-muted">No links yet.</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {links.map((l) => {
        const status = statuses.get(l.id) ?? "expired";
        return (
          <li key={l.id} className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-line px-4 py-3.5" data-share-link={status}>
            <div className="min-w-0 flex-[1_1_260px] text-sm leading-normal text-body">
              {titles && <p className="m-0 font-medium text-black [overflow-wrap:anywhere]">{titles.get(l.reportId) ?? "Report"}</p>}
              <p className="m-0">{SCOPE_INFO[l.scope].label}</p>
              <p className="m-0">{STATUS_LABEL[status]}</p>
              <p className="m-0 text-muted">
                Created {fmtShort(l.createdAt)} · {status === "expired" ? "expired" : "expires"} {fmtShort(l.expiresAt)}
              </p>
              <p className="m-0 text-muted">{l.accesses.length === 0 ? "Not opened yet" : `Opened ${l.accesses.length === 1 ? "once" : `${l.accesses.length} times`}, last on ${fmtShort(l.accesses[0])}`}</p>
            </div>
            {!l.revokedAt && status !== "expired" && <RevokeButton linkId={l.id} name={`${titles?.get(l.reportId) ?? "this report"}, ${SCOPE_INFO[l.scope].label}, created ${fmtShort(l.createdAt)}`} />}
          </li>
        );
      })}
    </ul>
  );
}
