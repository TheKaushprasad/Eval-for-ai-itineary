import { describe, expect, it } from "vitest";
import { budgetLimit, checkBudget, payingTravelers } from "@/lib/budget";
import { TripRequestSchema } from "@/lib/schema";
import { sampleItinerary } from "./fixtures";

describe("budget", () => {
  it("counts infants under 2 as free", () => {
    expect(payingTravelers({ adults: 2, childAges: [1, 5] })).toBe(3);
    expect(budgetLimit({ adults: 2, childAges: [], budgetPerPerson: 25000 })).toBe(50000);
  });

  it("recomputes totals from line items instead of trusting the model", () => {
    const it = sampleItinerary({ budget: { transport: 0, accommodation: 0, food: 0, activities: 0, localTransport: 0, buffer: 2000, total: 1 } });
    const c = checkBudget(it, 50000);
    // 8000 + 8000 flights, 16000 stay, 1200 meals, 500 activity, 3000 local, 2000 buffer
    expect(c.budget).toMatchObject({ transport: 16000, accommodation: 16000, food: 1200, activities: 500, localTransport: 3000 });
    expect(c.budget.total).toBe(38700);
    expect(c.withinBudget).toBe(true);
  });

  it("flags over-budget with the gap", () => {
    const c = checkBudget(sampleItinerary(), 30000);
    expect(c.withinBudget).toBe(false);
    expect(c.overBy).toBe(8700);
  });
});

describe("TripRequestSchema", () => {
  const base = {
    startDate: "2026-11-01", days: 5, destination: "Goa", origin: "Bangalore", adults: 2, children: 0, childAges: [],
    budgetPerPerson: 25000, currency: "INR", travelMode: "flight", food: "vegetarian", tripStyle: "relaxed",
    accommodation: "mid-range", email: "",
  };
  it("accepts the Goa example", () => expect(TripRequestSchema.safeParse(base).success).toBe(true));
  it("requires an age per child", () =>
    expect(TripRequestSchema.safeParse({ ...base, children: 2, childAges: [4] }).success).toBe(false));
  it("rejects a bad email", () => expect(TripRequestSchema.safeParse({ ...base, email: "nope" }).success).toBe(false));
});
