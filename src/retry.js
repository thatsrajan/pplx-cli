const RETRIABLE = new Set([429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export async function withRetry(fn, opts = {}) {
  const { maxRetries = 3, baseDelay = 1000 } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fn();
      if (resp && RETRIABLE.has(resp.status) && attempt < maxRetries) {
        const retryAfter = resp.headers?.get?.('retry-after');
        const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 || baseDelay * 2 ** attempt : baseDelay * 2 ** attempt;
        if (process.env.PPLX_VERBOSE) console.error(`Retrying (${resp.status}) in ${delay}ms...`);
        await sleep(delay);
        continue;
      }
      return resp;
    } catch (e) {
      lastErr = e;
      if (attempt < maxRetries) {
        const delay = baseDelay * 2 ** attempt;
        if (process.env.PPLX_VERBOSE) console.error(`Retrying (${e.message}) in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}
