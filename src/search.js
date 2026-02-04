import { randomUUID } from 'crypto';
import chalk from 'chalk';
import { createParser } from 'eventsource-parser';
import { BASE_URL, MODEL_MAP, HEADERS } from './constants.js';
import { cookieHeader } from './cookies.js';
import { initSession } from './session.js';
import { request, streamingFetch, getUseCurl, setUseCurl } from './http.js';
import { withRetry } from './retry.js';

export function resolveModelPref(mode, model) {
  const modeKey = mode === 'deep-research' ? 'deep-research' : mode;
  return model
    ? (MODEL_MAP[modeKey]?.[model] ?? model)
    : (MODEL_MAP[modeKey]?.default ?? 'turbo');
}

function buildSearchBody(query, opts, modelPref) {
  const {
    sources = ['web'],
    language = 'en-US',
    incognito = false,
    followUp = null,
    mode = 'auto',
  } = opts;

  return JSON.stringify({
    query_str: query,
    params: {
      attachments: followUp?.attachments ?? [],
      frontend_context_uuid: randomUUID(),
      frontend_uuid: randomUUID(),
      is_incognito: incognito,
      language,
      last_backend_uuid: followUp?.backend_uuid ?? null,
      mode: mode === 'auto' ? 'concise' : 'copilot',
      model_preference: modelPref,
      source: 'default',
      sources,
      version: '2.18',
    },
  });
}

function mergeSetCookies(cookies, resp) {
  const setCookies = resp.headers.getSetCookie?.() ?? [];
  for (const sc of setCookies) {
    const [pair] = sc.split(';');
    const eqIdx = pair.indexOf('=');
    if (eqIdx > 0) {
      cookies[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
    }
  }
}

function parseEngineIO(text) {
  const match = text.match(/^(\d+):(.+)$/s);
  const payload = match ? match[2] : text;
  const braceIdx = payload.indexOf('{');
  if (braceIdx === -1) throw new Error('No JSON found in Engine.IO response');
  return JSON.parse(payload.slice(braceIdx));
}

async function initSocketSession(cookies) {
  const t = Math.random().toString(16).slice(2, 10);
  const url = `${BASE_URL}/socket.io/?EIO=4&transport=polling&t=${t}`;

  try {
    let resp = await withRetry(() => request(url, {
      headers: {
        'user-agent': HEADERS['user-agent'],
        'accept': '*/*',
        'cookie': cookieHeader(cookies),
      },
      redirect: 'manual',
    }));

    if (!resp.ok) {
      // Socket session init failed (likely Cloudflare), continue without it
      if (process.env.PPLX_VERBOSE) {
        console.error(`Socket session init failed (${resp.status}), continuing...`);
      }
      return { sid: null, cookies, status: resp.status, ok: false };
    }

    const text = await resp.text();
    mergeSetCookies(cookies, resp);
    const handshake = parseEngineIO(text);
    return { sid: handshake.sid, cookies, status: resp.status, ok: resp.ok };
  } catch (e) {
    if (process.env.PPLX_VERBOSE) {
      console.error('Socket session init error:', e.message);
    }
    return { sid: null, cookies, status: 0, ok: false };
  }
}

async function* searchWithChrome(query, cookies, opts) {
  const { ChromeBridge } = await import('./chrome-bridge.js');
  const modelPref = resolveModelPref(opts.mode ?? 'auto', opts.model);
  const body = buildSearchBody(query, opts, modelPref);
  const bridge = new ChromeBridge();
  try {
    await bridge.connect();

    const results = [];
    const parser = createParser({
      onEvent(event) {
        if (event.data === '{}' || !event.data) return;
        try {
          const json = JSON.parse(event.data);
          parseNestedText(json);
          results.push(json);
        } catch (e) {
          console.error(chalk.yellow('Warning: failed to parse SSE event'));
          if (process.env.PPLX_VERBOSE) {
            console.error('SSE parse error:', e.message);
          }
        }
      }
    });

    let gotFinal = false;
    for await (const chunk of bridge.fetchSSE(
      `${BASE_URL}/rest/sse/perplexity_ask`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }
    )) {
      parser.feed(chunk);
      while (results.length > 0) {
        const r = results.shift();
        if (r.final_sse_message) gotFinal = true;
        yield r;
      }
      if (gotFinal) break;
    }

    while (results.length > 0) {
      yield results.shift();
    }
  } finally {
    bridge.close();
  }
}

