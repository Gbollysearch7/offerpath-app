import { createHash, randomBytes } from "node:crypto";

// A share link is a bearer secret: whoever holds the URL can open it. The token is 256 random bits, shown once, and only
// its SHA-256 is stored, so a copy of the database can't be turned back into working links. A slow hash adds nothing
// here because there is no low-entropy input to protect.

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const newShareToken = () => randomBytes(32).toString("base64url");
export const hashShareToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const isWellFormedToken = (token: unknown): token is string => typeof token === "string" && TOKEN.test(token);
export const sharePath = (token: string) => `/share/${token}`;
