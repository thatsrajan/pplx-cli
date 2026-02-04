# pplx-cli — Status Report

**Date:** 2026-02-04  
**Reviewer:** JARVIS (automated)  
**Codebase:** `/Users/rajan/Library/CloudStorage/Dropbox/Projects/moltbot/labs/pplx-cli/`  
**npm package:** `pplx-npx-search@0.1.0` (published ~12 hours ago by `thatsrajan`)

---

## 1. Summary

The project has **one commit** (`fd82c22 Initial commit: pplx-cli v0.1.0`). Codex built the entire CLI in a single pass from the PLAN.md and REVIEW.md. It's a functional, well-structured codebase with solid test coverage for unit logic. However, **all network-dependent features are broken** due to Cloudflare TLS fingerprinting (403s on native Node.js `fetch`), and several Codex PRD Review recommendations remain unimplemented.

---

## 2. What Codex Built

### Architecture (Clean)
- **11 source files** in `src/` — well-separated concerns
- **6 test files** — 19 passing unit tests, 1 skipped integration test
- **3 transport modes:** native HTTP fetch, Chrome CDP bridge (`--chrome`), Playwright headless (`--playwright`)
- **curl-impersonate** support with auto-download fallback (`--curl`)
- Commander-based CLI with subcommands: `auth`, `search`, `reason`, `research`, `labs`, `models`

### Key Files
| File | Purpose |
|------|---------|
| `src/cli.js` | Commander CLI setup, all commands |
| `src/search.js` | SSE-based search with 3 transport backends |
| `src/labs.js` | WebSocket/Socket.IO labs client (anonymous) |
| `src/cookies.js` | Chrome cookie extraction (macOS + Linux) |
| `src/http.js` | HTTP layer with curl-impersonate fallback + streaming |
| `src/playwright-bridge.js` | Playwright headless Chromium transport |
| `src/playwright-auth.js` | Playwright-based login flow |
| `src/session.js` | Session init + cookie refresh |
| `src/retry.js` | Exponential backoff retry wrapper |
| `src/constants.js` | URLs, headers, model mappings |
| `src/config.js` | User config loader (~/.config/pplx/config.json) |

