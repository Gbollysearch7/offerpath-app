import type { Opportunity } from "@/lib/types";

// Fictional sample data. Employers and the university are invented for the demo,
// matching the prototype. The same opportunities are seeded into Supabase (supabase/seed.sql).

export const SAMPLE_OPPORTUNITIES: Opportunity[] = [
  { id: "opp-northbank-analyst", role: "Analyst Graduate Scheme", org: "Northbank", location: "London", type: "Graduate scheme", sector: "Finance and banking", sponsorsVisa: true, closesOn: "2026-11-14",
    description: "Analyst Graduate Scheme\nJoin our two-year Analyst programme, rotating across corporate banking, risk and strategy teams.\nWHAT YOU WILL DO\nBuild financial modelling tools to support client pitches and due diligence.\nAnalyse data in Excel and SQL, and present findings to senior colleagues.\nPractise stakeholder management across teams and with clients.\nWHAT WE LOOK FOR\nA 2:1 degree in any subject, strong commercial awareness and clear communication.\nExperience with Power BI or similar tools is a plus. Teamwork and leadership in student societies welcome.\nYou will use financial modelling and SQL every day, and stakeholder management is central to the role." },
  { id: "opp-calder-risk", role: "Risk Summer Internship", org: "Calder Capital", location: "Edinburgh", type: "Internship", sector: "Finance and banking", sponsorsVisa: true, closesOn: "2026-11-18",
    description: "Risk Summer Internship\nA ten-week internship in our market and credit risk teams.\nWHAT YOU WILL DO\nMonitor portfolio risk and prepare daily reports in Excel.\nSupport stress testing and scenario analysis using Python.\nWHAT WE LOOK FOR\nAnalytical thinking, attention to detail and an interest in markets. Python or VBA experience is a plus." },
  { id: "opp-brightwater-placement", role: "Industrial Placement, Finance", org: "Brightwater Energy", location: "Manchester", type: "Placement", sector: "Finance and banking", sponsorsVisa: false, closesOn: "2026-11-21",
    description: "Industrial Placement, Finance\nA 12-month placement in our finance team.\nWHAT YOU WILL DO\nSupport month-end reporting, budgeting and forecasting.\nWork with stakeholders across the business to improve reporting.\nWHAT WE LOOK FOR\nStrong Excel skills, communication and teamwork." },
  { id: "opp-ashby-consulting", role: "Consulting Summer Internship", org: "Ashby & Co", location: "London", type: "Internship", sector: "Consulting", sponsorsVisa: true, closesOn: "2026-11-22",
    description: "Consulting Summer Internship\nWork on real client projects alongside our consultants.\nWHAT YOU WILL DO\nResearch markets, analyse data and build recommendations for clients.\nPresent findings in PowerPoint to client stakeholders.\nWHAT WE LOOK FOR\nProblem solving, commercial awareness, teamwork and clear communication." },
  { id: "opp-harlow-spring", role: "Spring Week, Markets", org: "Harlow Partners", location: "London", type: "Spring week", sector: "Finance and banking", sponsorsVisa: false, closesOn: "2026-12-03",
    description: "Spring Week, Markets\nA week-long insight programme for first-year students.\nWHAT YOU WILL DO\nShadow traders and analysts, and take part in a markets challenge.\nWHAT WE LOOK FOR\nCuriosity about markets, teamwork and communication." },
  { id: "opp-mercer-accountant", role: "Graduate Accountant", org: "Mercer Lane", location: "Birmingham", type: "Graduate scheme", sector: "Finance and banking", sponsorsVisa: true, closesOn: "2026-12-09",
    description: "Graduate Accountant\nTrain towards the ACA qualification while working in audit and tax.\nWHAT YOU WILL DO\nSupport audit engagements, review financial statements and prepare reports.\nWHAT WE LOOK FOR\nA 2:1 degree, attention to detail, accounting interest and teamwork." },
  { id: "opp-fenwick-tech", role: "Software Engineering Graduate", org: "Fenwick Systems", location: "Bristol", type: "Graduate scheme", sector: "Technology", sponsorsVisa: true, closesOn: "2026-11-30",
    description: "Software Engineering Graduate\nBuild products used by millions.\nWHAT YOU WILL DO\nWrite and test code in TypeScript and Python, using Git and agile practices.\nWHAT WE LOOK FOR\nProblem solving, teamwork and a willingness to learn cloud tools such as AWS." },
  { id: "opp-holt-law", role: "Vacation Scheme", org: "Holt Ainsley LLP", location: "London", type: "Internship", sector: "Law", sponsorsVisa: false, closesOn: "2026-12-12",
    description: "Vacation Scheme\nTwo weeks across our corporate and disputes teams.\nWHAT YOU WILL DO\nCarry out legal research, draft notes and attend client meetings.\nWHAT WE LOOK FOR\nCommercial awareness, attention to detail and clear written communication." },
  { id: "opp-civic-policy", role: "Policy Graduate Programme", org: "Civic Futures Unit", location: "Leeds", type: "Graduate scheme", sector: "Public sector", sponsorsVisa: false, closesOn: "2026-11-27",
    description: "Policy Graduate Programme\nHelp shape public policy.\nWHAT YOU WILL DO\nResearch evidence, analyse data and write policy reports for stakeholders.\nWHAT WE LOOK FOR\nResearch skills, communication and an interest in public services." },
  { id: "opp-oakridge-marketing", role: "Marketing Summer Internship", org: "Oakridge Foods", location: "Reading", type: "Internship", sector: "Retail and FMCG", sponsorsVisa: false, closesOn: "2026-12-05",
    description: "Marketing Summer Internship\nSupport brand campaigns for household names.\nWHAT YOU WILL DO\nAnalyse sales data, plan social media content and track campaign engagement.\nWHAT WE LOOK FOR\nCreativity, commercial awareness and teamwork." },
  { id: "opp-northbank-spring", role: "Spring Insight Week", org: "Northbank", location: "London", type: "Spring week", sector: "Finance and banking", sponsorsVisa: true, closesOn: "2026-11-20",
    description: "Spring Insight Week\nDiscover banking across corporate, markets and risk.\nWHAT WE LOOK FOR\nCuriosity, teamwork and communication." },
  { id: "opp-calder-grad", role: "Investment Analyst Graduate", org: "Calder Capital", location: "Edinburgh", type: "Graduate scheme", sector: "Finance and banking", sponsorsVisa: true, closesOn: "2026-11-25",
    description: "Investment Analyst Graduate\nResearch companies and support portfolio managers.\nWHAT YOU WILL DO\nBuild valuation and financial modelling work in Excel, and write investment notes.\nWHAT WE LOOK FOR\nAnalytical skills, commercial awareness and interest in markets." },
];

