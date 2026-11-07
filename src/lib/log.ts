// Structured JSON logs (one line per event, easy to search in Vercel/Datadog/etc.) and alerts.
// Never log CV, letter or job ad text, or secrets: pass ids and counts, not content.

type Level = "info" | "warn" | "error";

/** Fields whose value is never logged, by name: secrets, and anything that holds or names a student's document. */
const SECRET_KEYS = /key|token|secret|password|authorization|cookie|text|content|payload|prompt|body|html|bullet|letter|draft|advert|jobad|\bcv|note|email|fullname|filename/i;

// Values that are never logged wherever they turn up, including inside an error's message.
const SECRET_VALUES: [RegExp, string][] = [
  [/\bsk-[a-z0-9_-]{6,}/gi, "[redacted-key]"], // Anthropic and similar
  [/\bre_[a-z0-9_]{8,}/gi, "[redacted-key]"], // Resend
  [/\bsb_(?:secret|publishable)_[a-z0-9_-]{6,}/gi, "[redacted-key]"], // Supabase
  [/\beyJ[a-z0-9_-]+\.[a-z0-9_-]+(?:\.[a-z0-9_-]+)?/gi, "[redacted-token]"], // JWTs: Supabase keys and sessions
  [/\bbearer\s+\S+/gi, "Bearer [redacted]"],
  [/[^\s"'<>@]+@[^\s"'<>@]+\.[^\s"'<>@]+/g, "[redacted-email]"],
];
export function scrub(text: string): string {
  return SECRET_VALUES.reduce((t, [re, to]) => t.replace(re, to), text);
}

/**
 * An error's message goes to logs and to the alert webhook, so it must not quote what was being processed. A parse
 * failure does exactly that: JSON.parse puts the start of its input in the message, and the input can be model
 * output or document text. So those messages are dropped, and anything else in quotes is blanked.
 */
const PARSE_ERROR = /is not valid JSON|unexpected (token|end|non-whitespace)|in JSON at|structured output|failed to parse/i;
export function safeErrorMessage(message: string): string {
  if (PARSE_ERROR.test(message)) return "[parse error: message omitted because it can quote its input]";
  return scrub(message)
    .replace(/"[^"]{25,}"/g, '"[redacted]"')
    .slice(0, 300);
}

function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  if (typeof value === "string") return scrub(value.length > 500 ? `${value.slice(0, 500)}…` : value);
  if (typeof value !== "object") return value;
  // Anything deeper is dropped, not passed through: past this point nothing would be redacted. Also ends circular references.
  if (depth > 4) return "[truncated]";
  if (value instanceof Error) {
    // Stack frames only: the stack's first lines repeat the message, which has its own rules above.
    const frames = value.stack?.split("\n").filter((l) => /^\s+at /.test(l)).slice(0, 5).join("\n");
    return { name: value.name, message: safeErrorMessage(value.message), stack: frames ? scrub(frames) : undefined };
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1)]));
}

export function log(level: Level, event: string, data: Record<string, unknown> = {}) {
  let line: string;
  try {
    line = JSON.stringify({ level, event, time: new Date().toISOString(), ...(redact(data) as object) });
  } catch {
    // Logging runs inside error handling, so it must never be the thing that throws.
    line = JSON.stringify({ level, event, time: new Date().toISOString(), logError: "unserialisable data" });
  }
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
export async function alert(key: string, rawMessage: string, data: Record<string, unknown> = {}) {
  // Callers build this from error messages, and it leaves for a third-party chat service below.
  const message = safeErrorMessage(rawMessage);
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
