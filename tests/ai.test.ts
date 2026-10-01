import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/** A fake OpenAI-compatible endpoint, standing in for Gemini/Groq/Ollama. */
type Reply = { status: number; body: unknown };
let replies: Reply[] = [];
const requests: Record<string, unknown>[] = [];
let server: Server;

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });

const completion = (content: string) => ({
  status: 200,
  body: {
    id: "x", object: "chat.completion", created: 0, model: "fake",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
    usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
  },
});

beforeAll(async () => {
  server = createServer(async (req, res) => {
    requests.push(JSON.parse(await readBody(req)));
    const r = replies.shift() ?? { status: 500, body: { error: { message: "no reply queued" } } };
    res.writeHead(r.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(r.body));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.OLLAMA_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => server.close());

beforeEach(() => {
  replies = [];
  requests.length = 0;
  vi.resetModules();
});

const Schema = z.object({ city: z.string(), days: z.number() });
const call = async () => {
  const { structured } = await import("@/lib/ai");
  return structured({ provider: "ollama", model: "fake", input: [{ role: "user", content: "plan" }], schema: Schema, name: "plan" });
};

describe("structured() on OpenAI-compatible providers", () => {
  it("sends a JSON schema and validates the reply, tolerating code fences", async () => {
    replies.push(completion('```json\n{"city":"Goa","days":3}\n```'));
    const r = await call();
    expect(r.data).toEqual({ city: "Goa", days: 3 });
    expect(r.usage).toEqual({ provider: "ollama", model: "fake", inputTokens: 120, outputTokens: 30 });
    expect(requests[0]).toMatchObject({ model: "fake", response_format: { type: "json_schema" } });
  });

  it("falls back to JSON mode with the schema in the prompt when the schema is rejected", async () => {
    replies.push({ status: 400, body: { error: { message: "response_format json_schema not supported" } } });
    replies.push(completion('{"city":"Jaipur","days":2}'));
    const r = await call();
    expect(r.data.city).toBe("Jaipur");
    expect(requests[1]).toMatchObject({ response_format: { type: "json_object" } });
    expect(JSON.stringify(requests[1].messages)).toContain("JSON Schema");
  });

  it("waits out a rate limit using the delay in the error body, then retries", async () => {
    replies.push({ status: 429, body: { error: { message: "Quota exceeded for GenerateRequestsPerMinute. Please retry in 0.05s." } } });
    replies.push(completion('{"city":"Goa","days":3}'));
    const r = await call();
    expect(r.data.city).toBe("Goa");
    expect(requests).toHaveLength(2);
  });

  it("gives up immediately on a daily quota", async () => {
    replies.push({ status: 429, body: { error: { message: "Quota exceeded for GenerateRequestsPerDayPerProject. Please retry in 0.05s." } } });
    await expect(call()).rejects.toThrow(/Daily free-tier quota/);
    expect(requests).toHaveLength(1);
  });

  it("asks the model to repair output that doesn't match the schema", async () => {
    replies.push(completion('{"city":"Goa"}'));
    replies.push(completion('{"city":"Goa","days":3}'));
    const r = await call();
    expect(r.data).toEqual({ city: "Goa", days: 3 });
    expect(r.usage?.inputTokens).toBe(240); // both attempts are billed
    expect(JSON.stringify(requests[1].messages)).toContain("days: Invalid input");
  });

  it("repairs a reply the provider itself rejected (Groq's failed_generation)", async () => {
    replies.push({ status: 400, body: { error: { message: "Failed to validate JSON.", code: "json_validate_failed", failed_generation: '{"city":"Goa"}' } } });
    replies.push(completion('{"city":"Goa","days":3}'));
    const r = await call();
    expect(r.data.days).toBe(3);
    expect(JSON.stringify(requests[1].messages)).toContain('{\\"city\\":\\"Goa\\"}');
  });

  it("gives up after one failed repair", async () => {
    replies.push(completion('{"city":"Goa"}'));
    replies.push(completion("not json"));
    await expect(call()).rejects.toThrow(/failed validation after a repair attempt/);
  });
});

describe("parseProvider", () => {
  it("accepts known providers and rejects typos", async () => {
    const { parseProvider } = await import("@/lib/ai");
    expect(parseProvider(undefined)).toBe("openai");
    expect(parseProvider("gemini")).toBe("gemini");
    expect(() => parseProvider("gemni")).toThrow(/Unknown LLM provider/);
  });
});
