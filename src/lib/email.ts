import "server-only";
import { log } from "@/lib/log";

// Transactional email through Resend's HTTP API. Without RESEND_API_KEY, emails are logged (not sent),
// so the app works in development and before the provider is set up.

export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export const emailConfigured = () => !!process.env.RESEND_API_KEY;

export async function sendEmail(email: Email): Promise<{ sent: boolean; id?: string; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "Offerpath <no-reply@offerpath.app>";
  if (!key) {
    log("info", "email-not-sent-no-provider", { subject: email.subject });
    return { sent: false, error: "no provider configured" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [email.to], subject: email.subject, html: email.html, text: email.text, reply_to: process.env.SUPPORT_EMAIL || undefined }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      log("error", "email-send-failed", { status: res.status, reason: data.message });
      return { sent: false, error: data.message ?? `status ${res.status}` };
    }
    return { sent: true, id: data.id };
  } catch (e) {
    log("error", "email-send-failed", { error: e });
    return { sent: false, error: "network error" };
  }
}

/* ---------- templates ---------- */

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");

/** Simple, accessible, client-safe layout matching the app's colours. Content must already be escaped. */
export function layout(title: string, bodyHtml: string, cta?: { label: string; href: string }): string {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#F2F4F1;font-family:Helvetica,Arial,sans-serif;color:#000">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F4F1;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:20px;padding:32px">
<tr><td style="font-size:18px;font-weight:600;color:#36604E;padding-bottom:24px">Offerpath</td></tr>
<tr><td style="font-size:26px;line-height:1.2;letter-spacing:-0.5px;padding-bottom:16px">${escapeHtml(title)}</td></tr>
<tr><td style="font-size:16px;line-height:1.6;color:#35423D">${bodyHtml}</td></tr>
${cta ? `<tr><td style="padding-top:24px"><a href="${escapeHtml(cta.href)}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 24px;border-radius:999px">${escapeHtml(cta.label)}</a></td></tr>` : ""}
<tr><td style="font-size:12px;line-height:1.5;color:#5C6B66;padding-top:28px;border-top:1px solid #EEF2EF;margin-top:28px">You're getting this because you use Offerpath through your university. <a href="${site()}/privacy" style="color:#36604E">Change your email settings</a>.</td></tr>
</table></td></tr></table></body></html>`;
}

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

export function deadlineReminderEmail(name: string, items: { role: string; org: string; closesOn: string }[]): Omit<Email, "to"> {
  const first = name.split(" ")[0] || "there";
  const list = items.map((i) => `<li style="margin-bottom:8px"><strong>${escapeHtml(i.role)}</strong>, ${escapeHtml(i.org)}<br><span style="color:#5C6B66">Closes ${escapeHtml(fmtDate(i.closesOn))}</span></li>`).join("");
  const subject = items.length === 1 ? `${items[0].org} closes ${fmtDate(items[0].closesOn)}` : `${items.length} applications close this week`;
  return {
    subject,
    html: layout(items.length === 1 ? "A deadline is coming up" : "Deadlines are coming up", `<p style="margin:0 0 12px">Hi ${escapeHtml(first)}, you're tracking ${items.length === 1 ? "a role that closes" : "roles that close"} within a week:</p><ul style="padding-left:20px;margin:0 0 12px">${list}</ul><p style="margin:0">Tailor your CV to the job before you apply.</p>`, { label: "Open my applications", href: `${site()}/opportunities` }),
    text: `Hi ${first}, you're tracking roles that close within a week:\n${items.map((i) => `- ${i.role}, ${i.org}: closes ${fmtDate(i.closesOn)}`).join("\n")}\n\nOpen your applications: ${site()}/opportunities\nChange email settings: ${site()}/privacy`,
  };
}

export function retentionWarningEmail(name: string): Omit<Email, "to"> {
  const first = name.split(" ")[0] || "there";
  return {
    subject: "Your Offerpath account will be deleted in 30 days",
    html: layout("We'll delete your account in 30 days", `<p style="margin:0 0 12px">Hi ${escapeHtml(first)}, you haven't used Offerpath for a while, so in 30 days we'll delete your account and everything in it: CVs, reports, letters and tracked applications.</p><p style="margin:0">To keep it, just sign in. If you'd like a copy first, download your data from Privacy and my data.</p>`, { label: "Keep my account", href: `${site()}/sign-in` }),
    text: `Hi ${first}, you haven't used Offerpath for a while, so in 30 days we'll delete your account and everything in it. To keep it, sign in: ${site()}/sign-in`,
  };
}
