export type DayWeather = {
  date: string;
  tMax: number;
  tMin: number;
  precipMm: number;
  rainChance: number | null;
  summary: string;
  kind: "forecast" | "typical";
};

const FORECAST_HORIZON_DAYS = 15;

export function tripDates(startDate: string, days: number): string[] {
  const start = new Date(`${startDate}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

function describe(tMax: number, precip: number, code?: number): string {
  if (code !== undefined && code >= 95) return "Thunderstorms";
  if (precip >= 10) return "Heavy rain";
  if (precip >= 2) return "Showers";
  if (tMax >= 33) return "Hot and sunny";
  if (tMax <= 5) return "Cold";
  return precip > 0.2 ? "Mostly dry, light rain possible" : "Mostly dry";
}

const round = (n: number) => Math.round(n * 10) / 10;

export async function getWeather(lat: number, lon: number, startDate: string, days: number, today = new Date()) {
  const dates = tripDates(startDate, days);
  const horizon = new Date(today);
  horizon.setUTCDate(horizon.getUTCDate() + FORECAST_HORIZON_DAYS);
  const inForecast = new Date(`${dates[dates.length - 1]}T00:00:00Z`) <= horizon;

  if (inForecast) {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code",
      timezone: "auto",
      start_date: dates[0],
      end_date: dates[dates.length - 1],
    }).toString();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo forecast ${res.status}`);
    const { daily } = await res.json();
    return dates.map<DayWeather>((date, i) => ({
      date,
      tMax: round(daily.temperature_2m_max[i]),
      tMin: round(daily.temperature_2m_min[i]),
      precipMm: round(daily.precipitation_sum[i] ?? 0),
      rainChance: daily.precipitation_probability_max?.[i] ?? null,
      summary: describe(daily.temperature_2m_max[i], daily.precipitation_sum[i] ?? 0, daily.weather_code?.[i]),
      kind: "forecast",
    }));
  }

  // Too far out for a forecast: average the same calendar days over the past 3 years.
  const years = [1, 2, 3].map((n) => today.getUTCFullYear() - n);
  const samples = await Promise.all(
    years.map(async (y) => {
      const shift = (d: string) => `${y + (Number(d.slice(0, 4)) - Number(dates[0].slice(0, 4)))}${d.slice(4)}`;
      const url = new URL("https://archive-api.open-meteo.com/v1/archive");
      url.search = new URLSearchParams({
        latitude: String(lat),
        longitude: String(lon),
        daily: "temperature_2m_max,temperature_2m_min,precipitation_sum",
        timezone: "auto",
        start_date: shift(dates[0]),
        end_date: shift(dates[dates.length - 1]),
      }).toString();
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Open-Meteo archive ${res.status}`);
      return (await res.json()).daily as {
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        precipitation_sum: number[];
      };
    }),
  );
  const avg = (pick: (s: (typeof samples)[number]) => number[], i: number) => {
    const vals = samples.map((s) => pick(s)[i]).filter((v) => typeof v === "number");
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  };
  return dates.map<DayWeather>((date, i) => {
    const tMax = avg((s) => s.temperature_2m_max, i);
    const precip = avg((s) => s.precipitation_sum, i);
    const rainyYears = samples.filter((s) => (s.precipitation_sum[i] ?? 0) >= 1).length;
    return {
      date,
      tMax: round(tMax),
      tMin: round(avg((s) => s.temperature_2m_min, i)),
      precipMm: round(precip),
      rainChance: Math.round((rainyYears / samples.length) * 100),
      summary: `Typically: ${describe(tMax, precip).toLowerCase()}`,
      kind: "typical",
    };
  });
}
