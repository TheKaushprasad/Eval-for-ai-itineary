export type Place = {
  query: string;
  name: string;
  lat: number;
  lon: number;
  country: string | null;
  countryCode: string | null;
  /** [south, north, west, east] */
  bbox: [number, number, number, number] | null;
};

export const UA = process.env.NOMINATIM_USER_AGENT || "ai-travel-itinerary-planner/0.1 (demo)";
const cache = new Map<string, Place>();

// Nominatim allows at most 1 request per second.
let lastCall = 0;
async function throttle() {
  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

export async function geocode(query: string): Promise<Place> {
  const key = query.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;

  await throttle();
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");

  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en" } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const [first] = (await res.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
    boundingbox?: [string, string, string, string];
    address?: { country?: string; country_code?: string };
  }>;
  if (!first) throw new Error(`Couldn't find "${query}"`);

  const place: Place = {
    query,
    name: first.display_name,
    lat: Number(first.lat),
    lon: Number(first.lon),
    country: first.address?.country ?? null,
    countryCode: first.address?.country_code?.toUpperCase() ?? null,
    bbox: first.boundingbox ? (first.boundingbox.map(Number) as Place["bbox"]) : null,
  };
  cache.set(key, place);
  return place;
}
