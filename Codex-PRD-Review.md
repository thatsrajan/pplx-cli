# Codex PRD Review: pplx-cli

**Reviewer:** Codex (gpt-5.2-codex)  
**Date:** 2026-02-03  
**Runtime:** ~53 seconds

---

## 1. Problem Statement

**Assessment: Partially Clear**

- **Clear at a high level:** "no programmatic access to Pro subscription" is a real user pain; the doc articulates the gap and the cost delta well.

- **Blurs user problem vs. implementation problem:** The "core problem" section is mostly about TLS fingerprinting (an internal obstacle), not the user's core need. A PRD should center on user outcomes first, then technical constraints.

- **Assumes "unlimited Pro queries" and "all models" without qualification.** That's risky as a foundational premise; these are policy/feature-flag dependent and may be rate-limited or restricted.

---

## 2. Value Proposition

**Assessment: Compelling but Fragile**

- **Compelling for Pro subscribers who want CLI + automation:** Cost avoidance, scripting, JSON output, agent integration.

- **Undersells risk/fragility:** Value is high but depends on reverse-engineered APIs, Cloudflare policies, and ToS constraints. That should be explicit in the value statement, not buried.

- **Overpromises "$0/query" and "access all Pro features."** These should be framed as "subject to account policy and availability."

---

## 3. Technical Decisions

**Assessment: Sound Architecture with Security Gaps**

- **Cookie-based auth + SSE parsing is a reasonable path**, and the architecture is logically structured.

- **Storing cookies in plaintext in `~/.config/pplx/cookies.json` is a security risk.** At minimum, file permissions and optional OS keychain storage should be required.

- **Hard-coded UA / sec-ch-ua values (Chrome 128) will drift;** mismatches can cause detection. A dynamic UA aligned to the user's Chrome version is safer.

- **`better-sqlite3` for cookie extraction is pragmatic** but brings native build friction across platforms; the PRD should acknowledge that dependency risk.

- **CDP bridge works but relies on an external gateway and a pre-opened tab** — it's not a stable "productized" path.

- **curl-impersonate integration without streaming support conflicts with a core requirement** (streaming output). That's a design mismatch.

- **The "model mapping" list is brittle and time-sensitive.** A dynamic model fetch is safer than static IDs.

---

## 4. Gaps / Missing Considerations

### Critical Gaps:

1. **Legal/ToS risk:** No explicit section on policy risk, potential account bans, or ethical boundaries. This should be a first-class risk.

2. **Security/threat model:** No guidance on cookie handling, encryption at rest, file permissions, or how to avoid accidental exfiltration (logs, crash dumps).

3. **Reliability metrics:** No success criteria (e.g., success rate, time to first token, allowed failure rate, max startup time).

4. **Platform coverage:** macOS-only cookie extraction is a big limitation; Windows/Linux path is "later" but should be part of a feasibility assessment.

5. **Change management:** Internal API version (`version: '2.18'`) and endpoint stability aren't addressed; needs a strategy for rapid updates.

6. **Rate limits / abuse:** No guidance on throttling, batching, or safe usage patterns to avoid bans.

7. **User experience:** No explicit UX flow for first-run, cookie refresh, or failure modes (expired cookies, CF challenges, 403).

8. **Privacy:** No statement on telemetry (even "none"), which matters for a tool that handles auth tokens.

9. **Testing scope:** Tests are deferred, but SSE parsing and cookie auth are brittle and should have early coverage.

---

## 5. Recommended Solution Path

### Primary Recommendation: Playwright headless as an optional, supported path

It gives the most reliable TLS fingerprint with the lowest engineering risk, and can be packaged as an optional dependency to avoid forcing a 400MB download on all users. This aligns with "works now, cross-platform."

### Secondary Track: curl-impersonate with streaming support

This is the best long-term UX if you can ship prebuilt binaries, but it's high operational burden (updates per Chrome version, packaging).

### Keep CDP bridge as a dev/debug fallback only

It's fragile and external-dependency heavy; not ideal for mainstream use.

### Not Recommended: node-tls-client

I would *not* prioritize node-tls-client until its maintenance and streaming story are verified.

---

## 6. What I Would Change / Improve

1. **Reframe the PRD:** Split "User problem" vs "Engineering constraints." Move TLS fingerprinting into a "Risks & Constraints" section.

2. **Add a Risk & Compliance section:** ToS risk, account ban risk, anti-bot defenses, and a clear disclaimer.

3. **Add Security requirements:** Cookie encryption, permission hardening (`chmod 600`), optional OS keychain storage, and redaction in logs.

4. **Replace static model mappings with dynamic model discovery** when possible, or a cache with a refresh command.

5. **Add success metrics:** e.g., 95%+ success rate, <2s time-to-first-token, <5% auth failures per week.

6. **Make a decision matrix** that includes streaming support and distribution burden — right now the "Recommended" option (curl-impersonate) conflicts with "Priority order" (Playwright first).

7. **Clarify UX flows:** First-run auth, cookie refresh, 403 handling, and explicit guidance when to use `--chrome` vs `--browser`.

8. **Expand platform support roadmap** with feasibility notes; native cookie extraction on Windows/Linux is not trivial.

---

## Summary

The PRD shows strong technical detail but mixes product problems with implementation concerns and lacks defined success metrics, error handling, tests, and compliance considerations. 

**Key concerns:**
- Security risks around plaintext cookie storage
- Fragile cookie extraction limited to macOS Chrome
- Inconsistent user-agent handling risking TLS fingerprint mismatches
- Unclear fallback strategies

**Recommended path:** Optional Playwright headless usage for reliability and fingerprint accuracy despite its size, combined with distributing a prebuilt curl-impersonate binary for a lighter CLI alternative.

The PRD would benefit from separating user problems from technical details, clarifying model support, handling concurrency and rate limits, and adding explicit disclaimers about ToS risk and service fragility.
