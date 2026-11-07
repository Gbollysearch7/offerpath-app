// The production build gate, and previews with no variables. Only fake values, and nothing here starts a build: the real
// `next build` runs are recorded in docs/CLAUDE_REPORT_RELEASE_FIXES.md.
import "./fixtures/next-server-shim";
import assert from "node:assert/strict";
import { test } from "node:test";
import { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants";
import { assertBuildEnv, checkBuildEnv, checkEnv, demoLoginAllowed, OPTIONAL_IN_PRODUCTION, REQUIRED_IN_PRODUCTION, testLoginEnabled } from "@/lib/env";
import nextConfig from "../next.config";
import { withEnv } from "./fixtures/request-scope";

const env = (vars: Record<string, string | undefined>) => vars as unknown as NodeJS.ProcessEnv;
const CANARY = "fake-canary-value-do-not-print";
const complete = () => Object.fromEntries(REQUIRED_IN_PRODUCTION.map((k) => [k, k === "NEXT_PUBLIC_SITE_URL" ? `https://${CANARY}.invalid` : k === "NEXT_PUBLIC_SUPABASE_URL" ? `https://${CANARY}.invalid` : CANARY])) as Record<string, string>;
const PROD = { VERCEL: "1", VERCEL_ENV: "production" };
const PREVIEW = { VERCEL: "1", VERCEL_ENV: "preview" };
const ALL_NAMES = [...REQUIRED_IN_PRODUCTION, ...Object.keys(OPTIONAL_IN_PRODUCTION), "VERCEL", "VERCEL_ENV", "VERCEL_TARGET_ENV", "DEMO_MODE", "DEMO_SECRET", "TEST_LOGIN"];
const blank = () => Object.fromEntries(ALL_NAMES.map((k) => [k, undefined])) as Record<string, string | undefined>;
const quiet = { warn() {}, log() {} };

test("the required list is one constant, and what isn't on it is named as optional", () => {
  assert.ok(REQUIRED_IN_PRODUCTION.length > 0);
  for (const k of REQUIRED_IN_PRODUCTION) assert.ok(!(k in OPTIONAL_IN_PRODUCTION), `${k} can't be both`);
  for (const k of ["EMAIL_FROM", "SUPPORT_EMAIL", "ALERT_WEBHOOK_URL", "LEGAL_OPERATOR_NAME", "LEGAL_OPERATOR_ADDRESS", "LEGAL_COMPANY_NUMBER", "LEGAL_ICO_NUMBER", "LEGAL_CONTACT_EMAIL", "ANTHROPIC_API_KEY"]) assert.ok(k in OPTIONAL_IN_PRODUCTION || (REQUIRED_IN_PRODUCTION as readonly string[]).includes(k), `${k} is on neither list`);
});

test("a production build with nothing set fails, naming every required variable", () => {
  const r = checkBuildEnv(env(PROD));
  assert.equal(r.gated, true);
  assert.deepEqual(r.missing, [...REQUIRED_IN_PRODUCTION]);
  assert.throws(() => assertBuildEnv(env(PROD), quiet), (e: Error) => REQUIRED_IN_PRODUCTION.every((k) => e.message.includes(k)) && !/DEMO_MODE|demo mode/i.test(e.message), "and doesn't suggest demo mode as a way out");
});

test("each required variable on its own fails the production build, and blank counts as missing", () => {
  for (const name of REQUIRED_IN_PRODUCTION) {
    const rest = complete();
    delete rest[name];
    assert.deepEqual(checkBuildEnv(env({ ...PROD, ...rest })).missing, [name]);
    assert.throws(() => assertBuildEnv(env({ ...PROD, ...rest }), quiet), new RegExp(name));
    assert.deepEqual(checkBuildEnv(env({ ...PROD, ...rest, [name]: "   " })).missing, [name], "whitespace isn't a value");
  }
});

test("a production build with every required variable passes, and only warns about the optional ones by name", () => {
  const warned: string[] = [];
  assert.doesNotThrow(() => assertBuildEnv(env({ ...PROD, ...complete() }), { warn: (m: string) => warned.push(m), log() {} }));
  for (const k of Object.keys(OPTIONAL_IN_PRODUCTION)) assert.ok(warned.join("\n").includes(k), `${k} is named`);
  assert.deepEqual(checkBuildEnv(env({ ...PROD, ...complete() })).missing, []);
});

test("errors the boot check would raise also fail the production build: a dead deployment isn't promotable", () => {
  assert.throws(() => assertBuildEnv(env({ ...PROD, ...complete(), NEXT_PUBLIC_SITE_URL: "http://not-https.invalid" }), quiet), /https/);
});

test("the build gate never prints a value", () => {
  const out: string[] = [];
  const sink = { warn: (m: string) => out.push(m), log: (m: string) => out.push(m) };
  const partial = complete();
  delete partial.CRON_SECRET;
  const every = { ...partial, ...Object.fromEntries(Object.keys(OPTIONAL_IN_PRODUCTION).slice(0, 3).map((k) => [k, CANARY])), NEXT_PUBLIC_SITE_URL: `http://${CANARY}.invalid` };
  assert.throws(
    () => assertBuildEnv(env({ ...PROD, ...every }), sink),
    (e: Error) => {
      out.push(e.message);
      return true;
    },
  );
  assert.ok(out.join("\n").includes("CRON_SECRET"));
  assert.ok(!out.join("\n").includes(CANARY), "names only");
});

test("DEMO_MODE and TEST_LOGIN don't get a production build past the gate", () => {
  for (const extra of [{ DEMO_MODE: "true" }, { DEMO_MODE: "true", DEMO_SECRET: "x" }, { TEST_LOGIN: "true" }]) {
    assert.throws(() => assertBuildEnv(env({ ...PROD, ...extra }), quiet), /NEXT_PUBLIC_SUPABASE_URL/, JSON.stringify(extra));
  }
  assert.throws(() => assertBuildEnv(env({ VERCEL: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "production" }), quiet), /NEXT_PUBLIC_SUPABASE_URL/, "a build aimed at production is production");
});

test("only production builds are gated: a preview, CI and a laptop build with no variables", () => {
  for (const e of [PREVIEW, {}, { CI: "true" }, { NODE_ENV: "production" }, { VERCEL: "1", VERCEL_ENV: "development" }]) {
    assert.equal(checkBuildEnv(env(e)).gated, false, JSON.stringify(e));
    assert.doesNotThrow(() => assertBuildEnv(env(e), quiet), JSON.stringify(e));
  }
});

test("next.config applies the gate at build time, and only then", async () => {
  await withEnv({ ...blank(), ...PROD }, async () => {
    assert.throws(() => nextConfig(PHASE_PRODUCTION_BUILD), /NEXT_PUBLIC_SUPABASE_URL/);
    assert.doesNotThrow(() => nextConfig(PHASE_PRODUCTION_SERVER), "next start doesn't re-judge a finished build");
  });
  await withEnv({ ...blank(), ...PREVIEW }, async () => {
    const config = nextConfig(PHASE_PRODUCTION_BUILD);
    assert.ok(config.headers, "the same config comes back");
  });
});

test("a preview with no variables boots in demo mode, and test sign-in stays shut", () => {
  const r = checkEnv(env(PREVIEW));
  assert.deepEqual(r.errors, []);
  assert.equal(r.mode, "demo");
  assert.ok(r.warnings.some((w) => /preview/i.test(w) && /fictional/i.test(w)), "it says what it is");
  assert.equal(demoLoginAllowed(env(PREVIEW)), true);
  assert.equal(testLoginEnabled(env({ ...PREVIEW, TEST_LOGIN: "true" })), false);
});

test("a preview that holds anything real isn't an empty preview: no automatic demo", () => {
  for (const extra of [{ SUPABASE_SERVICE_ROLE_KEY: "s" }, { NEXT_PUBLIC_SUPABASE_URL: "https://x.invalid" }, { NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" }, { ANTHROPIC_API_KEY: "k" }, { VERCEL_TARGET_ENV: "production" }]) {
    assert.equal(demoLoginAllowed(env({ ...PREVIEW, ...extra })), false, JSON.stringify(extra));
    assert.ok(checkEnv(env({ ...PREVIEW, ...extra })).errors.length > 0 || checkEnv(env({ ...PREVIEW, ...extra })).mode === "supabase", JSON.stringify(extra));
  }
});

test("OP-026 holds in production: no combination here opens demo or test sign-in", () => {
  for (const e of [PROD, { ...PROD, TEST_LOGIN: "true" }, { NODE_ENV: "production" }, { VERCEL_ENV: "production" }, { VERCEL_ENV: "preview" }, { NODE_ENV: "production", VERCEL: "1" }, { ...PROD, VERCEL_TARGET_ENV: "preview" }, { ...PREVIEW, VERCEL_ENV: "production" }]) {
    assert.equal(demoLoginAllowed(env(e)), false, `demo: ${JSON.stringify(e)}`);
    assert.equal(testLoginEnabled(env({ ...e, TEST_LOGIN: "true" })), false, `test login: ${JSON.stringify(e)}`);
    assert.ok(checkEnv(env(e)).errors.some((m) => /DEMO_MODE/.test(m)), `boot refuses: ${JSON.stringify(e)}`);
  }
  assert.equal(testLoginEnabled(env({ ...PROD, DEMO_MODE: "true", TEST_LOGIN: "true" })), false);
});

test("a deployment that's missing optional variables says so at boot, by name", () => {
  const w = checkEnv(env({ ...PROD, ...complete() })).warnings.join("\n");
  for (const k of ["SUPPORT_EMAIL", "ALERT_WEBHOOK_URL", "LEGAL_OPERATOR_NAME", "EMAIL_FROM"]) assert.ok(w.includes(k), k);
  assert.ok(!w.includes(CANARY));
});
