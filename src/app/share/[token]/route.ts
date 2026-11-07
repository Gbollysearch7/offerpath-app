import { NextResponse } from "next/server";
import { clientIp, hit } from "@/lib/rate-limit";
import { RATE_LIMITED_HTML, renderSharedPage, UNAVAILABLE_HTML } from "@/lib/sharing/render";
import { resolveShare } from "@/lib/sharing/resolve";

// The public page behind a share link. A route handler, not a page: it inherits no layout, so no analytics script or
// client code runs here, and it sets its own headers. Nothing in the request except the token is read, so no query
// parameter can change what is shown. The database is read on every request, so revocation and expiry apply to the next one.

export const dynamic = "force-dynamic";

const NO_TRACE = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Content-Type": "text/html; charset=utf-8",
};

const respond = (html: string | null, status: number, extra: Record<string, string> = {}) => new NextResponse(html, { status, headers: { ...NO_TRACE, ...extra } });

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Applied before the token is looked at, so a limited response says nothing about whether the link is real.
  if (!(await hit("shareTokenPerIp", await clientIp())) || !(await hit("shareTokenPerLink", token))) return respond(RATE_LIMITED_HTML, 429, { "Retry-After": "600" });
  const view = await resolveShare(token);
  return view ? respond(renderSharedPage(view), 200) : respond(UNAVAILABLE_HTML, 404);
}

// Next would otherwise answer HEAD by running GET, and a link checker's HEAD would count as someone opening the report.
export function HEAD() {
  return respond(null, 405, { Allow: "GET" });
}
