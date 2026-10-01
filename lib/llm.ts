import { structured, type Message, type Usage } from "./ai";
import { MODEL, PROVIDER, REASONING_EFFORT } from "./openai";
import { ItinerarySchema, type Itinerary, type TripRequest } from "./schema";

const STYLE_PACE: Record<TripRequest["tripStyle"], string> = {
  relaxed: "2 main activities a day at most, late starts, long meals and free time",
  balanced: "2-3 activities a day with some downtime",
  adventure: "3-4 active outings a day (treks, water sports, outdoor experiences)",
  cultural: "3 activities a day focused on heritage, museums, local markets and food",
  family: "2-3 kid-friendly activities a day with rest breaks and early evenings",
};

const FOOD_RULE: Record<TripRequest["food"], string> = {
  vegetarian: "Every meal must be vegetarian (no meat, fish or eggs). Prefer pure-veg restaurants.",
  vegan: "Every meal must be vegan (no animal products).",
  jain: "Every meal must be Jain (vegetarian, no root vegetables, onion or garlic).",
  halal: "Every meal must be halal.",
  "non-vegetarian": "Include local non-vegetarian specialities.",
  "no-preference": "Mix local specialities freely.",
};

export const SYSTEM_PROMPT = `You are an expert travel planner. You turn a traveler's preferences plus research data into one practical, day-by-day itinerary.

Rules:
- Use ONLY the provided context for prices where available. Flight offers tagged "duffel" are live fares: use the cheapest suitable one as-is (convert to the trip currency if needed and say so in the description) and set source "duffel". Otherwise use web research (source "web") or a reasoned estimate (source "estimate").
- Prefer real, named places from the context (OSM places and web research). Don't invent venues; if unsure, describe the kind of place ("a beach shack in Palolem") instead.
- All costs are TOTALS for the whole group in the trip currency, not per person.
- Day 1 starts with travel from the origin; the last day ends with the return journey. Accommodation nights = days - 1.
- Order activities to fit the weather: put indoor or flexible plans on rainy/hot days, beaches and viewpoints on clear days.
- Group activities that are close together on the same day to reduce travel.
- If children travel, every activity must be suitable for their ages; mark kidFriendly accordingly.
- Keep the total (transport + accommodation + food + activities + local transport + buffer) within the budget. Include a buffer of about 5-10% of the budget for contingencies.
- budget fields must equal the sums of the line items.
- sources: include the URLs from web research that you relied on.`;

export function buildUserPrompt(req: TripRequest, context: unknown, limit: number) {
  const kids = req.children ? `${req.children} (ages ${req.childAges.join(", ")})` : "none";
  return `Traveler preferences
- From: ${req.origin}
- To: ${req.destination}
- Start date: ${req.startDate}, ${req.days} days
- Adults: ${req.adults}; children: ${kids}
- Budget: ${req.budgetPerPerson} ${req.currency} per person → TOTAL LIMIT ${limit} ${req.currency}
- Travel mode: ${req.travelMode}
- Food: ${FOOD_RULE[req.food]}
- Trip style: ${req.tripStyle} — ${STYLE_PACE[req.tripStyle]}
- Accommodation: ${req.accommodation}
- Special requirements: ${req.specialRequirements || "none"}
- Additional info: ${req.additionalInfo || "none"}

Context gathered from APIs and web research (JSON):
${JSON.stringify(context)}

Write the itinerary in ${req.currency}.`;
}

export type { Usage };
/** Optional token-usage hook; the eval harness uses it to track cost. */
export type OnUsage = (u: Usage) => void;

async function call(input: Message[], onUsage?: OnUsage): Promise<Itinerary> {
  const { data, usage } = await structured({
    provider: PROVIDER,
    model: MODEL,
    input,
    schema: ItinerarySchema,
    name: "itinerary",
    effort: REASONING_EFFORT,
  });
  if (usage) onUsage?.(usage);
  return data;
}

export function generateItinerary(req: TripRequest, context: unknown, limit: number, onUsage?: OnUsage) {
  return call([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(req, context, limit) },
  ], onUsage);
}

export function reviseForBudget(
  req: TripRequest,
  context: unknown,
  limit: number,
  draft: Itinerary,
  overBy: number,
  onUsage?: OnUsage,
) {
  return call([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(req, context, limit) },
    { role: "assistant", content: JSON.stringify(draft) },
    {
      role: "user",
      content: `The line items add up to ${overBy} ${req.currency} over the ${limit} ${req.currency} limit. Revise the itinerary to fit: pick a cheaper stay or fare, swap paid activities for free ones, or choose cheaper meals, while keeping the traveler's preferences. Keep the same structure and number of days.`,
    },
  ], onUsage);
}
