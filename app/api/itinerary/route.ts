import { runPipeline } from "@/lib/pipeline";
import { TripRequestSchema, type StreamEvent } from "@/lib/schema";

export const maxDuration = 180;

export async function POST(request: Request) {
  const parsed = TripRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        const data = await runPipeline(parsed.data, send);
        send({ type: "result", data });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : "Something went wrong" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
