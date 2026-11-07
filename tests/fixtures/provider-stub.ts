// A simulated provider. Only `fetch` is replaced, so requests go through the real SDK and the real wrappers and none
// leaves the process: anything but the provider's address fails the test. No key that could work is ever set.
import assert from "node:assert/strict";

process.env.ANTHROPIC_API_KEY = "test-key-never-sent";
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "ALERT_WEBHOOK_URL", "ANALYSIS_BUDGET_MS"]) delete process.env[k];

export type Bullets = { id: number; text: string }[];
export interface Asked {
  model: string;
  /** The bullets, when this is a judge request; null for a writing request. */
  bullets: Bullets | null;
  call: number;
  signal?: AbortSignal | null;
}
export type Reply = (asked: Asked) => Response | Promise<Response>;

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
export const message = (model: string, text: string, stop_reason = "end_turn") => json({ id: "msg_test", type: "message", role: "assistant", model, content: [{ type: "text", text }], stop_reason, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 100 } });
export const apiError = (status: number, msg = "simulated failure", headers: Record<string, string> = {}) => json({ type: "error", error: { type: status === 429 ? "rate_limit_error" : status === 400 ? "invalid_request_error" : "api_error", message: msg } }, status, headers);

export const allBest: Reply = ({ model, bullets }) => message(model, JSON.stringify({ judgments: (bullets ?? []).map((b) => ({ id: b.id, result: "measured", verb: "strong", kind: "achievement", relevance: "high" })) }));
export const outage: Reply = () => apiError(503);
export const notJson: Reply = ({ model }) => message(model, "this is not json");
/** Never answers; gives up only when the SDK's timeout aborts it, like a hung connection. */
export const hang: Reply = ({ signal }) =>
  new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });

export const provider = { reply: outage as Reply, calls: 0, seen: [] as string[] };

globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  assert.match(String(url), /anthropic/, "only the provider is simulated; nothing else should be fetched");
  const body = JSON.parse(String(init!.body)) as { model: string; messages: { content: string }[] };
  const content = body.messages[0].content;
  provider.seen.push(content);
  const m = content.match(/<bullets>\n([\s\S]*)\n<\/bullets>/);
  return provider.reply({ model: body.model, bullets: m ? (JSON.parse(m[1]) as Bullets) : null, call: provider.calls++, signal: init?.signal });
}) as typeof fetch;

/** Every line logged while `fn` runs, as one string. */
export async function capture<T>(fn: () => Promise<T>): Promise<{ out: string; value: T }> {
  const lines: string[] = [];
  const saved = [console.log, console.warn, console.error];
  console.log = console.warn = console.error = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    const value = await fn();
    return { out: lines.join("\n"), value };
  } finally {
    [console.log, console.warn, console.error] = saved;
  }
}
