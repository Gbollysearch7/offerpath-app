import { createHash } from "node:crypto";

// Fingerprints decide when two pieces of text count as "the same" for scoring.
// Formatting noise from re-exporting a CV (bullet glyphs, smart quotes, dashes, spacing,
// line wrapping, letter case) must never change a score, so it is removed before hashing.

/**
 * The normalisation contract. Bump when `normaliseText` or `bulletKey` would return anything different for any
 * input: both decide what counts as the same content, so a change can move a score. The golden vectors in
 * tests/scoring-contract.test.ts fail until this is bumped. A bump starts a new scoring series (scoring-contract.ts).
 */
export const NORMALISER_VERSION = "normaliser-2026-11-06.1";

/** Text as the scorer should see it: same words, consistent characters and spacing. */
export function normaliseText(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[  -​  　]/g, " ")
    .replace(/[‌-‏﻿]/g, "")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/^[ \t]*[•●▪‣◦∙·*–—›»▸►▶➢➤→✓✔■□◆◇♦○❖-][ \t]+/gm, "• ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

/** Key for a single bullet: case, punctuation and spacing don't matter, words do. */
export function bulletKey(text: string): string {
  return normaliseText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}£$€%+]+/gu, " ")
    .trim();
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
