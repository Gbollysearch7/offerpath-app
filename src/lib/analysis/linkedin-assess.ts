import type { Assessment, Finding, FindingSeverity, FindingStatus, ProofreadingReport } from "@/lib/types";
import { LINKEDIN_SECTION_LABEL, LINKEDIN_SECTIONS, type LinkedinPayload, type LinkedinSectionAssessment, type LinkedinSectionKey } from "@/lib/linkedin-types";
import { buildClaimInventory, figuresIn, namesIn, normaliseText, qualificationsIn, toolsIn, wordsIn } from "./claims";
import { documentVersion } from "./findings";
import { normaliseText as normaliseForEvidence } from "./fingerprint";
import { BUZZWORDS, DUTY_PHRASES, LEXICON_VERSION, NUMBER_RE, WEAK_VERBS } from "./lexicon";
import { currentVersion, isRoleLine, linesOf, sectionOf, stripBullet } from "./linkedin-check";

// OP-018: feedback on one section's exact text, as findings in the shared shape (OP-004). Rules only, so a report works
// with no AI key. Nothing here is a score or feeds one. There is deliberately no input for a photograph and no rule reads
// appearance, age, gender, nationality or any other personal trait: this is about what the words say to an employer.

export const LINKEDIN_CHECKS_VERSION = "linkedin-checks-2026-11-07.1";

export const LINKEDIN_LIMITS = [
  "These are rule-based checks of the words you gave us. They can't tell whether a statement is true or how an employer will read it.",
  "We haven't seen your LinkedIn profile: only what you pasted or exported. We don't look at photographs, appearance or personal traits.",
];

const STOP = new Set("a an and are as at be been but by for from has have in into is it its of on or our that the their them they this to was we were which while who will with within my i am me".split(" "));
const meaningful = (s: string) => wordsIn(s).map((w) => w.toLowerCase()).filter((w) => !STOP.has(w) && w.length > 2);

export interface AssessContext {
  aim: string | null;
  /** The chosen CV's text, or null when none was chosen or it's gone. */
  cvText: string | null;
  /** All sections' current text, for a check that looks across sections. */
  texts: Record<LinkedinSectionKey, string>;
}

interface Rule {
  id: string;
  status: FindingStatus;
  severity?: FindingSeverity;
  explanation: string;
  action?: string | null;
  quote?: string;
}

function finding(text: string, doc: string, r: Rule): Finding {
  const body = normaliseForEvidence(text);
  const at = r.quote ? body.indexOf(r.quote) : -1;
  return {
    id: r.id,
    check: r.id,
    status: r.status,
    severity: r.severity ?? (r.status === "needs_attention" ? "medium" : "info"),
    confidence: null,
    method: "rules",
    explanation: r.explanation,
    action: r.action ?? null,
    evidence: at >= 0 && r.quote ? [{ documentVersion: doc, block: "doc", range: { start: at, end: at + r.quote.length }, quote: r.quote }] : [],
  };
}

const EMPTY_ADVICE: Record<LinkedinSectionKey, { severity: FindingSeverity; explanation: string; action: string }> = {
  headline: {
    severity: "high",
    explanation: "We have no headline to read. It's the line people see beside your name, so it's worth a few minutes.",
    action: "Write one line saying what you study or do, the direction you're heading in, and one or two skills you can show. Saying you're seeking a kind of role is fine; don't give yourself a job title you haven't held.",
  },
  about: {
    severity: "medium",
    explanation: "We have no About section to read. It's the one place to explain your direction in your own words.",
    action: "Write three or four short sentences, as you'd say them to someone at a careers fair: what you're studying, one thing you've done and what came of it, and what you'd like to do next.",
  },
  experience: {
    severity: "medium",
    explanation: "We have no experience to read. That's common for students, and it doesn't have to mean paid graduate work.",
    action: "Add what you've really done, with dates: part-time jobs, society roles, volunteering, placements or projects. Give each one or two lines on what you did.",
  },
  education: {
    severity: "medium",
    explanation: "We have no education to read. Employers looking at students usually check this first.",
    action: "Add your university, your course and your expected finish date. Add a module or project if it's relevant to what you're aiming for.",
  },
  skills: {
    severity: "low",
    explanation: "We have no skills to read.",
    action: "List skills you can point to evidence for elsewhere on your profile: tools you've used on a project or in a job, rather than qualities anyone could claim.",
  },
  other: {
    severity: "info",
    explanation: "Nothing here, and that's fine: this part is optional.",
    action: "If you have them, add certifications, projects, volunteering, awards or languages. Leave out anything you wouldn't want to talk about in an interview.",
  },
};

