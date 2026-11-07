import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { analyseCv } from "@/lib/analysis/cv";
import { ImportError, loadDataset, groupCount, unlistedFiles, type Dataset } from "./dataset";
import { DEFAULT_SECTOR, fileJudgmentStore, judgedPredictor, readAllTexts, rulesPredictor, type Predictor } from "./engine";
import { CalibrationRefusal, HUMAN_GATES, ILLUSTRATIVE_BANNER, illustrativeDemoItems, SYNTHETIC_BANNER } from "./evidence";
import type { Thresholds } from "./gates";
import { readOp015Reviews, writeOp015Pack } from "./op015";
import { renderDemo, renderReport, syntheticFooter } from "./report";
import { assertUsable, BLUEPRINT_MINIMUM_GROUPS, evaluate, freezeDataset, saveReport } from "./run";
import { anonymiseIntake, importSheet, writeFindingSheets, writeMarkingSheets, writeRewriteSheets, type ImportKind } from "./sheets";
import { createSplit, docsInSplit, type SplitName } from "./split";
import { buildSyntheticDataset, syntheticThresholds } from "./synthetic";

// The calibration command line. Exit codes: 0 done; 1 bad input; 2 held-out thresholds not met or inconclusive;
// 3 refused because accepting the request would misrepresent evidence.

export const EXIT = { ok: 0, input: 1, thresholds: 2, refused: 3 } as const;

const USAGE = `Offerpath calibration tools. docs/CALIBRATION_RUNBOOK.md says when to use each step.

  npm run calibrate -- anonymise --intake F --raw D --out D --key-out F --name N --version V
  npm run calibrate -- validate --dir D
  npm run calibrate -- split --dir D [--heldout-share 0.4]
  npm run calibrate -- marking-sheets --dir D
  npm run calibrate -- import --dir D --sheet marks|findings|missed|rewrites --file F
  npm run calibrate -- findings-sheets --dir D --split development|heldout
  npm run calibrate -- rewrite-sheets --dir D
  npm run calibrate -- evaluate --dir D --split development
  npm run calibrate -- freeze --dir D --thresholds F
  npm run calibrate -- evaluate --dir D --split heldout --open-heldout
  npm run calibrate -- op015-pack --out D
  npm run calibrate -- op015-compare --reviews F

  npm run calibrate -- synthetic --out D     invented data, to see the whole flow. ${SYNTHETIC_BANNER}.
  npm run calibrate -- --demo                the layout, with made-up marks. ${ILLUSTRATIVE_BANNER}.

Add --ai --allow-paid-provider to evaluate or freeze to score with the paid judge. It sends CV text to the provider.`;

interface Args {
  command: string | null;
  flags: Set<string>;
  options: Map<string, string>;
}

const BOOLEAN_FLAGS = new Set(["demo", "ai", "allow-paid-provider", "open-heldout", "help"]);

function parseArgs(argv: string[]): Args {
  const flags = new Set<string>();
  const options = new Map<string, string>();
  let command: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
      if (BOOLEAN_FLAGS.has(name)) flags.add(name);
      else {
        const value = argv[++i];
        if (value === undefined || value.startsWith("--")) throw new ImportError([`--${name} needs a value.`]);
        options.set(name, value);
      }
    } else if (!command) command = a;
    else throw new ImportError([`Unexpected argument: ${a}`]);
  }
  return { command, flags, options };
}

const need = (args: Args, name: string): string => {
  const v = args.options.get(name);
  if (!v) throw new ImportError([`--${name} is required. Run with --help.`]);
  return v;
};

const toSplit = (raw: string): SplitName => {
  if (raw === "development" || raw === "heldout") return raw;
  throw new CalibrationRefusal(`--split must be development or heldout, got "${raw}". The two are never reported together.`);
};

/** The paid path needs two explicit flags and a key. Nothing else in this tool can reach a provider. */
async function predictorFor(args: Args, ds: Dataset): Promise<Predictor> {
  const sector = args.options.get("sector") ?? DEFAULT_SECTOR;
  if (!args.flags.has("ai")) return rulesPredictor(sector);
  if (!args.flags.has("allow-paid-provider")) throw new CalibrationRefusal("--ai calls a paid provider and sends it CV text. Add --allow-paid-provider once the consent records cover that.");
  const { aiEnabled, aiJudgeBullets } = await import("@/lib/ai");
  if (!aiEnabled()) throw new CalibrationRefusal("--ai needs ANTHROPIC_API_KEY, which isn't set.");
  const { AI_JUDGE_MODEL } = await import("@/lib/analysis/judgment");
  return judgedPredictor(
    async (b, s) => {
      const v = await aiJudgeBullets(b, s, 3);
      return new Map([...v].map(([id, js]) => [id, js.map(({ result, verb, kind, relevance }) => ({ result, verb, kind, relevance }))]));
    },
    AI_JUDGE_MODEL,
    sector,
    fileJudgmentStore(join(ds.dir, "judgments-cache.json")),
  );
}

