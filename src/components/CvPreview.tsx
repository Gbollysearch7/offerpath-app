import type { CSSProperties } from "react";
import { contactLine, FONTS, taglineColour, tint, type CvTheme } from "@/lib/cv-themes";
import type { DocBlock } from "@/lib/documents-types";

// An A4 page drawn in HTML with the same theme the Word and PDF files use. 1pt = 4/3 px at 96 dpi.

const PAGE = { w: 794, h: 1123 };
const GREY = "#4A5550";
const pt = (n: number) => `${n}pt`;

export function CvPreview({ blocks, theme, scale = 1, clip = true, label }: { blocks: DocBlock[]; theme: CvTheme; scale?: number; clip?: boolean; label: string }) {
  const margin = (theme.space < 0.9 ? 800 : theme.space > 1.1 ? 1150 : 1000) / 15;
  const n = theme.nameStyle;
  const h = theme.heading;
  const colour = (accent: boolean) => (accent ? theme.accent : "#111111");
  const gap = (p: number) => pt(p * theme.space);

  const headingStyle: CSSProperties = {
    margin: `${gap(11)} 0 ${gap(5)}`,
    fontSize: pt(h.size),
    fontWeight: 700,
    letterSpacing: pt(h.tracking),
    textTransform: h.upper ? "uppercase" : "none",
    color: h.style === "band" ? theme.accent : colour(h.accent),
    ...(h.style === "rule" && { borderBottom: `1px solid ${colour(h.accent)}`, paddingBottom: 2 }),
    ...(h.style === "rule-above" && { borderTop: `1.2px solid ${colour(h.accent)}`, paddingTop: 6 }),
    ...(h.style === "double" && { borderBottom: `3px double ${colour(h.accent)}`, paddingBottom: 2 }),
    ...(h.style === "band" && { background: tint(theme.accent), padding: "2px 5px", marginLeft: -4, marginRight: -4 }),
    ...(h.style === "bar" && { borderLeft: `3px solid ${theme.accent}`, paddingLeft: 9 }),
  };

  const sheet = (
    <div
      style={{
        width: PAGE.w,
        minHeight: PAGE.h,
        boxSizing: "border-box",
        padding: margin,
        background: "#FFFFFF",
        color: "#111111",
        fontFamily: FONTS[theme.font].css,
        fontSize: pt(theme.body),
        lineHeight: 1.35,
        // zoom, unlike transform, shrinks the layout box too.
        zoom: scale,
        textAlign: "left",
      }}
    >
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "name":
            return (
              <p key={i} style={{ margin: `0 0 ${gap(3)}`, fontSize: pt(n.size), fontWeight: n.bold ? 700 : 400, letterSpacing: pt(n.tracking), textTransform: n.upper ? "uppercase" : "none", color: colour(n.accent), textAlign: n.align, lineHeight: 1.15 }}>
                {b.text}
              </p>
            );
          case "tagline":
            return (
              <p key={i} style={{ margin: `0 0 ${gap(3)}`, fontSize: pt(theme.body + 1), color: taglineColour(theme), textAlign: n.align }}>
                {b.text}
              </p>
            );
          case "contact":
            return (
              <p key={i} style={{ margin: `0 0 ${gap(9)}`, fontSize: pt(theme.body - 1), color: GREY, textAlign: n.align, textWrap: "balance", ...(theme.headerRule && { borderBottom: "1px solid #BFC7C2", paddingBottom: 6 }) }}>
                {contactLine(b.text)}
              </p>
            );
          case "heading":
            return (
              <p key={i} style={headingStyle}>
                {b.text}
              </p>
            );
          case "role":
            return theme.date === "right" ? (
              <p key={i} style={{ margin: `${gap(6)} 0 ${gap(2)}`, display: "flex", justifyContent: "space-between", gap: 12 }}>
                <b>{b.text}</b>
                {b.date && <span style={{ color: GREY, fontSize: pt(theme.body - 0.5), whiteSpace: "nowrap" }}>{b.date}</span>}
              </p>
            ) : theme.date === "inline" ? (
              <p key={i} style={{ margin: `${gap(6)} 0 ${gap(2)}` }}>
                <b>{b.text}</b>
                {b.date && <span style={{ color: GREY }}>{`  ·  ${b.date}`}</span>}
              </p>
            ) : (
              <p key={i} style={{ margin: `${gap(6)} 0 ${gap(2)}` }}>
                <b>{b.text}</b>
                {b.date && <span style={{ display: "block", color: GREY, fontStyle: "italic", fontSize: pt(theme.body - 0.5) }}>{b.date}</span>}
              </p>
            );
          case "bullet":
            return (
              <p key={i} style={{ margin: `0 0 ${gap(2.5)}`, display: "flex", gap: 7, paddingLeft: 6 }}>
                <span aria-hidden="true" style={{ color: theme.accent, fontWeight: 700 }}>
                  {theme.bullet}
                </span>
                <span>{b.text}</span>
              </p>
            );
          case "note":
            return (
              <p key={i} style={{ margin: "0 0 12px", fontSize: pt(8.5), fontStyle: "italic", color: "#5C6B66" }}>
                {b.text}
              </p>
            );
          default:
            return (
              <p key={i} style={{ margin: `0 0 ${gap(5.5)}`, whiteSpace: "pre-line" }}>
                {b.text}
              </p>
            );
        }
      })}
    </div>
  );

  return (
    <div role="img" aria-label={label} style={{ width: PAGE.w * scale, height: clip ? PAGE.h * scale : undefined, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.12)", borderRadius: 4, background: "#FFFFFF" }}>
      {sheet}
    </div>
  );
}
