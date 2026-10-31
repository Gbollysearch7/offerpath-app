"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseCsv, rowsToObjects } from "@/lib/csv";
import { hit, TOO_MANY } from "@/lib/rate-limit";
import type { ImportResult, StudentRecordInput } from "@/lib/repo/types";
import { getRepo } from "@/lib/session";
import type { OpportunityInput } from "@/lib/types";

// Every action re-checks that the caller is a careers admin; the database enforces the same rules.
async function adminRepo() {
  const repo = await getRepo();
  if (!repo) throw new Error("Your session has expired. Sign in again.");
  if ((await repo.profile()).role !== "admin") throw new Error("Only careers admins can do this.");
  return repo;
}

const safeMessage = (e: unknown, fallback: string) => {
  const m = e instanceof Error ? e.message : "";
  return /not at your university|at least one careers admin|session has expired|careers admins|Shared listings/.test(m) ? m : fallback;
};

const STUDENT_FIELDS = {
  email: ["email", "email address", "university email", "student email"],
  student_number: ["student number", "student id", "student no", "id number", "student_number"],
  course: ["course", "programme", "program", "degree"],
  year_of_study: ["year", "year of study", "study year", "year_of_study"],
  faculty: ["faculty", "school", "department", "college"],
  fee_status: ["fee status", "fees", "fee status code", "status", "domicile", "fee_status"],
};

export async function importStudents(csvText: string): Promise<{ result?: ImportResult; columns?: string[]; error?: string }> {
  try {
    const repo = await adminRepo();
    if (!(await hit("importPerAdmin", repo.userId))) return { error: TOO_MANY };
    if (csvText.length > 3_000_000) return { error: "That file is too large. Split it into files of up to 5,000 students." };
    const { records, matched } = rowsToObjects(parseCsv(csvText, 5000), STUDENT_FIELDS);
    if (!matched.includes("email")) return { error: "We couldn't find an email column. Add a header row with a column called \"email\"." };
    if (records.length === 0) return { error: "That file has no student rows under the header." };
    if (records.length > 5000) return { error: "Import at most 5,000 students at a time." };
    const result = await repo.importStudentRecords(records as StudentRecordInput[]);
    revalidatePath("/admin/students");
    return { result, columns: matched };
  } catch (e) {
    return { error: safeMessage(e, "The import didn't work. Check the file and try again.") };
  }
}

export async function setAdmin(email: string, admin: boolean): Promise<{ status?: string; error?: string }> {
  try {
    const repo = await adminRepo();
    const parsed = z.string().trim().toLowerCase().email().safeParse(email);
    if (!parsed.success) return { error: "Enter a valid university email address." };
    const status = await repo.setAdminRole(parsed.data, admin);
    revalidatePath("/admin/team");
    return { status };
  } catch (e) {
    return { error: safeMessage(e, "That didn't work. Try again.") };
  }
}

const OppSchema = z.object({
  id: z.string().regex(/^opp-[\w-]{1,60}$/).optional(),
  role: z.string().trim().min(2).max(160),
  org: z.string().trim().min(1).max(120),
  location: z.string().trim().min(1).max(120),
  type: z.enum(["Graduate scheme", "Internship", "Placement", "Spring week"]),
  sector: z.string().trim().min(1).max(60),
  sponsorsVisa: z.boolean(),
  closesOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().max(8000),
  url: z.string().trim().url().regex(/^https?:\/\//).max(500).nullable().optional(),
});

export async function saveOpportunity(input: OpportunityInput): Promise<{ id?: string; error?: string }> {
  try {
    const repo = await adminRepo();
    const parsed = OppSchema.safeParse({ ...input, url: input.url || null });
    if (!parsed.success) return { error: "Check the fields: role, employer, location, type, sector and closing date are required, and the link must start with https://." };
    const id = await repo.saveOpportunity(parsed.data);
    revalidatePath("/admin/opportunities");
    revalidatePath("/opportunities");
    return { id };
  } catch (e) {
    return { error: safeMessage(e, "That didn't save. Try again.") };
  }
}

export async function deleteOpportunity(id: string): Promise<{ error?: string }> {
  try {
    const repo = await adminRepo();
    if (!/^opp-[\w-]{1,60}$/.test(id)) return { error: "We couldn't find that listing." };
    await repo.deleteOpportunity(id);
    revalidatePath("/admin/opportunities");
    revalidatePath("/opportunities");
    return {};
  } catch (e) {
    return { error: safeMessage(e, "That didn't delete. Try again.") };
  }
}

const OPP_FIELDS = {
  role: ["role", "title", "job title", "position"],
  org: ["employer", "org", "organisation", "organization", "company"],
  location: ["location", "city", "place"],
  type: ["type", "opportunity type"],
  sector: ["sector", "industry"],
  sponsorsVisa: ["sponsors visa", "visa", "visa sponsorship", "sponsorsvisa"],
  closesOn: ["closes", "closes on", "closing date", "deadline", "closeson"],
  url: ["url", "link", "apply link", "website"],
  description: ["description", "details", "summary"],
};

const TYPE_ALIASES: Record<string, OpportunityInput["type"]> = { "graduate scheme": "Graduate scheme", graduate: "Graduate scheme", grad: "Graduate scheme", internship: "Internship", intern: "Internship", placement: "Placement", "industrial placement": "Placement", "spring week": "Spring week", spring: "Spring week", insight: "Spring week" };

function toIsoDate(v: string): string | null {
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // UK day/month/year
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

export async function importOpportunities(csvText: string): Promise<{ saved?: number; skipped?: { row: number; reason: string }[]; error?: string }> {
  try {
    const repo = await adminRepo();
    if (!(await hit("importPerAdmin", repo.userId))) return { error: TOO_MANY };
    const { records, matched } = rowsToObjects(parseCsv(csvText, 1000), OPP_FIELDS);
    for (const need of ["role", "org", "closesOn"] as const) if (!matched.includes(need)) return { error: `We couldn't find a "${need === "org" ? "employer" : need === "closesOn" ? "closing date" : need}" column.` };
    let saved = 0;
    const skipped: { row: number; reason: string }[] = [];
    for (const [i, r] of records.entries()) {
      const parsed = OppSchema.safeParse({
        role: r.role,
        org: r.org,
        location: r.location || "UK",
        type: TYPE_ALIASES[(r.type ?? "").toLowerCase().trim()] ?? "Graduate scheme",
        sector: r.sector || "Other",
        sponsorsVisa: /^(y|yes|true|1)$/i.test(r.sponsorsVisa ?? ""),
        closesOn: toIsoDate(r.closesOn ?? "") ?? "",
        description: r.description ?? "",
        url: r.url || null,
      });
      if (!parsed.success) {
        skipped.push({ row: i + 2, reason: "missing role, employer or a valid closing date (YYYY-MM-DD or DD/MM/YYYY)" });
        continue;
      }
      await repo.saveOpportunity(parsed.data);
      saved++;
    }
    revalidatePath("/admin/opportunities");
    revalidatePath("/opportunities");
    return { saved, skipped };
  } catch (e) {
    return { error: safeMessage(e, "The import didn't work. Check the file and try again.") };
  }
}

export async function addAdviserNote(reportId: string, studentKey: string, note: string): Promise<{ error?: string }> {
  try {
    const repo = await adminRepo();
    const text = note.trim();
    if (text.length < 2 || text.length > 2000) return { error: "Write a note between 2 and 2,000 characters." };
    await repo.adminAddNote(reportId, text);
    revalidatePath(`/admin/students/${studentKey}`);
    return {};
  } catch (e) {
    return { error: safeMessage(e, "That note didn't save. Try again.") };
  }
}
