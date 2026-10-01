import { checkBudget, computeBudget } from "@/lib/budget";
import type { Itinerary, TripRequest } from "@/lib/schema";
import type { FlightResult } from "@/lib/sources/flights";
import type { Research } from "@/lib/sources/research";
import { tripDates, type DayWeather } from "@/lib/sources/weather";
import type { Expect } from "../shared";

/** The context object runPipeline hands the model (lib/pipeline.ts, step 3). */
export type PipelineContext = {
  dates: string[];
  destination: { name: string; country: string | null } | null;
  weather: { source: string; days: DayWeather[] } | null;
  places: {
    source: string;
    attractions: { name: string }[];
    restaurants: { name: string }[];
    stays: { name: string }[];
  } | null;
  flights: ({ source: string } & FlightResult) | null;
  research: ({ source: string } & Research) | null;
};

export type CheckInput = {
  req: TripRequest;
  expect: Expect;
  /** Final itinerary (the pipeline has overwritten `budget` with recomputed totals). */
  itinerary: Itinerary;
  /** The model's own output that was kept, before the pipeline touched it. */
  raw: Itinerary;
  context: PipelineContext | null;
  budgetLimit: number;
};

export const CHECK_IDS = [
  "dayCount",
  "dates",
  "nights",
  "withinBudget",
  "budgetArithmetic",
  "dietCompliance",
  "kidSafety",
  "grounding",
  "sourceValidity",
  "weatherAware",
  "pace",
  "travelMode",
  "transportSource",
  "expectations",
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export type CheckResult = {
  id: CheckId;
  /** "na" when the check doesn't apply to this case (e.g. kidSafety with no children). */
  status: "pass" | "fail" | "na";
  /** 0..1 partial credit; null when na. */
  score: number | null;
  detail: string;
};

const na = (id: CheckId, detail: string): CheckResult => ({ id, status: "na", score: null, detail });
const graded = (id: CheckId, score: number, detail: string, pass = score >= 0.999): CheckResult => ({
  id,
  status: pass ? "pass" : "fail",
  score: Math.round(score * 1000) / 1000,
  detail,
});
const ratio = (ok: number, total: number) => (total ? ok / total : 1);
const preview = (xs: string[], n = 6) => xs.slice(0, n).join("; ") + (xs.length > n ? `; +${xs.length - n} more` : "");

// Letters in any script survive, so Korean or Thai venue names can match OSM names written the same way.
export const normalize = (s: string) =>
  s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// ---- Structure ----

function dayCount({ req, itinerary }: CheckInput) {
  const n = itinerary.days.length;
  return graded("dayCount", n === req.days ? 1 : 0, `${n} days planned, ${req.days} requested`);
}

function dates({ req, itinerary }: CheckInput) {
  const expected = tripDates(req.startDate, req.days);
  const wrong = expected.filter((d, i) => itinerary.days[i]?.date !== d || itinerary.days[i]?.day !== i + 1);
  return graded(
    "dates",
    ratio(expected.length - wrong.length, expected.length),
    wrong.length ? `mismatched: ${preview(wrong)}` : "every day has the right date and number",
  );
}

function nights({ req, itinerary }: CheckInput) {
  const expected = Math.max(0, req.days - 1);
  const got = itinerary.accommodation.nights;
  return graded("nights", got === expected ? 1 : 0, `${got} nights, expected ${expected}`);
}

// ---- Budget ----

function withinBudget({ itinerary, budgetLimit }: CheckInput) {
  const c = checkBudget(itinerary, budgetLimit);
  return graded(
    "withinBudget",
    c.withinBudget ? 1 : budgetLimit / c.budget.total,
    `total ${c.budget.total} vs limit ${budgetLimit}${c.overBy ? ` (over by ${c.overBy})` : ""}`,
    c.withinBudget,
  );
}

/** Did the model's own budget fields match its line items? (The pipeline hides this by recomputing.) */
function budgetArithmetic({ raw }: CheckInput) {
  const computed = computeBudget(raw);
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.01);
  const fields = ["transport", "accommodation", "food", "activities", "localTransport", "total"] as const;
  const off = fields.filter((f) => !close(raw.budget[f], computed[f])).map((f) => `${f} ${raw.budget[f]}≠${computed[f]}`);
  const acc = raw.accommodation;
  if (Math.abs(acc.nights * acc.nightlyRate - acc.total) > Math.max(1, acc.total * 0.02)) {
    off.push(`stay ${acc.nights}×${acc.nightlyRate}≠${acc.total}`);
  }
  return graded("budgetArithmetic", ratio(fields.length + 1 - off.length, fields.length + 1), off.length ? preview(off) : "all sums match");
}

