import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Itinerary } from "@/lib/schema";
import { TripRequestSchema, type TripRequest } from "@/lib/schema";
import type { CheckResult } from "./graders/checks";
import type { JudgeResult } from "./graders/judge";

export const EVAL_DIR = dirname(fileURLToPath(import.meta.url));
export const CASES_FILE = join(EVAL_DIR, "cases", "cases.jsonl");
export const SNAPSHOT_DIR = join(EVAL_DIR, "snapshots");
export const RESULTS_DIR = join(EVAL_DIR, "results");
export const BASELINE_FILE = join(RESULTS_DIR, "baseline.json");

// ---- Cases ----

export const CATEGORIES = ["core", "budget", "diet", "family", "duration", "weather", "special", "edge"] as const;
export type Category = (typeof CATEGORIES)[number];

export const ExpectSchema = z
  .object({
    /** Each entry must appear somewhere in the itinerary text; "a|b" means either. */
    mustMention: z.array(z.string()).default([]),
    /** None of these may appear in an activity name or meal place. */
    mustAvoid: z.array(z.string()).default([]),
  })
  .default({ mustMention: [], mustAvoid: [] });
export type Expect = z.infer<typeof ExpectSchema>;

export const EvalCaseSchema = z.object({
  id: z.string(),
  category: z.enum(CATEGORIES),
  tags: z.array(z.string()).default([]),
  note: z.string().default(""),
  request: TripRequestSchema,
  expect: ExpectSchema,
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export function loadCases(file = CASES_FILE): EvalCase[] {
  const cases = readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//"))
    .map((l, i) => {
      const parsed = EvalCaseSchema.safeParse(JSON.parse(l));
      if (!parsed.success) throw new Error(`cases.jsonl line ${i + 1}: ${parsed.error.message}`);
      return parsed.data;
    });
  const dupes = cases.map((c) => c.id).filter((id, i, all) => all.indexOf(id) !== i);
  if (dupes.length) throw new Error(`Duplicate case ids: ${dupes.join(", ")}`);
  return cases;
}

/** Stable hash of a request, so a snapshot recorded for an older version of a case is detected. */
export const requestHash = (req: TripRequest) =>
  createHash("sha256").update(JSON.stringify(req)).digest("hex").slice(0, 12);

// ---- Run files ----

export type CaseResult = {
  id: string;
  category: Category;
  tags: string[];
  ok: boolean;
  error?: string;
  latencyMs: number;
  revised: boolean;
  withinBudget: boolean | null;
  computedTotal: number | null;
  budgetLimit: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  warnings: string[];
  checks: CheckResult[];
  judge?: JudgeResult;
  /** Final itinerary as the pipeline returned it (budget recomputed). */
  itinerary?: Itinerary;
};

export type RunFile = {
  label: string;
  createdAt: string;
  gitSha: string;
  gitDirty: boolean;
  mode: "replay" | "live";
  model: string;
  judgeModel: string | null;
  cases: CaseResult[];
};

export function readRun(file: string): RunFile {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Run files, oldest first (file names start with an ISO timestamp). */
export function listRuns(): string[] {
  if (!existsSync(RESULTS_DIR)) return [];
  return readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith(".json") && f !== "baseline.json")
    .sort()
    .map((f) => join(RESULTS_DIR, f));
}

export function writeJson(file: string, data: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

export function git() {
  try {
    const sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain -- lib app", { encoding: "utf8" }).trim().length > 0;
    return { sha, dirty };
  } catch {
    return { sha: "unknown", dirty: false };
  }
}

// ---- CLI + concurrency ----

/** Tiny flag parser: --key value, --flag (true), and positional args. */
export function parseArgs(argv = process.argv.slice(2)) {
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const [key, inline] = a.slice(2).split("=", 2);
    if (inline !== undefined) flags[key] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) flags[key] = argv[++i];
    else flags[key] = true;
  }
  const str = (k: string) => (typeof flags[k] === "string" ? (flags[k] as string) : undefined);
  const num = (k: string, d: number) => (str(k) ? Number(str(k)) : d);
  return { flags, positional, str, num, has: (k: string) => k in flags };
}

/** Filters cases by --only (category or id prefix, comma-separated), --ids and --limit. */
export function selectCases(cases: EvalCase[], args: ReturnType<typeof parseArgs>) {
  let out = cases;
  const only = args.str("only")?.split(",");
  if (only) out = out.filter((c) => only.some((o) => c.category === o || c.id.startsWith(o)));
  const ids = args.str("ids")?.split(",");
  if (ids) out = out.filter((c) => ids.includes(c.id));
  const limit = args.num("limit", Infinity);
  return out.slice(0, limit);
}

export async function pool<T, R>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
  return out;
}

export const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
