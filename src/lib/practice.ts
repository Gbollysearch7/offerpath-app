// Content for the practice tools: interview questions, aptitude practice sets and role roadmaps.
// Pending review by a careers adviser (docs/CONTENT_REVIEW.md).

/* ---------------- interview practice ---------------- */

export interface InterviewQuestion {
  id: string;
  q: string;
  kind: "competency" | "motivation" | "commercial" | "technical";
  tip: string;
}

const GENERAL: InterviewQuestion[] = [
  { id: "g1", kind: "competency", q: "Tell me about a time you worked in a team to achieve a goal.", tip: "Pick one example. Say what you did, not just the team. End with the result." },
  { id: "g2", kind: "competency", q: "Describe a time you had to solve a difficult problem.", tip: "Explain how you worked out the cause before you jumped to the fix." },
  { id: "g3", kind: "competency", q: "Tell me about a time you led others.", tip: "Leadership can be informal: organising, persuading, setting direction." },
  { id: "g4", kind: "competency", q: "Give an example of when you managed several deadlines at once.", tip: "Show how you prioritised, and what you would do differently." },
  { id: "g5", kind: "competency", q: "Tell me about a time something went wrong. What did you learn?", tip: "Own the mistake, keep it short, and spend most of your answer on what you changed." },
  { id: "g6", kind: "competency", q: "Describe a time you persuaded someone to change their mind.", tip: "Explain how you understood their view first." },
  { id: "g7", kind: "motivation", q: "Why do you want to work for us?", tip: "Name something specific about this employer, then link it to your experience." },
  { id: "g8", kind: "motivation", q: "Where do you see yourself in five years?", tip: "Show ambition that fits the programme, not a plan to leave it." },
  { id: "g9", kind: "motivation", q: "What is your greatest strength, and how have you shown it?", tip: "Choose a strength the role needs and prove it with an example." },
];

const SECTOR_QUESTIONS: Record<string, InterviewQuestion[]> = {
  "Finance and banking": [
    { id: "f1", kind: "commercial", q: "Tell me about a recent deal or market story that interested you, and why.", tip: "Explain what happened, why it matters, and what it means for clients." },
    { id: "f2", kind: "technical", q: "How would you value a company?", tip: "Outline comparables, DCF and precedent transactions, and when you would use each." },
    { id: "f3", kind: "commercial", q: "What effect do interest rate rises have on a bank?", tip: "Think about lending margins, loan demand and bad debts." },
    { id: "f4", kind: "motivation", q: "Why investment banking rather than consulting or accounting?", tip: "Be honest about what you would enjoy day to day." },
  ],
  Consulting: [
    { id: "c1", kind: "commercial", q: "A coffee chain's profits have fallen 20%. How would you find out why?", tip: "Split profit into revenue and costs, then break each down. Say your structure out loud." },
    { id: "c2", kind: "technical", q: "Estimate how many electric car chargers London needs.", tip: "State your assumptions, round numbers, and sense-check the answer." },
    { id: "c3", kind: "motivation", q: "What do you think a consultant's typical week looks like?", tip: "Show you understand client work, travel and teamwork." },
  ],
  Technology: [
    { id: "t1", kind: "technical", q: "Talk me through a project you built. What would you do differently?", tip: "Cover the problem, your design choices and the trade-offs." },
    { id: "t2", kind: "technical", q: "How would you explain an API to a non-technical colleague?", tip: "Use a simple analogy, then check understanding." },
    { id: "t3", kind: "competency", q: "Tell me about a time you learned a new technology quickly.", tip: "Show your learning approach, not just the result." },
  ],
  Law: [
    { id: "l1", kind: "commercial", q: "Tell me about a recent business news story with legal implications.", tip: "Identify the legal issue and who it affects commercially." },
    { id: "l2", kind: "motivation", q: "Why commercial law, and why this firm?", tip: "Reference the firm's practice areas and a real interaction if you had one." },
    { id: "l3", kind: "competency", q: "Describe a time you had to pay close attention to detail.", tip: "Show how you checked your work and what accuracy achieved." },
  ],
  "Public sector": [
    { id: "p1", kind: "commercial", q: "Pick a public policy you would change and explain how.", tip: "Consider evidence, cost and who is affected." },
    { id: "p2", kind: "competency", q: "Tell me about a time you used evidence to make a decision.", tip: "Explain the evidence, how reliable it was, and the decision." },
  ],
};