// ---- Diet ----

const MEAT = "chicken|mutton|beef|pork|lamb|goat|veal|duck|turkey|meat|meats|steak|bacon|ham|sausage|salami|pepperoni|prosciutto|keema|fish|prawn|prawns|shrimp|crab|lobster|squid|calamari|oyster|oysters|clam|clams|mussels|seafood|sushi|sashimi|egg|eggs|omelette|omelet|non veg|nonveg";
const DAIRY = "paneer|ghee|cheese|butter|milk|curd|yogurt|yoghurt|lassi|cream|dahi|raita|kulfi|milkshake|honey|gelato|ice cream|mayonnaise";
const ROOTS = "onion|onions|garlic|potato|potatoes|aloo|carrot|carrots|beetroot|radish|ginger";
const PORK = "pork|bacon|ham|lard|salami|pepperoni|prosciutto|chorizo|alcohol|beer|wine|cocktail|cocktails";

const DIET_BLOCKLIST: Partial<Record<TripRequest["food"], RegExp>> = {
  vegetarian: new RegExp(`\\b(${MEAT})\\b`),
  vegan: new RegExp(`\\b(${MEAT}|${DAIRY})\\b`),
  jain: new RegExp(`\\b(${MEAT}|${ROOTS})\\b`),
  halal: new RegExp(`\\b(${PORK})\\b`),
};

/** Drops phrases that name a food only to exclude it ("no onion garlic", "egg-free", "coconut milk"). */
function stripNegations(text: string) {
  return normalize(text)
    .replace(/\b(no|without|zero|free of|minus|skip|avoid)( (onion|garlic|egg|eggs|meat|dairy|alcohol|pork|ghee|butter|cheese|milk|root vegetables|and|or))+/g, " ")
    .replace(/\b\w+ (free|less)\b/g, " ")
    .replace(/\beggless\b/g, " ")
    .replace(/\b(vegan|coconut|almond|oat|soy|cashew|plant based) (milk|cheese|butter|cream|curd|yogurt|ice cream|mayonnaise)\b/g, " ")
    .replace(/\b(peanut|cocoa|apple) butter\b/g, " ")
    .replace(/\b(fish|egg)plant\b/g, " ")
    .replace(/\b(bar|butter) ?nut\b/g, " ");
}

function dietCompliance({ req, itinerary }: CheckInput) {
  const block = DIET_BLOCKLIST[req.food];
  if (!block) return na("dietCompliance", `no dietary restriction (${req.food})`);
  const meals = itinerary.days.flatMap((d) => d.meals.map((m) => ({ ...m, day: d.day })));
  if (!meals.length) return graded("dietCompliance", 0, "no meals planned");
  const bad = meals.flatMap((m) => {
    if (!m.dietOk) return [`day ${m.day} ${m.meal}: model marked dietOk=false (${m.place})`];
    const hit = stripNegations(`${m.place} ${m.cuisine}`).match(block);
    return hit ? [`day ${m.day} ${m.meal}: "${hit[0]}" in ${m.place} / ${m.cuisine}`] : [];
  });
  return graded("dietCompliance", ratio(meals.length - bad.length, meals.length), bad.length ? preview(bad) : `${meals.length} meals ok for ${req.food}`);
}

// ---- Children ----

const ADULT_ONLY = /\b(pub|pubs|bar|bars|nightclub|nightlife|club|clubs|casino|brewery|winery|wine|beer|cocktail|cocktails|tattoo)\b/;
const RISKY_UNDER_12 = /\b(bungee|bungy|skydiving|skydive|paragliding|paraglide|scuba|rafting|cliff jumping|canyoning)\b/;

