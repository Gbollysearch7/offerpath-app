import { z } from "zod";
import type { ProofreadingCategory, ProofreadingCoverage, ProofreadingLanguage } from "@/lib/types";

// The contract every proofreading engine sits behind. A provider returns `unknown` on purpose: its output
// is validated in run.ts like any other outside input, so a hosted service or a local bug can't put an
// unchecked claim into a report.

export const PROOFREADING_CATEGORIES: readonly ProofreadingCategory[] = ["spelling", "grammar", "punctuation", "regional"];

export interface ProofreadRequest {
  /** The normalised document text. Offsets a provider returns are positions in exactly this string. */
  text: string;
  language: ProofreadingLanguage;
  /** Aborted when the time budget runs out. A provider stops and returns what it has, or rejects. */
  signal: AbortSignal;
}

export interface ProofreadingProvider {
  id: string;
  /** True when the provider sends student text off this server. Local is false; `settings.ts` gates true. */
  sendsTextOffServer: boolean;
  proofread(request: ProofreadRequest): Promise<unknown>;
}

const Coverage = z.strictObject({ status: z.enum(["assessed", "partial", "not_assessed"]), note: z.string().min(1) }) satisfies z.ZodType<ProofreadingCoverage>;

const Issue = z.strictObject({
  category: z.enum(["spelling", "grammar", "punctuation", "regional"]),
  rule: z.string().min(1),
  start: z.number().int().min(0),
  end: z.number().int().min(1),
  quote: z.string().min(1),
  message: z.string().min(1),
  suggestions: z.array(z.string().min(1)),
});

/** What every provider must return. Anything else means the provider's answer can't be used at all. */
export const ProviderResult = z.strictObject({
  status: z.enum(["complete", "partial"]),
  engine: z.string().min(1),
  dictionary: z.string().nullable(),
  terminology: z.string().nullable(),
  coverage: z.strictObject({ spelling: Coverage, grammar: Coverage, punctuation: Coverage, regional: Coverage }),
  stats: z.strictObject({ wordsChecked: z.number().int().min(0), wordsSkipped: z.number().int().min(0) }),
  limits: z.array(z.string()),
  issues: z.array(Issue),
});
export type ProviderResult = z.infer<typeof ProviderResult>;
export type ProviderIssue = ProviderResult["issues"][number];
