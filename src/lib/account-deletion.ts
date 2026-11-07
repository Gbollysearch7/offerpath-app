import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { alert } from "@/lib/log";

// Erasing an account's files, for self-service deletion and the retention job alike. Rows go by cascade when the auth
// user is deleted (including every cv_sources version with its text); the bucket has no such cascade, so files are
// removed here first. The data lifecycle these steps implement is written down in docs/OPERATIONS.md.

const BUCKET = "cvs";
const PAGE = 100;

/** Every object under the user's folder. The folder is the source of truth, whatever rows do or don't point at it. */
async function listFolder(db: SupabaseClient, userId: string): Promise<string[]> {
  const paths: string[] = [];
  const walk = async (prefix: string): Promise<void> => {
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await db.storage.from(BUCKET).list(prefix, { limit: PAGE, offset });
      if (error) throw new Error(error.message);
      for (const item of data ?? []) {
        const path = `${prefix}/${item.name}`;
        if (item.id) paths.push(path);
        else await walk(path);
      }
      if (!data || data.length < PAGE) break;
    }
  };
  await walk(userId);
  return paths;
}

/** Files the rows name: original uploads on versions, and on reports older than versions. Never outside the user's own folder. */
async function pathsFromRows(db: SupabaseClient, userId: string): Promise<string[]> {
  const paths: string[] = [];
  for (const table of ["cv_sources", "reports"]) {
    const { data, error } = await db.from(table).select("storage_path").eq("user_id", userId).not("storage_path", "is", null);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as { storage_path: string }[]) if (row.storage_path.startsWith(`${userId}/`)) paths.push(row.storage_path);
  }
  return paths;
}

async function removeAll(db: SupabaseClient, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += PAGE) {
    const { error } = await db.storage.from(BUCKET).remove(paths.slice(i, i + PAGE));
    if (error) throw new Error(error.message);
  }
}

/**
 * Removes every file the user has and checks they are gone. Throws if any step fails or anything is left, so the
 * caller stops before deleting the rows: an account that still exists can try again, but a file with no account is
 * one nobody can find any more.
 */
export async function removeUserFiles(db: SupabaseClient, userId: string): Promise<void> {
  const paths = [...new Set([...(await listFolder(db, userId)), ...(await pathsFromRows(db, userId))])];
  try {
    await removeAll(db, paths);
  } catch (e) {
    throw new Error(`Couldn't delete your files: ${e instanceof Error ? e.message : "storage error"}`);
  }
  const left = await listFolder(db, userId);
  if (left.length) throw new Error(`Couldn't delete your files: ${left.length} still in storage`);
}

/**
 * Once the rows are gone: anything an upload in flight stored after the first pass. The account no longer exists,
 * so a failure here can't be retried by the student; it raises an alert with the id for the operator instead.
 */
export async function sweepUserFiles(db: SupabaseClient, userId: string): Promise<void> {
  try {
    await removeAll(db, await listFolder(db, userId));
  } catch (e) {
    await alert("account-file-sweep-failed", "A deleted account may have files left in storage. See docs/OPERATIONS.md.", { user: userId, error: e });
  }
}
