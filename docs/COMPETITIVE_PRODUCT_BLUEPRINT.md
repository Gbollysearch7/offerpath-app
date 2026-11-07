# Offerpath: from credible prototype to dependable university product

Prepared 5 November 2026. Implementation brief for Claude; independent acceptance review by Codex.

## 1. The outcome we are building

Offerpath should help a student produce a stronger, truthful application and help a careers adviser understand where support will make a difference. That is the product standard. A beautiful dashboard, a large feature list, and a consistently reproduced score support that outcome, but none independently proves it. The ambition should be a dependable application improvement service with demonstrable educational value. “Perfect” therefore means clear acceptance standards, measurable quality, recoverable failures, and continuous improvement, rather than a promise that software can always judge a career correctly.

The present application is a substantial foundation. Its CV overview, detailed feedback, line editor, tailoring interface, cover letters, templates, opportunities, and institutional dashboard already form a coherent experience. The appropriate strategy is to strengthen those foundations and fill specific gaps. Rebuilding the interface or replacing the stack would consume effort without resolving the weaknesses discovered in the audit.

There are three distinct milestones. First, make the existing core honest and dependable. Second, complete the important workflows visible in the CareerSet references, particularly LinkedIn review and missing CV checks. Third, demonstrate institutional readiness through adviser validation, operational evidence, and a real pilot. A pilot can have a narrower scope than a complete competitor replacement, provided its limitations are explicit. Every release and sales demonstration should state which milestone has actually been achieved.

## 2. What the audit establishes

The evidence combines the original CareerSet screenshots, Offerpath screens captured from a locally running demo, source inspection, and targeted diagnostic checks. The references include December 2025 screens and March 2026 CV feedback updates in the earlier CareerForge reference directory. They establish visible workflows and wording, not CareerSet’s internal accuracy or present contractual capabilities. The live demo established how Offerpath currently presents those workflows; it did not independently validate production infrastructure or all external AI calls.

Two failures were directly reproduced. Replacing ordinary words with “custmer,” “relatonships,” “finanical,” and “recomendations” left spelling and grammar at ten out of ten. An advert requiring Kubernetes and Terraform, but describing Excel as desirable, missed both required technologies and marked repeated Excel as essential. A CV containing only Excel received a match score of seventy-seven. Those are product trust problems, not merely missing enhancements.

Existing automated tests passed after rerunning the monitoring test with permission to open its local webhook server. That confirms the existing expectations were satisfied; it does not invalidate these new findings. Several launch documents also conflict with newer implementation notes. Claude must distinguish verified current behaviour, historical documentation, and proposed work. Each completed task should point to reproducible evidence rather than a statement that the feature “looks finished.”

## 3. Product truth before additional polish

The first release should remove misleading certainty wherever the engine checks less than the interface implies. Until comprehensive proofreading exists, the application must not describe an absence of detected US spellings as proof of correct spelling. A limited rule check should identify its coverage. If a provider is unavailable, that condition must appear as unavailable or partially assessed, never as a green pass.

The same principle applies to ATS readability and readiness labels. The present readability heuristic uses extracted word counts, recognised sections, and unusual characters. It cannot guarantee that every employer’s recruitment system will interpret a document correctly. Report the observed facts: text extraction succeeded, headings were recognised, or reading order requires checking. Replace outcome-sounding labels such as “Interview-ready” with descriptions of assessed document quality until independent validation supports stronger language.

Audit operational claims as well. The careers dashboard says advisers can override scores, although the implemented adviser workflow supplies notes rather than a demonstrated score override. Fix that mismatch immediately. Review landing copy, tooltips, emails, examples, help pages, and exported reports against actual behaviour. Preserve useful reassurance, but remove absolutes such as never inventing facts when safeguards only reduce that risk. An honest application can still be confident: explain what was checked, what needs the student’s confirmation, and what practical action comes next.

## 4. A shared structure for evidence and findings

