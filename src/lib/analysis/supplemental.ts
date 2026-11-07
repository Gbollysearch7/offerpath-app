import type { Assessment, Finding, FindingStatus } from "@/lib/types";
import { SUPPLEMENTAL_CHECK_LABELS, SUPPLEMENTAL_NOT_RECORDED, SUPPLEMENTAL_STATUS_DISPLAY } from "./labels";
import { bulletConsistencyFinding, dateConsistencyFinding, headingConsistencyFinding, punctuationConsistencyFinding, visualConsistencyFinding } from "./supplemental-consistency";
import { readCv, SUPPLEMENTAL_KEYS, supplementalFinding, type CvReading, type SupplementalKey } from "./supplemental-context";
import { dateOrderFinding } from "./supplemental-dates";
import { pronounFinding } from "./supplemental-pronouns";

// The supplemental checks (OP-009): date order, pronouns and consistency. They explain writing decisions and
// aren't part of the score. Nothing here is read by cv.ts, rubric.ts, the fingerprint or the judgment cache, and
// tests/supplemental.test.ts holds that in place. Whether any of them should ever affect a score is for OP-010/011.

export { SUPPLEMENTAL_KEYS };
export type { SupplementalKey };

export const isSupplemental = (f: { id: string }) => f.id.startsWith("supplemental.");

const FAILED = "We couldn't complete this check, so it wasn't assessed. Your score isn't affected.";

/** A check that throws leaves its own finding as unavailable: it never passes, and never stops a report being made. */
export function runCheck(id: SupplementalKey, check: () => Finding): Finding {
  try {
    return check();
  } catch {
    return supplementalFinding(id, "unavailable", FAILED);
  }
}

const CHECKS: Record<SupplementalKey, (cv: CvReading) => Finding> = {
  "supplemental.date_order": dateOrderFinding,
  "supplemental.pronouns": pronounFinding,
  "supplemental.consistency_dates": dateConsistencyFinding,
  "supplemental.consistency_punctuation": punctuationConsistencyFinding,
  "supplemental.consistency_bullets": bulletConsistencyFinding,
  "supplemental.consistency_headings": headingConsistencyFinding,
  "supplemental.consistency_visual": () => visualConsistencyFinding(),
};

/** One finding per supplemental check, always all of them, in a fixed order. `documentVersion` is the sha256 of `text`. */
export function supplementalFindings(text: string, documentVersion: string): Finding[] {
  let cv: CvReading;
  try {
    cv = readCv(text, documentVersion);
  } catch {
    return SUPPLEMENTAL_KEYS.map((id) => supplementalFinding(id, "unavailable", FAILED));
  }
  return SUPPLEMENTAL_KEYS.map((id) => runCheck(id, () => CHECKS[id](cv)));
}

export interface SupplementalRow {
  key: SupplementalKey;
  label: string;
  status: FindingStatus;
  statusLabel: string;
  explanation: string;
  action: string | null;
  quotes: string[];
  /** False when this report was saved without the check. */
  recorded: boolean;
}

/**
 * What the report shows for each supplemental check. A report saved before a check existed has no finding for it,
 * and that reads as not assessed: never as passed, and without working the answer out afresh from the saved text,
 * because a report shows what was recorded when it was made.
 */
export function supplementalRows(assessment: Pick<Assessment, "findings">): SupplementalRow[] {
  return SUPPLEMENTAL_KEYS.map((key) => {
    const f = assessment.findings.find((x) => x.id === key);
    const status: FindingStatus = f?.status ?? "not_applicable";
    return {
      key,
      label: SUPPLEMENTAL_CHECK_LABELS[key],
      status,
      statusLabel: SUPPLEMENTAL_STATUS_DISPLAY[status],
      explanation: f?.explanation ?? SUPPLEMENTAL_NOT_RECORDED,
      action: f?.action ?? null,
      quotes: f?.evidence.map((e) => e.quote) ?? [],
      recorded: !!f,
    };
  });
}
