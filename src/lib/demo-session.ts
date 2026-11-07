import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/* Demo sessions are signed so a visitor can't forge someone else's id or an admin role. */
const g = globalThis as unknown as { __offerpathDemoSecret?: string };
const demoSecret = () => process.env.DEMO_SECRET || (g.__offerpathDemoSecret ??= randomBytes(32).toString("hex"));
const sign = (v: string) => createHmac("sha256", demoSecret()).update(v).digest("base64url");

export function signDemoSession(role: "student" | "admin" | "adviser", id: string): string {
  const v = `${role}:${id}`;
  return `${v}.${sign(v)}`;
}

/** Returns the verified session, or null if the cookie is missing, malformed or forged. */
export function readDemoSession(cookie: string | undefined): { role: "student" | "admin" | "adviser"; id: string } | null {
  if (!cookie) return null;
  const dot = cookie.lastIndexOf(".");
  if (dot < 0) return null;
  const v = cookie.slice(0, dot);
  const given = Buffer.from(cookie.slice(dot + 1));
  const expected = Buffer.from(sign(v));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const [role, id] = v.split(":");
  if ((role !== "student" && role !== "admin" && role !== "adviser") || !/^[0-9a-f-]{8,40}$/.test(id ?? "")) return null;
  return { role, id };
}
