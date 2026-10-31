import assert from "node:assert/strict";
import { test } from "node:test";
import { cronAuthorized } from "@/lib/cron-auth";
import { deadlineReminderEmail, retentionWarningEmail, sendEmail } from "@/lib/email";
import { groupReminders } from "@/lib/jobs";

test("emails escape names and roles (no HTML injection)", () => {
  const e = deadlineReminderEmail('<script>alert(1)</script> Bob', [{ role: "Analyst <b>x</b>", org: "A&B", closesOn: "2026-11-14" }]);
  assert.ok(!e.html.includes("<script>"));
  assert.ok(e.html.includes("&lt;script&gt;"));
  assert.ok(e.html.includes("A&amp;B"));
  assert.match(e.subject, /A&B closes/);
  assert.match(retentionWarningEmail("Jo").html, /30 days/);
});

test("reminders are grouped into one email per student", () => {
  const g = groupReminders([
    { user_id: "u1", email: "a@n.ac.uk", full_name: "A", application_id: "1", role: "R1", org: "O1", closes_on: "2026-11-01" },
    { user_id: "u1", email: "a@n.ac.uk", full_name: "A", application_id: "2", role: "R2", org: "O2", closes_on: "2026-11-02" },
    { user_id: "u2", email: "b@n.ac.uk", full_name: "B", application_id: "3", role: "R3", org: "O3", closes_on: "2026-11-03" },
  ]);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0].ids, ["1", "2"]);
  assert.match(deadlineReminderEmail("A", g[0].items).subject, /2 applications close this week/);
});

test("without a provider key emails are logged, not sent; with one, Resend is called", async () => {
  const origLog = console.log;
  console.log = () => {};
  try {
    assert.equal((await sendEmail({ to: "a@n.ac.uk", subject: "s", html: "<p>h</p>", text: "t" })).sent, false);
  } finally {
    console.log = origLog;
  }
  const origFetch = globalThis.fetch;
  let called: { url: string; body: Record<string, unknown>; auth: string } | null = null;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    called = { url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).authorization };
    return new Response(JSON.stringify({ id: "em_1" }), { status: 200 });
  }) as typeof fetch;
  process.env.RESEND_API_KEY = "re_test";
  try {
    const r = await sendEmail({ to: "a@n.ac.uk", subject: "Hello", html: "<p>h</p>", text: "t" });
    assert.deepEqual(r, { sent: true, id: "em_1" });
    assert.equal(called!.url, "https://api.resend.com/emails");
    assert.equal(called!.auth, "Bearer re_test");
    assert.deepEqual(called!.body.to, ["a@n.ac.uk"]);
  } finally {
    globalThis.fetch = origFetch;
    delete process.env.RESEND_API_KEY;
  }
});

test("cron endpoints need the exact secret", () => {
  const req = (auth?: string) => new Request("http://x/api/cron/reminders", { headers: auth ? { authorization: auth } : {} });
  assert.equal(cronAuthorized(req("Bearer s3cret")), false, "no secret configured means disabled");
  process.env.CRON_SECRET = "s3cret";
  try {
    assert.equal(cronAuthorized(req()), false);
    assert.equal(cronAuthorized(req("Bearer wrong!")), false);
    assert.equal(cronAuthorized(req("Bearer s3cret")), true);
  } finally {
    delete process.env.CRON_SECRET;
  }
});
