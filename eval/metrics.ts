import { CHECK_IDS } from "./graders/checks";
import { JUDGE_DIMENSIONS } from "./graders/judge";
import { USD_INR } from "./pricing";
import { CATEGORIES, type CaseResult, type RunFile } from "./shared";

/**
 * Metric values:
 * - check ids: mean partial-credit score (0..1) over cases where the check applies
 * - strictPass: share of ALL cases that ran and passed every applicable check (errors count as fails)
 * - judge.*: mean 1..5 score
 * - success: share of cases that produced an itinerary
 */
export type Metric = { value: number | null; n: number };
export type MetricTable = Record<string, Metric>;

export const METRIC_KEYS = [
  "success",
  "strictPass",
  ...CHECK_IDS,
  "judge.mean",
  ...JUDGE_DIMENSIONS.map((d) => `judge.${d}`),
] as const;

/** Headline metrics gated by eval:check, with the drop that counts as a regression. */
export const HEADLINE: { key: string; tolerance: number }[] = [
  { key: "success", tolerance: 0.02 },
  { key: "strictPass", tolerance: 0.05 },
  { key: "grounding", tolerance: 0.05 },
  { key: "withinBudget", tolerance: 0.05 },
  { key: "dietCompliance", tolerance: 0.03 },
  { key: "kidSafety", tolerance: 0.05 },
  { key: "judge.mean", tolerance: 0.25 },
];

const mean = (xs: number[]): Metric => ({ value: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null, n: xs.length });

function table(cases: CaseResult[]): MetricTable {
  const ok = cases.filter((c) => c.ok);
  const t: MetricTable = {
    success: mean(cases.map((c) => (c.ok ? 1 : 0))),
    strictPass: mean(cases.map((c) => (c.ok && c.checks.every((x) => x.status !== "fail") ? 1 : 0))),
  };
  for (const id of CHECK_IDS) {
    t[id] = mean(ok.flatMap((c) => c.checks.filter((x) => x.id === id && x.score !== null).map((x) => x.score!)));
  }
  const judged = ok.filter((c) => c.judge);
  t["judge.mean"] = mean(judged.map((c) => c.judge!.mean));
  for (const d of JUDGE_DIMENSIONS) t[`judge.${d}`] = mean(judged.map((c) => c.judge!.scores[d].score));
  return t;
}

const percentile = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

export type Summary = {
  label: string;
  model: string;
  judgeModel: string | null;
  gitSha: string;
  cases: number;
  overall: MetricTable;
  byCategory: Record<string, MetricTable>;
  ops: {
    p50LatencyS: number | null;
    p95LatencyS: number | null;
    revisionRate: number | null;
    avgCostUsd: number | null;
    avgOutputTokens: number | null;
  };
  errors: { id: string; error: string }[];
};

export function summarize(run: RunFile): Summary {
  const ok = run.cases.filter((c) => c.ok);
  const latencies = ok.map((c) => c.latencyMs / 1000);
  const costs = ok.map((c) => c.costUsd).filter((x): x is number => x !== null);
  const byCategory: Record<string, MetricTable> = {};
  for (const cat of CATEGORIES) {
    const cs = run.cases.filter((c) => c.category === cat);
    if (cs.length) byCategory[cat] = table(cs);
  }
  return {
    label: run.label,
    model: run.model,
    judgeModel: run.judgeModel,
    gitSha: run.gitSha + (run.gitDirty ? "+dirty" : ""),
    cases: run.cases.length,
    overall: table(run.cases),
    byCategory,
    ops: {
      p50LatencyS: percentile(latencies, 50),
      p95LatencyS: percentile(latencies, 95),
      revisionRate: mean(ok.map((c) => (c.revised ? 1 : 0))).value,
      avgCostUsd: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
      avgOutputTokens: mean(ok.map((c) => c.outputTokens)).value,
    },
    errors: run.cases.filter((c) => !c.ok).map((c) => ({ id: c.id, error: c.error ?? "unknown" })),
  };
}

export function fmt(key: string, v: number | null) {
  if (v === null) return "–";
  return key.startsWith("judge.") ? v.toFixed(2) : `${Math.round(v * 100)}%`;
}

