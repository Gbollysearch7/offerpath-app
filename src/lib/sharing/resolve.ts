import "server-only";
import { demoShareBackend } from "@/lib/repo/demo";
import { demoLoginAllowed } from "@/lib/env";
import { log } from "@/lib/log";
import { fromStored } from "@/lib/report-schema";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseConfigured } from "@/lib/supabase/server";
import type { CvReviewPayload } from "@/lib/types";
import { projectReport, viewDigest, type SharedView } from "./projection";
import { hashShareToken, isWellFormedToken } from "./token";
import { SHARE_SCOPES, type ShareBackend, type ShareLookup, type ShareScope } from "./types";

/** The service role is the only role allowed to call these two functions: a browser can't try tokens against the database. */
export function supabaseShareBackend(admin: () => Pick<ReturnType<typeof supabaseAdmin>, "rpc"> = supabaseAdmin): ShareBackend {
  return {
    async lookup(tokenHash) {
      const { data, error } = await admin().rpc("share_link_lookup", { p_token_hash: tokenHash });
      if (error) throw new Error(error.message);
      return (data as ShareLookup | null) ?? null;
    },
    async recordAccess(linkId) {
      const { data, error } = await admin().rpc("share_link_record_access", { p_link: linkId });
      if (error) throw new Error(error.message);
      return data === true;
    },
  };
}

const defaultBackend = (): ShareBackend | null => (supabaseConfigured() ? supabaseShareBackend() : demoLoginAllowed() ? demoShareBackend : null);

/**
 * The view a token opens, or null. Every reason for null looks the same to the caller, and any failure, including failing
 * to write the access log, shows nothing. The view is rebuilt from the report on each request, from the scope stored with
 * the link; nothing in the request except the token is read.
 */
export async function resolveShare(token: unknown, backend: ShareBackend | null = defaultBackend()): Promise<SharedView | null> {
  if (!backend || !isWellFormedToken(token)) return null;
  try {
    const link = await backend.lookup(hashShareToken(token));
    if (!link || link.type !== "cv_review" || !SHARE_SCOPES.includes(link.scope as ShareScope)) return null;
    const payload = fromStored("cv_review", link.payload) as CvReviewPayload;
    const view = projectReport(payload, link.createdAt, link.scope as ShareScope);
    if (viewDigest(view, payload) !== link.digest) return null;
    return (await backend.recordAccess(link.linkId)) ? view : null;
  } catch (e) {
    // The token isn't logged; only its failure is. A stored report that can't be read lands here too.
    log("error", "share-resolve-failed", { error: e });
    return null;
  }
}
