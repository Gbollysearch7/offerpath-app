import type { CheckKey } from "@/lib/types";

interface CheckContent {
  tagline: string;
  icon: string; // the short label under the alert icon
  insight: string;
  more: string;
  measure?: string[];
  examples: { b: string; a: string }[];
}

// Static guidance shown on each check page. Written for UK student applications.
export const CHECK_CONTENT: Record<CheckKey, CheckContent> = {
  quant: {
    tagline: "Show the size of your achievements with numbers and metrics.",
    icon: "Add more numbers",
    insight: "Numbers build credibility and help your CV stand out in a quick scan. Graduate recruiters see hundreds of CVs for each scheme, and a number gives them something concrete to remember: how many, how much, how fast.",
    more: "No exact figure? A careful estimate is fine, as long as you can explain it at interview. Ranges (\"20 to 30 people\") and comparisons (\"twice the previous year\") also count.",
    measure: ["People reached", "Money raised or saved", "Time saved", "Percentage growth", "Number of events or projects", "Team size", "Ranking or grade", "Customers served"],
    examples: [
      { b: "Responsible for the society newsletter.", a: "Grew newsletter readership from 300 to 900 students in one academic year." },
      { b: "Helped with stock checks at weekends.", a: "Counted and reconciled 1,200 product lines each weekend with no discrepancies." },
      { b: "Worked on a group consulting project.", a: "Analysed a local charity's costs in a team of 4 and recommended savings worth £18k a year." },
    ],
  },
  verbs: {
    tagline: "Lead every bullet with a verb that shows what you did.",
    icon: "Use stronger verbs",
    insight: "The first word of a bullet is the one recruiters read. \"Helped\" and \"Assisted\" hide what you actually did. Name the specific thing: \"Drafted\", \"Scheduled\", \"Analysed\". If you led it, say \"Led\"; if you supported it, say so precisely with \"Co-organised\" or \"Contributed to\" rather than claiming the lead.",
    more: "Pick verbs by the skill you want to show: leadership (Led, Chaired), analysis (Modelled, Forecast), communication (Presented, Negotiated). Keep the verb true to the role you had. The action verb bank has more.",
    examples: [
      { b: "Helped organise the careers fair.", a: "Co-organised a careers fair for 30 employers and 600 students." },
      { b: "Assisted the marketing team.", a: "Drafted 12 social posts for the marketing team; Instagram followers grew 18% over the campaign." },
    ],
  },
  accomp: {
    tagline: "Describe what you achieved, not what you were supposed to do.",
    icon: "Show results",
    insight: "\"Responsible for\" tells a recruiter about the job description, not about you. Every role has duties; your CV should show what changed because you did them well.",
    more: "Ask yourself: what was better when I left? Faster, cheaper, bigger, happier customers, fewer mistakes.",
    examples: [
      { b: "Responsible for training new staff.", a: "Trained 5 new team members, cutting onboarding time by a week." },
      { b: "Duties included answering customer emails.", a: "Answered 40+ customer emails a day with a 95% satisfaction score." },
    ],
  },
  repeat: {
    tagline: "Vary your wording so every line feels fresh.",
    icon: "Vary your verbs",
    insight: "Starting several bullets with the same word makes a CV feel repetitive and hides the range of what you did.",
    more: "Group similar achievements, or pick a different verb that's more precise for each one.",
    examples: [{ b: "Managed the budget. Managed the social media. Managed volunteers.", a: "Managed a £6,000 budget. Grew social media reach by 40%. Recruited 25 volunteers." }],
  },
  filler: {
    tagline: "Cut words that add length but not meaning.",
    icon: "Cut filler",
    insight: "Words like \"very\", \"really\" and \"successfully\" take up space without adding evidence. Recruiters read faster when every word earns its place.",
    more: "If you delete the word and the sentence still means the same, leave it out.",
    examples: [{ b: "Successfully completed a very challenging project.", a: "Completed a 12-week data project two weeks early." }],
  },
  buzz: {
    tagline: "Swap clichés for evidence.",
    icon: "Replace buzzwords",
    insight: "Every CV claims to be \"hard-working\" and \"a team player\". Recruiters skip these words. Show the quality with an example instead.",
    more: "Turn each buzzword into a bullet: what did you do that proves it?",
    examples: [{ b: "Hard-working team player with excellent communication skills.", a: "Captained a 15-person hockey team while working 12 hours a week." }],
  },
  passive: {
    tagline: "Say who did it: you.",
    icon: "Use active voice",
    insight: "Passive sentences (\"a report was produced\") hide your role. Active sentences (\"I produced a report\", written as \"Produced a report\") are shorter and clearer.",
    more: "Look for \"was\" or \"were\" followed by a verb ending in -ed.",
    examples: [{ b: "A new filing system was introduced.", a: "Introduced a filing system that halved search time." }],
  },
  sections: {
    tagline: "Use the headings recruiters expect, in the order they expect.",
    icon: "Fix sections",
    insight: "UK graduate recruiters expect Education, Experience and Skills, usually in that order for students. \"References available on request\" is assumed and wastes space.",
    more: "Optional sections that work well: Projects, Positions of responsibility, Achievements, Interests (keep it short and specific).",
    examples: [{ b: "References available on request.", a: "(Delete it, and use the line for another achievement.)" }],
  },
  ats: {
    tagline: "Keep your CV as plain, readable text.",
    icon: "Simplify layout",
    insight: "Many employers use applicant tracking systems to read CVs before a person does, and columns, tables, text boxes and images can scramble your text. What we report is narrower: how many words came through from your file and which headings we recognised. We can't see your layout, and we can't test any individual employer's system.",
    more: "Use one column, standard headings, a common font, and save as PDF with selectable text. Our templates use one column and real text, which helps, but no layout can guarantee how a particular employer's system will read your file.",
    examples: [{ b: "Two-column layout with skills in a sidebar graphic.", a: "One column with a plain \"Skills\" heading and a comma-separated list." }],
  },
  contact: {
    tagline: "Make it easy to reach you.",
    icon: "Add contact details",
    insight: "Put your email, mobile number and LinkedIn at the top. You don't need your full address, date of birth or a photo on a UK CV.",
    more: "Use a professional email address, ideally your own name.",
    examples: [{ b: "partyking99@email.com", a: "jordan.reed@email.com · 07700 900123 · linkedin.com/in/jordanreed" }],
  },
  sector: {
    tagline: "Speak the language of the sector you're applying to.",
    icon: "Add keywords",
    insight: "Recruiters often scan for sector terms, and some screening tools search for them too. If they're missing, a strong CV can still look like a poor fit.",
    more: "Only add keywords that are true for you, and use them in context: in a bullet that proves the skill, not just in a list.",
    examples: [{ b: "Built spreadsheets for my dissertation.", a: "Built a financial model in Excel forecasting house prices across 10 UK regions." }],
  },
  spell: {
    tagline: "Use UK spelling for UK employers. We compare against a short list of variants.",
    icon: "Use UK spelling",
    insight: "Proofread your CV carefully and ask someone else to read it too. This check is narrower than that: it compares your CV against a short list of common US spellings such as \"organize\". A different English variant is a regional preference, not poor writing, and it stays correct inside an official name, a quotation or a product name.",
    more: "Common swaps: organise, analyse, modelling, programme (for a scheme), colour, centre. Keep the original spelling where it belongs to a name, such as the World Health Organization.",
    examples: [
      { b: "Organized a charity event.", a: "Organised a charity event." },
      { b: "Volunteered with the World Health Organization.", a: "Volunteered with the World Health Organization. (An official name keeps its own spelling.)" },
    ],
  },
  grammar: {
    tagline: "Keep your bullet style consistent.",
    icon: "Fix bullet style",
    insight: "Small inconsistencies, like some bullets ending in full stops and some not, make a CV look rushed. This check looks at three things: words repeated next to each other, bullets that start with a lowercase letter, and bullets that mix full stops with none. It isn't a grammar checker, so tense, agreement and sentence structure are still yours to check.",
    more: "Pick one style and apply it everywhere, and start every bullet with a capital letter. Read your CV aloud, or ask your careers adviser to read it, to catch the writing this check can't see.",
    examples: [{ b: "led the team. organised events", a: "Led the team. Organised events." }],
  },
  length: {
    tagline: "Two pages at most for UK graduate roles.",
    icon: "Adjust length",
    insight: "Recruiters spend seconds on a first read. One page works well for internships and spring weeks; two pages is the limit for graduate roles. We estimate your page count from your word count rather than measuring it, so open your own file to confirm where the pages break.",
    more: "Cut older or less relevant roles to one line, and remove school details if you're at university.",
    examples: [{ b: "Three pages including GCSE grades and every part-time job.", a: "Two pages: degree, A levels, three relevant roles, skills." }],
  },
  bulletlen: {
    tagline: "Aim for 12 to 25 words per bullet.",
    icon: "Resize bullets",
    insight: "Short bullets miss the result; long ones don't get read. One line to one and a half lines is the sweet spot.",
    more: "Use the pattern: action verb + what you did + result with a number.",
    examples: [{ b: "Did data entry.", a: "Entered and checked 2,000 customer records, cutting errors by 30%." }],
  },
  bullets: {
    tagline: "Enough bullets to show your experience, not so many they blur.",
    icon: "Balance bullets",
    insight: "Three to five bullets per role is typical. Fewer can look thin; more can bury your best work.",
    more: "Order bullets by impact, strongest first.",
    examples: [{ b: "Eight bullets for a two-week work experience placement.", a: "Two strong bullets for the placement, more for your main role." }],
  },
};

