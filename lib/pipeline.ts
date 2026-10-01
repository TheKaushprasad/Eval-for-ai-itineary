import { budgetLimit, checkBudget } from "./budget";
import { sendItineraryEmail } from "./email";
import { generateItinerary, reviseForBudget } from "./llm";
import { RESEARCH_ENABLED } from "./openai";
import type { ItineraryResult, ProgressStep, StreamEvent, TripRequest } from "./schema";
import { getFlightProvider } from "./sources/flights";
import { geocode, type Place } from "./sources/geocode";
import { getPlaces, summarizePois } from "./sources/places";
import { research } from "./sources/research";
import { getWeather, tripDates } from "./sources/weather";

export const defaultDeps = {
  geocode,
  getWeather,
  getPlaces,
  getFlightProvider,
  research,
  /** Web research is paid (OpenAI web_search); when off, the step is skipped rather than failed. */
  researchEnabled: RESEARCH_ENABLED,
  generateItinerary,
  reviseForBudget,
  sendItineraryEmail,
};
export type Deps = typeof defaultDeps;

type Emit = (e: StreamEvent) => void;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runPipeline(req: TripRequest, emit: Emit, deps: Deps = defaultDeps): Promise<ItineraryResult> {
  const warnings: string[] = [];
  const progress = (step: ProgressStep, status: "start" | "ok" | "skipped" | "failed", detail?: string) =>
    emit({ type: "progress", step, status, detail });

  /** Runs one step; a failure becomes a warning instead of aborting the whole trip. */
  async function step<T>(name: ProgressStep, fn: () => Promise<T>, okDetail?: (v: T) => string): Promise<T | null> {
    progress(name, "start");
    try {
      const v = await fn();
      progress(name, "ok", okDetail?.(v));
      return v;
    } catch (e) {
      warnings.push(`${name}: ${message(e)}`);
      progress(name, "failed", message(e));
      return null;
    }
  }

  const dates = tripDates(req.startDate, req.days);
  const returnDate = dates[dates.length - 1];
  const limit = budgetLimit(req);

  // 1. Geocode (sequential — Nominatim is rate limited).
  const places = await step("geocoding", async () => {
    const destination = await deps.geocode(req.destination);
    const origin = await deps.geocode(req.origin).catch(() => null);
    return { destination, origin };
  }, (v) => v.destination.name);
  const dest: Place | null = places?.destination ?? null;
  const origin: Place | null = places?.origin ?? null;

  // 2. Fan out.
  const wantsFlight = req.travelMode === "flight" || req.travelMode === "any";
  const flightProvider = wantsFlight ? deps.getFlightProvider() : null;

  const [weather, pois, flights, web] = await Promise.all([
    dest
      ? step("weather", () => deps.getWeather(dest.lat, dest.lon, req.startDate, req.days), (w) => `${w[0]?.kind} data for ${w.length} days`)
      : (progress("weather", "skipped", "destination not found"), null),
    dest
      ? step("places", () => deps.getPlaces(dest, req), (p) => `${p.attractions.length} sights, ${p.restaurants.length} restaurants`)
      : (progress("places", "skipped", "destination not found"), null),
    flightProvider && dest && origin
      ? step("flights", () =>
          flightProvider.search({
            origin: { lat: origin.lat, lon: origin.lon, name: origin.query },
            destination: { lat: dest.lat, lon: dest.lon, name: dest.query },
            departDate: req.startDate,
            returnDate,
            adults: req.adults,
            childAges: req.childAges,
          }), (f) => `${f.options.length} offers ${f.from}→${f.to}`)
      : (progress("flights", "skipped", !wantsFlight ? `travel mode is ${req.travelMode}` : "no flight API configured — using web estimates"), null),
    deps.researchEnabled
      ? step("research", () => deps.research(req, returnDate, dest?.countryCode ?? null), (r) => `${r.sources.length} sources`)
      : (progress("research", "skipped", "web research is switched off"), null),
  ]);

  // 3. Context for the model, each part tagged with its source.
  const context = {
    dates,
    destination: dest && { name: dest.name, country: dest.country },
    weather: weather && { source: "open-meteo", days: weather },
    places: pois && {
      source: "osm",
      attractions: summarizePois(pois.attractions),
      restaurants: summarizePois(pois.restaurants),
      stays: summarizePois(pois.stays),
    },
    flights: flights && { source: "duffel", ...flights },
    research: web && { source: "web", ...web },
  };

  // 4. Generate + budget check (one revision if over).
  progress("generating", "start");
  let itinerary;
  try {
    itinerary = await deps.generateItinerary(req, context, limit);
    progress("generating", "ok");
  } catch (e) {
    progress("generating", "failed", message(e));
    throw e;
  }

  progress("budget", "start");
  let check = checkBudget(itinerary, limit);
  let revised = false;
  if (!check.withinBudget) {
    progress("budget", "start", `over by ${check.overBy} ${req.currency}, revising`);
    try {
      const next = await deps.reviseForBudget(req, context, limit, itinerary, check.overBy);
      const nextCheck = checkBudget(next, limit);
      if (nextCheck.budget.total < check.budget.total) {
        itinerary = next;
        check = nextCheck;
        revised = true;
      }
    } catch (e) {
      warnings.push(`budget revision: ${message(e)}`);
    }
  }
  itinerary = { ...itinerary, budget: check.budget };
  progress("budget", "ok", check.withinBudget ? "within budget" : `over by ${check.overBy} ${req.currency}`);

  const result: ItineraryResult = {
    itinerary,
    budgetLimit: limit,
    computedTotal: check.budget.total,
    withinBudget: check.withinBudget,
    revised,
    emailed: "skipped",
    warnings,
  };

  // 5. Email (never blocks showing the itinerary).
  if (req.email) {
    const sent = await step("emailing", () => deps.sendItineraryEmail(req.email, result), () => `sent to ${req.email}`);
    result.emailed = sent === null ? "failed" : "sent";
  } else {
    progress("emailing", "skipped", "no email address");
  }

  progress("done", "ok");
  return result;
}
