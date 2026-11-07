// Written after the rules were frozen (hashes in the OP-015 report) and run once. Whatever these measure is recorded in
// tests/rewrite.test.ts as it came out: the rules were not changed to improve this result. Same author as the rules,
// so this is a weak test of generalisation, not an independent review. A different CV from the rules' development set.

export const HELDOUT_CV = `Priya Nair
priya.nair@example.ac.uk | Bristol

PROFILE
Chemistry graduate moving into data analysis.

EDUCATION
MChem Chemistry, University of Bristol, 2021 – 2025
Upper Second Class Honours.

EXPERIENCE
Laboratory Demonstrator, School of Chemistry | Oct 2023 – Jun 2025
• Assisted the lecturer in first-year practicals for 90 undergraduates.
• Marked weekly lab reports and gave written feedback.
• Reduced reagent waste by 15% by reorganising the prep schedule.

Data Intern, Severn Water | Jul 2024 – Sep 2024
• Cleaned 3 years of leak reports in R and flagged duplicate records.
• Helped build a Power BI dashboard for the network team.
• Presented findings to 8 engineers at the end of the placement.

Café Supervisor, The Green Bean | 2021 – 2023
• Ran the Saturday shift for a team of 5.
• Handled cash-up and weekly stock orders.
• Dealt with supplier queries by phone.

ACTIVITIES
Treasurer, Bristol Climbing Club | 2022 – 2023
• Kept the club accounts for 140 members.
• Worked with the committee on a grant application.

SKILLS
R, Power BI, SQL, Excel, HPLC
`;

export const HELD_LINES = {
  practicals: "Assisted the lecturer in first-year practicals for 90 undergraduates.",
  marked: "Marked weekly lab reports and gave written feedback.",
  reagent: "Reduced reagent waste by 15% by reorganising the prep schedule.",
  leak: "Cleaned 3 years of leak reports in R and flagged duplicate records.",
  dashboard: "Helped build a Power BI dashboard for the network team.",
  presented: "Presented findings to 8 engineers at the end of the placement.",
  shift: "Ran the Saturday shift for a team of 5.",
  cash: "Handled cash-up and weekly stock orders.",
  supplier: "Dealt with supplier queries by phone.",
  accounts: "Kept the club accounts for 140 members.",
  grant: "Worked with the committee on a grant application.",
} as const;

export type HeldKey = keyof typeof HELD_LINES;

export const HELD_FAITHFUL: { line: HeldKey; rewrite: string }[] = [
  { line: "practicals", rewrite: "Assisted the lecturer in running first-year practicals for 90 undergraduates." },
  { line: "practicals", rewrite: "Supported first-year practicals for ninety undergraduates under the lecturer." },
  { line: "marked", rewrite: "Marked lab reports every week and provided written feedback to students." },
  { line: "reagent", rewrite: "Cut reagent waste by 15% through a reorganised prep schedule." },
  { line: "reagent", rewrite: "Reorganised the prep schedule, reducing reagent waste by 15 per cent." },
  { line: "leak", rewrite: "Cleaned three years of leak reports in R and flagged duplicates." },
  { line: "leak", rewrite: "Flagged duplicate records while cleaning 3 years of leak reports in R, saving [X] hours." },
  { line: "dashboard", rewrite: "Contributed to building a Power BI dashboard for the network team." },
  { line: "dashboard", rewrite: "Collaborated on a Power BI dashboard used by the network team to track [metric]." },
  { line: "presented", rewrite: "Presented placement findings to 8 engineers." },
  { line: "presented", rewrite: "Shared findings with 8 engineers in a presentation at the end of the placement." },
  { line: "shift", rewrite: "Ran the Saturday shift, looking after a team of five." },
  { line: "cash", rewrite: "Handled the cash-up and placed weekly stock orders." },
  { line: "cash", rewrite: "Processed cash-up and weekly stock orders accurately." },
  { line: "supplier", rewrite: "Answered supplier queries by phone." },
  { line: "supplier", rewrite: "Dealt with supplier queries over the phone, resolving [number] a week." },
  { line: "accounts", rewrite: "Maintained club accounts for 140 members." },
  { line: "accounts", rewrite: "Kept accounts for a club of 140 members during 2022." },
  { line: "grant", rewrite: "Worked with the committee to prepare a grant application." },
  { line: "grant", rewrite: "Contributed to a grant application alongside the committee." },
];

