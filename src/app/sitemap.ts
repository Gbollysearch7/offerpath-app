import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
  return ["", "/legal/privacy", "/legal/terms", "/legal/accessibility", "/legal/cookies", "/legal/sub-processors"].map((p) => ({ url: `${site}${p}` }));
}
