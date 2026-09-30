import { describe, expect, it, vi } from "vitest";
import type { OnUsage } from "@/lib/llm";
import type { Itinerary, TripRequest } from "@/lib/schema";
import { tripDates } from "@/lib/sources/weather";
import { sampleItinerary } from "@/tests/fixtures";
import type { JudgeResult } from "./graders/judge";
import { compare, formatComparison, formatSummary, summarize } from "./metrics";
import { runCase, type RunOptions } from "./runner";
import type { Snapshot } from "./snapshot";
import { loadCases, requestHash, type EvalCase, type RunFile } from "./shared";

const goa = loadCases().find((c) => c.id === "core-goa-relaxed")!;

const snapshot = (c: EvalCase): Snapshot => ({
  id: c.id,
  requestHash: requestHash(c.request),
  recordedAt: "2026-09-30T00:00:00Z",
  geocode: {
    [c.request.destination]: { ok: true, value: { query: c.request.destination, name: "Goa, India", lat: 15.3, lon: 74.1, country: "India", countryCode: "IN", bbox: null } },
    [c.request.origin]: { ok: true, value: { query: c.request.origin, name: "Bengaluru, India", lat: 12.9, lon: 77.6, country: "India", countryCode: "IN", bbox: null } },
  },
  weather: {
    ok: true,
    value: tripDates(c.request.startDate, c.request.days).map((date) => ({ date, tMax: 31, tMin: 22, precipMm: 0, rainChance: 5, summary: "Mostly dry", kind: "typical" as const })),
  },
  places: {
    ok: true,
    value: {
      attractions: [{ name: "Fort Aguada", kind: "fort", lat: 15.49, lon: 73.77, tags: {} }],
      restaurants: [{ name: "Britto's", kind: "restaurant", lat: 15.55, lon: 73.75, tags: {} }],
      stays: [{ name: "Casa Anjuna", kind: "hotel", lat: 15.58, lon: 73.74, tags: {} }],
    },
  },
  flightProvider: null,
  research: { ok: false, error: "Research returned no structured output" },
});

/** A fake itinerary model that follows the request and bills some tokens. */
function fakeModel(over: (req: TripRequest) => Partial<Itinerary> = () => ({})) {
  const generateItinerary = vi.fn(async (req: TripRequest, _ctx: unknown, _limit: number, onUsage?: OnUsage) => {
    onUsage?.({ model: "gpt-5", inputTokens: 10_000, outputTokens: 5_000 });
    const base = sampleItinerary();
    const days = tripDates(req.startDate, req.days).map((date, i) => ({
      ...base.days[0],
      day: i + 1,
      date,
      activities: [
        { ...base.days[0].activities[0], name: "Fort Aguada" },
        { ...base.days[0].activities[0], name: "Lunch break at Britto's" },
      ],
      meals: [{ ...base.days[0].meals[0], place: "Britto's", cuisine: "Goan" }],
    }));
    const it: Itinerary = { ...base, days, accommodation: { ...base.accommodation, name: "Casa Anjuna" }, ...over(req) };
    return it;
  });
  const reviseForBudget = vi.fn(async (req: TripRequest, ctx: unknown, limit: number, _draft: Itinerary, _overBy: number, onUsage?: OnUsage) =>
    generateItinerary(req, ctx, limit, onUsage),
  );
  return { generateItinerary, reviseForBudget };
}

const fakeJudge = async (): Promise<JudgeResult> => ({
  model: "judge",
  scores: {
    styleMatch: { score: 4, reason: "" },
    pace: { score: 4, reason: "" },
    logistics: { score: 3, reason: "" },
    requirements: { score: 5, reason: "" },
    helpfulness: { score: 4, reason: "" },
  },
  mean: 4,
  inputTokens: 0,
  outputTokens: 0,
});

const opts = (over: Partial<RunOptions> = {}): RunOptions => ({
  judge: fakeJudge,
  llm: fakeModel(),
  loadSnapshot: () => snapshot(goa),
  ...over,
});

const runFile = (label: string, cases: RunFile["cases"]): RunFile => ({
  label, createdAt: "", gitSha: "abc", gitDirty: false, mode: "replay", model: "gpt-5", judgeModel: "judge", cases,
});

describe("runCase", () => {
  it("replays the snapshot, grades the itinerary and prices the tokens", async () => {
    const r = await runCase(goa, opts());
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual(["research: Research returned no structured output"]);
    const status = Object.fromEntries(r.checks.map((c) => [c.id, c.status]));
    expect(status).toMatchObject({ dayCount: "pass", dates: "pass", nights: "pass", grounding: "pass", kidSafety: "na", sourceValidity: "na" });
    expect(r.judge?.mean).toBe(4);
    expect(r.inputTokens).toBe(10_000);
    expect(r.costUsd).toBeCloseTo(0.0625, 4); // 10k × $1.25/M + 5k × $10/M
  });

  it("reports missing and stale snapshots as errors instead of throwing", async () => {
    expect((await runCase(goa, opts({ loadSnapshot: () => null }))).error).toMatch(/no snapshot/);
    const stale = { ...snapshot(goa), requestHash: "old" };
    expect((await runCase(goa, opts({ loadSnapshot: () => stale }))).error).toMatch(/stale/);
  });

  it("records a generation failure as a failed case", async () => {
    const llm = fakeModel();
    llm.generateItinerary.mockRejectedValueOnce(new Error("429 You have no credits remaining"));
    const r = await runCase(goa, opts({ llm }));
    expect(r).toMatchObject({ ok: false, error: "429 You have no credits remaining" });
  });
});

describe("summaries and comparisons", () => {
  it("summarizes a run and spots per-case regressions", async () => {
    const good = await runCase(goa, opts());
    const shortTrip = await runCase(goa, opts({ llm: fakeModel(() => ({ days: [] })) }));
    const a = runFile("v1", [good]);
    const b = runFile("v2", [{ ...shortTrip, id: good.id }]);

    const s = summarize(a);
    expect(s.overall.dayCount).toEqual({ value: 1, n: 1 });
    expect(s.overall["judge.mean"].value).toBe(4);
    expect(formatSummary(s)).toContain("| dayCount | **100%**");

    const cmp = compare(a, b);
    expect(cmp.rows.find((r) => r.key === "dayCount")?.delta).toBe(-1);
    expect(cmp.regressions.map((r) => r.what)).toContainEqual(expect.stringContaining("dayCount"));
    expect(formatComparison(cmp)).toContain("v1 → v2");
  });

  it("counts errored cases against success and strict pass", async () => {
    const good = await runCase(goa, opts());
    const s = summarize(runFile("x", [good, { ...good, id: "broken", ok: false, error: "boom", checks: [] }]));
    expect(s.overall.success.value).toBe(0.5);
    expect(s.overall.dayCount.n).toBe(1);
    expect(s.errors).toEqual([{ id: "broken", error: "boom" }]);
  });
});
