// Words a general dictionary lacks but a CV uses correctly: tools, qualifications, financial products,
// employers. Checked case-insensitively, so "kubernetes" and "Kubernetes" both pass. This is one list for
// every student: a word is only added because it is correct for everyone, never because one student
// dismissed a suggestion (that is OP-008). Written by an engineer and not yet reviewed by an adviser.
//
// Bump the version when the list changes: a saved report records which list it was checked against.
export const TERMINOLOGY_VERSION = "terminology-2026-11-06.1";

const TECHNOLOGY = `
  agile airflow ansible api apis auth autoscaling backend backends blockchain bugfix bugfixes chatbot chatbots
  ci cd cloudformation codebase codebases cron css cybersecurity dashboarding datadog dataset datasets
  dbt devops devsecops django docker dockerfile dockerised elasticsearch etl fastapi figma firebase firmware
  flask frontend frontends fullstack gcp git github gitlab golang grafana graphql hadoop helm hubspot html
  http https javascript jenkins jira jquery json jupyter kafka keras kotlin kubectl kubernetes laravel linux
  llm llms looker matlab microservice microservices middleware mlops mongodb mysql nginx nodejs nosql numpy
  oauth observability onboarded onboarding opencv pipelining plotly postgres postgresql powerbi prometheus
  pyspark pytest python pytorch rabbitmq redis refactor refactored refactoring refactors regex repo repos
  rstudio saas salesforce scikit scrum seaborn serverless sharepoint snowflake solidity springboot sql sqlite
  stakeholder stakeholders tableau tensorflow terraform timeseries typescript ubuntu uipath unix upskill
  upskilled upskilling usability webhook webhooks webpack workflow workflows wireframe wireframes wireframing
  xcode yaml
`;

const BUSINESS_AND_FINANCE = `
  acca aim amortisation arbitrage basel bloomberg bps capex cfa cima cisi collateralised crm dcf derivatives
  ebit ebitda esg etf etfs eurobond eurobonds fca fintech frs ftse fx gilt gilts hedging ifrs insurtech ipo
  ipos isa isas kpi kpis lbo libor lifecycle m&a mifid mis mortgages nasdaq opex pra refinancing regtech
  remortgage remortgages roe roi sipp sipps sme smes sonia swaption swaptions underwriter underwriters upsell
  upselling valuations vat
`;

const EMPLOYERS_AND_BODIES = `
  accenture airbnb asos barclays bbc bcg bupa capgemini deloitte deutsche ernst experian goldman hsbc ibm
  infosys jpmorgan kpmg linkedin mckinsey microsoft monzo morrisons natwest nhs ofcom ofgem ofsted oxfam
  pwc revolut sainsbury sainsburys santander sap schroders siemens starling tesco unicef unilever wise
`;

const WORKPLACE_AND_FIELD = `
  authenticator benchmarked benchmarking cashflow cashflows chatbot cybercrime datacentre datastore decarbonisation
  decrypted ecommerce geospatial geotargeting geotechnical helpdesk hyperparameter hyperparameters infographic
  infographics insourcing lookups mentee mentees neurodivergent neurodiversity offboarding omnichannel overfitting
  pharmacovigilance phlebotomy preprocessing prototyped regressor reshoring reskilling retarget retargeting roadmap
  roadmaps rollout rollouts scalable scaleup scaleups signoff subteam touchpoint touchpoints tradeoff tradeoffs
  triaging vlog walkthrough walkthroughs
`;

const QUALIFICATIONS_AND_DEGREES = `
  acma beng btec cipd cipfa cisco comptia gcse gcses iosh lpc meng mres msc phd pgce pgdip prince2 sqe
  ucas undergrad
`;

export const TERMINOLOGY: ReadonlySet<string> = new Set(
  [TECHNOLOGY, BUSINESS_AND_FINANCE, EMPLOYERS_AND_BODIES, WORKPLACE_AND_FIELD, QUALIFICATIONS_AND_DEGREES].flatMap((list) => list.trim().split(/\s+/)),
);
