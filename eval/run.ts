/**
 * Runs the eval: every case goes through the real runPipeline with replayed data sources, then
 * the deterministic checks and the LLM judge grade the result.
 *
 *   npm run eval -- --label v1-baseline [--only diet|starter] [--ids a,b] [--limit 3]
 *                   [--concurrency 3] [--no-judge] [--live] [--max-cost 0.50]
 *
 * --max-cost stops starting new cases once the estimated USD spend (itinerary + judge) reaches
 * the cap; cases already in flight still finish, so leave some headroom.
 */
import { join } from "node:path";
import { MODEL, PROVIDER, REASONING_EFFORT } from "@/lib/openai";
import { assertIndependentJudge, judge, JUDGE_MODEL, JUDGE_PROVIDER } from "./graders/judge";
import { formatSummary, summarize } from "./metrics";
import { failedResult, judgeCostUsd, runCase } from "./runner";
import { git, loadCases, parseArgs, pool, RESULTS_DIR, selectCases, writeJson, type RunFile } from "./shared";

const args = parseArgs();
const label = (args.str("label") ?? "run").replace(/[^\w.-]+/g, "-");
const live = args.has("live");
const withJudge = !args.has("no-judge");
const maxCost = args.num("max-cost", Infinity);

async function main() {
  if (withJudge) assertIndependentJudge();
  const cases = selectCases(loadCases(), args);
  const model = `${PROVIDER}/${MODEL}${REASONING_EFFORT ? ` (effort ${REASONING_EFFORT})` : ""}`;
  const judgeName = withJudge ? `${JUDGE_PROVIDER}/${JUDGE_MODEL}` : "off";
  const cap = Number.isFinite(maxCost) ? `, max $${maxCost}` : "";
  console.log(`Running ${cases.length} cases (${live ? "live data" : "replayed snapshots"}, model ${model}, judge ${judgeName}${cap})\n`);

  const { sha, dirty } = git();
  const started = new Date();
  let spent = 0;
  const results = await pool(cases, args.num("concurrency", 3), async (c, i) => {
    const n = `[${String(i + 1).padStart(2)}/${cases.length}]`;
    if (spent >= maxCost) {
      console.log(`${n} - ${c.id.padEnd(32)} skipped (max cost reached)`);
      return failedResult(c, `skipped: --max-cost $${maxCost} reached`);
    }
    const r = await runCase(c, { live, judge: withJudge ? judge : null });
    spent += (r.costUsd ?? 0) + judgeCostUsd(r.judge);
    const passed = r.checks.filter((x) => x.status === "pass").length;
    const graded = r.checks.filter((x) => x.status !== "na").length;
    const line = r.ok
      ? `✓ ${c.id.padEnd(32)} ${(r.latencyMs / 1000).toFixed(0).padStart(4)}s  checks ${passed}/${graded}` +
        (r.judge ? `  judge ${r.judge.mean.toFixed(1)}` : "") +
        (r.revised ? "  (revised)" : "")
      : `✗ ${c.id.padEnd(32)} ${r.error}`;
    console.log(`${n} ${line}`);
    return r;
  });

  const run: RunFile = {
    label,
    createdAt: started.toISOString(),
    gitSha: sha,
    gitDirty: dirty,
    mode: live ? "live" : "replay",
    provider: PROVIDER,
    model: MODEL + (REASONING_EFFORT ? ` (effort ${REASONING_EFFORT})` : ""),
    judgeModel: withJudge ? `${JUDGE_PROVIDER}/${JUDGE_MODEL}` : null,
    cases: results,
  };
  const file = join(RESULTS_DIR, `${started.toISOString().replace(/[:.]/g, "-")}_${label}_${sha}.json`);
  writeJson(file, run);

  console.log(`\n${formatSummary(summarize(run))}`);
  console.log(`\nEstimated spend $${spent.toFixed(3)}. Saved ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
