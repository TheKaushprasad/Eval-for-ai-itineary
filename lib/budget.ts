import type { Itinerary, TripRequest } from "./schema";

/** Infants under 2 travel free for budget purposes; everyone else counts as a full share. */
export function payingTravelers(req: Pick<TripRequest, "adults" | "childAges">) {
  return req.adults + req.childAges.filter((a) => a >= 2).length;
}

export function budgetLimit(req: Pick<TripRequest, "adults" | "childAges" | "budgetPerPerson">) {
  return req.budgetPerPerson * payingTravelers(req);
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

/** Recompute category totals from line items so we never trust the model's arithmetic. */
export function computeBudget(it: Itinerary) {
  const transport = it.transport.outbound.cost + it.transport.return.cost;
  const accommodation = it.accommodation.total;
  const food = sum(it.days.flatMap((d) => d.meals.map((m) => m.cost)));
  const activities = sum(it.days.flatMap((d) => d.activities.map((a) => a.cost)));
  const localTransport = it.transport.localCost;
  const buffer = Math.max(0, it.budget.buffer);
  const total = transport + accommodation + food + activities + localTransport + buffer;
  return { transport, accommodation, food, activities, localTransport, buffer, total: Math.round(total) };
}

export type BudgetCheck = {
  budget: ReturnType<typeof computeBudget>;
  limit: number;
  withinBudget: boolean;
  overBy: number;
};

/** A 2% tolerance avoids a revision round-trip over rounding noise. */
export function checkBudget(it: Itinerary, limit: number, tolerance = 0.02): BudgetCheck {
  const budget = computeBudget(it);
  const withinBudget = budget.total <= limit * (1 + tolerance);
  return { budget, limit, withinBudget, overBy: Math.max(0, Math.round(budget.total - limit)) };
}

export function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString()}`;
  }
}