type Out = (line: string) => void;

/** For steps that send material to people: a dataset that can't be used must not get that far. */
async function usable(dir: string): Promise<Dataset> {
  const ds = loadDataset(dir);
  await assertUsable(ds, await readAllTexts(ds));
  return ds;
}

function runDemo(args: Args, out: Out): number {
  // The demo stands alone. Combined with anything else it would look like a real run, so that is refused.
  if (args.command || args.options.size || args.flags.size > 1) throw new CalibrationRefusal(`--demo uses illustrative marks and can't be combined with anything else. ${ILLUSTRATIVE_BANNER}.`);
  const rows = illustrativeDemoItems().map((it) => {
    const a = analyseCv(it.text, DEFAULT_SECTOR);
    return { id: it.id, mark: it.mark, score: a.score, identity: a.meta.scoring?.identity ?? "unknown" };
  });
  out(renderDemo(rows, rows[0].identity));
  return EXIT.ok;
}

async function validate(dir: string, out: Out): Promise<number> {
  const ds = loadDataset(dir);
  const texts = await readAllTexts(ds);
  await assertUsable(ds, texts);
  const reviewed = new Set(ds.marks.map((m) => m.document_id));
  out(`Dataset ${ds.manifest.name} version ${ds.manifest.version}, kind ${ds.manifest.kind}.`);
  out(`Dataset hash: ${ds.dataHash}`);
  out(`${ds.documents.length} documents in ${groupCount(ds.documents)} independent groups. ${reviewed.size} documents have adviser marks, from ${ds.reviewers.length} listed reviewers.`);
  if (groupCount(ds.documents) < BLUEPRINT_MINIMUM_GROUPS) out(`Warning: the blueprint asks for at least ${BLUEPRINT_MINIMUM_GROUPS} groups. A report on this dataset can't reach "met".`);
  for (const f of unlistedFiles(ds)) out(`Warning: documents/${f} isn't in the manifest.`);
  out(ds.manifest.kind === "real" ? "Checks passed. Consent, independence and blinding are people's attestations, and this tool can't verify them." : `${SYNTHETIC_BANNER}. Open human gates:\n  ${HUMAN_GATES.join("\n  ")}`);
  return EXIT.ok;
}

async function runSynthetic(outDir: string, out: Out): Promise<number> {
  mkdirSync(outDir, { recursive: true });
  await buildSyntheticDataset(outDir);
  let ds = loadDataset(outDir);
  const texts = await readAllTexts(ds);
  createSplit(ds, new Map([...texts].map(([id, t]) => [id, t.text])));
  ds = loadDataset(outDir);
  const predictor = rulesPredictor();
  const dev = await evaluate(ds, { split: "development", predictor });
  const devPaths = saveReport(ds, dev, renderReport(dev));
  await freezeDataset(ds, syntheticThresholds(), predictor);
  const held = await evaluate(ds, { split: "heldout", predictor, openHeldout: true });
  const heldPaths = saveReport(ds, held, renderReport(held));
  const tally = (o: string) => held.gates.filter((g) => g.outcome === o).length;
  out(`${SYNTHETIC_BANNER}\n`);
  out(`Whole flow run on invented data in ${outDir}.`);
  out(`Development report: ${devPaths.md}\nHeld-out report: ${heldPaths.md}`);
  out(`Gate machinery exercised: ${held.gates.length} checks, ${tally("FAIL")} failed, ${tally("INCONCLUSIVE")} inconclusive, ${tally("PASS")} passed, run outcome ${held.outcome}.`);
  out(`These thresholds and marks are invented, so that outcome says nothing about Offerpath.`);
  out(`Report hash: ${held.report_hash}\n`);
  out(syntheticFooter);
  return EXIT.ok;
}

