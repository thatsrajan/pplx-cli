# pplx-cli

A command-line interface for [Perplexity AI](https://www.perplexity.ai) — Pro Search, Reasoning, Deep Research, and Labs models, all from your terminal.

Uses cookie-based auth from your Chrome browser. No API key required — just a Perplexity account.

## Features

- **Pro Search** — default Perplexity search with web sources and citations
- **Reasoning** — step-by-step reasoning with thinking models (GPT-5.2, Claude 4.5, Gemini 3.0 Pro, etc.)
- **Deep Research** — extended research mode for complex queries
- **Labs** — open-source models (Sonar, R1-1776) — no auth needed
- **Streaming output** — real-time response streaming in your terminal
- **Citation options** — inline markers, full details, or hidden
- **JSON output** — pipe raw responses into scripts and pipelines

## Prerequisites

- **Node.js** ≥ 20
- **macOS** (cookie extraction uses the macOS Keychain)
- **Google Chrome** with an active [Perplexity](https://www.perplexity.ai) login

## Setup

### 1. Log into Perplexity

Open Chrome and go to [perplexity.ai](https://www.perplexity.ai). Sign in with your account. Make sure you can run a search in the browser — this confirms your session is active.

> **Pro/paid account recommended.** Free accounts work but have limited access to Pro Search and model selection.

### 2. Install

```bash
# Clone the repo
git clone https://github.com/rajanrengasamy/pplx-cli.git
cd pplx-cli

# Install dependencies
npm install

# Link globally (optional — lets you run `pplx` from anywhere)
npm link
```

### 3. Authenticate

```bash
pplx auth
```

This extracts session cookies from your Chrome browser (you'll get a macOS Keychain prompt — allow it). Cookies are saved to `~/.config/pplx/cookies.json`.

**Using a specific Chrome profile?**

```bash
pplx auth --profile "Profile 1"
```

**Test your auth:**

```bash
pplx auth --test
```

If cookies expire (you'll get auth errors), just log into Perplexity in Chrome again and re-run `pplx auth`.

## Usage

### Quick Search

```bash
pplx search "What is the latest on Apple M5?"
# or just:
pplx "What is the latest on Apple M5?"
```

### Pro Search with Model Selection

```bash
pplx search "Compare React and Svelte" --mode pro
pplx search "Explain quantum computing" --mode pro --model gpt-5.2
pplx search "Best practices for RAG" --mode pro --model claude-4.5-sonnet
```

### Reasoning Mode

```bash
pplx reason "Why is the sky blue?"
pplx search "Solve this step by step: ..." --mode reasoning --model gpt-5.2-thinking
```

### Deep Research

```bash
pplx research "Comprehensive analysis of the EV market in 2026"
```

### Labs (No Auth Required)

```bash
pplx labs "Hello world" --model sonar
pplx labs "Explain transformers" --model r1-1776
```

Available labs models: `sonar`, `sonar-pro`, `sonar-reasoning`, `sonar-reasoning-pro`, `r1-1776`

### Citation Options

```bash
# Default: inline [1], [2] markers + source URLs at the bottom
pplx search "Latest SpaceX launches"

# Full citations with title + URL
pplx search "Latest SpaceX launches" --citations-full

# No citations (clean output)
pplx search "Latest SpaceX launches" --no-citations
```

### JSON Output

```bash
pplx search "Node.js best practices" --json | jq '.answer'
```

### Available Models

| Mode | Models |
|------|--------|
| **Auto** | `turbo` (default) |
| **Pro** | `pplx_pro` (default), `sonar`, `gpt-5.2`, `claude-4.5-sonnet`, `grok-4.1` |
| **Reasoning** | `pplx_reasoning` (default), `gpt-5.2-thinking`, `claude-4.5-sonnet-thinking`, `gemini-3.0-pro`, `kimi-k2-thinking`, `grok-4.1-reasoning` |
| **Deep Research** | `pplx_alpha` (default) |

### Force curl-impersonate

If you hit TLS fingerprinting issues:

```bash
pplx search "query" --curl
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `No cookies. Run: pplx auth` | Log into perplexity.ai in Chrome, then run `pplx auth` |
| `Cookies are invalid or expired` | Re-login in Chrome, re-run `pplx auth` |
| Keychain prompt denied | Allow Chrome Safe Storage access in the macOS Keychain prompt |
| TLS/connection errors | Try `--curl` flag to use curl-impersonate |
| `No session token found` | Make sure you're logged in (not just on the homepage — run a search) |

## How It Works

1. `pplx auth` reads Chrome's cookie database on macOS (decrypting via the Keychain)
2. Session cookies are stored locally at `~/.config/pplx/cookies.json`
3. Search commands use these cookies to authenticate against Perplexity's SSE API
4. Labs commands use WebSocket (Socket.IO) — no auth needed

## License

MIT
