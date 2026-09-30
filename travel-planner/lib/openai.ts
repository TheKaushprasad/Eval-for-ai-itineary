import OpenAI from "openai";

let client: OpenAI | null = null;

export function openai() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  client ??= new OpenAI();
  return client;
}

export const MODEL = process.env.OPENAI_MODEL || "gpt-5";
export const RESEARCH_MODEL = process.env.OPENAI_RESEARCH_MODEL || MODEL;
