import { type LinkedinPayload, type LinkedinSectionKey, type LinkedinSuggestion } from "@/lib/linkedin-types";
import { buildClaimInventory, toolsIn, type ClaimInventory } from "./claims";
import { ruleRewrite } from "./cv";
import { safeExplanation } from "./explanation-check";
import { documentVersion } from "./findings";
import { BUZZWORDS } from "./lexicon";
import { checkSectionText, currentVersion, isRoleLine, linesOf, sectionOf, stripBullet } from "./linkedin-check";
import { ALREADY_STRONG, withPlaceholders } from "./rewrite-check";

// OP-018: suggestions built only from what the student gave us, offered only if they survive the fact check. Works with
// no AI key. Model text comes through `offerCandidates` too, so a suggestion can't reach the page any other way.

const CHECK_FAILED = "We couldn't check this suggestion against what you gave us, so we left it out.";

export interface Candidate {
  before: string | null;
  after: string;
  why: string;
}

export interface Offered {
  suggestions: LinkedinSuggestion[];
  withheld: string[];
}

/** Checks candidates. A block is repaired with a placeholder if that's all it needs, and otherwise not offered. */
export function offerCandidates(p: Pick<LinkedinPayload, "sections">, inv: ClaimInventory, key: LinkedinSectionKey, candidates: Candidate[], method: "rules" | "ai", at: string): Offered {
  const basedOn = currentVersion(sectionOf(p, key)).documentVersion;
  const suggestions: LinkedinSuggestion[] = [];
  const withheld: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    let after = c.after.trim();
    if (after) {
      try {
        const check = checkSectionText(p, inv, key, after, { before: c.before });
        if (check.verdict === "block") {
          const repaired = withPlaceholders(after, check);
          const again = repaired ? checkSectionText(p, inv, key, repaired, { before: c.before }) : null;
          if (!repaired || !again || again.verdict === "block") {
            withheld.push(check.issues.find((i) => i.severity === "block")?.message ?? "It didn't pass our check against what you gave us.");
            continue;
          }
          after = repaired;
        }
      } catch {
        // A check that can't finish hasn't passed anything.
        withheld.push(CHECK_FAILED);
        continue;
      }
    }
    if (seen.has(`${c.before}\u0000${after}`) || after === currentVersion(sectionOf(p, key)).text.trim()) continue;
    seen.add(`${c.before}\u0000${after}`);
    suggestions.push({ id: `${method}:${documentVersion(`${key}\u0000${c.before ?? ""}\u0000${after}`).slice(0, 16)}`, before: c.before, after, why: method === "ai" ? safeExplanation(inv, c.why) : c.why, method, basedOn, at });
  }
  return { suggestions, withheld: [...new Set(withheld)] };
}

/* ---------- What the rules can build ---------- */

function studyFrom(text: string): string | null {
  for (const line of linesOf(text)) {
    const parts = line.split(",").map((x) => x.trim());
    const course = parts.find((x) => /\b(bsc|ba|meng|msc|ma|mba|beng|llb|phd|degree|bachelor|master)\b/i.test(x));
    const place = parts.find((x) => /\b(university|college|institute|school)\b/i.test(x));
    if (course || place) return [course, place].filter(Boolean).join(", ");
  }
  return null;
}

/** A direction in the student's words, lower-cased unless it's an acronym, and worded as something they want. */
export function aimPhrase(aim: string | null): string | null {
  const clean = aim?.trim().replace(/\.$/, "").replace(/\b(roles?|jobs?|positions?)$/i, "").trim();
  if (!clean) return null;
  return `seeking ${clean.split(/\s+/).map((w) => (/^[A-Z0-9&+#]{2,}$/.test(w) ? w : w.toLowerCase())).join(" ")} roles`;
}

function cvEntries(cvText: string | null, sections: string[]) {
  return cvText ? buildClaimInventory(cvText).entries.filter((e) => sections.includes(e.section)) : [];
}

