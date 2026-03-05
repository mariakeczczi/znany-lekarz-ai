import { NextRequest } from "next/server";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { getFiles, getUploadsDir } from "@/lib/health-storage";
import path from "path";

function buildSubprocessEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== "CLAUDECODE" && v !== undefined) env[k] = v;
  }
  return env;
}

function buildSystemPrompt(): string {
  const uploadsDir = getUploadsDir();
  const files = getFiles().filter((f) => f.status === "ready");

  const fileList =
    files.length > 0
      ? files
          .map(
            (f) =>
              `- **${f.aiName}**\n  Full path: ${path.join(uploadsDir, f.fileName)}\n  Summary: ${f.description}`
          )
          .join("\n")
      : "No files uploaded yet.";

  return `You are a personal health data assistant with direct access to the user's uploaded medical documents.

## Available Medical Files
${fileList}

## Your Tools
1. **Read** — open any file above using its full path. Works for PDFs, images, Word docs, and text files.
2. **WebFetch** — fetch any URL to look up medical information. Useful sources:
   - PubMed: https://pubmed.ncbi.nlm.nih.gov/?term=SEARCH+TERMS
   - Mayo Clinic: https://www.mayoclinic.org/search/search-results?q=QUERY
   - MedlinePlus: https://medlineplus.gov/search/?query=QUERY
   - DuckDuckGo Lite: https://lite.duckduckgo.com/lite?q=QUERY

## How to work
- When the user asks about specific values, dates, or findings — **read the actual files** first
- When the user asks about a condition, medication, or reference range — **fetch a medical resource**
- Cross-reference multiple files to identify patterns and trends
- Be specific: cite actual values, dates, and file names
- Always recommend professional medical consultation for diagnosis and treatment decisions`;
}

// Map from fileName (uuid.pdf) to aiName for display in steps
function buildFileNameMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of getFiles()) {
    map.set(f.fileName, f.aiName);
  }
  return map;
}

function formatToolCall(name: string, input: unknown, fileNameMap: Map<string, string>): string {
  const i = (input ?? {}) as Record<string, unknown>;

  if (name === "Read") {
    const p = (i.file_path as string) ?? "";
    const base = path.basename(p);
    const aiName = fileNameMap.get(base);
    return `Reading: ${aiName ?? base}`;
  }
  if (name === "WebFetch") {
    const url = (i.url as string) ?? "";
    try {
      const host = new URL(url).hostname.replace("www.", "");
      return `Searching: ${host}`;
    } catch {
      return `Fetching: ${url.slice(0, 60)}`;
    }
  }
  if (name === "Glob" || name === "Grep") {
    return `Scanning files...`;
  }
  return `Using: ${name}`;
}

export async function POST(req: NextRequest) {
  const { messages } = await req.json();
  const lastMessage = messages[messages.length - 1];

  const history = messages
    .slice(0, -1)
    .map((m: { role: string; content: string }) =>
      `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`
    )
    .join("\n");

  const prompt = history
    ? `${history}\nUser: ${lastMessage.content}`
    : lastMessage.content;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (payload: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

      try {
        const fileNameMap = buildFileNameMap();
        for await (const message of query({
          prompt,
          options: {
            model: "claude-sonnet-4-6",
            systemPrompt: buildSystemPrompt(),
            env: buildSubprocessEnv(),
            permissionMode: "bypassPermissions",
            allowDangerouslySkipPermissions: true,
            maxTurns: 15,
          },
        })) {
          if ("result" in message && message.result) {
            emit({ type: "result", content: message.result });
          } else if (message.type === "assistant" && "message" in message) {
            const msg = message.message as {
              content?: Array<{ type: string; text?: string; name?: string; input?: unknown }>;
            };
            for (const block of msg.content ?? []) {
              if (block.type === "text" && block.text) {
                emit({ type: "text", content: block.text });
              } else if (block.type === "tool_use") {
                emit({ type: "tool_call", label: formatToolCall(block.name ?? "", block.input, fileNameMap) });
              }
            }
          } else if (message.type === "user" && "message" in message) {
            const msg = message.message as { content?: Array<{ type: string }> };
            if (msg.content?.some((b) => b.type === "tool_result")) {
              emit({ type: "tool_result" });
            }
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
