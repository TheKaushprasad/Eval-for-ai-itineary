import type { ProgressStep } from "@/lib/schema";

export type StepState = { status: "pending" | "start" | "ok" | "skipped" | "failed"; detail?: string };

export const STEPS: { id: ProgressStep; label: string }[] = [
  { id: "geocoding", label: "Locating origin and destination" },
  { id: "weather", label: "Checking the weather" },
  { id: "places", label: "Finding sights, restaurants and stays" },
  { id: "flights", label: "Searching flights" },
  { id: "research", label: "Researching prices, events and tips" },
  { id: "generating", label: "Writing your itinerary" },
  { id: "budget", label: "Checking the budget" },
  { id: "emailing", label: "Emailing your plan" },
];

const ICON: Record<StepState["status"], string> = {
  pending: "○",
  start: "◌",
  ok: "✓",
  skipped: "–",
  failed: "!",
};

const COLOR: Record<StepState["status"], string> = {
  pending: "text-stone-300",
  start: "text-teal-600 animate-spin",
  ok: "text-teal-700",
  skipped: "text-stone-400",
  failed: "text-amber-600",
};

export default function ProgressSteps({ state }: { state: Partial<Record<ProgressStep, StepState>> }) {
  return (
    <ol className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-6">
      {STEPS.map(({ id, label }) => {
        const s = state[id] ?? { status: "pending" };
        return (
          <li key={id} className="flex items-start gap-3">
            <span className={`mt-0.5 inline-block w-4 text-center font-bold ${COLOR[s.status]}`}>{ICON[s.status]}</span>
            <div className="min-w-0">
              <p className={`text-sm ${s.status === "pending" ? "text-stone-400" : "text-stone-800"}`}>{label}</p>
              {s.detail && <p className="truncate text-xs text-stone-500">{s.detail}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