Different tools should reuse one reliable representation of assessment evidence. Extend the existing domain types instead of allowing spelling, tailoring, letters, and LinkedIn to invent incompatible report structures. A finding needs an identifier, check category, status, severity, explanation, suggested action, confidence, and references to the text that supports it. References should include a document version and stable block identifier; character offsets are useful within that exact version.

Support statuses such as passed, needs attention, not applicable, unavailable, and uncertain. A boolean cannot distinguish an assessed success from a skipped check. Store the assessment method and versions of the parser, rubric, model, and relevant dictionary. Validate incoming provider output against a schema before it reaches a saved report. Validate evidence ranges against the actual submitted text rather than trusting model-provided offsets.

Existing JSON reports must remain readable. Introduce a payload version and explicit adapters for historical records. Older reports should retain their historical scores and explain their limited evidence where necessary. Do not manufacture detailed evidence retrospectively. Server actions should continue to enforce ownership, and the demo and Supabase repositories should implement the same contracts. Update the API contract in the build plan before changing consumers. This foundation allows stronger analysis without repeatedly rewriting the report pages or losing existing student work.

## 5. Parsing must preserve meaning

Good advice begins with reliable extraction. The parser already handles several difficult PDF layouts, but extraction needs explicit confidence and traceability. Preserve page boundaries, headings, employment entries, dates, bullet boundaries, and the relationship between a bullet and its role. Record the actual PDF page count when available; a word-count estimate must not be displayed as a measured page count. For DOCX, distinguish structural information from layout information that requires rendering.

Build fixtures containing single-column documents, two-column documents, wrapped bullets, repeated headers, unusual fonts, letter-spaced headings, academic sections, mixed date formats, tables, and image-only scans. Synthetic examples should reproduce structural challenges without distributing personal data. Compare extraction with an expected document structure, not just whether some text was returned.

When confidence is low, show the extracted content and let the student correct it before scoring. Corrections create a new source version with provenance; they must not overwrite the original upload. If OCR becomes necessary, introduce it as a separately evaluated capability with processing limits and clear data handling. Until then, explain unsupported scans and offer a usable alternative. A failed extraction must never become a low-quality CV verdict. This distinction prevents students from being penalised for document encoding and gives support staff a concrete way to diagnose problems.

## 6. Comprehensive spelling and grammar

Separate spelling errors, grammar errors, punctuation consistency, and regional style preferences. US English is not inherently misspelled. If UK English is selected, a regional suggestion should normally be presented as a preference, with exceptions for quotations, official organisation names, and product names. Do not equate a different English variant with poor writing.

Evaluate a maintained proofreading engine through a server-side adapter. Compare detection accuracy, false positives, latency, licensing, operating cost, and data processing requirements before choosing it. A local dictionary can handle deterministic spelling candidates and approved terminology; a grammar service or constrained language model can supply contextual suggestions. No provider’s availability should determine whether a student receives an undeserved perfect score.

Findings must quote the affected text, explain the problem, and offer a replacement without silently changing facts. Maintain reviewed terminology for names, technical skills, qualifications, and employers. Allow a student to dismiss a suggestion for their document without changing the global dictionary for everybody. Do not automatically replace names or specialist terms.

The four reproduced misspellings become permanent regression cases. Also test valid terms such as stakeholder, onboarding, Kubernetes, and financial product names. Measure precision and recall on a held-out collection reviewed by humans, including regional differences and ambiguous phrasing. Acceptance requires both catching clear errors and avoiding excessive false alarms. Report proofreading coverage separately from the overall CV score until its contribution has been calibrated.

## 7. Complete the core CV checks

Add the checks visible in the reference that are missing or only indirectly represented: reverse chronological ordering, personal pronouns, and explicit consistency assessment. Their purpose is to explain meaningful writing decisions, not to reproduce every competitor rule unquestioningly. A personal pronoun in a quotation or an appropriate personal statement should not automatically lower the whole document’s quality.