function kidSafety({ req, itinerary }: CheckInput) {
  if (!req.children) return na("kidSafety", "no children");
  const youngest = Math.min(...req.childAges);
  const acts = itinerary.days.flatMap((d) => d.activities.map((a) => ({ ...a, day: d.day })));
  if (!acts.length) return na("kidSafety", "no activities");
  const bad = acts.flatMap((a) => {
    const text = normalize(a.name);
    if (!a.kidFriendly) return [`day ${a.day}: ${a.name} marked not kid-friendly`];
    if (ADULT_ONLY.test(text)) return [`day ${a.day}: ${a.name} (adult venue)`];
    if (youngest < 12 && RISKY_UNDER_12.test(text)) return [`day ${a.day}: ${a.name} (risky for a ${youngest}-year-old)`];
    return [];
  });
  return graded("kidSafety", ratio(acts.length - bad.length, acts.length), bad.length ? preview(bad) : `${acts.length} activities ok for kids`);
}

// ---- Grounding ----

/**
 * Capitalized words that don't identify a specific venue on their own. A name made only of these
 * ("Breakfast at the Hotel", "Sunset Beach Walk") is generic and not graded; one with at least one
 * other capitalized token ("Fort Aguada", "Britto's") is a named venue that must be traceable.
 */
const GENERIC = new Set(
  `a an the at to of and in on by for with from near via or de la le da di du del des il el al
  day days visit visiting explore exploring tour tours walk walking stroll trip arrival arrive arriving departure depart
  departing check checkin checkout stay hotel hotels resort resorts homestay hostel guesthouse guest house room rooms service
  breakfast lunch dinner snack snacks brunch tea coffee cafe restaurant restaurants dhaba canteen kitchen food foods cuisine
  local street market markets bazaar bazar beach beaches fort forts temple temples museum museums palace palaces lake lakes
  river hill hills park parks garden gardens old new city town village sunset sunrise evening morning afternoon night
  free time leisure rest relax relaxing shopping return journey flight flights train trains bus buses drive driving transfer
  airport station cruise boat boating ride rides spa pool thali north south east west central indian veg vegetarian vegan
  jain halal pure family kids optional guided heritage national point view viewpoint trek trekking hike hiking trail waterfall
  waterfalls falls dam island islands road square mall ghat ghats church mosque cathedral basilica shrine monastery tomb gate
  tower bridge zoo aquarium gallery art cultural show dance music class cooking workshop experience state area centre center
  monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september
  october november december am pm hrs self own home house nearby authentic traditional famous popular best top sightseeing
  depart departure overnight sleeper express taxi cab auto rickshaw metro ferry scooter bike cycling
  travel rooftop drinks skyline views private short late slow quick leisurely relaxed lazy light small purchases swim
  option options similar preference pick gentle calm shallow play packed picnic full half terraces paddy pack packing
  back walking boat trip external stop courtyards`
    .split(/\s+/)
    .filter(Boolean),
);

/** Normalized capitalized tokens (proper-noun-ish) that aren't generic or the trip's own origin/destination. */
function distinctiveTokens(name: string, exclude: Set<string>) {
  const words = name.split(/[\s,/()&+–—-]+/).filter(Boolean);
  return words
    // Capitalized words, or words from caseless scripts (Korean, Thai, Devanagari…), look like names.
    .filter((w) => /^[\p{Lu}\p{Lo}]/u.test(w))
    // Short all-caps tokens are codes and abbreviations (GOI, BLR, DMR), not venue names.
    .filter((w) => !/^[\p{Lu}\d]{2,4}$/u.test(w))
    .map(normalize)
    .flatMap((w) => w.split(" "))
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !GENERIC.has(w) && !exclude.has(w) && !/^\d/.test(w));
}

function referenceText(ctx: PipelineContext, req: TripRequest) {
  const r = ctx.research;
  return [
    ctx.destination?.name,
    ...(ctx.places ? [...ctx.places.attractions, ...ctx.places.restaurants, ...ctx.places.stays].map((p) => p.name) : []),
    ...(r ? [...r.hotels.flatMap((h) => [h.name, h.area]), ...r.events, ...r.tips, r.localTransport, r.typicalCosts.notes] : []),
    ...(r ? r.gettingThere.map((g) => `${g.mode} ${g.description}`) : []),
    ...(ctx.flights ? ctx.flights.options.map((o) => o.airline) : []),
    req.specialRequirements,
    req.additionalInfo,
  ]
    .filter(Boolean)
    .join(" ");
}

