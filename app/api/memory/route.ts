import { NextRequest, NextResponse } from "next/server";
import { loadProfileContext } from "@/lib/memory";
import fs from "fs/promises";
import path from "path";

const PROFILE_FILE = path.join(process.cwd(), "memory", "profile.md");

export async function GET() {
  const content = await loadProfileContext();
  return NextResponse.json({ content });
}

export async function PUT(req: NextRequest) {
  const { content } = await req.json();
  if (typeof content !== "string") {
    return NextResponse.json({ error: "Invalid content" }, { status: 400 });
  }
  await fs.mkdir(path.dirname(PROFILE_FILE), { recursive: true });
  await fs.writeFile(PROFILE_FILE, content, "utf-8");
  return NextResponse.json({ ok: true });
}
