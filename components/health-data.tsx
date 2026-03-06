"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Upload,
  FileText,
  Send,
  Loader2,
  User,
  HeartPulse,
  ImageIcon,
  FileIcon,
  Trash2,
  Globe,
  CheckCircle,
  X,
} from "lucide-react";

interface FileRecord {
  id: string;
  originalName: string;
  aiName: string;
  description: string;
  mimeType: string;
  uploadedAt: string;
  size: number;
  status: "analyzing" | "ready" | "error";
  thumbnailFile: string | null;
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

export function HealthData() {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        'Hi! Upload your medical documents above — lab results, prescriptions, doctor notes — and I\'ll analyze them. Then you can ask questions like "What are my biggest health concerns?" or "How has my cholesterol changed?"',
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileRecord | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const charQueueRef = useRef<string[]>([]);
  const typingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingTargetIdRef = useRef<string | null>(null);

  useEffect(() => {
    loadFiles();
  }, []);

  // Poll for files still being analyzed
  useEffect(() => {
    const hasAnalyzing = files.some((f) => f.status === "analyzing");
    if (!hasAnalyzing) return;
    const interval = setInterval(loadFiles, 2000);
    return () => clearInterval(interval);
  }, [files]);

  useEffect(() => {
    if (chatScrollRef.current) {
      const el = chatScrollRef.current.querySelector("[data-radix-scroll-area-viewport]");
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  async function loadFiles() {
    try {
      const res = await fetch("/api/health/files");
      const data = await res.json();
      setFiles(data);
    } catch {
      // ignore
    }
  }

  function startTypingInterval(assistantId: string) {
    if (typingIntervalRef.current && typingTargetIdRef.current === assistantId) return;
    if (typingIntervalRef.current) clearInterval(typingIntervalRef.current);
    typingTargetIdRef.current = assistantId;
    typingIntervalRef.current = setInterval(() => {
      const queue = charQueueRef.current;
      if (queue.length === 0) return;
      const chars = queue.splice(0, 3).join("");
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: m.content + chars } : m
        )
      );
    }, 16);
  }

  function stopTypingInterval() {
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }
    const targetId = typingTargetIdRef.current;
    if (targetId && charQueueRef.current.length > 0) {
      const remaining = charQueueRef.current.splice(0).join("");
      setMessages((prev) =>
        prev.map((m) =>
          m.id === targetId ? { ...m, content: m.content + remaining } : m
        )
      );
    }
    typingTargetIdRef.current = null;
  }

