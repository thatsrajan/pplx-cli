# REVIEW.md — Technical Review of pplx-cli Implementation Plan

**Reviewer:** Senior Code Review (automated)
**Date:** 2026-02-02
**Verdict:** **GO WITH CHANGES**

---

## Overall Assessment

The plan is impressively thorough — protocol details, code patterns, and architecture are well-documented. It's clearly been reverse-engineered carefully from the Python lib. However, there are several critical issues around TLS fingerprinting, SSE parsing, and the Socket.IO implementation that need addressing before build.

---

## Critical Issues (Must Fix)

### 1. TLS Fingerprinting is Underestimated — HIGH RISK

The plan handwaves this as "start with native fetch, try undici if blocked." This is the single biggest risk and deserves a concrete plan, not a "we'll see."

**Reality:** Perplexity uses Cloudflare, and the Python lib uses `curl_cffi` with `impersonate="chrome"` for a reason. Node.js's native `fetch` (undici) has a **completely different TLS fingerprint** (different cipher suite order, ALPN, extensions, JA3/JA4 hash) than Chrome. Cloudflare's bot detection _will_ see this.

**However:** For cookie-authenticated requests, Cloudflare often relaxes fingerprint checks since you have a valid session. The real risk is on the _first_ request (session init) and on the Labs polling handshake (no cookies).

