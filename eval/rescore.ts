/**
 * Re-runs the code checks on a saved run's itineraries, without calling any model. Use it after
 * fixing a grader so the change in numbers reflects the grader, not a new (random) model sample.
 *
 *   npm run eval:rescore              latest run
 *   npm run eval:rescore -- <run.json>
 *
 * The context each check needs is rebuilt by replaying the case's snapshot through runPipeline
 * with a "model" that returns the saved itinerary. budgetArithmetic needs the model's own budget
 * figures; runs saved before those were stored keep their original budgetArithmetic result.
 */
import { runPipeline } from "@/lib/pipeline";
import type { Itinerary } from "@/lib/schema";
import { runChecks, type PipelineContext } from "./graders/checks";
import { formatSummary, summarize } from "./metrics";
import { readSnapshot, replayDeps } from "./snapshot";
import { errMessage, listRuns, loadCases, parseArgs, readRun, writeJson } from "./shared";

async function main() {
  const args = parseArgs();
  const file = args.positional[0] ?? listRuns().at(-1);
  if (!file) throw new Error("No runs yet. Run npm run eval first.");
  const run = readRun(file);
  const defs = new Map(loadCases().map((c) => [c.id, c]));
  let changed = 0;

  for (const c of run.cases) {
    const def = defs.get(c.id);
    const snap = readSnapshot(c.id);
    if (!c.ok || !c.itinerary || !def || !snap) continue;
    const saved: Itinerary = c.itinerary;
    let context: PipelineContext | null = null;
    const replay = async (_req: unknown, ctx: unknown) => {
      context = ctx as PipelineContext;
      return saved;
    };
    try {
      await runPipeline({ ...def.request, email: "" }, () => {}, replayDeps(snap, { generateItinerary: replay, reviseForBudget: replay }));
    } catch (e) {
      console.error(`✗ ${c.id}: ${errMessage(e)}`);
      continue;
    }
    const raw = c.rawBudget ? { ...saved, budget: c.rawBudget } : saved;
    const checks = runChecks({ req: { ...def.request, email: "" }, expect: def.expect, itinerary: saved, raw, context, budgetLimit: c.budgetLimit });
    if (!c.rawBudget) {
      const old = c.checks.find((x) => x.id === "budgetArithmetic");
      if (old) checks[checks.findIndex((x) => x.id === "budgetArithmetic")] = old;
    }
    const before = c.checks.filter((x) => x.status === "pass").length;
    const after = checks.filter((x) => x.status === "pass").length;
    if (JSON.stringify(checks) !== JSON.stringify(c.checks)) {
      changed++;
      console.log(`↻ ${c.id.padEnd(32)} passed ${before} → ${after}`);
    }
    c.checks = checks;
  }

  run.rescoredAt = new Date().toISOString();
  writeJson(file, run);
  console.log(`\nRe-graded ${changed} case(s) in ${file}\n\n${formatSummary(summarize(run))}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
