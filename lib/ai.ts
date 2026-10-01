import OpenAI from "openai";
import { zodResponseFormat, zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

/**
 * LLM providers. Everything except OpenAI is reached through its OpenAI-compatible Chat
 * Completions endpoint, so one SDK covers them all. Default models change often: override
 * with LLM_MODEL / EVAL_JUDGE_MODEL rather than trusting these.
 */
export const PROVIDERS = {
  openai: { baseURL: undefined, keyEnv: "OPENAI_API_KEY", model: "gpt-5", judgeModel: "gpt-5-mini" },
  gemini: {
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    keyEnv: "GEMINI_API_KEY",
    // 3.8-flash was often overloaded (503) on the free tier in Oct 2026; 3.5 is steadier.
    model: "gemini-3.5-flash",
    judgeModel: "gemini-3.5-flash-lite",
  },
  groq: { baseURL: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY", model: "openai/gpt-oss-120b", judgeModel: "openai/gpt-oss-120b" },
  openrouter: {
    baseURL: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    model: "openai/gpt-oss-120b:free",
    judgeModel: "openai/gpt-oss-20b:free",
  },
  ollama: { baseURL: process.env.OLLAMA_URL || "http://localhost:11434/v1", keyEnv: null, model: "qwen2.5:7b", judgeModel: "llama3.1:8b" },
} as const;

export type Provider = keyof typeof PROVIDERS;
export type Effort = "minimal" | "low" | "medium" | "high";
export type Message = { role: "system" | "user" | "assistant"; content: string };
export type Usage = { provider: Provider; model: string; inputTokens: number; outputTokens: number };

export function parseProvider(value: string | undefined, fallback: Provider = "openai"): Provider {
  if (!value) return fallback;
  if (value in PROVIDERS) return value as Provider;
  throw new Error(`Unknown LLM provider "${value}" (use ${Object.keys(PROVIDERS).join(", ")})`);
}

const clients = new Map<Provider, OpenAI>();

export function client(provider: Provider) {
  const cfg = PROVIDERS[provider];
  const apiKey = cfg.keyEnv ? process.env[cfg.keyEnv] : "ollama";
  if (!apiKey) throw new Error(`${cfg.keyEnv} is not set`);
  let c = clients.get(provider);
  if (!c) {
    // Other providers' 429s are retried by withRetry below, which honors their suggested delay.
    c = new OpenAI({ apiKey, baseURL: cfg.baseURL, maxRetries: provider === "openai" ? 2 : 0 });
    clients.set(provider, c);
  }
  return c;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How long a 429 asks us to wait: Gemini puts it in the body ("retry in 49.6s" / "retryDelay":"49s"). */
export function retryDelayMs(e: InstanceType<typeof OpenAI.APIError>): number | null {
  const header = Number(e.headers?.get?.("retry-after"));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  const m = e.message.match(/retry in ([\d.]+)s/i) ?? e.message.match(/"retryDelay":\s*"(\d+)s"/);
  return m ? Number(m[1]) * 1000 : null;
}

/**
 * Free tiers allow a few requests per minute. Wait out rate limits (up to `attempts` times) and
 * retry transient 5xx/network errors; give up at once on daily quotas, which won't clear by waiting.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const rateLimited = e instanceof OpenAI.RateLimitError;
      const transient = e instanceof OpenAI.InternalServerError || e instanceof OpenAI.APIConnectionError;
      if ((!rateLimited && !transient) || i >= attempts) throw e;
      if (rateLimited && /PerDay|per day/i.test(e.message)) throw new Error(`Daily free-tier quota used up: ${e.message.slice(0, 200)}`);
      const wait = (rateLimited && retryDelayMs(e)) || Math.min(60_000, 2_000 * 2 ** (i - 1));
      await sleep(wait + 500);
    }
  }
}

const stripFences = (s: string) => s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

/** One structured-output call: returns data validated against `schema`, plus token usage. */
export async function structured<T>(opts: {
  provider: Provider;
  model: string;
  input: Message[];
  schema: z.ZodType<T>;
  name: string;
  effort?: Effort;
}): Promise<{ data: T; usage: Usage | null }> {
  const { provider, model, input, schema, name, effort } = opts;
  const usageOf = (inputTokens?: number, outputTokens?: number): Usage | null =>
    inputTokens === undefined ? null : { provider, model, inputTokens, outputTokens: outputTokens ?? 0 };

  if (provider === "openai") {
    const res = await client("openai").responses.parse({
      model,
      input,
      text: { format: zodTextFormat(schema, name) },
      ...(effort && { reasoning: { effort } }),
    });
    if (!res.output_parsed) throw new Error(`${model} returned no ${name}`);
    return { data: res.output_parsed as T, usage: usageOf(res.usage?.input_tokens, res.usage?.output_tokens) };
  }

  const c = client(provider);
  const base = { model, ...(effort && effort !== "minimal" && { reasoning_effort: effort }) };
  type Reply = { content: string | null; inputTokens: number; outputTokens: number; truncated?: boolean };
  const reply = (r: OpenAI.Chat.Completions.ChatCompletion): Reply => ({
    content: r.choices[0]?.message?.content ?? null,
    truncated: r.choices[0]?.finish_reason === "length",
    inputTokens: r.usage?.prompt_tokens ?? 0,
    outputTokens: r.usage?.completion_tokens ?? 0,
  });
  /** Groq validates JSON server-side and answers 400 with the rejected text; hand that to the repair step. */
  const failedGeneration = (e: unknown) => {
    const body = e instanceof OpenAI.BadRequestError ? (e.error as { failed_generation?: unknown } | undefined) : undefined;
    return typeof body?.failed_generation === "string" ? body.failed_generation : null;
  };
  const send = async (messages: Message[]): Promise<Reply> => {
    try {
      return reply(await withRetry(() => c.chat.completions.create({ ...base, messages, response_format: zodResponseFormat(schema, name) })));
    } catch (e) {
      if (!(e instanceof OpenAI.BadRequestError)) throw e;
      const rejected = failedGeneration(e);
      if (rejected !== null) return { content: rejected, inputTokens: 0, outputTokens: 0 };
      // Some providers reject strict JSON schemas: fall back to JSON mode with the schema in the prompt.
      const hint = `Reply with only a JSON object that matches this JSON Schema:\n${JSON.stringify(z.toJSONSchema(schema))}`;
      try {
        return reply(
          await withRetry(() =>
            c.chat.completions.create({ ...base, messages: [...messages, { role: "system", content: hint }], response_format: { type: "json_object" } }),
          ),
        );
      } catch (e2) {
        const rejected2 = failedGeneration(e2);
        if (rejected2 === null) throw e2;
        return { content: rejected2, inputTokens: 0, outputTokens: 0 };
      }
    }
  };

  // Not every provider enforces the schema, so validate and give the model one chance to repair.
  let messages = input;
  let inputTokens = 0;
  let outputTokens = 0;
  for (let attempt = 1; ; attempt++) {
    const res = await send(messages);
    inputTokens += res.inputTokens;
    outputTokens += res.outputTokens;
    const content = res.content;
    // A reply cut off at the output limit can't be repaired by asking for more of the same.
    if (res.truncated) throw new Error(`${provider}/${model} ${name} was cut off at the output token limit (finish_reason=length)`);
    if (!content) throw new Error(`${provider}/${model} returned no ${name}`);
    let problem: string;
    try {
      const parsed = schema.safeParse(JSON.parse(stripFences(content)));
      if (parsed.success) return { data: parsed.data, usage: usageOf(inputTokens, outputTokens) };
      problem = parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    } catch {
      problem = "The reply was not valid JSON.";
    }
    if (attempt >= 2) throw new Error(`${provider}/${model} ${name} failed validation after a repair attempt: ${problem.slice(0, 300)}`);
    messages = [
      ...input,
      { role: "assistant", content },
      {
        role: "user",
        content: `That JSON does not match the required schema:\n${problem}\nReturn the complete corrected JSON object with every required field.`,
      },
    ];
  }
}