Date ordering must work within each relevant section and employment grouping. Parse month-year and year-only ranges, recognise “Present,” and preserve uncertainty when information is incomplete. Overlapping jobs can be legitimate. A student studying while working should not be accused of an error because two ranges overlap. Explain the specific ordering issue and show the relevant entries; do not reorder the document automatically.

Consistency assessment should cover punctuation, date presentation, bullet patterns, and heading conventions where those facts can be observed. Font and alignment claims require reliable document geometry or rendering evidence. When only plain text is available, the system must say which visual properties it could not assess.

Expand accomplishment analysis beyond the presence of numbers. Money, time, scale, quality, learning, service, research, and qualitative outcomes can all demonstrate contribution. Distinguish responsibility, action, context, and result. Recognise assisting and collaborating as legitimate roles. Do not pressure students to turn every task into an invented percentage or inflate supporting work into sole leadership.

## 8. A scoring system that deserves trust

Preserve the established product requirement: the same CV under the same scoring version receives the same core score regardless of student, institution, history, or target sector. Job relevance remains a separate assessment. Institutional preferences may influence guidance or a clearly labelled supplemental assessment, but must not silently alter the common CV score. This protects comparability and prevents the confusing score changes already encountered during development.

Determinism requires more than caching. Freeze input normalisation, parser behaviour, model configuration, rubric, and scoring rules together through version identifiers. Handle concurrent first evaluations so one canonical result is published. Provider retries and failures must not mix incompatible judgments inside a report. If a cached judgment is wrong, correct it through a controlled version change and preserve the historical record rather than promising that erroneous decisions remain permanent forever.

Define how unavailable and inapplicable checks affect totals. Never award full marks to an unperformed check. When missing assessment coverage materially affects interpretation, withhold the composite score or clearly mark it incomplete. Avoid rescaling a tiny set of completed checks into an apparently comprehensive result.

Scores should explain contributions and limitations. Improvement estimates must be labelled estimates and must not guarantee an interview. Historical comparisons should include only compatible scoring versions and document contexts. A score is a summary of assessed writing quality; the product must also show the evidence and useful next steps beneath it.

## 9. Validation against independent advisers

The existing calibration script is a starting point, not completed validation. Assemble an initial collection of at least thirty consented, anonymised applications spanning disciplines, career stages, document styles, and writing strengths. That number supports a first investigation, not proof of universal accuracy. Recruit multiple qualified advisers to assess documents independently before seeing the application’s scores. Record disagreements rather than pretending one adviser supplies unquestionable truth.

Separate development examples from a held-out evaluation set before tuning. Keep variants of the same CV together to prevent leakage. Compare score error, ranking agreement, severity judgments, false positives, and whether recommended changes actually improve adviser ratings. Report uncertainty and sample sizes. Do not optimise weights simply because an area correlates with total adviser scores on the same small dataset.

Evaluate rewrites separately. Review factual fidelity, preservation of seniority, clarity, usefulness, and unnecessary changes. Include strong original sentences that should remain unchanged. Add adversarial examples containing keyword stuffing, fabricated metrics, repeated text, and instructions attempting to control the evaluator. A system that rewards gaming needs correction even if its average correlation looks acceptable.

Claude can build the evaluation tools, anonymisation workflow, and reporting templates. Human reviewers must supply the independent judgments. Initial acceptance targets should be proposed and agreed with the pilot partner before examining held-out results. Record which release passed, on which dataset, and with which limitations. Never relabel illustrative demo marks as expert validation.

## 10. Understand job requirements in context

Replace the fixed dictionary as the sole source of job requirements. Extract structured requirements from the actual advert, including skills, tools, qualifications, experience, responsibilities, location constraints, and explicitly stated eligibility conditions. Each item should retain a supporting quotation and a category such as essential, desirable, contextual, or uncertain. Frequency may help identify prominence, but it cannot establish that a requirement is mandatory.

