/**
 * Records a frozen data snapshot per case: geocoding, weather, OSM places, flights and web
 * research, exactly as runPipeline fetches them. Generation is skipped.
 *
 *   npm run eval:record -- [--only core,diet] [--ids a,b] [--limit 3] [--force] [--concurrency 2]
 *                          [--allow-failures]   save snapshots even if a step failed transiently
 */
import { runPipeline } from "@/lib/pipeline";
import { recordingDeps, readSnapshot, RecordingDone, snapshotPath, type Snapshot } from "./snapshot";
import { errMessage, loadCases, parseArgs, pool, requestHash, selectCases, writeJson } from "./shared";

const args = parseArgs();
const cases = selectCases(loadCases(), args);
const force = args.has("force");

let recorded = 0;
let skipped = 0;
let failed = 0;

/** Failures that say something about the input (worth replaying) rather than the network. */
const DETERMINISTIC = /couldn't find|no airport near|share airport/i;

function transientFailures(snap: Snapshot) {
  const steps = { ...Object.fromEntries(Object.entries(snap.geocode).map(([q, r]) => [`geocode "${q}"`, r])), weather: snap.weather, places: snap.places, flights: snap.flights, research: snap.research };
  return Object.entries(steps).flatMap(([name, r]) => (r && !r.ok && !DETERMINISTIC.test(r.error) ? [`${name}: ${r.error.slice(0, 80)}`] : []));
}

async function main() {
  await pool(cases, args.num("concurrency", 2), async (c) => {
    const hash = requestHash(c.request);
    if (!force && readSnapshot(c.id)?.requestHash === hash) {
      skipped++;
      return;
    }
    const snap: Snapshot = { id: c.id, requestHash: hash, recordedAt: new Date().toISOString(), geocode: {}, flightProvider: null };
    const t0 = Date.now();
    try {
      await runPipeline({ ...c.request, email: "" }, () => {}, recordingDeps(snap));
    } catch (e) {
      if (!(e instanceof RecordingDone)) {
        failed++;
        console.error(`✗ ${c.id}: ${errMessage(e)}`);
        return;
      }
    }
    // Don't freeze a network blip, rate limit or billing error into the test set.
    const transient = transientFailures(snap);
    if (transient.length && !args.has("allow-failures")) {
      failed++;
      console.error(`✗ ${c.id}: not saved, transient failure(s): ${transient.join("; ")}`);
      return;
    }
    writeJson(snapshotPath(c.id), snap);
    recorded++;

    const show = <T>(r: { ok: true; value: T } | { ok: false; error: string } | undefined, fmt: (v: T) => string) =>
      !r ? "skipped" : r.ok ? fmt(r.value) : `FAILED (${r.error.slice(0, 60)})`;
    console.log(
      `✓ ${c.id} (${((Date.now() - t0) / 1000).toFixed(0)}s)  ` +
        [
          `places: ${show(snap.places, (p) => `${p.attractions.length}/${p.restaurants.length}/${p.stays.length}`)}`,
          `weather: ${show(snap.weather, (w) => w[0]?.kind ?? "empty")}`,
          `flights: ${snap.flightProvider ? show(snap.flights, (f) => `${f.options.length} offers`) : "no provider"}`,
          `research: ${show(snap.research, (r) => `${r.sources.length} sources`)}`,
        ].join("  "),
    );
  });

  console.log(`\nRecorded ${recorded}, up to date ${skipped}, failed ${failed}.`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
