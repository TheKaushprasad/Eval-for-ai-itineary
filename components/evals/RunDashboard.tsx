import Link from "next/link";
import { CHECK_IDS } from "@/eval/graders/checks";
import { fmt, type MetricTable } from "@/eval/metrics";
import { USD_INR } from "@/eval/pricing";
import { prettyDate, type RunInfo } from "@/lib/evals";
import HistoryChart, { type HistorySeries } from "./HistoryChart";
import { label, pct } from "./labels";

const HEADLINE_SERIES: HistorySeries[] = [
  { key: "strictPass", label: "Passed every check", color: "var(--series-1)" },
  { key: "grounding", label: "Grounding", color: "var(--series-2)" },
  { key: "withinBudget", label: "Within budget", color: "var(--series-3)" },
  { key: "dietCompliance", label: "Diet respected", color: "var(--series-4)" },
];

// Sequential blue ramp (reference palette steps 100→650); darker = better score.
const RAMP = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#3987e5", "#2a78d6", "#1c5cab", "#104281"];
const cellStyle = (v: number | null) => {
  if (v === null) return { background: "#f5f5f4", color: "var(--text-muted)" };
  const i = Math.round(v * (RAMP.length - 1));
  return { background: RAMP[i], color: i >= 5 ? "#ffffff" : "var(--text-primary)" };
};

