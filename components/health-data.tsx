"use client";

import { useState, useRef, useEffect } from "react";
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

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

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
    const assistantMsg: Message = { id: assistantId, role: "assistant", content: "", isStreaming: true };

    const updatedMessages = [...messages, userMsg];
    setMessages([...updatedMessages, assistantMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/health/chat", {
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
            if (event.type === "text") {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + event.content } : m))
              );
            } else if (event.type === "done") {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m))
              );
            }
          } catch {
            // ignore
          }
        }
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: "Sorry, something went wrong.", isStreaming: false } : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  }

  const readyFiles = files.filter((f) => f.status === "ready");

  return (
    <div className="flex flex-col h-full">
      {/* Upload zone */}
      <div className="px-4 pt-4 pb-3 shrink-0">
        <div
          className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
            isDragging
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-muted/20"
          }`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm font-medium">Drop files or click to upload</p>
          <p className="text-xs text-muted-foreground mt-1">PDF, images (jpg, png, webp), Word documents</p>
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

      {/* File grid */}
      {files.length > 0 && (
        <div className="px-4 pb-3 shrink-0">
          <div className="flex items-center justify-between mb-2">
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-72 overflow-y-auto pr-1">
            {files.map((file) => (
              <FileCard key={file.id} file={file} />
            ))}
          </div>
        </div>
      )}

      <div className="border-t shrink-0" />

      {/* Chat messages */}
      <ScrollArea ref={chatScrollRef} className="flex-1 px-4 py-3">
        <div className="max-w-2xl mx-auto space-y-3">
          {messages.map((msg) => (
            <ChatBubble key={msg.id} message={msg} />
          ))}
        </div>
      </ScrollArea>

      {/* Chat input */}
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
                ? "Upload and wait for file analysis to start chatting..."
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
  );
}

function FileCard({ file }: { file: FileRecord }) {
  const [expanded, setExpanded] = useState(false);
  const hasThumbnail = !!file.thumbnailFile;

  return (
    <div className="border rounded-xl bg-card text-sm overflow-hidden flex flex-col">
      {/* Thumbnail area */}
      <div className="h-28 bg-muted relative overflow-hidden shrink-0">
        {hasThumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/health/thumbnail/${file.id}`}
            alt={file.aiName}
            className="w-full h-full object-cover object-top"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <FileTypeIcon mimeType={file.mimeType} large />
          </div>
        )}
        {file.status === "analyzing" && (
          <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-2.5 space-y-1 flex-1">
        <p className="font-medium text-xs leading-tight line-clamp-2">
          {file.status === "analyzing" ? file.originalName : file.aiName}
        </p>
        <p className="text-xs text-muted-foreground truncate">{file.originalName}</p>

        {file.status === "ready" && file.description && (
          <div>
            <p className={`text-xs text-muted-foreground leading-relaxed ${!expanded ? "line-clamp-2" : ""}`}>
              {file.description}
            </p>
            {file.description.length > 100 && (
              <button onClick={() => setExpanded(!expanded)} className="text-xs text-primary mt-0.5">
                {expanded ? "Less" : "More"}
              </button>
            )}
          </div>
        )}

        {file.status === "error" && (
          <p className="text-xs text-destructive">Analysis failed</p>
        )}
      </div>
    </div>
  );
}

function FileTypeIcon({ mimeType, large }: { mimeType: string; large?: boolean }) {
  const size = large ? "w-8 h-8" : "w-4 h-4";
  if (mimeType === "application/pdf") return <FileText className={`${size} text-red-400`} />;
  if (mimeType.startsWith("image/")) return <ImageIcon className={`${size} text-blue-400`} />;
  if (mimeType.includes("word")) return <FileText className={`${size} text-indigo-400`} />;
  return <FileIcon className={`${size} text-muted-foreground`} />;
}

function ChatBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-1 ${
          isUser ? "bg-primary text-primary-foreground" : "bg-emerald-100 text-emerald-700"
        }`}
      >
        {isUser ? <User className="w-3.5 h-3.5" /> : <HeartPulse className="w-3.5 h-3.5" />}
      </div>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
          isUser ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted rounded-tl-sm"
        }`}
      >
        {message.content ? (
          <>
            <p className="whitespace-pre-wrap">{message.content}</p>
            {message.isStreaming && (
              <span className="inline-block w-1.5 h-4 bg-current ml-0.5 animate-pulse align-middle" />
            )}
          </>
        ) : (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span className="text-xs">Thinking...</span>
          </span>
        )}
      </div>
    </div>
  );
}
