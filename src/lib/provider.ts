import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import Anthropic from "@anthropic-ai/sdk";
import { analysisBudgetMs } from "@/lib/analysis/job-state";
import { alert, log } from "@/lib/log";

// OP-025: every provider call goes through `callProvider`, whichever feature makes it. It keeps the whole request inside
// the server's time limit, retries a bounded number of times and only what is worth retrying, stops calling a provider
// that is down, and meters what was used. Nothing here reads or changes what is sent or what comes back.

/** Longest one call may take. Also capped by what is left of the request's budget. */
export const REQUEST_TIMEOUT_MS = 45_000;
/** One try and one retry. A vote lost after that is what the 2-of-3 quorum is for. */
export const MAX_ATTEMPTS = 2;
/** A retry isn't started with less than this left: it couldn't finish, and the time is needed to save or fail cleanly. */
export const MIN_RETRY_MS = 5_000;
const MIN_CALL_MS = 50;
const BACKOFF_MS = 300;
/** Calls in flight per server instance. A long CV's chunks times three votes queue here rather than all leaving at once. */
export const MAX_PARALLEL_CALLS = 8;
export const BREAKER_THRESHOLD = 5;
export const BREAKER_OPEN_MS = 30_000;

export type FailureCode = "timeout" | "connection" | "rate_limited" | "overloaded" | "auth" | "budget" | "client" | "invalid_output" | "circuit_open" | "out_of_time" | "unknown";

/** A call that wasn't sent, because the provider is down or the request has run out of time. */
export class ProviderSkippedError extends Error {
  constructor(readonly code: "circuit_open" | "out_of_time") {
    super(code === "circuit_open" ? "provider calls paused after repeated failures" : "request out of time before the call");
  }
}

export function classifyFailure(e: unknown): FailureCode {
  if (e instanceof ProviderSkippedError) return e.code;
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
  if (e instanceof Anthropic.APIConnectionError) return "connection";
  if (e instanceof Anthropic.RateLimitError) return "rate_limited";
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return "auth";
  if (e instanceof Anthropic.APIError) {
    if (typeof e.status === "number" && e.status >= 500) return "overloaded";
    // A spent balance arrives as an ordinary 400 with no error type of its own: its wording is all there is to tell it apart.
    if (e.status === 400 && /credit balance|spend limit/i.test(e.message)) return "budget";
    return "client";
  }
  if (e instanceof Anthropic.AnthropicError || (e as Error)?.name === "ZodError" || e instanceof SyntaxError) return "invalid_output";
  return "unknown";
}

const RETRYABLE = new Set<FailureCode>(["timeout", "connection", "rate_limited", "overloaded"]);
/** What says the provider is down, as opposed to this one request being wrong. */
const OUTAGE = new Set<FailureCode>(["timeout", "connection", "overloaded", "auth", "budget"]);

/* ---------- prices ---------- */

/**
 * Estimates, for trends and cost per workflow: the provider's invoice is the record. $ per million tokens at the rates
 * published on 6 October 2026, first-party API. Update this and PRICING_VERSION when they change.
 */
export const PRICING_VERSION = "anthropic-2026-10-06";
const PRICES: Record<string, { input: number; output: number; over100k?: { input: number; output: number } }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, over100k: { input: 0.5, output: 2.5 } },
};

type Usage = { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null; iterations?: { type?: string }[] | null };

/** Millionths of a dollar. `complete` is false when the figure is only an estimate of an estimate: an unknown model, cached tokens, or a fallback. */
export function estimateCost(model: string, usage: Usage): { micros: number; complete: boolean } {
  const price = PRICES[model];
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const fellBack = usage.iterations?.some((i) => i.type === "fallback_message") ?? false;
  const cached = (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) > 0;
  if (!price) return { micros: 0, complete: false };
  const rate = price.over100k && input > 100_000 ? price.over100k : price;
  return { micros: Math.round(input * rate.input + output * rate.output), complete: !fellBack && !cached };
}

/* ---------- the request's budget and meter ---------- */

export interface ProviderMeter {
  calls: number;
  retries: number;
  input: number;
  output: number;
  costMicros: number;
  costComplete: boolean;
  /** How calls failed, by code. Counts only: no message, no content. */
  failures: Partial<Record<FailureCode, number>>;
}
export const newMeter = (): ProviderMeter => ({ calls: 0, retries: 0, input: 0, output: 0, costMicros: 0, costComplete: true, failures: {} });

