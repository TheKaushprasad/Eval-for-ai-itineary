import { runChecks, type PipelineContext } from "@/eval/graders/checks";
import { defaultDeps, runPipeline, type Deps } from "./pipeline";
import type { Itinerary, ItineraryResult, StreamEvent, TripRequest } from "./schema";

/**
 * Runs the planner and grades the plan with the eval harness's code checks (no extra model
 * calls, so it's free and instant). Visitors see the same checks the eval dashboard reports.
 */
export async function planAndGrade(req: TripRequest, emit: (e: StreamEvent) => void, deps: Deps = defaultDeps): Promise<ItineraryResult> {
  const seen: { context: PipelineContext | null; outputs: Itinerary[] } = { context: null, outputs: [] };
  const result = await runPipeline(req, emit, {
    ...deps,
    generateItinerary: async (r, ctx, limit) => {
      seen.context = ctx as PipelineContext;
      const it = await deps.generateItinerary(r, ctx, limit);
      seen.outputs.push(it);
      return it;
    },
    reviseForBudget: async (...args) => {
      const it = await deps.reviseForBudget(...args);
      seen.outputs.push(it);
      return it;
    },
  });
  const raw = (result.revised ? seen.outputs.at(-1) : seen.outputs[0]) ?? result.itinerary;
  try {
    const checks = runChecks({
      req,
      expect: { mustMention: [], mustAvoid: [] },
      itinerary: result.itinerary,
      raw,
      context: seen.context,
      budgetLimit: result.budgetLimit,
    });
    return { ...result, checks };
  } catch {
    return result; // grading is a bonus; never fail the plan because of it
  }
}
