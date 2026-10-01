import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { codeMatches, guardGeneration, plannerMode, resetQuota, takeQuota } from "@/lib/access";

const request = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/itinerary", { method: "POST", headers: { "x-forwarded-for": "1.2.3.4", ...headers } });

beforeEach(() => resetQuota());
afterEach(() => vi.unstubAllEnvs());

describe("plannerMode", () => {
  it("defaults to open and fails closed when the code is missing", () => {
    expect(plannerMode()).toBe("open");
    vi.stubEnv("PLANNER_MODE", "code");
    expect(plannerMode()).toBe("examples");
    vi.stubEnv("DEMO_ACCESS_CODE", "trip2026");
    expect(plannerMode()).toBe("code");
  });
});

describe("guardGeneration", () => {
  it("lets everything through in open mode", () => {
    expect(guardGeneration(request())).toBeNull();
  });

  it("blocks live generation in examples mode", () => {
    vi.stubEnv("PLANNER_MODE", "examples");
    expect(guardGeneration(request())?.status).toBe(403);
  });

  it("requires the right access code in code mode", () => {
    vi.stubEnv("PLANNER_MODE", "code");
    vi.stubEnv("DEMO_ACCESS_CODE", "trip2026");
    expect(guardGeneration(request())?.status).toBe(401);
    expect(guardGeneration(request({ "x-access-code": "wrong" }))?.status).toBe(401);
    expect(guardGeneration(request({ "x-access-code": "trip2026" }))).toBeNull();
    expect(codeMatches("trip2026")).toBe(true);
  });

  it("enforces the per-visitor limit in code mode", () => {
    vi.stubEnv("PLANNER_MODE", "code");
    vi.stubEnv("DEMO_ACCESS_CODE", "c");
    vi.stubEnv("RATE_LIMIT_PER_IP", "2");
    const ok = () => guardGeneration(request({ "x-access-code": "c" }));
    expect(ok()).toBeNull();
    expect(ok()).toBeNull();
    expect(ok()?.status).toBe(429);
    // Another visitor still gets in.
    expect(guardGeneration(request({ "x-access-code": "c", "x-forwarded-for": "5.6.7.8" }))).toBeNull();
  });
});

describe("takeQuota", () => {
  it("caps the whole demo per day and resets the next day", () => {
    vi.stubEnv("DAILY_LIMIT", "2");
    const day1 = new Date("2026-10-01T10:00:00Z");
    expect(takeQuota("a", "code", day1).ok).toBe(true);
    expect(takeQuota("b", "code", day1).ok).toBe(true);
    expect(takeQuota("c", "code", day1).ok).toBe(false);
    expect(takeQuota("c", "code", new Date("2026-10-02T10:00:00Z")).ok).toBe(true);
  });
});
