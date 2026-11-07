// Startup checks for configuration. Runs once when the server boots (src/instrumentation.ts).

export type AppMode = "demo" | "supabase";

export interface EnvReport {
  mode: AppMode;
  errors: string[];
  warnings: string[];
}

const set = (k: string) => !!process.env[k]?.trim();

/**
 * THE LIST: a production build on Vercel fails if any of these is missing. Which variables belong here is a founder
 * decision (docs/FOUNDER_DECISIONS.md FD-13). To change it, move a name between this list and OPTIONAL_IN_PRODUCTION
 * below; a name added here blocks the next production deploy until it is set in Vercel.
 *
 * The default is what the code can't run without. The first four: every route returns 500. The last two: the app runs,
 * but the retention job can't. Without CRON_SECRET all three jobs refuse to run; without RESEND_API_KEY no warning is
 * sent, and an inactive account is only deleted after a warning. Either way automatic deletion stops without a sound.
 */
export const REQUIRED_IN_PRODUCTION = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SITE_URL", "CRON_SECRET", "RESEND_API_KEY"] as const;

/** The code runs without these, in the way described. Missing ones are named at build and at boot, and block nothing. */
export const OPTIONAL_IN_PRODUCTION: Record<string, string> = {
  ANTHROPIC_API_KEY: "CVs are scored by the rule engine and there is no AI writing",
  EMAIL_FROM: "email goes from a default address on a domain with no recorded verification",
  SUPPORT_EMAIL: "pilot requests aren't emailed, there is no reply-to, and the legal pages show a placeholder",
  ALERT_WEBHOOK_URL: "alerts go only to logs, which Vercel keeps for a day or less",
  LEGAL_OPERATOR_NAME: "the legal pages show a placeholder",
  LEGAL_OPERATOR_ADDRESS: "the legal pages show a placeholder",
  LEGAL_COMPANY_NUMBER: "the legal pages show a placeholder",
  LEGAL_ICO_NUMBER: "the legal pages show a placeholder",
  LEGAL_CONTACT_EMAIL: "the legal pages show a placeholder",
};

/**
 * True for anything that serves real traffic. `process.env.NODE_ENV` is written as a literal on purpose: Next.js
 * replaces it at build time, so a production build stays production whatever NODE_ENV says when it starts. Vercel
 * preview deployments count too: they run with NODE_ENV=production and can share production's database.
 */
export function isProductionConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  return process.env.NODE_ENV === "production" || env.NODE_ENV === "production" || env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview";
}

const supabaseVarSet = (env: NodeJS.ProcessEnv) => !!env.NEXT_PUBLIC_SUPABASE_URL?.trim() || !!env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

/**
 * One-click test sign-in (a real session on a real test account, no email). Development only: in a production
 * configuration TEST_LOGIN does nothing, so a variable left on or copied between environments can't open it, and
 * there is deliberately no second variable that re-enables it.
 */
export function testLoginEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TEST_LOGIN === "true" && !isProductionConfig(env);
}

/**
 * Demo sign-in: fictional data held in memory, no database. In a production configuration it needs DEMO_MODE=true
 * and no Supabase variable at all, so losing or half-setting the database variables turns the app off rather than
 * turning it into an open demo. Enforced at every sign-in and session read, as well as by the boot check.
 */
export function demoLoginAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isProductionConfig(env)) return true;
  if (emptyPreview(env)) return true;
  return env.DEMO_MODE === "true" && !supabaseVarSet(env);
}

/**
 * A real Vercel preview given no variables: it holds no database and no secret, so the demo is all it can be, with
 * fictional data in memory. The platform sets VERCEL and VERCEL_ENV. A production deployment never matches, whatever
 * its variables, and a preview with a database variable, the service key or a paid key doesn't either: it has to
 * configure itself properly or say DEMO_MODE=true. TEST_LOGIN stays off here: a preview is still a production configuration.
 */
function emptyPreview(env: NodeJS.ProcessEnv): boolean {
  const has = (k: string) => !!env[k]?.trim();
  return env.VERCEL === "1" && env.VERCEL_ENV === "preview" && env.VERCEL_TARGET_ENV !== "production" && !supabaseVarSet(env) && !has("SUPABASE_SERVICE_ROLE_KEY") && !has("ANTHROPIC_API_KEY");
}

