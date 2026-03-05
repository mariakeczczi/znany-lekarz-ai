import { NextRequest } from "next/server";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { getFiles, getUploadsDir } from "@/lib/health-storage";
import { loadProfileContext, updateProfileInBackground } from "@/lib/memory";
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
3. Po wyszukaniu napisz TYLKO krótki komentarz (1-2 zdania). NIE generuj JSON ani żadnych bloków kodu — aplikacja wyświetla karty lekarzy automatycznie.
4. Jeśli jest mało wyników, zaproponuj poszerzenie kryteriów
5. Odpowiadaj po polsku, bądź empatyczny

Nie musisz podawać countryCode — jest już ustawiony w nagłówku x-tenant-id.`;

async function buildSystemPrompt(): Promise<string> {
  const uploadsDir = getUploadsDir();
  const files = getFiles().filter((f) => f.status === "ready");
  const profile = await loadProfileContext();

  const parts: string[] = [BASE_SYSTEM_PROMPT];

  if (profile) {
    parts.push(`\n## Profil zdrowotny użytkownika\nUżyj tych informacji automatycznie przy wyszukiwaniu (miasto, ubezpieczenie, choroby).\n\n${profile}`);
  }

  if (files.length > 0) {
    const fileList = files
      .map((f) => `- **${f.aiName}** — Full path: ${path.join(uploadsDir, f.fileName)}`)
      .join("\n");
    parts.push(`\n## Dokumenty medyczne użytkownika\nJeśli szukana specjalizacja może być powiązana z jego historią medyczną, użyj narzędzia **Read** żeby przeczytać odpowiednie pliki i uwzględnij te informacje w wyszukiwaniu (np. diseaseNames, contentQuery).\n\n${fileList}`);
  }

  return parts.join("\n");
}

// ─── MCP result → Doctor cards ────────────────────────────────────────────────

interface RawDoc { [key: string]: unknown }

function mapToDoctor(r: RawDoc): { name: string; specialization: string; rating: number | null; reviewCount: number | null; location: string; clinic: string | null; price: number | null; photoUrl: string | null; availability: [] } | null {
  // ZnanyLekarz API: name=firstName, surname=lastName, prefix=title
  const nameParts = [r.prefix, r.name, r.surname].filter(Boolean);
  const name = nameParts.length > 0 ? nameParts.join(" ") : String(r.fullName ?? r.displayName ?? "");
  if (!name.trim()) return null;

  const specs = (r.specializations ?? r.specialties ?? []) as RawDoc[];
  const specialization = specs.length > 0
    ? String(specs[0].name ?? "")
    : String(r.specialization ?? r.specialty ?? "");

  const rating = (r.rating ?? r.ratingScore ?? null) as number | null;
  const reviewCount = (r.opinions ?? r.reviewCount ?? r.opinionsCount ?? null) as number | null;

  const addresses = (r.addresses ?? []) as RawDoc[];
  const addr = addresses[0] ?? {};
  const city = String(addr.city ?? r.city ?? "");
  const district = String(addr.district ?? "");
  const location = [city, district].filter(Boolean).join(", ");

  const clinic = String(addr.name ?? r.facilityName ?? "") || null;

  const services = (addr.services ?? []) as RawDoc[];
  const priceVal = services.length > 0 ? (services[0].price as RawDoc)?.value : null;
  const price = (priceVal && Number(priceVal) > 0) ? Number(priceVal) : null;

  const photoUrl = String(r.avatar ?? r.photoUrl ?? r.photo ?? "") || null;

  return { name, specialization, rating, reviewCount, location, clinic, price, photoUrl, availability: [] };
}

function parseMCPResult(content: unknown): ReturnType<typeof mapToDoctor>[] | null {
  try {
    let data: unknown = content;
    if (typeof data === "string") data = JSON.parse(data);
    // content blocks array → find text block
    if (Array.isArray(data) && data.length > 0 && typeof (data[0] as RawDoc).type === "string") {
      const tb = (data as Array<{ type: string; text?: string }>).find(b => b.type === "text");
      if (tb?.text) data = JSON.parse(tb.text);
    }
    let arr: RawDoc[] | null = null;
    if (Array.isArray(data)) arr = data as RawDoc[];
    else if (data && typeof data === "object") {
      const o = data as Record<string, unknown>;
      const found = o.doctors ?? o.results ?? o.data ?? o.items;
      if (Array.isArray(found)) arr = found as RawDoc[];
    }
    if (!arr || arr.length === 0) return null;
    return arr.slice(0, 5).map(mapToDoctor).filter(Boolean);
  } catch { return null; }
}

// ──────────────────────────────────────────────────────────────────────────────

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

  const systemPrompt = await buildSystemPrompt();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const emit = (payload: object) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

        const fileNameMap = buildFileNameMap();
        let agentResponse = "";
        const pendingSearchIds = new Set<string>();

        for await (const message of query({
          prompt,
          options: {
            model: "claude-sonnet-4-6",
            systemPrompt,
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
              content?: Array<{ type: string; text?: string; name?: string; id?: string; input?: unknown }>;
            };
            for (const block of msg.content ?? []) {
              if (block.type === "text" && block.text) {
                agentResponse += block.text;
                emit({ type: "text", content: block.text });
              } else if (block.type === "tool_use") {
                if ((block.name ?? "").includes("search_doctor") && block.id) {
                  pendingSearchIds.add(block.id as string);
                }
                const label = formatToolCall(block.name ?? "", block.input, fileNameMap);
                if (label !== null) emit({ type: "tool_call", label });
              }
            }
          } else if (message.type === "user" && "message" in message) {
            // tool results coming back
            const msg = message.message as {
              content?: Array<{ type: string; tool_use_id?: string; content?: unknown }>;
            };
            for (const block of msg.content ?? []) {
              if (block.type !== "tool_result") continue;
              // If this is a search_doctor result → parse and emit doctors immediately
              if (block.tool_use_id && pendingSearchIds.has(block.tool_use_id)) {
                pendingSearchIds.delete(block.tool_use_id);
                const doctors = parseMCPResult(block.content);
                if (doctors && doctors.length > 0) {
                  emit({ type: "doctors", doctors });
                }
              }
              emit({ type: "tool_result" }); // marks step as done (green)
            }
          }
        }

        // Background: update profile with anything new (city, insurance preferences etc.)
        if (agentResponse) {
          updateProfileInBackground([
            ...messages,
            { role: "assistant", content: agentResponse },
          ]);
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