const buzzIn = (text: string) => BUZZWORDS.filter((b) => new RegExp(`\\b${b.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i").test(text));
const aimWords = (aim: string | null) => meaningful(aim ?? "").filter((w) => !["role", "roles", "job", "jobs", "graduate", "scheme", "work"].includes(w));

const WEAK_OPENERS = new Set(Object.keys(WEAK_VERBS));
const opening = (line: string) => wordsIn(stripBullet(line))[0]?.toLowerCase() ?? "";

function headlineRules(text: string, ctx: AssessContext): Rule[] {
  const rules: Rule[] = [];
  const low = text.toLowerCase();
  const direction = aimWords(ctx.aim);
  if (!direction.length) rules.push({ id: "headline-direction", status: "uncertain", explanation: "You didn't tell us what you're aiming for, so we can't say whether this points the right way.", action: "Add a career aim to check this." });
  else if (direction.some((w) => low.includes(w))) rules.push({ id: "headline-direction", status: "passed", explanation: "It uses words from the direction you told us." });
  else rules.push({ id: "headline-direction", status: "needs_attention", explanation: `It doesn't mention the direction you told us: "${ctx.aim}".`, action: "If that's still your aim, say so, for example with \"seeking\" followed by the kind of role." });

  const known = [...toolsIn(ctx.texts.skills), ...toolsIn(ctx.cvText ?? "")];
  const skillWords = ctx.texts.skills.split(/[,\n;|•]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.length > 1);
  const hasSkill = toolsIn(text).length > 0 || skillWords.some((s) => low.includes(s)) || known.some((k) => low.includes(k.toLowerCase()));
  rules.push(hasSkill ? { id: "headline-skills", status: "passed", explanation: "It names a skill or tool." } : { id: "headline-skills", status: "needs_attention", severity: "low", explanation: "It doesn't name a skill or tool someone could search for.", action: "Add one or two you can point to evidence for elsewhere on your profile." });

  const len = text.length;
  if (len < 15) rules.push({ id: "headline-length", status: "needs_attention", explanation: "It's very short, so it says little beyond a label.", action: "Add your direction or a skill." });
  else if (len > 220) rules.push({ id: "headline-length", status: "needs_attention", explanation: `It's ${len} characters. LinkedIn limits headline length, and we believe the limit is about 220, so it may not fit.`, action: "Cut it to the two or three things that matter most." });
  else rules.push({ id: "headline-length", status: "passed", explanation: `${len} characters, a sensible length.` });

  const buzz = buzzIn(text);
  rules.push(buzz.length ? { id: "headline-claims", status: "needs_attention", severity: "low", explanation: `"${buzz[0]}" is a claim anyone could make, so it doesn't tell a reader much.`, action: "Replace it with something you've done or can do.", quote: exact(text, buzz[0]) } : { id: "headline-claims", status: "passed", explanation: "No stock claims from our list." });
  return rules;
}

/** The words as they're written in the text, so evidence quotes them exactly. */
function exact(text: string, phrase: string): string | undefined {
  const m = new RegExp(phrase.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "i").exec(normaliseForEvidence(text));
  return m?.[0];
}

