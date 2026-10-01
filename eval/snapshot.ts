import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultDeps, type Deps } from "@/lib/pipeline";
import type { FlightResult } from "@/lib/sources/flights";
import type { Place } from "@/lib/sources/geocode";
import type { PlacesResult } from "@/lib/sources/places";
import type { Research } from "@/lib/sources/research";
import type { DayWeather } from "@/lib/sources/weather";
import { errMessage, SNAPSHOT_DIR } from "./shared";

/**
 * A snapshot freezes everything the pipeline fetches before generation (geocoding, weather,
 * OSM places, flights, web research) so eval runs differ only in what the itinerary model does.
 * Failures are recorded too: a case whose places lookup failed should keep failing on replay.
 */
type Recorded<T> = { ok: true; value: T } | { ok: false; error: string };

export type Snapshot = {
  id: string;
  requestHash: string;
  recordedAt: string;
  geocode: Record<string, Recorded<Place>>;
  /** Undefined means the pipeline skipped the step (e.g. destination not found). */
  weather?: Recorded<DayWeather[]>;
  places?: Recorded<PlacesResult>;
  flightProvider: string | null;
  flights?: Recorded<FlightResult>;
  research?: Recorded<Research>;
};

export const snapshotPath = (id: string) => join(SNAPSHOT_DIR, `${id}.json`);

export function readSnapshot(id: string): Snapshot | null {
  const file = snapshotPath(id);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

async function record<T>(fn: () => Promise<T>, save: (r: Recorded<T>) => void): Promise<T> {
  try {
    const value = await fn();
    save({ ok: true, value });
    return value;
  } catch (e) {
    save({ ok: false, error: errMessage(e) });
    throw e;
  }
}

/** Thrown by the recording deps to stop the pipeline once all data has been fetched. */
export class RecordingDone extends Error {}

/** Live deps that write every data-source result into `snap` and stop before generation. */
export function recordingDeps(snap: Snapshot, opts: { research?: boolean } = {}): Deps {
  const research: Deps["research"] =
    opts.research === false
      ? async () => {
          throw new Error("web research disabled for this snapshot (--no-research)");
        }
      : defaultDeps.research;
  return {
    ...defaultDeps,
    geocode: (q) => record(() => defaultDeps.geocode(q), (r) => (snap.geocode[q] = r)),
    getWeather: (...a) => record(() => defaultDeps.getWeather(...a), (r) => (snap.weather = r)),
    getPlaces: (...a) => record(() => defaultDeps.getPlaces(...a), (r) => (snap.places = r)),
    getFlightProvider: () => {
      const provider = defaultDeps.getFlightProvider();
      snap.flightProvider = provider?.name ?? null;
      return provider && { ...provider, search: (q) => record(() => provider.search(q), (r) => (snap.flights = r)) };
    },
    research: (...a) => record(() => research(...a), (r) => (snap.research = r)),
    generateItinerary: async () => {
      throw new RecordingDone();
    },
    sendItineraryEmail: async () => {},
  };
}

function unwrap<T>(r: Recorded<T> | undefined, what: string): T {
  if (!r) throw new Error(`${what} was not recorded in the snapshot`);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

/** Deps that replay a snapshot; only the itinerary model (and the budget revision) call out. */
export function replayDeps(snap: Snapshot, over: Partial<Deps> = {}): Deps {
  return {
    ...defaultDeps,
    geocode: async (q) => unwrap(snap.geocode[q], `geocode "${q}"`),
    getWeather: async () => unwrap(snap.weather, "weather"),
    getPlaces: async () => unwrap(snap.places, "places"),
    getFlightProvider: () =>
      snap.flightProvider
        ? { name: snap.flightProvider, isConfigured: () => true, search: async () => unwrap(snap.flights, "flights") }
        : null,
    research: async () => unwrap(snap.research, "research"),
    sendItineraryEmail: async () => {},
    ...over,
  };
}