function grounding({ req, itinerary, context }: CheckInput) {
  if (!context) return na("grounding", "no context captured");
  const refTokens = new Set(normalize(referenceText(context, req)).split(" "));
  const exclude = new Set(normalize(`${req.destination} ${req.origin}`).split(" "));
  const named = [
    // Travel legs ("Arrive GOI — transfer to hotel") aren't venues.
    ...itinerary.days.flatMap((d) => d.activities.map((a) => a.name).filter((n) => !TRAVEL_ACTIVITY.test(normalize(n)))),
    ...itinerary.days.flatMap((d) => d.meals.map((m) => m.place)),
    itinerary.accommodation.name,
  ];
  let specific = 0;
  const ungrounded: string[] = [];
  for (const name of new Set(named)) {
    if (!distinctiveTokens(name, exclude).length) continue;
    specific++;
    // A parenthesized part is an alternative name or gloss ("북촌한옥마을 (Bukchon Hanok Village)",
    // "Britto's (Baga)"): the venue is grounded if the main name or the gloss matches the data.
    const parts = [name.replace(/\([^)]*\)/g, " "), ...[...name.matchAll(/\(([^)]*)\)/g)].map((m) => m[1])];
    const grounded = parts.some((p) => {
      const tokens = distinctiveTokens(p, exclude);
      return tokens.length > 0 && tokens.every((t) => refTokens.has(t));
    });
    if (!grounded) ungrounded.push(name);
  }
  if (!specific) return na("grounding", "no named venues");
  return graded(
    "grounding",
    ratio(specific - ungrounded.length, specific),
    ungrounded.length ? `${ungrounded.length}/${specific} named venues not in context: ${preview(ungrounded)}` : `all ${specific} named venues found in context`,
  );
}

const normalizeUrl = (u: string) =>
  u.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/+$/, "");

function sourceValidity({ itinerary, context }: CheckInput) {
  const r = context?.research;
  if (!r) return na("sourceValidity", "no web research in context");
  const known = new Set([...r.sources.map((s) => s.url), ...r.hotels.flatMap((h) => (h.url ? [h.url] : []))].map(normalizeUrl));
  const cited = itinerary.sources.map((s) => s.url);
  if (!cited.length) return graded("sourceValidity", 0, "no sources cited although web research was available");
  const unknown = cited.filter((u) => !known.has(normalizeUrl(u)));
  return graded(
    "sourceValidity",
    ratio(cited.length - unknown.length, cited.length),
    unknown.length ? `${unknown.length}/${cited.length} cited URLs not from research: ${preview(unknown, 3)}` : `${cited.length} sources, all from research`,
  );
}

// ---- Weather, pace, transport ----

const TRAVEL_ACTIVITY = /\b(travel|flight|fly|train|bus|drive|transfer|check ?in|check ?out|depart|departure|arrive|arrival|journey|return|airport|station)\b/;

function weatherAware({ itinerary, context }: CheckInput) {
  const days = context?.weather?.days;
  if (!days?.length) return na("weatherAware", "no weather data");
  const byDate = new Map(days.map((w) => [w.date, w]));
  const flagged = itinerary.days.filter((d) => {
    const w = byDate.get(d.date);
    if (!w) return false;
    const wet = w.precipMm >= 5 || (w.precipMm >= 2 && /rain|shower|thunder/i.test(w.summary));
    return wet || w.tMax >= 38;
  });
  if (!flagged.length) return na("weatherAware", "no rainy or very hot days");
  const bad = flagged.filter((d) => {
    const sightseeing = d.activities.filter((a) => !TRAVEL_ACTIVITY.test(normalize(a.name)));
    return sightseeing.length > 1 && !sightseeing.some((a) => a.indoor);
  });
  return graded(
    "weatherAware",
    ratio(flagged.length - bad.length, flagged.length),
    bad.length
      ? `no indoor option on ${bad.map((d) => `day ${d.day} (${byDate.get(d.date)?.summary})`).join(", ")}`
      : `${flagged.length} rainy/hot days all have an indoor option`,
  );
}

