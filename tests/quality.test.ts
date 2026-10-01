import { describe, expect, it, vi } from "vitest";
import { defaultDeps, type Deps } from "@/lib/pipeline";
import { planAndGrade } from "@/lib/quality";
import type { TripRequest } from "@/lib/schema";
import { sampleItinerary } from "./fixtures";

const req: TripRequest = {
  startDate: "2026-11-01", days: 1, destination: "Goa", origin: "Bangalore", adults: 2, children: 0, childAges: [],
  budgetPerPerson: 25000, currency: "INR", travelMode: "flight", food: "vegetarian", tripStyle: "relaxed",
  accommodation: "mid-range", specialRequirements: "", additionalInfo: "", email: "",
};

const deps = (over: Partial<Deps> = {}): Deps => ({
  ...defaultDeps,
  geocode: vi.fn(async (q: string) => ({ query: q, name: q, lat: 15, lon: 74, country: "India", countryCode: "IN", bbox: null })),
  getWeather: vi.fn(async () => []),
  getPlaces: vi.fn(async () => ({ attractions: [{ name: "Fort Aguada", kind: "fort", lat: 0, lon: 0, tags: {} }], restaurants: [], stays: [] })),
  getFlightProvider: () => null,
  research: vi.fn(async () => {
    throw new Error("off");
  }),
  generateItinerary: vi.fn(async () => sampleItinerary({ accommodation: { ...sampleItinerary().accommodation, nights: 0, total: 0 } })),
  reviseForBudget: vi.fn(async () => sampleItinerary()),
  sendItineraryEmail: vi.fn(async () => {}),
  ...over,
});

describe("planAndGrade", () => {
  it("returns the plan with the eval harness's checks attached", async () => {
    const r = await planAndGrade(req, () => {}, deps());
    const byId = Object.fromEntries(r.checks!.map((c) => [c.id, c.status]));
    expect(byId).toMatchObject({ dayCount: "pass", nights: "pass", withinBudget: "pass", kidSafety: "na" });
    // "Fort Aguada" is in the OSM context, so the plan's only named venue is grounded.
    expect(r.checks!.find((c) => c.id === "grounding")?.detail).not.toContain("Fort Aguada");
  });
});
