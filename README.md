# ZnanyLekarz AI

AI-powered doctor search and personal health assistant, built with Claude Agent SDK.

## What it does

Two features in one app:

### 1. Doctor Search
Find specialist doctors on ZnanyLekarz/Doctoralia using natural language. Describe symptoms or name a specialty — the agent figures out the right specialist, asks for your city if needed, and returns up to 5 doctor cards with ratings, pricing, location, and available appointment slots.

If you have health documents uploaded, the agent reads them when relevant and uses that context to refine the search (e.g. recommends urologists with oncology experience if your files mention prostate history).

### 2. Health Data
Upload your medical documents (PDFs, images, Word files). The app:
- Generates a thumbnail preview for each file
- Analyzes the content with Claude and assigns a readable name + summary
- Lets you chat with an AI that can read your files and search the web for medical information

## How it works

```
Browser → Next.js API route → Claude Agent SDK → Claude Sonnet 4.6
                                               ↘ MCP: search_doctor (ZnanyLekarz API)
                                               ↘ Built-in: Read, WebFetch
```

Responses stream over SSE. The UI shows agent steps in real time (blue = in progress, green = done).

### Doctor Search (`/api/chat`)
- Connects to a ZnanyLekarz MCP server (`nova-search-mcp`) at `localhost:3003/mcp`
- Agent calls `search_doctor` with parameters: specialty, location, insurance, price range, etc.
- Results come back as a `\`\`\`doctors` JSON block, rendered as rich cards in the UI
- When health files are present, agent reads them via `Read` tool and injects context into the search

### Health Chat (`/api/health/agent-chat`)
- Agent has access to uploaded files via `Read` tool (full file paths in system prompt)
- Uses `WebFetch` to look up medical info from PubMed, Mayo Clinic, MedlinePlus
- File uploads processed in background: thumbnail first (fast), Claude analysis second

### File storage
- Files saved to `uploads/` (git-ignored — never committed)
- Metadata in `uploads/metadata.json`
- Thumbnails generated via LibreOffice headless for PDF/DOCX, direct serve for images

## Stack

- **Next.js 15** (App Router)
- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`)
- **Tailwind CSS + shadcn/ui**
- **LibreOffice** (headless) — PDF/DOCX thumbnail generation

## Running locally

```bash
pnpm install
pnpm dev
```

Requires:
- `ANTHROPIC_API_KEY` in `.env.local`
- `nova-search-mcp` running at `localhost:3003` for doctor search
- LibreOffice installed at `/Applications/LibreOffice.app` for document thumbnails
