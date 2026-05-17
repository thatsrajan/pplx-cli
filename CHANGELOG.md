# Changelog

All notable changes to pplx-cli will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.1]: https://github.com/thatsrajan/pplx-cli/compare/v0.1.1...v0.2.1
[0.1.1]: https://github.com/thatsrajan/pplx-cli/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/thatsrajan/pplx-cli/releases/tag/v0.1.0
