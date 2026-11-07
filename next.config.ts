import path from "node:path";
import type { NextConfig } from "next";

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
    ];
  },
};

export default nextConfig;
