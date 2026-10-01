"use client";

import { formatMoney } from "@/lib/budget";
import type { Itinerary, ItineraryResult } from "@/lib/schema";
import BudgetBreakdown from "./BudgetBreakdown";

const SOURCE_BADGE: Record<string, { text: string; cls: string }> = {
  duffel: { text: "Live fare", cls: "bg-teal-50 text-teal-800 ring-teal-600/20" },
  web: { text: "Web research", cls: "bg-sky-50 text-sky-800 ring-sky-600/20" },
  osm: { text: "OpenStreetMap", cls: "bg-sky-50 text-sky-800 ring-sky-600/20" },
  estimate: { text: "Estimate", cls: "bg-stone-100 text-stone-700 ring-stone-500/20" },
};

function Badge({ source }: { source: string }) {
  const b = SOURCE_BADGE[source] ?? SOURCE_BADGE.estimate;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${b.cls}`}>{b.text}</span>;
}

function Card({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="break-inside-avoid rounded-2xl border border-stone-200 bg-white p-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-semibold text-stone-900">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

type Leg = Itinerary["transport"]["outbound"];

export default function ItineraryView({ result, onReset }: { result: ItineraryResult; onReset?: () => void }) {
  const it = result.itinerary;
  const money = (n: number) => formatMoney(n, it.currency);
  const legs: [string, Leg][] = [
    ["Outbound", it.transport.outbound],
    ["Return", it.transport.return],
  ];

  return (
    <div className="flex flex-col gap-5">
      <header className="rounded-2xl bg-gradient-to-br from-teal-800 to-teal-600 p-7 text-white">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{it.title}</h2>
        <p className="mt-3 max-w-3xl leading-relaxed text-teal-50">{it.summary}</p>
        <div className="mt-5 flex flex-wrap gap-2 text-sm print:hidden">
          <button onClick={() => window.print()} className="rounded-lg bg-white/15 px-3 py-1.5 hover:bg-white/25">
            Print / save PDF
          </button>
          {onReset && (
            <button onClick={onReset} className="rounded-lg bg-white/15 px-3 py-1.5 hover:bg-white/25">
              Plan another trip
            </button>
          )}
          {result.emailed === "sent" && <span className="rounded-lg bg-white/10 px-3 py-1.5">✓ Emailed</span>}
          {result.emailed === "failed" && <span className="rounded-lg bg-white/10 px-3 py-1.5">Email failed</span>}
          {result.revised && <span className="rounded-lg bg-white/10 px-3 py-1.5">Adjusted to fit budget</span>}
        </div>
      </header>

      {result.warnings.length > 0 && (
        <details className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 print:hidden">
          <summary className="cursor-pointer">Some data sources were unavailable, so parts of this plan are estimates.</summary>
          <ul className="mt-2 list-disc pl-5">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      <BudgetBreakdown budget={it.budget} limit={result.budgetLimit} currency={it.currency} />

      <div className="grid gap-5 md:grid-cols-2">
        <Card title="Getting there" aside={<Badge source={it.transport.outbound.source} />}>
          <dl className="space-y-3 text-sm">
            {legs.map(([name, l]) => (
              <div key={name}>
                <dt className="font-medium text-stone-800">
                  {name} · {l.mode}
                </dt>
                <dd className="text-stone-600">{l.description}</dd>
                <dd className="text-stone-500">
                  {[l.departure, l.arrival].filter(Boolean).join(" → ")}
                  {l.departure || l.arrival ? " · " : ""}
                  <span className="font-medium text-stone-800">{money(l.cost)}</span>
                </dd>
              </div>
            ))}
            <div>
              <dt className="font-medium text-stone-800">Getting around</dt>
              <dd className="text-stone-600">
                {it.transport.local} · {money(it.transport.localCost)}
              </dd>
            </div>
          </dl>
        </Card>
        <Card title="Where you'll stay" aside={<Badge source={it.accommodation.source} />}>
          <p className="text-lg font-medium text-stone-900">{it.accommodation.name}</p>
          <p className="text-sm text-stone-500">
            {it.accommodation.type} · {it.accommodation.area}
          </p>
          <p className="mt-2 text-sm text-stone-700">
            {it.accommodation.nights} nights × {money(it.accommodation.nightlyRate)} ={" "}
            <span className="font-medium">{money(it.accommodation.total)}</span>
          </p>
          <p className="mt-3 text-sm leading-relaxed text-stone-600">{it.accommodation.why}</p>
        </Card>
      </div>

      <ol className="flex flex-col gap-5">
        {it.days.map((d) => (
          <li key={d.day} className="break-inside-avoid rounded-2xl border border-stone-200 bg-white p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-lg font-semibold text-stone-900">
                <span className="text-teal-700">Day {d.day}</span> · {d.theme}
              </h3>
              <span className="text-sm text-stone-500">
                {/* Fixed locale and zone so server and browser render the same text. */}
                {new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}
              </span>
            </div>
            <p className="mt-1 inline-block rounded-full bg-sky-50 px-2.5 py-0.5 text-xs text-sky-800">{d.weather}</p>

            <ul className="mt-4 space-y-3 border-l-2 border-teal-100 pl-4">
              {d.activities.map((a, i) => (
                <li key={i} className="text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="w-12 shrink-0 font-mono text-xs text-teal-700">{a.time}</span>
                    <span className="font-medium text-stone-900">{a.name}</span>
                    <span className="text-stone-400">
                      · {a.durationHours}h · {a.cost ? money(a.cost) : "free"}
                      {a.indoor ? " · indoor" : ""}
                    </span>
                  </div>
                  <p className="ml-14 text-stone-600">{a.description}</p>
                </li>
              ))}
            </ul>

            {d.meals.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {d.meals.map((m, i) => (
                  <span key={i} className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs text-amber-900">
                    <b className="capitalize">{m.meal}</b>: {m.place} · {m.cuisine} · {money(m.cost)}
                  </span>
                ))}
              </div>
            )}
            {d.notes && <p className="mt-3 text-sm italic text-stone-500">{d.notes}</p>}
          </li>
        ))}
      </ol>

      <div className="grid gap-5 md:grid-cols-2">
        {it.tips.length > 0 && (
          <Card title="Tips">
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-stone-700">
              {it.tips.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </Card>
        )}
        {it.packingTips.length > 0 && (
          <Card title="Pack">
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-stone-700">
              {it.packingTips.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {it.sources.length > 0 && (
        <Card title="Sources">
          <ul className="space-y-1 text-sm">
            {it.sources.map((s, i) => (
              <li key={i}>
                <a href={s.url} target="_blank" rel="noreferrer" className="text-teal-700 underline-offset-2 hover:underline">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
