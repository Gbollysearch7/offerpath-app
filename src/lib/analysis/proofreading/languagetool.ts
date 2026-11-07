import { z } from "zod";
import type { ProofreadingCategory, ProofreadingLanguage } from "@/lib/types";
import type { ProofreadingProvider, ProofreadRequest, ProviderIssue, ProviderResult } from "./provider";

// A LanguageTool adapter, written from the public API documentation and tested only against a fake server.
// IT IS NOT ACTIVE and has never spoken to a real LanguageTool. It sends student text to whatever URL it is
// given, so `settings.ts` won't construct it without an explicit approval setting. That needs the founder
// decision recorded in docs/CLAUDE_BATCH_03_REPORT_OP-007.md.

export interface LanguageToolConfig {
  /** Base URL of a server, up to and including /v2. */
  url: string;
  apiKey?: string;
  username?: string;
  /** The documented request limit is 20,000 characters on the free tier and 60,000 on Premium. */
  maxChars: number;
  fetch?: typeof fetch;
  /** True if a word is valid in the other English variant: such a word is a preference, never a misspelling. */
  isOtherVariant: (word: string, language: ProofreadingLanguage) => Promise<boolean>;
}

const Response = z.object({
  software: z.object({ version: z.string() }),
  matches: z.array(
    z.object({
      message: z.string().min(1),
      offset: z.number().int().min(0),
      length: z.number().int().min(1),
      replacements: z.array(z.object({ value: z.string().optional() })),
      context: z.object({ text: z.string(), offset: z.number().int().min(0), length: z.number().int().min(1) }),
      rule: z.object({ id: z.string().min(1), issueType: z.string().optional(), category: z.object({ id: z.string().optional() }) }),
    }),
  ),
});

/** Only categories this maps are shown; style advice is out of scope and is left out of the report. */
function categoryOf(categoryId: string | undefined): ProofreadingCategory | null {
  if (categoryId === "TYPOS") return "spelling";
  if (categoryId === "PUNCTUATION" || categoryId === "TYPOGRAPHY") return "punctuation";
  if (categoryId === "GRAMMAR" || categoryId === "CONFUSED_WORDS") return "grammar";
  return null;
}

export function languageToolProvider(config: LanguageToolConfig): ProofreadingProvider {
  return {
    id: "languagetool",
    sendsTextOffServer: true,
    async proofread({ text, language, signal }: ProofreadRequest): Promise<ProviderResult> {
      if (text.length > config.maxChars) throw new Error("text is longer than this LanguageTool server accepts");
      const body = new URLSearchParams({ text, language });
      if (config.username) body.set("username", config.username);
      if (config.apiKey) body.set("apiKey", config.apiKey);
      const res = await (config.fetch ?? fetch)(`${config.url.replace(/\/$/, "")}/check`, { method: "POST", body, signal, headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" } });
      if (!res.ok) throw new Error(`LanguageTool answered ${res.status}`);
      const parsed = Response.parse(await res.json());
      const issues: ProviderIssue[] = [];
      for (const m of parsed.matches) {
        let category = categoryOf(m.rule.category.id);
        if (!category) continue;
        // Quoted from LanguageTool's own context, not from our text, so run.ts catches an offset that doesn't line up.
        const quote = m.context.text.slice(m.context.offset, m.context.offset + m.context.length);
        if (category === "spelling" && (await config.isOtherVariant(quote, language))) category = "regional";
        issues.push({ category, rule: m.rule.id, start: m.offset, end: m.offset + m.length, quote, message: m.message, suggestions: m.replacements.flatMap((r) => (r.value ? [r.value] : [])).slice(0, 3) });
      }
      const words = text.match(/\S+/g)?.length ?? 0;
      const assessed = (note: string) => ({ status: "assessed" as const, note });
      return {
        status: "complete",
        engine: `languagetool-${parsed.software.version}`,
        dictionary: null,
        terminology: null,
        coverage: {
          spelling: assessed("Checked by LanguageTool."),
          grammar: assessed("Checked by LanguageTool's grammar rules."),
          punctuation: assessed("Checked by LanguageTool's punctuation rules."),
          regional: assessed("A spelling valid in the other English variant is shown as a preference, never as a mistake."),
        },
        stats: { wordsChecked: words, wordsSkipped: 0 },
        limits: [],
        issues,
      };
    },
  };
}
