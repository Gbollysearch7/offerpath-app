// Renders the real LinkedIn pages' client views to HTML so a test can read what a student would see. Run without the
// react-server condition, because react-dom/server refuses to load under it. Only the router and server actions are replaced.
/* eslint-disable @typescript-eslint/no-require-imports */
import { readFileSync } from "node:fs";
import Module from "node:module";

type Loader = (request: string, parent: unknown, isMain: boolean) => unknown;
const internal = Module as unknown as { _load: Loader };
const realLoad = internal._load;
internal._load = function load(request, parent, isMain) {
  if (request === "next/navigation") return { useRouter: () => ({ refresh() {}, push() {} }) };
  if (request.startsWith("@/app/actions/")) return new Proxy({}, { get: () => async () => ({}) });
  return realLoad(request, parent, isMain);
};

const React = require("react") as typeof import("react");
(globalThis as { React?: unknown }).React = React;
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
const { LinkedinStart } = require("../../src/app/linkedin/LinkedinStart") as typeof import("../../src/app/linkedin/LinkedinStart");
const { LinkedinReportView } = require("../../src/app/linkedin/[id]/LinkedinReportView") as typeof import("../../src/app/linkedin/[id]/LinkedinReportView");

const input = JSON.parse(readFileSync(0, "utf8"));
const start = renderToStaticMarkup(React.createElement(LinkedinStart, { cvs: [] }));
const report = renderToStaticMarkup(React.createElement(LinkedinReportView, input));
process.stdout.write(JSON.stringify({ start, report }));
