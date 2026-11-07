import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";

// Runs real server actions and pages outside Next's server, with just enough of its request context for cookies(),
// headers() and revalidatePath() to work. Nothing about the code under test is mocked; a test that needs a database
// supplies no credentials, so reaching for one fails loudly.

export interface FakeCookies {
  jar: Map<string, string>;
  /** The options each cookie was last set with. */
  options: Map<string, Record<string, unknown>>;
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export function requestScope(initial: Record<string, string> = {}): FakeCookies {
  const jar = new Map(Object.entries(initial));
  const options = new Map<string, Record<string, unknown>>();
  const store = {
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    has: (name: string) => jar.has(name),
    set: (name: string, value: string, opts: Record<string, unknown> = {}) => {
      jar.set(name, value);
      options.set(name, opts);
      return store;
    },
    delete: (name: string) => {
      jar.delete(name);
      return store;
    },
  };
  const work = { route: "/test", page: "/test", forceStatic: false, dynamicShouldError: false, isStaticGeneration: false, afterContext: {}, incrementalCache: {}, pendingRevalidatedPaths: [], pendingRevalidateWrites: [] };
  const unit = { type: "request", phase: "action", cookies: store, mutableCookies: store, userspaceMutableCookies: store, headers: new Headers(), url: { pathname: "/test", search: "" }, implicitTags: { tags: [], expirationsByCacheKind: new Map() } };
  return {
    jar,
    options,
    run: <T>(fn: () => Promise<T>) => (workAsyncStorage as { run: (s: unknown, f: () => unknown) => unknown }).run(work, () => (workUnitAsyncStorage as { run: (s: unknown, f: () => unknown) => unknown }).run(unit, fn)) as Promise<T>,
  };
}

/** Where a redirect() was going, or null if `e` isn't Next's redirect. */
export function redirectTarget(e: unknown): string | null {
  const digest = (e as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT") ? digest.split(";")[2] : null;
}

/** Awaits an action that is expected to redirect, and returns where to. */
export async function redirectOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    const to = redirectTarget(e);
    if (to !== null) return to;
    throw e;
  }
  throw new Error("expected a redirect");
}

/** Sets environment variables for a test and restores them after. `undefined` removes one. */
export async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const env = process.env as Record<string, string | undefined>;
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  }
}