Use deterministic parsing for obvious expressions and a constrained semantic extraction adapter for more complex adverts. Validate model output against the original advert. Unknown technologies should still be captured when the advert clearly names them. The dictionary becomes a source of aliases and normalisation rather than a gate that excludes unfamiliar terms. Negation and alternatives matter: “Terraform or Pulumi” differs from requiring both, and “no prior experience necessary” must not become an experience barrier.

Represent relationships between requirements so alternatives are not counted twice. Match CV evidence to each requirement and distinguish explicit evidence, relevant transferable experience, a weak mention, and no evidence found. Absence from a CV is not proof that the student lacks a skill. Ask for clarification where appropriate.

The Kubernetes and Terraform example becomes a release gate. Both requirements must be identified as essential, Excel must remain desirable, and an Excel-only CV must visibly show the essential evidence gaps. This is a contextual understanding test, not a request to hardcode those three technology names.

## 11. Make matching scores interpretable

Replace the arbitrary thirty-point starting score with a documented coverage model. A match score should describe the evidence found for this advert, not the probability of being hired or passing an employer’s ATS. Show the denominator: how many requirements were assessed, how they were weighted, and what remains uncertain. If the advert is too vague to support a meaningful assessment, return a useful explanation rather than a manufactured percentage.

Weight explicit essential requirements more heavily than desirable ones, but do not let a single composite number hide an essential gap. Show that gap separately even when other coverage is strong. Group synonyms, duplicates, and alternative requirements before scoring. Repeating a keyword twenty times should not create twenty times the evidence. Contextual demonstration should be distinguished from a bare skills list without making unsupported claims about employer decisions.

Before-and-after results must be calculated from the actual revised document. Selecting an “Add” control must not imply that a skill has been substantiated. If the interface previews a possible improvement, identify it as hypothetical and explain the evidence needed. Preserve the original assessment and the revised assessment as separate versions.

Allow students to identify irrelevant requirements, but store that action as their interpretation. Do not silently rewrite the advert or erase an essential qualification. Evaluation should include unfamiliar sectors, alternative qualifications, negated requirements, multilingual names, and roles where transferable experience is more meaningful than exact keyword overlap.

## 12. Rewriting without inventing a career

Treat a rewrite as a proposed edit with evidence, not an authoritative replacement. Build a claim inventory from the source CV and student-confirmed additions: employers, roles, dates, tools, qualifications, outcomes, and level of responsibility. Each proposed sentence should identify the source claims it uses. Prompt instructions are necessary, but the application should also validate outputs for unsupported entities, quantities, and changes in responsibility.

Checking whether a number exists anywhere in the CV is insufficient. A figure from one role must not be attached to another role. Preserve the relationship between a claim and its source entry. “Supported” must not become “led” without confirmation. Where evidence is missing, ask a focused question or leave a clearly marked placeholder. Unresolved placeholders should trigger a review step before download, with the student able to revise or explicitly retain them.

Offer accept, edit, reject, and undo. Show an understandable difference between the original and proposed sentence, and explain the improvement. Do not force a rewrite when the original is already effective. After acceptance, mark the document as changed; any displayed current assessment must correspond to that version or clearly remain the previous assessment.

Maintain a revision history shared by CV tailoring, cover letters, and LinkedIn. The same student evidence should be reusable with explicit control. Test factual preservation under retries, provider failures, malicious document instructions, and conflicting source claims. A successful generation is not complete until the output passes validation and the student understands what changed.

## 13. Cover letters need deeper coaching

The current letter review checks useful basics, but six mostly rule-driven checks cannot evaluate a persuasive application fully. Expand the assessment into structure, motivation, evidence, employer relevance, role relevance, clarity, and mechanics. Every criticism should refer to a passage or explain which necessary information is absent. Separate hard skills from interpersonal skills, and show whether each is demonstrated through an example rather than merely mentioned.

