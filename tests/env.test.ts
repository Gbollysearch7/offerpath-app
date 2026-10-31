import assert from "node:assert/strict";
import { test } from "node:test";
import { checkEnv } from "@/lib/env";

const base = { NODE_ENV: "production" } as NodeJS.ProcessEnv;

test("production refuses to run demo mode unless asked to", () => {
  assert.ok(checkEnv({ ...base }).errors.some((e) => /DEMO_MODE/.test(e)));
  assert.equal(checkEnv({ ...base, DEMO_MODE: "true" }).errors.length, 0);
});

test("production with Supabase needs the service key and an https site URL", () => {
  const sb = { ...base, NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" };
  const r = checkEnv(sb);
  assert.equal(r.mode, "supabase");
  assert.ok(r.errors.some((e) => /SERVICE_ROLE/.test(e)));
  assert.ok(r.errors.some((e) => /SITE_URL/.test(e)));
  assert.ok(checkEnv({ ...sb, SUPABASE_SERVICE_ROLE_KEY: "s", NEXT_PUBLIC_SITE_URL: "http://x" }).errors.some((e) => /https/.test(e)));
  assert.equal(checkEnv({ ...sb, SUPABASE_SERVICE_ROLE_KEY: "s", NEXT_PUBLIC_SITE_URL: "https://offerpath.app" }).errors.length, 0);
});

test("half-configured Supabase is an error; development demo is fine", () => {
  assert.ok(checkEnv({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://x" } as NodeJS.ProcessEnv).errors.length > 0);
  assert.equal(checkEnv({ NODE_ENV: "development" } as NodeJS.ProcessEnv).errors.length, 0);
});
