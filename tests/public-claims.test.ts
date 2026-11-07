// The sign-in selector must never show a fictional university outside demo mode, and public pages must not bring back
// claims found unsupported (docs/CLAUDE_REPORT_CLAIMS_FIXES.md). If one of these becomes true, change it with its evidence.
import "./fixtures/next-server-shim";
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { signInWithUniversity } from "@/app/actions/auth";
import SignInPage from "@/app/sign-in/page";
import { ssoUniversities } from "@/lib/sso";
import { redirectOf, requestScope, withEnv } from "./fixtures/request-scope";

const DB = { NEXT_PUBLIC_SUPABASE_URL: "https://claims-no-such-project.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", NEXT_PUBLIC_SITE_URL: "https://a.example", DEMO_MODE: undefined, VERCEL_ENV: undefined, TEST_LOGIN: undefined };
const NOT_SET_UP = /^\/sign-in\?error=University%20sign-in/;
const env = (v: string | undefined) => ({ SSO_UNIVERSITIES: v }) as unknown as NodeJS.ProcessEnv;
const form = (domain?: string) => {
  const f = new FormData();
  if (domain !== undefined) f.set("domain", domain);
  return f;
};
const read = (f: string) => fs.readFileSync(f, "utf8");

/** The list the page hands to the form, found in the server-rendered tree without rendering client components. */
function offered(node: unknown): { name: string; domain: string }[] | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = offered(n);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  const el = node as { type?: unknown; props?: { universities?: { name: string; domain: string }[]; children?: unknown } };
  if (el.props?.universities) return el.props.universities;
  return el.props ? offered(el.props.children) : null;
}
const pageList = (scope = requestScope()) => scope.run(async () => offered(await SignInPage({ searchParams: Promise.resolve({}) })));

test("SSO_UNIVERSITIES: empty by default, and malformed entries are dropped", () => {
  assert.deepEqual(ssoUniversities(env(undefined)), []);
  assert.deepEqual(ssoUniversities(env("")), []);
  assert.deepEqual(ssoUniversities(env("University of Example=Example.AC.uk; Second = second.ac.uk ;no-domain;=x.ac.uk;Bad=not a domain;Again=example.ac.uk")), [
    { name: "University of Example", domain: "example.ac.uk" },
    { name: "Second", domain: "second.ac.uk" },
  ]);
});

test("production with nothing configured offers no university, and shows no fictional one", async () => {
  await withEnv({ ...DB, NODE_ENV: "production", SSO_UNIVERSITIES: undefined }, async () => {
    assert.deepEqual(await pageList(), []);
  });
});

test("the sign-in form's source has no hard-coded institution", () => {
  for (const f of ["src/app/sign-in/SignInForms.tsx", "src/app/sign-in/page.tsx", "src/app/actions/auth.ts"]) assert.doesNotMatch(read(f), /northfield/i, f);
});

test("a real university in the configuration is what the page offers", async () => {
  await withEnv({ ...DB, NODE_ENV: "production", SSO_UNIVERSITIES: "University of Example=example.ac.uk" }, async () => {
    assert.deepEqual(await pageList(), [{ name: "University of Example", domain: "example.ac.uk" }]);
  });
});

test("demo mode keeps its fictional university, and only there", async () => {
  await withEnv({ NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", DEMO_MODE: "true", VERCEL_ENV: undefined, TEST_LOGIN: undefined, NODE_ENV: "production", SSO_UNIVERSITIES: undefined }, async () => {
    assert.equal((await pageList())![0].domain, "northfield.ac.uk");
  });
  await withEnv({ NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", DEMO_MODE: undefined, VERCEL_ENV: undefined, TEST_LOGIN: undefined, NODE_ENV: "production", SSO_UNIVERSITIES: undefined }, async () => {
    assert.deepEqual(await pageList(), [], "a production server with no database has no demo");
  });
});

test("the action sends the chosen university's domain to Supabase, and refuses one that isn't listed", async () => {
  const realFetch = globalThis.fetch;
  const calls: { url: string; body: { domain?: string } }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify({ url: "https://idp.example/login" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    await withEnv({ ...DB, SSO_UNIVERSITIES: "University of Example=example.ac.uk;Second University=second.ac.uk" }, async () => {
      assert.equal(await redirectOf(() => requestScope().run(() => signInWithUniversity(form("second.ac.uk")))), "https://idp.example/login");
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /\/auth\/v1\/sso$/);
      assert.equal(calls[0].body.domain, "second.ac.uk");

      calls.length = 0;
      for (const bad of ["northfield.ac.uk", "other.ac.uk", "", undefined]) assert.match(await redirectOf(() => requestScope().run(() => signInWithUniversity(form(bad)))), NOT_SET_UP, String(bad));
      assert.equal(calls.length, 0, "an unlisted domain never reaches Supabase");
    });
    await withEnv({ ...DB, SSO_UNIVERSITIES: undefined }, async () => {
      assert.match(await redirectOf(() => requestScope().run(() => signInWithUniversity(form("example.ac.uk")))), NOT_SET_UP);
      assert.equal(calls.length, 0);
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("claims found unsupported stay gone from public pages", () => {
  const unsupported: [string, RegExp][] = [
    ["src/app/legal/privacy/page.tsx", /overwritten within 35 days|under data processing agreements/],
    ["src/app/legal/sub-processors/page.tsx", /Each is bound by a data processing agreement/],
    ["src/lib/legal.ts", /under a data processing agreement/],
    ["src/app/_landing/Landing.tsx", /Ready for pilots|under a data processing agreement|Designed to meet WCAG/],
    ["src/app/sign-in/page.tsx", /Designed to WCAG/],
    ["src/app/legal/accessibility/page.tsx", /at least 44 pixels|fully accessible|manual keyboard testing|partially compliant|5 working days/],
    ["src/app/privacy/page.tsx", /removes it all straight away|always leave out/],
  ];
  for (const [f, claim] of unsupported) assert.doesNotMatch(read(f), claim, f);
  for (const f of ["src/app/legal/privacy/page.tsx", "src/app/legal/sub-processors/page.tsx", "src/app/legal/accessibility/page.tsx"]) assert.match(read(f), /\bdraft\b/, `${f} is marked as a draft`);
  assert.match(read("docs/legal/DPA_SCHEDULE_TEMPLATE.md"), /DRAFT FOR LEGAL REVIEW/);
  assert.match(read("docs/legal/DPIA_TEMPLATE.md"), /DRAFT FOR LEGAL REVIEW/);
});
