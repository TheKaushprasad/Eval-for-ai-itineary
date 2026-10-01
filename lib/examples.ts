import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ItineraryResult, TripRequest } from "./schema";

/** Pre-generated itineraries shown on the home page, so visitors see real output for free. */
export type Example = {
  id: string;
  title: string;
  blurb: string;
  /** Where it came from, e.g. "eval run v2-diet-rules (gemini/gemini-2.5-flash)". */
  source: string;
  request: TripRequest;
  result: ItineraryResult;
};

export const EXAMPLES_DIR = join(process.cwd(), "data", "examples");

export function loadExamples(): Example[] {
  if (!existsSync(EXAMPLES_DIR)) return [];
  return readdirSync(EXAMPLES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(EXAMPLES_DIR, f), "utf8")) as Example);
}
