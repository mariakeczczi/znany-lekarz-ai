import fs from "fs/promises";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";

const MEMORY_DIR = path.join(process.cwd(), "memory");
const PROFILE_FILE = path.join(MEMORY_DIR, "profile.md");

const client = new Anthropic();

async function ensureMemoryDir() {
  await fs.mkdir(MEMORY_DIR, { recursive: true });
}

export async function loadProfileContext(): Promise<string> {
  try {
    return (await fs.readFile(PROFILE_FILE, "utf-8")).trim();
  } catch {
    return "";
  }
}

/**
 * Called after document upload — merges extracted facts into profile.md.
 */
export async function updateProfileFromFacts(facts: string[]): Promise<void> {
  if (facts.length === 0) return;

  const current = await loadProfileContext();

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Masz profil zdrowotny użytkownika w Markdown. Dodaj nowe fakty jeśli jeszcze ich nie ma. Zachowaj istniejącą strukturę i sekcje. Zwróć TYLKO nową treść pliku Markdown, bez komentarza.

AKTUALNY PROFIL:
${current || "(pusty)"}

NOWE FAKTY:
${facts.map((f) => `- ${f}`).join("\n")}

Jeśli profil jest pusty, stwórz go z sekcjami: Dane osobowe, Historia medyczna, Leki, Alergie, Preferencje wyszukiwania.`,
      },
    ],
  });

  const newProfile = response.content.find((b) => b.type === "text")?.text ?? "";
  if (newProfile.trim()) {
    await ensureMemoryDir();
    await fs.writeFile(PROFILE_FILE, newProfile.trim() + "\n", "utf-8");
  }
}

/**
 * Called after a conversation — fire & forget, never blocks the response.
 */
export function updateProfileInBackground(messages: Array<{ role: string; content: string }>): void {
  updateProfileFromConversation(messages).catch((err) =>
    console.error("[memory] profile update failed:", err)
  );
}

async function updateProfileFromConversation(
  messages: Array<{ role: string; content: string }>
): Promise<void> {
  if (messages.length === 0) return;

  const current = await loadProfileContext();
  const conversation = messages
    .map((m) => `${m.role === "user" ? "Użytkownik" : "Asystent"}: ${m.content}`)
    .join("\n");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: `Analizujesz rozmowy medyczne i aktualizujesz profil zdrowotny użytkownika.
Zapisuj TYLKO trwałe fakty: choroby, leki, alergie, dane osobowe (wiek, płeć, miasto), preferencje wyszukiwania lekarzy (ubezpieczenie, cena, dzielnica).
NIE zapisuj: jednorazowych pytań, wyników badań w normie, tymczasowego kontekstu sesji.
Jeśli nie ma nic nowego — zwróć profil bez zmian.
Zwróć TYLKO treść Markdown profilu, bez komentarza.`,
    messages: [
      {
        role: "user",
        content: `AKTUALNY PROFIL:\n${current || "(pusty)"}\n\nROZMOWA:\n${conversation}`,
      },
    ],
  });

  const newProfile = response.content.find((b) => b.type === "text")?.text ?? "";
  if (newProfile.trim()) {
    await ensureMemoryDir();
    await fs.writeFile(PROFILE_FILE, newProfile.trim() + "\n", "utf-8");
  }
}
