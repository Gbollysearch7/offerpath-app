"use client";

import { Bar, Check, Stage, Text } from "@/components/stageshow/kit";
import "./PrivacyCard.css";

// Offerpath, section 05 (trust), left column under the heading on a white
// page. A still: the student's own privacy screen, cropped to its "Your data"
// card. The card runs off the right and bottom of a canvas-colored stage, the
// way the product's pages sit on #f2f4f1. Real words only on what the trust
// claims are about: who controls the data, where it is stored, how scores are
// labelled, and the two controls the student owns (download, delete). The
// satellite is the result of "Download my data": an export-ready toast
// straddling the card's left edge over filler.
//
// Real strings: the title, three facts, two buttons, the toast.
// Sample data only: University of Northfield is fictional.

const FACTS: {
  label: string;
  value: "text" | "region" | "ai";
  text: string;
}[] = [
  { label: "CONTROLLER", value: "text", text: "University of Northfield" },
  { label: "STORED IN", value: "region", text: "" },
  { label: "SCORES", value: "ai", text: "" },
];

export function PrivacyCard() {
  return (
    <div
      className="op-trust-root"
      role="img"
      aria-label="Sample product preview: a student's Privacy and my data screen in Offerpath, showing the university as data controller, data stored in the UK or EU, scores labelled as AI-assisted guidance, buttons to download or delete their data, and an Export ready message. Fictional data."
    >
      <Stage
        width={460}
        height={340}
        compact={{ below: 460, width: 358, height: 356 }}
        className="op-trust"
      >
        {() => (
          <>
            <div className="op-trust-card">
              <div className="op-trust-head">
                <Text className="op-trust-title">Privacy and my data</Text>
              </div>
              <div className="op-trust-facts">
                {FACTS.map((f) => (
                  <div key={f.label} className="op-trust-fact">
                    <Text className="op-trust-label">{f.label}</Text>
                    {f.value === "text" && (
                      <Text className="op-trust-value">{f.text}</Text>
                    )}
                    {f.value === "region" && (
                      <span className="op-trust-chip">UK or EU</span>
                    )}
                    {f.value === "ai" && (
                      <span className="op-trust-ai">AI-ASSISTED GUIDANCE</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="op-trust-actions">
                <span className="op-trust-btn op-trust-btn--solid">
                  Download my data
                </span>
                <span className="op-trust-btn op-trust-btn--line">
                  Delete my account
                </span>
              </div>
              {/* Filler: the next section of the page, under the toast */}
              <div className="op-trust-next">
                <Bar w={96} h={6} tone={2} />
                <div className="op-trust-stats">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="op-trust-stat">
                      <Bar w={18} h={10} r={3} tone={3} />
                      <Bar w={[54, 46, 60][i]!} h={5} tone={2} />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {
              <div className="op-trust-toast" role="status">
                <Check on size={18} className="op-trust-check" />
                <div className="op-trust-toast-copy">
                  <Text className="op-trust-toast-title">Export ready</Text>
                  <Text className="op-trust-toast-sub">
                    CVs, reports, letters
                  </Text>
                </div>
              </div>
            }
          </>
        )}
      </Stage>
    </div>
  );
}

export default PrivacyCard;
