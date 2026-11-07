// Renders the real tailor report view to HTML, from a stored payload on stdin, so a test can read what a student
// would see. Run without the react-server condition, because react-dom/server refuses to load under it. The
// router and the server actions are the only things replaced: neither is reachable while rendering.
/* eslint-disable @typescript-eslint/no-require-imports */
import { readFileSync } from "node:fs";
import Module from "node:module";

type Loader = (request: string, parent: unknown, isMain: boolean) => unknown;
const internal = Module as unknown as { _load: Loader };
const realLoad = internal._load;
internal._load = function load(request, parent, isMain) {
  if (request === "next/navigation") return { useRouter: () => ({ refresh() {} }) };
  if (request === "@/app/actions/tailor") return { createTailoredVersion: async () => ({}), toggleKeyword: async () => ({}) };
  return realLoad(request, parent, isMain);
};

const React = require("react") as typeof import("react");
// The project compiles JSX for Next; outside it, tsx falls back to the classic runtime and needs this global.
(globalThis as { React?: unknown }).React = React;
const { createElement } = React;
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
const { fromStored } = require("@/lib/report-schema") as typeof import("@/lib/report-schema");
const { TailorView } = require("../../src/app/tailor/[id]/TailorView") as typeof import("../../src/app/tailor/[id]/TailorView");
const { editView } = require("@/lib/analysis/tailor-edits") as typeof import("@/lib/analysis/tailor-edits");

const input = JSON.parse(readFileSync(0, "utf8"));
// `{ payload, cv }` renders a report with versions, worked out as the page does; a bare payload renders as saved.
const stored = input.payload ?? input;
const p = fromStored("tailor", stored) as import("@/lib/types").TailorPayload;
const view = input.payload ? editView(p, input.cv ?? null) : undefined;
process.stdout.write(renderToStaticMarkup(createElement(TailorView, { id: "report", p, view, subtitle: "Compared with cv.pdf" })));
