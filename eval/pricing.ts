/**
 * USD per 1M tokens. Check https://openai.com/api/pricing before quoting costs; unknown models
 * report cost as null rather than guessing.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

/** For showing cost per itinerary in rupees; override with EVAL_USD_INR. */
export const USD_INR = Number(process.env.EVAL_USD_INR) || 88;

export function costUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  // Dated snapshots like "gpt-5-2025-08-07" price like their base model.
  const base = Object.keys(PRICES)
    .sort((a, b) => b.length - a.length)
    .find((k) => model === k || model.startsWith(`${k}-20`));
  const p = base && PRICES[base];
  return p ? (inputTokens * p.input + outputTokens * p.output) / 1e6 : null;
}