async function dispatch(args: Args, out: Out): Promise<number> {
  if (args.flags.has("demo")) return runDemo(args, out);
  if (args.flags.has("help") || !args.command) {
    if (!args.flags.has("help") && args.options.has("dir")) throw new CalibrationRefusal("Name a step, such as validate or evaluate. The old one-shot run mixed every CV together and is gone. See docs/CALIBRATION_RUNBOOK.md.");
    out(USAGE);
    return EXIT.ok;
  }
  switch (args.command) {
    case "anonymise": {
      const r = await anonymiseIntake({ intake: need(args, "intake"), raw: need(args, "raw"), out: need(args, "out"), keyOut: need(args, "key-out"), name: need(args, "name"), version: need(args, "version"), sector: args.options.get("sector") });
      out(`${r.documents} documents cleaned. ${r.flagged} lines need a person to review. Anonymising moved the score of ${r.scoreChanges} documents.`);
      out(`Log: ${r.log}\nThis does not make them anonymous. A person must read each document and sign it off in manifest.json, using docs/calibration/CONSENT_AND_ANONYMISATION_CHECKLIST.md.`);
      return EXIT.ok;
    }
    case "validate":
      return validate(need(args, "dir"), out);
    case "split": {
      const ds = loadDataset(need(args, "dir"));
      const texts = await readAllTexts(ds);
      await assertUsable(ds, texts);
      const share = args.options.has("heldout-share") ? Number(args.options.get("heldout-share")) : undefined;
      if (share !== undefined && !(share > 0 && share < 1)) throw new ImportError(["--heldout-share must be between 0 and 1."]);
      const lock = createSplit(ds, new Map([...texts].map(([id, t]) => [id, t.text])), share);
      const n = (s: SplitName) => docsInSplit(ds.documents, lock, s);
      out(`Split written. Development: ${n("development").length} documents in ${groupCount(n("development"))} groups. Held-out: ${n("heldout").length} documents in ${groupCount(n("heldout"))} groups.`);
      return EXIT.ok;
    }
    case "marking-sheets": {
      for (const p of writeMarkingSheets(await usable(need(args, "dir")))) out(p);
      return EXIT.ok;
    }
    case "import": {
      const r = importSheet(need(args, "dir"), need(args, "sheet") as ImportKind, need(args, "file"));
      out(`${r.added} rows added. ${r.leftBlank} rows left blank by the adviser and not added.`);
      return EXIT.ok;
    }
    case "findings-sheets": {
      const ds = await usable(need(args, "dir"));
      for (const p of await writeFindingSheets(ds, toSplit(need(args, "split")), await predictorFor(args, ds))) out(p);
      return EXIT.ok;
    }
    case "rewrite-sheets": {
      for (const p of writeRewriteSheets(await usable(need(args, "dir")))) out(p);
      return EXIT.ok;
    }
    case "freeze": {
      const ds = loadDataset(need(args, "dir"));
      const thresholds = JSON.parse(readFileSync(need(args, "thresholds"), "utf8")) as Thresholds;
      const f = await freezeDataset(ds, thresholds, await predictorFor(args, ds));
      out(`Frozen. Engine: ${f.engine_identity}\nThresholds hash: ${f.thresholds_hash}\nSend that hash to the pilot partner before opening held-out data.`);
      return EXIT.ok;
    }
    case "evaluate": {
      const ds = loadDataset(need(args, "dir"));
      const split = toSplit(need(args, "split"));
      const report = await evaluate(ds, { split, predictor: await predictorFor(args, ds), openHeldout: args.flags.has("open-heldout") });
      const text = renderReport(report);
      const paths = saveReport(ds, report, text);
      out(text);
      out(`Saved: ${paths.md}\nSaved: ${paths.json}`);
      return split === "heldout" && report.outcome !== "MET" ? EXIT.thresholds : EXIT.ok;
    }
    case "synthetic":
      return runSynthetic(need(args, "out"), out);
    case "op015-pack": {
      const r = writeOp015Pack(need(args, "out"));
      out(`${r.items} items. Send reviewers ${r.sheet} and the two CVs.\nKeep ${r.key} back: it holds the author's labels.`);
      return EXIT.ok;
    }
    case "op015-compare": {
      out(JSON.stringify(readOp015Reviews(need(args, "reviews")), null, 2));
      return EXIT.ok;
    }
    default:
      throw new ImportError([`Unknown step "${args.command}". Run with --help.`]);
  }
}

/** Runs one command and returns its exit code. Every failure ends here, so scripts can rely on the codes. */
export async function runCli(argv: string[], out: Out = console.log, err: Out = console.error): Promise<number> {
  try {
    return await dispatch(parseArgs(argv), out);
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    return e instanceof CalibrationRefusal ? EXIT.refused : EXIT.input;
  }
}
