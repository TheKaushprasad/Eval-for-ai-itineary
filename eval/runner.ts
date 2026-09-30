import { defaultDeps, runPipeline, type Deps } from "@/lib/pipeline";
import { generateItinerary, reviseForBudget, type Usage } from "@/lib/llm";
import type { Itinerary, TripRequest } from "@/lib/schema";
import { runChecks, type PipelineContext } from "./graders/checks";
import type { JudgeResult } from "./graders/judge";
import { costUsd } from "./pricing";
import { readSnapshot, replayDeps, type Snapshot } from "./snapshot";
import { errMessage, requestHash, type CaseResult, type EvalCase } from "./shared";

export type RunOptions = {
  /** Call the real data sources instead of replaying snapshots. */
  live?: boolean;
  /** Grader for the subjective dimensions; null skips it. */
  judge: ((req: TripRequest, it: Itinerary) => Promise<JudgeResult>) | null;
  /** The itinerary model; injectable so the harness can be tested without API calls. */
  llm?: { generateItinerary: typeof generateItinerary; reviseForBudget: typeof reviseForBudget };
  loadSnapshot?: (id: string) => Snapshot | null;
};

/** Runs one case through the real pipeline and grades the result. Never throws. */
export async function runCase(c: EvalCase, opts: RunOptions): Promise<CaseResult> {
  const llm = opts.llm ?? { generateItinerary, reviseForBudget };
  const base = {
    id: c.id,
    category: c.category,
    tags: c.tags,
    latencyMs: 0,
    revised: false,
    withinBudget: null,
    computedTotal: null,
    budgetLimit: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: null,
    warnings: [],
    checks: [],
  } satisfies Partial<CaseResult>;

  // Capture what the model saw, what it answered, and what that cost.
  const usage: Usage[] = [];
  const onUsage = (u: Usage) => usage.push(u);
  const seen: { context: PipelineContext | null } = { context: null };
  const outputs: Itinerary[] = [];
  const capture: Partial<Deps> = {
    generateItinerary: async (req, ctx, limit) => {
      seen.context = ctx as PipelineContext;
      const it = await llm.generateItinerary(req, ctx, limit, onUsage);
      outputs.push(it);
      return it;
    },
    reviseForBudget: async (req, ctx, limit, draft, overBy) => {
      const it = await llm.reviseForBudget(req, ctx, limit, draft, overBy, onUsage);
      outputs.push(it);
      return it;
    },
  };

  let deps: Deps;
  if (opts.live) {
    deps = { ...defaultDeps, sendItineraryEmail: async () => {}, ...capture };
  } else {
    const snap = (opts.loadSnapshot ?? readSnapshot)(c.id);
    if (!snap) return { ...base, ok: false, error: "no snapshot; run npm run eval:record first" };
    if (snap.requestHash !== requestHash(c.request)) {
      return { ...base, ok: false, error: "snapshot is stale (case changed); re-record with --force" };
    }
    deps = replayDeps(snap, capture);
  }

  const req = { ...c.request, email: "" };
  const t0 = Date.now();
  try {
    const result = await runPipeline(req, () => {}, deps);
    const latencyMs = Date.now() - t0;
    // The pipeline keeps the revision only if it's cheaper; `raw` is whichever it kept.
    const raw = result.revised ? outputs[outputs.length - 1] : outputs[0];
    const checks = runChecks({
      req,
      expect: c.expect,
      itinerary: result.itinerary,
      raw,
      context: seen.context,
      budgetLimit: result.budgetLimit,
    });

    const warnings = [...result.warnings];
    let judged: JudgeResult | undefined;
    if (opts.judge) {
      try {
        judged = await opts.judge(req, result.itinerary);
      } catch (e) {
        warnings.push(`judge: ${errMessage(e)}`);
      }
    }

    // Cost of producing the itinerary only; the judge is eval overhead.
    const costs = usage.map((u) => costUsd(u.model, u.inputTokens, u.outputTokens));
    return {
      ...base,
      ok: true,
      latencyMs,
      revised: result.revised,
      withinBudget: result.withinBudget,
      computedTotal: result.computedTotal,
      budgetLimit: result.budgetLimit,
      inputTokens: usage.reduce((a, u) => a + u.inputTokens, 0),
      outputTokens: usage.reduce((a, u) => a + u.outputTokens, 0),
      costUsd: !costs.length || costs.some((x) => x === null) ? null : costs.reduce<number>((a, x) => a + (x ?? 0), 0),
      warnings,
      checks,
      judge: judged,
      itinerary: result.itinerary,
    };
  } catch (e) {
    return { ...base, ok: false, error: errMessage(e), latencyMs: Date.now() - t0 };
  }
}
