import { describe, expect, it, vi } from "vitest";
import { defaultDeps, runPipeline, type Deps } from "@/lib/pipeline";
import type { StreamEvent, TripRequest } from "@/lib/schema";
import { sampleItinerary } from "./fixtures";

const req: TripRequest = {
  startDate: "2026-11-01", days: 5, destination: "Goa", origin: "Bangalore", adults: 2, children: 0, childAges: [],
  budgetPerPerson: 25000, currency: "INR", travelMode: "flight", food: "vegetarian", tripStyle: "relaxed",
  accommodation: "mid-range", specialRequirements: "", additionalInfo: "", email: "a@b.co",
};

function deps(over: Partial<Deps> = {}): Deps {
  return {
    ...defaultDeps,
    researchEnabled: true,
    geocode: vi.fn(async (q: string) => ({ query: q, name: q, lat: 15, lon: 74, country: "India", countryCode: "IN", bbox: null })),
    getWeather: vi.fn(async () => []),
    getPlaces: vi.fn(async () => ({ attractions: [], restaurants: [], stays: [] })),
    getFlightProvider: () => null,
    research: vi.fn(async () => ({ gettingThere: [], hotels: [], localTransport: "", events: [], typicalCosts: { mealPerPerson: null, currency: "INR", notes: "" }, tips: [], sources: [] })),
    generateItinerary: vi.fn(async () => sampleItinerary()),
    reviseForBudget: vi.fn(async () => sampleItinerary()),
    sendItineraryEmail: vi.fn(async () => {}),
    ...over,
  };
}

describe("runPipeline", () => {
  it("keeps going when data sources fail and still emails", async () => {
    const events: StreamEvent[] = [];
    const d = deps({
      getWeather: vi.fn(async () => { throw new Error("weather down"); }),
      research: vi.fn(async () => { throw new Error("search down"); }),
    });
    const r = await runPipeline(req, (e) => events.push(e), d);
    expect(r.withinBudget).toBe(true);
    expect(r.emailed).toBe("sent");
    expect(r.warnings).toEqual(["weather: weather down", "research: search down"]);
    expect(events.at(-1)).toMatchObject({ type: "progress", step: "done" });
  });

  it("revises once when over budget and keeps the cheaper plan", async () => {
    const cheap = sampleItinerary({ accommodation: { ...sampleItinerary().accommodation, total: 4000 } });
    const d = deps({ reviseForBudget: vi.fn(async () => cheap) });
    const r = await runPipeline({ ...req, budgetPerPerson: 14000 }, () => {}, d);
    expect(d.reviseForBudget).toHaveBeenCalledOnce();
    expect(r.revised).toBe(true);
    expect(r.computedTotal).toBe(26700);
    expect(r.withinBudget).toBe(true);
  });

  it("reports a failed email without failing the trip", async () => {
    const d = deps({ sendItineraryEmail: vi.fn(async () => { throw new Error("bad key"); }) });
    const r = await runPipeline(req, () => {}, d);
    expect(r.emailed).toBe("failed");
    expect(r.itinerary.title).toBe("Goa");
  });

  it("skips research without a warning when it is switched off", async () => {
    const d = deps({ researchEnabled: false });
    const events: StreamEvent[] = [];
    const r = await runPipeline(req, (e) => events.push(e), d);
    expect(d.research).not.toHaveBeenCalled();
    expect(r.warnings).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({ step: "research", status: "skipped" }));
  });

  it("skips flights for train trips", async () => {
    const search = vi.fn();
    const d = deps({ getFlightProvider: () => ({ name: "x", isConfigured: () => true, search }) });
    await runPipeline({ ...req, travelMode: "train" }, () => {}, d);
    expect(search).not.toHaveBeenCalled();
  });
});