export const HELD_INVENTIONS: { line: HeldKey; rewrite: string; what: string }[] = [
  { line: "marked", rewrite: "Marked weekly lab reports for 90 undergraduates and gave written feedback.", what: "same-entry figure on another line" },
  { line: "marked", rewrite: "Marked weekly lab reports for 140 students and gave written feedback.", what: "figure from another role" },
  { line: "supplier", rewrite: "Dealt with 8 supplier queries by phone each day.", what: "figure from another role" },
  { line: "shift", rewrite: "Ran the Saturday shift for a team of 8.", what: "figure from another role" },
  { line: "accounts", rewrite: "Kept the club accounts for 140 members, reducing errors by 15%.", what: "figure from another role" },
  { line: "reagent", rewrite: "Reduced reagent waste by 25% by reorganising the prep schedule.", what: "changed figure" },
  { line: "cash", rewrite: "Handled cash-up of £3,000 and weekly stock orders.", what: "invented amount" },
  { line: "presented", rewrite: "Presented findings to 8 directors at the end of the placement.", what: "number now counts something else" },
  { line: "dashboard", rewrite: "Built a Power BI dashboard for the network team.", what: "help removed" },
  { line: "dashboard", rewrite: "Led the build of a Power BI dashboard for the network team.", what: "helped to led" },
  { line: "practicals", rewrite: "Taught first-year practicals for 90 undergraduates.", what: "assisted to taught" },
  { line: "practicals", rewrite: "Supervised first-year practicals for 90 undergraduates.", what: "assisted to supervised" },
  { line: "grant", rewrite: "Secured a grant with the committee through a strong application.", what: "invented outcome" },
  { line: "grant", rewrite: "Headed a grant application with the committee.", what: "worked with to headed" },
  { line: "marked", rewrite: "Marked weekly lab reports in Python and gave written feedback.", what: "tool not in the CV for this role" },
  { line: "supplier", rewrite: "Dealt with supplier queries by phone using Salesforce.", what: "invented tool" },
  { line: "cash", rewrite: "Handled cash-up and weekly stock orders in Excel.", what: "tool from skills only" },
  { line: "leak", rewrite: "Cleaned 3 years of leak reports in R for Thames Water and flagged duplicate records.", what: "invented employer" },
  { line: "shift", rewrite: "Ran the Saturday shift at Severn Water for a team of 5.", what: "employer from another role" },
  { line: "accounts", rewrite: "Kept the club accounts for 140 members as an ACCA-qualified treasurer.", what: "invented qualification" },
  { line: "presented", rewrite: "Presented findings to 8 engineers in September 2025.", what: "invented date" },
  { line: "supplier", rewrite: "Dealt with supplier queries by phone, improving delivery reliability.", what: "invented outcome" },
  // In plain words: expected to get through, and counted if they do.
  { line: "supplier", rewrite: "Dealt with supplier queries by phone and renegotiated delivery slots.", what: "new activity in plain words" },
  { line: "cash", rewrite: "Handled cash-up and weekly stock orders and trained colleagues on the process.", what: "new activity in plain words" },
  { line: "marked", rewrite: "Marked weekly lab reports, gave written feedback and ran revision sessions.", what: "new activity in plain words" },
  { line: "presented", rewrite: "Presented findings and recommendations to 8 engineers, who adopted the new process.", what: "invented result in plain words" },
];
