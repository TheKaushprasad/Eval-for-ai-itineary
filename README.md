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

If any single data source fails, it becomes a warning shown in the UI rather than an error. Only a missing model API key or a failed generation stops the run.

> Amadeus Self-Service was shut down on 17 July 2026, so flights use Duffel instead. `lib/sources/flights.ts` defines a `FlightProvider` interface so you can swap providers.

## Setup

```bash
npm install
cp .env.example .env.local   # pick a provider and add its key
npm run dev
```

### Choosing the model (free options included)

`LLM_PROVIDER` picks who writes the itinerary. `lib/ai.ts` reaches every provider through the `openai` SDK: OpenAI through its Responses API, the others through their OpenAI-compatible Chat Completions endpoints with JSON-schema output that is validated with zod.

| `LLM_PROVIDER` | Key | Cost | Notes |
| --- | --- | --- | --- |
| `openai` (default) | `OPENAI_API_KEY` | paid | Also enables web research (`web_search` tool) |
| `gemini` | `GEMINI_API_KEY` ([AI Studio](https://aistudio.google.com)) | free tier | Rate limited; free-tier data may be used by Google |
| `groq` | `GROQ_API_KEY` | free tier | Fast open models; a good independent judge |
| `openrouter` | `OPENROUTER_API_KEY` | free models | Availability changes often |
| `ollama` | none (`OLLAMA_URL`) | free, local | Needs a capable machine |

Override the model with `LLM_MODEL` and cut cost with `LLM_REASONING_EFFORT=low`. Web research is OpenAI-only, so it's off by default with other providers (`RESEARCH=on|off` overrides it).

| Other variables | Required | Notes |
| --- | --- | --- |
| `DUFFEL_ACCESS_TOKEN` | no | a `duffel_test_…` token works; without it fares are web estimates |
| `RESEND_API_KEY`, `EMAIL_FROM` | no | without them email is skipped. `onboarding@resend.dev` only delivers to your own Resend address until you verify a domain |
| `NOMINATIM_USER_AGENT` | recommended | identify your app with a real contact or repo URL; Nominatim returns 403 for placeholders |
| `OVERPASS_URL` | no | pin one Overpass server instead of the built-in mirror list |

## Scripts

`npm run dev` · `npm run build` · `npm test` (Vitest: budget math, schema, pipeline degradation, providers, demo limits, eval graders) · `npm run typecheck` · `npm run lint`

## Evaluation

`eval/` holds an eval-driven-development harness: 60 test trips, frozen data snapshots, 14 code checks (grounding, budget, diet, kid safety…), an LLM judge validated against human scores, and a regression gate. Results are browsable at **`/evals`**: headline scores, progress across versions, a check × category heatmap, and a failure explorer that opens each trip's itinerary and grader reasons. See [eval/README.md](eval/README.md).

## Deploying the demo

Live planning spends API credit, so a public deployment should not leave it open:

| `PLANNER_MODE` | Who can generate live plans |
| --- | --- |
| `open` (default) | anyone; fine for local development |
| `code` | only visitors who enter `DEMO_ACCESS_CODE` (put the code on your CV); 3 plans per visitor and 20 per day by default (`RATE_LIMIT_PER_IP`, `DAILY_LIMIT`) |
| `examples` | nobody; the page shows the example trips only, at zero cost |

Example trips are real planner output copied from an eval run: `npm run eval:examples -- --ids core-goa-relaxed,diet-jain-jaipur` writes them to `data/examples/`. Commit them and they appear on the home page.

The daily limits are kept in memory per server instance, so treat them as a speed bump. The hard cap is the spend limit on your provider account (and a separate API key for the demo).

To deploy on Vercel:
1. Import the GitHub repo.
2. Set the env vars: provider key(s), `PLANNER_MODE=code` or `examples`, `DEMO_ACCESS_CODE`, and `NOMINATIM_USER_AGENT`.
3. Deploy. `/evals` is built from the committed files in `eval/results/`, so re-deploy after adding a run.
