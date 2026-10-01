import Link from "next/link";
import { notFound } from "next/navigation";
import RunDashboard from "@/components/evals/RunDashboard";
import { history, runIds } from "@/lib/evals";

// Runs are committed files, so every page is generated at build time.
export const dynamicParams = false;

export function generateStaticParams() {
  return runIds().map((run) => ({ run }));
}

export default async function RunPage({ params }: PageProps<"/evals/[run]">) {
  const { run } = await params;
  const all = history();
  const current = all.find((r) => r.id === run);
  if (!current) notFound();
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <p className="mb-6 text-sm font-semibold uppercase tracking-widest text-teal-700">
        <Link href="/" className="hover:underline">
          AI travel planner
        </Link>{" "}
        ·{" "}
        <Link href="/evals" className="hover:underline">
          Evaluation
        </Link>
      </p>
      <RunDashboard current={current} all={all} />
    </main>
  );
}
