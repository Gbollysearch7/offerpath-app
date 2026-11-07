import type { AreaKey, CheckKey, FindingStatus } from "@/lib/types";
import { BAND_THRESHOLDS, bandKey, type BandKey } from "./rubric";
import type { SupplementalKey } from "./supplemental-context";

// Every word the product shows for a score band, an area, a check or a finding status, in one place.
//
// Labels are presentation. A view, export or email looks them up from the stored score or the stable
// key at render time; they are never saved as part of a score, never part of a fingerprint or a cache
// key, and never a reason to change RUBRIC_VERSION (see the note at the top of rubric.ts). A report
// saved under any earlier wording therefore shows the same words as a new one, while its stored numbers
// and the wording saved inside its findings stay exactly as they were.
//
// Band labels describe the assessed document, not an outcome. The engine checks CV writing against a
// fixed rubric with known gaps (see CHECK_SCOPE in check-content.ts); it cannot know whether a CV will
// reach an interview, so no label may promise one. Keep them short: they sit in coloured strips, and
// wherever a band is colour-coded the label must be shown or read out as text too.

export type BandLabels = Record<BandKey, string>;

export const BAND_LABELS: BandLabels = {
  top: "Very strong",
  high: "Strong",
  mid: "Getting there",
  low: "Needs work",
};

/** The label for a score out of 100. `labels` is injectable so tests can prove a relabel changes nothing else. */
export function bandLabel(score: number, labels: BandLabels = BAND_LABELS): string {
  return labels[bandKey(score)];
}

/** The label of the band above the one `score` is in, or null when the score is already in the top band. */
export function nextBandLabel(score: number, labels: BandLabels = BAND_LABELS): string | null {
  const i = BAND_THRESHOLDS.findIndex((b) => b.key === bandKey(score));
  return i > 0 ? labels[BAND_THRESHOLDS[i - 1].key] : null;
}

export interface BandLegendEntry {
  key: BandKey;
  min: number;
  max: number;
  label: string;
}

/** The bands lowest first with their score ranges, for strips, legends and text alternatives. */
export function bandLegend(labels: BandLabels = BAND_LABELS): BandLegendEntry[] {
  const ascending = [...BAND_THRESHOLDS].reverse();
  return ascending.map((b, i) => ({ key: b.key, min: b.min, max: i + 1 < ascending.length ? ascending[i + 1].min - 1 : 100, label: labels[b.key] }));
}

/** "0 to 49", "90 and above": the range of a legend entry in words, for aria labels. */
export const bandRangeText = (b: BandLegendEntry) => (b.max >= 100 ? `${b.min} and above` : `${b.min} to ${b.max}`);

/**
 * Area names. Each names what its checks measure and nothing more: the structure area reads headings
 * and extracted text, not an employer's screening software; the spelling area compares UK and US
 * variants and bullet consistency, not spelling or grammar in general.
 */
export const AREA_LABELS: Record<AreaKey, string> = {
  impact: "Impact",
  clarity: "Clarity",
  structure: "Structure and readability",
  sector: "Sector fit",
  spelling: "UK spelling and consistency",
  length: "Length and formatting",
};

export const CHECK_LABELS: Record<CheckKey, string> = {
  quant: "Quantifying impact",
  verbs: "Action verbs",
  accomp: "Accomplishments",
  repeat: "Repetition",
  filler: "Filler words",
  buzz: "Buzzwords and clichés",
  passive: "Passive voice",
  sections: "Sections",
  ats: "Text readability",
  contact: "Contact details",
  sector: "Sector keywords",
  spell: "UK/US spelling variants",
  grammar: "Writing consistency",
  length: "Length",
  bulletlen: "Bullet length",
  bullets: "Bullet count",
};

export const areaLabel = (key: AreaKey): string => AREA_LABELS[key];
export const checkLabel = (key: CheckKey): string => CHECK_LABELS[key];

/**
 * Words for a finding's status pill. `passed` means the check's score met its pass line (8 of 10, the
 * line "steps to improve" and the check page already draw); it does not mean nothing was listed, since
 * a check at 8 can still show one item. "Target met" says the first without implying the second.
 * `not_applicable` means the document gave the check nothing to assess, so nothing was.
 */
export const FINDING_STATUS_DISPLAY: Record<FindingStatus, string> = {
  passed: "Target met",
  needs_attention: "Needs attention",
  not_applicable: "Not assessed",
  unavailable: "Not available",
  uncertain: "Uncertain",
};

/** Names of the supplemental checks (OP-009). They aren't part of the score, so they sit apart from CHECK_LABELS. */
export const SUPPLEMENTAL_CHECK_LABELS: Record<SupplementalKey, string> = {
  "supplemental.date_order": "Date order",
  "supplemental.pronouns": "Personal pronouns",
  "supplemental.consistency_dates": "How dates are written",
  "supplemental.consistency_punctuation": "Bullet punctuation",
  "supplemental.consistency_bullets": "Bullet style",
  "supplemental.consistency_headings": "Section headings",
  "supplemental.consistency_visual": "Fonts and alignment",
};

/**
 * Status words for supplemental checks. They have no score, so they have no target to meet: `passed` here means
 * these rules found nothing to raise in the text, which is all that "No issue found" says.
 */
export const SUPPLEMENTAL_STATUS_DISPLAY: Record<FindingStatus, string> = {
  passed: "No issue found",
  needs_attention: "Worth checking",
  not_applicable: "Not assessed",
  unavailable: "Not available",
  uncertain: "Uncertain",
};

/** Shown for a supplemental check on a report saved before that check existed. */
export const SUPPLEMENTAL_NOT_RECORDED = "Not assessed: this report was saved before we added this check. Upload your CV again to include it.";