Assess employer motivation contextually. Mentioning a company name near “because” is not sufficient proof of a specific reason. Conversely, a concise, credible explanation should not fail because it lacks an expected phrase. Do not fabricate company research when the student supplies only an employer name. Use the submitted advert and student-provided context, or explicitly request a source before adding employer facts.

Replace rigid universal length assumptions with reviewed guidance appropriate to the application context. A form with a word limit and an uploaded letter require different constraints. Greeting and sign-off guidance should be reviewed by a careers adviser and phrased as guidance where conventions vary. Distinguish problems that affect meaning from optional stylistic improvements.

Connect each suggested change to a paragraph, permit selective acceptance, and retain the student’s voice. Recompute the assessment when a saved version changes. Verify that Word and PDF exports contain the approved text, correct name, complete contact details, and no accidental placeholders. Include strong letters, short application statements, career changers, and students with limited experience in evaluation.

## 14. LinkedIn review as a complete workflow

LinkedIn optimisation is the clearest missing screenshot-level module. Build a first version around pasted sections and user-provided exports, avoiding dependence on brittle profile scraping. Explain exactly which inputs are supported. A pasted URL alone should not imply that the application has accessed the profile. Users should be able to review a headline, About section, employment entries, education, and selected profile details without supplying their account credentials.

Provide an overall summary, section-level findings, and targeted suggestions. Evaluate relevance, clarity, credible achievements, and consistency with the student’s CV. A headline should communicate direction and useful skills without inventing a role. An About section should sound like the person, rather than a collection of fashionable claims. Experience suggestions must use the same factual safeguards as CV rewriting.

Allow section-by-section editing, comparison, acceptance, undo, and reassessment. Saving within Offerpath must not suggest that LinkedIn itself has been updated. Provide copy controls and clear next steps for applying approved changes manually. Do not score photographs, appearance, or personal identity traits. Profile advice should be relevant to professional communication and user-provided career aims.

Introduce the report type through a new database migration, extend both repositories, and update dashboard filters, exports, retention, and account deletion. Historical CV and letter reports must continue to work. Include access-control tests and realistic partial profiles. Completion means the entire workflow works, including empty sections and errors, rather than merely adding a new navigation tab.

## 15. Improve the student’s working journey

Students should understand the next useful action without navigating a maze of separate scores. The dashboard should distinguish uploaded source documents, reviewed versions, tailored applications, letters, and completed edits. Connect related artefacts to an application while preserving their independent history. A student returning after a week should know which document belongs to which role and whether their downloaded file includes the latest accepted changes.

Prioritise recommendations by practical importance, confidence, and effort. Do not encourage students to chase tiny numerical improvements indefinitely. Show a short actionable list, explain why each item matters, and allow dismissal with a reason. Useful progress includes correcting an error, supplying evidence, or completing an application, not merely uploading the same CV repeatedly.

Add shareable evidence links with explicit scope, expiration, revocation, and an access log appropriate to their purpose. A bearer link must be treated as disclosure to anyone who receives it; private adviser access remains a separate mechanism. Default to minimal information and make the shared preview visible before activation. Never place sensitive document text inside URLs or analytics events.

Test interruption and recovery: refreshing during analysis, retrying a failed download, returning after session expiry, and opening two editing tabs. Duplicate requests should not create accidental reports or charges. Saved changes should be recoverable, and conflicts should be explained rather than silently resolved by discarding someone’s work.

## 16. Interview practice and career exploration

The current practice material offers a starting point, but static sector questions and a simple STAR heuristic should not be presented as a fully personalised interview coach. Build personalisation around a particular application: the approved CV version, the actual job requirements, and the student’s chosen practice objective. Ask questions grounded in those sources and show why each question is relevant. General practice must remain available when no application exists.

