import { AREA_META } from "@/lib/analysis/cv";
import { bandLabel } from "@/lib/analysis/labels";
import type { SharedView } from "./projection";

// The shared page is plain HTML with no script, no external resource and no link out, so nothing on it can send the URL
// anywhere: no analytics, no referrer, no client router cache. The student's preview uses this same fragment, so the two
// can't disagree. Every value goes through `esc`.

const esc = (s: string | number) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const H2 = "margin:20px 0 8px;font-size:15px;font-weight:600;color:#111";
const P = "margin:8px 0 0;font-size:15px;line-height:1.5;color:#2b3431;overflow-wrap:anywhere";
const LI = "margin:6px 0 0;font-size:15px;line-height:1.5;color:#2b3431;overflow-wrap:anywhere";
const LIST = "margin:0;padding:0 0 0 20px;list-style:disc";

const fmtDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function scoreBlock(view: SharedView): string {
  if (view.score === null) {
    return `<p style="${P}"><strong>No overall score.</strong> Only about ${esc(view.assessedPercent)}% of what makes up the score could be assessed, so a total wouldn't mean much.</p>`;
  }
  const note = view.coverage === "incomplete" ? `<p style="${P}"><strong>Incomplete score.</strong> Part of this CV could not be fully assessed, so the number may not reflect all of it.</p>` : "";
  return `<p style="margin:0;font-size:40px;line-height:1.1;letter-spacing:-0.03em;color:#111">${esc(view.score)}<span style="font-size:15px;letter-spacing:0;color:#4d5a55"> out of 100</span></p><p style="${P}">${esc(bandLabel(view.score))}</p>${note}`;
}

/** Exactly what a recipient reads. The preview and the public page both show this string. */
export function renderSharedFragment(view: SharedView): string {
  const parts = [`<p style="margin:0 0 16px;font-size:14px;color:#4d5a55">CV reviewed on ${esc(fmtDay(view.reviewedOn))}</p>`, `<h2 style="${H2};margin-top:0">Readiness Score</h2>`, scoreBlock(view)];
  if (view.areas.length) parts.push(`<h2 style="${H2}">Area scores</h2><ul style="${LIST}">${view.areas.map((a) => `<li style="${LI}">${esc(AREA_META[a.key].name)}: ${esc(a.score)} out of 100</li>`).join("")}</ul>`);
  if (view.steps.length) parts.push(`<h2 style="${H2}">Steps to improve</h2><ul style="${LIST}">${view.steps.map((s) => `<li style="${LI}">${esc(s.text)}</li>`).join("")}</ul>`);
  if (view.wells.length) parts.push(`<h2 style="${H2}">Strengths</h2><ul style="${LIST}">${view.wells.map((w) => `<li style="${LI}">${esc(w.text)}</li>`).join("")}</ul>`);
  parts.push(`<p style="${P};margin-top:20px;font-size:13px;color:#4d5a55">This score is automated guidance about one version of a CV, which may have changed since. It has not been checked by a careers adviser and doesn't predict the outcome of an application.</p>`);
  return parts.join("");
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow, noarchive"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title></head><body style="margin:0;background:#f3f5f3;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif"><main id="main" style="box-sizing:border-box;max-width:640px;margin:0 auto;padding:32px 16px">${body}</main></body></html>`;
}

const CARD = "margin-top:16px;padding:24px 20px;border-radius:20px;background:#fff";
const H1 = "margin:0;font-size:26px;font-weight:500;letter-spacing:-0.02em;color:#111";

export function renderSharedPage(view: SharedView): string {
  return page("Shared CV review · Offerpath", `<h1 style="${H1}">Shared CV review</h1><p style="${P}">Someone shared this summary from Offerpath with you. It leaves out their CV and their name.</p><div style="${CARD}">${renderSharedFragment(view)}</div>`);
}

/** The one response for every link that can't be shown, whatever the reason. It takes no input, so it can't vary. */
export const UNAVAILABLE_HTML = page("Link not available · Offerpath", `<h1 style="${H1}">This link isn't available</h1><p style="${P}">Ask the person who sent it for a new one.</p>`);

export const RATE_LIMITED_HTML = page("Try again later · Offerpath", `<h1 style="${H1}">Too many requests</h1><p style="${P}">Wait a few minutes and try again.</p>`);