/** Mirrors STYLE_PACE in lib/llm.ts; counts sightseeing activities on full days (not travel days). */
const PACE: Record<TripRequest["tripStyle"], [number, number]> = {
  relaxed: [1, 2],
  balanced: [2, 3],
  adventure: [3, 4],
  cultural: [2, 4],
  family: [2, 3],
};

function pace({ req, itinerary }: CheckInput) {
  const days = itinerary.days.length >= 3 ? itinerary.days.slice(1, -1) : itinerary.days;
  if (!days.length) return na("pace", "no full days");
  const [min, max] = PACE[req.tripStyle];
  const floor = itinerary.days.length >= 3 ? min : 0;
  const bad = days
    .map((d) => ({ d, n: d.activities.filter((a) => !TRAVEL_ACTIVITY.test(normalize(a.name))).length }))
    .filter(({ n }) => n < floor || n > max)
    .map(({ d, n }) => `day ${d.day}: ${n}`);
  return graded(
    "pace",
    ratio(days.length - bad.length, days.length),
    bad.length ? `outside ${min}-${max} activities for ${req.tripStyle}: ${preview(bad)}` : `every full day within ${min}-${max} activities`,
  );
}

const MODE_WORDS: Record<Exclude<TripRequest["travelMode"], "any">, RegExp> = {
  flight: /\b(flight|flights|fly|air|airline|plane)\b/,
  train: /\b(train|rail|railway|express|shatabdi|rajdhani|vande bharat)\b/,
  bus: /\b(bus|coach|volvo)\b/,
  car: /\b(car|drive|driving|road|taxi|cab|self drive)\b/,
};

function travelMode({ req, itinerary }: CheckInput) {
  if (req.travelMode === "any") return na("travelMode", "any mode allowed");
  if (normalize(req.origin) === normalize(req.destination)) return na("travelMode", "origin is the destination");
  const re = MODE_WORDS[req.travelMode];
  const legs = [itinerary.transport.outbound, itinerary.transport.return];
  const bad = legs.filter((l) => !re.test(normalize(l.mode)));
  return graded(
    "travelMode",
    ratio(legs.length - bad.length, legs.length),
    bad.length ? `asked for ${req.travelMode}, got ${bad.map((l) => l.mode).join(" / ")}` : `both legs by ${req.travelMode}`,
  );
}

function transportSource({ itinerary, context }: CheckInput) {
  if (!context?.flights?.options.length) return na("transportSource", "no live fares in context");
  const legs = [itinerary.transport.outbound, itinerary.transport.return];
  const ok = legs.filter((l) => l.source === "duffel").length;
  return graded("transportSource", ok / legs.length, `${ok}/2 legs use the live Duffel fare`);
}

// ---- Case-specific expectations ----

function expectations({ expect, itinerary }: CheckInput) {
  const total = expect.mustMention.length + expect.mustAvoid.length;
  if (!total) return na("expectations", "no case-specific expectations");
  const text = normalize(JSON.stringify({ ...itinerary, sources: [] }));
  const venues = normalize(
    [
      ...itinerary.days.flatMap((d) => [...d.activities.map((a) => a.name), ...d.meals.map((m) => m.place)]),
      itinerary.accommodation.name,
    ].join(" | "),
  );
  const failed = [
    ...expect.mustMention.filter((m) => !m.split("|").some((alt) => text.includes(normalize(alt)))).map((m) => `missing "${m}"`),
    ...expect.mustAvoid.filter((m) => m.split("|").some((alt) => venues.includes(normalize(alt)))).map((m) => `contains "${m}"`),
  ];
  return graded("expectations", ratio(total - failed.length, total), failed.length ? failed.join("; ") : `${total} expectations met`);
}

const CHECKS: Record<CheckId, (i: CheckInput) => CheckResult> = {
  dayCount,
  dates,
  nights,
  withinBudget,
  budgetArithmetic,
  dietCompliance,
  kidSafety,
  grounding,
  sourceValidity,
  weatherAware,
  pace,
  travelMode,
  transportSource,
  expectations,
};

export function runChecks(input: CheckInput): CheckResult[] {
  return CHECK_IDS.map((id) => {
    try {
      return CHECKS[id](input);
    } catch (e) {
      return graded(id, 0, `check crashed: ${e instanceof Error ? e.message : e}`);
    }
  });
}
