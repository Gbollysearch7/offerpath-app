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
      { b: "Worked on a group consulting project.", a: "Led a team of 4 to recommend savings worth £18k a year to a local charity." },
    ],
  },
  verbs: {
    tagline: "Lead every bullet with a verb that shows what you did.",
    icon: "Use stronger verbs",
    insight: "The first word of a bullet is the one recruiters read. \"Helped\" and \"Assisted\" hide your contribution; \"Organised\", \"Built\" and \"Led\" make it clear.",
    more: "Pick verbs by the skill you want to show: leadership (Led, Chaired), analysis (Modelled, Forecast), communication (Presented, Negotiated). The action verb bank has more.",
    examples: [
      { b: "Helped organise the careers fair.", a: "Organised a careers fair for 30 employers and 600 students." },
      { b: "Assisted the marketing team.", a: "Drafted 12 social posts that grew Instagram followers by 18%." },
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
    tagline: "Make sure screening software can read your CV.",
    icon: "Simplify layout",
    insight: "Many employers use applicant tracking systems to read CVs before a person does. Columns, tables, text boxes and images can scramble your text.",
    more: "Use one column, standard headings, a common font, and save as PDF with selectable text. Our templates are all ATS-safe.",
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
    insight: "Recruiters and screening software look for sector terms. If they're missing, a strong CV can still look like a poor fit.",
    more: "Only add keywords that are true for you, and use them in context: in a bullet that proves the skill, not just in a list.",
    examples: [{ b: "Built spreadsheets for my dissertation.", a: "Built a financial model in Excel forecasting house prices across 10 UK regions." }],
  },
  spell: {
    tagline: "Use UK English for UK employers.",
    icon: "Fix spelling",
    insight: "Spelling mistakes are one of the most common reasons CVs are rejected. US spellings like \"organize\" look careless on a UK application.",
    more: "Common swaps: organise, analyse, modelling, programme (for a scheme), colour, centre.",
    examples: [{ b: "Organized a charity event.", a: "Organised a charity event." }],
  },
  grammar: {
    tagline: "Keep punctuation and grammar consistent.",
    icon: "Fix grammar",
    insight: "Small inconsistencies, like some bullets ending in full stops and some not, make a CV look rushed.",
    more: "Pick one style and apply it everywhere. Start every bullet with a capital letter.",
    examples: [{ b: "led the team. organised events", a: "Led the team. Organised events." }],
  },
  length: {
    tagline: "Two pages at most for UK graduate roles.",
    icon: "Adjust length",
    insight: "Recruiters spend seconds on a first read. One page works well for internships and spring weeks; two pages is the limit for graduate roles.",
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
