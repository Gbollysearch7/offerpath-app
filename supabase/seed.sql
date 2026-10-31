-- Seed data: one fictional partner university and sample opportunities. Generated from src/lib/seed-data.ts.
insert into public.universities (name, domain) values ('University of Northfield', 'northfield.ac.uk') on conflict (domain) do nothing;

insert into public.opportunities (id, role, org, location, type, sector, sponsors_visa, closes_on, description) values
  ('opp-northbank-analyst', 'Analyst Graduate Scheme', 'Northbank', 'London', 'Graduate scheme', 'Finance and banking', true, '2026-11-14', 'Analyst Graduate Scheme
Join our two-year Analyst programme, rotating across corporate banking, risk and strategy teams.
WHAT YOU WILL DO
Build financial modelling tools to support client pitches and due diligence.
Analyse data in Excel and SQL, and present findings to senior colleagues.
Practise stakeholder management across teams and with clients.
WHAT WE LOOK FOR
A 2:1 degree in any subject, strong commercial awareness and clear communication.
Experience with Power BI or similar tools is a plus. Teamwork and leadership in student societies welcome.
You will use financial modelling and SQL every day, and stakeholder management is central to the role.'),
  ('opp-calder-risk', 'Risk Summer Internship', 'Calder Capital', 'Edinburgh', 'Internship', 'Finance and banking', true, '2026-11-18', 'Risk Summer Internship
A ten-week internship in our market and credit risk teams.
WHAT YOU WILL DO
Monitor portfolio risk and prepare daily reports in Excel.
Support stress testing and scenario analysis using Python.
WHAT WE LOOK FOR
Analytical thinking, attention to detail and an interest in markets. Python or VBA experience is a plus.'),
  ('opp-brightwater-placement', 'Industrial Placement, Finance', 'Brightwater Energy', 'Manchester', 'Placement', 'Finance and banking', false, '2026-11-21', 'Industrial Placement, Finance
A 12-month placement in our finance team.
WHAT YOU WILL DO
Support month-end reporting, budgeting and forecasting.
Work with stakeholders across the business to improve reporting.
WHAT WE LOOK FOR
Strong Excel skills, communication and teamwork.'),
  ('opp-ashby-consulting', 'Consulting Summer Internship', 'Ashby & Co', 'London', 'Internship', 'Consulting', true, '2026-11-22', 'Consulting Summer Internship
Work on real client projects alongside our consultants.
WHAT YOU WILL DO
Research markets, analyse data and build recommendations for clients.
Present findings in PowerPoint to client stakeholders.
WHAT WE LOOK FOR
Problem solving, commercial awareness, teamwork and clear communication.'),
  ('opp-harlow-spring', 'Spring Week, Markets', 'Harlow Partners', 'London', 'Spring week', 'Finance and banking', false, '2026-12-03', 'Spring Week, Markets
A week-long insight programme for first-year students.
WHAT YOU WILL DO
Shadow traders and analysts, and take part in a markets challenge.
WHAT WE LOOK FOR
Curiosity about markets, teamwork and communication.'),
  ('opp-mercer-accountant', 'Graduate Accountant', 'Mercer Lane', 'Birmingham', 'Graduate scheme', 'Finance and banking', true, '2026-12-09', 'Graduate Accountant
Train towards the ACA qualification while working in audit and tax.
WHAT YOU WILL DO
Support audit engagements, review financial statements and prepare reports.
WHAT WE LOOK FOR
A 2:1 degree, attention to detail, accounting interest and teamwork.'),
  ('opp-fenwick-tech', 'Software Engineering Graduate', 'Fenwick Systems', 'Bristol', 'Graduate scheme', 'Technology', true, '2026-11-30', 'Software Engineering Graduate
Build products used by millions.
WHAT YOU WILL DO
Write and test code in TypeScript and Python, using Git and agile practices.
WHAT WE LOOK FOR
Problem solving, teamwork and a willingness to learn cloud tools such as AWS.'),
  ('opp-holt-law', 'Vacation Scheme', 'Holt Ainsley LLP', 'London', 'Internship', 'Law', false, '2026-12-12', 'Vacation Scheme
Two weeks across our corporate and disputes teams.
WHAT YOU WILL DO
Carry out legal research, draft notes and attend client meetings.
WHAT WE LOOK FOR
Commercial awareness, attention to detail and clear written communication.'),
  ('opp-civic-policy', 'Policy Graduate Programme', 'Civic Futures Unit', 'Leeds', 'Graduate scheme', 'Public sector', false, '2026-11-27', 'Policy Graduate Programme
Help shape public policy.
WHAT YOU WILL DO
Research evidence, analyse data and write policy reports for stakeholders.
WHAT WE LOOK FOR
Research skills, communication and an interest in public services.'),
  ('opp-oakridge-marketing', 'Marketing Summer Internship', 'Oakridge Foods', 'Reading', 'Internship', 'Retail and FMCG', false, '2026-12-05', 'Marketing Summer Internship
Support brand campaigns for household names.
WHAT YOU WILL DO
Analyse sales data, plan social media content and track campaign engagement.
WHAT WE LOOK FOR
Creativity, commercial awareness and teamwork.'),
  ('opp-northbank-spring', 'Spring Insight Week', 'Northbank', 'London', 'Spring week', 'Finance and banking', true, '2026-11-20', 'Spring Insight Week
Discover banking across corporate, markets and risk.
WHAT WE LOOK FOR
Curiosity, teamwork and communication.'),
  ('opp-calder-grad', 'Investment Analyst Graduate', 'Calder Capital', 'Edinburgh', 'Graduate scheme', 'Finance and banking', true, '2026-11-25', 'Investment Analyst Graduate
Research companies and support portfolio managers.
WHAT YOU WILL DO
Build valuation and financial modelling work in Excel, and write investment notes.
WHAT WE LOOK FOR
Analytical skills, commercial awareness and interest in markets.')
on conflict (id) do update set role = excluded.role, org = excluded.org, location = excluded.location, type = excluded.type, sector = excluded.sector, sponsors_visa = excluded.sponsors_visa, closes_on = excluded.closes_on, description = excluded.description;