Separate answer structure from substance. A response can contain situation, task, action, and result language while providing little evidence. Feedback should identify the student’s contribution, unanswered parts of the question, unsupported claims, and opportunities to be clearer. Do not score accents, facial appearance, personality, or presumed employability from voice or video. Text practice is a sensible first implementation; recording introduces additional consent, accessibility, storage, and deletion work.

Career exploration should explain why a role might fit demonstrated interests and experience, distinguish requirements from suggestions, and identify practical learning steps. Keep opportunity freshness, source links, and eligibility context visible. Avoid implying that a generated roadmap guarantees a job. These modules should follow dependable CV and tailoring workflows: breadth becomes useful when the shared evidence underneath it is trustworthy.

## 17. Institutional value and adviser workflows

A university buys a service that students use and advisers can trust. Build institution configuration around branding, resources, programme groups, access policies, and service contacts. Preserve the common core score. Adviser notes, student-approved sharing, and referrals should form an understandable workflow with clear ownership and notifications. If an adviser disagrees with feedback, record that disagreement and its rationale; do not silently overwrite historical automated judgments.

Test permissions at the database, repository, and action boundaries. A student from one institution must never retrieve another institution’s document by changing an identifier. Advisers should see only the population and information their role authorises. Revocation must affect subsequent access, and exported files need the same controls as on-screen records. A hidden button is not an access-control mechanism.

Analytics should distinguish invitations, activation, completed reviews, useful edits, repeat use, and adviser referrals. Show definitions, date ranges, exclusions, and denominators. Suppress or aggregate small groups where identification is possible. An improved score is not evidence of employment, and consenting users may not represent the whole student population. Provide useful aggregate service information without making universal student surveillance the default. Validate dashboard totals against known synthetic events before using them in a purchasing discussion.

## 18. Reliability, security, and operating cost

Treat analysis as a recoverable operation with explicit states: queued, processing, completed, partially completed, and failed. Set timeouts, bound retries, and prevent duplicate work through idempotency keys. A failed provider response must not replace a valid saved report. Record technical diagnostics without logging raw CVs, private letters, access tokens, or complete prompts containing personal information.

Apply file size and processing limits, validate supported formats, and reject malformed uploads safely. Treat document text and job adverts as untrusted input, including instructions embedded inside them. Analysis providers must not receive authority to operate accounts or disclose unrelated records. Validate structured output and enforce ownership again when saving results. New features must extend existing deletion and retention behaviour, including generated artefacts and temporary processing data.

Measure cost per completed workflow, including retries, extraction, model calls, storage, exports, and support. Control concurrency and consumption without revealing provider internals to students. Provide a useful explanation when a limit is reached and allow safe recovery. Track latency distributions and failure rates rather than relying on a single successful demo. Load testing should use fictional documents and an agreed workload, with simulated providers before paid traffic. Provider outages and exhausted budgets need rehearsed behaviour, not just an error caught in logs.

## 19. Accessibility and visual quality

Offerpath already has a strong visual foundation. Preserve its typography, spacing, and clear navigation while improving the connection between findings and source text. A student should be able to select a finding, locate its evidence, understand the advice, and make an edit without losing context. Use clear empty, loading, partial, and error states throughout the same components.

Audit keyboard navigation, focus visibility, headings, accessible names, contrast, zoom, and screen-reader announcements. Score colours need text equivalents. Editors and document previews should remain usable without dragging or hovering. At narrow widths, retain access to the source and feedback without forcing unreadably small text. Exported documents need their own checks for headings, reading order, selectable text, and page breaks.

Automated accessibility checks are useful regression protection, but they do not establish conformance by themselves. Include manual keyboard and assistive-technology testing with representative students. Record the tested scope and unresolved limitations. A short successful task completed by a student using assistive technology is more meaningful than a dashboard of automated passes. Avoid redesigning already effective components unless observed usability evidence identifies a problem.

## 20. Procurement and service readiness

