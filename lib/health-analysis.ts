import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const client = new Anthropic();

// LibreOffice binary on macOS
const SOFFICE = "/Applications/LibreOffice.app/Contents/MacOS/soffice";

const SYSTEM_PROMPT = `You are a medical document analyzer. Your task is to analyze uploaded medical documents and return:
1. A concise, descriptive file name (without extension) that captures document type, key date, and context
2. A detailed but concise description focusing on clinically significant findings

For the description:
- Mention specific values that are out of normal range with their values and reference ranges (e.g., "LDL cholesterol 4.8 mmol/L, ref: <3.4 — elevated")
- Note significant diagnoses, procedures, prescribed medications
- Highlight findings the patient should be aware of
- Use a short list format for multiple findings
- If results are normal, briefly confirm that with a few key values

Respond ONLY with valid JSON in this exact format:
{"name": "Descriptive File Name", "description": "Finding 1\\nFinding 2\\nFinding 3"}`;

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: ImageMediaType; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

export async function analyzeFile(
  filePath: string,
  mimeType: string,
  originalName: string
): Promise<{ name: string; description: string }> {
  const contentBlocks = buildContentBlocks(filePath, mimeType);

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content: [...contentBlocks, { type: "text", text: `Original filename: ${originalName}\n\nAnalyze this medical document.` }] as any,
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        name: parsed.name ?? originalName,
        description: parsed.description ?? "No description available.",
      };
    }
  } catch {
    // fall through
  }
  return { name: originalName, description: text || "Unable to analyze document." };
}

function buildContentBlocks(filePath: string, mimeType: string): ContentBlock[] {
  // PDF — native Claude document support
  if (mimeType === "application/pdf") {
    const data = fs.readFileSync(filePath).toString("base64");
    return [{ type: "document", source: { type: "base64", media_type: "application/pdf", data } }];
  }

  // Images — vision
  if (mimeType.startsWith("image/")) {
    const data = fs.readFileSync(filePath).toString("base64");
    const media_type = mimeType as ImageMediaType;
    return [{ type: "image", source: { type: "base64", media_type, data } }];
  }

  // Word documents — convert via LibreOffice to PNG pages, then vision
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword"
  ) {
    const images = convertDocToImages(filePath);
    if (images.length > 0) {
      return images.map((imgPath) => {
        const data = fs.readFileSync(imgPath).toString("base64");
        return { type: "image" as const, source: { type: "base64" as const, media_type: "image/png" as const, data } };
      });
    }
  }

  // Fallback — plain text
  try {
    const text = fs.readFileSync(filePath, "utf-8");
    return [{ type: "text", text: `File contents:\n${text.slice(0, 50000)}` }];
  } catch {
    return [{ type: "text", text: "Unable to read file contents." }];
  }
}

function convertDocToImages(filePath: string): string[] {
  const dir = path.dirname(filePath);
  const basename = path.basename(filePath, path.extname(filePath));
  try {
    execSync(`"${SOFFICE}" --headless --convert-to png "${filePath}" --outdir "${dir}"`, {
      timeout: 30000,
    });
    return fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(basename) && f.endsWith(".png"))
      .sort()
      .map((f) => path.join(dir, f));
  } catch (e) {
    console.error("LibreOffice conversion failed:", e);
    return [];
  }
}