function StatTile({ name, value, prev, kind = "pct" }: { name: string; value: number | null; prev?: number | null; kind?: "pct" | "judge" }) {
  const show = (v: number | null) => (kind === "judge" ? (v === null ? "–" : v.toFixed(2)) : pct(v));
  const delta = value !== null && prev !== null && prev !== undefined ? value - prev : null;
  const deltaText =
    delta === null ? null : kind === "judge" ? `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}` : `${delta >= 0 ? "+" : ""}${Math.round(delta * 100)}pp`;
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <p className="text-sm text-stone-600">{name}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-stone-900">{show(value)}</p>
      {deltaText && (
        <p className="mt-1 text-xs text-stone-500">
          {delta! > 0 ? "▲" : delta! < 0 ? "▼" : "■"} {deltaText} vs previous run
        </p>
      )}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6">
      <h2 className="font-semibold text-stone-900">{title}</h2>
      {note && <p className="mt-1 text-sm text-stone-500">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function RunDashboard({ current, all }: { current: RunInfo; all: RunInfo[] }) {
  const { run, summary } = current;
  const idx = all.findIndex((r) => r.id === current.id);
  const prev = idx > 0 ? all[idx - 1].summary.overall : null;
  const o = summary.overall;
  const v = (t: MetricTable | null, k: string) => t?.[k]?.value ?? null;
  const cats = Object.keys(summary.byCategory);
  const rows = ["success", "strictPass", ...CHECK_IDS, "judge.mean"].filter((k) => o[k]?.n);

  // Failure explorer: failing checks grouped by check, worst first.
  const failures = CHECK_IDS.map((id) => ({
    id,
    cases: run.cases.flatMap((c) => c.checks.filter((x) => x.id === id && x.status === "fail").map((x) => ({ caseId: c.id, category: c.category, detail: x.detail }))),
  }))
    .filter((f) => f.cases.length)
    .sort((a, b) => b.cases.length - a.cases.length);

  const cost = summary.ops.avgCostUsd;

  return (
    <div className="viz-root flex flex-col gap-6">
      <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="Eval runs">
        <span className="text-stone-500">Runs:</span>
        {all.map((r) => (
          <Link
            key={r.id}
            href={`/evals/${r.id}`}
            className={`rounded-full px-3 py-1 ring-1 ring-inset ${r.id === current.id ? "bg-teal-700 text-white ring-teal-700" : "bg-white text-stone-700 ring-stone-300 hover:bg-stone-50"}`}
          >
            {r.run.label}
          </Link>
        ))}
      </nav>

      <header>
        <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">{run.label}</h1>
        <p className="mt-1 text-sm text-stone-600">
          {prettyDate(run.createdAt)} · {run.cases.length} test trips · model {run.provider ? `${run.provider}/` : ""}
          {run.model} · judge {run.judgeModel ?? "off"} · commit {summary.gitSha}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile name="Passed every check" value={v(o, "strictPass")} prev={v(prev, "strictPass")} />
        <StatTile name="Places grounded in data" value={v(o, "grounding")} prev={v(prev, "grounding")} />
        <StatTile name="Within budget" value={v(o, "withinBudget")} prev={v(prev, "withinBudget")} />
        <StatTile name="Diet respected" value={v(o, "dietCompliance")} prev={v(prev, "dietCompliance")} />
        <StatTile name="Judge average (1–5)" value={v(o, "judge.mean")} prev={v(prev, "judge.mean")} kind="judge" />
      </div>
      <p className="-mt-2 text-sm text-stone-500">
        Median {summary.ops.p50LatencyS?.toFixed(0) ?? "–"}s per itinerary (p95 {summary.ops.p95LatencyS?.toFixed(0) ?? "–"}s) ·{" "}
        {cost === null ? "cost not tracked" : cost === 0 ? "free tier" : `$${cost.toFixed(3)} (₹${(cost * USD_INR).toFixed(1)}) per itinerary`} · budget revisions{" "}
        {pct(summary.ops.revisionRate)}
      </p>

      <Section title="Progress across versions" note="Each point is one full eval run. Hover for exact values; the table has every number.">
        {all.length > 1 ? (
          <HistoryChart
            series={HEADLINE_SERIES}
            points={all.map((r) => ({ id: r.id, label: r.run.label, values: Object.fromEntries(HEADLINE_SERIES.map((s) => [s.key, r.summary.overall[s.key]?.value ?? null])) }))}
          />
        ) : (
          <p className="rounded-xl bg-stone-50 p-4 text-sm text-stone-600">One run so far. Change the prompt or model, run the eval again, and the trend appears here.</p>
        )}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-stone-500">
              <tr>
                {["Run", "Model", "Every check", "Grounding", "Budget", "Diet", "Judge", "p50", "Cost"].map((h) => (
                  <th key={h} className="py-2 pr-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {all.map((r) => {
                const t = r.summary.overall;
                const c = r.summary.ops.avgCostUsd;
                return (
                  <tr key={r.id} className={r.id === current.id ? "bg-teal-50/60" : ""}>
                    <td className="py-2 pr-3 font-medium text-stone-900">
                      <Link href={`/evals/${r.id}`} className="hover:underline">
                        {r.run.label}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-stone-600">{r.run.model}</td>
                    <td className="py-2 pr-3">{pct(t.strictPass?.value)}</td>
                    <td className="py-2 pr-3">{pct(t.grounding?.value)}</td>
                    <td className="py-2 pr-3">{pct(t.withinBudget?.value)}</td>
                    <td className="py-2 pr-3">{pct(t.dietCompliance?.value)}</td>
                    <td className="py-2 pr-3">{fmt("judge.mean", t["judge.mean"]?.value ?? null)}</td>
                    <td className="py-2 pr-3">{r.summary.ops.p50LatencyS?.toFixed(0) ?? "–"}s</td>
                    <td className="py-2 pr-3">{c === null ? "–" : c === 0 ? "free" : `$${c.toFixed(3)}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="Where it passes and fails"
        note="Mean score per check and trip category (darker = better). Dashes mean the check doesn't apply to those trips."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-separate border-spacing-0.5 text-sm">
            <thead>
              <tr className="text-xs text-stone-500">
                <th className="py-1 pr-3 text-left font-medium">Check</th>
                <th className="px-1 py-1 font-medium">All</th>
                {cats.map((c) => (
                  <th key={c} className="px-1 py-1 font-medium capitalize">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((k) => {
                const isJudge = k.startsWith("judge.");
                const norm = (x: number | null) => (x === null ? null : isJudge ? (x - 1) / 4 : x);
                const cell = (t: MetricTable, col: string) => {
                  const val = t[k]?.n ? t[k].value : null;
                  return (
                    <td
                      key={col}
                      className="rounded px-1 py-1.5 text-center tabular-nums"
                      style={cellStyle(norm(val))}
                      title={val === null ? "not applicable" : `${fmt(k, val)} over ${t[k].n} trips`}
                    >
                      {fmt(k, val)}
                    </td>
                  );
                };
                return (
                  <tr key={k}>
                    <th className="py-1 pr-3 text-left font-normal text-stone-700">{label(k)}</th>
                    {cell(o, "all")}
                    {cats.map((c) => cell(summary.byCategory[c], c))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Failure explorer" note="Every failed check, grouped by what went wrong. Open a trip to see the itinerary and the grader's reasons.">
        {failures.length === 0 && summary.errors.length === 0 ? (
          <p className="text-sm text-stone-600">No failed checks in this run.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {summary.errors.length > 0 && (
              <details className="rounded-xl border border-red-200 bg-red-50 p-4" open>
                <summary className="cursor-pointer text-sm font-medium text-red-900">
                  ✕ {summary.errors.length} trips produced no plan
                </summary>
                <ul className="mt-2 space-y-1 text-sm text-red-900">
                  {summary.errors.map((e) => (
                    <li key={e.id}>
                      <b>{e.id}</b>: {e.error}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {failures.map((f) => (
              <details key={f.id} className="rounded-xl border border-stone-200 p-4">
                <summary className="cursor-pointer text-sm">
                  <span className="font-medium text-stone-900">{label(f.id)}</span>
                  <span className="text-stone-500"> · failed on {f.cases.length} trip{f.cases.length === 1 ? "" : "s"}</span>
                </summary>
                <ul className="mt-3 space-y-2 text-sm">
                  {f.cases.map((c) => (
                    <li key={c.caseId}>
                      <Link href={`/evals/${current.id}/${c.caseId}`} className="font-medium text-teal-800 hover:underline">
                        {c.caseId}
                      </Link>
                      <span className="text-stone-400"> · {c.category}</span>
                      <p className="text-stone-600">{c.detail}</p>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        )}
      </Section>

      <Section title="All trips">
        <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {run.cases.map((c) => {
            const failed = c.checks.filter((x) => x.status === "fail").length;
            return (
              <li key={c.id} className="flex items-baseline justify-between gap-2 border-b border-stone-100 py-1.5">
                <Link href={`/evals/${current.id}/${c.id}`} className="truncate text-stone-800 hover:underline">
                  {c.id}
                </Link>
                <span className="shrink-0 text-xs text-stone-500">
                  {!c.ok ? "✕ error" : failed ? `✕ ${failed} failed` : "✓ all passed"}
                  {c.judge ? ` · ${c.judge.mean.toFixed(1)}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}
