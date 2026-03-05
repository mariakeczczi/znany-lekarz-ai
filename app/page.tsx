"use client";

import { useState } from "react";
import { Chat } from "@/components/chat";
import { HealthData } from "@/components/health-data";
import { Stethoscope } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type Tab = "doctor" | "health";

export default function Home() {
  const [tab, setTab] = useState<Tab>("doctor");

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="border-b bg-card px-4 py-3 flex items-center gap-3 shadow-sm shrink-0">
        <a href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-primary text-primary-foreground">
            <Stethoscope className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-semibold text-sm">ZnanyLekarz AI</h1>
            <p className="text-xs text-muted-foreground">Your personal health assistant</p>
          </div>
        </a>
        <Badge variant="secondary" className="ml-auto text-xs">Beta</Badge>
      </header>

      <div className="flex border-b bg-card shrink-0">
        {(["doctor", "health"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "doctor" ? "Doctor Search" : "Health Data"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === "doctor" ? <Chat /> : <HealthData />}
      </div>
    </div>
  );
}