export const DEMO_UNIVERSITY = { id: "uni-northfield", name: "University of Northfield", domain: "northfield.ac.uk" };

const CV_BASE = (v: number) => `Jordan Reed
jordan.reed@email.com · 07700 900123${v >= 5 ? " · linkedin.com/in/jordanreed" : ""}

EDUCATION
University of Northfield | BSc Economics | 2024 – 2027
Predicted 2:1. Modules: Econometrics, Corporate Finance, Behavioural Economics.
Ashfield Sixth Form College | A levels: Maths A*, Economics A, History A

EXPERIENCE
Summer Intern, Harlow Partners | June 2026 – August 2026
• ${v >= 6 ? "Supported the team with weekly reporting in Excel." : "Supported the team with weekly reporting in Excel."}
• ${v >= 4 ? "Researched 40 potential acquisition targets and presented a shortlist of 5 to a director." : "Was involved in research on acquisition targets."}
• ${v >= 5 ? "Drafted 3 client briefing notes that were sent with minimal edits." : "Responsible for writing client briefing notes."}
• Assisted with preparing pitch materials for client meetings.

Events Officer, Economics Society | September 2025 – present
• Helped organise events for the Economics Society.
• ${v >= 6 ? "Coordinated a careers panel with 3 City firms attended by 120 students." : "Helped with a careers panel with City firms."}
• Managed the society social media accounts and newsletter.
• ${v >= 5 ? "Negotiated sponsorship from two local businesses for the annual dinner." : "Helped get sponsorship for the annual dinner."}

Treasurer, Hiking Club | September 2024 – June 2025
• Raised £2,400 for a student-led charity week, beating the target by 20%.
• ${v >= 4 ? "Reconciled the club accounts each month and presented them to the committee." : "Responsible for the club accounts."}
• Planned weekend trips for members.

Customer Assistant, Greenway Supermarket | 2023 – 2024
• Served customers and handled cash at the till.
• ${v >= 6 ? "Trained 3 new colleagues on tills and stock systems." : "Helped train new colleagues."}
• Worked weekend shifts alongside my studies.

PROJECTS
• Built a model to forecast regional house prices.
• ${v >= 5 ? "Analysed 10 years of ONS data to compare regional wage growth for a group essay that scored 72%." : "Did a group essay on regional wage growth."}
• Wrote a report on the impact of interest rates on first-time buyers.

SKILLS
Excel (pivot tables, lookups), Python (pandas), Stata, PowerPoint
Languages: English (native), Spanish (conversational)
${v <= 4 ? "Hard-working team player with excellent communication skills." : ""}
${v <= 5 ? "References available on request." : ""}

INTERESTS
Hiking, chess, ${v <= 3 ? "I really enjoy reading about economics and very much like" : "reading about"} behavioural economics.`;

