// Renders the real letter page contents to HTML, from a stored payload on stdin, so a test can read what a student would see.
// Run without the react-server condition, because react-dom/server refuses to load under it. Only the router and the server actions
// are replaced: neither is reachable while rendering.
/* eslint-disable @typescript-eslint/no-require-imports */
import { readFileSync } from "node:fs";
import Module from "node:module";

type Loader = (request: string, parent: unknown, isMain: boolean) => unknown;
const internal = Module as unknown as { _load: Loader };
const realLoad = internal._load;
const stub = async () => ({});
internal._load = function load(request, parent, isMain) {
  if (request === "next/navigation") return { useRouter: () => ({ refresh() {}, push() {} }) };
  if (request === "@/app/actions/letters") return new Proxy({}, { get: () => stub });
  return realLoad(request, parent, isMain);
};

const React = require("react") as typeof import("react");
(globalThis as { React?: unknown }).React = React;
const { createElement } = React;
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
const { fromStored } = require("@/lib/report-schema") as typeof import("@/lib/report-schema");
const { letterExport, letterView } = require("@/lib/analysis/letter-edits") as typeof import("@/lib/analysis/letter-edits");
const { LEGACY_LETTER_NOTE } = require("@/lib/analysis/letter-content") as typeof import("@/lib/analysis/letter-content");
const { LetterWorkspace } = require("../../src/app/letters/[id]/LetterWorkspace") as typeof import("../../src/app/letters/[id]/LetterWorkspace");
const { LetterReviewView } = require("../../src/app/letters/[id]/LetterReviewView") as typeof import("../../src/app/letters/[id]/LetterReviewView");
const { LetterDraftView } = require("../../src/app/letters/[id]/LetterDraftView") as typeof import("../../src/app/letters/[id]/LetterDraftView");

const input = JSON.parse(readFileSync(0, "utf8"));
const p = fromStored("cover_letter", input.payload) as import("@/lib/types").CoverLetterPayload;
const view = letterView(p, input.cv ?? null);
const downloadable = letterExport(p).kind === "ready";
// The same choice the page makes.
const out = view && p.review
  ? createElement(LetterWorkspace, { id: "report", p, view, review: p.review, left: 5, limit: 10, ai: false })
  : createElement("div", null, createElement("p", { role: "note" }, LEGACY_LETTER_NOTE), p.mode === "draft" ? createElement(LetterDraftView, { id: "report", p, downloadable }) : createElement(LetterReviewView, { id: "report", p, score: input.score, downloadable }));
process.stdout.write(renderToStaticMarkup(out));
