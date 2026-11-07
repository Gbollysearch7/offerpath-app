import type { CvSource, SourceKind } from "@/lib/types";

// Reading a CV's version history (OP-006). Pure: both repositories return the same CvSource shape, and the pages
// and flows use these helpers rather than walking parent links themselves.

/** The version a report or version descends from: follows parent links up to the upload (or the first paste). */
export function rootOf(all: CvSource[], id: string): CvSource | null {
  const byId = new Map(all.map((s) => [s.id, s]));
  let cur = byId.get(id) ?? null;
  for (let hops = 0; cur && cur.parentId && hops < all.length; hops++) cur = byId.get(cur.parentId) ?? cur;
  return cur;
}

/**
 * Every version in the same lineage as `id`, each after the version it was made from (siblings oldest first).
 * Empty when `id` is not among `all`. Walks parent links rather than timestamps, which two quick saves can share.
 */
export function lineage(all: CvSource[], id: string): CvSource[] {
  const root = rootOf(all, id);
  if (!root) return [];
  const byAge = (a: CvSource, b: CvSource) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  const children = new Map<string, CvSource[]>();
  for (const s of all) if (s.parentId) children.set(s.parentId, [...(children.get(s.parentId) ?? []), s]);
  const out: CvSource[] = [];
  const seen = new Set<string>();
  const visit = (s: CvSource) => {
    if (seen.has(s.id)) return;
    seen.add(s.id);
    out.push(s);
    for (const c of (children.get(s.id) ?? []).sort(byAge)) visit(c);
  };
  visit(root);
  return out;
}

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  upload: "Uploaded file",
  correction: "Corrected text",
  paste: "Typed or pasted text",
};