function aboutRules(text: string, ctx: AssessContext): Rule[] {
  const rules: Rule[] = [];
  const words = wordsIn(text).length;
  if (words < 30) rules.push({ id: "about-length", status: "needs_attention", explanation: `It's ${words} words, which leaves little room for what you've done or want next.`, action: "Aim for three or four short sentences." });
  else if (words > 350) rules.push({ id: "about-length", status: "needs_attention", severity: "low", explanation: `It's ${words} words. Few readers go that far.`, action: "Keep what's specific to you and cut the rest." });
  else rules.push({ id: "about-length", status: "passed", explanation: `${words} words, a sensible length.` });

  const first = (text.match(/\b(I|I'm|I've|my|me)\b/g) ?? []).length;
  const third = (text.match(/\b(he|she|his|her)\b/gi) ?? []).length;
  if (!first && third >= 2) rules.push({ id: "about-voice", status: "needs_attention", severity: "low", explanation: "It reads as if someone else wrote about you, so it sounds less like you.", action: "Try writing it the way you'd say it, starting with \"I\"." });
  else if (!first) rules.push({ id: "about-voice", status: "uncertain", explanation: "It doesn't use \"I\" or \"my\". That can be fine, but it can also read as distant.", action: "Read it aloud. If it doesn't sound like you, reword it." });
  else rules.push({ id: "about-voice", status: "passed", explanation: "It's written in your own voice." });

  const buzz = buzzIn(text);
  rules.push(buzz.length >= 2 ? { id: "about-claims", status: "needs_attention", explanation: `It leans on stock claims such as "${buzz[0]}" and "${buzz[1]}". They could describe anyone.`, action: "Swap one for a sentence about something you did.", quote: exact(text, buzz[0]) } : buzz.length === 1 ? { id: "about-claims", status: "needs_attention", severity: "low", explanation: `"${buzz[0]}" could describe anyone.`, action: "Say what you did that shows it.", quote: exact(text, buzz[0]) } : { id: "about-claims", status: "passed", explanation: "No stock claims from our list." });

  const concrete = NUMBER_RE.test(text) || namesIn(text).some((n) => !n.initial) || toolsIn(text).length > 0;
  rules.push(concrete ? { id: "about-evidence", status: "passed", explanation: "It mentions something specific: a name, a figure or a tool." } : { id: "about-evidence", status: "needs_attention", explanation: "We found nothing specific: no named project, employer, tool or figure.", action: "Add one real example. If you have an accurate number, use it; don't estimate one to sound stronger." });

  const direction = aimWords(ctx.aim);
  if (!direction.length) rules.push({ id: "about-direction", status: "uncertain", explanation: "You didn't tell us what you're aiming for, so we can't say whether this speaks to it.", action: "Add a career aim to check this." });
  else if (direction.some((w) => text.toLowerCase().includes(w))) rules.push({ id: "about-direction", status: "passed", explanation: "It speaks to the direction you told us." });
  else rules.push({ id: "about-direction", status: "needs_attention", explanation: `It doesn't mention the direction you told us: "${ctx.aim}".`, action: "Add a sentence on what you'd like to do next and why." });
  return rules;
}

function experienceRules(text: string): Rule[] {
  const lines = linesOf(text);
  const roles = lines.filter(isRoleLine);
  const detail = lines.filter((l) => !isRoleLine(l));
  const rules: Rule[] = [];
  const dated = roles.filter((r) => /\b(?:19|20)\d{2}\b|\bpresent\b/i.test(r));
  if (!roles.length) rules.push({ id: "experience-roles", status: "uncertain", explanation: "We couldn't tell which lines are role titles, so we read this as one block.", action: "Put each role on its own line, with the organisation and dates." });
  else if (dated.length < roles.length) rules.push({ id: "experience-roles", status: "needs_attention", severity: "low", explanation: `${roles.length - dated.length} of ${roles.length} roles has no dates we could find.`, action: "Add start and end dates, so a reader can see the order of things.", quote: roles.find((r) => !dated.includes(r)) });
  else rules.push({ id: "experience-roles", status: "passed", explanation: `${roles.length === 1 ? "The role has" : `All ${roles.length} roles have`} dates.` });

  if (!detail.length) rules.push({ id: "experience-detail", status: "needs_attention", explanation: "Roles are listed with nothing about what you did.", action: "Add one or two lines under each: what you did, and what came of it if you know." });
  else rules.push({ id: "experience-detail", status: "passed", explanation: `${detail.length} ${detail.length === 1 ? "line" : "lines"} of detail.` });

  const weak = detail.filter((l) => WEAK_OPENERS.has(opening(l)) || DUTY_PHRASES.some((d) => stripBullet(l).toLowerCase().startsWith(d)));
  if (detail.length) rules.push(weak.length ? { id: "experience-verbs", status: "needs_attention", explanation: `${weak.length} ${weak.length === 1 ? "line opens" : "lines open"} with a duty or a weak verb rather than what you did.`, action: "Start with the action you took. Keep your real level of involvement: if you supported something, say so.", quote: weak[0] } : { id: "experience-verbs", status: "passed", explanation: "Lines open with what you did." });

  const numbered = detail.filter((l) => NUMBER_RE.test(l));
  if (detail.length) rules.push(numbered.length ? { id: "experience-results", status: "passed", explanation: `${numbered.length} ${numbered.length === 1 ? "line gives" : "lines give"} a figure or scale.` } : { id: "experience-results", status: "needs_attention", severity: "low", explanation: "No line gives a figure or scale.", action: "Add a real number where you know one. Where you don't, describe the result instead; don't guess." });
  return rules;
}

