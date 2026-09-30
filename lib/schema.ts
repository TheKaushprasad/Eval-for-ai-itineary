import { z } from "zod";

export const TRAVEL_MODES = ["flight", "train", "bus", "car", "any"] as const;
export const FOOD_PREFS = ["vegetarian", "vegan", "jain", "halal", "non-vegetarian", "no-preference"] as const;
export const TRIP_STYLES = ["relaxed", "balanced", "adventure", "cultural", "family"] as const;
export const ACCOMMODATIONS = ["budget", "mid-range", "luxury", "homestay"] as const;
export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD"] as const;

export const TripRequestSchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    days: z.coerce.number().int().min(1).max(21),
    destination: z.string().trim().min(2, "Where are you going?"),
    origin: z.string().trim().min(2, "Where are you starting from?"),
    adults: z.coerce.number().int().min(1).max(9),
    children: z.coerce.number().int().min(0).max(8),
    childAges: z.array(z.coerce.number().int().min(0).max(17)),
    budgetPerPerson: z.coerce.number().positive(),
    currency: z.enum(CURRENCIES),
    travelMode: z.enum(TRAVEL_MODES),
    food: z.enum(FOOD_PREFS),
    tripStyle: z.enum(TRIP_STYLES),
    accommodation: z.enum(ACCOMMODATIONS),
    specialRequirements: z.string().max(1000).default(""),
    additionalInfo: z.string().max(1000).default(""),
    email: z.union([z.literal(""), z.string().email()]).default(""),
  })
  .refine((r) => r.childAges.length === r.children, {
    message: "Enter an age for each child",
    path: ["childAges"],
  });

export type TripRequest = z.infer<typeof TripRequestSchema>;

// ---- LLM output. Strict structured outputs: every field required, use nullable for optional. ----

const Activity = z.object({
  time: z.string().describe("e.g. 09:00"),
  name: z.string(),
  description: z.string(),
  durationHours: z.number(),
  cost: z.number().describe("Total cost for the whole group in the trip currency"),
  indoor: z.boolean(),
  kidFriendly: z.boolean(),
});

const Meal = z.object({
  meal: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  place: z.string(),
  cuisine: z.string(),
  dietOk: z.boolean().describe("Suits the traveler's food preference"),
  cost: z.number().describe("Total for the whole group"),
});

const Leg = z.object({
  mode: z.string(),
  description: z.string(),
  departure: z.string().nullable(),
  arrival: z.string().nullable(),
  cost: z.number().describe("Total for the whole group"),
  source: z.enum(["duffel", "web", "estimate"]),
});

export const ItinerarySchema = z.object({
  title: z.string(),
  summary: z.string(),
  currency: z.string(),
  transport: z.object({
    outbound: Leg,
    return: Leg,
    local: z.string().describe("How to get around at the destination"),
    localCost: z.number().describe("Total local transport for the group over the trip"),
  }),
  accommodation: z.object({
    name: z.string(),
    area: z.string(),
    type: z.string(),
    nights: z.number().int(),
    nightlyRate: z.number(),
    total: z.number(),
    why: z.string(),
    source: z.enum(["web", "osm", "estimate"]),
  }),
  days: z.array(
    z.object({
      day: z.number().int(),
      date: z.string(),
      theme: z.string(),
      weather: z.string(),
      activities: z.array(Activity),
      meals: z.array(Meal),
      notes: z.string().nullable(),
    }),
  ),
  budget: z.object({
    transport: z.number(),
    accommodation: z.number(),
    food: z.number(),
    activities: z.number(),
    localTransport: z.number(),
    buffer: z.number(),
    total: z.number(),
  }),
  packingTips: z.array(z.string()),
  tips: z.array(z.string()),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
});

export type Itinerary = z.infer<typeof ItinerarySchema>;

/** What the API returns to the client after the budget check. */
export type ItineraryResult = {
  itinerary: Itinerary;
  budgetLimit: number;
  computedTotal: number;
  withinBudget: boolean;
  revised: boolean;
  emailed: "sent" | "skipped" | "failed";
  warnings: string[];
};

export type ProgressStep =
  | "geocoding"
  | "weather"
  | "places"
  | "flights"
  | "research"
  | "generating"
  | "budget"
  | "emailing"
  | "done";

export type StreamEvent =
  | { type: "progress"; step: ProgressStep; status: "start" | "ok" | "skipped" | "failed"; detail?: string }
  | { type: "result"; data: ItineraryResult }
  | { type: "error"; message: string };
