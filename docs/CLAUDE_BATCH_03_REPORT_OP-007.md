# Offerpath batch 03 report: OP-007 proofreading behind an adapter

Prepared 7 November 2026 by Claude, for independent acceptance review by Codex. Nothing was committed, pushed, deployed or migrated, no live database was touched, and no student or fixture text was sent to any outside service.

## Task status

| Task | Status | Notes |
|---|---|---|
| OP-007 — evaluate and integrate proofreading behind an adapter | **Implemented → Locally verified** | The human gate stays open: no provider or data-handling approval has been given, and **no evaluation label has been reviewed by a human**. |

## What this task does and does not claim

**Does:** new CV reports carry a separate proofreading result from a local Hunspell-format dictionary check, run on our server. It separates likely misspellings, words it doesn't recognise, regional preferences, three mechanical punctuation patterns and (as not assessed) grammar. Each finding quotes the text at a validated position and suggests a replacement. Nothing is changed in the CV. The spelling page and the overview show it.

**Does not:**

- Check grammar. The local engine doesn't read sentences. Grammar is reported as "not assessed" and its findings list is always empty.
- Detect a real word used wrongly ("manger" for "manager"). On the held-out set it caught 0 of 14.
- Change any score, fingerprint, cache key or `RUBRIC_VERSION`.
- Proofread cover letters, job adverts or LinkedIn text.
- Offer a per-student language choice or dismissal. Language is one setting per deployment; both of those are OP-008.
- Show that the figures below hold on real student CVs. Both evaluation sets are AI-written and synthetic.

## Approach comparison

