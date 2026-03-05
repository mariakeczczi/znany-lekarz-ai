import { NextRequest } from "next/server";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { getFiles, getUploadsDir } from "@/lib/health-storage";
import path from "path";

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
3. Wyniki ZAWSZE przedstawiaj jako blok \`\`\`doctors (patrz poniżej) — max 5 lekarzy
4. Jeśli jest mało wyników, zaproponuj poszerzenie kryteriów
5. Odpowiadaj po polsku, bądź empatyczny
6. Gdy użytkownik prosi o opinie lekarza i podaje URL profilu — użyj WebFetch żeby pobrać stronę, a następnie wyciągnij i przedstaw opinie pacjentów (imię/inicjały, ocena, treść, data)

Nie musisz podawać countryCode — jest już ustawiony w nagłówku x-tenant-id.

## Format wyników

Po wyszukaniu zawsze zwróć wyniki w formacie JSON w bloku \`\`\`doctors, a pod nim krótki komentarz tekstowy (1-2 zdania). Maksymalnie 5 lekarzy.

\`\`\`doctors
[
  {
    "name": "dr n. med. Jan Kowalski",
    "specialization": "Kardiolog",
    "rating": 4.8,
    "reviewCount": 312,
    "location": "Warszawa, Mokotów",
    "clinic": "Centrum Medyczne Mokotów",
    "price": 250,
    "photoUrl": null,
    "profileUrl": "https://www.znany-lekarz.pl/lekarz/jan-kowalski/",
    "availability": [
      { "day": "Pon", "date": "10.03", "slots": ["9:00", "11:30", "14:00"] },
      { "day": "Wt", "date": "11.03", "slots": ["10:00", "15:30"] },
      { "day": "Śr", "date": "12.03", "slots": [] }
    ]
  }
]
\`\`\`

Pola:
- name: pełne imię i tytuł lekarza
- specialization: specjalizacja po polsku
- rating: ocena 0-5 (liczba zmiennoprzecinkowa), null jeśli brak
- reviewCount: liczba opinii, null jeśli brak
- location: miasto + dzielnica lub ulica
- clinic: nazwa placówki, null jeśli brak
- price: cena wizyty w PLN (liczba), null jeśli brak
- photoUrl: URL zdjęcia lekarza, null jeśli brak
- profileUrl: URL pełnego profilu lekarza na ZnanyLekarz/Doctoralia, null jeśli brak
- availability: max 3 najbliższe dni z wolnymi slotami (do 4 slotów na dzień); pusta tablica jeśli brak danych`;

function buildSystemPrompt(): string {
  const uploadsDir = getUploadsDir();
  const files = getFiles().filter((f) => f.status === "ready");
  if (files.length === 0) return BASE_SYSTEM_PROMPT;

  const fileList = files
    .map((f) => `- **${f.aiName}** — Full path: ${path.join(uploadsDir, f.fileName)}`)
    .join("\n");

  return `${BASE_SYSTEM_PROMPT}

## Dokumenty medyczne użytkownika
Użytkownik wgrał dokumenty medyczne. Jeśli szukana specjalizacja może być powiązana z jego historią medyczną, użyj narzędzia **Read** żeby przeczytać odpowiednie pliki i uwzględnij te informacje w wyszukiwaniu (np. diseaseNames, contentQuery).

${fileList}`;
}

function buildFileNameMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of getFiles()) map.set(f.fileName, f.aiName);
  return map;
}

// Returns null for internal tools that should be hidden from the user
function formatToolCall(name: string, input: unknown, fileNameMap: Map<string, string>): string | null {
  // Hide internal Agent SDK tools
  if (name === "ToolSearch") return null;

  // MCP tool name arrives as "mcp__doctor-search__search_doctor"
  if (name.includes("search_doctor")) {
    const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const parts: string[] = [];
    if (i.specializationNames) parts.push((i.specializationNames as string[]).join(", "));
    if (i.location) parts.push(i.location as string);
    if (i.onlineOnly) parts.push("online");
    if (i.insuranceNames) parts.push((i.insuranceNames as string[]).join(", "));
    return parts.length > 0 ? `Searching: ${parts.join(" · ")}` : "Searching for doctors...";
  }

  if (name === "WebFetch") {
    const i = (input ?? {}) as Record<string, unknown>;
    const url = (i.url as string) ?? "";
    try {
      const host = new URL(url).hostname.replace("www.", "");
      return `Fetching: ${host}`;
    } catch {
      return `Fetching: ${url.slice(0, 60)}`;
    }
  }

  if (name === "Read") {
    const i = (input ?? {}) as Record<string, unknown>;
    const p = (i.file_path as string) ?? "";
    const base = path.basename(p);
    const aiName = fileNameMap.get(base);
    // Hide internal SDK temp files (toolu_*.json / toolu_*.txt)
    if (!aiName && base.startsWith("toolu_")) return null;
    return `Reading: ${aiName ?? base}`;
  }

  // Hide low-level shell/scan tools
  if (name === "Bash" || name === "Glob" || name === "Grep") return null;

  // Show any other unexpected tool calls generically
  return `Working...`;
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

        const fileNameMap = buildFileNameMap();

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
                const label = formatToolCall(block.name ?? "", block.input, fileNameMap);
                if (label !== null) emit({ type: "tool_call", label });
              }
            }
          } else if (message.type === "user" && "message" in message) {
            // tool results coming back
            const msg = message.message as {
              content?: Array<{ type: string }>;
            };
            const hasResult = msg.content?.some((b) => b.type === "tool_result");
            if (hasResult) emit({ type: "tool_result" }); // marks previous step as done (green)
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