async function* searchWithPlaywright(query, cookies, opts) {
  const { PlaywrightBridge } = await import('./playwright-bridge.js');
  const modelPref = resolveModelPref(opts.mode ?? 'auto', opts.model);
  const body = buildSearchBody(query, opts, modelPref);
  const bridge = new PlaywrightBridge({ headless: opts.playwrightHeadless !== false, cookies });
  try {
    await bridge.connect();

    const results = [];
    const parser = createParser({
      onEvent(event) {
        if (event.data === '{}' || !event.data) return;
        try {
          const json = JSON.parse(event.data);
          parseNestedText(json);
          results.push(json);
        } catch (e) {
          console.error(chalk.yellow('Warning: failed to parse SSE event'));
          if (process.env.PPLX_VERBOSE) {
            console.error('SSE parse error:', e.message);
          }
        }
      }
    });

    let gotFinal = false;
    for await (const chunk of bridge.fetchSSE(
      `${BASE_URL}/rest/sse/perplexity_ask`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }
    )) {
      parser.feed(chunk);
      while (results.length > 0) {
        const r = results.shift();
        if (r.final_sse_message) gotFinal = true;
        yield r;
      }
      if (gotFinal) break;
    }

    while (results.length > 0) {
      yield results.shift();
    }
  } finally {
    await bridge.close();
  }
}

async function* searchWithHttp(query, cookies, opts) {
  const { cookies: sessionCookies, ok, status } = await initSession(cookies);
  if (!ok) {
    throw new Error(`Auth failed (status ${status}). Run: pplx auth`);
  }

  await initSocketSession(sessionCookies);

  const modelPref = resolveModelPref(opts.mode ?? 'auto', opts.model);
  const body = buildSearchBody(query, opts, modelPref);

  const resp = await streamingFetch(`${BASE_URL}/rest/sse/perplexity_ask`, {
    method: 'POST',
    headers: {
      'accept': 'text/event-stream',
      'content-type': 'application/json',
      'accept-language': HEADERS['accept-language'],
      'user-agent': HEADERS['user-agent'],
      'origin': BASE_URL,
      'referer': `${BASE_URL}/`,
      'cookie': cookieHeader(sessionCookies),
    },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 500)}`);
  }

  if (!resp.body) {
    throw new Error('No response body for SSE stream');
  }

  const results = [];
  const parser = createParser({
    onEvent(event) {
      if (event.data === '{}' || !event.data) return;
      try {
        const json = JSON.parse(event.data);
        parseNestedText(json);
        results.push(json);
      } catch (e) {
        console.error(chalk.yellow('Warning: failed to parse SSE event'));
        if (process.env.PPLX_VERBOSE) {
          console.error('SSE parse error:', e.message);
        }
      }
    }
  });

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let gotFinal = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.feed(decoder.decode(value, { stream: true }));
    while (results.length > 0) {
      const r = results.shift();
      if (r.final_sse_message) gotFinal = true;
      yield r;
    }
    if (gotFinal) {
      await reader.cancel();
      break;
    }
  }

  parser.feed(decoder.decode());
  while (results.length > 0) {
    yield results.shift();
  }
}

/**
 * Search Perplexity using the SSE-based main client.
 * Uses Chrome bridge (CDP) only when opts.chrome is true.
 */
export async function* search(query, cookies, opts = {}) {
  if (opts.chrome) {
    yield* searchWithChrome(query, cookies, opts);
    return;
  }

  const attempts = [];
  if (opts.playwright) {
    attempts.push({ name: 'playwright', run: () => searchWithPlaywright(query, cookies, opts) });
    attempts.push({ name: 'curl', run: () => searchWithHttp(query, cookies, opts), curl: true });
  } else if (opts.curl) {
    attempts.push({ name: 'curl', run: () => searchWithHttp(query, cookies, opts), curl: true });
  } else {
    attempts.push({ name: 'http', run: () => searchWithHttp(query, cookies, opts) });
    attempts.push({ name: 'playwright', run: () => searchWithPlaywright(query, cookies, opts) });
    attempts.push({ name: 'curl', run: () => searchWithHttp(query, cookies, opts), curl: true });
  }

  const shouldFallbackHttp = (err) => {
    const msg = (err?.message || '').toLowerCase();
    return msg.includes('403') || msg.includes('tls') || msg.includes('cloudflare');
  };

  let lastErr = null;
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    const isLast = i === attempts.length - 1;
    const prevCurl = getUseCurl();
    if (attempt.curl) setUseCurl(true);

    let yielded = false;
    try {
      const gen = attempt.run();
      for await (const item of gen) {
        yielded = true;
        yield item;
      }
      return;
    } catch (e) {
      lastErr = e;
      if (attempt.name === 'http' && !shouldFallbackHttp(e)) throw e;
      if (yielded || isLast) throw e;
      if (process.env.PPLX_VERBOSE) {
        console.error(`Search fallback: ${attempt.name} failed, trying next...`);
      }
    } finally {
      if (attempt.curl) setUseCurl(prevCurl);
    }
  }

  if (lastErr) throw lastErr;
}

export function parseNestedText(json) {
  if (json.text && typeof json.text === 'string') {
    try {
      const parsed = JSON.parse(json.text);
      if (Array.isArray(parsed)) {
        for (const step of parsed) {
          if (step.step_type === 'FINAL' && step.content?.answer) {
            try {
              const answerData = JSON.parse(step.content.answer);
              json.answer = answerData.answer ?? '';
              json.chunks = answerData.chunks ?? [];
            } catch { json._parseError = true; }
            break;
          }
        }
      }
      json.text = parsed;
    } catch { json._parseError = true; }
  }
}
