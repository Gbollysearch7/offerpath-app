// Synthetic CV and rewrites for OP-015. Every name, figure and employer here is made up. `faithful` rewrites say nothing
// the source line doesn't; `inventions` each add or move a fact. Written by the implementer, so this measures the rules
// against their author's idea of a hard case. It is not the independent fidelity review OP-011 calls for.

export const REWRITE_CV = `Amara Okafor
amara@example.ac.uk | 07700 900123 | London

PROFILE
Economics student with 2 years of society and retail experience.

EDUCATION
BSc Economics, University of Leeds, 2022 – 2025
Dean's List 2024.

EXPERIENCE
Events Officer, Economics Society | Sep 2023 – Jun 2024
• Supported the committee with 12 careers events for 400 students.
• Raised £2,400 for a student-led charity week, beating the target by 20%.
• Helped organise a networking dinner with local employers.
• Co-organised a mock interview day with the careers service.

Sales Assistant
Harlow Books, Leeds, Jun 2022 – Aug 2023
• Served 60 customers a day and kept stock records in Excel.
• Trained 3 new starters on the till system.
• Managed weekly window displays for the shop.
• Answered customer questions about delivery times.

PROJECTS
Budget Tracker | 2024
• Built a budget tracker in Python used by 15 flatmates and friends.
• Wrote a short guide so that others could set it up themselves.

SKILLS
SQL, Tableau, Excel, public speaking
`;

export const LINES = {
  careers: "Supported the committee with 12 careers events for 400 students.",
  charity: "Raised £2,400 for a student-led charity week, beating the target by 20%.",
  dinner: "Helped organise a networking dinner with local employers.",
  mock: "Co-organised a mock interview day with the careers service.",
  customers: "Served 60 customers a day and kept stock records in Excel.",
  starters: "Trained 3 new starters on the till system.",
  windows: "Managed weekly window displays for the shop.",
  questions: "Answered customer questions about delivery times.",
  tracker: "Built a budget tracker in Python used by 15 flatmates and friends.",
  guide: "Wrote a short guide so that others could set it up themselves.",
} as const;

export type LineKey = keyof typeof LINES;
export type Verdict = "pass" | "confirm" | "block";
export interface RewriteCase {
  line: LineKey;
  rewrite: string;
  category: string;
  /** For inventions: the verdict the case should get. */
  expect?: Exclude<Verdict, "pass">;
}

export const FAITHFUL: RewriteCase[] = [
  { line: "careers", rewrite: "Contributed to 12 careers events for 400 students as part of the society committee.", category: "same facts, shared verb" },
  { line: "careers", rewrite: "Coordinated support for 12 careers events reaching 400 students with the committee.", category: "same facts, allowed verb" },
  { line: "careers", rewrite: "Supported the committee in running 12 careers events for 400 students, reaching [X%] more students than the year before.", category: "placeholder" },
  { line: "charity", rewrite: LINES.charity, category: "unchanged strong line" },
  { line: "charity", rewrite: "Raised £2,400 for a student-led charity week and beat the target by 20%.", category: "light edit" },
  { line: "charity", rewrite: "Beat the charity week target by 20 per cent, raising £2.4k for a student-led cause.", category: "same figure, different form" },
  { line: "charity", rewrite: "Raised 2,400 pounds, or £2400, for a student-led charity week, 20% above target.", category: "same figure, different form" },
  { line: "dinner", rewrite: "Jointly organised a networking dinner with local employers, reaching [number] people.", category: "shared kept" },
  { line: "dinner", rewrite: "Contributed to organising a networking dinner with local employers, which [grew / cut] [what] by [X%].", category: "rule-style tail" },
  { line: "dinner", rewrite: "Helped organise a networking dinner connecting students with local employers.", category: "minor connective word" },
  { line: "mock", rewrite: "Co-organised a mock interview day with the careers service, resulting in [result].", category: "placeholder outcome" },
  { line: "customers", rewrite: "Served 60 customers a day while keeping accurate stock records in Excel.", category: "same facts" },
  { line: "customers", rewrite: "Kept stock records in Excel while serving sixty customers daily.", category: "number word" },
  { line: "starters", rewrite: "Trained three new starters on the till system.", category: "number word" },
  { line: "starters", rewrite: "Trained 3 new starters to use the till system confidently.", category: "soft adverb" },
  { line: "windows", rewrite: "Managed weekly window displays for the shop, lifting [metric] from [X] to [Y].", category: "rule-style tail" },
  { line: "windows", rewrite: "Led weekly window displays for the shop.", category: "lead word to lead word" },
  { line: "questions", rewrite: "Answered customer questions about delivery times, reducing [metric] by [X%].", category: "outcome asked for" },
  { line: "questions", rewrite: "Dealt with customer queries about delivery times.", category: "synonym" },
  { line: "tracker", rewrite: "Built a Python budget tracker used by 15 flatmates and friends.", category: "reorder" },
  { line: "tracker", rewrite: "Developed a budget tracker in Python for 15 flatmates and friends.", category: "equal verb" },
  { line: "guide", rewrite: "Wrote a short set-up guide so that others could install the tool themselves.", category: "small rewording" },
  { line: "guide", rewrite: "Drafted a brief guide that let others set it up themselves.", category: "synonyms" },
  { line: "questions", rewrite: "Responded to customer questions on delivery times, helping shoppers plan their orders.", category: "mild new detail in plain words" },
];