export function formatSummary(s: Summary): string {
  const cats = Object.keys(s.byCategory);
  const header = `| metric | all | ${cats.join(" | ")} |\n|---|---|${cats.map(() => "---").join("|")}|`;
  const rows = METRIC_KEYS.filter((k) => s.overall[k]?.n).map(
    (k) => `| ${k} | **${fmt(k, s.overall[k].value)}** | ${cats.map((c) => fmt(k, s.byCategory[c][k]?.value ?? null)).join(" | ")} |`,
  );
  const o = s.ops;
  const usd = o.avgCostUsd;
  const ops = [
    `latency p50 ${o.p50LatencyS?.toFixed(0) ?? "–"}s / p95 ${o.p95LatencyS?.toFixed(0) ?? "–"}s`,
    `budget revisions ${fmt("r", o.revisionRate)}`,
    `avg cost ${usd === null ? "–" : `$${usd.toFixed(3)} (₹${(usd * USD_INR).toFixed(1)})`} per itinerary`,
    `avg output tokens ${o.avgOutputTokens?.toFixed(0) ?? "–"}`,
  ].join(" · ");
  const errors = s.errors.length ? `\n\nErrors (${s.errors.length}):\n${s.errors.map((e) => `- ${e.id}: ${e.error}`).join("\n")}` : "";
  return `### ${s.label} — ${s.cases} cases · model ${s.model} · judge ${s.judgeModel ?? "off"} · ${s.gitSha}\n\n${header}\n${rows.join("\n")}\n\n${ops}${errors}`;
}

/** Cohen's kappa with linear weights for 1..k ordinal scores (1 = perfect, 0 = chance level). */
export function weightedKappa(pairs: [number, number][], k = 5) {
  const n = pairs.length;
  if (!n) return null;
  const obs = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (const [a, b] of pairs) obs[a - 1][b - 1] += 1 / n;
  const rows = obs.map((r) => r.reduce((x, y) => x + y, 0));
  const cols = obs[0].map((_, j) => obs.reduce((x, r) => x + r[j], 0));
  let o = 0;
  let e = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      const w = Math.abs(i - j) / (k - 1);
      o += w * obs[i][j];
      e += w * rows[i] * cols[j];
    }
  }
  return e === 0 ? null : 1 - o / e;
}

export type Regression = { id: string; what: string };

export function compare(a: RunFile, b: RunFile) {
  const sa = summarize(a);
  const sb = summarize(b);
  const rows = METRIC_KEYS.filter((k) => sa.overall[k]?.n || sb.overall[k]?.n).map((k) => {
    const va = sa.overall[k]?.value ?? null;
    const vb = sb.overall[k]?.value ?? null;
    return { key: k, a: va, b: vb, delta: va !== null && vb !== null ? vb - va : null };
  });
  const before = new Map(a.cases.map((c) => [c.id, c]));
  const regressions: Regression[] = [];
  const fixes: Regression[] = [];
  for (const c of b.cases) {
    const prev = before.get(c.id);
    if (!prev) continue;
    if (prev.ok && !c.ok) regressions.push({ id: c.id, what: `now errors: ${c.error}` });
    for (const chk of c.checks) {
      const was = prev.checks.find((x) => x.id === chk.id)?.status;
      if (was === "pass" && chk.status === "fail") regressions.push({ id: c.id, what: `${chk.id}: ${chk.detail}` });
      if (was === "fail" && chk.status === "pass") fixes.push({ id: c.id, what: chk.id });
    }
    if (prev.judge && c.judge && c.judge.mean <= prev.judge.mean - 1) {
      regressions.push({ id: c.id, what: `judge ${prev.judge.mean} → ${c.judge.mean}` });
    }
  }
  return { a: sa, b: sb, rows, regressions, fixes };
}

export function formatComparison(cmp: ReturnType<typeof compare>): string {
  const sign = (k: string, d: number | null) => {
    if (d === null) return "–";
    const v = k.startsWith("judge.") ? d.toFixed(2) : `${Math.round(d * 100)}pp`;
    return d > 0 ? `+${v}` : v;
  };
  const table = [
    `| metric | ${cmp.a.label} | ${cmp.b.label} | Δ |`,
    "|---|---|---|---|",
    ...cmp.rows.map((r) => `| ${r.key} | ${fmt(r.key, r.a)} | ${fmt(r.key, r.b)} | ${sign(r.key, r.delta)} |`),
  ].join("\n");
  const list = (xs: Regression[]) => xs.map((r) => `- ${r.id} — ${r.what}`).join("\n") || "- none";
  return `### ${cmp.a.label} → ${cmp.b.label}\n\n${table}\n\n**Regressions (${cmp.regressions.length})**\n${list(cmp.regressions)}\n\n**Fixed checks (${cmp.fixes.length})**\n${list(cmp.fixes)}`;
}
