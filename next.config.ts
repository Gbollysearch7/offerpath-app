import path from "node:path";
import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { assertBuildEnv } from "./src/lib/env";

const nextConfig: NextConfig = {
  // This app is its own workspace; stops Next picking up lockfiles in parent folders.
  outputFileTracingRoot: path.join(__dirname),
  // CV uploads go through server actions; allow the 2 MB file plus form overhead.
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
  // The dictionary packages read their .aff/.dic files relative to themselves, so they stay unbundled.
  serverExternalPackages: ["unpdf", "mammoth", "nspell", "dictionary-en-gb", "dictionary-en"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      // A share link is a secret in a URL: it must not reach another site as a referrer, or be indexed or stored. Later entries win.
      {
        source: "/share/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
    ];
  },
};

// A production build with required variables missing fails here, instead of deploying something that can't serve.
export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD) assertBuildEnv();
  return nextConfig;
}
