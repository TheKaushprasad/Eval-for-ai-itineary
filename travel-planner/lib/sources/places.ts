import type { TripRequest } from "../schema";
import { UA } from "./geocode";

export type Poi = {
  name: string;
  kind: string;
  lat: number;
  lon: number;
  tags: Record<string, string>;
};

export type PlacesResult = {
  attractions: Poi[];
  restaurants: Poi[];
  stays: Poi[];
};

// Public Overpass servers are often overloaded, so try mirrors in order.
const OVERPASS_URLS = process.env.OVERPASS_URL
  ? [process.env.OVERPASS_URL]
  : [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.private.coffee/api/interpreter",
      "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    ];

async function overpass(query: string): Promise<OverpassEl[]> {
  const errors: string[] = [];
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, Accept: "application/json" },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()).elements;
    } catch (e) {
      errors.push(`${new URL(url).host}: ${e instanceof Error ? e.message : e}`);
    }
  }
  throw new Error(`Overpass unavailable (${errors.join("; ")})`);
}

const STAY_TAGS: Record<TripRequest["accommodation"], string[]> = {
  budget: ["hostel", "guest_house", "motel"],
  "mid-range": ["hotel", "guest_house", "apartment"],
  luxury: ["hotel", "resort"],
  homestay: ["guest_house", "apartment", "chalet"],
};

// Maps the food preference to OSM diet tags; empty means no filter.
const DIET_TAGS: Record<TripRequest["food"], string[]> = {
  vegetarian: ["diet:vegetarian"],
  vegan: ["diet:vegan"],
  jain: ["diet:vegetarian"],
  halal: ["diet:halal"],
  "non-vegetarian": [],
  "no-preference": [],
};

export type Area = { lat: number; lon: number; bbox: [number, number, number, number] | null };

// Cities get a radius around the centre; regions (e.g. "Goa", a state) use their bounding box,
// since the centroid of a region is often nowhere near the places people visit.
const MAX_BBOX_DEG = 1.5;
function areaFilter({ lat, lon, bbox }: Area, radius: number) {
  if (bbox) {
    const [s, n, w, e] = bbox;
    const big = n - s > 0.3 || e - w > 0.3;
    if (big && n - s <= MAX_BBOX_DEG && e - w <= MAX_BBOX_DEG) return `(${s},${w},${n},${e})`;
  }
  return `(around:${radius},${lat},${lon})`;
}

export function buildQuery(area: Area, radius: number, req: TripRequest) {
  const f = areaFilter(area, radius);
  const diet = DIET_TAGS[req.food];
  const restaurants = diet.length
    ? diet.map((t) => `nwr["amenity"="restaurant"]["name"]["${t}"~"yes|only"]${f};`).join("\n  ")
    : `nwr["amenity"="restaurant"]["name"]${f};`;
  const stays = STAY_TAGS[req.accommodation].map((t) => `nwr["tourism"="${t}"]["name"]${f};`).join("\n  ");
  // Separate sets with their own limits so dense restaurant data can't crowd out sights.
  return `[out:json][timeout:25];
(
  nwr["tourism"~"^(attraction|museum|viewpoint|theme_park|zoo|gallery)$"]["name"]${f};
  nwr["historic"~"^(monument|fort|castle|ruins|memorial)$"]["name"]${f};
  nwr["natural"="beach"]["name"]${f};
  nwr["leisure"="nature_reserve"]["name"]${f};
)->.sights;
(
  ${restaurants}
)->.food;
(
  ${stays}
)->.stays;
.sights out center tags 200;
.food out center tags 100;
.stays out center tags 100;`;
}

type OverpassEl = { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

function toPoi(el: OverpassEl): Poi | null {
  const tags = el.tags ?? {};
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (!tags.name || lat === undefined || lon === undefined) return null;
  const kind = tags.tourism || tags.historic || tags.natural || tags.leisure || tags.amenity || "place";
  return { name: tags.name, kind, lat, lon, tags };
}

// Well-documented places (wikidata/wikipedia/website) first; they're usually the notable ones.
const score = (p: Poi) =>
  (p.tags.wikidata ? 3 : 0) + (p.tags.wikipedia ? 2 : 0) + (p.tags.website ? 1 : 0) + (p.tags.stars ? 1 : 0);

function top(pois: Poi[], n: number) {
  const seen = new Set<string>();
  return pois
    .filter((p) => !seen.has(p.name.toLowerCase()) && seen.add(p.name.toLowerCase()))
    .sort((a, b) => score(b) - score(a))
    .slice(0, n);
}

export async function getPlaces(area: Area, req: TripRequest, radius = 15000): Promise<PlacesResult> {
  const pois = (await overpass(buildQuery(area, radius, req))).map(toPoi).filter((p): p is Poi => p !== null);

  const stayKinds = new Set(STAY_TAGS[req.accommodation]);
  return {
    attractions: top(pois.filter((p) => p.tags.tourism !== "hotel" && p.kind !== "restaurant" && !stayKinds.has(p.kind)), 25),
    restaurants: top(pois.filter((p) => p.tags.amenity === "restaurant"), 15),
    stays: top(pois.filter((p) => stayKinds.has(p.tags.tourism ?? "")), 10),
  };
}

/** Compact form for the LLM prompt. */
export function summarizePois(pois: Poi[]) {
  return pois.map((p) => ({
    name: p.name,
    kind: p.kind,
    ...(p.tags.cuisine && { cuisine: p.tags.cuisine }),
    ...(p.tags.stars && { stars: p.tags.stars }),
    ...(p.tags["addr:city"] && { city: p.tags["addr:city"] }),
  }));
}
