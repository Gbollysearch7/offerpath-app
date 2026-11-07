import { z } from "zod";

// What a careers admin may send. Strict: an unknown field is refused rather than ignored, so a request carrying a
// weight, threshold or score fails here, as well as having no column to land in.

const line = (min: number, max: number) => z.string().trim().min(min).max(max).regex(/^[^\p{Cc}]*$/u);
const optional = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), s.nullable());
const https = z.string().trim().max(500).regex(/^https:\/\/\S+$/).refine((v) => {
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
});
export const UUID = z.string().uuid();
/** A report, student or staff id as the repository hands it out. The Supabase repository also requires a UUID. */
const Ref = z.string().regex(/^[\w-]{1,60}$/);

/** WCAG contrast of a #RRGGBB colour against white, where the page uses it as text and as a heading rule. */
export function contrastOnWhite(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return 1.05 / (l + 0.05);
}

export const SettingsSchema = z.strictObject({
  brandName: optional(line(2, 80)),
  brandColour: optional(z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/).refine((c) => contrastOnWhite(c) >= 4.5)),
  welcome: optional(z.string().trim().max(600)),
  adviserScope: z.enum(["assigned", "all"]),
});

export const ContactSchema = z
  .strictObject({
    id: UUID.nullable().optional(),
    label: line(2, 80),
    purpose: z.string().trim().max(300),
    email: optional(z.string().trim().toLowerCase().email().max(200)),
    phone: optional(line(3, 40)),
    url: optional(https),
    hours: optional(line(2, 120)),
  })
  .refine((c) => c.email || c.phone || c.url);

export const ResourceSchema = z.strictObject({
  id: UUID.nullable().optional(),
  title: line(2, 120),
  url: https,
  description: z.string().trim().max(400),
  groupId: UUID.nullable(),
  active: z.boolean(),
});

const names = (max: number) => z.array(line(1, 120)).max(max);
export const GroupSchema = z
  .strictObject({
    id: UUID.nullable().optional(),
    name: line(2, 80),
    faculties: names(50),
    courses: names(200),
  })
  .refine((g) => g.faculties.length + g.courses.length > 0);

export const DisagreementSchema = z.strictObject({
  reportId: Ref,
  targetKind: z.enum(["score", "area", "check"]),
  targetKey: z.string().trim().max(60),
  rationale: z.string().trim().min(10).max(2000),
});

export const ReferralSchema = z.strictObject({
  studentKey: Ref,
  reportId: Ref.nullable(),
  contactId: UUID.nullable(),
  target: z.string().trim().max(80),
  reason: z.string().trim().min(10).max(1000),
  ownerId: Ref.nullable(),
});

export const ReferralUpdateSchema = z.strictObject({
  id: UUID,
  status: z.enum(["in_progress", "closed", "withdrawn"]).nullable(),
  ownerId: Ref.nullable(),
  note: z.string().trim().max(1000).nullable(),
});