export function interviewQuestions(sector: string): InterviewQuestion[] {
  return [...(SECTOR_QUESTIONS[sector] ?? []), ...GENERAL];
}

export const INTERVIEW_SECTORS = Object.keys(SECTOR_QUESTIONS);

/* Rule-based STAR feedback. Deterministic, so the same answer always gets the same feedback. */
export interface AnswerFeedback {
  score: number; // 0-10
  points: { ok: boolean; t: string }[];
  words: number;
}

export function starFeedback(answer: string, kind: InterviewQuestion["kind"]): AnswerFeedback {
  const text = answer.trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  const lower = text.toLowerCase();
  const I = (lower.match(/\b(i|i'm|i've|my|me)\b/g) ?? []).length;
  const we = (lower.match(/\b(we|our|us)\b/g) ?? []).length;
  const hasNumber = /\d|£|%/.test(text);
  const situation = /\b(when|during|while|at|in my|as (a|the))\b/.test(lower);
  const action = /\b(i (decided|organised|organized|built|led|spoke|created|suggested|analysed|analyzed|set up|took|asked|planned|made|wrote|designed|negotiated))\b/.test(lower);
  const result = /\b(result|as a result|which meant|so that|led to|outcome|achieved|increased|reduced|saved|won|grew|improved|learned|learnt)\b/.test(lower);
  const points: AnswerFeedback["points"] = [];
  if (kind === "competency") {
    points.push({ ok: situation, t: situation ? "Sets the scene (situation)" : "Start with a short situation: where, when, what was at stake" });
    points.push({ ok: action, t: action ? "Explains what you did (action)" : 'Say clearly what you did: "I organised…", "I suggested…"' });
    points.push({ ok: result, t: result ? "Ends with a result" : "Finish with the result, and what you learned" });
    points.push({ ok: I >= we, t: I >= we ? "Focuses on your contribution" : 'Lots of "we": interviewers need to hear what you did' });
  } else {
    points.push({ ok: words > 0 && /\bbecause\b|\bwhich\b|\bso\b/.test(lower), t: /\bbecause\b|\bwhich\b|\bso\b/.test(lower) ? "Gives reasons, not just claims" : 'Back up each point with a reason ("because…")' });
    points.push({ ok: I > 0, t: I > 0 ? "Links it to you" : "Connect your answer to your own experience" });
  }
  points.push({ ok: hasNumber, t: hasNumber ? "Includes specifics or numbers" : "Add a specific detail or number to make it memorable" });
  const goodLength = words >= 120 && words <= 320;
  points.push({ ok: goodLength, t: words < 120 ? `Short (${words} words): aim for about 150 to 300, roughly two minutes spoken` : words > 320 ? `Long (${words} words): aim for about 150 to 300` : `Good length (${words} words)` });
  const score = Math.round((points.filter((p) => p.ok).length / points.length) * 10);
  return { score, points, words };
}

/* ---------------- aptitude practice ---------------- */

export interface AptitudeQuestion {
  id: string;
  prompt: string;
  context?: string;
  options: string[];
  answer: number; // index into options
  explain: string;
}

