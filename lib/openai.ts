import { client, parseProvider, PROVIDERS, type Effort } from "./ai";

/** Provider and model that write the itinerary (LLM_PROVIDER, default openai). */
export const PROVIDER = parseProvider(process.env.LLM_PROVIDER);
export const MODEL =
  process.env.LLM_MODEL || (PROVIDER === "openai" ? process.env.OPENAI_MODEL : undefined) || PROVIDERS[PROVIDER].model;
export const REASONING_EFFORT = (process.env.LLM_REASONING_EFFORT || undefined) as Effort | undefined;

/**
 * Web research needs OpenAI's web_search tool, so it's on by default only when OpenAI is the
 * provider. RESEARCH=off disables it; RESEARCH=on forces it (using OPENAI_API_KEY).
 */
export const RESEARCH_ENABLED = process.env.RESEARCH ? process.env.RESEARCH === "on" : PROVIDER === "openai";
export const RESEARCH_MODEL = process.env.OPENAI_RESEARCH_MODEL || (PROVIDER === "openai" ? MODEL : PROVIDERS.openai.model);

export function openai() {
  return client("openai");
}
