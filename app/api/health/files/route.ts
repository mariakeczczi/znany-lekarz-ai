import { NextResponse } from "next/server";
import { getFiles } from "@/lib/health-storage";

export async function GET() {
  const files = getFiles();
  return NextResponse.json(files);
}
