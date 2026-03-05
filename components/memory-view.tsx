"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function MemoryView() {
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/memory")
      .then((r) => r.json())
      .then((d) => {
        setContent(d.content ?? "");
        setLoading(false);
      });
  }, []);

  async function handleSave() {
    await fetch("/api/memory", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    setSaved(true);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Health Profile</p>
          <p className="text-xs text-muted-foreground">
            Auto-updated by the agent after each conversation and document upload.
          </p>
        </div>
        <Button size="sm" onClick={handleSave} disabled={saved}>
          {saved ? "Saved" : "Save"}
        </Button>
      </div>
      <textarea
        className="flex-1 resize-none font-mono text-xs border rounded-md p-3 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        value={content || ""}
        placeholder="No profile yet. Start a conversation or upload a document."
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
          setContent(e.target.value);
          setSaved(false);
        }}
      />
    </div>
  );
}
