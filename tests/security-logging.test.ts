// OP-026: logs and alerts omit CV text and secrets, including in the places a field-name filter can't see: error
// messages, deep structures, and text quoted by a failed parse. Each test uses a canary and searches the whole output.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { alert, log, safeErrorMessage, scrub } from "@/lib/log";

const CANARY = "Zanzibar-Quokka-CV-line";

async function captured(fn: () => unknown | Promise<unknown>): Promise<string> {
  const lines: string[] = [];
  const saved = [console.log, console.warn, console.error];
  console.log = console.warn = console.error = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    await fn();
  } finally {
    [console.log, console.warn, console.error] = saved;
  }
  return lines.join("\n");
}

test("document fields are redacted by name, whatever their case", async () => {
  const out = await captured(() =>
    log("info", "e", { text: CANARY, cvText: CANARY, jobText: CANARY, letterText: CANARY, Payload: CANARY, prompt: CANARY, body: CANARY, html: CANARY, bullet: CANARY, draft: CANARY, note: CANARY, email: CANARY, fullName: CANARY, fileName: CANARY, content: CANARY }),
  );
  assert.ok(!out.includes(CANARY), out);
});

test("secrets by name", async () => {
  const out = await captured(() => log("info", "e", { apiKey: CANARY, access_token: CANARY, CRON_SECRET: CANARY, password: CANARY, Authorization: CANARY, cookie: CANARY }));
  assert.ok(!out.includes(CANARY), out);
});

test("redaction holds at any depth: past the limit a value is dropped, not passed through", async () => {
  let deep: Record<string, unknown> = { harmless: CANARY, text: CANARY, apiKey: CANARY };
  for (let i = 0; i < 12; i++) deep = { level: deep };
  const out = await captured(() => log("error", "e", { deep }));
  assert.ok(!out.includes(CANARY), out);
  assert.match(out, /\[truncated\]/);
});

test("a parse failure's message, which quotes its input, doesn't reach the log, in message or in stack", async () => {
  let err: unknown;
  try {
    JSON.parse(`${CANARY} was the first thing the model said`);
  } catch (e) {
    err = e;
  }
  assert.match((err as Error).message, /Zanzibar/, "the premise: V8 really does put the input in the message");
  const out = await captured(() => log("error", "judge-failed", { error: err }));
  assert.ok(!out.includes("Zanzibar"), out);
  assert.equal(JSON.parse(out).error.name, "SyntaxError", "still says what kind of failure it was");
  assert.ok(JSON.parse(out).error.stack.includes(" at "), "and keeps the frames");
});

test("secret values are removed from error messages and from any string", async () => {
  const secrets = ["sk-ant-api03-AbCdEf123456", "re_123456789abcdef", "sb_secret_abcdef123456", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl", "jane.doe@northfield.ac.uk"];
  const message = `401 from provider: ${secrets.join(" ")} Bearer opaque-session-value`;
  const out = await captured(() => log("error", "e", { error: new Error(message), reason: message, nested: { list: [message] } }));
  for (const s of [...secrets, "opaque-session-value"]) assert.ok(!out.includes(s), `${s} leaked: ${out}`);
  assert.equal(scrub("no secrets in here"), "no secrets in here");
});

test("a long quoted value in an error message is blanked; a short diagnostic survives", () => {
  assert.equal(safeErrorMessage(`violates: "${CANARY} and the rest of a bullet"`), 'violates: "[redacted]"');
  assert.equal(safeErrorMessage('new row for relation "cv_sources" violates check'), 'new row for relation "cv_sources" violates check');
  assert.ok(safeErrorMessage("x".repeat(5000)).length <= 300);
});

test("logging can't throw: circular, bigint, odd values", async () => {
  const circular: Record<string, unknown> = { a: 1 };
  circular.self = circular;
  const out = await captured(() => log("info", "e", { circular, big: BigInt(10), fn: () => 1, sym: Symbol("s"), date: new Date(0) }));
  const parsed = JSON.parse(out);
  assert.equal(parsed.big, "10");
  assert.equal(parsed.event, "e");
  const hostile = { get boom() { throw new Error("no"); } };
  const fallback = await captured(() => log("info", "e2", { hostile }));
  assert.equal(JSON.parse(fallback).logError, "unserialisable data");
});

test("alerts: what goes to the third-party webhook is scrubbed too", async () => {
  const sent: string[] = [];
  const savedFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
    sent.push(init.body);
    return new Response("ok");
  }) as unknown as typeof fetch;
  process.env.ALERT_WEBHOOK_URL = "http://example.invalid/hook";
  try {
    let parseError: Error;
    try {
      JSON.parse(`${CANARY} Led a team`);
      throw new Error("unreachable");
    } catch (e) {
      parseError = e as Error;
    }
    const out = await captured(async () => {
      await alert("t1", `Server error on POST /upload: ${parseError.message}`, { error: parseError });
      await alert("t2", "Server error: invalid key sk-ant-api03-AbCdEf123456 for jane.doe@northfield.ac.uk", {});
    });
    const all = sent.join("\n") + out;
    for (const s of ["Zanzibar", "sk-ant-api03", "jane.doe"]) assert.ok(!all.includes(s), `${s} leaked: ${all}`);
    assert.equal(sent.length, 2, "both alerts did go out");
  } finally {
    globalThis.fetch = savedFetch;
    delete process.env.ALERT_WEBHOOK_URL;
  }
});

/* ---------- static: nothing goes around the logger, and nothing passes document text to it ---------- */

const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
const sourceFiles = walk(path.join(process.cwd(), "src")).filter((f) => !f.includes(`${path.sep}_landing${path.sep}`) && !f.includes(`${path.sep}stageshow${path.sep}`));

test("server code logs only through the redacting logger", () => {
  // env.ts prints its own configuration warnings, before anything else is running; they hold variable names only.
  const allowed = new Set(["src/lib/log.ts", "src/lib/env.ts"]);
  const offenders = sourceFiles.filter((f) => !allowed.has(path.relative(process.cwd(), f)) && /\bconsole\.(log|info|warn|error|debug)\(/.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(offenders.map((f) => path.relative(process.cwd(), f)), []);
});

test("no log or alert call names a field that holds document text", () => {
  const banned = /\b(?:log|alert)\([^)]*\b(?:text|cvText|jobText|letterText|payload|prompt|bullets?|line)\s*[:,}]/;
  const offenders = sourceFiles.filter((f) => path.relative(process.cwd(), f) !== "src/lib/log.ts" && banned.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(offenders.map((f) => path.relative(process.cwd(), f)), []);
});

test("the processing path writes no temporary files: extraction happens in memory", () => {
  const offenders = sourceFiles.filter((f) => /\b(tmpdir|mkdtemp|writeFile|createWriteStream|appendFile)\b/.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(offenders.map((f) => path.relative(process.cwd(), f)), []);
});