export const DEMO_CVS = [
  { version: 3, fileName: "Jordan_Reed_CV_v3.pdf", date: "2026-10-02T10:12:00Z", text: CV_BASE(3).replace("Helped organise events", "Helped organize events") },
  { version: 4, fileName: "Jordan_Reed_CV_v4.pdf", date: "2026-10-09T15:40:00Z", text: CV_BASE(4) },
  { version: 5, fileName: "Jordan_Reed_CV_v5.pdf", date: "2026-10-15T09:05:00Z", text: CV_BASE(5) },
  { version: 6, fileName: "Jordan_Reed_CV_v6.pdf", date: "2026-10-25T11:30:00Z", text: CV_BASE(6) },
];

export const DEMO_LETTER = `Jordan Reed · jordan.reed@email.com · 07700 900123

24 October 2026

Dear Hiring Manager,

I am applying for the Analyst Graduate Scheme at Northbank. As a final-year Economics student at the University of Northfield, I have spent the last two years building the analytical and communication skills your programme asks for.

During my summer internship at Harlow Partners, I built a weekly reporting tool in Excel that cut preparation time for a team of six. As Events Officer for the Economics Society, I organised twelve events, including a careers panel with three City firms, which strengthened my leadership and teamwork.

I am drawn to Northbank's rotation model because it would let me test my interest in corporate banking and risk before specialising. I have followed the bank's growth in mid-market lending closely and would value the chance to learn from its corporate banking team during the first rotation.

Thank you for considering my application. I would welcome the chance to discuss it further.

Yours faithfully,
Jordan Reed`;

// The sample student list. The dashboard's sample figures are in src/lib/analytics/sample.ts.
export const ADMIN_SAMPLE = {
  students: [
    { id: "2104821", course: "Economics", year: "Year 3", status: "Home", faculty: "Social sciences", score: 68, change: 19, lastActive: "Today", flag: "" },
    { id: "2209134", course: "Law", year: "Year 3", status: "International", faculty: "Social sciences", score: null, change: null, lastActive: "24 days ago", flag: "No CV yet" },
    { id: "2101776", course: "History", year: "Year 2", status: "Home", faculty: "Arts and humanities", score: 46, change: 1, lastActive: "3 days ago", flag: "Not improving" },
    { id: "2207365", course: "Physics", year: "Year 4", status: "International", faculty: "Sciences", score: 44, change: 6, lastActive: "Yesterday", flag: "Deadline soon" },
    { id: "2103390", course: "Mechanical Engineering", year: "Year 3", status: "Home", faculty: "Engineering", score: 81, change: 22, lastActive: "Today", flag: "" },
    { id: "2208812", course: "Business Management", year: "Year 2", status: "International", faculty: "Business", score: 74, change: 15, lastActive: "2 days ago", flag: "" },
    { id: "2102457", course: "English Literature", year: "Year 3", status: "Home", faculty: "Arts and humanities", score: 52, change: 0, lastActive: "31 days ago", flag: "Inactive" },
    { id: "2206649", course: "Computer Science", year: "Year 3", status: "International", faculty: "Sciences", score: 88, change: 9, lastActive: "Today", flag: "" },
  ],
};
