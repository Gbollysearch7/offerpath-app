// Structured JSON logs (one line per event, easy to search in Vercel/Datadog/etc.) and alerts.
// Never log CV, letter or job ad text, or secrets: pass ids and counts, not content.

type Level = "info" | "warn" | "error";

const SECRET_KEYS = /key|token|secret|password|authorization|cookie|text|content|payload/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || value === undefined) return value;
  if (value instanceof Error) return { name: value.name, message: value.message.slice(0, 500), stack: value.stack?.split("\n").slice(0, 6).join("\n") };
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1)]));
  }
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  return value;
}

export function log(level: Level, event: string, data: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...(redact(data) as object) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/* ---------- alerts ---------- */

const g = globalThis as unknown as { __offerpathAlerts?: Map<string, number> };
const ALERT_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * Sends an alert to ALERT_WEBHOOK_URL (Slack, Microsoft Teams or Discord incoming webhook), at most
 * once per `key` every 10 minutes per server instance. Never throws.
 */
export async function alert(key: string, message: string, data: Record<string, unknown> = {}) {
  log("error", `alert:${key}`, { message, ...data });
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  const last = (g.__offerpathAlerts ??= new Map()).get(key) ?? 0;
  if (Date.now() - last < ALERT_COOLDOWN_MS) return;
  g.__offerpathAlerts.set(key, Date.now());
  const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";
  const text = `[Offerpath ${env}] ${message}`;
  try {
    // "text" works for Slack and Teams; "content" for Discord.
    await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(5000) });
  } catch (e) {
    log("warn", "alert-delivery-failed", { key, error: e });
  }
}
