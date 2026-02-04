# pplx-cli — Product Requirements Document

**Version:** 0.1.0  
**Last Updated:** 2026-02-03  
**Status:** Development (Alpha)  
**Author:** Rajan Rengasamy

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Purpose & Value Proposition](#2-purpose--value-proposition)
3. [Target Users](#3-target-users)
4. [Architecture](#4-architecture)
5. [Current State](#5-current-state)
6. [The Core Problem: TLS Fingerprinting](#6-the-core-problem-tls-fingerprinting)
7. [Possible Solutions](#7-possible-solutions)
8. [Comparison to Alternatives](#8-comparison-to-alternatives)
9. [Roadmap](#9-roadmap)
10. [Technical Reference](#10-technical-reference)

---

## 1. Executive Summary

**pplx-cli** is a command-line interface for Perplexity AI that uses **cookie-based authentication** to leverage your existing **Pro subscription** — without consuming paid API credits.

### The Core Insight

Perplexity offers two ways to access their AI:

| Access Method | Cost | What You Get |
|---------------|------|--------------|
| **Perplexity Pro Subscription** | $20/month flat | Unlimited web UI queries, Pro/Reasoning/Deep Research modes |
| **Perplexity API** | Pay-per-token | Programmatic access, but charges ~$0.005-$0.05+ per query |

**The gap:** There's no official way to use your Pro subscription programmatically. If you want CLI or automation, you're forced to pay API credits *on top of* your subscription.

**pplx-cli fills this gap** by extracting session cookies from Chrome and using the same internal API that the Perplexity web app uses. Your Pro queries come from your subscription — no extra cost.

---

## 2. Purpose & Value Proposition

### Why Cookie-Based Auth Matters

1. **Use what you already pay for:** Pro subscribers get unlimited queries through the web UI. Cookie auth lets you access those same queries from the command line.

2. **No API credits needed:** Official API usage is metered and billed separately. A single deep research query can cost $0.50+ in API credits. With cookie auth, it's $0/query.

3. **Access all Pro features:** The internal API supports everything the web UI does — Pro mode, Reasoning mode, Deep Research, all models (GPT-5.2, Claude 4.5, Grok 4.1, etc.).

4. **Headless operation:** After initial cookie extraction, the CLI runs without a browser — ideal for scripts, cron jobs, and AI agents.

### What This Enables

```bash
# AI agent can research topics programmatically
pplx search "latest developments in quantum error correction" --mode pro --json

# Pipe queries for automation
echo "summarize: $ARTICLE_URL" | pplx search - --raw

# Deep research in scripts
pplx research "competitive analysis: Notion vs Obsidian vs Roam" > report.md

# Use in pipelines
cat research_questions.txt | xargs -I {} pplx search "{}" --json >> results.jsonl
```

### Value Proposition Summary

| For | Value |
|-----|-------|
| **AI Agents** | Programmatic access to Perplexity Pro with JSON output, stdin support, exit codes |
| **CLI Users** | Search from terminal without switching to browser |
| **Automation** | Integrate Perplexity into scripts, cron jobs, CI/CD |
| **Developers** | Test prompts, build tools, prototype without API costs |
| **Pro Subscribers** | Get CLI access you're already paying for |

---

## 3. Target Users

### Primary: AI Agents & Automation Systems

- LLM agents (OpenClaw, AutoGPT, Claude-based tools) that need web search
- Automated research pipelines
- Content generation systems that need grounded, cited answers

**Key requirements:**
- `--json` output with structured response
- `--raw` mode (no colors, no spinners)
- stdin support (`echo "query" | pplx search -`)
- Non-zero exit codes on failure
- Non-TTY detection (auto-enables raw mode)

### Secondary: Power Users & Developers

- Developers who want Perplexity in their workflow
- Terminal enthusiasts who prefer CLI over web UI
- Researchers running batch queries
- Anyone prototyping with Perplexity who doesn't want API bills

**Key requirements:**
- Streaming output (real-time answer display)
- Model selection (`--model claude-4.5-sonnet`)
- Source filtering (`--sources scholar`)
- Follow-up queries
- Incognito mode (don't pollute Perplexity history)

### Explicitly NOT For

- Users without a Perplexity Pro subscription (use `pplx labs` for free, anonymous queries)
- Production systems that need official API SLAs
- Users uncomfortable with reverse-engineered tools that may break

---

## 4. Architecture

### 4.1 High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              pplx-cli                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────┐    ┌──────────────────────────────────────────────────────┐   │
│  │  CLI    │───▶│  Main Client (authenticated, Pro features)            │   │
│  │ cli.js  │    │  • POST /rest/sse/perplexity_ask → SSE stream         │   │
│  │         │    │  • Requires cookies from Chrome                       │   │
│  │ search  │    │  • search.js + http.js + session.js                   │   │
│  │ reason  │    └──────────────────────────────────────────────────────┘   │
│  │ research│                                                               │
│  │         │    ┌──────────────────────────────────────────────────────┐   │
│  │         │───▶│  Chrome Bridge (CDP fallback)                         │   │
│  │ --chrome│    │  • Executes fetch() inside Chrome tab                 │   │
│  │         │    │  • Bypasses TLS fingerprinting                        │   │
│  │         │    │  • chrome-bridge.js                                   │   │
│  │         │    └──────────────────────────────────────────────────────┘   │
│  │         │                                                               │
│  │         │    ┌──────────────────────────────────────────────────────┐   │
│  │  labs   │───▶│  Labs Client (anonymous, free)                        │   │
│  │         │    │  • WebSocket/Socket.IO to wss://perplexity.ai         │   │
│  │         │    │  • No auth needed, open-source models only            │   │
│  │         │    │  • labs.js                                            │   │
│  └─────────┘    └──────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Cookie Management                                                   │   │
│  │  • Extract from Chrome (macOS): cookies.js                          │   │
│  │  • Store at ~/.config/pplx/cookies.json                             │   │
│  │  • Test validity: session.js → /api/auth/session                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Module Structure

| Module | Purpose | Key Functions |
|--------|---------|---------------|
| **cli.js** | Commander CLI setup, command handlers | Entry point, stdin handling, output modes |
| **search.js** | Main search orchestration | `search()` generator, HTTP vs Chrome routing |
| **cookies.js** | Chrome cookie extraction & storage | `extractFromChrome()`, `loadCookies()`, `saveCookies()` |
| **session.js** | Session initialization & auth testing | `initSession()`, `testAuth()` |
| **http.js** | HTTP layer with curl-impersonate fallback | `request()`, `streamingFetch()` |
| **labs.js** | WebSocket client for Labs API | `LabsClient` class with Socket.IO protocol |
| **chrome-bridge.js** | CDP bridge to Chrome for TLS bypass | `ChromeBridge` class, SSE streaming via Chrome |
| **config.js** | User configuration loading | `loadConfig()` from ~/.config/pplx/config.json |
| **retry.js** | Exponential backoff retry logic | `withRetry()` wrapper |
| **format.js** | Output formatting | `formatSources()` for citation display |
| **constants.js** | URLs, headers, model mappings | `BASE_URL`, `HEADERS`, `MODEL_MAP`, `LABS_MODELS` |

### 4.3 Authentication Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│ One-time setup: pplx auth                                                │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. User runs: pplx auth --profile Default                               │
│                     │                                                    │
│                     ▼                                                    │
│  2. Extract cookies from Chrome                                          │
│     • Copy ~/Library/Application Support/Google/Chrome/Default/Cookies   │
│     • Get encryption key from macOS Keychain ("Chrome Safe Storage")     │
│     • Decrypt AES-128-CBC encrypted cookie values                        │
│     • Filter for host_key LIKE '%perplexity.ai'                         │
│                     │                                                    │
│                     ▼                                                    │
│  3. Validate cookies                                                     │
│     • GET https://www.perplexity.ai/api/auth/session                    │
│     • Merge any Set-Cookie headers (session refresh)                     │
│     • Check for next-auth.session-token presence                         │
│                     │                                                    │
│                     ▼                                                    │
│  4. Save to ~/.config/pplx/cookies.json                                 │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│ Runtime: pplx search "query"                                             │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. Load cookies from ~/.config/pplx/cookies.json                       │
│                     │                                                    │
│                     ▼                                                    │
│  2. Initialize session (refresh cookies if needed)                       │
│     • GET /api/auth/session with cookie header                          │
│                     │                                                    │
│                     ▼                                                    │
│  3. (Optional) Initialize Socket.IO session for enhanced features        │
│     • GET /socket.io/?EIO=4&transport=polling                           │
│                     │                                                    │
│                     ▼                                                    │
│  4. POST to /rest/sse/perplexity_ask                                    │
│     • SSE stream response                                                │
│     • Parse and yield chunks                                             │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 4.4 Two Search Paths

#### Path A: HTTP Direct (Default)

```
pplx search "query"
      │
      ▼
┌─────────────────┐     ┌──────────────────────────────┐
│ Native fetch()  │────▶│ Cloudflare / Perplexity      │
│ (Node.js)       │     │ TLS fingerprint check        │
└─────────────────┘     └──────────────────────────────┘
                                    │
                                    ▼
                        ┌───────────────────────┐
                        │ 403 Forbidden         │ ← Current blocker
                        │ (TLS fingerprint      │
                        │  doesn't match Chrome)│
                        └───────────────────────┘
```

**Status:** ❌ Blocked by Cloudflare TLS fingerprinting

#### Path B: Chrome CDP Bridge (Fallback)

```
pplx search "query" --chrome
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ ChromeBridge connects via WebSocket to Chrome DevTools Protocol      │
│ • OpenClaw relay: ws://127.0.0.1:18793/cdp                          │
│ • Or direct Chrome: localhost:9222                                   │
└─────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Find Perplexity tab in Chrome (must be open)                         │
│ • Target.attachToTarget with flatten: true                           │
└─────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Execute JavaScript fetch() inside Chrome's context                   │
│ • Chrome's TLS fingerprint, Chrome's cookies                         │
│ • Store chunks in window object, poll them back to CLI               │
└─────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ SSE stream via Chrome ✅ Works!                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Status:** ✅ Works, but requires Chrome + Perplexity tab open

#### Path C: Labs (Anonymous)

```
pplx labs "query"
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Socket.IO handshake (polling → websocket upgrade)                    │
│ • Anonymous JWT: "anonymous-ask-user"                                │
│ • No cookies needed                                                  │
└─────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ WebSocket to wss://www.perplexity.ai/socket.io/                     │
│ • Send: 42["perplexity_labs", {messages, model, ...}]               │
│ • Receive: 42[eventName, {output, final, ...}]                      │
└─────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Open-source models only: sonar, sonar-pro, r1-1776, etc.            │
│ ✅ Works without any auth!                                           │
└─────────────────────────────────────────────────────────────────────┘
```

**Status:** ✅ Fully working

---

## 5. Current State

### 5.1 What Works ✅

| Feature | Status | Notes |
|---------|--------|-------|
| **Cookie extraction (macOS)** | ✅ Working | Extracts from Chrome, decrypts AES-128-CBC |
| **Cookie storage/loading** | ✅ Working | ~/.config/pplx/cookies.json |
| **Auth testing** | ✅ Working | `pplx auth --test` validates cookies |
| **Labs command** | ✅ Working | WebSocket to open models (no auth) |
| **CLI structure** | ✅ Working | commander, subcommands, options |
| **--raw flag** | ✅ Working | Plain text output, no colors |
| **stdin support** | ✅ Working | `echo "query" \| pplx search -` |
| **TTY detection** | ✅ Working | Auto-enables raw mode for pipes |
| **--json output** | ✅ Working | Single JSON object with answer, sources |
| **Config file** | ✅ Working | ~/.config/pplx/config.json for defaults |
| **Model listing** | ✅ Working | `pplx models` shows all available |
| **Chrome profiles** | ✅ Working | `--profile <name>` for multi-profile |

### 5.2 What Doesn't Work ❌

| Feature | Status | Blocker |
|---------|--------|---------|
| **HTTP direct search** | ⚠️ Conditional | Works with `--curl` + curl-impersonate; otherwise Cloudflare 403 |
| **curl-impersonate fallback** | ✅ Implemented | Requires manual build and install |
| **--chrome mode** | ⚠️ Partial | Works, but needs live Perplexity tab open in Chrome |

### 5.3 Feature Status Matrix

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Command          │ HTTP Direct │ --chrome │ Labs │                      │
├─────────────────────────────────────────────────────────────────────────┤
│ pplx search      │     ❌       │    ✅     │  -   │                      │
│ pplx reason      │     ❌       │    ✅     │  -   │                      │
│ pplx research    │     ❌       │    ✅     │  -   │                      │
│ pplx labs        │      -      │     -    │  ✅   │                      │
│ pplx auth        │     ✅       │     -    │  -   │                      │
│ pplx models      │     ✅       │     -    │  -   │                      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 6. The Core Problem: TLS Fingerprinting

### 6.1 What Is TLS Fingerprinting?

When a client (browser, curl, Node.js) connects to a TLS server, it sends a **Client Hello** message. This message contains:

- Supported cipher suites (in a specific order)
- TLS extensions (ALPN, SNI, signature algorithms, etc.)
- Key exchange curves
- Compression methods

The **combination and ordering** of these create a unique fingerprint. Tools like JA3/JA4 hash these into a single identifier.

**Chrome's JA3 fingerprint:** `769,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0`

**Node.js fetch fingerprint:** Completely different cipher order, missing extensions, etc.

### 6.2 How Cloudflare Detects pplx-cli

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  Request from pplx-cli:                                                │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ User-Agent: Chrome/128.0.0.0                    (looks like Chrome)│ │
│  │ Headers: Correct Chrome headers                 (looks like Chrome)│ │
│  │ Cookies: Valid session token                    (authenticated)    │ │
│  │ TLS fingerprint: Node.js/undici                 (NOT Chrome!) ❌   │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  Cloudflare's decision:                                                │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ "Claims to be Chrome, but TLS fingerprint is Node.js"             │ │
│  │ "This is likely a bot or scraper"                                 │ │
│  │ → 403 Forbidden                                                   │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.3 Why This Is Hard to Solve

1. **Node.js uses OpenSSL** for TLS, which has different defaults than Chrome's BoringSSL
2. **You can't easily change** Node's TLS fingerprint from JavaScript
3. **curl-impersonate exists** but requires a custom-compiled curl linked against BoringSSL/NSS
4. **Puppeteer/Playwright** use real browser engines with correct fingerprints, but are heavy
5. **The Python library** uses `curl_cffi` (Python bindings to curl-impersonate)

### 6.4 The Irony

We have **valid cookies** from the user's Chrome. Perplexity's server would happily serve us. But Cloudflare sits in front and blocks us based on *how we connect*, not *who we are*.

---

## 7. Possible Solutions

### 7.1 Solution Comparison Matrix

| Solution | TLS Bypass | Headless | Install Difficulty | Maintenance | Status |
|----------|------------|----------|-------------------|-------------|--------|
| curl-impersonate | ✅ | ✅ | Hard (manual build) | Medium | ✅ Implemented |
| Puppeteer/Playwright | ✅ | ✅ | Easy (npm) | Low | 🔄 Candidate |
| Chrome CDP (current) | ✅ | ❌ | N/A | Low | ✅ Working |
| node-tls-client | ✅ | ✅ | Easy (npm) | Unknown | ❓ Untested |
| Proxy service | ✅ | ✅ | Medium | High ($) | ❌ Not ideal |
| Native fetch | ❌ | ✅ | N/A | N/A | ❌ Blocked |

### 7.2 Option 1: curl-impersonate (Recommended)

**What it is:** A special build of curl that produces Chrome/Firefox TLS fingerprints.

**How it works:**
- Compiled against BoringSSL (Chrome's TLS library)
- Configures cipher suites, extensions, HTTP/2 settings to match Chrome
- Ships as `curl_chrome116`, `curl_chrome120`, etc.

**Installation (macOS):**
```bash
# Dependencies
brew install pkg-config make cmake ninja autoconf automake libtool nss ca-certificates go

# Build and install (Chrome impersonation)
git clone https://github.com/lwthiker/curl-impersonate
cd curl-impersonate
mkdir build && cd build
../configure --prefix=/opt/homebrew
gmake chrome-build
gmake chrome-install  # installs curl_chrome116 to /opt/homebrew/bin
```

**Integration in pplx-cli:**
```javascript
// http.js already has framework for this:
function findCurlImpersonate() {
  for (const name of ['curl-impersonate-chrome', 'curl_chrome116', 'curl_chrome120']) {
    try {
      execSync(`which ${name}`, { stdio: 'pipe' });
      return name;
    } catch {}
  }
  return false;
}
```

**Pros:**
- True headless operation
- Minimal resource usage
- Already integrated into http.js

**Cons:**
- Manual installation (no easy `brew install` or `npm install`)
- Needs to be kept updated as Chrome versions change
- Streaming now supported when `--curl` is enabled (SSE via curl stdout)

### 7.3 Option 2: Puppeteer/Playwright in Headless Mode

**What it is:** Real browser engines (Chromium) running headless.

**How it would work:**
```javascript
import { chromium } from 'playwright';

async function* searchWithPlaywright(query, cookies, opts) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  
  // Set cookies from our extracted cookies
  await context.addCookies(Object.entries(cookies).map(([name, value]) => ({
    name, value, domain: '.perplexity.ai', path: '/'
  })));
  
  const page = await context.newPage();
  
  // Navigate to trigger session, then use page.evaluate() for fetch
  await page.goto('https://www.perplexity.ai/');
  
  // Execute fetch inside browser context (like chrome-bridge.js but headless)
  const response = await page.evaluate(async (body) => {
    const resp = await fetch('/rest/sse/perplexity_ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await resp.text();
  }, requestBody);
  
  await browser.close();
  // Parse SSE response...
}
```

**Pros:**
- Perfect TLS fingerprint (it IS Chrome)
- Easy to install (`npm install playwright`)
- Handles all edge cases (cookies, redirects, JS challenges)
- True headless

**Cons:**
- Heavy dependency (~400MB browser download)
- Slower startup (~1-2s to launch browser)
- Higher memory usage
- Overkill for a simple HTTP request

### 7.4 Option 3: node-tls-client

**What it is:** Node.js bindings to a Go TLS library that can impersonate browsers.

**Status:** The npm package exists but appears unmaintained. The original Go library (`bogdanfinn/tls-client`) is active.

**Potential approach:**
```javascript
import { Session } from 'node-tls-client';

const session = new Session({
  clientIdentifier: 'chrome_120',
});

const response = await session.get('https://www.perplexity.ai/api/auth/session', {
  headers: { cookie: cookieHeader }
});
```

**Pros:**
- Native Node.js integration
- Easy to use if it works

**Cons:**
- Unclear maintenance status
- May not support streaming
- Binary dependency (Go compiled library)

### 7.5 Option 4: Accept Chrome Dependency (Current State)

**What it is:** Keep `--chrome` as the only working path.

**How it works today:**
1. User has Chrome open with a Perplexity tab
2. pplx-cli connects via CDP (Chrome DevTools Protocol)
3. Executes fetch() inside Chrome's context
4. Polls results back to CLI

**User experience:**
```bash
# Requires setup:
# 1. Chrome running
# 2. Perplexity tab open
# 3. OpenClaw gateway running (for CDP relay)

pplx search "query" --chrome  # Works!
```

**Pros:**
- Works today
- No TLS issues
- Uses real Chrome

**Cons:**
- Not headless (defeats primary purpose)
- Requires OpenClaw gateway or Chrome remote debugging
- UX friction for new users

### 7.6 Option 5: Proxy Service (Last Resort)

**What it is:** Route requests through a service that handles TLS fingerprinting.

**Examples:**
- ScrapingBee, ScraperAPI, Bright Data
- Self-hosted proxy with curl-impersonate backend

**Pros:**
- Works reliably
- No local dependencies

**Cons:**
- Costs money ($50-500/month for meaningful usage)
- Privacy concerns (third party sees your cookies)
- Latency overhead
- Not suitable for this use case

### 7.7 Recommended Path Forward

1. **Short term:** Document `--chrome` as the primary working path
2. **Medium term:** Investigate Playwright headless integration
3. **Long term:** Build/distribute curl-impersonate binaries or find a maintained Node.js TLS client

Priority order for implementation:
1. **Playwright headless** — easiest to implement, works immediately
2. **curl-impersonate** — best UX if installable, needs packaging work
3. **node-tls-client** — investigate viability

---

## 8. Comparison to Alternatives

### 8.1 Official Perplexity API

**Endpoint:** `https://api.perplexity.ai/chat/completions`  
**Auth:** API key (separate from Pro subscription)  
**Docs:** https://docs.perplexity.ai

| Aspect | Official API | pplx-cli |
|--------|-------------|----------|
| **Auth** | API key | Session cookies |
| **Cost** | Pay-per-token ($0.005-$0.05+/query) | Free (uses Pro sub) |
| **Models** | Sonar models only | All Pro models (GPT, Claude, Grok) |
| **Modes** | Chat completion only | Pro, Reasoning, Deep Research |
| **SLA** | Yes | No |
| **Stability** | Stable | May break on Perplexity changes |
| **Support** | Official | None |

**When to use Official API:**
- Production systems that need reliability
- You don't have a Pro subscription
- You need guaranteed uptime

**When to use pplx-cli:**
- You have a Pro subscription and want CLI access
- Prototyping/development (no cost)
- AI agents that benefit from Pro features
- Personal automation

### 8.2 pplx-zero / pplx-cli (npm packages)

These are community CLI wrappers for the **official API**:

```bash
# These use official API (require API key, cost per query)
npx pplx-zero "query"
npx pplx-cli "query"
```

| Aspect | pplx-zero/pplx-cli (npm) | pplx-cli (this project) |
|--------|-------------------------|-------------------------|
| **API** | Official API | Internal web API |
| **Auth** | API key | Chrome cookies |
| **Cost** | Paid per query | Free (Pro subscription) |
| **Models** | Sonar only | All models |
| **Installation** | npm | npm (future) |

### 8.3 @perplexity-ai/sdk

Official TypeScript SDK for the API:

```typescript
import { Perplexity } from '@perplexity-ai/sdk';

const client = new Perplexity({ apiKey: 'your-key' });
const response = await client.chat.completions.create({
  model: 'sonar',
  messages: [{ role: 'user', content: 'Hello' }]
});
```

Same trade-offs as official API — costs money, limited models.

### 8.4 helallao/perplexity-ai (Python)

**The original inspiration for pplx-cli.**

https://github.com/helallao/perplexity-ai

This Python library reverse-engineered the Perplexity web API. Key features:
- Cookie-based auth (same approach as pplx-cli)
- Uses `curl_cffi` for TLS fingerprint impersonation
- Account generation via Emailnator (get free Pro trials)
- Sync and async APIs
- Web interface with Patchright

| Aspect | helallao/perplexity-ai | pplx-cli |
|--------|------------------------|----------|
| **Language** | Python | Node.js |
| **TLS Solution** | curl_cffi (Python bindings) | In progress |
| **CLI** | No (library only) | Yes |
| **Account gen** | Yes (Emailnator) | No |
| **Maintenance** | Active | Active |

**Why pplx-cli exists:**
- Node.js ecosystem (for JS/TS agents and tools)
- CLI-first design (for shell scripts, pipes)
- Agent-optimized output (--json, --raw, exit codes)

### 8.5 Summary: When to Use What

| Use Case | Best Tool |
|----------|-----------|
| Production app with SLA needs | Official API + SDK |
| Python project, need library | helallao/perplexity-ai |
| Node.js project, need library | Official SDK (if cost OK) or pplx-cli |
| CLI/shell automation | pplx-cli |
| AI agent integration | pplx-cli |
| Don't have Pro subscription | Official API or `pplx labs` |
| Don't want to pay for queries | pplx-cli |

---

## 9. Roadmap

### Phase 1: Core Functionality (Current)

**Status:** 🟡 Partially Complete

- [x] CLI structure with commander
- [x] Cookie extraction from Chrome (macOS)
- [x] Cookie storage and loading
- [x] Auth testing (`pplx auth --test`)
- [x] Labs command (WebSocket, no auth)
- [x] Basic streaming output
- [x] --raw, --json flags
- [x] stdin support
- [x] TTY detection
- [x] Config file support
- [x] Model listing command
- [ ] **HTTP direct search (blocked by TLS)**
- [ ] curl-impersonate integration (fallback not working)

### Phase 2: TLS Solution (Next Priority)

**Goal:** Make headless search work without Chrome dependency

- [ ] Evaluate Playwright headless approach
  - [ ] Prototype implementation
  - [ ] Benchmark startup time and memory
  - [ ] Compare to Chrome CDP approach
- [ ] Investigate curl-impersonate packaging
  - [ ] Test manual build on macOS
  - [ ] Explore distribution options (brew tap, binary download)
- [ ] Evaluate node-tls-client
  - [ ] Test if it still works
  - [ ] Check streaming support
- [ ] Implement chosen solution
- [ ] Update documentation with installation requirements

### Phase 3: Polish & Release

**Goal:** Production-ready v1.0

- [ ] Comprehensive error messages
  - [ ] Detect Cloudflare blocks and suggest solutions
  - [ ] Cookie expiry detection and refresh prompt
  - [ ] Network error handling
- [ ] Input validation
  - [ ] Query length limits
  - [ ] Model name validation
- [ ] Tests
  - [ ] Unit tests for cookie parsing
  - [ ] Integration tests for Labs API
  - [ ] Mock tests for SSE parsing
- [ ] Documentation
  - [ ] Installation guide for each TLS solution
  - [ ] Troubleshooting guide
  - [ ] API reference for library usage
- [ ] npm publish
  - [ ] Package naming (`@rajan/pplx-cli` or `pplx-cli` if available)
  - [ ] Binary distribution
- [ ] GitHub release
  - [ ] Release notes
  - [ ] Pre-built binaries for common platforms

### Phase 4: Enhanced Features

**Goal:** Feature parity with Python library

- [ ] Linux cookie extraction
- [ ] Windows cookie extraction
- [ ] File upload support
- [ ] Follow-up queries (conversation context)
- [ ] Interactive mode (`pplx search --interactive`)
- [ ] Rate limit checking (`pplx status`)
- [ ] Proxy support (`--proxy`)

### Phase 5: Ecosystem

**Goal:** Integration with other tools

- [ ] MCP server implementation (Model Context Protocol)
- [ ] OpenClaw skill package
- [ ] VS Code extension
- [ ] Alfred workflow
- [ ] Raycast extension

---

## 10. Technical Reference

### 10.1 API Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/auth/session` | GET | Cookie | Initialize/validate session |
| `/rest/sse/perplexity_ask` | POST | Cookie | Main search (SSE response) |
| `/rest/uploads/create_upload_url` | POST | Cookie | Get S3 upload URL |
| `/rest/rate-limit` | GET | Cookie | Check remaining queries |
| `/socket.io/` | GET/POST/WS | Anonymous | Labs API (Socket.IO) |

### 10.2 Request Headers

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

### 10.3 Model Mappings

```javascript
const MODEL_MAP = {
  auto: { default: 'turbo' },
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
  'deep-research': { default: 'pplx_alpha' },
};

const LABS_MODELS = ['r1-1776', 'sonar-pro', 'sonar', 'sonar-reasoning-pro', 'sonar-reasoning'];
```

### 10.4 Required Cookies

| Cookie | Purpose |
|--------|---------|
| `next-auth.csrf-token` | CSRF protection |
| `next-auth.session-token` | Main auth token (JWT) |
| `__Secure-next-auth.session-token` | Secure variant of session token |
| `next-auth.callback-url` | OAuth callback URL |

### 10.5 Search Request Schema

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
    mode: 'concise' | 'copilot';       // 'concise' = auto, 'copilot' = pro/reasoning
    model_preference: string;           // Internal model ID
    source: 'default';
    sources: ('web' | 'scholar' | 'social')[];
    version: '2.18';
  };
}
```

### 10.6 Dependencies

```json
{
  "dependencies": {
    "better-sqlite3": "^11.0.0",    // Chrome cookie DB reading
    "chalk": "^5.3.0",              // Terminal colors
    "commander": "^12.0.0",         // CLI framework
    "eventsource-parser": "^3.0.0", // SSE parsing
    "ora": "^8.0.0",                // Spinners
    "ws": "^8.16.0"                 // WebSocket for Labs
  }
}
```

---

## Appendix A: CLI Reference

```
pplx <command> [options]

Commands:
  pplx search [query]    Search with Perplexity (default: pro mode)
  pplx reason [query]    Reasoning mode search
  pplx research [query]  Deep research mode
  pplx labs [query]      Query open-source models (no auth needed)
  pplx auth              Extract and manage cookies from Chrome
  pplx models            List available models

Global Options:
  --verbose              Enable verbose logging
  --proxy <url>          Set proxy URL
  --raw                  Plain text output, no colors, no spinner
  --help                 Show help
  --version              Show version

Search Options:
  -m, --mode <mode>      Search mode: auto, pro, reasoning, deep-research
  --model <model>        Model name or raw model ID
  --sources <sources>    Comma-separated: web,scholar,social
  --json                 Output JSON object with answer, sources
  --no-citations         Hide citation numbers and sources
  --citations-full       Show full citation details
  --incognito            Don't save to Perplexity history
  --lang <code>          Language code (default: en-US)
  --curl                 Force curl-impersonate for TLS
  --chrome               Use Chrome CDP bridge

Auth Options:
  --test                 Test if stored cookies are valid
  --profile <name>       Chrome profile name (default: Default)
```

---

## Appendix B: Acknowledgements

This project was built upon the reverse-engineering work in **[helallao/perplexity-ai](https://github.com/helallao/perplexity-ai)** — a Python library for the Perplexity AI API. The authentication flow, SSE protocol handling, and API structure were all derived from studying that project.

pplx-cli is a ground-up Node.js reimplementation optimized for CLI and agent use cases.

---

*This document is the authoritative reference for the pplx-cli project's purpose, architecture, and state.*
