import { formatMoney } from "@/lib/budget";
import type { Itinerary } from "@/lib/schema";

const PARTS: { key: keyof Itinerary["budget"]; label: string; color: string }[] = [
  { key: "transport", label: "Transport", color: "bg-teal-700" },
  { key: "accommodation", label: "Stay", color: "bg-sky-600" },
  { key: "food", label: "Food", color: "bg-amber-500" },
  { key: "activities", label: "Activities", color: "bg-rose-500" },
  { key: "localTransport", label: "Local travel", color: "bg-violet-500" },
  { key: "buffer", label: "Buffer", color: "bg-stone-400" },
];

export default function BudgetBreakdown({ budget, limit, currency }: { budget: Itinerary["budget"]; limit: number; currency: string }) {
  const scale = Math.max(limit, budget.total);
  const over = budget.total > limit;
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-stone-900">Budget</h3>
        <p className={`text-sm font-medium ${over ? "text-amber-700" : "text-teal-700"}`}>
          {formatMoney(budget.total, currency)} of {formatMoney(limit, currency)}
          {over ? ` · over by ${formatMoney(budget.total - limit, currency)}` : ` · ${formatMoney(limit - budget.total, currency)} to spare`}
        </p>
      </div>
      <div className="relative mt-4 flex h-3 w-full overflow-hidden rounded-full bg-stone-100">
        {PARTS.map((p) => (
          <div key={p.key} className={p.color} style={{ width: `${(budget[p.key] / scale) * 100}%` }} title={p.label} />
        ))}
        {over && <div className="absolute inset-y-0 w-0.5 bg-stone-900" style={{ left: `${(limit / scale) * 100}%` }} />}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        {PARTS.map((p) => (
          <div key={p.key} className="flex items-center justify-between gap-2">
            <dt className="flex items-center gap-2 text-stone-600">
              <span className={`h-2.5 w-2.5 rounded-sm ${p.color}`} />
              {p.label}
            </dt>
            <dd className="tabular-nums text-stone-900">{formatMoney(budget[p.key], currency)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
