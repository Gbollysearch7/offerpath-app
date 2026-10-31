import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { alert, log } from "@/lib/log";

test("logs are JSON and never include secrets or document text", () => {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (l: string) => lines.push(l);
  try {
    log("info", "upload", { userId: "u1", text: "My CV says…", apiKey: "sk-123", nested: { authorization: "Bearer x", count: 3 } });
  } finally {
    console.log = orig;
  }
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.event, "upload");
  assert.equal(parsed.userId, "u1");
  assert.equal(parsed.text, "[redacted]");
  assert.equal(parsed.apiKey, "[redacted]");
  assert.equal(parsed.nested.authorization, "[redacted]");
  assert.equal(parsed.nested.count, 3);
});

test("alerts reach the webhook and are throttled per key", async () => {
  const received: string[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push(JSON.parse(body).text);
      res.end("ok");
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`;
  const origErr = console.error;
  console.error = () => {};
  try {
    await alert("test-key", "Scoring failed");
    await alert("test-key", "Scoring failed again");
    await alert("other-key", "Something else");
  } finally {
    console.error = origErr;
    delete process.env.ALERT_WEBHOOK_URL;
    server.close();
  }
  assert.equal(received.length, 2, "second alert with the same key was throttled");
  assert.match(received[0], /Offerpath .*Scoring failed/);
});
