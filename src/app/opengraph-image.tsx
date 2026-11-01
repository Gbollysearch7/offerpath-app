import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Offerpath: help every student reach their first offer, calmly. A CV scored 72 with a line-by-line fix applied.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The product shot is the hero demo's final frame (public/og-hero.png, 2112×940), captured from the landing page.
export default async function OpengraphImage() {
  const shot = await readFile(join(process.cwd(), "public/og-hero.png"));
  const src = `data:image/png;base64,${shot.toString("base64")}`;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#FFFFFF", padding: "56px 72px 0" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 54, lineHeight: 1.1, letterSpacing: -2, color: "#000000" }}>
            <span>Help every student reach</span>
            <span style={{ display: "flex", gap: 14 }}>
              <span>their first offer,</span>
              <span style={{ color: "#36604E" }}>calmly.</span>
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 32, color: "#000000" }}>
            <svg width="48" height="48" viewBox="0 0 28 28">
              <circle cx="14" cy="14" r="14" fill="#DCE6DF" />
              <path d="M8 17l4-4 3 3 5-6" fill="none" stroke="#36604E" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Offerpath
          </div>
        </div>
        <img src={src} width={1056} height={470} alt="" style={{ marginTop: 40 }} />
      </div>
    ),
    size,
  );
}