export const APTITUDE_SETS: Record<"numerical" | "verbal" | "logical", { title: string; minutes: number; intro: string; questions: AptitudeQuestion[] }> = {
  numerical: {
    title: "Numerical reasoning",
    minutes: 8,
    intro: "Use the data to answer each question. A calculator is allowed in most real tests.",
    questions: [
      { id: "n1", context: "A firm's revenue was £2.4m in 2024 and £2.7m in 2025.", prompt: "What was the percentage increase?", options: ["10.0%", "11.1%", "12.5%", "13.3%"], answer: 2, explain: "(2.7 − 2.4) ÷ 2.4 = 0.125, so 12.5%." },
      { id: "n2", context: "A team of 6 completes 180 reports in 5 days.", prompt: "How many reports does one person complete per day, on average?", options: ["5", "6", "30", "36"], answer: 1, explain: "180 ÷ 5 days = 36 a day; 36 ÷ 6 people = 6 each." },
      { id: "n3", context: "A product costs £80 before VAT at 20%.", prompt: "What is the price including VAT?", options: ["£84", "£96", "£100", "£16"], answer: 1, explain: "£80 × 1.2 = £96." },
      { id: "n4", context: "Exchange rate: £1 = €1.15.", prompt: "How many pounds is €460?", options: ["£380", "£400", "£410", "£529"], answer: 1, explain: "460 ÷ 1.15 = 400." },
      { id: "n5", context: "Sales: Q1 £120k, Q2 £150k, Q3 £135k, Q4 £195k.", prompt: "What was the average quarterly sales figure?", options: ["£140k", "£145k", "£150k", "£155k"], answer: 2, explain: "Total £600k ÷ 4 = £150k." },
      { id: "n6", context: "A share price falls 20%, then rises 25%.", prompt: "Compared with the start, the price is now…", options: ["5% higher", "The same", "5% lower", "2.5% higher"], answer: 1, explain: "0.8 × 1.25 = 1.00, so it's back where it started." },
    ],
  },
  verbal: {
    title: "Verbal reasoning",
    minutes: 6,
    intro: "Read the passage. Answer True if it follows from the passage, False if the passage contradicts it, or Cannot say if there isn't enough information.",
    questions: [
      { id: "v1", context: "Graduate schemes at the bank open in September and most close by December. Applications are reviewed in the order they arrive, and some schemes close early once enough strong applicants have been found.", prompt: "Applying in November guarantees your application will be reviewed.", options: ["True", "False", "Cannot say"], answer: 2, explain: "Some schemes close early, so it depends on the scheme. The passage doesn't say." },
      { id: "v2", context: "Graduate schemes at the bank open in September and most close by December. Applications are reviewed in the order they arrive, and some schemes close early once enough strong applicants have been found.", prompt: "Applications are reviewed in the order they are received.", options: ["True", "False", "Cannot say"], answer: 0, explain: "Stated directly in the passage." },
      { id: "v3", context: "The council's recycling rate rose from 38% to 46% after it introduced weekly food waste collections. Over the same period, general waste collections moved from weekly to fortnightly.", prompt: "Food waste collections were the only cause of the rise in recycling.", options: ["True", "False", "Cannot say"], answer: 2, explain: "Another change happened at the same time, so we can't attribute the rise to one cause." },
      { id: "v4", context: "The council's recycling rate rose from 38% to 46% after it introduced weekly food waste collections. Over the same period, general waste collections moved from weekly to fortnightly.", prompt: "General waste is now collected less often than before.", options: ["True", "False", "Cannot say"], answer: 0, explain: "It moved from weekly to fortnightly." },
      { id: "v5", context: "Remote workers at the firm reported higher satisfaction in a 2025 survey. However, only 40% of staff responded, and responses were optional.", prompt: "All remote workers at the firm are more satisfied than office workers.", options: ["True", "False", "Cannot say"], answer: 2, explain: "Only 40% responded voluntarily, and 'all' goes beyond what the survey shows." },
    ],
  },
  logical: {
    title: "Logical reasoning",
    minutes: 5,
    intro: "Find the rule, then choose what comes next.",
    questions: [
      { id: "l1", prompt: "2, 6, 12, 20, 30, ?", options: ["36", "40", "42", "44"], answer: 2, explain: "Differences go up by 2 each time (4, 6, 8, 10, 12), so 30 + 12 = 42." },
      { id: "l2", prompt: "3, 9, 27, 81, ?", options: ["162", "216", "243", "324"], answer: 2, explain: "Each number is multiplied by 3." },
      { id: "l3", prompt: "A, C, F, J, O, ?", options: ["S", "T", "U", "V"], answer: 2, explain: "Gaps grow by one letter each time: +2, +3, +4, +5, +6. O + 6 = U." },
      { id: "l4", prompt: "All analysts use Excel. Some analysts use Python. Which must be true?", options: ["Everyone who uses Python is an analyst", "Some people who use Excel use Python", "No analysts use only Excel", "All Python users use Excel"], answer: 1, explain: "The analysts who use Python also use Excel, so some Excel users use Python." },
      { id: "l5", prompt: "1, 1, 2, 3, 5, 8, ?", options: ["11", "12", "13", "15"], answer: 2, explain: "Each number is the sum of the previous two (Fibonacci)." },
    ],
  },
};

/* ---------------- role roadmaps ---------------- */

export interface RoadmapStep {
  stage: "first" | "penultimate" | "final" | "graduate";
  when: string;
  title: string;
  items: string[];
}

const COMMON_LINKS = "Use Offerpath to score your CV, tailor it to each role and track deadlines.";

