import { z } from "zod";
import { parseProvider, PROVIDERS, structured } from "@/lib/ai";
import { MODEL, PROVIDER } from "@/lib/openai";
import type { Itinerary, TripRequest } from "@/lib/schema";

/** Defaults to the generator's provider with a different model; a different vendor is better still. */
export const JUDGE_PROVIDER = parseProvider(process.env.EVAL_JUDGE_PROVIDER, PROVIDER);
export const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL || PROVIDERS[JUDGE_PROVIDER].judgeModel;

export const JUDGE_DIMENSIONS = ["styleMatch", "pace", "logistics", "requirements", "helpfulness"] as const;
export type JudgeDimension = (typeof JUDGE_DIMENSIONS)[number];

const Score = z.object({
  reason: z.string().describe("One or two sentences citing specific days or items. Written before the score."),
  score: z.number().describe("Integer from 1 to 5"),
});

const JudgeSchema = z.object(Object.fromEntries(JUDGE_DIMENSIONS.map((d) => [d, Score])) as Record<JudgeDimension, typeof Score>);

export type JudgeResult = {
  model: string;
  scores: Record<JudgeDimension, { score: number; reason: string }>;
  mean: number;
  inputTokens: number;
  outputTokens: number;
};

export const JUDGE_RUBRIC = `You are a strict reviewer grading an AI-generated travel itinerary against the traveler's request.
Score each dimension from 1 to 5 using these anchors. Be critical: 5 is rare and means you would not change anything.

styleMatch — does the plan feel like the requested trip style (relaxed / balanced / adventure / cultural / family) and accommodation tier?
  1 = contradicts the style; 3 = generic plan that loosely fits; 5 = clearly tailored to the style throughout.
pace — is each day physically realistic (timings, travel between places, rest, arrival/departure days)?
  1 = impossible days or no time to travel; 3 = doable but rushed or padded in places; 5 = realistic timings everywhere.
logistics — are nearby places grouped, are routes sensible, are travel legs and check-in/out handled?
  1 = zig-zags across the region, missing legs; 3 = mostly sensible with some backtracking; 5 = efficient and complete.
requirements — does it honor the special requirements, additional info, food preference and travelers (children, elderly, accessibility)? If there are no special requirements, grade the food and traveler fit.
  1 = ignores or violates a stated requirement; 3 = acknowledges it but only partly applies it; 5 = every requirement visibly applied.
helpfulness — would a real traveler be able to follow this plan? Specific places, useful tips, honest about budget trade-offs.
  1 = vague or misleading; 3 = usable but generic; 5 = specific, practical and honest.

Judge only what is in the itinerary. Do not reward length. Give the reason first, then the score.`;

function describeRequest(req: TripRequest) {
  const kids = req.children ? `${req.children} (ages ${req.childAges.join(", ")})` : "none";
  return `Origin: ${req.origin}
Destination: ${req.destination}
Dates: ${req.startDate}, ${req.days} days
Travelers: ${req.adults} adults; children: ${kids}
Budget: ${req.budgetPerPerson} ${req.currency} per person
Travel mode: ${req.travelMode}; food: ${req.food}; style: ${req.tripStyle}; accommodation: ${req.accommodation}
Special requirements: ${req.specialRequirements || "none"}
Additional info: ${req.additionalInfo || "none"}`;
}

export function assertIndependentJudge() {
  if (JUDGE_PROVIDER === PROVIDER && JUDGE_MODEL === MODEL && !process.env.EVAL_ALLOW_SAME_JUDGE) {
    throw new Error(
      `The judge (${JUDGE_PROVIDER}/${JUDGE_MODEL}) is the same as the itinerary model; models tend to favor their own output. ` +
        `Set EVAL_JUDGE_PROVIDER / EVAL_JUDGE_MODEL to something else, or EVAL_ALLOW_SAME_JUDGE=1.`,
    );
  }
}

export async function judge(req: TripRequest, itinerary: Itinerary): Promise<JudgeResult> {
  const plan = { ...itinerary, sources: undefined };
  const { data, usage } = await structured({
    provider: JUDGE_PROVIDER,
    model: JUDGE_MODEL,
    input: [
      { role: "system", content: JUDGE_RUBRIC },
      { role: "user", content: `Traveler request
${describeRequest(req)}

Itinerary (JSON)
${JSON.stringify(plan)}` },
    ],
    schema: JudgeSchema,
    name: "itinerary_grade",
  });
  const scores = Object.fromEntries(
    JUDGE_DIMENSIONS.map((d) => [d, { score: Math.min(5, Math.max(1, Math.round(data[d].score))), reason: data[d].reason }]),
  ) as JudgeResult["scores"];
  const mean = JUDGE_DIMENSIONS.reduce((a, d) => a + scores[d].score, 0) / JUDGE_DIMENSIONS.length;
  return {
    model: `${JUDGE_PROVIDER}/${JUDGE_MODEL}`,
    scores,
    mean: Math.round(mean * 100) / 100,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
  };
}
