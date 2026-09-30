"use client";

import { useState } from "react";
import ItineraryView from "@/components/ItineraryView";
import ProgressSteps, { type StepState } from "@/components/ProgressSteps";
import TripForm from "@/components/TripForm";
import type { ItineraryResult, ProgressStep, TripRequest } from "@/lib/schema";
import { readEvents } from "@/lib/sse";

export default function Home() {
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Partial<Record<ProgressStep, StepState>>>({});
  const [result, setResult] = useState<ItineraryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate(req: TripRequest) {
    setBusy(true);
    setError(null);
    setResult(null);
    setSteps({});
    try {
      const res = await fetch("/api/itinerary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      for await (const ev of readEvents(res)) {
        if (ev.type === "progress") setSteps((s) => ({ ...s, [ev.step]: { status: ev.status, detail: ev.detail } }));
        else if (ev.type === "result") setResult(ev.data);
        else if (ev.type === "error") throw new Error(ev.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:py-14">
      {!result && (
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-widest text-teal-700">AI travel planner</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">Your whole trip, planned in one go.</h1>
          <p className="mt-3 max-w-2xl text-stone-600">
            Tell us where, when and how you like to travel. We check the weather, flights, places and prices, then build a
            day-by-day plan that fits your budget.
          </p>
        </div>
      )}

      {result ? (
        <ItineraryView result={result} onReset={() => setResult(null)} />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
          <TripForm onSubmit={generate} busy={busy} />
          <aside className="flex flex-col gap-4 lg:sticky lg:top-8 lg:self-start">
            {busy || Object.keys(steps).length ? (
              <ProgressSteps state={steps} />
            ) : (
              <div className="rounded-2xl border border-dashed border-stone-300 p-6 text-sm text-stone-500">
                Pre-filled with an example: 5 relaxed vegetarian days in Goa from Bangalore for two adults. Change anything,
                then generate.
              </div>
            )}
            {error && <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
          </aside>
        </div>
      )}
    </main>
  );
}
