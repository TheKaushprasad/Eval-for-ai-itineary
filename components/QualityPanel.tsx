import Link from "next/link";
import type { ItineraryResult } from "@/lib/schema";
import { label } from "./evals/labels";

const ICON = { pass: "✓", fail: "✕" } as const;

/** The eval harness's code checks, run on this plan. Status always shows icon + word, never color alone. */
export default function QualityPanel({ checks }: { checks: NonNullable<ItineraryResult["checks"]> }) {
  const applicable = checks.filter((c) => c.status !== "na");
  if (!applicable.length) return null;
  const passed = applicable.filter((c) => c.status === "pass").length;
  return (
    <details className="rounded-2xl border border-stone-200 bg-white p-6 print:hidden" open>
      <summary className="cursor-pointer">
        <span className="font-semibold text-stone-900">Quality check</span>
        <span className="ml-2 text-sm text-stone-600">
          {passed} of {applicable.length} automated checks passed
        </span>
      </summary>
      <p className="mt-2 text-sm text-stone-500">
        The same code checks the evaluation harness runs on 60 test trips. They grade this plan instantly, with no extra AI calls.{" "}
        <Link href="/evals" className="text-teal-800 underline underline-offset-2">
          See how the planner scores overall →
        </Link>
      </p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {applicable.map((c) => (
          <li key={c.id} className="flex gap-2.5 text-sm">
            <span
              className={`mt-0.5 h-fit shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                c.status === "pass" ? "bg-green-50 text-green-900 ring-green-600/20" : "bg-amber-50 text-amber-900 ring-amber-600/20"
              }`}
            >
              {ICON[c.status as "pass" | "fail"]} {c.status === "pass" ? "Pass" : "Check"}
            </span>
            <div className="min-w-0">
              <p className="font-medium text-stone-900">{label(c.id)}</p>
              <p className="break-words text-stone-600">{c.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}