**Recommendation:**
- Build with native `fetch` first — it may work with valid cookies
- Have `curl-impersonate` as a **ready-to-go fallback**, not a vague idea. Write a `fetchWithCurl()` wrapper early that shells out to `curl-impersonate-chrome` as the escape hatch
- Consider [`tls-client`](https://github.com/nicholasgasior/gotls-client) or the Node.js bindings for `curl-impersonate` if shelling out feels too hacky
- **Add a TLS fingerprint test to the build order as Step 2.5** — hit `https://www.perplexity.ai/` with native fetch and check if you get a 403/Cloudflare challenge before building anything else

### 2. SSE Parsing is Fragile

The SSE parser splits on `\r\n\r\n` and then does string slicing with hardcoded offsets like `'event: message\r\n'.length`. This will break if:
- Server sends `\n\n` instead of `\r\n\r\n` (SSE spec allows both)
- There's extra whitespace or unexpected fields
- `data:` appears without a space after the colon (valid per spec)

**Recommendation:** Use a proper SSE parser. Either:
- [`eventsource-parser`](https://www.npmjs.com/package/eventsource-parser) — tiny, battle-tested, used by Vercel AI SDK
- Write a proper state machine that handles the SSE spec correctly

This is ~20 lines of savings that prevents hours of debugging.

### 3. Socket.IO Polling Response Format is Wrong

The plan says:
> Response starts with packet length prefix, e.g. `"0{\"sid\":\"...\"}"`

This is partially correct for Engine.IO v4, but the polling transport response may include a **length-prefixed format**: `<length>:0{...}` or just `0{...}` depending on the configuration. The `pollText.slice(1)` approach is brittle.

Also: the POST auth response is NOT always `"OK"` — Engine.IO v4 polling POST returns `ok` (lowercase) or sometimes just an empty 200.

**Recommendation:** Be more defensive with the parsing. Look for the first `{` character and parse from there. Handle both `OK` and `ok` and 200-with-empty-body.

### 4. Missing `set-cookie` Handling on Polling

The plan grabs cookies from `pollResp.headers.get('set-cookie')` — but in Node.js, `fetch` (undici) returns `set-cookie` as a **single string** with commas, which is ambiguous. Multiple `Set-Cookie` headers get concatenated.

**Recommendation:** Use `resp.headers.getSetCookie()` (available in Node 20+) which returns an array. The plan uses this correctly in `initSession` but not in the Labs client. Be consistent.

### 5. Chrome Cookie DB is Locked While Chrome is Running

The plan copies the DB to `/tmp` (correct!), but:
- The copy may fail if Chrome has an exclusive WAL lock
- `better-sqlite3` may fail to read a WAL-mode DB copy without the `-wal` and `-shm` files

**Recommendation:** Copy all three files: `Cookies`, `Cookies-wal`, `Cookies-shm` (if they exist). Or use `sqlite3` CLI with `.backup` command which handles WAL correctly.

---

## Recommendations (Nice to Have)

### 6. `chrome-cookies-secure` is Abandonware

Last published 4 years ago, uses outdated crypto patterns, has known issues with recent Chrome versions. The plan already includes a manual implementation as fallback — **just use the manual implementation as primary**. It's ~40 lines and you control it.

### 7. Socket.IO Keepalive Needs a Timer

The plan sends `"3"` in response to `"2"` (pong), but doesn't handle the case where the server doesn't send pings for a while. You need a **ping timeout** — if no `"2"` arrives within `pingTimeout` (from the handshake response, usually 20s), the connection is dead.

Also missing: periodic ping sending. Engine.IO v4 expects the _client_ to also send pings at `pingInterval`. The plan only responds to server pings.

### 8. Rate Limit Endpoint Should Be Used

The plan lists `/rest/rate-limit` in the appendix but never uses it. This should be called:
- On `pplx auth status` to show remaining queries
- Before expensive operations (deep research) to warn the user
- After 429 errors to show when the limit resets

### 9. Follow-up UX is Awkward

```bash
pplx search "what is rust" | pplx search "how does its borrow checker work" --follow-up
```

Piping stdout to parse `backend_uuid` is fragile. Consider instead:
- **Interactive mode:** `pplx search --interactive` that keeps a session open for follow-ups
- **Thread file:** Save last search context to `~/.config/pplx/last-thread.json` and `--follow-up` reads from there (no piping needed)

### 10. Model Names Will Be Stale Immediately

The model map has `gpt-5.2`, `claude-4.5-sonnet`, `grok-4.1` etc. These are clearly speculative/current names. They _will_ change.

**Recommendation:** Add a `pplx models` command that either:
- Lists hardcoded models (easy to update)
- Scrapes the Perplexity settings page for current model list (fragile but auto-updating)

Also allow `--model` to accept raw internal IDs directly (`--model pplx_pro`) as an escape hatch when the mapping is stale.

### 11. Missing Error Handling Cases

- **403 with Cloudflare challenge page** — detect and tell user to refresh cookies
- **401 / redirect to login** — detect and prompt `pplx auth login`
- **WebSocket disconnect mid-stream** — reconnect and retry, or at least show partial output
- **JSON parse failures in SSE** — log the raw data for debugging, don't silently swallow
- **Empty `answer` field** — some responses populate `text` but not `answer` during streaming; handle gracefully

### 12. `conf` Package is Overkill

For storing a single JSON file of cookies, `conf` (Sindre's package) adds unnecessary abstraction. Just use `fs.readFileSync`/`fs.writeFileSync` with `~/.config/pplx/cookies.json`. You're already defining the path.

### 13. Consider `ink` for Terminal UI

If you want rich streaming output (spinners, live-updating markdown), [`ink`](https://github.com/vadimdemedes/ink) (React for CLI) is worth considering instead of `ora` + `chalk` + manual ANSI. But this is optional — `ora` + `chalk` is fine for v1.

---

## Suggested Changes to the Plan

### Build Order (Revised)

1. **Config + constants** — Model maps, URLs, headers
2. **TLS fingerprint test** — Hit Perplexity with native fetch, confirm it works. If not, implement `curl-impersonate` wrapper before proceeding.
3. **Cookie management** — Direct Chrome extraction (skip `chrome-cookies-secure`), load/save from config
4. **SSE client** — Use `eventsource-parser`, core search functionality
5. **CLI framework** — Commander setup, `pplx search`, `pplx auth`
6. **Terminal output** — Streaming markdown render
7. **Labs client** — WebSocket for anonymous queries (good for testing without cookies)
8. **File upload** — S3 upload flow
9. **Polish** — Follow-up, error handling, `--json`, rate limit check

**Rationale:** TLS testing moved to step 2 because if native fetch doesn't work, it changes the entire HTTP layer. Labs moved after CLI because you need the CLI framework to test anything. Cookie extraction before SSE client because you need cookies to test.

### Code Pattern Changes

- Replace manual SSE parser with `eventsource-parser`
- Replace `chrome-cookies-secure` with the direct implementation (already in the plan)
- Add `getSetCookie()` consistently for cookie handling
- Copy WAL files alongside the Chrome cookie DB
- Add raw model ID passthrough to `--model`
- Silence empty `catch {}` blocks — at minimum log in verbose mode

---

## Missing Features vs Python Lib

1. **Account creation flow** — The Python lib can create anonymous accounts via email sign-in. The plan mentions the endpoints but doesn't implement a `pplx auth create` command. Low priority but worth noting.
2. **Thread management** — The Python lib tracks `backend_uuid` and attachments automatically within a session. The plan's follow-up mechanism is less ergonomic.
3. **Custom system prompts** — Not mentioned. Some models support a system message.
4. **Timeout handling** — The Python lib has request timeouts. The plan has none.
5. **Retry logic** — No retry on transient failures (5xx, network errors).

---

## Summary

| Category | Score | Notes |
|----------|-------|-------|
| Architecture | ✅ Good | SSE/WS split is correct and well-reasoned |
| Auth approach | ✅ Good | Direct Chrome extraction is the right call |
| Protocol accuracy | ⚠️ Mostly correct | SSE parsing and Socket.IO handshake need fixes |
| Node.js implementation | ⚠️ Good with caveats | Use eventsource-parser, fix cookie handling |
| TLS/Anti-bot | 🔴 Underestimated | Need a concrete fallback plan, not "we'll see" |
| Error handling | ⚠️ Gaps | Missing 403/401 detection, timeouts, retries |
| CLI design | ✅ Good | Intuitive, good aliases, minor UX improvements suggested |
| Maintainability | ⚠️ Medium | Model map will go stale; raw ID passthrough helps |
| Build order | ⚠️ Needs tweak | TLS test must come early |

**Verdict: GO WITH CHANGES** — Fix the 5 critical issues, adopt the revised build order, and this is a solid plan. The TLS fingerprinting risk is the make-or-break item; test it in the first hour of development.
