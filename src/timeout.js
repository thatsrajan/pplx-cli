export const DEFAULT_SEARCH_TIMEOUT_MS = 120000;
export const DEFAULT_RESEARCH_TIMEOUT_MS = 600000;

export function parseTimeoutMs(value, label = 'timeout') {
  if (value == null || value === '') return null;

  if (typeof value === 'number') {
    if (Number.isFinite(value) && value > 0) return Math.trunc(value);
    throw new Error(`${label} must be a positive number of milliseconds`);
  }

  const text = String(value).trim().toLowerCase();
  const match = text.match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/);
  if (!match) {
    throw new Error(`${label} must be a positive duration like 120000, 120s, or 10m`);
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? 'ms';
  const multipliers = { ms: 1, s: 1000, m: 60000 };
  const timeoutMs = amount * multipliers[unit];

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`${label} must be a positive duration`);
  }

  return Math.trunc(timeoutMs);
}

export function resolveTimeoutMs(opts = {}) {
  const explicit = parseTimeoutMs(opts.timeoutMs, '--timeout-ms');
  if (explicit != null) return explicit;

  const configured = parseTimeoutMs(opts.timeout, 'config timeout');
  if (configured != null) return configured;

  return opts.mode === 'deep-research'
    ? DEFAULT_RESEARCH_TIMEOUT_MS
    : DEFAULT_SEARCH_TIMEOUT_MS;
}
