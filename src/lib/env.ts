// Startup checks for configuration. Runs once when the server boots (src/instrumentation.ts).

export type AppMode = "demo" | "supabase";

export interface EnvReport {
  mode: AppMode;
  errors: string[];
  warnings: string[];
}

const set = (k: string) => !!process.env[k]?.trim();

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
  return env.DEMO_MODE === "true" && !supabaseVarSet(env);
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
  } else if (production && env.DEMO_MODE !== "true") {
    // Demo mode keeps data in memory with fictional accounts. It must never run in production by accident.
    errors.push("No database is configured. Set the Supabase variables, or set DEMO_MODE=true to run the demo on purpose.");
  }
  if (!has("ANTHROPIC_API_KEY")) warnings.push("ANTHROPIC_API_KEY is not set, so CVs are scored by the rule engine.");
  if (env.TEST_LOGIN === "true") {
    if (production) warnings.push("TEST_LOGIN is set but ignored: one-click test sign-in only runs in development. Remove the variable.");
    else if (supabase) warnings.push("TEST_LOGIN is on: anyone who can open this development server's sign-in page can enter as the test student or test admin.");
  }
  if (production && !supabase && has("ANTHROPIC_API_KEY")) warnings.push("Demo mode with an Anthropic key: AI use is capped per day across all demo visitors.");

  return { mode: supabase ? "supabase" : "demo", errors, warnings };
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
