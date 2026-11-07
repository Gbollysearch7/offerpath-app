import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { fmtDate } from "@/components/ui";
import { ACCESS_ACTION_LABEL } from "@/lib/institution/labels";
import { requireAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Access log" };

const PAGE = 50;

export default async function AccessLogPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { repo, profile } = await requireAdmin();
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const [uni, entries] = await Promise.all([repo.adminUniversity(), repo.adminAccessLog({ limit: PAGE + 1, offset: (page - 1) * PAGE })]);
  const more = entries.length > PAGE;
  return (
    <AdminShell
      profile={profile}
      university={uni.name}
      active="access"
      title="Access log"
      intro="Every time careers staff at your university open a student, change something about their record, export a file or change the service. Refused attempts are included. Entries can't be edited. Students see the entries about them. Kept for 24 months."
    >
      <section className="rounded-3xl bg-white px-6 py-[22px]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">ENTRIES</h2>
          <a href="/admin/export?pack=access" className="inline-flex min-h-11 items-center rounded-full border border-edge bg-white px-4 text-sm text-black no-underline hover:bg-paper hover:text-black">
            Download CSV
          </a>
        </div>
        {entries.length === 0 && <p className="m-0 text-sm text-muted">Nothing logged yet.</p>}
        <ul className="m-0 flex list-none flex-col p-0">
          {entries.slice(0, PAGE).map((e, i) => (
            <li key={`${e.at}-${i}`} className="flex flex-wrap gap-x-3 border-t border-line py-2.5 text-sm first:border-t-0">
              <span className="text-subtle">{fmtDate(e.at)}</span>
              <span>
                {e.actor} <span className="text-subtle">({e.actorRole})</span>
              </span>
              <span>{ACCESS_ACTION_LABEL[e.action] ?? e.action}</span>
              {e.student && <span>· Student {e.student}</span>}
              {e.studentGone && <span>· Account since deleted</span>}
              {e.outcome === "denied" && <span className="font-medium">· Refused</span>}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-3 text-sm">
          {page > 1 && <Link href={`/admin/access-log?page=${page - 1}`}>Newer</Link>}
          {more && <Link href={`/admin/access-log?page=${page + 1}`}>Older</Link>}
        </div>
      </section>
    </AdminShell>
  );
}
