# pplx-cli

[![npm version](https://img.shields.io/npm/v/pplx-npx-search.svg)](https://www.npmjs.com/package/pplx-npx-search)
[![license](https://img.shields.io/npm/l/pplx-npx-search.svg)](./LICENSE)

A cookie-authenticated CLI for **Perplexity AI**. Built for headless and agentic usage — no browser required at runtime, no API key, no per-call billing beyond your existing Perplexity Pro subscription.

```bash
npm install -g pplx-npx-search
pplx auth --browser auto
pplx auth --test
pplx search "what shipped in Claude 4.7 this week" --json --raw
```

That's the whole loop. Cookies live at `~/.config/pplx/cookies.json`, never paste them by hand.

---

## Why this exists

Perplexity has no public consumer-tier API. Power users who already pay for Pro want shell and agent access without paying again per-call for the API. pplx-cli reads the cookies from your already-signed-in browser and uses them headlessly, so:

- **No API key.** Cookies come from your real session.
- **No re-billing.** Calls count against your existing Pro quota.
- **Agent-friendly.** `--json` and `--raw` flags are designed for piping into LLMs, agents, and scripts.
- **TLS fingerprinting fallback.** When Cloudflare gets aggressive, the CLI auto-falls back to Playwright or curl-impersonate.

This is a ground-up Node.js reimplementation inspired by the reverse-engineering work in [helallao/perplexity-ai](https://github.com/helallao/perplexity-ai) — see [Acknowledgements](#acknowledgements).

---

## Prerequisites

- Node.js 20 or newer
- A logged-in session in **Chrome, Chrome Beta, Comet, or Dia** (macOS) or **Google Chrome** (Linux)
- Optional: Playwright Chromium (`npx playwright install chromium`) for the `--playwright` transport

---

## Quick Start

### 1. Log into Perplexity in your browser

Before anything else, open one of the supported browsers (Chrome, Chrome Beta, Comet, or Dia) and **make sure you are signed into perplexity.ai**. The CLI extracts cookies from your real session; if you are not logged in, there is nothing to extract.

### 2. Install the CLI

```bash
npm install -g pplx-npx-search

# or run once without installing
npx pplx-npx-search search "what is quantum computing"
```

If you would rather build from source:

```bash
git clone https://github.com/thatsrajan/pplx-cli.git
cd pplx-cli
npm install
npm link
```

### 3. Extract cookies once

```bash
pplx auth --browser auto
```

`--browser auto` tries every supported browser in turn and uses the first one that yields a valid signed-in session. Force a specific browser if you have multiple installed:

```bash
pplx auth --browser chrome
pplx auth --browser chrome-beta
pplx auth --browser comet
pplx auth --browser dia
```

If the browser stores are locked down (corporate machine, weird Keychain ACL, etc.) you can fall back to Playwright:

```bash
pplx auth --playwright
```

Cookies are written to `~/.config/pplx/cookies.json`.

> **Security:** never commit `cookies.json` to a repo or paste its contents into a chat. The file is a complete session credential. The CLI never asks you to type cookies by hand and never logs them to stdout.

### 4. Verify

```bash
pplx auth --test
```

This must report `✓ Cookies are valid` before agents start calling the CLI. If it fails, repeat step 1 (you may be signed out) then step 3.

### 5. Use it

```bash
pplx search "what is quantum computing"
pplx reason "explain the Riemann hypothesis"
pplx research "compare React vs Vue in 2026"
pplx labs "hello world"          # free, no auth needed
pplx models                       # list available models
```

---

## Agent Usage

pplx-cli is designed to be the Perplexity transport for AI agents, CI jobs, and headless scripts.

```bash
# Plain text output, no colors, no spinner
pplx search "query" --raw

# Single JSON object: { answer, sources, query, mode, model }
pplx search "query" --json

# Read query from stdin
echo "what is 2+2" | pplx search -

# Pipe-friendly: auto-detects non-TTY
pplx search "query" | head -1

# Non-zero exit when no answer is returned
pplx search "query" --json || echo "failed"
```

Deep Research is slower than normal search. `pplx research` defaults to a 10-minute stream timeout; override it per run with `--timeout-ms 600000`, `--timeout-ms 120s`, or `--timeout-ms 10m`.

Recommended agent invocation:

```bash
pplx search "research this topic" --json --raw --mode pro
```

`--json --raw` gives a clean, deterministic envelope with no chrome around it:

```json
{
  "answer": "...",
  "sources": [
    {"title": "...", "url": "..."}
  ],
  "query": "...",
  "mode": "pro",
  "model": "..."
}
```

---

## Options

| Flag | Description |
|---|---|
| `--mode auto\|pro\|reasoning\|deep-research` | Search mode |
| `--model claude-3.5-sonnet` | Pin a specific model |
| `--json` | Single JSON object output |
| `--raw` | Plain text, no colors, no spinner |
| `--chrome` | Use Chrome CDP bridge instead of HTTP |
| `--playwright` | Use Playwright headless Chromium |
| `--no-playwright` | Force HTTP transport even if config enables Playwright |
| `--timeout-ms 120000\|120s\|10m` | Overall stream timeout |
| `--curl` | Force curl-impersonate (auto-downloads if missing) |
| `--allow-anonymous` | Allow anonymous Perplexity responses when cookies are expired |
| `--incognito` | Do not save the query to Perplexity history |
| `--citations-full` | Show full source metadata in the rendered answer |

---

## Architecture

| Layer | Detail |
|---|---|
| **Default transport** | Headless HTTP with stored cookies. No browser launched at runtime. |
| **Optional transports** | `--chrome` Chrome CDP bridge, `--playwright` Playwright headless Chromium, `--curl` curl-impersonate for TLS fingerprinting. |
| **Auto fallback** | HTTP → Playwright → curl-impersonate when TLS is blocked. |
| **Streaming** | Real-time answer streaming via Server-Sent Events. |
| **Auth** | One-time cookie extraction from Chrome / Chrome Beta / Comet / Dia (macOS Keychain) or `~/.config/google-chrome` (Linux). After that, fully headless. |
| **Session validation** | `pplx auth --test` and `pplx auth --browser auto` both verify that the extracted cookies resolve to an authenticated session (not just "I extracted some bytes"). |

---

## Configuration

Optional config file at `~/.config/pplx/config.json`:

```json
{
  "mode": "pro",
  "model": "claude-3.5-sonnet",
  "lang": "en-US",
  "playwright": true,
  "playwrightHeadless": false
}
```

Set `"playwright": true` to make Playwright the default transport.

Environment overrides:

```bash
PPLX_CURL_IMPERSONATE=/path/to/curl-impersonate-chrome
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Cookies are invalid or expired` | Open Perplexity in your browser, confirm you are signed in, then re-run `pplx auth --browser auto`. |
| `Keychain access denied for "Chrome Safe Storage"` | macOS Keychain is prompting for permission. Run the exact `security find-generic-password` command the error suggests and click "Always Allow". |
| `Chrome cookie DB not found at ...` | The selected browser is not installed at the default location, or the profile name is wrong. Pass `--browser <name>` or `--profile <name>`. |
| Search hangs or times out | TLS fingerprinting may be in play. Try `pplx search "..." --playwright` or `--curl`. |
| `npm install -g` succeeds but `pplx` not found | Your global `npm bin` directory is not on PATH. Find it with `npm bin -g` and add it. |

---

## Acknowledgements

This project was inspired by and built upon the reverse-engineering work in [helallao/perplexity-ai](https://github.com/helallao/perplexity-ai) — a Python library for the Perplexity AI API. The authentication flow, SSE protocol handling, and API structure were all derived from studying that project. Big thanks to [@helallao](https://github.com/helallao) for figuring out the hard parts.

pplx-cli is a ground-up Node.js reimplementation for CLI and agentic use cases, but it would not exist without that foundational work.

## License

MIT
