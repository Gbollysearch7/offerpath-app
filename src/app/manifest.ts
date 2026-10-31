import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Offerpath",
    short_name: "Offerpath",
    description: "From first draft to signed offer. CV reviews, job tailoring and cover letters for UK students.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#F2F4F1",
    theme_color: "#F2F4F1",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
