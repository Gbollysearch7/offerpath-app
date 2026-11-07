// The job-match numbers and wording that the report view shows. Type imports only, so client components can use it.
import type { EvidenceLevel } from "@/lib/types";

export const WEIGHTS = { essential: 3, desirable: 1, softFactor: 0.5 } as const;
export const CREDIT: Record<Exclude<EvidenceLevel, "not_assessed">, number> = { explicit: 1, contextual: 0.5, weak: 0.25, none: 0 };

export const COVERAGE_MEANING = "Evidence coverage describes what your CV shows for this advert's stated requirements. It is not a prediction of being hired or of passing an employer's screening.";

export const LEGACY_MATCH_NOTE =
  "Limited evidence: this report was made with an earlier version of job matching. It looked for a fixed list of keywords, treated a word repeated in the advert as a must-have, and gave every CV 30 points before looking at any evidence. We've kept its saved numbers so your history doesn't change, but they don't describe evidence for this advert. Add the job ad again for a report that shows each requirement and the evidence found for it.";
