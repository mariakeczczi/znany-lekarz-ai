import { NextResponse } from "next/server";
import { clearAllFiles } from "@/lib/health-storage";

export async function POST() {
  clearAllFiles();
  return NextResponse.json({ ok: true });
}
