import type { Itinerary } from "@/lib/schema";

export function sampleItinerary(over: Partial<Itinerary> = {}): Itinerary {
  const leg = { mode: "flight", description: "BLR→GOI", departure: null, arrival: null, cost: 8000, source: "duffel" as const };
  return {
    title: "Goa",
    summary: "Relaxed Goa",
    currency: "INR",
    transport: { outbound: leg, return: leg, local: "Scooter", localCost: 3000 },
    accommodation: { name: "Hotel", area: "Candolim", type: "hotel", nights: 4, nightlyRate: 4000, total: 16000, why: "" , source: "web" },
    days: [
      {
        day: 1, date: "2026-11-01", theme: "Arrive", weather: "Sunny", notes: null,
        activities: [{ time: "16:00", name: "Fort Aguada", description: "", durationHours: 2, cost: 500, indoor: false, kidFriendly: true }],
        meals: [{ meal: "dinner", place: "Veg place", cuisine: "Goan", dietOk: true, cost: 1200 }],
      },
    ],
    budget: { transport: 16000, accommodation: 16000, food: 1200, activities: 500, localTransport: 3000, buffer: 2000, total: 38700 },
    packingTips: [],
    tips: [],
    sources: [],
    ...over,
  };
}
