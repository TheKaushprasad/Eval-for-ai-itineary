/**
 * Regression gate: fails (exit 1) when a headline metric drops more than its tolerance below
 * results/baseline.json.
 *
 *   npm run eval:check                    latest run vs baseline
 *   npm run eval:check -- <run.json>      a specific run vs baseline
 *   npm run eval:check -- --update        promote the latest (or given) run to baseline
 */
import { copyFileSync, existsSync } from "node:fs";
import { compare, fmt, HEADLINE } from "./metrics";
import { BASELINE_FILE, listRuns, parseArgs, readRun } from "./shared";

const args = parseArgs();
const file = args.positional[0] ?? listRuns().at(-1);
if (!file) throw new Error("No runs yet. Run npm run eval first.");

if (args.has("update")) {
  copyFileSync(file, BASELINE_FILE);
  console.log(`Baseline is now ${file}`);
  process.exit(0);
}
if (!existsSync(BASELINE_FILE)) throw new Error("No baseline yet. Promote a run with npm run eval:check -- --update");

const baseline = readRun(BASELINE_FILE);
const current = readRun(file);
const cmp = compare(baseline, current);

let failed = 0;
console.log(`Gate: ${current.label} vs baseline ${baseline.label}\n`);
for (const { key, tolerance } of HEADLINE) {
  const row = cmp.rows.find((r) => r.key === key);
  if (!row || row.a === null || row.b === null) {
    console.log(`  ·  ${key.padEnd(16)} not measured in both runs`);
    continue;
  }
  const drop = row.a - row.b;
  const bad = drop > tolerance;
  if (bad) failed++;
  console.log(`  ${bad ? "✗" : "✓"}  ${key.padEnd(16)} ${fmt(key, row.a).padStart(6)} → ${fmt(key, row.b).padStart(6)}${bad ? `  (allowed drop ${fmt(key, tolerance)})` : ""}`);
}
if (cmp.regressions.length) {
  console.log(`\nCase-level regressions (${cmp.regressions.length}):`);
  for (const r of cmp.regressions.slice(0, 20)) console.log(`  - ${r.id} — ${r.what}`);
}
console.log(failed ? `\nFAILED: ${failed} headline metric(s) regressed.` : "\nPASSED");
process.exitCode = failed ? 1 : 0;
