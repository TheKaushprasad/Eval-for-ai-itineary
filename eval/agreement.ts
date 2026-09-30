/**
 * Checks whether the LLM judge agrees with a human. Score ~20 itineraries by hand, then compare.
 *
 *   npm run eval:agree -- --template [run.json]   write human/labels.csv + human/review.md to fill in
 *   npm run eval:agree -- [run.json]              compare human/labels.csv with the run's judge scores
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JUDGE_DIMENSIONS, JUDGE_RUBRIC, type JudgeDimension } from "./graders/judge";
import { weightedKappa } from "./metrics";
import { CATEGORIES, EVAL_DIR, listRuns, parseArgs, readRun, type CaseResult } from "./shared";

const LABELS = join(EVAL_DIR, "human", "labels.csv");
const REVIEW = join(EVAL_DIR, "human", "review.md");
const COLUMNS = ["case_id", ...JUDGE_DIMENSIONS, "notes"];

const args = parseArgs();
const file = args.positional[0] ?? listRuns().at(-1);
if (!file) throw new Error("No runs yet. Run npm run eval first.");
const run = readRun(file);

/** Round-robin over categories so the sample covers every kind of case. */
function sample(cases: CaseResult[], n: number) {
  const queues = CATEGORIES.map((cat) => cases.filter((c) => c.ok && c.itinerary && c.category === cat));
  const out: CaseResult[] = [];
  while (out.length < n && queues.some((q) => q.length)) {
    for (const q of queues) if (q.length && out.length < n) out.push(q.shift()!);
  }
  return out;
}

function renderForReview(c: CaseResult) {
  const it = c.itinerary!;
  const days = it.days
    .map(
      (d) =>
        `**Day ${d.day} (${d.date}) — ${d.theme}** · ${d.weather}\n` +
        d.activities.map((a) => `- ${a.time} ${a.name} (${a.durationHours}h, ${a.cost}${a.indoor ? ", indoor" : ""}${a.kidFriendly ? "" : ", not kid-friendly"})`).join("\n") +
        "\n" +
        d.meals.map((m) => `- ${m.meal}: ${m.place} — ${m.cuisine}${m.dietOk ? "" : " ⚠ diet"}`).join("\n") +
        (d.notes ? `\n- _${d.notes}_` : ""),
    )
    .join("\n\n");
  return `## ${c.id} (${c.category})\n\n${it.title}: ${it.summary}\n\nStay: ${it.accommodation.name}, ${it.accommodation.area} · ${it.accommodation.nights} nights\nTransport: ${it.transport.outbound.mode} out, ${it.transport.return.mode} back · total ${c.computedTotal} / limit ${c.budgetLimit}\n\n${days}\n`;
}

if (args.has("template")) {
  if (existsSync(LABELS) && !args.has("force")) throw new Error(`${LABELS} exists; pass --force to overwrite it.`);
  const picked = sample(run.cases, args.num("n", 20));
  mkdirSync(join(EVAL_DIR, "human"), { recursive: true });
  writeFileSync(LABELS, [COLUMNS.join(","), ...picked.map((c) => `${c.id},${JUDGE_DIMENSIONS.map(() => "").join(",")},`)].join("\n") + "\n");
  writeFileSync(
    REVIEW,
    `# Human review — ${run.label}\n\nScore each itinerary 1–5 per dimension in labels.csv **before** looking at the judge's scores.\n\n` +
      "```text\n" + JUDGE_RUBRIC + "\n```\n\n" +
      picked.map(renderForReview).join("\n---\n\n"),
  );
  console.log(`Wrote ${picked.length} cases to ${LABELS} and ${REVIEW}.`);
  process.exit(0);
}

// ---- Compare ----

function parseCsv(text: string) {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(",");
  return lines.map((l) => {
    const cells = l.split(",");
    return Object.fromEntries(cols.map((c, i) => [c, cells[i]?.trim() ?? ""]));
  });
}

if (!existsSync(LABELS)) throw new Error("No human labels yet. Run npm run eval:agree -- --template");
const labels = parseCsv(readFileSync(LABELS, "utf8"));
const byId = new Map(run.cases.map((c) => [c.id, c]));

console.log(`Judge ${run.judgeModel} vs human on run ${run.label}\n`);
console.log("| dimension | n | exact | within ±1 | weighted κ | judge − human |");
console.log("|---|---|---|---|---|---|");
const all: [number, number][] = [];
for (const d of JUDGE_DIMENSIONS as readonly JudgeDimension[]) {
  const pairs: [number, number][] = [];
  for (const row of labels) {
    const human = Number(row[d]);
    const j = byId.get(row.case_id)?.judge?.scores[d].score;
    if (human >= 1 && human <= 5 && j) pairs.push([Math.round(human), j]);
  }
  all.push(...pairs);
  if (!pairs.length) {
    console.log(`| ${d} | 0 | – | – | – | – |`);
    continue;
  }
  const pct = (f: (p: [number, number]) => boolean) => `${Math.round((pairs.filter(f).length / pairs.length) * 100)}%`;
  const kappa = weightedKappa(pairs);
  const bias = pairs.reduce((a, [h, j]) => a + (j - h), 0) / pairs.length;
  console.log(
    `| ${d} | ${pairs.length} | ${pct(([h, j]) => h === j)} | ${pct(([h, j]) => Math.abs(h - j) <= 1)} | ${kappa === null ? "–" : kappa.toFixed(2)} | ${bias >= 0 ? "+" : ""}${bias.toFixed(2)} |`,
  );
}
const overall = weightedKappa(all);
console.log(`\nOverall weighted κ ${overall === null ? "–" : overall.toFixed(2)} over ${all.length} scores. Rule of thumb: > 0.6 substantial, 0.4–0.6 moderate, < 0.4 don't trust the judge on that dimension.`);
