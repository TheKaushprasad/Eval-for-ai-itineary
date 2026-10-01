import Planner from "@/components/Planner";
import { plannerMode } from "@/lib/access";
import { loadExamples } from "@/lib/examples";

// The mode comes from server env (PLANNER_MODE), so render per request rather than at build.
export const dynamic = "force-dynamic";

export default function Home() {
  return <Planner mode={plannerMode()} examples={loadExamples()} />;
}
