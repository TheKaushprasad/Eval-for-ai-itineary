/**
 * Copies itineraries from an eval run into data/examples/, where the home page shows them as
 * free example trips. Pick cases that passed their checks.
 *
 *   npm run eval:examples -- --ids core-goa-relaxed,diet-jain-jaipur [run.json]
 */
import { join } from "node:path";
import type { Example } from "@/lib/examples";
import { EXAMPLES_DIR } from "@/lib/examples";
import { listRuns, loadCases, parseArgs, readRun, writeJson } from "./shared";

const args = parseArgs();
const file = args.positional[0] ?? listRuns().at(-1);
if (!file) throw new Error("No runs yet. Run npm run eval first.");
const ids = args.str("ids")?.split(",");
if (!ids?.length) throw new Error("Pass --ids case-a,case-b");

const run = readRun(file);
const cases = new Map(loadCases().map((c) => [c.id, c]));

for (const id of ids) {
  const r = run.cases.find((c) => c.id === id);
  const def = cases.get(id);
  if (!r?.ok || !r.itinerary || !def) {
    console.error(`✗ ${id}: not in this run or has no itinerary`);
    process.exitCode = 1;
    continue;
  }
  const failed = r.checks.filter((c) => c.status === "fail").map((c) => c.id);
  if (failed.length) console.warn(`! ${id} failed ${failed.join(", ")}; showing it anyway`);
  const q = def.request;
  const example: Example = {
    id,
    title: r.itinerary.title,
    blurb: `${q.days} day${q.days === 1 ? "" : "s"} · ${q.origin} → ${q.destination} · ${q.tripStyle} · ${q.food}`,
    source: `eval run ${run.label} (${run.provider ?? "openai"}/${run.model})`,
    request: q,
    result: {
      itinerary: r.itinerary,
      budgetLimit: r.budgetLimit,
      computedTotal: r.computedTotal ?? 0,
      withinBudget: r.withinBudget ?? false,
      revised: r.revised,
      emailed: "skipped",
      warnings: r.warnings,
    },
  };
  writeJson(join(EXAMPLES_DIR, `${id}.json`), example);
  console.log(`✓ ${id} → data/examples/${id}.json`);
}
