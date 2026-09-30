"use client";

import { useState } from "react";
import {
  ACCOMMODATIONS,
  CURRENCIES,
  FOOD_PREFS,
  TRAVEL_MODES,
  TRIP_STYLES,
  TripRequestSchema,
  type TripRequest,
} from "@/lib/schema";

function inDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export const EXAMPLE: TripRequest = {
  startDate: inDays(30),
  days: 5,
  destination: "Goa, India",
  origin: "Bangalore, India",
  adults: 2,
  children: 0,
  childAges: [],
  budgetPerPerson: 25000,
  currency: "INR",
  travelMode: "flight",
  food: "vegetarian",
  tripStyle: "relaxed",
  accommodation: "mid-range",
  specialRequirements: "",
  additionalInfo: "",
  email: "",
};

const label = (s: string) => s.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const input =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20";

function Field({ name, children, error }: { name: string; children: React.ReactNode; error?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-stone-500">{name}</span>
      {children}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-2xl border border-stone-200 bg-white/70 p-5">
      <legend className="px-2 text-sm font-semibold text-stone-800">{title}</legend>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Chips<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          type="button"
          key={o}
          onClick={() => onChange(o)}
          className={`rounded-full border px-3 py-1.5 text-sm transition ${
            value === o
              ? "border-teal-700 bg-teal-700 text-white"
              : "border-stone-300 bg-white text-stone-700 hover:border-teal-600"
          }`}
        >
          {label(o)}
        </button>
      ))}
    </div>
  );
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (n: number) => void }) {
  const btn = "h-9 w-9 rounded-lg border border-stone-300 bg-white text-lg text-stone-700 disabled:opacity-40";
  return (
    <div className="flex items-center gap-3">
      <button type="button" className={btn} disabled={value <= min} onClick={() => onChange(value - 1)} aria-label="decrease">−</button>
      <span className="w-6 text-center font-medium tabular-nums">{value}</span>
      <button type="button" className={btn} disabled={value >= max} onClick={() => onChange(value + 1)} aria-label="increase">+</button>
    </div>
  );
}

export default function TripForm({ onSubmit, busy }: { onSubmit: (r: TripRequest) => void; busy: boolean }) {
  const [form, setForm] = useState<TripRequest>(EXAMPLE);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof TripRequest>(k: K, v: TripRequest[K]) => setForm((f) => ({ ...f, [k]: v }));

  const setChildren = (n: number) =>
    setForm((f) => ({ ...f, children: n, childAges: Array.from({ length: n }, (_, i) => f.childAges[i] ?? 8) }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = TripRequestSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    onSubmit(parsed.data);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <Section title="Trip details">
        <Field name="Destination" error={errors.destination}>
          <input className={input} value={form.destination} onChange={(e) => set("destination", e.target.value)} placeholder="Goa, India" />
        </Field>
        <Field name="Starting from" error={errors.origin}>
          <input className={input} value={form.origin} onChange={(e) => set("origin", e.target.value)} placeholder="Bangalore, India" />
        </Field>
        <Field name="Start date" error={errors.startDate}>
          <input type="date" className={input} value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
        </Field>
        <Field name="Number of days" error={errors.days}>
          <input type="number" min={1} max={21} className={input} value={form.days} onChange={(e) => set("days", Number(e.target.value))} />
        </Field>
        <Field name="Adults">
          <Stepper value={form.adults} min={1} max={9} onChange={(n) => set("adults", n)} />
        </Field>
        <Field name="Children">
          <Stepper value={form.children} min={0} max={8} onChange={setChildren} />
        </Field>
        {form.children > 0 && (
          <div className="sm:col-span-2">
            <Field name="Children's ages" error={errors.childAges}>
              <div className="flex flex-wrap gap-2">
                {form.childAges.map((age, i) => (
                  <input
                    key={i}
                    type="number"
                    min={0}
                    max={17}
                    aria-label={`Child ${i + 1} age`}
                    className={input.replace("w-full", "w-20")}
                    value={age}
                    onChange={(e) => set("childAges", form.childAges.map((a, j) => (j === i ? Number(e.target.value) : a)))}
                  />
                ))}
              </div>
            </Field>
          </div>
        )}
      </Section>

      <Section title="Budget">
        <Field name="Budget per person" error={errors.budgetPerPerson}>
          <input type="number" min={1} className={input} value={form.budgetPerPerson} onChange={(e) => set("budgetPerPerson", Number(e.target.value))} />
        </Field>
        <Field name="Currency">
          <select className={input} value={form.currency} onChange={(e) => set("currency", e.target.value as TripRequest["currency"])}>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
      </Section>

      <fieldset className="flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white/70 p-5">
        <legend className="px-2 text-sm font-semibold text-stone-800">Travel preferences</legend>
        <Field name="Travel mode"><Chips options={TRAVEL_MODES} value={form.travelMode} onChange={(v) => set("travelMode", v)} /></Field>
        <Field name="Food preference"><Chips options={FOOD_PREFS} value={form.food} onChange={(v) => set("food", v)} /></Field>
        <Field name="Trip style"><Chips options={TRIP_STYLES} value={form.tripStyle} onChange={(v) => set("tripStyle", v)} /></Field>
        <Field name="Accommodation"><Chips options={ACCOMMODATIONS} value={form.accommodation} onChange={(v) => set("accommodation", v)} /></Field>
      </fieldset>

      <Section title="Additional context">
        <div className="sm:col-span-2">
          <Field name="Special requirements">
            <textarea rows={2} className={input} value={form.specialRequirements} onChange={(e) => set("specialRequirements", e.target.value)} placeholder="Wheelchair access, no long drives, anniversary dinner…" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field name="Anything else">
            <textarea rows={2} className={input} value={form.additionalInfo} onChange={(e) => set("additionalInfo", e.target.value)} placeholder="Want to see a sunset cruise, avoid crowded beaches…" />
          </Field>
        </div>
        <Field name="Email (optional)" error={errors.email}>
          <input type="email" className={input} value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="you@example.com" />
        </Field>
      </Section>

      <button
        type="submit"
        disabled={busy}
        className="rounded-xl bg-teal-700 px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-teal-900/10 transition hover:bg-teal-800 disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? "Planning your trip…" : "Generate itinerary"}
      </button>
    </form>
  );
}
