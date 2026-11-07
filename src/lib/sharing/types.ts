// OP-020: the shapes of a share link, kept apart from the code that handles tokens and reports so the repositories and
// client components can name them without loading either.

/** What a recipient sees. Each one includes the one before it. "score" is the default. No scope includes CV text. */
export const SHARE_SCOPES = ["score", "areas", "advice"] as const;
export type ShareScope = (typeof SHARE_SCOPES)[number];
export const DEFAULT_SHARE_SCOPE: ShareScope = "score";

/** The lengths a student can choose. The database refuses anything over 30 days as well. */
export const SHARE_EXPIRY_DAYS = [1, 7, 30] as const;
export const DEFAULT_SHARE_EXPIRY_DAYS = 7;

/** A link as its owner reads it. It holds neither the token nor its hash: neither ever leaves the database again. */
export interface ShareLinkRecord {
  id: string;
  reportId: string;
  scope: ShareScope;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  /** Fingerprint of what was previewed. If the report no longer produces it, the link stops working. */
  contentDigest: string;
  /** When the shared page was shown, newest first. Times only: nothing about who opened it. */
  accesses: string[];
}

export interface ShareLinkInput {
  reportId: string;
  tokenHash: string;
  scope: ShareScope;
  contentDigest: string;
  expiresAt: string;
}

/** What the public route needs from a live link. Read by token hash only, with no signed-in user. */
export interface ShareLookup {
  linkId: string;
  scope: string;
  digest: string;
  type: string;
  createdAt: string;
  payload: unknown;
}

export interface ShareBackend {
  /** Null unless the link exists, isn't revoked or expired, and its owner's university allows sharing. */
  lookup(tokenHash: string): Promise<ShareLookup | null>;
  /** Logs one view, if the link is still live at this moment. False means show nothing. */
  recordAccess(linkId: string): Promise<boolean>;
}
