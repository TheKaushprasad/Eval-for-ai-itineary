import { describe, expect, it } from "vitest";
import type { Itinerary, TripRequest } from "@/lib/schema";
import { sampleItinerary } from "@/tests/fixtures";
import { weightedKappa } from "../metrics";
import { runChecks, type CheckId, type CheckInput, type PipelineContext } from "./checks";

const req: TripRequest = {
  startDate: "2026-11-01", days: 3, destination: "Goa", origin: "Bangalore", adults: 2, children: 0, childAges: [],
  budgetPerPerson: 25000, currency: "INR", travelMode: "flight", food: "vegetarian", tripStyle: "balanced",
  accommodation: "mid-range", specialRequirements: "", additionalInfo: "", email: "",
};

type Day = Itinerary["days"][number];
const act = (name: string, over: Partial<Day["activities"][number]> = {}) => ({
  time: "10:00", name, description: "", durationHours: 2, cost: 0, indoor: false, kidFriendly: true, ...over,
});
const meal = (place: string, cuisine = "Goan", over: Partial<Day["meals"][number]> = {}) => ({
  meal: "lunch" as const, place, cuisine, dietOk: true, cost: 0, ...over,
});
const day = (n: number, activities = [act("Fort Aguada"), act("Calangute Beach")], meals = [meal("Vihar Restaurant")]): Day => ({
  day: n, date: `2026-11-0${n}`, theme: "", weather: "", notes: null, activities, meals,
});

/** A 3-day plan whose numbers all add up. */
function plan(over: Partial<Itinerary> = {}): Itinerary {
  const base = sampleItinerary();
  const it: Itinerary = {
    ...base,
    accommodation: { ...base.accommodation, name: "Casa Anjuna", nights: 2, nightlyRate: 4000, total: 8000 },
    days: [day(1), day(2), day(3)],
    ...over,
  };
  const food = it.days.flatMap((d) => d.meals).reduce((a, m) => a + m.cost, 0);
  const activities = it.days.flatMap((d) => d.activities).reduce((a, x) => a + x.cost, 0);
  const transport = it.transport.outbound.cost + it.transport.return.cost;
  const buffer = 2000;
  return {
    ...it,
    budget: {
      transport, accommodation: it.accommodation.total, food, activities, localTransport: it.transport.localCost, buffer,
      total: transport + it.accommodation.total + food + activities + it.transport.localCost + buffer,
    },
  };
}

const context: PipelineContext = {
  dates: ["2026-11-01", "2026-11-02", "2026-11-03"],
  destination: { name: "Goa, India", country: "India" },
  weather: {
    source: "open-meteo",
    days: [
      { date: "2026-11-01", tMax: 31, tMin: 24, precipMm: 0, rainChance: 10, summary: "Mostly dry", kind: "typical" },
      { date: "2026-11-02", tMax: 29, tMin: 24, precipMm: 22, rainChance: 90, summary: "Heavy rain", kind: "typical" },
      { date: "2026-11-03", tMax: 31, tMin: 24, precipMm: 0, rainChance: 10, summary: "Mostly dry", kind: "typical" },
    ],
  },
  places: {
    source: "osm",
    attractions: [{ name: "Fort Aguada" }, { name: "Calangute Beach" }, { name: "Basilica of Bom Jesus" }],
    restaurants: [{ name: "Vihar Restaurant" }],
    stays: [{ name: "Casa Anjuna" }],
  },
  flights: null,
  research: {
    source: "web",
    gettingThere: [], hotels: [], localTransport: "Scooters", events: [], tips: [],
    typicalCosts: { mealPerPerson: null, currency: "INR", notes: "" },
    sources: [{ title: "Goa guide", url: "https://www.example.com/goa-guide/" }],
  },
};

function check(id: CheckId, over: Partial<CheckInput> = {}) {
  const itinerary = over.itinerary ?? plan();
  const input: CheckInput = {
    req, expect: { mustMention: [], mustAvoid: [] }, itinerary, raw: itinerary, context, budgetLimit: 50000, ...over,
  };
  return runChecks(input).find((c) => c.id === id)!;
}

describe("structure checks", () => {
  it("passes a plan with the right days, dates and nights", () => {
    expect(check("dayCount").status).toBe("pass");
    expect(check("dates").status).toBe("pass");
    expect(check("nights").status).toBe("pass");
  });

  it("gives partial credit for wrong dates and flags wrong nights", () => {
    const it = plan({ days: [day(1), { ...day(2), date: "2026-11-05" }, day(3)] });
    expect(check("dates", { itinerary: it })).toMatchObject({ status: "fail", score: 0.667 });
    const off = plan({ accommodation: { ...plan().accommodation, nights: 3 } });
    expect(check("nights", { itinerary: off }).status).toBe("fail");
  });
});

describe("budget checks", () => {
  it("scores over-budget plans by how far over they are", () => {
    const total = plan().budget.total;
    expect(check("withinBudget", { budgetLimit: total }).status).toBe("pass");
    const r = check("withinBudget", { budgetLimit: total / 2 });
    expect(r.status).toBe("fail");
    expect(r.score).toBeCloseTo(0.5, 2);
  });

  it("catches the model's own arithmetic mistakes", () => {
    expect(check("budgetArithmetic").status).toBe("pass");
    const wrong = plan();
    const raw = { ...wrong, budget: { ...wrong.budget, total: wrong.budget.total - 5000 } };
    expect(check("budgetArithmetic", { raw }).status).toBe("fail");
  });
});

