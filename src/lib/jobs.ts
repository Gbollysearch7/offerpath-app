import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { removeUserFiles, sweepUserFiles } from "@/lib/account-deletion";
import { deadlineReminderEmail, retentionWarningEmail, sendEmail, type Email } from "@/lib/email";
import { legal } from "@/lib/legal";
import { alert, log } from "@/lib/log";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseConfigured } from "@/lib/supabase/server";

// Scheduled jobs, run by /api/cron/* (Vercel Cron). Each is safe to run more than once.

export interface ReminderRow {
  user_id: string;
  email: string;
  full_name: string;
  application_id: string;
  role: string;
  org: string;
  closes_on: string;
}

/** Groups due reminders into one email per student. Pure, so it can be tested. */
export function groupReminders(rows: ReminderRow[]) {
  const byUser = new Map<string, { email: string; name: string; items: { role: string; org: string; closesOn: string }[]; ids: string[] }>();
  for (const r of rows) {
    const g = byUser.get(r.user_id) ?? { email: r.email, name: r.full_name, items: [], ids: [] };
    g.items.push({ role: r.role, org: r.org, closesOn: r.closes_on });
    g.ids.push(r.application_id);
    byUser.set(r.user_id, g);
  }
  return [...byUser.values()];
}

export async function runDeadlineReminders(send: (e: Email) => Promise<{ sent: boolean }> = sendEmail) {
  if (!supabaseConfigured()) return { skipped: "demo mode" };
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("due_deadline_reminders");
  if (error) throw new Error(error.message);
  let emails = 0;
  let failed = 0;
  for (const g of groupReminders((data ?? []) as ReminderRow[])) {
    const res = await send({ to: g.email, ...deadlineReminderEmail(g.name, g.items) });
    if (!res.sent) {
      failed++;
      continue; // not marked, so it's retried tomorrow while the deadline is still ahead
    }
    const { error: markError } = await db.rpc("mark_reminders_sent", { p_application_ids: g.ids });
    if (markError) throw new Error(markError.message);
    emails++;
  }
  if (failed) await alert("reminder-emails-failed", `${failed} deadline reminder emails failed to send.`);
  log("info", "job-deadline-reminders", { emails, failed });
  return { emails, failed };
}

/** Same erasure as self-service deletion, then the auth user, which cascades to every row. */
async function deleteUserCompletely(db: SupabaseClient, userId: string) {
  await removeUserFiles(db, userId);
  const { error } = await db.auth.admin.deleteUser(userId);
  if (error) throw new Error(error.message);
  await sweepUserFiles(db, userId);
}

export async function runRetention(send: (e: Email) => Promise<{ sent: boolean }> = sendEmail, admin: () => SupabaseClient = supabaseAdmin) {
  if (!supabaseConfigured()) return { skipped: "demo mode" };
  const db = admin();
  const { data, error } = await db.rpc("retention_candidates", { p_months: legal.retentionInactiveMonths() });
  if (error) throw new Error(error.message);
  let warned = 0;
  let deleted = 0;
  let failed = 0;
  for (const c of (data ?? []) as { user_id: string; email: string; full_name: string; action: "warn" | "delete" }[]) {
    if (c.action === "warn") {
      const res = await send({ to: c.email, ...retentionWarningEmail(c.full_name) });
      if (res.sent) {
        await db.from("profiles").update({ retention_warned_at: new Date().toISOString() }).eq("id", c.user_id);
        warned++;
      }
    } else {
      // One account that can't be deleted must not stop the rest; it is retried on the next run.
      try {
        await deleteUserCompletely(db, c.user_id);
        deleted++;
      } catch (e) {
        failed++;
        log("error", "job-retention-delete-failed", { user: c.user_id, error: e });
      }
    }
  }
  // Rate-limit windows hold only hashes and counts, and are useless after a day. The limiter's own clean-up is occasional.
  const purge = await db.from("rate_limits").delete().lt("window_start", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  if (purge.error) log("warn", "job-retention-purge-failed", { error: purge.error.message });
  if (failed) await alert("retention-delete-failed", `${failed} inactive accounts could not be deleted; they will be retried on the next run.`);
  log("info", "job-retention", { warned, deleted, failed });
  return { warned, deleted, failed };
}
