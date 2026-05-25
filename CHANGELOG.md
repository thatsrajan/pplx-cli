# Changelog

All notable changes to pplx-cli will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.2] - 2026-05-26

### Added
- **MCP server.** Added `pplx-mcp`, a stdio MCP server for Claude Desktop, Claude Code, Codex, and other MCP clients.
- **MCP tool surface.** Exposes search, labs, auth status, model listing, and Perplexity Computer artifact tools through MCP.

## [0.3.1] - 2026-05-22

### Changed
- **Node 26 compatibility.** Upgraded `better-sqlite3` so installs work on Homebrew Node 26 hosts.

## [0.3.0] - 2026-05-22

### Added
- **Standard artifacts.** Query-producing commands now save run folders by default with `meta.json`, `query.txt`, `answer.md`, `result.json`, and `sources.json`.
- **Artifact controls.** `--out <dir>`, `--artifact-id <id>`, and `--no-artifact` support local agent workflows and deterministic run folders.
- **Perplexity Computer handoff.** `pplx computer` creates artifact-first task prompts for Perplexity Computer and validates `computer-result.json` outputs for local agents.

## [0.2.2] - 2026-05-21

### Added
- **Configurable stream timeout.** `search`, `reason`, and `research` now accept `--timeout-ms <duration>`, with support for raw milliseconds plus `s` and `m` suffixes.

### Changed
- `pplx research` now defaults to a 10-minute stream timeout so Deep Research can finish instead of hitting the old 2-minute ceiling.
- `pplx --version` now reads from `package.json`, keeping CLI output aligned with npm releases.

## [0.2.1] - 2026-05-18

First public release worth telling people about. (v0.2.0 was unpublished before this release; do not use it.)

### Added
- **Multi-browser cookie auto-detection.** `pplx auth --browser auto` now tries Chrome, Chrome Beta, Comet, and Dia in turn and uses the first browser that yields an authenticated session. Force a specific store with `pplx auth --browser <chrome|chrome-beta|comet|dia>`.
- **Session-level auth validation.** `pplx auth` and `pplx auth --test` no longer accept "I extracted some bytes" as success. They verify the extracted cookies resolve to a signed-in Perplexity session by hitting `/api/auth/session` and checking for a user identity.
- **`--no-playwright` flag** on `search`, `reason`, and `research` to force HTTP transport when the config file enables Playwright by default.
- **`--allow-anonymous` flag** to permit anonymous Perplexity responses when cookies are expired (instead of hard-failing).
- **Pre-search auth check** with actionable error message. If stored cookies are stale, the CLI now prints `Run: pplx auth --browser auto` instead of silently degrading.
- **Per-browser diagnostics** in the auth flow. When extraction fails, the CLI lists every browser it tried with cookie count and status (`valid`, `expired`, `no session`) so you can see exactly which store is broken.
- **Defensive `.gitignore` entries** for `cookies.json` and local `.config/` directories.
- **`test/session.test.js`** covering the `isAuthenticatedSession` helper.

### Changed
- Auth error UX is tighter: missing-session and expired-session cases now print distinct messages and exit codes, and never overwrite a working cookie file with a broken one.
- Token preview line removed from auth success output. Session tokens are credentials and should not be echoed to stdout, even truncated.
- `--playwright` is opt-in per invocation. Setting `"playwright": true` in the config file no longer makes `pplx auth` use Playwright by default.

### Documentation
- README restructured around a **Quick Start** that makes the login-first requirement explicit, plus a dedicated **Agent Usage** section for headless and CI use.
- Added a **Security** callout: never commit `cookies.json`, never paste it into a chat.
- Added a **Troubleshooting** table covering the common Keychain, browser store, and TLS fingerprinting failures.

## [0.1.1] - 2026-02-04

### Added
- Codex auto-fallback (HTTP → Playwright → curl-impersonate)
- Playwright as opt-in default transport
- Automatic curl-impersonate download when needed
- Acknowledgement of `helallao/perplexity-ai` upstream project

## [0.1.0] - 2026-02-02

### Added
- Initial release: cookie-authenticated Perplexity CLI
- `search`, `reason`, `research`, `labs`, `models` commands
- Cookie extraction from Chrome on macOS and Linux
- SSE streaming for real-time answers
- Optional Playwright and Chrome CDP transports

[0.3.2]: https://github.com/thatsrajan/pplx-cli/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/thatsrajan/pplx-cli/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/thatsrajan/pplx-cli/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/thatsrajan/pplx-cli/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/thatsrajan/pplx-cli/compare/v0.1.1...v0.2.1
[0.1.1]: https://github.com/thatsrajan/pplx-cli/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/thatsrajan/pplx-cli/releases/tag/v0.1.0