describe("dietCompliance", () => {
  const withMeals = (...meals: ReturnType<typeof meal>[]) => plan({ days: [day(1, undefined, meals), day(2), day(3)] });

  it("flags meat for vegetarians but not negated mentions", () => {
    expect(check("dietCompliance", { itinerary: withMeals(meal("Highway Dhaba", "Butter chicken")) }).status).toBe("fail");
    expect(check("dietCompliance", { itinerary: withMeals(meal("Eggless Bakery", "egg-free cakes")) }).status).toBe("pass");
  });

  it("trusts dietOk=false as a violation", () => {
    expect(check("dietCompliance", { itinerary: withMeals(meal("Vihar", "Thali", { dietOk: false })) }).status).toBe("fail");
  });

  it("applies Jain rules and allows 'no onion garlic'", () => {
    const jain = { ...req, food: "jain" as const };
    expect(check("dietCompliance", { req: jain, itinerary: withMeals(meal("Jain Bhojanalay", "Jain thali, no onion garlic")) }).status).toBe("pass");
    expect(check("dietCompliance", { req: jain, itinerary: withMeals(meal("Chaat corner", "Aloo tikki")) }).status).toBe("fail");
  });

  it("does not apply without a restriction", () => {
    expect(check("dietCompliance", { req: { ...req, food: "no-preference" } }).status).toBe("na");
  });
});

describe("kidSafety", () => {
  const kids = { ...req, children: 1, childAges: [6] };
  it("flags age-inappropriate activities", () => {
    const it = plan({ days: [day(1, [act("Bungee jumping at Jumpin Heights")]), day(2), day(3)] });
    expect(check("kidSafety", { req: kids, itinerary: it }).status).toBe("fail");
    expect(check("kidSafety", { req: kids }).status).toBe("pass");
  });
  it("does not apply without children", () => {
    expect(check("kidSafety").status).toBe("na");
  });
});

describe("grounding", () => {
  it("passes named venues found in context and ignores generic ones", () => {
    const it = plan({ days: [day(1, [act("Sunset at Fort Aguada"), act("Breakfast at the hotel")]), day(2), day(3)] });
    expect(check("grounding", { itinerary: it })).toMatchObject({ status: "pass", score: 1 });
  });

  it("ignores travel legs and airport codes", () => {
    const it = plan({ days: [day(1, [act("Arrive GOI — transfer to hotel"), act("Travel: Bangalore → Goa")]), day(2), day(3)] });
    expect(check("grounding", { itinerary: it }).detail).not.toMatch(/GOI|Travel/);
  });

  it("matches names written in non-Latin scripts", () => {
    const seoul = { ...context, places: { ...context.places!, attractions: [...context.places!.attractions, { name: "북촌한옥마을" }] } };
    const it = plan({ days: [day(1, [act("북촌한옥마을 (Bukchon Hanok Village)")]), day(2), day(3)] });
    const r = check("grounding", { itinerary: it, context: seoul });
    expect(r.detail).not.toContain("북촌");
  });

  it("doesn't grade the bracket of a generic name", () => {
    const it = plan({ days: [day(1, [act("Museum of Goa (MoGo)"), act("Fort Aguada")]), day(2), day(3)] });
    expect(check("grounding", { itinerary: it }).detail).not.toContain("MoGo");
  });

  it("flags invented venues", () => {
    const it = plan({ days: [day(1, [act("Dinner cruise with Zanzibar Seafarers")]), day(2), day(3)] });
    const r = check("grounding", { itinerary: it });
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("Zanzibar Seafarers");
  });
});

describe("sources, weather, mode, expectations", () => {
  it("matches cited URLs ignoring protocol, www and trailing slash", () => {
    const it = plan({ sources: [{ title: "g", url: "http://example.com/goa-guide" }] });
    expect(check("sourceValidity", { itinerary: it }).status).toBe("pass");
    expect(check("sourceValidity").status).toBe("fail"); // research existed but nothing cited
  });

  it("wants an indoor option on a rainy day", () => {
    expect(check("weatherAware").status).toBe("fail");
    const it = plan({ days: [day(1), day(2, [act("Goa State Museum", { indoor: true }), act("Calangute Beach")]), day(3)] });
    expect(check("weatherAware", { itinerary: it }).status).toBe("pass");
  });

  it("checks the travel mode on both legs", () => {
    expect(check("travelMode").status).toBe("pass");
    expect(check("travelMode", { req: { ...req, travelMode: "train" } }).status).toBe("fail");
  });

  it("supports alternatives in mustMention and checks mustAvoid on venues", () => {
    const expectOk = { mustMention: ["museum|fort aguada"], mustAvoid: ["casino"] };
    expect(check("expectations", { expect: expectOk }).status).toBe("pass");
    expect(check("expectations", { expect: { mustMention: ["Tiger Hill"], mustAvoid: [] } }).status).toBe("fail");
  });
});

describe("weightedKappa", () => {
  it("is 1 for perfect agreement and lower when raters disagree", () => {
    expect(weightedKappa([[1, 1], [3, 3], [5, 5]])).toBeCloseTo(1);
    expect(weightedKappa([[1, 5], [5, 1], [3, 3]])!).toBeLessThan(0);
  });
});
