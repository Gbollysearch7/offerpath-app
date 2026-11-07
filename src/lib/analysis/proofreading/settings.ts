import type { ProofreadingLanguage } from "@/lib/types";
import { languageToolProvider } from "./languagetool";
import { loadSpellers, localProvider } from "./local";
import type { ProofreadingProvider } from "./provider";

// Which proofreader runs, in which English, for how long. With nothing set: the local dictionary, UK
// English, five seconds. Student text can't leave the server unless someone sets the approval below.
//
// Language is one setting for the whole deployment for now; a choice per student or document is OP-008.

export const DEFAULT_LANGUAGE: ProofreadingLanguage = "en-GB";
export const DEFAULT_TIMEOUT_MS = 5000;

type Env = Record<string, string | undefined>;

export function proofreadingLanguage(env: Env = process.env): ProofreadingLanguage {
  return env.PROOFREADING_LANGUAGE === "en-US" ? "en-US" : DEFAULT_LANGUAGE;
}

export function proofreadingTimeoutMs(env: Env = process.env): number {
  const ms = Number(env.PROOFREADING_TIMEOUT_MS);
  return Number.isFinite(ms) && ms >= 100 && ms <= 30000 ? ms : DEFAULT_TIMEOUT_MS;
}

/** Null means proofreading is switched off, which reports say as "unavailable", never as a pass. */
export function proofreadingProvider(env: Env = process.env): ProofreadingProvider | null {
  if (env.PROOFREADING_PROVIDER === "off") return null;
  if (env.PROOFREADING_PROVIDER !== "languagetool") return localProvider;
  // Sending student text to a third party is a data-processing decision, not a config tweak: without both
  // settings stay local. See "Founder decision" in docs/CLAUDE_BATCH_03_REPORT_OP-007.md.
  if (env.PROOFREADING_EXTERNAL_TEXT_APPROVED !== "true" || !env.PROOFREADING_LANGUAGETOOL_URL) return localProvider;
  return languageToolProvider({
    url: env.PROOFREADING_LANGUAGETOOL_URL,
    apiKey: env.PROOFREADING_LANGUAGETOOL_API_KEY,
    username: env.PROOFREADING_LANGUAGETOOL_USERNAME,
    maxChars: 20000,
    isOtherVariant: async (word, language) => {
      const { gb, us } = await loadSpellers();
      return (language === "en-GB" ? us : gb).correct(word);
    },
  });
}
