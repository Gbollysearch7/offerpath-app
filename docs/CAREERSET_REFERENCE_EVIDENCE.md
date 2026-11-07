# CareerSet comparison: evidence behind the implementation plan

Reviewed 5 November 2026. This file records the basis for the [5,000-word blueprint](COMPETITIVE_PRODUCT_BLUEPRINT.md) and [implementation register](CLAUDE_IMPLEMENTATION_TASKS.md). It does not certify competitor accuracy or production readiness.

## Assessment

Offerpath has a visually competitive foundation and substantial overlapping workflows. The screenshots and local demo do **not** establish complete functional or feedback-quality parity. In particular, an attractive score display cannot compensate for missing proofreading, incorrect requirement classification, or absent workflows. Institutional readiness requires evidence beyond screenshots.

The CareerSet images also contain advice that should be questioned rather than copied automatically. Its spelling screenshot flags valid terms including “stakeholder,” “workflows” and “onboarding” as possible errors. Its line-level assessment is not independent expert ground truth. Offerpath should match useful workflows while evaluating the quality of each rule itself.

## Screenshot inventory used in the comparison

Original directory: `/Users/gbolahan/Documents/New Apps - 2027/cv builder/careerforge_cc/reference-images`. Names below are relative to that directory. The originals remain outside the repository; do not copy personal material into test fixtures.

| Reference image | Visible evidence | Offerpath implication |
|---|---|---|
| `screencapture-careerset-results-php-2025-12-26-10_59_57.png` | CV overview, scores and detailed feedback navigation | Existing overview is a credible visual foundation; validate what scores mean. |
| `screencapture-careerset-results-php-2025-12-26-11_00_24.png` | Breakdown of feedback categories | Existing area/check structure can support additional checks. |
| `screencapture-careerset-results-php-2025-12-26-11_01_01.png` | Line-level assessment | Existing line editor overlaps; factual fidelity and usefulness need evaluation. |
| `reference images v2/screencapture-careerset-results-php-2026-03-13-01_15_39.png` | Quantifying feedback in the later reference set | Tie advice to evidence and avoid encouraging invented metrics. |
| `screencapture-careerset-results-php-2025-12-26-11_01_21.png` | Action-verb bank | Existing Offerpath verb bank overlaps; supporting roles must remain truthful. |
| `screencapture-careerset-results-php-2025-12-26-11_05_30.png` | Date-order feedback | Add explicit, section-aware chronology checks. |
| `screencapture-careerset-results-php-2025-12-26-11_05_40.png` | Dictionary-based possible spelling errors, with a note that spelling is excluded from the overall score | Current Offerpath UK/US variant check is narrower than general spelling detection. Competitor false positives illustrate the need for terminology handling. |
| `screencapture-careerset-target-results-php-2025-12-26-11_08_00.png` | Advert and keyword coverage feedback | Offerpath has targeting UI, but essential/desirable semantics need repair. |
| `screencapture-careerset-cover-letter-results-php-2025-12-26-11_20_39.png` | Letter checks alongside the source | Existing letter workflow overlaps; deepen evidence and motivation checks. |
| `screencapture-careerset-cover-letter-results-php-2025-12-26-11_21_03.png` | Hard-skill coverage and relevance controls | Add evidence-backed coverage and attributable student dismissal. |
| `screencapture-careerset-cover-letter-results-php-2025-12-26-11_21_16.png` | Soft-skill coverage | Distinguish demonstrated skills from keyword mentions. |
| `screencapture-careerset-cover-letter-results-php-2025-12-26-11_24_30.png` | Letter rewriting workflow | Preserve factual claims, selective acceptance, version history and export consistency. |
| `screencapture-careerset-linkedin-profile-results-php-2025-12-26-11_28_54.png` | Section-level LinkedIn profile assessment | LinkedIn is not yet an Offerpath report type; implement the complete workflow. |
| `screencapture-careerset-all-CV-reports-2025-12-26-10_55_44.png` | Report history, tool navigation and score sharing | Extend history and scoped sharing; a visible tab alone does not prove the linked feature's depth. |

## Offerpath observations

The initial audit captured the locally running demo's overview, breakdown, line editor, quantifying check, dashboard, targeting result, letter result, templates and admin page. Those temporary captures are under `/tmp/offerpath-audit/`; they may disappear with temporary-file cleanup. They showed a coherent green/black visual system, clear whitespace, useful side navigation and connected actions. These are visual observations, not results of a formal usability study.

The code audit and executable cases carry more weight for correctness:

- `cv.ts` checks a short US-spelling list, repeated words, lowercase starts and mixed full stops. General typo detection is absent from that path.
- `job.ts` limits extraction to known terms and sets essentiality using repetition. The explicit essential/desirable advert reproduced a meaningful failure.
- Readability derives from extracted text and recognised sections; it does not validate every ATS or rendered layout.
- Page count in the reviewed analysis is estimated from word count.
- Report types include CV review, tailoring and cover letters; LinkedIn is absent.
- Rewrite number-presence checks do not establish that a number belongs to the same role or claim.
- Existing calibration tooling is useful, but illustrative marks are not independent adviser validation.

## Current public comparator and commercial limit

CareerSet's [public FAQ](https://careerset.com/faq) describes a broader tool suite and institutional support. Use it as a source of advertised capabilities, not independently verified performance. Its public positioning can evolve beyond the dated screenshots.

The £34,000 two-year contract figure came from the founder. This audit has not verified the contract, its scope, usage allowance, support commitments or pricing applicability to other institutions. The roadmap therefore focuses on demonstrated product and service value rather than assuming that feature similarity establishes the same contract value.