export const ROADMAPS: Record<string, { summary: string; steps: RoadmapStep[] }> = {
  "Finance and banking": {
    summary: "Banks recruit early. Most graduate hires come through summer internships, and most internships come through spring weeks.",
    steps: [
      { stage: "first", when: "First year, October to January", title: "Spring weeks", items: ["Apply to spring weeks and insight days (many close by January).", "Join the finance or investment society and go to employer events.", "Start following markets: one news story a day."] },
      { stage: "penultimate", when: "Second year, September to December", title: "Summer internships", items: ["Apply early: applications are often reviewed as they arrive.", "Practise numerical tests and situational judgement tests.", "Prepare a market story and know your CV inside out."] },
      { stage: "final", when: "Final year, September to December", title: "Graduate schemes", items: ["Many offers go to returning interns; apply widely if you didn't intern.", "Prepare for assessment centres: group exercises and case studies.", COMMON_LINKS] },
      { stage: "graduate", when: "After graduating", title: "Off-cycle and direct entry", items: ["Look for off-cycle internships and analyst roles at smaller firms.", "Consider related routes: audit, corporate finance, fintech."] },
    ],
  },
  Consulting: {
    summary: "Consulting firms value structured thinking. Case interviews are the main hurdle, so start practising early.",
    steps: [
      { stage: "first", when: "First year", title: "Explore", items: ["Join the consulting society and enter case competitions.", "Take on a leadership role you can talk about."] },
      { stage: "penultimate", when: "Second year, autumn", title: "Summer internships", items: ["Apply to internships (deadlines October to January).", "Practise one case a week with a partner.", "Learn basic Excel and PowerPoint well."] },
      { stage: "final", when: "Final year, autumn", title: "Graduate roles", items: ["Apply to analyst roles; prepare for numerical tests and case interviews.", COMMON_LINKS] },
      { stage: "graduate", when: "After graduating", title: "Other routes in", items: ["Consider in-house strategy teams, boutique firms and public sector consulting."] },
    ],
  },
  Technology: {
    summary: "Tech hires on skills you can show. A portfolio of projects matters as much as your CV.",
    steps: [
      { stage: "first", when: "First year", title: "Build", items: ["Build small projects and put them on GitHub.", "Go to hackathons and tech society events."] },
      { stage: "penultimate", when: "Second year", title: "Internships and placements", items: ["Apply for summer internships and year-long placements (autumn to spring).", "Practise coding interview questions regularly."] },
      { stage: "final", when: "Final year", title: "Graduate roles", items: ["Apply to graduate schemes and direct junior roles; many hire year-round.", COMMON_LINKS] },
      { stage: "graduate", when: "After graduating", title: "Keep shipping", items: ["Contribute to open source, and consider startups and smaller firms."] },
    ],
  },
  Law: {
    summary: "Commercial law firms recruit trainees about two years ahead, mostly through vacation schemes.",
    steps: [
      { stage: "first", when: "First year", title: "Open days and first-year schemes", items: ["Apply to first-year open days and insight schemes.", "Read business news to build commercial awareness."] },
      { stage: "penultimate", when: "Second year (law) or final year (non-law)", title: "Vacation schemes", items: ["Apply to vacation schemes (deadlines mostly October to January).", "Prepare for the Watson Glaser test and written exercises."] },
      { stage: "final", when: "Final year", title: "Training contracts and the SQE", items: ["Apply for training contracts; research how firms fund the SQE.", COMMON_LINKS] },
      { stage: "graduate", when: "After graduating", title: "Paralegal and SQE routes", items: ["Paralegal work can count towards qualifying work experience."] },
    ],
  },
  "Public sector": {
    summary: "Public sector schemes value evidence, impact and motivation for public service.",
    steps: [
      { stage: "first", when: "First year", title: "Get involved", items: ["Volunteer or take part in student representation.", "Look for summer internships for underrepresented groups."] },
      { stage: "penultimate", when: "Second year", title: "Internships", items: ["Apply to public sector summer internships and policy placements."] },
      { stage: "final", when: "Final year", title: "Graduate schemes", items: ["Apply to graduate schemes such as policy and analytical streams; practise situational judgement tests.", COMMON_LINKS] },
      { stage: "graduate", when: "After graduating", title: "Direct entry", items: ["Look for entry-level roles in local government, regulators and charities."] },
    ],
  },
};
