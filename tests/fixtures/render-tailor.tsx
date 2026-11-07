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

const { createElement } = require("react") as typeof import("react");
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
const { fromStored } = require("@/lib/report-schema") as typeof import("@/lib/report-schema");
const { TailorView } = require("../../src/app/tailor/[id]/TailorView") as typeof import("../../src/app/tailor/[id]/TailorView");

const stored = JSON.parse(readFileSync(0, "utf8"));
const p = fromStored("tailor", stored) as import("@/lib/types").TailorPayload;
process.stdout.write(renderToStaticMarkup(createElement(TailorView, { id: "report", p, subtitle: "Compared with cv.pdf" })));