function educationRules(text: string): Rule[] {
  const named = /\b(university|college|school|institute|academy)\b/i.test(text);
  const course = qualificationsIn(text).length > 0 || /\b(bsc|ba|meng|msc|ma|mba|beng|llb|phd|degree|bachelor|master|a-levels?|btec|foundation|hnd)\b/i.test(text);
  const dated = figuresIn(text).some((f) => f.kind === "date") || /\b(?:19|20)\d{2}\b/.test(text);
  return [
    named ? { id: "education-institution", status: "passed", explanation: "It names where you studied." } : { id: "education-institution", status: "uncertain", explanation: "We couldn't find the name of a university or college.", action: "Check where you studied is named in full." },
    course ? { id: "education-course", status: "passed", explanation: "It names a qualification or course." } : { id: "education-course", status: "needs_attention", explanation: "We couldn't find your course or qualification.", action: "Add the course and type of degree." },
    dated ? { id: "education-dates", status: "passed", explanation: "It gives dates." } : { id: "education-dates", status: "needs_attention", severity: "low", explanation: "We couldn't find any dates.", action: "Add your dates, or your expected finish date." },
  ];
}

function skillsRules(text: string, ctx: AssessContext): Rule[] {
  const skills = text.split(/[,\n;|•]+/).map((s) => s.trim()).filter(Boolean);
  const rules: Rule[] = [];
  if (skills.length < 3) rules.push({ id: "skills-count", status: "needs_attention", severity: "low", explanation: `${skills.length === 1 ? "One skill" : `${skills.length} skills`} listed.`, action: "Add others you can show evidence for." });
  else if (skills.length > 50) rules.push({ id: "skills-count", status: "needs_attention", severity: "low", explanation: `${skills.length} skills listed, so the important ones can get lost.`, action: "Keep the ones you'd be happy to be asked about." });
  else rules.push({ id: "skills-count", status: "passed", explanation: `${skills.length} skills listed.` });
  const evidence = `${ctx.texts.experience}\n${ctx.texts.about}\n${ctx.texts.other}`.toLowerCase();
  const unshown = skills.filter((s) => !evidence.includes(s.toLowerCase()));
  if (!`${ctx.texts.experience}${ctx.texts.about}${ctx.texts.other}`.trim()) rules.push({ id: "skills-evidence", status: "uncertain", explanation: "There's nothing else here to compare your skills with.", action: "Add experience, and we can check your skills show up in it." });
  else if (unshown.length > skills.length / 2) rules.push({ id: "skills-evidence", status: "needs_attention", severity: "low", explanation: `${unshown.length} of ${skills.length} skills don't appear in your About, Experience or other details, for example "${unshown[0]}".`, action: "Where it's true, show the skill in a line about what you did. A listed skill says less than a shown one.", quote: unshown[0] });
  else rules.push({ id: "skills-evidence", status: "passed", explanation: "Most of your skills also appear in what you've done." });
  return rules;
}

function otherRules(text: string): Rule[] {
  return [{ id: "other-present", status: "passed", explanation: `${linesOf(text).length} ${linesOf(text).length === 1 ? "line" : "lines"} of other details. We read these for spelling and consistency, and don't judge which ones to include.` }];
}

