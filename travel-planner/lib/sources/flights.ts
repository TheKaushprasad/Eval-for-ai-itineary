/**
 * Flight offers. Duffel is the only provider today; the interface keeps it swappable
 * (Amadeus Self-Service was shut down in July 2026).
 */
export type FlightOption = {
  airline: string;
  totalAmount: number;
  currency: string;
  slices: Array<{
    from: string;
    to: string;
    departing: string;
    arriving: string;
    duration: string | null;
    stops: number;
    flights: string[];
  }>;
};

export type FlightSearch = {
  origin: { lat: number; lon: number; name: string };
  destination: { lat: number; lon: number; name: string };
  departDate: string;
  returnDate: string;
  adults: number;
  childAges: number[];
};

export type FlightResult = { provider: string; from: string; to: string; options: FlightOption[] };

export interface FlightProvider {
  name: string;
  isConfigured(): boolean;
  search(q: FlightSearch): Promise<FlightResult>;
}

const DUFFEL = "https://api.duffel.com";

async function duffel<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${DUFFEL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.DUFFEL_ACCESS_TOKEN}`,
      "Duffel-Version": "v2",
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Duffel ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()).data as T;
}

type DuffelPlace = { type: "airport" | "city"; iata_code: string; name: string; airports?: { iata_code: string }[] | null };

/** Nearest airport (or city code) to a point, falling back to a name search. */
async function nearestCode(p: { lat: number; lon: number; name: string }): Promise<string> {
  const near = await duffel<DuffelPlace[]>(`/places/suggestions?lat=${p.lat}&lng=${p.lon}&rad=100000`);
  const airport = near.find((x) => x.type === "airport") ?? near[0];
  if (airport) return airport.iata_code;
  const byName = await duffel<DuffelPlace[]>(`/places/suggestions?query=${encodeURIComponent(p.name.split(",")[0])}`);
  if (!byName[0]) throw new Error(`No airport near ${p.name}`);
  return byName[0].iata_code;
}

type DuffelOffer = {
  total_amount: string;
  total_currency: string;
  owner: { name: string };
  slices: Array<{
    duration: string | null;
    origin: { iata_code: string };
    destination: { iata_code: string };
    segments: Array<{
      departing_at: string;
      arriving_at: string;
      marketing_carrier: { iata_code: string };
      marketing_carrier_flight_number: string;
    }>;
  }>;
};

export const duffelProvider: FlightProvider = {
  name: "duffel",
  isConfigured: () => Boolean(process.env.DUFFEL_ACCESS_TOKEN),
  async search(q) {
    const [from, to] = await Promise.all([nearestCode(q.origin), nearestCode(q.destination)]);
    if (from === to) throw new Error(`Origin and destination share airport ${from}; flying doesn't make sense`);

    const passengers = [
      ...Array.from({ length: q.adults }, () => ({ type: "adult" })),
      ...q.childAges.map((age) => ({ age })),
    ];
    const req = await duffel<{ offers: DuffelOffer[] }>(`/air/offer_requests?return_offers=true&supplier_timeout=20000`, {
      method: "POST",
      body: JSON.stringify({
        data: {
          slices: [
            { origin: from, destination: to, departure_date: q.departDate },
            { origin: to, destination: from, departure_date: q.returnDate },
          ],
          passengers,
          cabin_class: "economy",
          max_connections: 1,
        },
      }),
    });

    const options = req.offers
      .sort((a, b) => Number(a.total_amount) - Number(b.total_amount))
      .slice(0, 3)
      .map<FlightOption>((o) => ({
        airline: o.owner.name,
        totalAmount: Number(o.total_amount),
        currency: o.total_currency,
        slices: o.slices.map((s) => ({
          from: s.origin.iata_code,
          to: s.destination.iata_code,
          departing: s.segments[0]?.departing_at,
          arriving: s.segments[s.segments.length - 1]?.arriving_at,
          duration: s.duration,
          stops: s.segments.length - 1,
          flights: s.segments.map((seg) => `${seg.marketing_carrier.iata_code}${seg.marketing_carrier_flight_number}`),
        })),
      }));
    return { provider: "duffel", from, to, options };
  },
};

export function getFlightProvider(): FlightProvider | null {
  return duffelProvider.isConfigured() ? duffelProvider : null;
}
