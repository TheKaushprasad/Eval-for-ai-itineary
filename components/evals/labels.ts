/** Human-readable names for metric keys shown on the /evals pages. */
export const METRIC_LABELS: Record<string, string> = {
  success: "Produced a plan",
  strictPass: "Passed every check",
  dayCount: "Right number of days",
  dates: "Correct dates",
  nights: "Right number of nights",
  withinBudget: "Within budget",
  budgetArithmetic: "Model's own sums add up",
  dietCompliance: "Diet respected",
  kidSafety: "Safe for the kids",
  grounding: "Places grounded in data",
  sourceValidity: "Cited sources are real",
  weatherAware: "Indoor plan on bad-weather days",
  pace: "Pace fits the trip style",
  travelMode: "Requested travel mode",
  transportSource: "Uses live fares",
  expectations: "Case-specific expectations",
  "judge.mean": "Judge average (1–5)",
  "judge.styleMatch": "Judge: style match",
  "judge.pace": "Judge: pace",
  "judge.logistics": "Judge: logistics",
  "judge.requirements": "Judge: requirements",
  "judge.helpfulness": "Judge: helpfulness",
};

export const label = (key: string) => METRIC_LABELS[key] ?? key;

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${Math.round(v * 100)}%`);