/* ---------- Consistency with the CV ---------- */

const norm = (s: string) => normaliseText(s).toLowerCase();

/** Compared as guidance only: a profile and a CV can differ for good reasons. Never a mistake, never high severity. */
function consistencyRules(key: LinkedinSectionKey, text: string, cvText: string | null): Rule[] {
  if (cvText === null) return [];
  if (key === "about" || key === "other") return [];
  const low = norm(text);
  const cv = norm(cvText);
  const inv = buildClaimInventory(cvText);
  const rules: Rule[] = [];
  const guide = (id: string, explanation: string, action: string, quote?: string): Rule => ({ id, status: "uncertain", severity: "info", explanation: `Guidance: ${explanation}`, action, quote });

  if (key === "experience") {
    const cvRoles = inv.entries.filter((e) => e.isRole && (e.section === "experience" || e.section === "work"));
    const missing = cvRoles.filter((e) => {
      const names = namesIn(e.heading).filter((n) => !n.initial).map((n) => n.raw.toLowerCase());
      const first = e.heading.split(/,| at | - /)[0].trim().toLowerCase();
      return !low.includes(first) && !names.some((n) => low.includes(n));
    });
    if (missing.length) rules.push(guide("consistency-cv-roles", `${missing.length} ${missing.length === 1 ? "role" : "roles"} on your CV ${missing.length === 1 ? "isn't" : "aren't"} here, such as "${missing[0].heading}".`, "If you'd like the two to tell the same story, add it. Leaving a role out can be a reasonable choice."));
    const extras = linesOf(text).filter(isRoleLine).filter((l) => !namesIn(l).filter((n) => !n.initial).some((n) => cv.includes(n.raw.toLowerCase())) && !cv.includes(norm(l.split(/,| at /)[0])));
    if (extras.length) rules.push(guide("consistency-profile-roles", `"${extras[0]}" isn't on the CV you chose.`, "Check the two agree. If this role is newer than your CV, you may want to add it there too.", extras[0]));
    const years = (s: string) => new Set(s.match(/\b(?:19|20)\d{2}\b/g) ?? []);
    for (const line of linesOf(text).filter(isRoleLine)) {
      const org = line.split(/ at /i)[1]?.split(",")[0]?.trim();
      const entry = org ? inv.entries.find((e) => e.isRole && norm(e.heading).includes(norm(org))) : undefined;
      if (!entry) continue;
      const a = years(line);
      const b = years(entry.heading);
      if (a.size && b.size && ![...a].every((y) => b.has(y))) {
        rules.push(guide("consistency-cv-dates", `The dates for ${org} differ: "${line}" here, and "${entry.heading}" on your CV.`, "Check which is right. A reader comparing the two may notice.", line));
        break;
      }
    }
  }
  if (key === "education") {
    const quals = qualificationsIn(text).filter((q) => !cv.includes(q.toLowerCase()));
    if (quals.length) rules.push(guide("consistency-cv-qualification", `"${quals[0]}" isn't on the CV you chose.`, "Check the two agree."));
    const cvEdu = inv.entries.find((e) => e.section === "education");
    const cvOrgs = cvEdu ? namesIn(`${cvEdu.heading}\n${cvEdu.context}`).filter((n) => !n.initial && /university|college/i.test(n.raw)) : [];
    const miss = cvOrgs.filter((n) => !low.includes(n.raw.toLowerCase()));
    if (miss.length) rules.push(guide("consistency-cv-institution", `"${miss[0].raw}" is on your CV but not here.`, "Check the two agree."));
  }
  if (key === "skills") {
    const onCv = toolsIn(cvText).filter((t) => !low.includes(t.toLowerCase()));
    if (onCv.length) rules.push(guide("consistency-cv-skills", `Your CV names ${onCv.slice(0, 3).join(", ")}, which ${onCv.length === 1 ? "isn't" : "aren't"} in this list.`, "Add any you'd be happy to be asked about."));
  }
  if (key === "headline") {
    const figures = figuresIn(text).filter((f) => !cv.includes(f.raw.toLowerCase()));
    if (figures.length) rules.push(guide("consistency-cv-figures", `${figures[0].raw} isn't on the CV you chose.`, "Check the two agree."));
  }
  return rules;
}

