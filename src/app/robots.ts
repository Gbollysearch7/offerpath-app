import type { MetadataRoute } from "next";

// Only the public pages are indexable. Everything behind sign-in is private.
export default function robots(): MetadataRoute.Robots {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  return {
    rules: { userAgent: "*", allow: ["/$", "/legal/"], disallow: "/" },
    ...(site ? { sitemap: `${site}/sitemap.xml` } : {}),
  };
}
