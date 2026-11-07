// Synthetic letters for OP-017. Every name, figure and employer is made up. Written by the rules' author, so results here show
// consistency with one person's idea of a hard case, not real-world accuracy.
export const LETTER_CV = [
  "Alex Example",
  "alex.example@example.com | 07700 900123",
  "EDUCATION",
  "University of Northfield | BSc Economics | 2023 - 2026",
  "Predicted 2:1",
  "EXPERIENCE",
  "EVENTS OFFICER, ECONOMICS SOCIETY | 2024 - 2025",
  "• Organised 12 speaker events for 300 members and managed a budget of £6,000.",
  "• Presented monthly updates to the society committee and briefed new volunteers.",
  "RETAIL ASSISTANT, CORNER BOOKS | 2022 - 2024",
  "• Built an Excel tracker that cut weekly stock reporting time by 20% for a team of six.",
  "• Resolved customer complaints at the till and trained 3 new starters.",
  "SKILLS",
  "Excel, SQL, Python, Power BI",
].join("\n");

export const LETTER_ADVERT = [
  "Analyst Graduate Scheme",
  "Northbank is a regional lender serving small manufacturers across the North of England. Our two-year programme rotates graduates through credit risk, treasury and client lending teams.",
  "WHAT WE LOOK FOR",
  "Essential: Experience with Excel and SQL. Clear communication and teamwork.",
  "Desirable: Experience with Power BI is a plus.",
  "WHAT YOU WILL DO",
  "You will build lending reports and present findings to senior colleagues.",
].join("\n");

const HEADER = "Alex Example · alex.example@example.com · 07700 900123\n7 November 2026";
const CLOSE = "I would welcome the chance to discuss my application. Thank you for considering it.";
const SIGN = "Yours sincerely,\nAlex Example";
const wrap = (...body: string[]) => [HEADER, "Dear Hiring Manager,", ...body, CLOSE, SIGN].join("\n\n");

const EVIDENCE = "As Events Officer at the Economics Society, I organised 12 speaker events for 300 members and managed a budget of £6,000. I presented monthly updates to the society committee and briefed new volunteers. At Corner Books, I built an Excel tracker that cut weekly stock reporting time by 20% for a team of six. I also used SQL on my degree course to query survey data for a group project.";

export const LETTERS = {
  /** The employer's name dropped into a sentence that fits anyone, near "because". */
  nameInserted: wrap("I am applying for the Analyst Graduate Scheme at Northbank because Northbank is a leading company with a great reputation and strong values.", EVIDENCE),
  /** Same evidence, with a short reason in plain words and none of the phrases the old check looked for. */
  conciseCredible: wrap("I am applying for the Analyst Graduate Scheme at Northbank. My family's bakery kept its doors open in 2020 thanks to a small manufacturers loan from your Leeds lending team, and that is the work I want to learn.", EVIDENCE),
  /** A reason taken from the advert. */
  advertReason: wrap("I am applying for the Analyst Graduate Scheme at Northbank. Rotating through credit risk, treasury and client lending appeals to me because I want to see how a regional lender supports small manufacturers before I specialise.", EVIDENCE),
  /** Specific-sounding facts about the employer that no source given to us contains. */
  inventedFact: wrap("I am applying for the Analyst Graduate Scheme at Northbank. I admire Northbank's recent acquisition of Halcyon Bank and its award for sustainable finance.", EVIDENCE),
  /** Says it has the skills, shows none. */
  mentionsOnly: wrap("I am applying for the Analyst Graduate Scheme at Northbank. Rotating through credit risk and treasury appeals to me because I want to see how a regional lender works.", "I have strong Excel and SQL skills. I am an excellent communicator and a team player. I am proficient in Power BI and I have good attention to detail."),
  /** Claims from nowhere: a figure, a tool and a qualification the CV doesn't have. */
  overclaims: wrap("I am applying for the Analyst Graduate Scheme at Northbank. Rotating through credit risk and treasury appeals to me because I want to see how a regional lender works.", `${EVIDENCE} I also built Tableau dashboards for 900 customers and hold the CFA qualification.`),
  /** A form box with a limit in the advert. */
  shortStatement: "I want this scheme because rotating through credit risk and client lending would show me how a regional lender supports small manufacturers. At Corner Books, I built an Excel tracker that cut weekly stock reporting time by 20% for a team of six.",
  /** Career changer, little graduate experience, plain words. */
  careerChanger: wrap("After six years as a nurse I am applying for the Analyst Graduate Scheme at Northbank. Rotating through credit risk and client lending appeals to me because I want to work with small manufacturers like the ones my town depends on.", "I organised 12 speaker events for 300 members as Events Officer and managed a budget of £6,000. I presented monthly updates to the society committee, which taught me to explain numbers to people who don't work with them."),
} as const;

export const STATEMENT_ADVERT = `${LETTER_ADVERT}\nIn no more than 60 words, tell us why you want this scheme.`;
