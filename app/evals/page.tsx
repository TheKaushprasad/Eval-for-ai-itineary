import type { Metadata } from "next";
import Link from "next/link";
import RunDashboard from "@/components/evals/RunDashboard";
import { history } from "@/lib/evals";

export const metadata: Metadata = {
  title: "Evals · AI Travel Itinerary Planner",
  description: "How the itinerary agent is measured: 60 test trips, automated checks and an LLM judge across versions.",
};

export default function EvalsPage() {
  const all = history();
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <p className="text-sm font-semibold uppercase tracking-widest text-teal-700">
        <Link href="/" className="hover:underline">
          AI travel planner
        </Link>{" "}
        · Evaluation
      </p>
      <p className="mt-2 mb-8 max-w-3xl text-stone-600">
        Every version of the planner is run on the same test trips with frozen data, then graded by code checks (budget, diet, dates,
        made-up places…) and an LLM judge. This page shows what each change actually did.
      </p>
      {all.length ? (
        <RunDashboard current={all[all.length - 1]} all={all} />
      ) : (
        <div className="rounded-2xl border border-dashed border-stone-300 p-8 text-stone-600">
          <p className="font-medium text-stone-900">No eval runs yet.</p>
          <p className="mt-2 text-sm">
            Run <code className="rounded bg-stone-100 px-1">npm run eval:record</code> then{" "}
            <code className="rounded bg-stone-100 px-1">npm run eval -- --label v1-baseline</code>; results in{" "}
            <code className="rounded bg-stone-100 px-1">eval/results/</code> appear here.
          </p>
        </div>
      )}
    </main>
  );
}
