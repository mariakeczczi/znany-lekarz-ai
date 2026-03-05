import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getFiles } from "@/lib/health-storage";

const client = new Anthropic();

function buildSystemPrompt(): string {
  const files = getFiles().filter((f) => f.status === "ready");

  const fileContext =
    files.length > 0
      ? `The user has uploaded the following medical documents:\n\n${files
          .map(
            (f, i) =>
              `${i + 1}. **${f.aiName}** (uploaded ${new Date(f.uploadedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })})\n${f.description}`
          )
          .join("\n\n")}`
      : "No medical documents have been uploaded yet.";

  return `You are a personal health data assistant helping users understand their medical records and health trends.

${fileContext}

Guidelines:
- Be specific and reference documents by name when relevant
- Highlight concerning values, patterns, or trends across documents
- Identify connections between different test results or diagnoses
- Be medically accurate but use accessible language
- Always recommend consulting a doctor for diagnosis and treatment decisions
- Be empathetic and supportive`;
}

export async function POST(req: NextRequest) {
  const { messages } = await req.json();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (payload: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

      try {
        const sdkStream = client.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 2048,
          system: buildSystemPrompt(),
          messages: messages.map((m: { role: string; content: string }) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        });

        for await (const event of sdkStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            emit({ type: "text", content: event.delta.text });
          }
        }

        emit({ type: "done" });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        emit({ type: "error", content: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