export function checkEnv(env: NodeJS.ProcessEnv = process.env): EnvReport {
  const has = (k: string) => !!env[k]?.trim();
  const production = isProductionConfig(env);
  const supabase = has("NEXT_PUBLIC_SUPABASE_URL") && has("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const errors: string[] = [];
  const warnings: string[] = [];

  if (has("NEXT_PUBLIC_SUPABASE_URL") !== has("NEXT_PUBLIC_SUPABASE_ANON_KEY")) {
    errors.push("Set both NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, or neither (demo mode).");
  }
  if (supabase) {
    if (!has("SUPABASE_SERVICE_ROLE_KEY")) errors.push("SUPABASE_SERVICE_ROLE_KEY is required with Supabase (scores and files are written by the server).");
    if (production && !has("NEXT_PUBLIC_SITE_URL")) errors.push("NEXT_PUBLIC_SITE_URL is required in production (sign-in emails link back to it).");
    if (production && env.NEXT_PUBLIC_SITE_URL && !env.NEXT_PUBLIC_SITE_URL.startsWith("https://")) errors.push("NEXT_PUBLIC_SITE_URL must start with https:// in production.");
    if (production && !has("CRON_SECRET")) warnings.push("CRON_SECRET is not set, so scheduled jobs are disabled: no deadline reminders, and inactive accounts are never warned or deleted as the privacy notice says.");
    if (!has("RESEND_API_KEY")) warnings.push("RESEND_API_KEY is not set, so emails are logged instead of sent. Inactive accounts are deleted only after a warning has been sent, so without it they are never deleted.");
  } else if (emptyPreview(env)) {
    warnings.push("Preview with no variables: running the demo, with fictional data in memory. It tests the build and the pages, not the database, sign-in email or migrations. Without DEMO_SECRET, a demo session may not survive a move between server instances.");
  } else if (production && env.DEMO_MODE !== "true") {
    // Demo mode keeps data in memory with fictional accounts. It must never run in production by accident.
    errors.push("No database is configured. Set the Supabase variables, or set DEMO_MODE=true to run the demo on purpose.");
  }
  if (!has("ANTHROPIC_API_KEY")) warnings.push("ANTHROPIC_API_KEY is not set, so CVs are scored by the rule engine.");
  if (env.TEST_LOGIN === "true") {
    if (production) warnings.push("TEST_LOGIN is set but ignored: one-click test sign-in only runs in development. Remove the variable.");
    else if (supabase) warnings.push("TEST_LOGIN is on: anyone who can open this development server's sign-in page can enter as the test student or test admin.");
  }
  if (has("SCORING_VOTES")) warnings.push("SCORING_VOTES is set but ignored: judging is fixed at three votes with a quorum of two, as part of the scoring contract. Remove the variable. If it was anything but 3, first judgments behave differently from before.");
  if (production && !supabase && has("ANTHROPIC_API_KEY")) warnings.push("Demo mode with an Anthropic key: AI use is capped per day across all demo visitors.");
  if (env.VERCEL_ENV === "production") for (const k of optionalMissing(env).filter((x) => x !== "ANTHROPIC_API_KEY")) warnings.push(`${k} is not set: ${OPTIONAL_IN_PRODUCTION[k]}.`);

  return { mode: supabase ? "supabase" : "demo", errors, warnings };
}

const optionalMissing = (env: NodeJS.ProcessEnv) => Object.keys(OPTIONAL_IN_PRODUCTION).filter((k) => !env[k]?.trim());

export interface BuildEnvReport {
  /** True only for a build going to production. Previews, CI and laptops are never stopped here. */
  gated: boolean;
  missing: string[];
  /**
   * What the boot check would refuse, which would otherwise be a deployment that answers every request with a 500. Its
   * advice about demo mode is left out: missing database variables are in `missing`, and demo mode can't pass this gate.
   */
  problems: string[];
  notSet: string[];
}

/** What a build can tell from the variables' names and shape. It reads no value out and it never prints one. */
export function checkBuildEnv(env: NodeJS.ProcessEnv = process.env): BuildEnvReport {
  const gated = env.VERCEL_ENV === "production" || env.VERCEL_TARGET_ENV === "production";
  if (!gated) return { gated, missing: [], problems: [], notSet: [] };
  return { gated, missing: REQUIRED_IN_PRODUCTION.filter((k) => !env[k]?.trim()), problems: checkEnv({ ...env, VERCEL_ENV: "production" }).errors.filter((e) => !/demo mode|DEMO_MODE/i.test(e)), notSet: optionalMissing(env) };
}

/**
 * Called by next.config.ts during `next build`. Throwing fails the build, so Vercel has nothing to promote. There is
 * deliberately no switch to turn this off, and DEMO_MODE doesn't get a production build past it. Names only.
 */
export function assertBuildEnv(env: NodeJS.ProcessEnv = process.env, out: Pick<Console, "warn" | "log"> = console): void {
  const report = checkBuildEnv(env);
  if (!report.gated) {
    if (env.VERCEL_ENV === "preview") out.log("[config] Preview build: not checked for production variables. With no variables at all it runs the demo.");
    return;
  }
  for (const k of report.notSet) out.warn(`[config] ${k} is not set: ${OPTIONAL_IN_PRODUCTION[k]}.`);
  if (report.missing.length || report.problems.length) {
    const lines = [...report.missing.map((k) => `${k} is missing`), ...report.problems];
    throw new Error(`Production build stopped: this deployment couldn't do its job. Add these in Vercel, then redeploy:\n- ${lines.join("\n- ")}\nThe required list is REQUIRED_IN_PRODUCTION in src/lib/env.ts.`);
  }
}

/** Throws with every problem listed if the configuration is unsafe to run. */
export function assertEnv(): EnvReport {
  const report = checkEnv();
  for (const w of report.warnings) console.warn(`[config] ${w}`);
  if (report.errors.length) {
    throw new Error(`Offerpath configuration problems:\n- ${report.errors.join("\n- ")}`);
  }
  return report;
}

export const featureFlags = {
  /** Advisers can open the CVs of students who have switched sharing on. Off until legal review. */
  adviserCvAccess: () => set("ADVISER_CV_ACCESS") && process.env.ADVISER_CV_ACCESS === "true",
  /** Testing phase only, never in a production configuration: one-click sign-in as a test student or test admin. */
  testLogin: () => testLoginEnabled(),
};
