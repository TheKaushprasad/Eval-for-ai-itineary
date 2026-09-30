/**
 * Runs the eval: every case goes through the real runPipeline with replayed data sources, then
 * the deterministic checks and the LLM judge grade the result.
 *
 *   npm run eval -- --label v1-baseline [--only diet] [--ids a,b] [--limit 3]
 *                   [--concurrency 3] [--no-judge] [--live]
 */
import { join } from "node:path";
import { MODEL } from "@/lib/openai";
import { assertIndependentJudge, judge, JUDGE_MODEL } from "./graders/judge";
import { formatSummary, summarize } from "./metrics";
import { runCase } from "./runner";
import { git, loadCases, parseArgs, pool, RESULTS_DIR, selectCases, writeJson, type RunFile } from "./shared";

const args = parseArgs();
const label = (args.str("label") ?? "run").replace(/[^\w.-]+/g, "-");
const live = args.has("live");
const withJudge = !args.has("no-judge");

async function main() {
  if (withJudge) assertIndependentJudge();
  const cases = selectCases(loadCases(), args);
  console.log(`Running ${cases.length} cases (${live ? "live data" : "replayed snapshots"}, model ${MODEL}, judge ${withJudge ? JUDGE_MODEL : "off"})\n`);

  const { sha, dirty } = git();
  const started = new Date();
  const results = await pool(cases, args.num("concurrency", 3), async (c, i) => {
    const r = await runCase(c, { live, judge: withJudge ? judge : null });
    const passed = r.checks.filter((x) => x.status === "pass").length;
    const graded = r.checks.filter((x) => x.status !== "na").length;
    const line = r.ok
      ? `✓ ${c.id.padEnd(32)} ${(r.latencyMs / 1000).toFixed(0).padStart(4)}s  checks ${passed}/${graded}` +
        (r.judge ? `  judge ${r.judge.mean.toFixed(1)}` : "") +
        (r.revised ? "  (revised)" : "")
      : `✗ ${c.id.padEnd(32)} ${r.error}`;
    console.log(`[${String(i + 1).padStart(2)}/${cases.length}] ${line}`);
    return r;
  });

  const run: RunFile = {
    label,
    createdAt: started.toISOString(),
    gitSha: sha,
    gitDirty: dirty,
    mode: live ? "live" : "replay",
    model: MODEL,
    judgeModel: withJudge ? JUDGE_MODEL : null,
    cases: results,
  };
  const file = join(RESULTS_DIR, `${started.toISOString().replace(/[:.]/g, "-")}_${label}_${sha}.json`);
  writeJson(file, run);

  console.log(`\n${formatSummary(summarize(run))}`);
  console.log(`\nSaved ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