export const INVENTIONS: RewriteCase[] = [
  // Figures moved between roles
  { line: "starters", rewrite: "Trained 60 new starters on the till system.", category: "figure from same entry, other line", expect: "confirm" },
  { line: "starters", rewrite: "Trained 400 new starters on the till system.", category: "figure from another role", expect: "block" },
  { line: "windows", rewrite: "Managed weekly window displays that raised £2,400 for the shop.", category: "figure from another role", expect: "block" },
  { line: "questions", rewrite: "Answered customer questions about delivery times, cutting complaints by 20%.", category: "figure from another role", expect: "block" },
  { line: "dinner", rewrite: "Helped organise a networking dinner for 15 local employers.", category: "figure from another role", expect: "block" },
  { line: "tracker", rewrite: "Built a budget tracker in Python used by 400 students.", category: "figure from another role", expect: "block" },
  { line: "dinner", rewrite: "Helped organise a networking dinner with local employers for 400 students.", category: "figure from same entry, other line", expect: "confirm" },
  // Figures invented or changed
  { line: "charity", rewrite: "Raised £5,000 for a student-led charity week, beating the target by 20%.", category: "changed figure", expect: "block" },
  { line: "charity", rewrite: "Raised £2,400 for a student-led charity week, beating the target by 2,400%.", category: "unit moved", expect: "block" },
  { line: "questions", rewrite: "Answered 150 customer questions a day about delivery times.", category: "invented figure", expect: "block" },
  { line: "guide", rewrite: "Wrote a short guide that twelve others used to set it up themselves.", category: "invented number word", expect: "block" },
  { line: "windows", rewrite: "Managed weekly window displays that doubled footfall for the shop.", category: "invented multiplier", expect: "block" },
  { line: "questions", rewrite: "Answered hundreds of customer questions about delivery times.", category: "invented size", expect: "block" },
  { line: "questions", rewrite: "Answered customer questions about delivery times, with satisfaction up [90%] at the shop.", category: "number in a placeholder", expect: "block" },
  { line: "customers", rewrite: "Served 60 managers a day and kept stock records in Excel.", category: "same number, new noun", expect: "confirm" },
  // Dates
  { line: "starters", rewrite: "Trained 3 new starters on the till system in 2021.", category: "invented date", expect: "block" },
  { line: "starters", rewrite: "Trained 3 new starters on the till system in 2024.", category: "date from another role", expect: "block" },
  // Responsibility
  { line: "careers", rewrite: "Led the committee delivering 12 careers events for 400 students.", category: "supported to led", expect: "confirm" },
  { line: "careers", rewrite: "Managed 12 careers events for 400 students.", category: "supported to managed", expect: "confirm" },
  { line: "dinner", rewrite: "Organised a networking dinner with local employers.", category: "help removed", expect: "confirm" },
  { line: "dinner", rewrite: "Spearheaded a networking dinner with local employers.", category: "helped to spearheaded", expect: "confirm" },
  { line: "mock", rewrite: "Organised a mock interview day for the careers service.", category: "shared removed", expect: "confirm" },
  { line: "starters", rewrite: "Headed training for 3 new starters on the till system.", category: "did to headed", expect: "confirm" },
  { line: "guide", rewrite: "Independently wrote a short guide so that others could set it up themselves.", category: "solo claim", expect: "confirm" },
  // Entities and qualifications
  { line: "tracker", rewrite: "Built a budget tracker in Python at Google, used by 15 flatmates and friends.", category: "invented employer", expect: "block" },
  { line: "starters", rewrite: "Trained 3 new starters on the till system at the Economics Society.", category: "employer from another role", expect: "block" },
  { line: "windows", rewrite: "Managed weekly window displays for the shop using HubSpot.", category: "invented tool", expect: "block" },
  { line: "windows", rewrite: "Managed weekly window displays for the shop using salesforce.", category: "invented tool, lower case", expect: "block" },
  { line: "windows", rewrite: "Managed weekly window displays for the shop using Python.", category: "tool from another role", expect: "confirm" },
  { line: "windows", rewrite: "Managed weekly window displays for the shop, tracked in Tableau.", category: "tool from skills only", expect: "confirm" },
  { line: "starters", rewrite: "Trained 3 new starters on the till system as a CIPD-certified trainer.", category: "invented qualification", expect: "block" },
  { line: "guide", rewrite: "Wrote a short award-winning guide so that others could set it up themselves.", category: "invented award", expect: "block" },
  // Outcomes and scope
  { line: "questions", rewrite: "Answered customer questions about delivery times, improving satisfaction.", category: "invented outcome", expect: "confirm" },
  { line: "windows", rewrite: "Managed weekly window displays for the shop, boosting sales.", category: "invented outcome", expect: "confirm" },
  { line: "guide", rewrite: "Wrote a short guide for international teams so that others could set it up themselves.", category: "invented scope", expect: "confirm" },
  { line: "questions", rewrite: "Answered several customer questions about delivery times.", category: "invented vague size", expect: "confirm" },
  // Whole-line swaps
  { line: "questions", rewrite: "Audited quarterly spending, restructured procurement contracts and negotiated supplier agreements.", category: "unrelated line", expect: "block" },
  { line: "windows", rewrite: "Coached junior colleagues on merchandising techniques throughout seasonal promotional campaigns nationally.", category: "mostly new", expect: "block" },
];

/** New facts in plain lower-case words. The rules have no way to see these: recorded so the gap stays visible. */
export const KNOWN_MISSES: RewriteCase[] = [
  { line: "questions", rewrite: "Answered customer questions about delivery times by phone and through the online chat service.", category: "new channel in plain words" },
  { line: "windows", rewrite: "Managed weekly window displays for the shop and negotiated stock deals with suppliers.", category: "new activity in plain words" },
  { line: "guide", rewrite: "Wrote a short guide, with screenshots and video walkthroughs, so that others could set it up themselves.", category: "new detail in plain words" },
  { line: "starters", rewrite: "Trained 3 new starters on the till system and the returns process.", category: "new scope in plain words" },
];
