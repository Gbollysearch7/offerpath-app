// Calibration: compares Offerpath with independent careers advisers, on data kept apart from any tuning.
// Start at docs/CALIBRATION_RUNBOOK.md. `npm run calibrate -- --help` lists the steps; the code is in scripts/calibration/.
//
// This builds tools only. It holds no real result. Recruiting reviewers, consented examples and agreed thresholds are
// human gates that remain open, and nothing here can pass them.
import { runCli } from "./calibration/cli";

void runCli(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
