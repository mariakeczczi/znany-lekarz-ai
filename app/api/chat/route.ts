import { NextRequest } from "next/server";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { getFiles } from "@/lib/health-storage";

// nova-search-mcp runs at http://localhost:3003/mcp
// Start it with: pnpm nx serve nova-search-mcp
const MCP_URL = process.env.DOCTOR_SEARCH_MCP_URL ?? "http://localhost:3003/mcp";
const TENANT_ID = process.env.DOCTOR_SEARCH_TENANT_ID ?? "PL";

const BASE_SYSTEM_PROMPT = `Jesteś pomocnym asystentem wyszukiwania lekarzy na platformie ZnanyLekarz / Doctoralia.
Pomagasz użytkownikom znaleźć odpowiedniego specjalistę medycznego.

Masz dostęp do narzędzia search_doctor. Używaj go aktywnie.

Parametry narzędzia search_doctor:
- specializationNames: tablica specjalizacji (np. ["kardiolog"])
- location: miasto lub koordynaty (np. "Warszawa")
- serviceNames: usługi medyczne (np. ["USG serca"])
- query: wyszukiwanie po nazwisku lub klinice
- contentQuery: szukanie w opisach (np. "sport", "adhd")
- languages: języki (np. ["english"])
- insuranceNames: ubezpieczenia (np. ["NFZ"])
- onlineOnly: true = tylko online/telemedycyna
- diseaseNames: choroby (np. ["nadciśnienie"])
- kidsFriendly: true = lekarze dla dzieci
- priceFrom / priceTo: zakres cenowy
- availability: [data_od, data_do] w formacie YYYY-MM-DD

Ważne zasady:
1. Jeśli użytkownik nie podał lokalizacji i nie szuka online — zapytaj o miasto
2. Specjalizację wyciągnij z opisu dolegliwości (np. "boli kolano" → ortopeda)
3. Wyniki przedstaw czytelnie: imię, specjalizacja, lokalizacja, ocena, cena
4. Jeśli jest mało wyników, zaproponuj poszerzenie kryteriów
5. Odpowiadaj po polsku, bądź empatyczny

Nie musisz podawać countryCode — jest już ustawiony w nagłówku x-tenant-id.`;

function buildSystemPrompt(): string {
  const files = getFiles().filter((f) => f.status === "ready" && f.description);
  if (files.length === 0) return BASE_SYSTEM_PROMPT;

  const fileContext = files
    .map((f) => `- **${f.aiName}**: ${f.description}`)
    .join("\n");

  return `${BASE_SYSTEM_PROMPT}

## Dokumenty medyczne użytkownika
Użytkownik wgrał następujące dokumenty medyczne. Jeśli szukana specjalizacja jest powiązana z treścią tych dokumentów, uwzględnij to w odpowiedzi — wspomnij powiązanie i użyj odpowiednich parametrów (np. diseaseNames, contentQuery).

${fileContext}`;
}

function formatToolCall(name: string, input: unknown): string {
  if (name === "search_doctor" && input && typeof input === "object") {
    const i = input as Record<string, unknown>;
    const parts: string[] = [];
    if (i.specializationNames) parts.push((i.specializationNames as string[]).join(", "));
    if (i.location) parts.push(i.location as string);
    if (i.onlineOnly) parts.push("online");
    if (i.insuranceNames) parts.push((i.insuranceNames as string[]).join(", "));
    return `Searching: ${parts.join(" · ")}`;
  }
  return `Calling: ${name}`;
}

// Build env for the claude subprocess — strip CLAUDECODE to allow running inside a Claude Code session
function buildSubprocessEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== "CLAUDECODE" && v !== undefined) env[k] = v;
  }
  return env;
}

export async function POST(req: NextRequest) {
  const { messages } = await req.json();
  const lastMessage = messages[messages.length - 1];

  const conversationHistory = messages
    .slice(0, -1)
    .map((m: { role: string; content: string }) =>
      `${m.role === "user" ? "Użytkownik" : "Asystent"}: ${m.content}`
    )
    .join("\n");

  const prompt = conversationHistory
    ? `${conversationHistory}\nUżytkownik: ${lastMessage.content}`
    : lastMessage.content;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const emit = (payload: object) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

        for await (const message of query({
          prompt,
          options: {
            model: "claude-sonnet-4-6",
            systemPrompt: buildSystemPrompt(),
            env: buildSubprocessEnv(),
            permissionMode: "bypassPermissions",
            allowDangerouslySkipPermissions: true,
            mcpServers: {
              "doctor-search": {
                type: "http",
                url: MCP_URL,
                headers: { "x-tenant-id": TENANT_ID },
              },
            },
            maxTurns: 10,
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
                // Show which tool is being called and with what params
                const label = formatToolCall(block.name ?? "", block.input);
                emit({ type: "tool_call", label });
              }
            }
          } else if (message.type === "user" && "message" in message) {
            // tool results coming back
            const msg = message.message as {
              content?: Array<{ type: string }>;
            };
            const hasResult = msg.content?.some((b) => b.type === "tool_result");
            if (hasResult) emit({ type: "tool_result" });
          }
        }
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Wystąpił nieznany błąd";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", content: msg })}\n\n`)
        );
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
