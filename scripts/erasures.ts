// The erasure ledger, for an operator: docs/RESTORE_PROCEDURE.md says when to run these.
//
//   npm run erasures:export  -- --target-ref <ref> --out <file>
//   npm run erasures:reapply -- --target-ref <ref> --ledger <file>[,<file>...] [--apply]
//
// Reads only ERASURE_SUPABASE_URL and ERASURE_SERVICE_ROLE_KEY, set by hand in the shell for this run, so it can't pick up
// the app's variables or .env.local. --target-ref must match the URL. Without --apply, reapply changes nothing.
// Exit codes: 0 done, 1 an account couldn't be erased (run it again), 2 refused before connecting.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { mergeEntries, parseLedgerFile, readLedger, reapplyErasures, serialiseLedger, type LedgerEntry } from "@/lib/erasure-ledger";

const refuse = (message: string): never => {
  console.error(message);
  process.exit(2);
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const USAGE = "Usage: erasures.ts export --target-ref <ref> --out <file>\n       erasures.ts reapply --target-ref <ref> --ledger <file>[,<file>...] [--apply]\n       (--no-export-available in place of --ledger, only if no export exists: erasures since the backup then stay undone)";

function readFiles(list: string): LedgerEntry[][] {
  return list.split(",").map((file) => {
    try {
      return parseLedgerFile(fs.readFileSync(file, "utf8"));
    } catch (e) {
      return refuse(`${file}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
    }
  });
}

async function main() {
  const command = process.argv[2];
  if (command !== "export" && command !== "reapply") refuse(USAGE);
  const ref = arg("target-ref") ?? refuse(USAGE);
  const url = process.env.ERASURE_SUPABASE_URL?.trim() ?? refuse("Set ERASURE_SUPABASE_URL and ERASURE_SERVICE_ROLE_KEY in the shell for this run. The app's variables are ignored on purpose.");
  const key = process.env.ERASURE_SERVICE_ROLE_KEY?.trim() || refuse("Set ERASURE_SUPABASE_URL and ERASURE_SERVICE_ROLE_KEY in the shell for this run. The app's variables are ignored on purpose.");
  let host = "";
  try {
    host = new URL(url!).hostname;
  } catch {
    refuse("ERASURE_SUPABASE_URL isn't a URL.");
  }
  if (host.split(".")[0] !== ref) refuse(`--target-ref ${ref} doesn't match the host in ERASURE_SUPABASE_URL (${host}).`);

  let fromFiles: LedgerEntry[][] = [];
  if (command === "reapply") {
    const list = arg("ledger");
    if (list) fromFiles = readFiles(list);
    else if (!process.argv.includes("--no-export-available")) refuse(`Pass --ledger with the off-site export. Without one, erasures made since the backup can't be found. ${USAGE}`);
  } else if (!arg("out")) refuse(USAGE);

  const db = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
  const inDatabase = await readLedger(db);

  if (command === "export") {
    const out = arg("out")!;
    // Added to what the file already holds, so an export never forgets an account the database has lost.
    const had = fs.existsSync(out) ? parseLedgerFile(fs.readFileSync(out, "utf8")) : [];
    const merged = mergeEntries(had, inDatabase);
    fs.writeFileSync(out, serialiseLedger(merged), { mode: 0o600 });
    console.log(`Wrote ${merged.length} entries (${inDatabase.length} from the database, ${had.length} already in the file). Store it off-site: see docs/RESTORE_PROCEDURE.md.`);
    return;
  }

  const entries = mergeEntries(inDatabase, ...fromFiles);
  const apply = process.argv.includes("--apply");
  const r = await reapplyErasures(db, entries, { apply });
  console.log(`${apply ? "Applied" : "Dry run, nothing changed"}: ${entries.length} entries (${inDatabase.length} in the database).`);
  if (!apply) console.log(`Would erase ${r.wouldErase.length} accounts; would remove files only for ${r.wouldRemoveFilesOnly.length}. Run again with --apply.`);
  else console.log(`Erased ${r.erased.length} accounts; removed leftover files for ${r.filesRemoved.length}; failed ${r.failed.length}.`);
  for (const id of r.failed) console.error(`Failed, run again: ${id}`);
  if (r.failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
