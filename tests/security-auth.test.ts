// OP-026: no demo or testing-phase sign-in works in a production configuration. These run the real server actions,
// the real session lookup and the real sign-in page inside a request context; no credentials exist, so an action that
// got past its gate would fail on the missing service key, not return a redirect.
import "./fixtures/next-server-shim";
import assert from "node:assert/strict";
import { test } from "node:test";
import { signInWithEmail, signInWithUniversity, testSignIn } from "@/app/actions/auth";
import SignInPage from "@/app/sign-in/page";
import { signDemoSession } from "@/lib/demo-session";
import { checkEnv, demoLoginAllowed, isProductionConfig, testLoginEnabled } from "@/lib/env";
import { DEMO_COOKIE, getRepo } from "@/lib/session";
import { redirectOf, requestScope, withEnv } from "./fixtures/request-scope";

const NO_DB = { NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: undefined };
// A database that isn't there: nothing here may reach the network, and with no session nothing does.
const DB = { NEXT_PUBLIC_SUPABASE_URL: "https://op026-no-such-project.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: undefined };
const CLEAN = { DEMO_MODE: undefined, VERCEL_ENV: undefined, TEST_LOGIN: undefined, NEXT_PUBLIC_SITE_URL: undefined };
const env = (o: Record<string, string | undefined>) => o as unknown as NodeJS.ProcessEnv;
const form = (o: Record<string, string | undefined> = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) if (v !== undefined) f.set(k, v);
  return f;
};
/** Every string in a server-rendered element tree, without rendering client components. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  const props = (node as { props?: { children?: unknown } }).props;
  return props ? textOf(props.children) : "";
}
const signInPageText = (scope: ReturnType<typeof requestScope>) => scope.run(async () => textOf(await SignInPage({ searchParams: Promise.resolve({}) })));

test("what counts as a production configuration", () => {
  for (const e of [{ NODE_ENV: "production" }, { VERCEL_ENV: "production" }, { VERCEL_ENV: "preview" }, { NODE_ENV: "development", VERCEL_ENV: "production" }]) assert.equal(isProductionConfig(env(e)), true, JSON.stringify(e));
  for (const e of [{ NODE_ENV: "development" }, { NODE_ENV: "test" }, { VERCEL_ENV: "development" }]) assert.equal(isProductionConfig(env(e)), false, JSON.stringify(e));
});

test("TEST_LOGIN only ever works in development, and nothing re-enables it in production", () => {
  assert.equal(testLoginEnabled(env({ NODE_ENV: "development", TEST_LOGIN: "true" })), true);
  assert.equal(testLoginEnabled(env({ NODE_ENV: "development" })), false, "off unless asked for");
  for (const v of ["1", "TRUE", "yes", " true"]) assert.equal(testLoginEnabled(env({ NODE_ENV: "development", TEST_LOGIN: v })), false, `only the exact value counts: ${v}`);
  for (const e of [{ NODE_ENV: "production" }, { VERCEL_ENV: "production" }, { VERCEL_ENV: "preview" }, { NODE_ENV: "production", DEMO_MODE: "true" }]) assert.equal(testLoginEnabled(env({ ...e, TEST_LOGIN: "true" })), false, JSON.stringify(e));
});

test("the boot check says TEST_LOGIN is ignored in production, and doesn't take the site down over it", () => {
  const report = checkEnv(env({ NODE_ENV: "production", TEST_LOGIN: "true", NEXT_PUBLIC_SUPABASE_URL: "https://x", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k", SUPABASE_SERVICE_ROLE_KEY: "s", NEXT_PUBLIC_SITE_URL: "https://a.example", CRON_SECRET: "c", RESEND_API_KEY: "r", ANTHROPIC_API_KEY: "a" }));
  assert.deepEqual(report.errors, []);
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /ignored/);
});

test("demo sign-in in production needs DEMO_MODE=true and no database variable at all", () => {
  assert.equal(demoLoginAllowed(env({ NODE_ENV: "development" })), true);
  assert.equal(demoLoginAllowed(env({ NODE_ENV: "production" })), false, "lost database variables don't open a demo");
  assert.equal(demoLoginAllowed(env({ VERCEL_ENV: "preview" })), false);
  assert.equal(demoLoginAllowed(env({ NODE_ENV: "production", DEMO_MODE: "1" })), false);
  assert.equal(demoLoginAllowed(env({ NODE_ENV: "production", DEMO_MODE: "true" })), true, "a demo deployment on purpose");
  assert.equal(demoLoginAllowed(env({ NODE_ENV: "production", DEMO_MODE: "true", NEXT_PUBLIC_SUPABASE_URL: "https://x" })), false, "half a database is not a demo");
  assert.equal(demoLoginAllowed(env({ NODE_ENV: "production", DEMO_MODE: "true", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" })), false);
});

test("production with a database: the test sign-in action refuses, for both roles, TEST_LOGIN on or off", async () => {
  for (const TEST_LOGIN of ["true", undefined]) {
    await withEnv({ ...CLEAN, ...DB, NODE_ENV: "production", TEST_LOGIN }, async () => {
      for (const data of [{}, { admin: "1" }]) {
        const scope = requestScope();
        // Past the gate it would need the service key, which doesn't exist here, and throw instead of redirecting.
        assert.equal(await redirectOf(() => scope.run(() => testSignIn(form(data)))), "/sign-in");
        assert.equal(scope.jar.size, 0, "no session or cookie of any kind was set");
      }
    });
  }
});

test("development with a database and TEST_LOGIN=true does get past the gate: the refusal above is the gate, not a coincidence", async () => {
  await withEnv({ ...CLEAN, ...DB, NODE_ENV: "development", TEST_LOGIN: "true" }, async () => {
    const scope = requestScope();
    await assert.rejects(() => scope.run(() => testSignIn(form())), /SUPABASE_SERVICE_ROLE_KEY/);
  });
});

test("production with no database and no DEMO_MODE: every way in refuses and sets no cookie", async () => {
  await withEnv({ ...CLEAN, ...NO_DB, NODE_ENV: "production", TEST_LOGIN: "true" }, async () => {
    const attempts: [string, () => Promise<unknown>][] = [
      ["test sign-in", () => testSignIn(form())],
      ["test sign-in as admin", () => testSignIn(form({ admin: "1" }))],
      ["university sign-in", () => signInWithUniversity(form())],
      ["university sign-in as admin", () => signInWithUniversity(form({ admin: "1" }))],
      ["email sign-in", () => signInWithEmail(null, form({ email: "a@northfield.ac.uk" }))],
    ];
    for (const [name, attempt] of attempts) {
      const scope = requestScope();
      assert.match(await redirectOf(() => scope.run(attempt)), /^\/sign-in\?error=/, name);
      assert.equal(scope.jar.size, 0, `${name}: no cookie`);
    }
  });
});

test("production with no database and no DEMO_MODE: a validly signed demo cookie opens nothing", async () => {
  const cookie = signDemoSession("admin", "0f3c9a2e-1b2c-4d5e-8f90-123456789abc");
  await withEnv({ ...CLEAN, ...NO_DB, NODE_ENV: "production" }, async () => {
    assert.equal(await requestScope({ [DEMO_COOKIE]: cookie }).run(() => getRepo()), null);
  });
  await withEnv({ ...CLEAN, ...NO_DB, NODE_ENV: "development" }, async () => {
    assert.equal((await requestScope({ [DEMO_COOKIE]: cookie }).run(() => getRepo()))?.mode, "demo", "the same cookie does open the demo where demos are allowed");
  });
});

test("production with a database: a demo cookie is ignored", async () => {
  const cookie = signDemoSession("admin", "0f3c9a2e-1b2c-4d5e-8f90-123456789abc");
  await withEnv({ ...CLEAN, ...DB, NODE_ENV: "production", DEMO_MODE: "true" }, async () => {
    assert.equal(await requestScope({ [DEMO_COOKIE]: cookie }).run(() => getRepo()), null);
  });
});

test("a deliberate demo deployment still works, with a Secure cookie", async () => {
  await withEnv({ ...CLEAN, ...NO_DB, NODE_ENV: "production", DEMO_MODE: "true" }, async () => {
    const scope = requestScope();
    assert.equal(await redirectOf(() => scope.run(() => testSignIn(form()))), "/dashboard");
    assert.ok(scope.jar.get(DEMO_COOKIE)?.startsWith("student:"));
    assert.equal(scope.options.get(DEMO_COOKIE)?.secure, true);
    assert.equal(scope.options.get(DEMO_COOKIE)?.httpOnly, true);
  });
});

test("the sign-in page offers 'Enter as a student' only where it would work", async () => {
  const shows = (vars: Record<string, string | undefined>) => withEnv({ ...CLEAN, ...vars }, async () => /Enter as a student/.test(await signInPageText(requestScope())));
  assert.equal(await shows({ ...DB, NODE_ENV: "production", TEST_LOGIN: "true" }), false, "production, database, TEST_LOGIN left on");
  assert.equal(await shows({ ...DB, VERCEL_ENV: "preview", TEST_LOGIN: "true" }), false, "preview, database, TEST_LOGIN left on");
  assert.equal(await shows({ ...NO_DB, NODE_ENV: "production", TEST_LOGIN: "true" }), false, "production, database variables lost");
  assert.equal(await shows({ ...DB, NODE_ENV: "development" }), false, "development without the flag");
  assert.equal(await shows({ ...DB, NODE_ENV: "development", TEST_LOGIN: "true" }), true, "development with the flag");
  assert.equal(await shows({ ...NO_DB, NODE_ENV: "development" }), true, "local demo");
  assert.equal(await shows({ ...NO_DB, NODE_ENV: "production", DEMO_MODE: "true" }), true, "demo deployment on purpose");
});
