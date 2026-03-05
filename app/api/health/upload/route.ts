import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { addFile, updateFile, getUploadsDir, ensureUploadsDir } from "@/lib/health-storage";
import { analyzeFile } from "@/lib/health-analysis";

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  ensureUploadsDir();
  const uploadsDir = getUploadsDir();
  const ext = path.extname(file.name);
  const savedFileName = `${randomUUID()}${ext}`;
  const filePath = path.join(uploadsDir, savedFileName);

  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  const record = addFile({
    originalName: file.name,
    aiName: file.name,
    description: "",
    mimeType: file.type || "application/octet-stream",
    uploadedAt: new Date().toISOString(),
    size: file.size,
    status: "analyzing",
    fileName: savedFileName,
  });

  // Analyze in background — response returns immediately with "analyzing" status
  setImmediate(async () => {
    try {
      const { name, description } = await analyzeFile(filePath, file.type, file.name);
      updateFile(record.id, { aiName: name, description, status: "ready" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Analysis failed";
      updateFile(record.id, { status: "error", description: msg });
    }
  });

  return NextResponse.json(record, { status: 202 });
}