  async function uploadFile(file: File) {
    const placeholder: FileRecord = {
      id: `pending-${Date.now()}`,
      originalName: file.name,
      aiName: file.name,
      description: "",
      mimeType: file.type,
      uploadedAt: new Date().toISOString(),
      size: file.size,
      status: "analyzing",
      thumbnailFile: null,
    };
    setFiles((prev) => [placeholder, ...prev]);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/health/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error("Upload failed");
      setFiles((prev) => prev.filter((f) => f.id !== placeholder.id));
      loadFiles();
    } catch {
      setFiles((prev) => prev.filter((f) => f.id !== placeholder.id));
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list) return;
    Array.from(list).forEach(uploadFile);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    Array.from(e.dataTransfer.files).forEach(uploadFile);
  }

  async function resetAll() {
    await fetch("/api/health/reset", { method: "POST" });
    setFiles([]);
    setMessages([
      {
        id: "welcome-reset",
        role: "assistant",
        content: "All files cleared. Upload new documents to get started.",
      },
    ]);
  }

  async function sendMessage(text: string) {
    if (!text.trim() || isLoading) return;
    const readyFiles = files.filter((f) => f.status === "ready");
    if (readyFiles.length === 0) return;

    const userMsg: Message = { id: Date.now().toString(), role: "user", content: text.trim() };
    const assistantId = (Date.now() + 1).toString();
    const assistantMsg: Message = { id: assistantId, role: "assistant", content: "", isStreaming: true, steps: [] };

    const updatedMessages = [...messages, userMsg];
    setMessages([...updatedMessages, assistantMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/health/agent-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value, { stream: true }).split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "text" || event.type === "result") {
              const chars = Array.from(event.content ?? "");
              charQueueRef.current.push(...chars);
              startTypingInterval(assistantId);
            } else if (event.type === "tool_call") {
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;
                  const newStep: StatusStep = { type: "tool_call", label: event.label ?? "Working...", done: false };
                  return { ...m, steps: [...(m.steps ?? []), newStep] };
                })
              );
            } else if (event.type === "tool_result") {
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;
                  const steps = [...(m.steps ?? [])];
                  const lastIdx = [...steps].reverse().findIndex((s) => s.type === "tool_call" && !s.done);
                  if (lastIdx !== -1) steps[steps.length - 1 - lastIdx] = { ...steps[steps.length - 1 - lastIdx], done: true };
                  return { ...m, steps };
                })
              );
            } else if (event.type === "done") {
              stopTypingInterval();
              setMessages((prev) =>
                prev.map((m) => m.id === assistantId ? { ...m, isStreaming: false } : m)
              );
            } else if (event.type === "error") {
              stopTypingInterval();
              charQueueRef.current = [];
              setMessages((prev) =>
                prev.map((m) => m.id === assistantId ? { ...m, content: `Error: ${event.content}`, isStreaming: false } : m)
              );
            }
          } catch {
            // ignore
          }
        }
      }
    } catch {
      stopTypingInterval();
      charQueueRef.current = [];
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: "Sorry, something went wrong.", isStreaming: false } : m
        )
      );
    } finally {
      stopTypingInterval();
      charQueueRef.current = [];
      setIsLoading(false);
    }
  }

  const readyFiles = files.filter((f) => f.status === "ready");

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Chat */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <ScrollArea ref={chatScrollRef} className="flex-1 min-h-0 px-4 py-4">
          <div className="max-w-2xl mx-auto space-y-3">
            {messages.map((msg) => (
              <ChatBubble key={msg.id} message={msg} />
            ))}
          </div>
        </ScrollArea>

        <div className="border-t bg-card px-4 py-3 shrink-0">
          <form
            onSubmit={(e) => { e.preventDefault(); sendMessage(input); }}
            className="max-w-2xl mx-auto flex gap-2"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                readyFiles.length === 0
                  ? "Upload files to start chatting..."
                  : "Ask about your health data..."
              }
              disabled={isLoading || readyFiles.length === 0}
              className="flex-1"
            />
            <Button type="submit" disabled={isLoading || !input.trim() || readyFiles.length === 0} size="icon">
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </form>
        </div>
      </div>

      {/* Right: Files sidebar */}
      <div className="w-72 border-l bg-muted/20 flex flex-col shrink-0">
        {/* Upload zone */}
        <div className="p-3 shrink-0">
          <div
            className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-muted/30"
            }`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <Upload className="w-5 h-5 mx-auto mb-1.5 text-muted-foreground" />
            <p className="text-xs font-medium">Drop files or click</p>
            <p className="text-xs text-muted-foreground mt-0.5">PDF, images, Word</p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.txt,.csv"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        </div>

        {/* Files list */}
        {files.length > 0 && (
          <>
            <div className="flex items-center justify-between px-3 pb-1.5 shrink-0">
              <span className="text-xs text-muted-foreground">
                {files.length} file{files.length !== 1 ? "s" : ""}
                {files.some((f) => f.status === "analyzing") && " · analyzing..."}
              </span>
              <button
                onClick={resetAll}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                Clear all
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-3">
              <div className="grid grid-cols-2 gap-3">
                {files.map((file) => (
                  <FileCard key={file.id} file={file} onClick={() => setSelectedFile(file)} />
                ))}
              </div>
            </div>
          </>
        )}

        {files.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-xs text-muted-foreground text-center px-4">
              No files yet.<br />Upload your medical documents above.
            </p>
          </div>
        )}
      </div>
      {selectedFile && (
        <FilePreviewModal file={selectedFile} onClose={() => setSelectedFile(null)} />
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatType(mimeType: string): string {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("image/")) return mimeType.split("/")[1].toUpperCase();
  if (mimeType.includes("wordprocessingml") || mimeType === "application/msword") return "Word";
  return mimeType.split("/")[1]?.toUpperCase() ?? "File";
}

function FilePreviewModal({ file, onClose }: { file: FileRecord; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl overflow-hidden w-full max-w-xl shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b shrink-0">
          <div className="min-w-0">
            <h2 className="font-semibold text-sm leading-snug">{file.aiName}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {file.originalName} · {formatType(file.mimeType)} · {formatSize(file.size)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Preview */}
        {file.thumbnailFile && (
          <div className="bg-[#f0f0f0] dark:bg-muted flex items-center justify-center p-6 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/health/thumbnail/${file.id}`}
              alt={file.aiName}
              className="max-w-full max-h-80 object-contain rounded shadow-md"
            />
          </div>
        )}

        {/* Description */}
        {file.status === "analyzing" && (
          <div className="px-5 py-4 flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            Analyzing document...
          </div>
        )}
        {file.status === "ready" && file.description && (
          <div className="px-5 py-4 overflow-y-auto">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">AI Analysis</p>
            <p className="text-sm whitespace-pre-wrap leading-relaxed">{file.description}</p>
          </div>
        )}
        {file.status === "error" && (
          <div className="px-5 py-4 text-sm text-destructive">Analysis failed.</div>
        )}
      </div>
    </div>
  );
}