const scope = new AsyncLocalStorage<{ deadline: number; meter: ProviderMeter }>();

/** Runs `fn` with provider work limited to `analysisBudgetMs()` from `startedAt`, and metered into `meter`. */
export const withProviderScope = <T>(meter: ProviderMeter, startedAt: number, fn: () => Promise<T>): Promise<T> => scope.run({ deadline: startedAt + analysisBudgetMs(), meter }, fn);

/** Output came back but can't be used: a refusal, a cut-off answer, or a schema failure the SDK didn't raise. */
export function noteInvalidOutput() {
  const m = scope.getStore()?.meter;
  if (m) m.failures.invalid_output = (m.failures.invalid_output ?? 0) + 1;
}

/* ---------- circuit breaker and concurrency, per server instance ---------- */

const state = { consecutiveOutages: 0, openUntil: 0, active: 0, waiting: [] as (() => void)[] };

export function resetProviderState() {
  state.consecutiveOutages = 0;
  state.openUntil = 0;
  state.active = 0;
  state.waiting = [];
}

const acquire = async () => {
  if (state.active >= MAX_PARALLEL_CALLS) await new Promise<void>((resolve) => state.waiting.push(resolve));
  else state.active++;
};
const release = () => {
  const next = state.waiting.shift();
  if (next) next();
  else state.active--;
};

function recordOutcome(code: FailureCode | null) {
  if (code === null) {
    state.consecutiveOutages = 0;
    state.openUntil = 0;
    return;
  }
  if (!OUTAGE.has(code)) return;
  state.consecutiveOutages++;
  if (state.consecutiveOutages >= BREAKER_THRESHOLD && Date.now() >= state.openUntil) {
    state.openUntil = Date.now() + BREAKER_OPEN_MS;
    void alert("ai-provider-outage", `Provider calls paused for ${BREAKER_OPEN_MS / 1000} seconds after ${state.consecutiveOutages} failures in a row (${code}). Students are seeing "try again".`);
  }
  if (code === "budget") void alert("ai-budget-exhausted", "The provider says the account's credit or spend limit has run out. AI features are failing until it's topped up.");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function retryAfterMs(e: unknown): number | null {
  const header = (e as { headers?: Headers })?.headers?.get?.("retry-after");
  const seconds = header ? Number(header) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

/**
 * Sends one provider request. `send` receives the options that bound it: the SDK's own retries are off, so that
 * MAX_ATTEMPTS is the true count and the budget can be checked between them. Rethrows the last failure unchanged.
 */
export async function callProvider<R extends { model?: string; usage?: Usage }>(send: (options: { timeout: number; maxRetries: 0 }) => Promise<R>): Promise<R> {
  const store = scope.getStore();
  const deadline = store?.deadline ?? Date.now() + analysisBudgetMs();
  const meter = store?.meter;
  for (let attempt = 1; ; attempt++) {
    await acquire();
    let failure: unknown;
    try {
      if (Date.now() < state.openUntil) throw new ProviderSkippedError("circuit_open");
      const remaining = deadline - Date.now();
      if (remaining < MIN_CALL_MS) throw new ProviderSkippedError("out_of_time");
      if (meter) meter.calls++;
      const res = await send({ timeout: Math.min(REQUEST_TIMEOUT_MS, remaining), maxRetries: 0 });
      recordOutcome(null);
      if (meter && res.usage) {
        const cost = estimateCost(res.model ?? "", res.usage);
        meter.input += res.usage.input_tokens ?? 0;
        meter.output += res.usage.output_tokens ?? 0;
        meter.costMicros += cost.micros;
        meter.costComplete &&= cost.complete;
      }
      return res;
    } catch (e) {
      failure = e;
    } finally {
      release();
    }
    const code = classifyFailure(failure);
    if (meter) meter.failures[code] = (meter.failures[code] ?? 0) + 1;
    if (!(failure instanceof ProviderSkippedError)) recordOutcome(code);
    if (attempt >= MAX_ATTEMPTS || !RETRYABLE.has(code)) throw failure;
    const wait = retryAfterMs(failure) ?? BACKOFF_MS * attempt + Math.random() * BACKOFF_MS;
    if (deadline - Date.now() - wait < MIN_RETRY_MS) {
      log("warn", "provider-retry-skipped", { code });
      throw failure;
    }
    if (meter) meter.retries++;
    await sleep(wait);
  }
}
