# pplx-cli — Node.js Perplexity AI CLI

## Implementation Plan

> Generated from reverse-engineering [`helallao/perplexity-ai`](https://github.com/helallao/perplexity-ai) Python library.
> This document is a complete blueprint — no need to reference the Python source again.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Authentication & Cookies](#2-authentication--cookies)
3. [API Protocol — Main Client (SSE)](#3-api-protocol--main-client-sse)
4. [API Protocol — Labs Client (WebSocket)](#4-api-protocol--labs-client-websocket)
5. [File Upload Flow](#5-file-upload-flow)
6. [Models & Modes](#6-models--modes)
7. [Cookie Extraction from Chrome (macOS)](#7-cookie-extraction-from-chrome-macos)
8. [CLI Design](#8-cli-design)
9. [Project Structure](#9-project-structure)
10. [Dependencies](#10-dependencies)
11. [Key Code Patterns (Node.js)](#11-key-code-patterns-nodejs)
12. [Complexity Estimates](#12-complexity-estimates)
13. [Risks & Mitigations](#13-risks--mitigations)

---

## 1. Architecture Overview

Perplexity exposes **two distinct APIs**:

### Main Client (authenticated, SSE-based)
- **Transport:** HTTPS POST → Server-Sent Events (SSE) stream
- **Endpoint:** `https://www.perplexity.ai/rest/sse/perplexity_ask`
- **Auth:** Cookie-based (NextAuth.js session cookies)
- **Use case:** Full search with Pro/Reasoning/Deep Research modes, file upload, source filters
- **Anti-bot:** Uses `curl_cffi` with `impersonate="chrome"` (TLS fingerprinting). We'll use `undici` or native `fetch` with proper headers.

### Labs Client (anonymous, WebSocket-based)
- **Transport:** Socket.IO (EIO=4) over WebSocket
- **Endpoint:** `wss://www.perplexity.ai/socket.io/?EIO=4&transport=websocket&sid={sid}`
- **Auth:** Anonymous (`jwt: "anonymous-ask-user"`)
- **Use case:** Quick queries with open-source models (Sonar, R1-1776)
- **No account needed**

```
┌─────────────┐     ┌──────────────────────────────────────┐
│  pplx CLI   │────▶│  Main Client (SSE)                   │
│             │     │  POST /rest/sse/perplexity_ask        │
│  Commands:  │     │  Cookies: next-auth.session-token     │
│  - search   │     │  Response: SSE stream                 │
│  - ask      │     └──────────────────────────────────────┘
│  - research │
│             │     ┌──────────────────────────────────────┐
│  - labs     │────▶│  Labs Client (WebSocket/Socket.IO)   │
│             │     │  wss://perplexity.ai/socket.io/      │
│             │     │  Auth: anonymous-ask-user             │
│             │     │  Response: Socket.IO frames (42[...]) │
└─────────────┘     └──────────────────────────────────────┘
```

---

## 2. Authentication & Cookies

### Required Cookies (Main Client)

The main client requires cookies from a logged-in Perplexity session:

| Cookie | Purpose |
|--------|---------|
| `next-auth.csrf-token` | CSRF token for NextAuth.js (used in account creation) |
| `next-auth.session-token` | JWT session token — **the main auth credential** |
| `next-auth.callback-url` | Callback URL (usually `https://www.perplexity.ai/`) |

### Auth Flow

1. **Session init:** `GET https://www.perplexity.ai/api/auth/session` — sets/validates cookies
2. **All subsequent requests** include cookies automatically via session
3. If `cookies={}` (empty), the client works anonymously with limited features (auto mode only, no pro/reasoning)

### Cookie Sources (our CLI)

1. **Chrome extraction** (preferred) — decrypt from Chrome's cookie DB on macOS
2. **Manual paste** — user exports cookies via DevTools (fallback)
3. **Config file** — `~/.config/pplx/cookies.json`

---

## 3. API Protocol — Main Client (SSE)

### Endpoint

```
POST https://www.perplexity.ai/rest/sse/perplexity_ask
Content-Type: application/json
```

### Request Headers

```javascript
const HEADERS = {
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'max-age=0',
  'dnt': '1',
  'sec-ch-ua': '"Not;A=Brand";v="24", "Chromium";v="128"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
};
```

### Request Body Schema

```typescript
interface SearchRequest {
  query_str: string;
  params: {
    attachments: string[];              // URLs of uploaded files
    frontend_context_uuid: string;      // UUIDv4
    frontend_uuid: string;              // UUIDv4
    is_incognito: boolean;
    language: string;                   // e.g. "en-US"
    last_backend_uuid: string | null;   // For follow-up queries
    mode: 'concise' | 'copilot';       // 'concise' = auto, 'copilot' = pro/reasoning/deep
    model_preference: string;           // Internal model ID (see mapping below)
    source: 'default';
    sources: ('web' | 'scholar' | 'social')[];
    version: '2.18';
  };
}
```

### SSE Response Format

The response is a standard SSE stream with `\r\n\r\n` delimiters:

```
event: message\r\n
data: {"query_str":"...","text":"...","answer":"...","backend_uuid":"...","attachments":[],...}\r\n
\r\n

event: message\r\n
data: {"query_str":"...","text":"[{\"step_type\":\"SEARCH\",...}]","answer":"partial answer...",...}\r\n
\r\n

event: end_of_stream\r\n
data: {}\r\n
\r\n
```

### Response JSON Schema

```typescript
interface SearchResponse {
  query_str: string;
  text: string | Step[];        // JSON string that parses to Step[] (for deep research/reasoning)
  answer: string;               // The main answer text (markdown)
  backend_uuid: string;         // Used for follow-up queries
  attachments: string[];        // File URLs for follow-up context
  chunks?: string[];            // Source chunks
  // ... other fields
}

interface Step {
  step_type: 'SEARCH' | 'ANALYZE' | 'FINAL' | string;
  content: {
    answer?: string;            // JSON string → { answer: string, chunks: string[] }
    // ... step-specific content
  };
}
```

### Nested JSON Parsing (Important!)

The `text` field is a **JSON string** that may contain a list of steps. For deep research/reasoning, the final answer is nested:

```
response.text (string) 
  → JSON.parse → Step[] 
    → find step_type === "FINAL" 
      → step.content.answer (string)
        → JSON.parse → { answer: string, chunks: string[] }
```

---

## 4. API Protocol — Labs Client (WebSocket)

### Connection Sequence

```
1. GET  https://www.perplexity.ai/socket.io/?EIO=4&transport=polling&t={timestamp}
   → Response: "0{...}" → parse JSON after "0" → extract { sid: "..." }

2. POST https://www.perplexity.ai/socket.io/?EIO=4&transport=polling&t={timestamp}&sid={sid}
   Body: 40{"jwt":"anonymous-ask-user"}
   → Response: "OK"

3. CONNECT wss://www.perplexity.ai/socket.io/?EIO=4&transport=websocket&sid={sid}
   Headers: User-Agent, Cookie (from step 1)
   
4. On open: send "2probe", then send "5"

5. On message "2": reply with "3" (ping/pong keepalive)

6. To query: send "42" + JSON.stringify(["perplexity_labs", payload])

7. Responses arrive as "42" + JSON array: [eventName, responseData]
   → responseData has { output: "...", final: true/false }
```

### Labs Request Payload

```typescript
interface LabsRequest {
  messages: { role: 'user' | 'assistant'; content: string; priority?: number }[];
  model: 'r1-1776' | 'sonar-pro' | 'sonar' | 'sonar-reasoning-pro' | 'sonar-reasoning';
  source: 'default';
  version: '2.18';
}
```

### Labs Response

```typescript
interface LabsResponse {
  output: string;     // The answer text
  final: boolean;     // true when complete
  // ... other fields
}
```

---

## 5. File Upload Flow

### Step 1: Get Upload URL

```
POST https://www.perplexity.ai/rest/uploads/create_upload_url?version=2.18&source=default
Content-Type: application/json

{
  "content_type": "application/pdf",
  "file_size": 12345,
  "filename": "document.pdf",
  "force_image": false,
  "source": "default"
}
```

**Response:**
```json
{
  "s3_bucket_url": "https://some-s3-bucket.amazonaws.com/...",
  "s3_object_url": "https://...",
  "fields": {
    "key": "...",
    "policy": "...",
    "x-amz-credential": "...",
    "x-amz-signature": "...",
    // ... other S3 presigned fields
  }
}
```

### Step 2: Upload to S3

```
POST {s3_bucket_url}
Content-Type: multipart/form-data

- All fields from response.fields as form fields
- file: the actual file data
```

### Step 3: Get Final URL

- If `s3_object_url` contains `image/upload` → use Cloudinary URL from upload response, strip signature
- Otherwise → use `s3_object_url` directly

### Step 4: Include in Search

Pass the URL(s) in `params.attachments` array of the search request.

---

## 6. Models & Modes

### Mode → Internal Mode Mapping

| User Mode | `params.mode` value |
|-----------|-------------------|
| `auto` | `concise` |
| `pro` | `copilot` |
| `reasoning` | `copilot` |
| `deep research` | `copilot` |

### Model → Internal Model ID Mapping

```javascript
const MODEL_MAP = {
  auto: {
    default: 'turbo',
  },
  pro: {
    default: 'pplx_pro',
    'sonar': 'experimental',
    'gpt-5.2': 'gpt52',
    'claude-4.5-sonnet': 'claude45sonnet',
    'grok-4.1': 'grok41nonreasoning',
  },
  reasoning: {
    default: 'pplx_reasoning',
    'gpt-5.2-thinking': 'gpt52_thinking',
    'claude-4.5-sonnet-thinking': 'claude45sonnetthinking',
    'gemini-3.0-pro': 'gemini30pro',
    'kimi-k2-thinking': 'kimik2thinking',
    'grok-4.1-reasoning': 'grok41reasoning',
  },
  'deep-research': {
    default: 'pplx_alpha',
  },
};
```

### Labs Models (anonymous, no cookies needed)

| Model ID | Description |
|----------|-------------|
| `r1-1776` | DeepSeek R1 (uncensored) |
| `sonar-pro` | Perplexity Sonar Pro |
| `sonar` | Perplexity Sonar |
| `sonar-reasoning-pro` | Sonar Reasoning Pro |
| `sonar-reasoning` | Sonar Reasoning |

### Source Filters

- `web` — General web search (default)
- `scholar` — Academic papers
- `social` — Social media / Reddit

---

## 7. Cookie Extraction from Chrome (macOS)

### Approach

Use the `chrome-cookies-secure` npm package (v3.0.1) which handles:
- Reading Chrome's SQLite cookie database at `~/Library/Application Support/Google/Chrome/Default/Cookies`
- Decrypting AES-128-CBC encrypted cookie values using the key from macOS Keychain (`Chrome Safe Storage`)
- Keychain access via `security find-generic-password` CLI or `keytar` module

### Implementation

```javascript
import { getCookies } from 'chrome-cookies-secure';

async function getPerplexityCookies() {
  return new Promise((resolve, reject) => {
    getCookies('https://www.perplexity.ai', 'puppeteer', (err, cookies) => {
      if (err) return reject(err);
      // Convert to simple { name: value } dict
      const cookieDict = {};
      for (const cookie of cookies) {
        cookieDict[cookie.name] = cookie.value;
      }
      resolve(cookieDict);
    });
  });
}
```

### Alternative: Direct Implementation

If `chrome-cookies-secure` causes issues, implement directly:

```javascript
import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import os from 'os';

function getChromeKey() {
  const raw = execSync(
    'security find-generic-password -w -s "Chrome Safe Storage" -a "Chrome"',
    { encoding: 'utf-8' }
  ).trim();
  return crypto.pbkdf2Sync(raw, 'saltysalt', 1003, 16, 'sha1');
}

function decryptCookieValue(encryptedValue, key) {
  // Chrome macOS: v10 prefix + AES-128-CBC with IV of 16 spaces
  if (encryptedValue[0] === 0x76 && encryptedValue[1] === 0x31 && encryptedValue[2] === 0x30) {
    const iv = Buffer.alloc(16, 0x20); // 16 space characters
    const data = encryptedValue.slice(3);
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(true);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf-8');
  }
  return encryptedValue.toString('utf-8');
}

function getPerplexityCookies(profile = 'Default') {
  const cookieDbPath = path.join(
    os.homedir(),
    'Library/Application Support/Google/Chrome',
    profile,
    'Cookies'
  );
  
  // Copy DB to avoid lock issues (Chrome holds a lock)
  const tmpDb = `/tmp/pplx-cookies-${Date.now()}.db`;
  execSync(`cp "${cookieDbPath}" "${tmpDb}"`);
  
  const db = new Database(tmpDb, { readonly: true });
  const key = getChromeKey();
  
  const rows = db.prepare(
    "SELECT name, encrypted_value FROM cookies WHERE host_key LIKE '%perplexity.ai'"
  ).all();
  
  const cookies = {};
  for (const row of rows) {
    cookies[row.name] = decryptCookieValue(row.encrypted_value, key);
  }
  
  db.close();
  execSync(`rm "${tmpDb}"`);
  return cookies;
}
```

### Cookie Storage

Store extracted/manual cookies in `~/.config/pplx/cookies.json`:

```json
{
  "next-auth.csrf-token": "...",
  "next-auth.session-token": "...",
  "next-auth.callback-url": "https://www.perplexity.ai/"
}
```

---

## 8. CLI Design

### Commands

```bash
# Quick search (auto mode, no auth needed for basic)
pplx search "what is quantum computing"

# Pro search (requires cookies)
pplx search "explain dark matter" --mode pro

# With specific model
pplx search "compare React vs Vue" --mode pro --model gpt-5.2

# Reasoning mode
pplx search "prove the Pythagorean theorem" --mode reasoning --model claude-4.5-sonnet-thinking

# Deep research
pplx research "comprehensive analysis of CRISPR gene editing"

# Labs (anonymous, no cookies)
pplx labs "what is 2+2" --model sonar
pplx labs "explain gravity" --model r1-1776

# Follow-up (pipe previous response)
pplx search "what is rust" | pplx search "how does its borrow checker work" --follow-up

# Source filters
pplx search "quantum entanglement" --sources scholar
pplx search "AI news" --sources web,social

# File upload
pplx search "summarize this document" --file paper.pdf

# Auth management
pplx auth login              # Extract cookies from Chrome
pplx auth login --manual     # Paste cookies manually  
pplx auth status             # Show current auth state
pplx auth logout             # Clear stored cookies

# Output options
pplx search "query" --json          # Raw JSON output
pplx search "query" --no-stream     # Wait for complete response
pplx search "query" --lang es-ES    # Spanish
```

### Shorthand Aliases

```bash
pplx "query"                    # → pplx search "query"
pplx ask "query"                # → pplx search "query" --mode pro
pplx reason "query"             # → pplx search "query" --mode reasoning
pplx research "query"           # → pplx search "query" --mode "deep research"
```

### Global Options

```
--json              Output raw JSON
--no-stream         Wait for complete response (don't stream)
--no-color          Disable colors
--lang <code>       Language (default: en-US)
--incognito         Don't save to Perplexity history
--profile <name>    Chrome profile name (default: Default)
--verbose           Debug output
```

---

## 9. Project Structure

```
pplx-cli/
├── package.json
├── tsconfig.json              # TypeScript config
├── README.md
├── PLAN.md                    # This file
├── bin/
│   └── pplx.js                # CLI entry point (#!/usr/bin/env node)
├── src/
│   ├── index.ts               # Main exports
│   ├── cli.ts                 # Commander CLI setup
│   ├── client/
│   │   ├── main.ts            # SSE-based main client
│   │   ├── labs.ts            # WebSocket-based labs client
│   │   └── types.ts           # TypeScript interfaces
│   ├── auth/
│   │   ├── cookies.ts         # Cookie management (load/save/validate)
│   │   ├── chrome.ts          # Chrome cookie extraction (macOS)
│   │   └── session.ts         # Session initialization
│   ├── upload/
│   │   └── files.ts           # File upload to S3
│   ├── config/
│   │   ├── constants.ts       # URLs, headers, model mappings
│   │   └── settings.ts        # User config (~/.config/pplx/)
│   ├── stream/
│   │   └── sse.ts             # SSE parser for fetch streams
│   └── util/
│       ├── format.ts          # Terminal output formatting (markdown render)
│       └── logger.ts          # Debug logging
├── test/
│   ├── client.test.ts
│   ├── sse.test.ts
│   └── cookies.test.ts
└── .gitignore
```

---

## 10. Dependencies

### Runtime

| Package | Purpose | Why |
|---------|---------|-----|
| `commander` | CLI framework | Standard, well-maintained |
| `ws` | WebSocket client | For Labs Socket.IO client |
| `better-sqlite3` | SQLite reader | Chrome cookie DB |
| `chalk` | Terminal colors | Pretty output |
| `marked` + `marked-terminal` | Markdown rendering | Render answers in terminal |
| `ora` | Spinners | Loading states |
| `conf` | Config storage | `~/.config/pplx/` |

### Dev

| Package | Purpose |
|---------|---------|
| `typescript` | Type safety |
| `tsx` | Dev runner |
| `vitest` | Testing |
| `@types/ws` | WS types |
| `@types/better-sqlite3` | SQLite types |

### NOT needed

- `curl_cffi` equivalent — Node's native `fetch` with proper headers should work. If TLS fingerprinting is needed, consider `undici` with custom TLS settings or `got` with custom agent.
- `socket.io-client` — The protocol is simple enough to implement with raw `ws`. Socket.IO client adds 100KB+ of bloat for what's essentially: send `"42"+JSON`, receive `"42"+JSON`, respond to `"2"` with `"3"`.

---

## 11. Key Code Patterns (Node.js)

### SSE Client (Main)

```typescript
import { randomUUID } from 'crypto';

interface SearchOptions {
  query: string;
  mode?: 'auto' | 'pro' | 'reasoning' | 'deep-research';
  model?: string;
  sources?: ('web' | 'scholar' | 'social')[];
  files?: string[];           // Already-uploaded URLs
  language?: string;
  followUp?: { backend_uuid: string; attachments: string[] } | null;
  incognito?: boolean;
}

const MODEL_MAP = { /* ... as defined above ... */ };

async function* search(options: SearchOptions, cookies: Record<string, string>) {
  const { query, mode = 'auto', model, sources = ['web'], language = 'en-US', followUp, incognito = false } = options;
  
  const modeKey = mode === 'deep-research' ? 'deep-research' : mode;
  const modelPref = MODEL_MAP[modeKey]?.[model ?? 'default'] ?? 'turbo';
  
  const body = {
    query_str: query,
    params: {
      attachments: followUp?.attachments ?? [],
      frontend_context_uuid: randomUUID(),
      frontend_uuid: randomUUID(),
      is_incognito: incognito,
      language,
      last_backend_uuid: followUp?.backend_uuid ?? null,
      mode: mode === 'auto' ? 'concise' : 'copilot',
      model_preference: modelPref,
      source: 'default',
      sources,
      version: '2.18',
    },
  };

  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  const resp = await fetch('https://www.perplexity.ai/rest/sse/perplexity_ask', {
    method: 'POST',
    headers: {
      ...DEFAULT_HEADERS,
      'content-type': 'application/json',
      'cookie': cookieHeader,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  if (!resp.body) throw new Error('No response body');

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\r\n\r\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      if (part.startsWith('event: end_of_stream')) return;
      if (!part.startsWith('event: message')) continue;

      const dataLine = part.slice('event: message\r\n'.length);
      if (!dataLine.startsWith('data: ')) continue;

      try {
        const json = JSON.parse(dataLine.slice(6));
        // Parse nested text field
        if (json.text && typeof json.text === 'string') {
          try {
            const parsed = JSON.parse(json.text);
            if (Array.isArray(parsed)) {
              for (const step of parsed) {
                if (step.step_type === 'FINAL' && step.content?.answer) {
                  const answerData = JSON.parse(step.content.answer);
                  json.answer = answerData.answer ?? '';
                  json.chunks = answerData.chunks ?? [];
                  break;
                }
              }
            }
            json.text = parsed;
          } catch {}
        }
        yield json;
      } catch {}
    }
  }
}
```

### Socket.IO Labs Client

```typescript
import WebSocket from 'ws';

class LabsClient {
  private ws!: WebSocket;
  private sid!: string;
  private history: { role: string; content: string; priority?: number }[] = [];
  private resolveMessage?: (data: any) => void;

  async connect() {
    const timestamp = Math.random().toString(16).slice(2, 10);
    
    // Step 1: Polling handshake
    const pollUrl = `https://www.perplexity.ai/socket.io/?EIO=4&transport=polling&t=${timestamp}`;
    const pollResp = await fetch(pollUrl);
    const pollText = await pollResp.text();
    // Response starts with packet length prefix, e.g. "0{\"sid\":\"...\",\"upgrades\":[...],\"pingInterval\":25000}"
    this.sid = JSON.parse(pollText.slice(1)).sid;

    // Step 2: Auth via polling
    const authUrl = `https://www.perplexity.ai/socket.io/?EIO=4&transport=polling&t=${timestamp}&sid=${this.sid}`;
    const authResp = await fetch(authUrl, {
      method: 'POST',
      body: '40{"jwt":"anonymous-ask-user"}',
      headers: { 'content-type': 'text/plain' },
    });
    const authText = await authResp.text();
    if (authText !== 'OK') throw new Error('Auth failed: ' + authText);

    // Step 3: WebSocket upgrade
    const cookies = pollResp.headers.get('set-cookie') ?? '';
    this.ws = new WebSocket(
      `wss://www.perplexity.ai/socket.io/?EIO=4&transport=websocket&sid=${this.sid}`,
      { headers: { 'User-Agent': DEFAULT_HEADERS['user-agent'], Cookie: cookies } }
    );

    return new Promise<void>((resolve, reject) => {
      this.ws.on('open', () => {
        this.ws.send('2probe');
        this.ws.send('5');
        resolve();
      });

      this.ws.on('message', (raw: Buffer) => {
        const msg = raw.toString();
        if (msg === '2') { this.ws.send('3'); return; }      // ping → pong
        if (msg.startsWith('42')) {
          const [, data] = JSON.parse(msg.slice(2));
          this.resolveMessage?.(data);
        }
      });

      this.ws.on('error', reject);
    });
  }

  async* ask(query: string, model = 'r1-1776') {
    this.history.push({ role: 'user', content: query });

    this.ws.send('42' + JSON.stringify([
      'perplexity_labs',
      {
        messages: this.history,
        model,
        source: 'default',
        version: '2.18',
      },
    ]));

    while (true) {
      const data = await new Promise<any>(r => { this.resolveMessage = r; });
      yield data;
      if (data.final) {
        this.history.push({ role: 'assistant', content: data.output, priority: 0 });
        return;
      }
    }
  }

  close() {
    this.ws?.close();
  }
}
```

### File Upload

```typescript
async function uploadFile(
  filename: string,
  fileData: Buffer,
  cookies: Record<string, string>
): Promise<string> {
  const mime = getMimeType(filename); // use mime-types package or file extension
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');

  // Step 1: Get presigned URL
  const infoResp = await fetch(
    'https://www.perplexity.ai/rest/uploads/create_upload_url?version=2.18&source=default',
    {
      method: 'POST',
      headers: { ...DEFAULT_HEADERS, 'content-type': 'application/json', cookie: cookieHeader },
      body: JSON.stringify({
        content_type: mime,
        file_size: fileData.length,
        filename,
        force_image: false,
        source: 'default',
      }),
    }
  );
  const info = await infoResp.json();

  // Step 2: Upload to S3 via multipart form
  const form = new FormData();
  for (const [key, value] of Object.entries(info.fields)) {
    form.append(key, value as string);
  }
  form.append('file', new Blob([fileData], { type: mime }), filename);

  const uploadResp = await fetch(info.s3_bucket_url, { method: 'POST', body: form });
  if (!uploadResp.ok) throw new Error(`Upload failed: ${uploadResp.status}`);

  // Step 3: Determine final URL
  if (info.s3_object_url.includes('image/upload')) {
    const cloudinaryResp = await uploadResp.json();
    return cloudinaryResp.secure_url.replace(
      /\/private\/s--.*?--\/v\d+\/user_uploads\//,
      '/private/user_uploads/'
    );
  }
  return info.s3_object_url;
}
```

### Session Initialization

```typescript
async function initSession(cookies: Record<string, string>): Promise<Record<string, string>> {
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  
  const resp = await fetch('https://www.perplexity.ai/api/auth/session', {
    headers: { ...DEFAULT_HEADERS, cookie: cookieHeader },
    redirect: 'manual',
  });

  // Merge any new Set-Cookie headers back
  const setCookies = resp.headers.getSetCookie?.() ?? [];
  for (const sc of setCookies) {
    const [pair] = sc.split(';');
    const [name, ...rest] = pair.split('=');
    cookies[name.trim()] = rest.join('=').trim();
  }

  return cookies;
}
```

---

## 12. Complexity Estimates

| Component | Complexity | LOC (est.) | Notes |
|-----------|-----------|------------|-------|
| CLI setup (commander) | Low | ~150 | Straightforward |
| SSE client + parser | Medium | ~200 | Nested JSON parsing is tricky |
| Labs WebSocket client | Medium | ~180 | Socket.IO protocol from scratch |
| Cookie extraction (Chrome macOS) | Medium-High | ~100 | Keychain + SQLite + crypto |
| File upload | Low-Medium | ~80 | S3 presigned upload |
| Config management | Low | ~60 | ~/.config/pplx/ |
| Terminal formatting | Low-Medium | ~100 | Markdown rendering, spinners |
| Model/mode validation | Low | ~50 | Mapping tables |
| **Total** | | **~920** | Core functionality |

### Build Order (recommended)

1. **Config + constants** — Model maps, URLs, headers
2. **Cookie management** — Load from file, Chrome extraction
3. **SSE client** — Core search functionality
4. **CLI framework** — Commander setup, `pplx search`
5. **Terminal output** — Streaming markdown render
6. **Labs client** — WebSocket for anonymous queries
7. **File upload** — S3 upload flow
8. **Polish** — Follow-up, error handling, `--json`, etc.

---

## 13. Risks & Mitigations

### TLS Fingerprinting
- **Risk:** Perplexity may use TLS fingerprinting (the Python lib uses `curl_cffi` with `impersonate="chrome"`)
- **Mitigation:** Start with native `fetch`. If blocked, try `undici` with custom dispatcher, or shell out to `curl --impersonate chrome` via `curl-impersonate`.

### Cloudflare Protection
- **Risk:** Cloudflare may block automated requests
- **Mitigation:** Cookie-based auth bypasses most Cloudflare checks since we present a valid session. The Python lib doesn't do anything special beyond Chrome impersonation.

### API Changes
- **Risk:** Perplexity updates their API (endpoints, model IDs, SSE format)
- **Mitigation:** Version pin (`version: "2.18"`), keep model map in a config file that's easy to update.

### Rate Limiting
- **Risk:** Perplexity rate limits requests
- **Mitigation:** Add configurable delay between requests. The Python lib uses 1-3s random delay.

### Cookie Expiry
- **Risk:** Session tokens expire
- **Mitigation:** `pplx auth status` command to check validity. Auto-refresh by hitting `/api/auth/session`. Prompt user to re-login when expired.

---

## Appendix: Full Endpoint Reference

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/auth/session` | GET | Cookie | Initialize/validate session |
| `/api/auth/signin/email` | POST | Cookie + CSRF | Email sign-in (account creation) |
| `/api/auth/callback/email` | GET | Token in URL | Complete email sign-in |
| `/rest/sse/perplexity_ask` | POST | Cookie | Main search (SSE response) |
| `/rest/uploads/create_upload_url` | POST | Cookie | Get S3 presigned upload URL |
| `/rest/rate-limit` | GET | Cookie | Check remaining queries |
| `/socket.io/` | GET/POST/WS | Anonymous | Labs API (Socket.IO) |