### Review Issues Addressed
Codex addressed several items from REVIEW.md:
- ✅ Used `eventsource-parser` instead of manual SSE parsing (Review #2)
- ✅ Defensive Engine.IO parsing — finds first `{` (Review #3)
- ✅ Uses `getSetCookie()` array in session.js (Review #4)
- ✅ Copies WAL + SHM files alongside Chrome cookie DB (Review #5)
- ✅ Direct Chrome extraction, no `chrome-cookies-secure` (Review #6)
- ✅ Retry logic with exponential backoff (Review missing feature #5)
- ✅ Raw model ID passthrough in `--model` (Review #10)
- ✅ `pplx models` command implemented (Review #10)

---

## 3. What's Working

| Feature | Status | Notes |
|---------|--------|-------|
| `pplx --help` | ✅ Works | Clean help output with all commands |
| `pplx search --help` | ✅ Works | All options documented |
| `pplx models` | ✅ Works | Lists pro, reasoning, deep-research, and labs models |
| `pplx auth` | ✅ Works | Chrome cookie extraction succeeds (tested, cookies saved) |
| `pplx auth --test` | ⚠️ Fails silently | 403 from Cloudflare on session endpoint (native fetch) |
| Unit tests | ✅ 19/19 pass | cookies, format, labs-parser, retry, search parsing |
| Cookie storage | ✅ Works | Saves to `~/.config/pplx/cookies.json` |

## 4. What's Broken

| Feature | Status | Root Cause |
|---------|--------|------------|
| `pplx search "query"` | ❌ 403 | Native Node.js fetch blocked by Cloudflare TLS fingerprinting |
| `pplx labs "query"` | ❌ Fails silently | Same TLS issue — Socket.IO polling endpoint returns 403/Cloudflare challenge page, `parseEngineIO` throws on HTML, **but the error is swallowed and exit code 1 with no output** |
| `pplx auth --test` | ❌ 403 | Session endpoint also blocked by native fetch |
| `pplx search --curl "query"` | ❓ Untested | curl-impersonate may not be installed; auto-download targets x86_64 even on arm64 macOS |
| `pplx search --playwright "query"` | ⚠️ Should work | Playwright has correct TLS fingerprint; not tested (requires `playwright` dep installed) |
| `pplx search --chrome "query"` | ⚠️ Requires setup | Needs Chrome CDP bridge running externally |

### Critical Bug: Labs fails silently
When `pplx labs "what is 2+2"` runs, the Cloudflare 403 causes a JSON parse error in `parseEngineIO()`. The error propagates to the CLI, but **no error message is printed** — the command exits with code 1 and zero output. This is a terrible UX. The `makeSpinner('Connecting to labs...').start()` likely absorbs the error message, or the error path doesn't properly output to stderr when not a TTY.

---

## 5. npm Package: `pplx-npx-search` vs Local Dev

The globally installed `pplx-npx-search@0.1.0` is the **same project, published to npm** — but it's an **older snapshot** missing the Playwright additions:

| Feature | npm `pplx-npx-search@0.1.0` | Local dev (Dropbox) |
|---------|------------------------------|---------------------|
| Playwright bridge | ❌ Missing | ✅ Has `playwright-bridge.js` + `playwright-auth.js` |
| `--playwright` flag | ❌ Not in search options | ✅ Available on search/reason/research |
| `pplx auth --playwright` | ❌ Not available | ✅ Available |
| playwright dependency | ❌ Not in package.json | ✅ `playwright: ^1.58.1` |
| curl-impersonate auto-download | ❌ Missing | ✅ Full implementation |
| curl warning dedup | ❌ Warns multiple times | ✅ `warnedNoCurl` flag |

**Bottom line:** The npm-published version is less capable. It has no `--playwright` option and a simpler curl fallback. Should republish after Playwright additions are stable.

---

## 6. Codex PRD Review: Implementation Status

### ✅ Implemented

| Recommendation | Status | Details |
|----------------|--------|---------|
| Playwright-first approach | ✅ Partially | Added as `--playwright` flag option, not the default. Playwright bridge + auth both implemented. |
| Replace static model map with escape hatch | ✅ Done | `--model` accepts raw internal IDs directly |
| Use `eventsource-parser` | ✅ Done | Proper SSE parser throughout |
| Retry logic | ✅ Done | `withRetry()` with exponential backoff, respects Retry-After |
| Multiple transport backends | ✅ Done | HTTP, Chrome CDP, Playwright, curl-impersonate |

### ❌ NOT Implemented

| Recommendation | Status | Notes |
|----------------|--------|-------|
| **Security: cookie encryption at rest** | ❌ Missing | Cookies stored as **plaintext JSON** with `644` permissions. Anyone on the machine can read them. Should be `600` at minimum, ideally OS keychain. |
| **`pplx doctor` command** | ❌ Missing | No diagnostic command to check TLS fingerprint, cookie validity, transport availability |
| **`pplx auth --revoke`** | ❌ Missing | No way to clear stored cookies. `auth` only has `--test` and `--profile` |
| **ToS risk disclosures** | ❌ Missing | No warnings about Terms of Service violations, account ban risk, or that this is reverse-engineering Perplexity's internal API |
| **Problem statement consolidation** | ❌ Missing | PRD still mixes user problem with TLS fingerprinting engineering constraint |
| **Success metrics** | ❌ Missing | No defined SLA (success rate, time-to-first-token, etc.) |
| **Rate limit integration** | ❌ Missing | `/rest/rate-limit` endpoint not used anywhere |
| **File upload** | ❌ Missing | Planned in PLAN.md but not implemented |
| **Dynamic model discovery** | ❌ Missing | Still using hardcoded model map |
| **Cookie permission hardening** | ❌ Missing | File is `644`, should be `600` |
| **Privacy statement** | ❌ Missing | No telemetry disclosure |
| **Platform support beyond macOS** | ⚠️ Partial | Linux cookie extraction code exists but untested |

---

## 7. Code Quality Notes

### Good
- Clean module separation, single responsibility
- Proper async generators for streaming
- `eventsource-parser` adoption (correct choice)
- Defensive cookie DB handling (copies WAL/SHM)
- Good CLI UX: `--raw`, `--json`, stdin pipe support, auto-detects TTY
- Tests cover the pure logic well

### Concerns
- **Silent failures:** Labs command fails with exit code 1 but no error output
- **Cookie file permissions:** `644` is a security issue for session tokens
- **Hardcoded Chrome 128 UA:** `sec-ch-ua: "Chromium";v="128"` will drift and cause detection mismatches
- **No timeout on labs WebSocket:** 10s connection timeout, but no overall query timeout
- **`parseEngineIO` in labs.js is duplicated** from search.js — different implementations
- **Playwright is a 400MB dependency** listed as a required dep, not optional

---

## 8. Recommended Next Steps

### P0 — Must Fix (Blocking Usage)
1. **Make `--playwright` the default transport** — native fetch is DOA due to Cloudflare. Either default to Playwright or auto-detect 403 and fall back.
2. **Fix silent failure in labs** — The catch path needs to actually print the error message. Currently fails silently.
3. **Fix cookie file permissions** — `saveCookies()` should `chmod 600` after writing.
4. **Republish to npm** — The published `pplx-npx-search@0.1.0` is missing Playwright support. Bump to `0.2.0` and republish.

### P1 — Should Do
5. **Add `pplx auth --revoke`** — Simple: delete `~/.config/pplx/cookies.json`
6. **Add `pplx doctor`** — Check: cookies exist? valid? Playwright installed? curl-impersonate available? TLS test against Perplexity?
7. **Add ToS disclaimer** — First-run warning or `--disclaimer` flag. Protects users.
8. **Make Playwright an optional peer dependency** — Don't force 400MB download. Detect at runtime, prompt to install.
9. **Fix arm64 macOS curl-impersonate** — `resolveCurlAsset()` maps arm64 to x86_64 binary, which won't work natively on Apple Silicon.

### P2 — Nice to Have
10. **Dynamic model discovery** — Scrape or cache model list
11. **Rate limit check** — Use `/rest/rate-limit` before search
12. **File upload support** — Implement S3 presigned upload flow
13. **UA version sync** — Detect Chrome version and update headers dynamically

---

## 9. Testing Summary

```
$ node --test test/**/*.test.js

▶ cookieHeader ........ 3/3 pass
▶ formatSources ....... 3/3 pass  
▶ parseEngineIO ....... 4/4 pass
▶ withRetry ........... 5/5 pass
▶ parseNestedText ..... 4/4 pass

19 pass | 0 fail | 1 skipped (curl integration)
```

**Missing test coverage:**
- No integration tests for actual search flow
- No tests for Playwright bridge
- No tests for cookie extraction (would need mock Chrome DB)
- No tests for CLI command parsing

---

## 10. File Permissions Audit

```
~/.config/pplx/cookies.json  →  644 (SHOULD BE 600)
```

Contains session tokens that grant full access to Rajan's Perplexity Pro account. World-readable.

---

*Report generated 2026-02-04 by JARVIS*
