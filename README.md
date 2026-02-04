# pplx-cli

CLI for Perplexity AI with cookie-based authentication. Designed for headless/agent-first usage — no browser required at runtime.

## Prerequisites

- Node.js 20+
- Google Chrome (only for initial cookie extraction via `pplx auth`)
- Playwright (optional, for `pplx auth --playwright` and `--playwright` mode). If needed: `npx playwright install chromium`

## Installation

```bash
git clone https://github.com/rajanrengasamy/pplx-cli.git
cd pplx-cli
npm install
npm link
```

## Authentication

Extract cookies from Chrome (one-time setup):

```bash
pplx auth
pplx auth --test    # verify cookies work
```

Or use Playwright to log in and extract cookies:

```bash
pplx auth --playwright
```

Cookies are stored at `~/.config/pplx/cookies.json`.

## Usage

```bash
# Search (default: pro mode, headless HTTP)
pplx search "what is quantum computing"

# Reasoning mode
pplx reason "explain the Riemann hypothesis"

# Deep research
pplx research "compare React vs Vue in 2026"

# Labs (free, no auth needed)
pplx labs "hello world"

# List models
pplx models
```

### Options

```bash
pplx search "query" --mode auto|pro|reasoning|deep-research
pplx search "query" --model claude-3.5-sonnet
pplx search "query" --json          # single JSON object output
pplx search "query" --raw           # plain text, no colors/spinner
pplx search "query" --chrome        # use Chrome CDP bridge instead of HTTP
pplx search "query" --playwright    # use Playwright headless Chromium
pplx search "query" --curl          # force curl-impersonate for TLS (auto-downloads if missing)
pplx search "query" --incognito     # don't save to Perplexity history
pplx search "query" --citations-full  # show full source details
```

## Agent/Automation Usage

pplx-cli is designed to work in automated pipelines and with AI agents:

```bash
# Plain text output (no colors, no spinner)
pplx search "query" --raw

# Read query from stdin
echo "what is 2+2" | pplx search -

# JSON output (single object: {answer, sources, query, mode, model})
pplx search "query" --json

# Pipe-friendly (auto-detects non-TTY)
pplx search "query" | head -1

# Non-zero exit code when no answer is returned
pplx search "query" --json || echo "failed"
```

## Architecture

- **Default mode:** Headless HTTP with stored cookies (no browser needed)
- **Optional:** `--chrome` flag uses Chrome CDP bridge for TLS fingerprinting bypass
- **Optional:** `--playwright` uses Playwright headless Chromium for TLS fingerprinting bypass
- **Auto fallback:** HTTP → Playwright → curl-impersonate (when TLS is blocked)
- **SSE streaming:** Real-time answer streaming via Server-Sent Events
- **Cookie auth:** One-time extraction from Chrome, then fully headless

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

## Acknowledgements

This project was inspired by and built upon the reverse-engineering work in [helallao/perplexity-ai](https://github.com/helallao/perplexity-ai) — a Python library for the Perplexity AI API. The authentication flow, SSE protocol handling, and API structure were all derived from studying that project. Big thanks to [@helallao](https://github.com/helallao) for figuring out the hard parts.

pplx-cli is a ground-up Node.js reimplementation for CLI/agentic use cases, but it wouldn't exist without that foundational work.

## License

MIT
