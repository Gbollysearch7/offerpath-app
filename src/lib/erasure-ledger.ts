import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { removeUserFiles } from "@/lib/account-deletion";

// FD-21: which accounts were erased, so a restored backup can have them erased again. The database fills the ledger itself
// (a trigger on auth.users, see the migration), for every way of deleting an account. A ledger in the database goes back
// in time with the database, so its rows have to be exported off-site as well. docs/RESTORE_PROCEDURE.md says how, and what
// is lost without it. Whether keeping these rows, and for how long, is lawful is a legal question: see FD-21.
//
// It holds the account's opaque id and a date. An id is what's needed: it finds the rows and the file folder of that account
// and no other, so someone erased who later signs up again keeps their new account. A keyed hash would need its key outside
// the database, which the trigger can't reach, and couldn't name the folder of an account whose row has gone.

const TABLE = "erasure_ledger";
const PAGE = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface LedgerEntry {
  id: string;
  erasedAt: string;
}

export interface ReapplyResult {
  /** On a dry run: accounts that are present and would be erased. */
  wouldErase: string[];
  /** On a dry run: accounts already absent that still have files. */
  wouldRemoveFilesOnly: string[];
  erased: string[];
  filesRemoved: string[];
  /** Still present or still holding files. Run again; nothing else was stopped by these. */
  failed: string[];
}

/* ---------- The export file: one JSON object per line, ids and dates only ---------- */

export function serialiseLedger(entries: LedgerEntry[]): string {
  return entries.map((e) => JSON.stringify({ id: e.id, erasedAt: e.erasedAt })).join("\n") + (entries.length ? "\n" : "");
}

/** Reads an export. Anything but an id and a date is refused by line number, and never repeated, in case it's personal data. */
export function parseLedgerFile(text: string): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  text.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    const bad = () => new Error(`The ledger file isn't valid at line ${i + 1}: each line must hold only an account id and a date.`);
    let v: unknown;
    try {
      v = JSON.parse(line);
    } catch {
      throw bad();
    }
    const o = v as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || Object.keys(o).sort().join() !== "erasedAt,id") throw bad();
    if (typeof o.id !== "string" || !UUID.test(o.id) || typeof o.erasedAt !== "string" || Number.isNaN(Date.parse(o.erasedAt))) throw bad();
    out.push({ id: o.id, erasedAt: o.erasedAt });
  });
  return out;
}

/** One entry per account, with the earliest date on record: that's when it was erased. */
export function mergeEntries(...lists: LedgerEntry[][]): LedgerEntry[] {
  const byId = new Map<string, LedgerEntry>();
  for (const e of lists.flat()) {
    const had = byId.get(e.id);
    if (!had || Date.parse(e.erasedAt) < Date.parse(had.erasedAt)) byId.set(e.id, e);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/* ---------- The database ---------- */

export async function readLedger(db: SupabaseClient): Promise<LedgerEntry[]> {
  const out: LedgerEntry[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(TABLE).select("account_id, erased_at").order("account_id").range(from, from + PAGE - 1);
    if (error) throw new Error(`Couldn't read the erasure ledger: ${error.message}`);
    const rows = (data ?? []) as { account_id: string; erased_at: string }[];
    out.push(...rows.map((r) => ({ id: r.account_id, erasedAt: new Date(r.erased_at).toISOString() })));
    if (rows.length < PAGE) return out;
  }
}

/** Puts entries from an export back, so the ledger is whole again. A date already on record stays. */
export async function mergeIntoLedger(db: SupabaseClient, entries: LedgerEntry[]): Promise<void> {
  for (let i = 0; i < entries.length; i += PAGE) {
    const rows = entries.slice(i, i + PAGE).map((e) => ({ account_id: e.id, erased_at: e.erasedAt }));
    const { error } = await db.from(TABLE).upsert(rows, { onConflict: "account_id", ignoreDuplicates: true });
    if (error) throw new Error(`Couldn't write to the erasure ledger, so nothing was erased: ${error.message}`);
  }
}

/* ---------- Re-applying ---------- */

async function accountExists(db: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await db.auth.admin.getUserById(id);
  if (data?.user) return true;
  if (error && error.status !== 404) throw new Error(error.message);
  return false;
}

async function hasFiles(db: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await db.storage.from("cvs").list(id, { limit: 1, offset: 0 });
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * Erases each listed account again, the same way as the retention job: files first and verified, then the auth user, which
 * cascades to every row. Without `apply` it only reports. One failure doesn't stop the rest, and running it twice is safe.
 * The ledger is put back first: if that can't be done, nothing is erased.
 */
export async function reapplyErasures(db: SupabaseClient, entries: LedgerEntry[], options: { apply: boolean }): Promise<ReapplyResult> {
  const result: ReapplyResult = { wouldErase: [], wouldRemoveFilesOnly: [], erased: [], filesRemoved: [], failed: [] };
  if (options.apply) await mergeIntoLedger(db, entries);
  for (const { id } of entries) {
    try {
      const present = await accountExists(db, id);
      const files = await hasFiles(db, id);
      if (!options.apply) {
        if (present) result.wouldErase.push(id);
        else if (files) result.wouldRemoveFilesOnly.push(id);
        continue;
      }
      if (!present && !files) continue;
      await removeUserFiles(db, id);
      if (present) {
        const { error } = await db.auth.admin.deleteUser(id);
        if (error) throw new Error(error.message);
        // Read back rather than trust the reply.
        if (await accountExists(db, id)) throw new Error("still present");
        result.erased.push(id);
      } else {
        result.filesRemoved.push(id);
      }
    } catch {
      // The reason may quote a file path or a provider message: the id is what an operator needs to retry.
      result.failed.push(id);
    }
  }
  return result;
}
