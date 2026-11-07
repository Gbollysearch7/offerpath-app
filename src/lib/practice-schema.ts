import { z } from "zod";
import { ANSWER_MAX, ANSWER_MIN, PRACTICE_OBJECTIVES, PracticeRefusedError, type PracticeAnswerInput } from "./practice-types";

// OP-023: the one gate a saved answer goes through, in both repositories, so what one accepts the other accepts.

const Text = (n: number) => z.string().max(n);
const Hash = z.string().regex(/^[0-9a-f]{64}$/);

const PartSchema = z.object({ id: Text(80), label: Text(300), check: z.enum(["own_action", "result", "reason", "experience", "learned", "topic", "named", "terms", "honest_gap"]), terms: z.array(Text(200)).max(40).optional() });

const QuestionSchema = z.object({
  id: Text(200).min(1),
  q: Text(1200).min(1),
  kind: z.enum(["competency", "motivation", "commercial", "technical"]),
  tip: Text(600),
  why: Text(1200).min(1),
  grounds: z
    .object({
      requirement: z.object({ id: Text(200), label: Text(300), category: z.enum(["essential", "desirable", "contextual", "uncertain"]), advertQuote: Text(400).nullable() }).nullable(),
      cv: z.object({ heading: Text(400).nullable(), quote: Text(400) }).nullable(),
      gap: z.boolean(),
    })
    .nullable(),
  parts: z.array(PartSchema).max(12),
  focus: z.array(z.enum(["essential", "gaps", "cv", "motivation"])).max(4),
});

const FeedbackSchema = z.object({
  version: Text(80).min(1),
  method: z.enum(["rules", "rules+ai"]),
  words: z.number().int().min(0),
  structure: z.array(z.object({ key: z.enum(["situation", "task", "action", "result"]), label: Text(40), seen: z.boolean() })).length(4),
  substance: z.object({ level: z.enum(["little", "some", "concrete"]), summary: Text(400), details: z.array(Text(200)).max(8) }),
  contribution: z.object({ level: z.enum(["clear", "mixed", "shared", "unclear", "not_asked"]), summary: Text(400), quotes: z.array(Text(400)).max(2) }),
  parts: z.array(z.object({ id: Text(80), label: Text(300), seen: z.boolean(), flaggedByModel: z.boolean().optional() })).max(12),
  unsupported: z.object({ compared: z.boolean(), items: z.array(z.object({ kind: z.enum(["not_on_cv", "no_detail"]), quote: Text(400), note: Text(800) })).max(8) }),
  clearer: z.array(Text(400)).max(8),
  modelNotes: z.array(z.object({ kind: z.enum(["contribution", "unsupported", "clearer"]), quote: Text(400), comment: Text(300) })).max(6),
  blanks: z.array(Text(200)).max(10),
  ignoredSentences: z.number().int().min(0),
});

const InputSchema = z
  .object({
    attemptKey: z.string().regex(/^[\w-]{16,64}$/),
    applicationId: Text(80).nullable(),
    mode: z.enum(["general", "application"]),
    roleLabel: Text(400).nullable(),
    documentReportId: Text(80).nullable(),
    documentVersion: Hash.nullable(),
    documentLabel: Text(300).nullable(),
    advertReportId: Text(80).nullable(),
    advertVersion: Hash.nullable(),
    objective: z.enum(PRACTICE_OBJECTIVES),
    question: QuestionSchema,
    answer: z.string().min(ANSWER_MIN).max(ANSWER_MAX),
    feedback: FeedbackSchema,
  })
  .refine((x) => (x.mode === "application" ? !!x.applicationId && !!x.documentReportId && !!x.documentVersion : !x.applicationId && !x.documentReportId && !x.documentVersion && !x.advertReportId && !x.advertVersion), "grounding doesn't match the mode");

/** Throws PracticeRefusedError rather than saving a record in the wrong shape. The error holds no answer text. */
export function checkPracticeInput(input: PracticeAnswerInput): PracticeAnswerInput {
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) throw new PracticeRefusedError(`practice record refused: ${[...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ")}`);
  return parsed.data as PracticeAnswerInput;
}
