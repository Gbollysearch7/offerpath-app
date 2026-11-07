// Run on its own by tests/security-uploads.test.ts: a worker that prints, through the real parseInWorker. The output of this process is what's checked.
import { createRequire } from "node:module";
import { join } from "node:path";
import { parseInWorker } from "@/lib/analysis/extract";

const req = createRequire(join(process.cwd(), "package.json"));
const source = `const { parentPort } = require("node:worker_threads"); console.log("CANARY-OUT"); console.error("CANARY-ERR"); setTimeout(() => parentPort.postMessage({ text: "ok" }), 50);`;
void parseInWorker("pdf", new Uint8Array(1), { unpdf: req.resolve("unpdf"), mammoth: req.resolve("mammoth") }, source).then((r) => {
  setTimeout(() => {
    console.log(`worker answered: ${r.text}`);
    process.exit(0);
  }, 100);
});
