import Link from "next/link";
import { notFound } from "next/navigation";
import ItineraryView from "@/components/ItineraryView";
import { label } from "@/components/evals/labels";
import { JUDGE_DIMENSIONS } from "@/eval/graders/judge";
import { loadCases } from "@/eval/shared";
import { formatMoney } from "@/lib/budget";
import { loadRun, runIds } from "@/lib/evals";

export const dynamicParams = false;

export function generateStaticParams() {
  return runIds().flatMap((run) => loadRun(run)!.run.cases.map((c) => ({ run, case: c.id })));
}

const STATUS = {
  pass: { icon: "✓", text: "Pass", cls: "bg-green-50 text-green-900 ring-green-600/20" },
  fail: { icon: "✕", text: "Fail", cls: "bg-red-50 text-red-900 ring-red-600/20" },
  na: { icon: "–", text: "N/A", cls: "bg-stone-100 text-stone-600 ring-stone-500/20" },
} as const;

export default async function CasePage({ params }: PageProps<"/evals/[run]/[case]">) {
  const { run: runId, case: caseId } = await params;
  const info = loadRun(runId);
  const result = info?.run.cases.find((c) => c.id === caseId);
  if (!info || !result) notFound();
  const def = loadCases().find((c) => c.id === caseId);
  const req = def?.request;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <p className="text-sm font-semibold uppercase tracking-widest text-teal-700">
        <Link href="/evals" className="hover:underline">
          Evaluation
        </Link>{" "}
        ·{" "}
        <Link href={`/evals/${runId}`} className="hover:underline">
          {info.run.label}
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-stone-900">{caseId}</h1>
      <p className="mt-1 text-sm text-stone-600">
        <span className="capitalize">{result.category}</span>
        {result.tags.length > 0 && ` · ${result.tags.join(", ")}`}
        {result.ok && ` · ${(result.latencyMs / 1000).toFixed(0)}s`}
        {result.revised && " · revised once for budget"}
      </p>
      {def?.note && <p className="mt-2 max-w-3xl text-sm italic text-stone-600">Why this case: {def.note}</p>}

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {req && (
          <section className="rounded-2xl border border-stone-200 bg-white p-6 text-sm">
            <h2 className="mb-3 font-semibold text-stone-900">The request</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              {[
                ["Trip", `${req.origin} → ${req.destination}`],
                ["When", `${req.startDate}, ${req.days} day${req.days === 1 ? "" : "s"}`],
                ["Who", `${req.adults} adult${req.adults === 1 ? "" : "s"}${req.children ? `, children aged ${req.childAges.join(", ")}` : ""}`],
                ["Budget", `${formatMoney(req.budgetPerPerson, req.currency)} per person`],
                ["Style", `${req.tripStyle} · ${req.accommodation} · ${req.travelMode} · ${req.food}`],
                ...(req.specialRequirements ? [["Needs", req.specialRequirements]] : []),
                ...(req.additionalInfo ? [["Also", req.additionalInfo]] : []),
              ].map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-stone-500">{k}</dt>
                  <dd className="text-stone-800">{v}</dd>
                </div>
              ))}
            </dl>
            {def && (def.expect.mustMention.length > 0 || def.expect.mustAvoid.length > 0) && (
              <p className="mt-3 text-xs text-stone-500">
                Expectations: {def.expect.mustMention.map((m) => `mentions "${m}"`).join(", ")}
                {def.expect.mustMention.length && def.expect.mustAvoid.length ? "; " : ""}
                {def.expect.mustAvoid.map((m) => `avoids "${m}"`).join(", ")}
              </p>
            )}
          </section>
        )}

        <section className="rounded-2xl border border-stone-200 bg-white p-6 text-sm">
          <h2 className="mb-3 font-semibold text-stone-900">Code checks</h2>
          {!result.ok ? (
            <p className="text-red-800">✕ No itinerary: {result.error}</p>
          ) : (
            <ul className="space-y-2">
              {result.checks.map((c) => {
                const s = STATUS[c.status];
                return (
                  <li key={c.id} className="flex gap-3">
                    <span className={`h-fit shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}`}>
                      {s.icon} {s.text}
                    </span>
                    <div>
                      <p className="font-medium text-stone-900">{label(c.id)}</p>
                      <p className="text-stone-600">{c.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {result.judge && (
        <section className="mt-5 rounded-2xl border border-stone-200 bg-white p-6 text-sm">
          <h2 className="font-semibold text-stone-900">
            LLM judge · {result.judge.mean.toFixed(2)} / 5 <span className="font-normal text-stone-500">({result.judge.model})</span>
          </h2>
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {JUDGE_DIMENSIONS.map((d) => (
              <li key={d}>
                <p className="font-medium text-stone-900">
                  {label(`judge.${d}`).replace("Judge: ", "")} · {result.judge!.scores[d].score}/5
                </p>
                <p className="text-stone-600">{result.judge!.scores[d].reason}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.itinerary && (
        <div className="mt-8">
          <h2 className="mb-4 text-lg font-semibold text-stone-900">The itinerary it produced</h2>
          <ItineraryView
            result={{
              itinerary: result.itinerary,
              budgetLimit: result.budgetLimit,
              computedTotal: result.computedTotal ?? 0,
              withinBudget: result.withinBudget ?? false,
              revised: result.revised,
              emailed: "skipped",
              warnings: result.warnings,
            }}
          />
        </div>
      )}
    </main>
  );
}
