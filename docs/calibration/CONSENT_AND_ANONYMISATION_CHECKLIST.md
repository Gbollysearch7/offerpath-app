# Consent and anonymisation checklist

For the data steward: one named person, normally at the partner institution. Complete a copy per dataset and keep it with the consent records, **not** with the dataset. This checklist is a working aid and not legal advice. The institution's data protection lead decides whether the process is lawful, and the DPIA (`docs/legal/DPIA_TEMPLATE.md`) should cover it.

Dataset name and version: ________ Steward: ________ Date: ________

## Before collecting anything

- [ ] The institution's data protection lead has approved this use, and the lawful basis is recorded.
- [ ] The research or ethics route the institution requires has been followed, or it has confirmed none is needed.
- [ ] Students get a plain-English notice covering: the purpose, who sees the document, how long it's kept, and that they can decline without any effect on their support.
- [ ] Consent covers advisers reading the anonymised document, and Offerpath's staff and tools processing it.
- [ ] If `--ai` will be used: consent and the DPIA cover sending text to the AI provider. If not, don't use `--ai` on this dataset.
- [ ] The withdrawal route and its cut-off date are written down and were told to students.
- [ ] Retention period and deletion date agreed: ________

## For every document

- [ ] A consent record exists, and its reference is in the intake sheet as `consent_ref`. The reference doesn't identify the student.
- [ ] Every CV from one person, and every version of one CV, has the same `group_label`. **This is what prevents leakage between development and held-out data.** If unsure, use the same label.
- [ ] `known_names` lists the student's names, including nicknames and any other name they use.

## After running `anonymise`

The tool replaces obvious identifiers and flags other lines. It misses things, and it can't judge context. Read every document in full, with `anonymisation-log.csv` beside you.

- [ ] Names: student, referees, supervisors, colleagues, and names inside project titles or links.
- [ ] Contact details: email, phone, address, postcode, personal websites, social media handles.
- [ ] Numbers: student, staff, national insurance, passport, and dates of birth.
- [ ] Sensitive details removed or generalised: health, disability, religion, ethnicity, politics, sexuality, union membership, immigration status, family details, photographs.
- [ ] Rare combinations: an unusual employer, prize, society role or small course could identify someone even with the name gone. Generalise these where you can do so without changing the sense.
- [ ] Each "score changed by" row in the log is understood. Anonymising shouldn't move the score. If it did, tell the founder, because the comparison would then be unfair to that document.
- [ ] If a PDF or Word copy is used in place of the text version: file properties (author, last modified by) are cleared, and redactions are real deletions, not black boxes over live text.
- [ ] `anonymisation_reviewed_by` in `manifest.json` carries the reviewer's initials for this document. Fill this in only after doing the above.

## Keeping it safe

- [ ] Raw CVs and the key file are stored apart from the dataset, with access limited to the steward.
- [ ] The dataset is under `calibration/`, which git ignores. The tool refuses real data anywhere it could be committed.
- [ ] Sheets and reports are shared only with people named in the notice. Reports contain document IDs, not names.
- [ ] No real CV has been pasted into a test fixture, an issue, a chat tool or an AI assistant outside the approved route.

## Withdrawal

- [ ] Use the key file to find the student's group. Delete the group's document files, remove its rows from each sheet, and add the group to `withdrawn_groups` in `manifest.json`.
- [ ] If held-out data has been opened already, the tool will refuse to re-open it, because the data changed. The first report stands, and its limitations should note the withdrawal.
- [ ] Record the date. Destroy the key entry when the retention period ends.

## Sign-off

Steward: ________ Date: ________ Data protection lead: ________ Date: ________
