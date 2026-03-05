import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getFiles, getUploadsDir } from "@/lib/health-storage";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const files = getFiles();
  const record = files.find((f) => f.id === id);

  if (!record?.thumbnailFile) {
    return new NextResponse(null, { status: 404 });
  }

  const filePath = path.join(getUploadsDir(), record.thumbnailFile);
  if (!fs.existsSync(filePath)) {
    return new NextResponse(null, { status: 404 });
  }

  const buffer = fs.readFileSync(filePath);
  const contentType = record.thumbnailFile.endsWith(".png") ? "image/png" : record.mimeType;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
