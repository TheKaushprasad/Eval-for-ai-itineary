import { basename } from "node:path";
import { summarize, type Summary } from "@/eval/metrics";
import { listRuns, readRun, type RunFile } from "@/eval/shared";

/** Eval runs committed under eval/results, oldest first. Read at build time by the /evals pages. */
export type RunInfo = { id: string; run: RunFile; summary: Summary };

const idOf = (file: string) => basename(file, ".json");

export function runIds(): string[] {
  return listRuns().map(idOf);
}

export function loadRun(id: string): RunInfo | null {
  // Only ids that exist on disk are accepted, so a URL can't point the loader elsewhere.
  const file = listRuns().find((f) => idOf(f) === id);
  if (!file) return null;
  const run = readRun(file);
  return { id, run, summary: summarize(run) };
}

export function history(): RunInfo[] {
  return runIds().map((id) => loadRun(id)!);
}

export const prettyDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
