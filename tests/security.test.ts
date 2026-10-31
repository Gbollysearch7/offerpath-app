import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchPublicText, isPrivateAddress, UnsafeUrlError } from "@/lib/safe-fetch";
import { readDemoSession, signDemoSession } from "@/lib/demo-session";

test("private and internal addresses are recognised, public ones aren't", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700::1111", "2a00:1450::200e"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("job ad fetcher refuses unsafe URLs before connecting", async () => {
  for (const url of ["http://localhost/", "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "file:///etc/passwd", "ftp://example.com/", "http://user:pw@example.com/", "http://example.com:8080/", "http://metadata.google.internal/"]) {
    await assert.rejects(fetchPublicText(url), UnsafeUrlError, url);
  }
});

test("demo sessions can't be forged or altered", () => {
  const good = signDemoSession("student", "0f3c9a2e-1b2c-4d5e-8f90-123456789abc");
  assert.deepEqual(readDemoSession(good), { role: "student", id: "0f3c9a2e-1b2c-4d5e-8f90-123456789abc" });
  assert.equal(readDemoSession("admin:0f3c9a2e-1b2c-4d5e-8f90-123456789abc"), null, "unsigned cookie");
  assert.equal(readDemoSession(good.replace("student", "admin")), null, "role swapped");
  assert.equal(readDemoSession(good.slice(0, -2) + "xx"), null, "tampered signature");
  assert.equal(readDemoSession(undefined), null);
});

test("ReDoS: a hostile 40k-character CV parses in well under a second", async () => {
  const { parseCv } = await import("@/lib/analysis/parse");
  const { analyseCv } = await import("@/lib/analysis/cv");
  for (const hostile of ["a".repeat(40_000), ("word ".repeat(8000)), ("1".repeat(39_000) + "@x"), ("• " + "Led a team of 5 ".repeat(2500))]) {
    const t = Date.now();
    parseCv(hostile);
    analyseCv(hostile, "Finance and banking");
    assert.ok(Date.now() - t < 1500, `took ${Date.now() - t}ms`);
  }
});

test("caps: bullets per CV and characters per bullet are bounded", async () => {
  const { cvBullets } = await import("@/lib/analysis/cv");
  const { MAX_BULLETS, MAX_BULLET_CHARS } = await import("@/lib/analysis/parse");
  const many = "EXPERIENCE\n" + Array.from({ length: 500 }, (_, i) => `• Led a team of ${i} people to deliver project number ${i} on time`).join("\n");
  assert.equal(cvBullets(many).length, MAX_BULLETS);
  const long = "EXPERIENCE\n• Led " + "very long text ".repeat(500) + "\n• Built a model\n• Ran a team of 4";
  assert.ok(cvBullets(long).every((b) => b.text.length <= MAX_BULLET_CHARS));
});

test("uploads: oversized text, zip bombs and wrong types are rejected before parsing", async () => {
  const { extractText, ExtractError } = await import("@/lib/analysis/extract");
  const JSZip = (await import("jszip")).default;
  const bomb = new JSZip();
  bomb.file("[Content_Types].xml", "<Types/>");
  bomb.file("word/document.xml", "a".repeat(25 * 1024 * 1024));
  const bytes = await bomb.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } });
  assert.ok(bytes.byteLength < 2 * 1024 * 1024, "the bomb is small on disk");
  await assert.rejects(extractText(bytes, "cv.docx"), (e: unknown) => e instanceof ExtractError && /unusually large/.test((e as Error).message));
  await assert.rejects(extractText(new TextEncoder().encode("a".repeat(1000)), "cv.txt"), ExtractError);
  const { Document, Packer, Paragraph } = await import("docx");
  const huge = await Packer.toBuffer(new Document({ sections: [{ children: Array.from({ length: 1200 }, () => new Paragraph("Led a team that delivered results across many projects and stakeholders")) }] }));
  await assert.rejects(extractText(new Uint8Array(huge), "cv.docx"), (e: unknown) => e instanceof ExtractError && /far more text/.test((e as Error).message));
});

test("guardrails: 'highly relevant' needs a sector term in the bullet", async () => {
  const { applyGuardrails } = await import("@/lib/analysis/judgment");
  const { SECTOR_KEYWORDS } = await import("@/lib/analysis/lexicon");
  const kw = SECTOR_KEYWORDS["Finance and banking"];
  const best = { result: "measured", verb: "strong", kind: "achievement", relevance: "high" } as const;
  assert.equal(applyGuardrails("Captained the hockey team to 3 wins", best, kw).relevance, "some");
  assert.equal(applyGuardrails("Built a valuation model in Excel for 12 companies", best, kw).relevance, "high");
});

test("private address list covers site-local, 6to4 and Teredo but not real hosts", () => {
  for (const ip of ["fec0::1", "2002:c0a8:101::1", "2001:0:4136:e378::1", "2001::1"]) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ["2001:4860:4860::8888", "2a03:2880::1"]) assert.equal(isPrivateAddress(ip), false, ip);
});

test("CSV export cells can't smuggle formulas or extra rows", async () => {
  const { csvCell, toCsv } = await import("@/lib/csv");
  assert.equal(csvCell("=HYPERLINK(\"x\")").startsWith("\"'="), true);
  assert.equal(csvCell("Science\r=cmd|' /C calc'!A0").includes("\r"), false);
  assert.equal(csvCell("\t@SUM(A1)").startsWith("' @") || csvCell("\t@SUM(A1)").startsWith("\"' @"), true);
  assert.equal(toCsv([["a", "b"], ["c\nd", "e"]]).split("\n").length, 2, "no injected rows");
});

test("in-memory rate limiter blocks after the limit", async () => {
  const { hit, LIMITS } = await import("@/lib/rate-limit");
  const subject = `t-${Math.random()}`;
  const results = [];
  for (let i = 0; i < LIMITS.signInPerEmail.max + 1; i++) results.push(await hit("signInPerEmail", subject));
  assert.equal(results.filter(Boolean).length, LIMITS.signInPerEmail.max);
  assert.equal(results[results.length - 1], false);
});
