// Startup checks for configuration. Runs once when the server boots (src/instrumentation.ts).

export type AppMode = "demo" | "supabase";

export interface EnvReport {
  mode: AppMode;
  errors: string[];
  warnings: string[];
}

const set = (k: string) => !!process.env[k]?.trim();

export function checkEnv(env: NodeJS.ProcessEnv = process.env): EnvReport {
  const has = (k: string) => !!env[k]?.trim();
  const production = env.NODE_ENV === "production";
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
    if (production && !has("CRON_SECRET")) warnings.push("CRON_SECRET is not set, so scheduled jobs (deadline reminders) are disabled.");
    if (!has("RESEND_API_KEY")) warnings.push("RESEND_API_KEY is not set, so reminder emails are logged instead of sent.");
  } else if (production && env.DEMO_MODE !== "true") {
    // Demo mode keeps data in memory with fictional accounts. It must never run in production by accident.
    errors.push("No database is configured. Set the Supabase variables, or set DEMO_MODE=true to run the demo on purpose.");
  }
  if (!has("ANTHROPIC_API_KEY")) warnings.push("ANTHROPIC_API_KEY is not set, so CVs are scored by the rule engine.");
  if (supabase && env.TEST_LOGIN === "true") warnings.push("TEST_LOGIN is on: anyone who can open the sign-in page can enter as the test student or test admin. Turn it off before real students use the app.");
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
  /** Testing phase only: one-click sign-in as a test student or test admin, no email needed. */
  testLogin: () => process.env.TEST_LOGIN === "true",
};
