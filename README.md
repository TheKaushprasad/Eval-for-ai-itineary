# AI Travel Itinerary Planner

Turns a traveler's preferences into one personalized, budget-aware, day-by-day itinerary. It pulls real data (location, weather, sights, restaurants, stays, flight fares, web research) and has OpenAI assemble it into a single plan.

## How it works

`POST /api/itinerary` runs `lib/pipeline.ts` and streams progress to the page as Server-Sent Events:

1. **Geocode** origin and destination (OpenStreetMap Nominatim).
2. **In parallel:**
   - **Weather** (Open-Meteo): a forecast if the trip is within about 15 days, otherwise the average of the last 3 years for those dates.
   - **Places** (OSM Overpass): sights, diet-matching restaurants, and stays of the chosen tier. Uses the region's bounding box for places like "Goa".
   - **Flights** (Duffel): live offers for the travelers, run when the travel mode is flight or any and `DUFFEL_ACCESS_TOKEN` is set.
   - **Research** (OpenAI + `web_search`): getting-there options, hotel rates, local transport, events and tips, with sources.
3. **Generate** the itinerary with OpenAI Structured Outputs (`ItinerarySchema` in `lib/schema.ts`).
4. **Budget check** (`lib/budget.ts`): totals are recomputed from line items. If the plan is over budget, the model revises it once.
5. **Email** the plan via Resend if an address was given.

If any single data source fails, it becomes a warning shown in the UI rather than an error. Only a missing OpenAI key or a failed generation stops the run.

> Amadeus Self-Service was shut down on 17 July 2026, so flights use Duffel instead. `lib/sources/flights.ts` defines a `FlightProvider` interface so you can swap providers.

## Setup

```bash
npm install
cp .env.example .env.local   # add OPENAI_API_KEY at minimum
npm run dev
```

| Variable | Required | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | yes | |
| `OPENAI_MODEL` / `OPENAI_RESEARCH_MODEL` | no | default `gpt-5` |
| `DUFFEL_ACCESS_TOKEN` | no | a `duffel_test_…` token works; without it fares are web estimates |
| `RESEND_API_KEY`, `EMAIL_FROM` | no | without them email is skipped. `onboarding@resend.dev` only delivers to your own Resend address until you verify a domain |
| `NOMINATIM_USER_AGENT` | recommended | OSM usage policy asks you to identify your app |
| `OVERPASS_URL` | no | pin one Overpass server instead of the built-in mirror list |

## Scripts

`npm run dev` · `npm run build` · `npm test` (Vitest: budget math, schema, pipeline degradation) · `npm run typecheck` · `npm run lint`
