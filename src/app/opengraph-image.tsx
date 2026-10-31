import { ImageResponse } from "next/og";

export const alt = "Offerpath: help every student reach their first offer, calmly.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#F2F4F1", padding: 72 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 40, color: "#000000" }}>
          <svg width="64" height="64" viewBox="0 0 28 28">
            <circle cx="14" cy="14" r="14" fill="#DCE6DF" />
            <path d="M8 17l4-4 3 3 5-6" fill="none" stroke="#36604E" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Offerpath
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 84, lineHeight: 1.1, letterSpacing: -3, color: "#000000" }}>
          <span>Help every student reach</span>
          <span style={{ display: "flex", gap: 22 }}>
            <span>their first offer,</span>
            <span style={{ color: "#36604E" }}>calmly.</span>
          </span>
        </div>
        <div style={{ display: "flex", fontSize: 30, color: "#45524D" }}>CV feedback and careers support for UK universities</div>
      </div>
    ),
    size,
  );
}
