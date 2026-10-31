import type { Instrumentation } from "next";

// Runs once when the server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertEnv } = await import("./lib/env");
    const { log } = await import("./lib/log");
    const report = assertEnv();
    log("info", "startup", { mode: report.mode, warnings: report.warnings.length });
  }
}

// Every unhandled server error (pages, server actions, route handlers) is logged and alerted.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { alert } = await import("./lib/log");
  const err = error as Error & { digest?: string };
  await alert(`request-error:${context.routePath}`, `Server error on ${request.method} ${context.routePath}: ${err.message}`, {
    digest: err.digest,
    routeType: context.routeType,
    route: context.routePath,
    error: err,
  });
};