/* ---------- One section ---------- */

export function assessSection(key: LinkedinSectionKey, text: string, ctx: AssessContext, proofreading: ProofreadingReport | null, at: string): LinkedinSectionAssessment {
  const doc = documentVersion(text);
  const empty = !text.trim();
  let rules: Rule[];
  if (empty) {
    const advice = EMPTY_ADVICE[key];
    rules = [{ id: `${key}-empty`, status: key === "other" ? "not_applicable" : "needs_attention", severity: advice.severity, explanation: advice.explanation, action: advice.action }];
  } else {
    const byKey: Record<LinkedinSectionKey, () => Rule[]> = {
      headline: () => headlineRules(text, ctx),
      about: () => aboutRules(text, ctx),
      experience: () => experienceRules(text),
      education: () => educationRules(text),
      skills: () => skillsRules(text, ctx),
      other: () => otherRules(text),
    };
    rules = [...byKey[key](), ...consistencyRules(key, text, ctx.cvText)];
  }
  const assessment: Assessment = {
    documentVersion: doc,
    versions: { parser: null, rubric: LINKEDIN_CHECKS_VERSION, model: null, dictionary: LEXICON_VERSION },
    origin: "engine",
    limits: [...LINKEDIN_LIMITS, ...(ctx.cvText === null ? ["No CV was compared with this section."] : [])],
    findings: rules.map((r) => finding(text, doc, r)),
  };
  return { at, assessment, proofreading };
}

/* ---------- Summary ---------- */

export interface LinkedinSummary {
  given: number;
  total: number;
  emptySections: LinkedinSectionKey[];
  toLookAt: number;
  guidance: number;
  notReassessed: LinkedinSectionKey[];
  /** The most useful place to start, or null if nothing is open. */
  first: { section: LinkedinSectionKey; text: string } | null;
  headline: string;
}

const ORDER: Record<FindingSeverity, number> = { high: 0, medium: 1, low: 2, info: 3 };

/** A plain count of what's open. Deliberately no score: nothing here could be compared with, or mistaken for, the CV score. */
export function summarise(p: Pick<LinkedinPayload, "sections">): LinkedinSummary {
  const emptySections: LinkedinSectionKey[] = [];
  const notReassessed: LinkedinSectionKey[] = [];
  const open: { section: LinkedinSectionKey; f: Finding }[] = [];
  let guidance = 0;
  for (const key of LINKEDIN_SECTIONS) {
    const s = sectionOf(p, key);
    const v = currentVersion(s);
    if (!v.text.trim()) emptySections.push(key);
    const a = s.assessments.find((x) => x.assessment.documentVersion === v.documentVersion);
    if (!a) {
      notReassessed.push(key);
      continue;
    }
    for (const f of a.assessment.findings) {
      if (f.status === "needs_attention") open.push({ section: key, f });
      else if (f.id.startsWith("consistency-")) guidance++;
    }
  }
  open.sort((x, y) => ORDER[x.f.severity] - ORDER[y.f.severity]);
  const given = LINKEDIN_SECTIONS.length - emptySections.length;
  const first = open[0] ? { section: open[0].section, text: open[0].f.action ?? open[0].f.explanation } : null;
  const headline = `You gave us ${given} of ${LINKEDIN_SECTIONS.length} sections. ${open.length ? `${open.length} ${open.length === 1 ? "point" : "points"} to look at, starting with ${LINKEDIN_SECTION_LABEL[open[0].section]}.` : "Our rules found nothing to raise, which doesn't mean nothing could be better."}`;
  return { given, total: LINKEDIN_SECTIONS.length, emptySections, toLookAt: open.length, guidance, notReassessed, first, headline };
}

export const contextFor = (p: Pick<LinkedinPayload, "sections" | "aim">, cvText: string | null): AssessContext => ({
  aim: p.aim,
  cvText,
  texts: Object.fromEntries(LINKEDIN_SECTIONS.map((k) => [k, currentVersion(sectionOf(p, k)).text])) as Record<LinkedinSectionKey, string>,
});
