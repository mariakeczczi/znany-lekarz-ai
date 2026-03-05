import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const METADATA_FILE = path.join(UPLOADS_DIR, "metadata.json");

export interface FileRecord {
  id: string;
  originalName: string;
  aiName: string;
  description: string;
  mimeType: string;
  uploadedAt: string;
  size: number;
  status: "analyzing" | "ready" | "error";
  fileName: string; // saved filename in uploads dir
  thumbnailFile: string | null; // filename of thumbnail in uploads dir
}

export function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

export function getUploadsDir() {
  return UPLOADS_DIR;
}

export function getFiles(): FileRecord[] {
  ensureUploadsDir();
  if (!fs.existsSync(METADATA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(METADATA_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveFiles(files: FileRecord[]) {
  ensureUploadsDir();
  fs.writeFileSync(METADATA_FILE, JSON.stringify(files, null, 2));
}

export function addFile(data: Omit<FileRecord, "id">): FileRecord {
  const files = getFiles();
  const record: FileRecord = { id: randomUUID(), ...data };
  files.unshift(record);
  saveFiles(files);
  return record;
}

export function updateFile(id: string, updates: Partial<FileRecord>): FileRecord | null {
  const files = getFiles();
  const idx = files.findIndex((f) => f.id === id);
  if (idx === -1) return null;
  files[idx] = { ...files[idx], ...updates };
  saveFiles(files);
  return files[idx];
}

export function clearAllFiles() {
  ensureUploadsDir();
  for (const file of fs.readdirSync(UPLOADS_DIR)) {
    try {
      const p = path.join(UPLOADS_DIR, file);
      if (fs.statSync(p).isFile()) fs.unlinkSync(p);
    } catch {}
  }
  fs.writeFileSync(METADATA_FILE, JSON.stringify([]));
}
