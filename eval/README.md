# Itinerary eval harness

This folder measures the quality of the AI itinerary agent (`lib/pipeline.ts`) so changes to prompts, models or pipeline steps are judged by numbers rather than by eye.

The loop is: **change → `npm run eval` → compare → keep or revert.**

## How it works

```
cases.jsonl ──► record.ts ──► snapshots/<id>.json   (frozen geocode, weather, OSM places, flights, web research)
                                   │
                                   ▼
                run.ts: runPipeline(case, replayDeps) ──► itinerary
                                   │
                  ┌────────────────┴────────────────┐
                  ▼                                 ▼
      graders/checks.ts (14 code checks)   graders/judge.ts (LLM rubric, 5 dimensions)
                  └────────────────┬────────────────┘
                                   ▼
                results/<time>_<label>_<sha>.json ──► report.ts / check.ts / agreement.ts
```

- **Frozen snapshots.** The data sources are live APIs that change daily, so each case's data is recorded once and replayed. Between runs only the itinerary model's behavior changes, which makes versions comparable. `--live` runs against real APIs for spot checks.
- **The real pipeline.** Runs go through `runPipeline` with injected deps, so the budget-revision step and any warnings are part of what's measured.
- **Two kinds of graders.** Code checks for anything objective, and an LLM judge only for what code can't check. The judge is a different model from the generator, and its agreement with a human is measured (see below).

## Test set: 60 cases

| Category | n | Stresses |
|---|---|---|
| core | 10 | Everyday domestic and international trips |
| budget | 10 | Tight or contradictory budgets, generous budgets, USD / AED / SGD / EUR / GBP |
| diet | 8 | Jain, vegan and halal, including where they're hard (Bangkok, Tokyo, Seoul) |
| family | 8 | Toddlers, infants (who travel free), teens, large groups, adventure trips with young kids |
| duration | 6 | 1-day trips (0 nights) up to the 21-day maximum, multi-city regions |
| weather | 6 | Monsoon Kerala/Mumbai/Goa/Shillong, winter in Manali, summer in Jaisalmer |
| special | 6 | Wheelchair access, elderly parents, pregnancy, no flying, remote work, must-do requests |
| edge | 6 | Sparse OSM data, vague input, same-city staycation, misspelled destination, impossible budget, prompt injection |

Each line in `cases/cases.jsonl` is `{id, category, tags, note, request, expect}`. `request` is a full `TripRequest`. `expect` holds optional case-specific assertions:
- `mustMention`: each entry must appear somewhere in the itinerary; `a|b` means either.
- `mustAvoid`: none of these may appear in an activity, meal place or hotel name.

If you edit a case, re-record its snapshot. The runner refuses stale snapshots.

## Graders

### Code checks (`graders/checks.ts`)
Every check returns pass, fail or n/a, a 0–1 partial-credit score, and a reason.

| Check | Passes when |
|---|---|
| `dayCount` | the plan has exactly the requested number of days |
| `dates` | day *n* has the date `startDate + n − 1` |
| `nights` | accommodation nights = days − 1 |
| `withinBudget` | the recomputed total is ≤ the limit (+2%); partial credit is limit ÷ total |
| `budgetArithmetic` | the model's **own** budget fields match its line items (the app hides this by recomputing) |
| `dietCompliance` | every meal is marked `dietOk` and the meal names contain no blocked foods for veg / vegan / Jain / halal ("no onion garlic" and "egg-free" are understood) |
| `kidSafety` | with children: every activity is kid-friendly, with no bars and no bungee, rafting or scuba for under-12s |
| `grounding` | **hallucination metric:** the share of *named* venues whose proper-noun tokens all appear in the data the model was given. Generic items like "Breakfast at the hotel" aren't counted |
| `sourceValidity` | cited URLs actually came from the web research |
| `weatherAware` | rainy (≥ 5 mm) or very hot (≥ 38 °C) days include an indoor option |
| `pace` | activities per full day fit the trip style (relaxed 1–2, balanced 2–3, adventure 3–4, cultural 2–4, family 2–3) |
| `travelMode` | both legs use the requested mode |
| `transportSource` | when live Duffel fares were available, both legs use them |
| `expectations` | the case's `mustMention` / `mustAvoid` |

`grounding` is a heuristic. A real place the model knew but that wasn't in the context counts as ungrounded, which is intended: the app promises to use its data, not the model's memory. Read the `detail` field before blaming the model.

### LLM judge (`graders/judge.ts`)
The judge scores 1–5 on `styleMatch`, `pace`, `logistics`, `requirements` and `helpfulness`, using anchored rubrics and giving its reason before each score. It uses `EVAL_JUDGE_MODEL`, default `gpt-5-mini`, and refuses to run when that's the same model as the generator.

### Is the judge trustworthy? (`agreement.ts`)
1. `npm run eval:agree -- --template` samples 20 itineraries across categories into `human/review.md` and `human/labels.csv`.
2. Score them yourself in the CSV **without looking at the judge's scores**.
3. `npm run eval:agree` reports exact agreement, agreement within ±1, linear-weighted Cohen's κ and judge bias for each dimension.

Only trust the judge on dimensions with κ ≳ 0.6.

## Running it

```bash
npm run eval:record                      # record snapshots (skips ones that are up to date; --force to redo)
npm run eval -- --label v1-baseline      # run all 60 cases
npm run eval -- --only diet --no-judge   # a category, code checks only
npm run eval:report                      # table for the latest run (also saved as .md next to it)
npm run eval:report -- --compare         # latest two runs: Δ per metric, regressions and fixes per case
npm run eval:check -- --update           # promote the latest run to results/baseline.json
npm run eval:check                       # gate: exit 1 if a headline metric dropped past its tolerance
```

Flags for `eval` and `eval:record`: `--only <category|id-prefix>,…` · `--ids a,b` · `--limit n` · `--concurrency n`.

The **headline metrics** gated by `eval:check` (see `HEADLINE` in `metrics.ts`) are:
- success rate
- strict pass (every check passed)
- grounding
- withinBudget
- dietCompliance
- kidSafety
- judge mean

Cost per itinerary uses the price table in `pricing.ts`; check it against OpenAI's pricing page.

## Results

Each run is stored in `results/` with its git SHA, model ids and every itinerary, so any number here can be traced back to the output behind it.

| Version | Change | Strict pass | Grounding | Within budget | Diet | Judge | p50 latency | Cost/itinerary |
|---|---|---|---|---|---|---|---|---|
| v1-baseline | prompts as shipped | – | – | – | – | – | – | – |
