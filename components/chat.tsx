"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Send, Stethoscope, Loader2, User, Search, CheckCircle, Star, MapPin, CreditCard, Calendar } from "lucide-react";

interface Doctor {
  name: string;
  specialization: string;
  rating: number | null;
  reviewCount: number | null;
  location: string;
  clinic: string | null;
  price: number | null;
  photoUrl: string | null;
  profileUrl: string | null;
  availability: Array<{ day: string; date: string; slots: string[] }>;
}

interface StatusStep {
  type: "tool_call" | "tool_result";
  label: string;
  done: boolean;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  steps?: StatusStep[];
}

const SUGGESTIONS = [
  "Szukam kardiologa w Warszawie",
  "Potrzebuję dermatologa, najlepiej z NFZ",
  "Chcę umówić się do ortopedy online",
  "Boli mnie kolano, do jakiego lekarza iść?",
];

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Cześć! Jestem asystentem ZnanyLekarz. Pomogę Ci znaleźć odpowiedniego lekarza specjalistę. 🩺\n\nMożesz mi powiedzieć, jakiego lekarza szukasz lub opisać swoje dolegliwości, a ja dobiorę dla Ciebie specjalistę.",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollAreaRef.current) {
      const el = scrollAreaRef.current.querySelector("[data-radix-scroll-area-viewport]");
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  async function sendMessage(text: string) {
    if (!text.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: text.trim(),
    };

    const assistantId = (Date.now() + 1).toString();
    const assistantMessage: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      isStreaming: true,
      steps: [],
    };

    const updatedMessages = [...messages, userMessage];
    setMessages([...updatedMessages, assistantMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value, { stream: true }).split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            handleEvent(event, assistantId);
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: "Przepraszam, wystąpił problem z połączeniem.", isStreaming: false }
            : m
        )
      );
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleEvent(event: { type: string; content?: string; label?: string }, assistantId: string) {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId) return m;

        if (event.type === "text" || event.type === "result") {
          return { ...m, content: event.content ?? "" };
        }

        if (event.type === "tool_call") {
          const newStep: StatusStep = { type: "tool_call", label: event.label ?? "Calling tool...", done: false };
          return { ...m, steps: [...(m.steps ?? []), newStep] };
        }

        if (event.type === "tool_result") {
          // Mark last in-progress tool_call step as done (turns blue pill → green)
          const steps = [...(m.steps ?? [])];
          const lastCallIdx = [...steps].reverse().findIndex((s) => s.type === "tool_call" && !s.done);
          if (lastCallIdx !== -1) {
            steps[steps.length - 1 - lastCallIdx] = { ...steps[steps.length - 1 - lastCallIdx], done: true };
          }
          return { ...m, steps };
        }

        if (event.type === "done") {
          return { ...m, isStreaming: false };
        }

        if (event.type === "error") {
          return { ...m, content: `Przepraszam, wystąpił błąd: ${event.content}`, isStreaming: false };
        }

        return m;
      })
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <ScrollArea ref={scrollAreaRef} className="flex-1 min-h-0 px-4 py-4">
        <div className="max-w-2xl mx-auto space-y-4">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} onSendMessage={sendMessage} />
          ))}
          {messages.length === 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  className="text-left text-sm px-3 py-2 rounded-lg border border-border hover:bg-accent hover:border-primary/30 transition-colors text-muted-foreground hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t bg-card px-4 py-3">
        <form onSubmit={(e) => { e.preventDefault(); sendMessage(input); }} className="max-w-2xl mx-auto flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Opisz czego szukasz... (np. kardiolog Warszawa)"
            disabled={isLoading}
            className="flex-1"
            autoFocus
          />
          <Button type="submit" disabled={isLoading || !input.trim()} size="icon">
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </form>
      </div>
    </div>
  );
}