Prepare a procurement evidence pack that reflects the deployed service. It should describe data flows, processors, retention, deletion, hosting choices, access controls, accessibility findings, incident handling, service support, and recovery arrangements. Drafts are preparation; approved policies, operational configuration, and test records are evidence. Appropriate legal and security owners must review contractual commitments before they become promises to a university.

Verify production email delivery, institution onboarding, account recovery, domain configuration, monitoring, and backups. Demonstrate a restore in an isolated environment and record what was recovered and how long it took. Check that development login routes and demo identities cannot bypass production authentication. Give support requests an owner, response expectations, and an escalation route. A two-year service must survive maintenance and staff absence, not simply its first demonstration.

Reconcile the existing launch documents into one current status register. Every entry needs an owner, evidence, last verification date, and either completion or a clear outstanding action. Code can supply exports, checks, and operational tooling; it cannot establish that insurance exists, a contract was signed, or an external reviewer approved a policy. Claude must leave those gates visibly awaiting the responsible person instead of marking them complete because a document template was generated.

## 21. Prove value through a controlled pilot

Start with a defined student population, named careers-service sponsor, limited supported workflows, and agreed success criteria. Establish baseline tasks before exposure to the application. Measure whether students understand feedback, complete useful edits, retain factual accuracy, and need less repetitive adviser explanation. Record negative feedback and abandonment as carefully as successful sessions.

Propose targets before inspecting results. Useful measures include completion rate, time to first useful improvement, adviser-rated improvement, false-alarm rate, support demand, and cost per completed application workflow. Report the sample and uncertainty. Interviews or job offers can be collected with appropriate permission, but causal claims require a stronger study than comparing users who chose to engage with those who did not.

The reported £34,000 two-year contract is a commercial benchmark supplied by the founder, not independently verified pricing or proof that equivalent revenue is available. Build a business case using the actual institution’s needs, implementation costs, expected usage, support effort, and measured benefits. Competing successfully may mean better explanations, stronger factual safeguards, or more useful adviser workflows. It does not require reproducing every competitor feature before demonstrating a valuable, honest pilot.

## 22. Delivery sequence and independent review

Implement in bounded batches. Begin with truthful product language and executable diagnostics for the reproduced failures. Then establish versioned evidence contracts, extraction confidence, proofreading, and contextual requirement extraction. Follow with scoring validation and factual rewrite safeguards. Add missing workflows once the underlying evidence model is stable, and complete institutional and operational gates alongside a controlled pilot.

Each task must define its dependencies, code boundaries, acceptance criteria, and proof of completion. Claude should identify unresolved assumptions before changing contracts, preserve existing student data, and report exactly which checks ran. Codex then reviews the actual diff, reproduces relevant behaviour, examines failure paths, and either accepts the task or returns specific defects. A passing test written around the implementation is insufficient if the original user problem still occurs.

Distinguish implemented, locally verified, adviser validated, pilot validated, and production verified. Those statuses prevent a polished feature from being mistaken for a fully proven service. The final release decision should be traceable to evidence across student usefulness, factual fidelity, access control, accessibility, reliability, and support. This is how Offerpath moves from an attractive alternative towards a product a university can responsibly depend on.

## Evidence and limits

The implementation register is deliberately separate from this narrative. It turns the product reasoning into bounded engineering assignments, names the dependencies, and records acceptance evidence. Both documents should evolve together when implementation reveals new constraints or adviser testing changes an earlier assumption.

CareerSet’s current public [FAQ](https://careerset.com/faq) describes its broader tool suite and institutional support. The screenshot comparison uses the local reference collection at `/Users/gbolahan/Documents/New Apps - 2027/cv builder/careerforge_cc/reference-images`, including CV feedback, targeting, cover-letter, LinkedIn, and report-sharing screens. Screenshots establish visible functionality, not independently measured quality. Offerpath evidence comes from its local demo, source, and targeted diagnostics. Production operations and expert validation remain separate verification tasks. The companion task register identifies implementation boundaries and review gates.
