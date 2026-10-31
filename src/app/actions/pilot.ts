"use server";

import { z } from "zod";
import { escapeHtml, sendEmail } from "@/lib/email";
import { log } from "@/lib/log";
import { clientIp, hit, TOO_MANY } from "@/lib/rate-limit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseConfigured } from "@/lib/supabase/server";

export type PilotFields = { name: string; university: string; role: string; email: string };
export type PilotState = { ok?: boolean; error?: string; values?: PilotFields } | null;

const oneLine = (max: number) => z.string().transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()).pipe(z.string().max(max));

const Pilot = z.object({
  name: oneLine(120).pipe(z.string().min(1, "Add your name.")),
  university: oneLine(160).pipe(z.string().min(1, "Add your university.")),
  role: oneLine(120),
  email: oneLine(254).pipe(z.email("Enter a valid work email.")),
});

export async function requestPilot(_: PilotState, form: FormData): Promise<PilotState> {
  // Bots fill every field; people never see this one.
  if (String(form.get("website") ?? "")) return { ok: true };
  // Sent back on error so the form keeps what was typed.
  const values = { name: String(form.get("name") ?? "").slice(0, 300), university: String(form.get("university") ?? "").slice(0, 300), role: String(form.get("role") ?? "").slice(0, 300), email: String(form.get("email") ?? "").slice(0, 300) };
  const parsed = Pilot.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", values };
  if (!(await hit("pilotPerIp", await clientIp()))) return { error: TOO_MANY, values };
  const p = parsed.data;

  if (supabaseConfigured()) {
    const { error } = await supabaseAdmin().from("pilot_requests").insert(p);
    if (error) {
      log("error", "pilot-request-save-failed", { error: error.message });
      return { error: "We couldn't send that. Try again, or email us.", values };
    }
  } else {
    log("info", "pilot-request-demo", { university: p.university });
  }

  const to = process.env.SUPPORT_EMAIL;
  if (to) {
    const lines = [`Name: ${p.name}`, `University: ${p.university}`, `Role: ${p.role || "-"}`, `Email: ${p.email}`];
    await sendEmail({ to, subject: `Pilot request: ${p.university}`, text: lines.join("\n"), html: `<p>${lines.map(escapeHtml).join("<br>")}</p>` });
  }
  return { ok: true };
}
