import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Who may run live generation (which spends API credit):
 * - "open"      anyone (local development; the default)
 * - "code"      only requests carrying DEMO_ACCESS_CODE (share it with recruiters)
 * - "examples"  nobody; the page shows pre-generated example trips only
 */
export type PlannerMode = "open" | "code" | "examples";

export function plannerMode(): PlannerMode {
  const m = process.env.PLANNER_MODE;
  if (m === "code" && !process.env.DEMO_ACCESS_CODE) return "examples"; // fail closed
  return m === "code" || m === "examples" ? m : "open";
}

const sha = (s: string) => createHash("sha256").update(s).digest();
/** Constant-time comparison so the code can't be guessed character by character. */
export function codeMatches(given: string | null, expected = process.env.DEMO_ACCESS_CODE) {
  return Boolean(given && expected && timingSafeEqual(sha(given), sha(expected)));
}

const limitFrom = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Best-effort daily limits, per visitor and overall. They live in memory, so each server
 * instance counts separately and a restart resets them; the provider spend limit is the hard
 * cap. Swap in Redis (e.g. Upstash) if the demo gets real traffic.
 */
const counts = { day: "", total: 0, byIp: new Map<string, number>() };

export function takeQuota(ip: string, mode: PlannerMode, now = new Date()) {
  const perIp = limitFrom("RATE_LIMIT_PER_IP", mode === "open" ? Infinity : 3);
  const daily = limitFrom("DAILY_LIMIT", mode === "open" ? Infinity : 20);
  const day = now.toISOString().slice(0, 10);
  if (counts.day !== day) Object.assign(counts, { day, total: 0, byIp: new Map() });

  const used = counts.byIp.get(ip) ?? 0;
  if (counts.total >= daily) return { ok: false as const, reason: "The demo's daily limit is reached. Try again tomorrow, or browse the example trips." };
  if (used >= perIp) return { ok: false as const, reason: `You've used your ${perIp} live plans for today. Try again tomorrow.` };
  counts.total++;
  counts.byIp.set(ip, used + 1);
  return { ok: true as const };
}

/** For tests. */
export function resetQuota() {
  Object.assign(counts, { day: "", total: 0, byIp: new Map() });
}

export function clientIp(headers: Headers) {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}

/** Returns an error Response when the request may not run the (paid) pipeline. */
export function guardGeneration(request: Request): Response | null {
  const mode = plannerMode();
  if (mode === "examples") {
    return Response.json({ error: "Live generation is turned off in this demo. Browse the example trips instead." }, { status: 403 });
  }
  if (mode === "code" && !codeMatches(request.headers.get("x-access-code"))) {
    return Response.json({ error: "Enter the access code to generate a live plan." }, { status: 401 });
  }
  const quota = takeQuota(clientIp(request.headers), mode);
  if (!quota.ok) return Response.json({ error: quota.reason }, { status: 429 });
  return null;
}
