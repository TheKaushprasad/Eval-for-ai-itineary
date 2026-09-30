import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { openai, RESEARCH_MODEL } from "../openai";
import type { TripRequest } from "../schema";

export const ResearchSchema = z.object({
  gettingThere: z.array(
    z.object({
      mode: z.string(),
      description: z.string(),
      typicalCostPerPerson: z.number().nullable(),
      currency: z.string(),
      durationHours: z.number().nullable(),
    }),
  ),
  hotels: z.array(
    z.object({
      name: z.string(),
      area: z.string(),
      tier: z.string(),
      nightlyRate: z.number().nullable().describe("Per room per night"),
      currency: z.string(),
      url: z.string().nullable(),
    }),
  ),
  localTransport: z.string(),
  events: z.array(z.string()).describe("Festivals, events, closures or seasonal notes for the dates"),
  typicalCosts: z.object({
    mealPerPerson: z.number().nullable(),
    currency: z.string(),
    notes: z.string(),
  }),
  tips: z.array(z.string()),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
});

export type Research = z.infer<typeof ResearchSchema>;

export function researchPrompt(req: TripRequest, returnDate: string) {
  const kids = req.children ? `, ${req.children} child(ren) aged ${req.childAges.join(", ")}` : "";
  return `Research a trip for a travel planner. Search the web for current, specific facts.

Trip: ${req.origin} → ${req.destination}, ${req.startDate} to ${returnDate} (${req.days} days).
Travelers: ${req.adults} adult(s)${kids}. Preferred travel mode: ${req.travelMode}.
Accommodation tier: ${req.accommodation}. Food: ${req.food}. Style: ${req.tripStyle}. Currency: ${req.currency}.
${req.specialRequirements ? `Special requirements: ${req.specialRequirements}` : ""}

Find:
1. gettingThere: realistic ways from ${req.origin} to ${req.destination} (include "${req.travelMode}" first if it applies) with typical cost per person in ${req.currency}.
2. hotels: 4-6 real ${req.accommodation} options in good areas with typical nightly rates in ${req.currency}.
3. localTransport: how visitors get around and rough daily cost.
4. events: festivals, events, seasonal conditions or closures around those dates.
5. typicalCosts: typical meal cost per person for ${req.food} food at ${req.accommodation}-level places.
6. tips: practical tips (entry fees, bookings, safety, dress codes, kid-friendly notes if children travel).
List the pages you relied on in sources. Use null when you can't find a number.`;
}

export async function research(req: TripRequest, returnDate: string, countryCode: string | null): Promise<Research> {
  const res = await openai().responses.parse({
    model: RESEARCH_MODEL,
    tools: [
      {
        type: "web_search",
        ...(countryCode && { user_location: { type: "approximate", country: countryCode } }),
      },
    ],
    input: researchPrompt(req, returnDate),
    text: { format: zodTextFormat(ResearchSchema, "trip_research") },
  });
  if (!res.output_parsed) throw new Error("Research returned no structured output");
  return res.output_parsed;
}