function MessageBubble({ message, onSendMessage }: { message: Message; onSendMessage: (text: string) => void }) {
  const isUser = message.role === "user";
  const hasContent = !!message.content;
  const hasSteps = (message.steps?.length ?? 0) > 0;
  const { text, doctors } = parseContent(message.content);
  const hasDoctors = doctors.length > 0;

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <Avatar className="w-8 h-8 shrink-0 mt-1">
        <AvatarFallback className={isUser ? "bg-primary text-primary-foreground text-xs" : "bg-emerald-100 text-emerald-700 text-xs"}>
          {isUser ? <User className="w-4 h-4" /> : <Stethoscope className="w-4 h-4" />}
        </AvatarFallback>
      </Avatar>

      <div className={`space-y-2 ${hasDoctors ? "flex-1 min-w-0" : "max-w-[80%]"}`}>
        {/* Agent activity steps */}
        {!isUser && hasSteps && (
          <div className="space-y-1">
            {message.steps!.map((step, i) => (
              <AgentStep key={i} step={step} />
            ))}
          </div>
        )}

        {/* Main bubble */}
        {(!isUser || hasContent) && (
          <div className={`rounded-2xl px-4 py-3 text-sm ${isUser ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted rounded-tl-sm"}`}>
            {hasContent ? (
              <>
                <FormattedMessage content={hasDoctors ? text : message.content} />
                {message.isStreaming && (
                  <span className="inline-block w-1.5 h-4 bg-current ml-0.5 animate-pulse align-middle" />
                )}
              </>
            ) : (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                <span className="text-xs">Thinking...</span>
              </span>
            )}
          </div>
        )}

        {/* Doctor cards */}
        {hasDoctors && (
          <div className="space-y-3">
            {doctors.map((doc, i) => (
              <DoctorCard key={i} doctor={doc} onShowReviews={onSendMessage} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentStep({ step }: { step: StatusStep }) {
  return (
    <div className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border transition-all ${
      step.done
        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400"
        : "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-400"
    }`}>
      {step.done ? (
        <CheckCircle className="w-3 h-3 shrink-0" />
      ) : (
        <Search className="w-3 h-3 shrink-0 animate-pulse" />
      )}
      <span>{step.label}</span>
    </div>
  );
}

function parseContent(content: string): { text: string; doctors: Doctor[] } {
  const match = content.match(/```doctors\s*([\s\S]*?)```/);
  if (!match) return { text: content, doctors: [] };
  const text = content.replace(/```doctors[\s\S]*?```/, "").trim();
  try {
    const doctors = JSON.parse(match[1]) as Doctor[];
    return { text, doctors: doctors.slice(0, 5) };
  } catch {
    return { text: content, doctors: [] };
  }
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`w-3 h-3 ${i <= Math.round(rating) ? "fill-amber-400 text-amber-400" : "text-gray-200 fill-gray-200"}`}
        />
      ))}
    </span>
  );
}

function DoctorCard({ doctor, onShowReviews }: { doctor: Doctor; onShowReviews: (text: string) => void }) {
  const initials = doctor.name
    .split(" ")
    .filter((w) => /^[A-ZŁŚŻŹ]/.test(w))
    .slice(-2)
    .map((w) => w[0])
    .join("");

  return (
    <div className="rounded-xl border bg-card shadow-sm p-4 space-y-3 text-sm">
      {/* Header */}
      <div className="flex gap-3">
        <div className="w-14 h-14 rounded-full bg-primary/10 text-primary font-semibold flex items-center justify-center text-sm shrink-0 overflow-hidden">
          {doctor.photoUrl ? (
            <img src={doctor.photoUrl} alt={doctor.name} className="w-full h-full object-cover" />
          ) : (
            initials || "?"
          )}
        </div>
        <div className="min-w-0">
          <p className="font-semibold leading-tight truncate">{doctor.name}</p>
          <p className="text-muted-foreground text-xs mt-0.5">{doctor.specialization}</p>
          {doctor.rating !== null && (
            <div className="flex items-center gap-1.5 mt-1">
              <Stars rating={doctor.rating} />
              <span className="text-xs font-medium">{doctor.rating.toFixed(1)}</span>
              {doctor.reviewCount !== null && (
                <span className="text-xs text-muted-foreground">({doctor.reviewCount})</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="space-y-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <MapPin className="w-3 h-3 shrink-0" />
          <span className="truncate">{doctor.location}{doctor.clinic ? ` · ${doctor.clinic}` : ""}</span>
        </div>
        {doctor.price !== null && (
          <div className="flex items-center gap-1.5">
            <CreditCard className="w-3 h-3 shrink-0" />
            <span>{doctor.price} zł</span>
          </div>
        )}
      </div>

      {/* Availability */}
      {doctor.availability.length > 0 && (
        <div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1.5">
            <Calendar className="w-3 h-3" />
            <span>Najbliższe terminy</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {doctor.availability.map((day) => (
              <div key={day.date} className="space-y-1">
                <p className="text-xs text-center text-muted-foreground font-medium">
                  {day.day} {day.date}
                </p>
                {day.slots.length === 0 ? (
                  <p className="text-xs text-center text-muted-foreground/50">—</p>
                ) : (
                  day.slots.slice(0, 4).map((slot) => (
                    <button
                      key={slot}
                      className="w-full text-xs py-1 rounded-md bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-colors font-medium"
                    >
                      {slot}
                    </button>
                  ))
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Show reviews button */}
      {doctor.profileUrl && (
        <button
          onClick={() => onShowReviews(`Pokaż opinie i szczegółowy profil lekarza ${doctor.name}. URL profilu: ${doctor.profileUrl}`)}
          className="w-full text-xs py-1.5 rounded-lg border border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground transition-colors font-medium"
        >
          Pokaż opinie
        </button>
      )}
    </div>
  );
}

function FormattedMessage({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (!line.trim()) return <br key={i} />;
        if (line.startsWith("**") && line.endsWith("**")) {
          return <p key={i} className="font-semibold">{line.slice(2, -2)}</p>;
        }
        if (line.startsWith("- ") || line.startsWith("• ")) {
          return <p key={i} className="pl-2">{line}</p>;
        }
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}