const skillsListed = (text: string) => text.split(/[,\n;|•]+/).map((s) => s.trim()).filter(Boolean);
const hasBuzz = (s: string) => BUZZWORDS.some((b) => s.toLowerCase().includes(b));

export function ruleCandidates(p: Pick<LinkedinPayload, "sections" | "aim">, key: LinkedinSectionKey, cvText: string | null): Candidate[] {
  const text = (k: LinkedinSectionKey) => currentVersion(sectionOf(p, k)).text;
  const current = text(key);
  const cvEducation = cvEntries(cvText, ["education"]).map((e) => `${e.heading}\n${e.context}`).join("\n");
  const study = studyFrom(text("education")) ?? studyFrom(cvEducation);
  const aim = aimPhrase(p.aim);

  if (key === "headline") {
    const skills = [...skillsListed(text("skills")).filter((s) => s.length <= 24), ...toolsIn(cvText ?? "")].slice(0, 2);
    const parts = [study, aim, skills.join(", ")].filter(Boolean);
    return parts.length >= 2 ? [{ before: null, after: parts.join(" | "), why: "Built only from your education, your stated aim and skills you've listed. Change it until it sounds right." }] : [];
  }

  if (key === "about") {
    if (!current.trim() || current.split(/\s+/).length < 30) {
      const firstLine = linesOf(text("experience")).find((l) => !isRoleLine(l));
      const said = [study ? `I'm studying ${study}.` : "", firstLine && !current.trim() ? `${stripBullet(firstLine).replace(/\.$/, "")}.` : "", aim ? `I'm ${aim}.` : "", "[add what drew you to this]"].filter(Boolean).join(" ");
      return [{ before: null, after: current.trim() ? `${current.trim()} ${said}` : said, why: "A starting point from what you gave us. The blank is for your own words: we can't write why this matters to you." }];
    }
    return current
      .split(/(?<=[.!?])\s+/)
      .filter((s) => hasBuzz(s) && !/\d/.test(s))
      .slice(0, 3)
      .map((s) => ({ before: s.trim(), after: "", why: "This sentence is a stock claim with no example behind it. Removing it leaves your specifics to do the work." }));
  }

  if (key === "experience") {
    if (!current.trim()) {
      const roles = cvEntries(cvText, ["experience"]).filter((e) => e.isRole);
      return roles.length ? [{ before: null, after: roles.map((e) => [e.heading, ...e.rawLines.map((l) => `• ${l}`)].join("\n")).join("\n"), why: "Copied from the CV you chose, so the two agree. Edit it to suit LinkedIn." }] : [];
    }
    const out: Candidate[] = [];
    for (const line of linesOf(current).filter((l) => !isRoleLine(l))) {
      const bare = stripBullet(line);
      const rewrite = ruleRewrite(bare);
      if (rewrite !== ALREADY_STRONG && rewrite !== bare) out.push({ before: line, after: rewrite, why: "Opens with what you did. Keep your real level of involvement, and fill in any blank only with something accurate." });
      if (out.length === 6) break;
    }
    return out;
  }

  if (key === "education") {
    if (current.trim() || !cvEducation.trim()) return [];
    return [{ before: null, after: cvEducation.replace(/^EDUCATION\n?/i, "").trim(), why: "Copied from the CV you chose, so the two agree." }];
  }

  if (key === "skills") {
    const listed = skillsListed(current);
    const seen = [...toolsIn(text("experience")), ...toolsIn(text("about")), ...toolsIn(cvText ?? "")];
    const add = [...new Set(seen)].filter((t) => !listed.some((l) => l.toLowerCase() === t.toLowerCase())).slice(0, 8);
    return add.length ? [{ before: null, after: [...listed, ...add].join(", "), why: `Adds ${add.join(", ")}, which you already name in what you gave us.` }] : [];
  }
  return [];
}
