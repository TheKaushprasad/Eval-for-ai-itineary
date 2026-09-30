/**
 * Prints (and saves as Markdown next to the run) a results table.
 *
 *   npm run eval:report                       latest run
 *   npm run eval:report -- results/<run>.json a specific run
 *   npm run eval:report -- --compare [a b]    latest two runs, or a → b
 */
import { writeFileSync } from "node:fs";
import { compare, formatComparison, formatSummary, summarize } from "./metrics";
import { listRuns, parseArgs, readRun } from "./shared";

const args = parseArgs();
const runs = listRuns();

if (args.has("compare")) {
  const [a, b] = args.positional.length >= 2 ? args.positional : runs.slice(-2);
  if (!a || !b) throw new Error("Need two runs to compare (pass two files or run the eval twice).");
  const out = formatComparison(compare(readRun(a), readRun(b)));
  console.log(out);
  writeFileSync(b.replace(/\.json$/, ".compare.md"), out + "\n");
} else {
  const file = args.positional[0] ?? runs.at(-1);
  if (!file) throw new Error("No runs yet. Run npm run eval first.");
  const out = formatSummary(summarize(readRun(file)));
  console.log(out);
  writeFileSync(file.replace(/\.json$/, ".md"), out + "\n");
}