Sources for the LanguageTool columns are public documentation only, read on 6 November 2026: [public API](https://dev.languagetool.org/public-http-api), [self-hosted server](https://dev.languagetool.org/http-server), [n-gram data](https://dev.languagetool.org/finding-errors-using-n-gram-data), [API reference](https://languagetool.org/http-api/swagger-ui/#!/default/post_check), [paid API](https://languagetool.org/proofreading-api), [privacy policy](https://languagetool.org/legal/privacy), [repository](https://github.com/languagetool-org/languagetool). LanguageTool was never called, so its accuracy and latency are **not measured**.

| | A. Local dictionary (**selected, active**) | B. LanguageTool, self-hosted (adapter built, inactive) | C. LanguageTool paid API (adapter built, inactive) | D. LanguageTool free public API (rejected) |
|---|---|---|---|---|
| **Accuracy** | Measured below: spelling and regional only. No grammar, no real-word errors. | Not measured. Has grammar rules; "AI-based rules are only available in the cloud". Confused-word detection needs the n-gram data. | Not measured. Documented as the same technology as Premium. | Not measured. |
| **Latency** | Measured: about 100 ms once per process, then p50 157 ms, p95 385 ms, max 550 ms per CV on a busy laptop. | Not measured. A network hop plus a Java service. | Not measured. A network hop to a third party. | Not measured. No performance guarantee. |
| **Cost** | Free. About 1.3 MB of packages and 64 MB of memory per process. | No licence fee, but needs a server we'd run ourselves, because a Java service can't run on our Vercel setup. Not costed. The n-gram data is about 8 GB and needs an SSD. | Paid by daily call volume. **The price isn't in the page text I could read, so it needs a quote.** | Free, but see below. |
| **Licensing** | `nspell` MIT. Dictionaries declared "MIT AND BSD"; their licence file also carries SCOWL, Ispell, WordNet, ENABLE and UKACD notices. See the founder decisions. | Core is LGPL 2.1 or later. Called over HTTP, not linked. | Commercial terms, not reviewed. | Must show a visible link back to languagetool.org. |
| **Processing terms** | No text leaves our server. No new sub-processor. | Text stays on infrastructure we control. | Text goes to a third party. The API page says servers are in Germany and texts aren't stored. The privacy policy names Learneo, Inc. (US) as controller and describes international transfers; a separate DPA covers Team plans. **These need reconciling by a person before any decision.** | Its rules say "Do not send automated requests", so a product can't use it. |
| **Limits** | Capped at 150 different suggestions per CV. | Set by our own server. | 60,000 characters per request, on the documented Premium tier. | 20 KB per request, 20 requests a minute, 30 words with suggestions. |

A constrained language model (the blueprint's other option) was not evaluated: it isn't free, and the brief ruled out sending text in this task.

**Why A:** it's the only option that meets "free, local, no student text leaves the server", and it fully covers the failure the audit reproduced. Its gap is grammar, which the report states rather than hides.

## Founder decisions needed

1. **Grammar coverage: stay local, self-host or buy?** My recommendation is to stay local for the first pilot, with grammar shown as not assessed. If advisers say grammar matters, trial self-hosting (B) before the paid API (C), because no text reaches a third party. Choosing C needs a price quote, a DPA, resolving the terms question above, and updates to the sub-processor list, DPA schedule, DPIA and privacy page. Nothing activates until `PROOFREADING_EXTERNAL_TEXT_APPROVED=true` is set along with a URL.
2. **Independent review of the evaluation labels.** Someone other than an AI needs to review `tests/fixtures/proofreading/heldout-2.json`, ideally with a sample of consented real CVs. This is the register's human gate.
3. **Dictionary licence notices.** The UKACD section of the dictionaries' licence file says that if the list is used in a software package, its copyright notice "must be prominently displayed" and its text included verbatim. We don't distribute the data to students, only run it on our server, but whether and where to show that notice is a question for whoever signs off legal. I haven't added an attribution page.
4. **Terminology list.** `terminology.ts` was written by me and has no adviser review. It's global, so it needs an owner.

## Evaluation

**Be clear about what these are: every label was written by an AI agent and none has been independently reviewed. The human gate stays open.**

Two agents wrote the sets, each told not to read the engine, its word lists or the repository, with hashes recorded before use. Each set has 24 synthetic CVs, 4 of them with no marked errors.

| Set | SHA-256 | Role |
|---|---|---|
| `heldout.json` (3,899 words, 144 labels) | `f747afcda50e93df0b5509fbdf43f8b5e9b116ff45118b9025920aaae92df3de` | **Became a development set.** The first run exposed poor precision, so I read its errors and changed the engine. Its later figures aren't held-out. |
| `heldout-2.json` (3,949 words, 154 labels) | `c1143d0905d1d65bac35c1ce070fd694b0f74f594747726cde8141ee75947ab0` | **The held-out result.** I didn't read it. Engine frozen first (`engine-frozen-heldout2.txt`), run once, and the engine is unchanged since. |

**Held-out results (`heldout-2.json`, the frozen engine's only run):**

| Measure | Precision | Recall | Notes |
|---|---|---|---|
| Likely misspellings vs non-word errors | **89.7%** (78/87; Wilson 95% 81.5–94.5%) | **89.7%** (78/87; 81.5–94.5%) | 9 false alarms over 24 CVs |
| The same flags vs non-word and real-word errors | 89.7% (78/87) | **77.2%** (78/101) | All 14 real-word errors missed |
| Regional preference | 100% (26/26) | 96.3% (26/27) | Missed "meters" (also a valid UK word for a device) |
| Regional words reported as misspellings | | **0 of 27** | The rule that must hold |
| Punctuation, three patterns | 100% (8/8) | 66.7% (8/12) | The misses are missing full stops, which it doesn't look for |
| Grammar | | Not assessed | 14 labelled, none assessable |
| Correct replacement offered | | top 1: 70/78, top 3: 76/78 | Of true positives |

Of the 87 non-word errors, 78 are in the likely list, 5 appear only under "we don't recognise", and 4 aren't surfaced at all, so 83 of 87 are surfaced somewhere.

**The cost of that precision:** 57 words were listed under "we don't recognise" (collapsed by default, not called mistakes), and 52 of those are correct terms such as drug names and legal Latin. That's about 2 per CV. A student in medicine or law will see more.

False alarms on held-out: comparables, novation, vires, obiter, rebar, ascitic, brise, Rebooked, minimis. Full lists are in `eval-heldout2.json`. No word from either set was added to the terminology list.

**What the first run showed (`heldout.json`, before any change):** precision **56.0%** (75/134), recall 91.5% (75/82). Too many false alarms to accept. I analysed it and made these changes, which is why that set stopped being held-out:

- Added the two-tier rule: a word one edit from a dictionary word (5+ letters) is a likely misspelling; other unknown words are "we don't recognise". 74 of 75 true positives there were one edit away, against 14 of 59 false positives.
- Long capitalised words one edit from a common word are now questioned, except on the name line.
- Fixed two bugs: a punctuation match running across a masked URL (the span validator caught it and marked the CV partial, as designed) and all-caps parts of hyphenated words.

After those changes that set scores 86.2% / 91.5%, which isn't an independent figure.

**Why these figures may flatter the engine:** the typos are AI-imagined, not real student errors; both sets come from similar authors and briefs; real PDF extraction noise is absent; and error density is far higher than a real CV, which raises precision by itself. On a CV with few mistakes, the same false alarms make up a larger share of what's flagged.

## Changed files

**New**
- `src/lib/analysis/proofreading/provider.ts`: provider interface and strict output schema
- `src/lib/analysis/proofreading/local.ts`: default local engine
- `src/lib/analysis/proofreading/languagetool.ts`: inactive adapter, tested against a fake only
- `src/lib/analysis/proofreading/settings.ts`: language, timeout, provider selection and approval gate
- `src/lib/analysis/proofreading/run.ts`: runs a provider and applies the failure rules
- `src/lib/analysis/proofreading/terminology.ts`, `view.ts`, `nspell.d.ts`
- `src/app/reviews/[id]/checks/[check]/ProofreadingPanel.tsx`
- `scripts/eval-proofreading.ts`, `tests/proofreading.test.ts`, `tests/fixtures/proofreading/heldout.json`, `heldout-2.json`

**Edited**
- `src/lib/types.ts`: new types; `CvReviewPayload.proofreading?`
- `src/lib/report-schema.ts`: optional schema, write-time checks; `checkEvidence` now accepts anything with `id` and `evidence`
- `src/lib/cv-flow.ts`: two lines, one import and the call beside the score
- `src/app/reviews/[id]/checks/[check]/page.tsx`: the panel, and "Looking good" becomes "No listed variants" on this check, since it could otherwise sit above real findings
- `src/app/reviews/[id]/page.tsx`: one link on the overview
- `src/app/help/page.tsx`: the answer that said there was no full spell check
- `scripts/diagnose-audit.ts`, `tests/audit.test.ts`: detection adapter, new gate, async
- `next.config.ts`, `package.json`, `package-lock.json`, `docs/DEPLOY.md`, `.env.example`

**Not edited by this task:** `rubric.ts`, `judgment.ts`, `fingerprint.ts`, `services.ts`, `cv.ts`, `lexicon.ts` (only read), `src/app/_landing/`, `docs/CLAUDE_BATCH_02_REPORT.md`. `cv.ts` needed no edit at all.

## Dependencies

| Package | Version | Licence | Unpacked | Role |
|---|---|---|---|---|
| `nspell` | 2.1.5 | MIT | 112 KB | Hunspell-format engine in JavaScript |
| `dictionary-en-gb` | 3.0.0 | MIT AND BSD (see decision 3) | 576 KB | Word list, en_GB-ise, SCOWL 2020.12.07 |
| `dictionary-en` | 4.0.0 | MIT AND BSD | 576 KB | US list, so valid US spelling is recognised |
| `is-buffer` (transitive) | 2.x | MIT | 20 KB | Dependency of `nspell` |

**Cold start**, 7 fresh Node 22 processes on this machine: 94–130 ms (median 102 ms) and 63–64 MB of added memory for both dictionaries.

**Maintenance caveat:** the brief asked for a maintained package. `nspell` was last published in June 2022 and `dictionary-en-gb` in November 2023, and the word data dates from 2020. They work and carry no network behaviour, but they're stable rather than actively developed. The adapter makes them replaceable.

**Next bundling:** all three are in `serverExternalPackages`, because the dictionaries read their files relative to themselves. Confirmed in `next dev` through the real server action. `next build` was **not** run, as instructed. As a partial substitute, Next's bundled file tracer (`next/dist/compiled/@vercel/nft`), run on an equivalent entry file, lists both `.aff` and `.dic` files and all `nspell` files with 0 warnings. **A production build and deploy remain unverified**, and if the files were missing the report would say "couldn't run", not pass.

## Behaviour

**Local engine.** It checks lower-case words and the first word of each bullet or sentence. It leaves alone URLs, emails, words touching digits or code punctuation, words with capitals inside them, words with accented letters, all-caps words up to 6 letters and capitalised words elsewhere (treated as names), unless those are 8+ letters and one edit from a common word. A capitalised word used elsewhere in the same CV is exempt when it opens a bullet. Skipped words are counted in `stats.wordsSkipped`.

**US English.** A word missing from the selected dictionary but present in the other is regional, with `info` severity and wording that says it's valid and a preference. Capitalised official names are left alone. -ize forms are accepted under en-GB. Setting `en-US` reverses the direction.

**Failure.** `runProofreading` never throws, and nothing it produces can read as a pass:

| Event | Result |
|---|---|
| Provider never answers | `unavailable`, all categories `not_assessed` |
| Provider throws, HTTP error, dictionary fails to load | `unavailable` |
| Malformed output (12 shapes tested) | `unavailable` |
| A finding whose quote isn't at its stated position | Dropped; run becomes `partial` and says how many |
| Time runs out between words | `partial`, with findings so far and "N of M words" |
| Over 150 different suggestions | `partial`, says the text may not have been read cleanly |
| Nothing checkable, or `PROOFREADING_PROVIDER=off` | `unavailable` |

Failure logs carry a reason code only, never text (tested). A failed check doesn't stop the report being saved and scored (tested in both repositories).

**Old reports.** A report without the field shows "Not assessed. This report was made before the dictionary check existed… That doesn't mean it passed." Tested for v0 and v1 payload shapes.

## The schema, and the PAYLOAD_VERSION decision

`CvReviewPayload.proofreading?: ProofreadingReport`, validated strictly. `ProofreadingFinding` extends the OP-004 `Finding`, with `status` fixed to `needs_attention`, plus `category`, `rule` and `suggestions`. Evidence uses block `doc`, which is the normalised text from `cvBlocks`. `toStored` refuses a report for a different document version, an unavailable run with findings, a mismatched category, a finding with no position, a span that doesn't resolve, a duplicate id, and any status claiming a pass (11 cases tested).

**`PAYLOAD_VERSION` stays 1.** The field is optional and additive, every existing v1 and v0 record reads unchanged, and absence has a defined meaning. OP-005's `document` set the precedent. **Rollback caveat:** the current schema is strict on read, so if the app is rolled back to a version without this field, reports saved with it would fail to read. Roll back only with that in mind.

`dictionary` in `Assessment.versions` still records `LEXICON_VERSION`, because that assessment still uses that list. The proofreading report records its own `engine`, `dictionary` and `terminology` versions.

## Validation: commands and actual results

Run on the shared working tree at about 00:15 on 7 November 2026, with other agents editing it concurrently.

| Command | Result |
|---|---|
| `npm run typecheck` | **Pass**, exit 0. Earlier runs showed errors only in other agents' in-progress files. |
| `npm run lint` | **Pass**: 0 errors, 1 pre-existing warning (`tests/e2e/smoke.mjs:38`). |
| `npm run test:engine` | **Pass: 383/383, 0 failed**, including 42 in `tests/proofreading.test.ts`. Other agents' tests are in this total. |
| `npm run test:db` | **Pass**, 95 checks, exit 0. No schema touched; run because the repository path is exercised. |
| `git diff --check` | Clean; new files checked separately for trailing whitespace. |
| `npm run --silent eval:proofreading` | Figures above. Stored in the scratchpad as `eval-heldout2.json`. |
| Numeric baseline (OP-004's script, unchanged) | **Before** (23:37, before my first edit) and **after** (final tree): both `7cfec3a0082afd06ac2cb9aee7f06ea52e9a232e2cae3744590087e520500865`. Byte-identical, and equal to batch 02's final dump. |

**Diagnostic gates:**

| Gate | Result | Whose work |
|---|---|---|
| `proofreading.detects-audit-misspellings` | **Met**: 4 of 4, read from spelling findings with source evidence | OP-007 |
| `proofreading.clean-source-not-flagged` (new) | **Met**: 0 findings, run complete | OP-007 |
| `proofreading.spelling-message-states-its-coverage` | Met | OP-002 |
| `proofreading.consistency-message-states-its-coverage` | Met | OP-002 |
| five `matching.*` gates | **Met on the final tree, not by this task** | See below |

**This differs from the brief, which expected the job-matching gates to stay unmet.** At 23:59 on this task's code, `diagnose:audit` showed 4 met and 5 matching unmet. On the final tree `--check` exits **0 with 9 met**, because another agent's concurrent work added `job-requirements.ts` and `job-match.ts` and changed `observeMatching` in `scripts/diagnose-audit.ts` at 00:07. I didn't make that change and haven't reviewed it. Please verify it as part of that task rather than this one.

The brief mentions two proofreading gates. The script had three, of which two were message-coverage gates already met and one was unmet. I read "two" as detection plus not flagging the clean source, and added the second as a measured gate, so there are now 9 gates instead of 8.

**Observations left unchanged:** spelling check 10/10 on the misspelled CV, clean and misspelled CVs both 83, `RUBRIC_VERSION` `rubric-2026-10-30.1`.

**Browser** (`next dev -p 3500`, demo mode: boot log `"mode":"demo"`, "ANTHROPIC_API_KEY is not set"; own process stopped by PID afterwards). `next build` not run. Screenshots are in `/private/tmp/claude-501/-Users-gbolahan-Documents-NEW-ME-LevelUp/70ce5228-d909-41a7-b749-2bc52131c2e0/scratchpad/batch-03/op-007/`.

- Misspelled fixture via the real paste flow: HTTP 200, all four words marked with replacements, grammar "NOT ASSESSED", score still 83, overview says "4 possible mistakes", 0 axe violations (`spell-panel-misspelled.png`, `spell-page-misspelled.png`, `overview-misspelled.png`).
- Clean fixture: no marks, and the headline says it doesn't prove spelling is correct (`spell-panel-clean.png`).
- All categories: regional, unrecognised and punctuation shown apart, 0 axe violations (`spell-panel-all-categories.png`). This is a page check, not a formal accessibility audit.
- 390 px: no horizontal overflow (`spell-page-390.png`).
- A seeded report saved without proofreading: "Not assessed… doesn't mean it passed" on the page and "Not assessed" on the overview (`spell-panel-old-report.png`).
- No console or page errors.
- **Not exercised in a browser:** the seeded v0 legacy report. My script reached only the latest seeded report. v0 is covered by a unit test, and the panel takes the same path.

To avoid corrupting the founder's dev cache, the server ran from a scratch copy of the tree with `node_modules` symlinked, because `:3000` and other agents' servers were using the shared `.next`. Copying was done at 00:09, so the page checks reflect the tree at that time. Editing `next.config.ts` also makes running dev servers restart themselves, and the `:3000` process did change PID during this task (other agents were also editing). The founder's server was not stopped by me.

**Protected files:** `src/app/_landing/demos/OfferpathHero.css` changed at 23:45 during this task. I didn't write to it; it wasn't in any of my edits. The other 17 landing files match my starting hashes. `docs/CLAUDE_BATCH_02_REPORT.md` is untouched by me.

## Limitations

- **Timeouts are cooperative for the local engine.** It checks the clock between words, but building a dictionary and a single `suggest` call are synchronous and can block the event loop until they finish; the 5 s budget can't interrupt them. Measured times are far below it. A worker thread would fix this if real text ever proves slow.
- **Capitalised misspellings are often missed.** "Excell", "Proffesional" and "Alterx" got through on the held-out set in such positions. All-caps words up to 6 letters ("SUMARY" on the first set) are taken as acronyms. This trades recall for not flagging names.
- **The variant check and the dictionary check disagree on -ize.** The scored list still shows "organize → organise"; the dictionary check accepts it. Changing the first would change a score.
- **Words valid in both variants aren't raised**, such as "program". "meters" was missed for that reason.
- **The spelling page's score copy remains:** the variant check's own text says other mistakes aren't detected. It's accurate about that score, and the panel explains the difference, but the two sit close together. Rewording saved engine text was out of scope.
- `normaliseText` now has a contract version owned by OP-010. Saved evidence offsets rely on the same normalisation, as do OP-004's. If it changes, saved spans would need that version path.
- Admin views and exports carry the new field inside the payload, which includes quoted words. No new storage or retention path exists; deleting a report deletes it.
- Cost at scale is not tested. Each server process holds about 64 MB.

## Migration impact

No database migration or RPC change. One new optional JSON field in `reports.payload`. Existing rows aren't rewritten. Three new runtime packages. No new environment variable is required.

## Checks Codex must rerun

1. `shasum -a 256 tests/fixtures/proofreading/*` against the hashes above, then `npm run --silent eval:proofreading -- --json`. Expect the figures above if `src/lib/analysis/proofreading/` is unchanged.
2. `NODE_OPTIONS=--conditions=react-server npx tsx --tsconfig tsconfig.json --test tests/proofreading.test.ts tests/audit.test.ts`.
3. Your own baseline capture with OP-004's script: expect `7cfec3a0…0865`, unless another task changed a number.
4. Confirm no path reaches `fetch` by default: `proofreadingProvider({})` returns the local provider, and the "no network call" test stubs `fetch`.
5. Check the attribution claim on gates: revert nothing, but read `observeMatching` in `scripts/diagnose-audit.ts` and the timestamp on `job-match.ts`.
6. Run a production build in an authorised session and confirm the dictionaries load. That is the largest unverified item here.
7. Have a person review `heldout-2.json`.

## Unresolved questions

1. The four founder decisions above.
2. Does a 90% likely-misspelling precision on AI-written data hold on real CVs? Unknown until the human gate is met.
3. Should unrecognised words be shown at all? About 2 correct words per CV appear in that collapsed list. Removing them would hide 5 of 87 real errors on the held-out set. Advisers should judge this.
4. For OP-008: finding ids (`spelling:likely-misspelling:<word>`) are stable within a report and designed to be the dismissal key; the student's language choice belongs there too.
5. For OP-010's coverage policy: this result is deliberately not part of the composite, so a CV with four typos still scores 83. Whether and how it should contribute needs calibration.