/**
 * Shown above the before/after examples on every check page. The figures and details in the examples
 * are invented to show a pattern; the note says so, and tells the student to keep their real level of
 * responsibility, because a rewrite that turns "helped" into "led" is a false claim, not a stronger one.
 */
export const EXAMPLES_NOTE = "The figures and details in these examples are made up to show the pattern. Use your own real numbers, and keep the level of responsibility you actually had: a supporting role stays a supporting role.";

/**
 * What a check does and does not cover, for the checks whose score is easy to over-read.
 *
 * Shown on the check page and keyed on the check, not on the saved report. Reports saved before
 * November 2026 keep their original wording in the database (we don't rewrite a student's history),
 * so this note is how an older report still carries the current limits. Checks with no material
 * coverage gap are deliberately absent rather than given filler text.
 */
export const CHECK_SCOPE: Partial<Record<CheckKey, string>> = {
  ats: "What this covers: the text we extracted from your file, its word count, and the headings we recognised. It can't see columns, tables, images or fonts, and it can't test an individual employer's screening software.",
  spell: "What this covers: a short list of common US spellings. Other spelling mistakes aren't detected, so 10 out of 10 here doesn't mean your CV is spelled correctly.",
  grammar: "What this covers: words repeated next to each other, bullets starting with a lowercase letter, and bullets that mix full stops with none. Grammar, tense, agreement and sentence structure aren't assessed.",
  length: "Your page count is estimated from your word count at about 450 words a page. It isn't measured from your file, so check your own document for the real page breaks.",
};