function FileCard({ file, onClick }: { file: FileRecord; onClick: () => void }) {
  const hasThumbnail = !!file.thumbnailFile;

  return (
    <div className="group cursor-pointer" onClick={onClick}>
      {/* Thumbnail — portrait A4 aspect ratio like Dropbox */}
      <div className="aspect-[3/4] rounded-lg border bg-[#f5f5f5] dark:bg-muted overflow-hidden relative mb-1.5">
        {hasThumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/health/thumbnail/${file.id}`}
            alt={file.aiName}
            className="w-full h-full object-contain p-2 drop-shadow-sm"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <FileTypeIcon mimeType={file.mimeType} />
          </div>
        )}
        {file.status === "analyzing" && (
          <div className="absolute inset-0 bg-background/50 flex items-center justify-center rounded-lg">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {file.status === "error" && (
          <div className="absolute inset-0 bg-destructive/10 flex items-center justify-center rounded-lg">
            <span className="text-xs text-destructive">Error</span>
          </div>
        )}
      </div>

      {/* Info below — Dropbox style */}
      <div className="px-0.5">
        <p className="text-xs font-medium truncate leading-tight">
          {file.status === "ready" ? file.aiName : file.originalName}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {formatType(file.mimeType)} · {formatSize(file.size)}
        </p>
      </div>
    </div>
  );
}

function FileTypeIcon({ mimeType }: { mimeType: string }) {
  if (mimeType === "application/pdf") return <FileText className="w-8 h-8 text-red-300" />;
  if (mimeType.startsWith("image/")) return <ImageIcon className="w-8 h-8 text-blue-300" />;
  if (mimeType.includes("word")) return <FileText className="w-8 h-8 text-indigo-300" />;
  return <FileIcon className="w-8 h-8 text-muted-foreground/50" />;
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        h1: ({ children }) => <p className="font-bold text-base mt-2 mb-1">{children}</p>,
        h2: ({ children }) => <p className="font-semibold mt-2 mb-1">{children}</p>,
        h3: ({ children }) => <p className="font-semibold mt-1 mb-0.5">{children}</p>,
        p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        ul: ({ children }) => <ul className="pl-4 mb-1 space-y-0.5 list-disc">{children}</ul>,
        ol: ({ children }) => <ol className="pl-4 mb-1 space-y-0.5 list-decimal">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        hr: () => <hr className="my-2 border-current opacity-20" />,
        table: ({ children }) => (
          <div className="overflow-x-auto my-2">
            <table className="text-xs border-collapse w-full">{children}</table>
          </div>
        ),
        th: ({ children }) => <th className="border border-current/20 px-2 py-1 font-semibold text-left">{children}</th>,
        td: ({ children }) => <td className="border border-current/20 px-2 py-1">{children}</td>,
        code: ({ children }) => <code className="bg-current/10 rounded px-1 font-mono text-xs">{children}</code>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function AgentStep({ step }: { step: StatusStep }) {
  const isSearch = step.label.startsWith("Searching:");
  return (
    <div
      className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border transition-all ${
        step.done
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400"
          : "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-400"
      }`}
    >
      {step.done ? (
        <CheckCircle className="w-3 h-3 shrink-0" />
      ) : isSearch ? (
        <Globe className="w-3 h-3 shrink-0 animate-pulse" />
      ) : (
        <Loader2 className="w-3 h-3 shrink-0 animate-spin" />
      )}
      <span>{step.label}</span>
    </div>
  );
}

function ChatBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const hasSteps = (message.steps?.length ?? 0) > 0;

  return (
    <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-1 ${
          isUser ? "bg-primary text-primary-foreground" : "bg-emerald-100 text-emerald-700"
        }`}
      >
        {isUser ? <User className="w-3.5 h-3.5" /> : <HeartPulse className="w-3.5 h-3.5" />}
      </div>
      <div className="max-w-[80%] space-y-2">
        {!isUser && hasSteps && (
          <div className="space-y-1">
            {message.steps!.map((step, i) => (
              <AgentStep key={i} step={step} />
            ))}
          </div>
        )}
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm ${
            isUser ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted rounded-tl-sm"
          }`}
        >
          {message.content ? (
            <MarkdownContent content={message.content} />
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span className="text-xs">Thinking...</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
